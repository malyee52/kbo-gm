// 장기 시뮬레이션 (M6 완료 기준): 모든 구단을 AI가 맡아 여러 시즌을 이어서 돌리고 해마다 지표를 남긴다.
//
// 사용법:  npx tsx tools/longsim.ts [--start 2026] [--seasons 20] [--seeds a,b] [--pilot 3] [--out reports/longsim.md]
//
// 리그 비율(타율·홈런·볼넷·삼진)은 해마다 환경 맞춤으로 목표에 맞추므로 그대로 비교하면 의미가 없다.
// 대신 환경 맞춤 계수(cal)가 1에서 얼마나 벗어나는지로 "선수 전체의 기량이 실제 리그 수준에서 멀어지는지"를 본다.
// 계수가 1보다 크면 그 사건을 실제보다 덜 내는 선수들이라 엔진이 끌어올렸다는 뜻이다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, isSpecificEvent, Season, winPct, type EngineParams, type World } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { isServing } from '../src/league/careers';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import type { LeagueState } from '../src/league/types';
import { worldFromLeague } from '../src/league/world';
import { capFloorShorts } from '../src/league/owner';
import { foreignCap, minSalary, salaryCap, teamCapPayroll, wageIndex } from '../src/league/salary';
import { ballHrMul, FUTURE_RULE_SPEC, futureValue, futureValueText, type FutureRuleKey } from '../src/league/futureRules';
import { realSpread, sdOf, SPREAD_HEAD, spreadLine } from './real_spread';
import { countVotes, meritExcess, voteParts, type RuleVoteRecord } from '../src/ai/vote';
import { asSim } from '../src/league/growth';
import { agendaChange, agendaLabel, voteFacts } from '../src/league/ruleVote';
import { installCalCache } from './calCache';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface YearMetrics {
  year: number;
  /** 팀 경기당 득점 */
  runs: number;
  /** 환경 맞춤 계수 (1 = 선수 기량이 목표 리그 수준과 같음) */
  cal: { s1: number; hr: number; bb: number; so: number };
  /** 팀 승률 표준편차 */
  sd: number;
  maxW: number;
  minW: number;
  /** 구단별 월드 인원 (최소, 최대) */
  orgMin: number;
  orgMax: number;
  /** 구단별 소속 (복무 제외) 최소·최대: 결산 직후 기준 */
  players: number;
  /** 타석 가중 평균 나이 */
  ageBat: number;
  /** 이닝 가중 평균 나이 */
  agePit: number;
  maxAge: number;
  /** 실존 선수 타석 비중 */
  realPa: number;
  injuries: number;
  majors: number;
  events: number;
  specific: number;
  /** 실존 선수에게 붙은 구체적 사건 (0이어야 한다) */
  specificOnReal: number;
  retired: number;
  serving: number;
  /** 구단별 주전(타자 9 + 선발 5 + 구원 7) 기여 합의 평균 (런) */
  core: number;
  /** 그 해 시즌 뒤 FA: 신청(해외 복귀 제외), 다른 구단 이적, 보상선수로 옮긴 선수 */
  fa: { filed: number; moved: number; compPlayers: number };
  /** 오프시즌 뒤 다음 시즌 개막 기준 샐러리캡: 초과 구단, 하한 미달 구단, 구단 평균 사용률 (캡 없으면 null) */
  cap: { over: number; short: number; use: number } | null;
  /** 결산 때 정해진 다음 시즌 미래 규칙 변경 ② (없으면 빈 문자열) */
  shift: string;
  /** 그 시즌 선수층 압력 (1 / 맞춤 계수): 홈런·삼진·볼넷 */
  pressure: { hr: number; so: number; bb: number };
  /** 연봉·재정 (다음 시즌 개막 기준): 연봉 상승 지수, 캡 상향률, 결산 뒤 구단 자금 평균·최소, 긴급 지원 구단 수, FA 계약 수 */
  econ: { wage: number; capGrowth: number; cashAvg: number; cashMin: number; rescued: number; faSigned: number };
  /** 그 시즌 공·타격: 홈런 목표 배율, 타석당 홈런, 리그 평균자책, 최다 홈런, 규정이닝 평균자책 2점 미만 투수 수, 다음 해 외국인 한도 */
  ball: { hrMul: number; hrPa: number; era: number; topHr: number; subTwo: number; foreign: number };
  /** 규정·흥행 (외국인 한도 판정 신호): 다음 해 최저 연봉(만 원)·외국인 신규·총액 상한(달러), 그 시즌 경기당 관중·외국인 연봉 부담·적자 구단 */
  rule: { minPay: number; foreignNew: number; foreignTotal: number; attendance: number; foreignShare: number; deficit: number };
  /** 그 해 결산의 단장 회의 (구단 투표). 모든 구단 AI로 개표한 결과와, 구단마다 "그 구단이 플레이어라면" 따져 본 값 */
  votes: VoteRow[];
}

/** 단장 회의 안건 하나 (longsim 집계, 구단투표 기획안 V5) */
export interface VoteRow {
  record: RuleVoteRecord;
  /** 명분이 쓰는 신호 초과 정도 (0~1) */
  excess: number;
  /** 결정표 구단 수: 그 구단을 플레이어로 볼 때 나머지 AI 찬성이 문턱 − 1 (우리 표가 결과를 가른다) */
  decisive: number;
  /** 그 구단이 플레이어로 반대(또는 표 없음)할 때 가결되는 구단 수 */
  passIfNo: number;
  /** 값을 다시 맞출 때 쓰는 구단별 몫 (ai/vote.ts VoteParts) */
  parts: { team: number; interest: number; lean: number }[];
}

/** 리그 상태에서 한 시즌을 돌리고 오프시즌을 AI로 끝까지 진행한다 */
export function runYear(league: LeagueState, store: ReturnType<typeof loadDataStore>, params: EngineParams,
  /** 오프시즌이 끝난 직후(closeOffseason 전) 상태를 들여다보는 도구용 고리 (tools/fa_finance.ts) */
  onOffseason?: (off: Off.OffseasonState, world: World) => void): { m: YearMetrics; world: World } {
  const world = worldFromLeague(structuredClone(league), store, params);
  const seed = league.year === league.startYear ? league.seed : `${league.seed}/${league.year}`;
  const season = Season.start(world, params, seed);
  season.runToEnd();

  const t = season.totals;
  const teams = season.teams;
  const pcts = teams.map(winPct);
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const sd = Math.sqrt(pcts.reduce((a, b) => a + (b - mean) ** 2, 0) / pcts.length);
  let paAge = 0;
  let pa = 0;
  let ipAge = 0;
  let ip = 0;
  let realPa = 0;
  let maxAge = 0;
  for (const p of world.players) {
    const b = season.bat[p.idx];
    const q = season.pit[p.idx];
    if (p.age !== null) {
      paAge += b.pa * p.age;
      pa += b.pa;
      ipAge += q.outs * p.age;
      ip += q.outs;
      if (b.pa + q.bf > 0) maxAge = Math.max(maxAge, p.age);
    }
    if (p.real !== false) realPa += b.pa;
  }
  const allPa = world.players.reduce((s, p) => s + season.bat[p.idx].pa, 0);
  const ctx = valueContext(world);
  const core = world.teams.map((tm) => {
    const r = (xs: number[], n: number) => xs.sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
    const hit = tm.org.filter((p) => !p.isPitcher).map((p) => currentRuns(p, ctx));
    const sp = tm.org.filter((p) => p.isPitcher && (p.pit?.startShare ?? 0) >= 0.5).map((p) => currentRuns(p, ctx));
    const rp = tm.org.filter((p) => p.isPitcher && (p.pit?.startShare ?? 0) < 0.5).map((p) => currentRuns(p, ctx));
    return r(hit, 9) + r(sp, 5) + r(rp, 7);
  });
  const abs = season.absences;
  const specific = abs.filter((a) => a.event && isSpecificEvent(a.event));

  const shiftsBefore = league.ruleShifts?.length ?? 0;
  const votesBefore = league.ruleVotes?.length ?? 0;
  const off = Off.beginOffseason(league, world, season, store, -1, params);
  // 단장 회의가 열렸으면 AI 표를 낸 지표를 다시 모은다 (결산 직후와 같은 상태, offseason.ts와 같은 기여)
  const ctxNow = valueContext(world);
  const facts = off.vote ? voteFacts(league, world, season, world.year, (p) => currentRuns(asSim(p, world.league, world.year + 1), ctxNow)) : [];
  const agendaParts = (off.vote?.agendas ?? []).map((a) => voteParts(a, facts).map((x) => ({ team: x.team, interest: x.interest, lean: x.lean })));
  let guard = 0;
  while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
  const newShift = (league.ruleShifts ?? []).slice(shiftsBefore)[0];
  const votes: VoteRow[] = (league.ruleVotes ?? []).slice(votesBefore).map((record, i) => {
    const ai = record.votes;
    const voters = ai.map((v, t) => (v >= 0 ? t : -1)).filter((t) => t >= 0);
    return {
      record, excess: meritExcess(record),
      decisive: voters.filter((t) => countVotes(ai, t, 'yes').passed !== countVotes(ai, t, 'no').passed).length,
      passIfNo: voters.filter((t) => countVotes(ai, t, 'no').passed).length,
      parts: agendaParts[i] ?? [],
    };
  });
  if (off.stage !== 'ready') throw new Error(`${league.year} 오프시즌이 끝나지 않았습니다 (단계 ${off.stage})`);
  onOffseason?.(off, world);
  const retiredNow = (league.retired ?? []).filter((r) => r.year === off.year).length;
  const faEntries = (off.fa?.entries ?? []).filter((e) => !e.returnee);
  const faSigned = faEntries.filter((e) => e.status === 'signed').length;
  const fa = {
    filed: faEntries.length,
    moved: faEntries.filter((e) => e.status === 'signed' && e.team !== undefined && e.team !== e.from).length,
    compPlayers: (off.comp ?? []).filter((c) => c.pick !== null && c.pick !== 'cash').length,
  };
  Off.closeOffseason(league, off);
  const sizes = league.teams.map((_, i) => league.players.filter((p) => p.team === i && !isServing(p) && !p.dev).length);
  const capNext = salaryCap(league.year, league);
  const pays = league.teams.map((_, i) => teamCapPayroll(league, i, league.year));
  const cap = capNext === null ? null : {
    over: pays.filter((x) => x > capNext).length,
    short: capFloorShorts(league, league.year).length,
    use: pays.reduce((a, b) => a + b, 0) / pays.length / capNext,
  };

  const hist = league.teams.map((_, i) => league.finance?.[i]?.history.find((h) => h.year === world.year)).filter((h) => !!h);
  const outs = world.players.reduce((a, p) => a + season.pit[p.idx].outs, 0);
  const games = Math.max(...teams.map((x) => x.g));
  const qualified = world.players.filter((p) => season.pit[p.idx].outs >= games * 3);
  const econ = {
    wage: wageIndex(league.year, league), capGrowth: futureValue(league, 'capGrowth', league.year),
    cashAvg: hist.reduce((a, h) => a + h.cash, 0) / (hist.length || 1), cashMin: Math.min(...hist.map((h) => h.cash)),
    rescued: hist.filter((h) => h.rescue > 0).length, faSigned,
  };
  const ball = {
    hrMul: ballHrMul(league, world.year), hrPa: t.hr / (t.pa || 1), era: (27 * t.er) / (outs || 1),
    topHr: Math.max(...world.players.map((p) => season.bat[p.idx].hr)),
    subTwo: qualified.filter((p) => (27 * season.pit[p.idx].er) / season.pit[p.idx].outs < 2).length,
    foreign: futureValue(league, 'foreign', league.year),
  };

  const sig = (league.ruleSignals ?? []).find((s) => s.year === world.year);
  const rule = {
    minPay: minSalary(league.year, league), foreignNew: foreignCap(league, 'foreignNewCap', league.year), foreignTotal: foreignCap(league, 'foreignTotalCap', league.year),
    attendance: sig?.attendance ?? 0, foreignShare: sig?.foreignShare ?? 0, deficit: sig?.deficit ?? 0,
  };

  return {
    world,
    m: {
      year: world.year,
      runs: t.r / (teams.reduce((s, x) => s + x.g, 0) || 1),
      cal: { s1: season.cal.s1, hr: season.cal.hr, bb: season.cal.bb, so: season.cal.so },
      sd, maxW: Math.max(...teams.map((x) => x.w)), minW: Math.min(...teams.map((x) => x.w)),
      orgMin: Math.min(...world.teams.map((x) => x.org.length)), orgMax: Math.max(...world.teams.map((x) => x.org.length)),
      players: Math.max(...sizes),
      ageBat: paAge / (pa || 1), agePit: ipAge / (ip || 1), maxAge,
      realPa: realPa / (allPa || 1),
      injuries: abs.filter((a) => a.kind !== 'event').length,
      majors: abs.filter((a) => a.kind === 'major').length,
      events: abs.filter((a) => a.kind === 'event').length,
      specific: specific.length,
      specificOnReal: specific.filter((a) => world.players[a.idx].real !== false).length,
      retired: retiredNow,
      serving: league.players.filter(isServing).length,
      core: core.reduce((a, b) => a + b, 0) / core.length,
      fa,
      cap,
      shift: [
        ...votes.filter((v) => !v.record.passed).map((v) => `${v.record.year} ${v.record.key} ${agendaChange(v.record).replace(' → ', '→')} 부결 ${v.record.yes}:${v.record.no}`),
        ...(newShift ? [`${newShift.year} ${newShift.key} ${futureValueText(newShift.key, newShift.before)}→${futureValueText(newShift.key, newShift.after)}${newShift.vote ? ` 가결 ${newShift.vote.yes}:${newShift.vote.no}` : ''}`] : []),
      ].join(', '),
      pressure: { hr: 1 / season.cal.hr, so: 1 / season.cal.so, bb: 1 / season.cal.bb },
      econ, ball, rule, votes,
    },
  };
}

function table(rows: YearMetrics[]): string {
  const f = (x: number, d = 2) => x.toFixed(d);
  const head = '| 연도 | 득점 | cal 단타·홈런·볼넷·삼진 | 승률SD | 최다·최소승 | 월드 인원 | 소속 최대 | 나이 타·투 | 최고령 | 실존 타석 | 부상(큰) | 이벤트(구체) | 은퇴 | 복무 | 주전 기여 | FA 신청·이적·보상선수 | 다음 해 캡 초과·하한 미달·사용률 | 압력 홈런·삼진·볼넷 | 다음 해 규칙 변경 (가상) |';
  const sep = '|' + '---|'.repeat(19);
  const body = rows.map((r) => `| ${r.year} | ${f(r.runs)} | ${f(r.cal.s1)} ${f(r.cal.hr)} ${f(r.cal.bb)} ${f(r.cal.so)} | ${f(r.sd, 3)} | ${r.maxW}·${r.minW} | ${r.orgMin}~${r.orgMax} | ${r.players} | ${f(r.ageBat, 1)}·${f(r.agePit, 1)} | ${r.maxAge} | ${f(r.realPa * 100, 0)}% | ${r.injuries}(${r.majors}) | ${r.events}(${r.specific}) | ${r.retired} | ${r.serving} | ${f(r.core, 0)} | ${r.fa.filed}·${r.fa.moved}·${r.fa.compPlayers} | ${r.cap ? `${r.cap.over}·${r.cap.short}·${f(r.cap.use * 100, 0)}%` : '-'} | ${f(r.pressure.hr)} ${f(r.pressure.so)} ${f(r.pressure.bb)} | ${r.shift} |`);
  const eok = (v: number) => (v / 10000).toFixed(0);
  const econ = ['| 연도 | 연봉 지수(다음 해) | 캡 상향률(다음 해) | 캡 사용률 | 자금 평균·최소(억) | 긴급 지원 구단 | FA 신청·계약 |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.year} | ${f(r.econ.wage)} | ${f(r.econ.capGrowth * 100, 0)}% | ${r.cap ? f(r.cap.use * 100, 0) + '%' : '-'} | ${eok(r.econ.cashAvg)}·${eok(r.econ.cashMin)} | ${r.econ.rescued} | ${r.fa.filed}·${r.econ.faSigned} |`)];
  const ball = ['| 연도 | 홈런 배율 | 타석당 홈런 | 평균자책 | 최다 홈런 | 2점 미만 투수 | 다음 해 외국인 한도 |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.year} | ${f(r.ball.hrMul, 3)} | ${f(r.ball.hrPa * 100, 2)}% | ${f(r.ball.era)} | ${r.ball.topHr} | ${r.ball.subTwo} | ${r.ball.foreign} |`)];
  const man = (v: number) => Math.round(v / 10000);
  const rule = ['| 연도 | 다음 해 최저 연봉(만 원) | 다음 해 외국인 신규·총액 상한(만 달러) | 경기당 관중 | 외국인 연봉 부담 | 적자 구단 | 다음 해 외국인 한도 | 다음 해 규칙 변경 (가상) |', '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.year} | ${r.rule.minPay.toLocaleString('ko-KR')} | ${man(r.rule.foreignNew)}·${man(r.rule.foreignTotal)} | ${r.rule.attendance ? r.rule.attendance.toLocaleString('ko-KR') : '-'} | ${r.rule.attendance ? f(r.rule.foreignShare * 100, 1) + '%' : '-'} | ${r.rule.attendance ? r.rule.deficit : '-'} | ${r.ball.foreign} | ${r.shift} |`)];
  return [head, sep, ...body, '', ...econ, '', ...ball, '', ...rule].join('\n');
}

/** 단장 회의 집계 (구단투표 기획안 V5): 안건 표와 요약 */
function voteSection(rows: YearMetrics[]): string {
  const vs = rows.flatMap((r) => r.votes);
  if (!vs.length) return '단장 회의 안건 없음.\n';
  const head = ['| 결산 | 안건 | 전 → 후 | 신호 초과 | AI 찬성 (문턱) | 결과 | 결정표 구단 | 플레이어 반대일 때 가결 구단 |', '|---|---|---|---|---|---|---|---|'];
  const body = vs.map((v) => `| ${v.record.year - 1} | ${agendaLabel(v.record)} | ${agendaChange(v.record)} | ${v.excess.toFixed(2)} | ${v.record.yes} (${v.record.need}) | ${v.record.passed ? '가결' : '부결'} | ${v.decisive}/${v.record.yes + v.record.no} | ${v.passIfNo}/${v.record.yes + v.record.no} |`);
  const n = vs.length;
  const passed = vs.filter((v) => v.record.passed).length;
  const voters = vs.reduce((a, v) => a + v.record.yes + v.record.no, 0);
  const dist = new Map<number, number>();
  for (const v of vs) dist.set(v.record.yes, (dist.get(v.record.yes) ?? 0) + 1);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return [...head, ...body, '',
    `안건 ${n}건: 가결 ${passed} · 부결 ${n - passed} (가결률 ${pct(passed / n)}, 플레이어 구단도 AI처럼 표를 낼 때). `
    + `플레이어 구단이 늘 반대(표 없음)일 때 가결률 ${pct(vs.reduce((a, v) => a + v.passIfNo, 0) / voters)} (구단마다 플레이어로 놓고 평균). `
    + `결정표 비율 ${pct(vs.reduce((a, v) => a + v.decisive, 0) / voters)} (구단마다 플레이어로 놓고 평균), 결정표가 한 구단이라도 있는 안건 ${vs.filter((v) => v.decisive > 0).length}건. `
    + `AI 찬성 수 분포: ${[...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}곳 ${c}건`).join(', ')}.`, ''].join('\n');
}

async function main(): Promise<void> {
  installCalCache(); // 환경 맞춤 디스크 캐시 (tools/calCache.ts): 같은 코드·시드로 다시 돌리면 해마다 예비 시즌을 건너뛴다
  const start = Number(arg('start') ?? 2026);
  const n = Number(arg('seasons') ?? 20);
  const seeds = (arg('seeds') ?? 'longsim').split(',');
  const params: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: Number(arg('pilot') ?? DEFAULT_PARAMS.pilotSeasons) };
  const out = arg('out');
  const voteDump = arg('vote-dump');
  const allRows: YearMetrics[] = [];
  const dump: unknown[] = [];
  const store = loadDataStore();
  const real = realSpread(store, 2010, 2026).summary;
  const spreads: string[] = [];
  const parts: string[] = [`# 장기 시뮬레이션 (${start}년부터 ${n}시즌)\n`, `만든 날: ${new Date().toISOString().slice(0, 10)}. 도구: \`npx tsx tools/longsim.ts\`. 모든 구단 AI.\n`];
  for (const seed of seeds) {
    const t0 = Date.now();
    const { league } = createLeague(store, start, seed, params);
    const rows: YearMetrics[] = [];
    for (let i = 0; i < n; i++) {
      const { m } = runYear(league, store, params);
      rows.push(m);
      console.log(`[${seed}] ${m.year}: 득점 ${m.runs.toFixed(2)}, cal 홈런 ${m.cal.hr.toFixed(2)}, SD ${m.sd.toFixed(3)}, 은퇴 ${m.retired}, 복무 ${m.serving}, 실존 ${(m.realPa * 100).toFixed(0)}%, 구체적 사건(실존) ${m.specificOnReal}`);
    }
    parts.push(`## 시드 ${seed} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`, table(rows), '', '### 단장 회의 (구단 투표)\n', voteSection(rows));
    allRows.push(...rows);
    dump.push(...rows.flatMap((r) => r.votes.map((v) => ({ seed, ...v }))));
    // 공·타격 퍼짐: 시즌 반발계수를 쓰는 해(2027~)만, 실제 2010~2026과 나란히
    const fut = rows.filter((r) => r.year >= 2027);
    if (fut.length) {
      const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];
      spreads.push(spreadLine(`게임 ${seed} ${fut[0].year}~${fut.at(-1)!.year}`, {
        hrPa: range(fut.map((r) => r.ball.hrPa)), hrPaSd: sdOf(fut.map((r) => r.ball.hrPa)), era: range(fut.map((r) => r.ball.era)), eraSd: sdOf(fut.map((r) => r.ball.era)),
        topHr: range(fut.map((r) => r.ball.topHr)), subTwo: range(fut.map((r) => r.ball.subTwo)),
      }));
    }
    const shifts = league.ruleShifts ?? [];
    if (shifts.length || league.year > 2028) {
      const runs = rows.filter((r) => r.year >= 2028).map((r) => r.runs);
      const keys = Object.keys(FUTURE_RULE_SPEC) as FutureRuleKey[];
      const last = (k: FutureRuleKey) => shifts.filter((s) => s.key === k).at(-1)?.after ?? FUTURE_RULE_SPEC[k].base;
      parts.push(`미래 규칙 변경 ② ${shifts.length}번: ${keys.map((k) => `${k} ${shifts.filter((s) => s.key === k).length}`).join(', ')}. ` +
        `마지막 값: ${keys.map((k) => `${k} ${futureValueText(k, last(k))}`).join(', ')}. ` +
        (runs.length ? `2028년부터 득점 ${Math.min(...runs).toFixed(2)}~${Math.max(...runs).toFixed(2)}.` : ''), '');
    }
  }
  if (spreads.length) parts.push('## 공·타격 퍼짐 (실제와 나란히)\n', SPREAD_HEAD, spreadLine(`실제 ${real.from}~${real.to}`, real), ...spreads, '');
  if (seeds.length > 1) parts.push(`## 단장 회의 전체 (시드 ${seeds.join('·')})\n`, voteSection(allRows));
  if (voteDump) {
    mkdirSync(dirname(voteDump), { recursive: true });
    writeFileSync(voteDump, JSON.stringify(dump));
  }
  const text = parts.join('\n');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(`${out}에 썼습니다.`);
  } else {
    console.log(text);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/longsim.ts')) void main();
