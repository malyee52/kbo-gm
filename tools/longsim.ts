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
import { salaryCap, teamCapPayroll } from '../src/league/salary';

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
}

/** 리그 상태에서 한 시즌을 돌리고 오프시즌을 AI로 끝까지 진행한다 */
export function runYear(league: LeagueState, store: ReturnType<typeof loadDataStore>, params: EngineParams): { m: YearMetrics; world: World } {
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

  const off = Off.beginOffseason(league, world, season, store, -1, params);
  let guard = 0;
  while (off.stage !== 'ready' && guard++ < 50) Off.advanceStage(league, off, store, params);
  if (off.stage !== 'ready') throw new Error(`${league.year} 오프시즌이 끝나지 않았습니다 (단계 ${off.stage})`);
  const retiredNow = (league.retired ?? []).filter((r) => r.year === off.year).length;
  const faEntries = (off.fa?.entries ?? []).filter((e) => !e.returnee);
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
    },
  };
}

function table(rows: YearMetrics[]): string {
  const f = (x: number, d = 2) => x.toFixed(d);
  const head = '| 연도 | 득점 | cal 단타·홈런·볼넷·삼진 | 승률SD | 최다·최소승 | 월드 인원 | 소속 최대 | 나이 타·투 | 최고령 | 실존 타석 | 부상(큰) | 이벤트(구체) | 은퇴 | 복무 | 주전 기여 | FA 신청·이적·보상선수 | 다음 해 캡 초과·하한 미달·사용률 |';
  const sep = '|' + '---|'.repeat(17);
  const body = rows.map((r) => `| ${r.year} | ${f(r.runs)} | ${f(r.cal.s1)} ${f(r.cal.hr)} ${f(r.cal.bb)} ${f(r.cal.so)} | ${f(r.sd, 3)} | ${r.maxW}·${r.minW} | ${r.orgMin}~${r.orgMax} | ${r.players} | ${f(r.ageBat, 1)}·${f(r.agePit, 1)} | ${r.maxAge} | ${f(r.realPa * 100, 0)}% | ${r.injuries}(${r.majors}) | ${r.events}(${r.specific}) | ${r.retired} | ${r.serving} | ${f(r.core, 0)} | ${r.fa.filed}·${r.fa.moved}·${r.fa.compPlayers} | ${r.cap ? `${r.cap.over}·${r.cap.short}·${f(r.cap.use * 100, 0)}%` : '-'} |`);
  return [head, sep, ...body].join('\n');
}

async function main(): Promise<void> {
  const start = Number(arg('start') ?? 2026);
  const n = Number(arg('seasons') ?? 20);
  const seeds = (arg('seeds') ?? 'longsim').split(',');
  const params: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: Number(arg('pilot') ?? DEFAULT_PARAMS.pilotSeasons) };
  const out = arg('out');
  const store = loadDataStore();
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
    parts.push(`## 시드 ${seed} (${((Date.now() - t0) / 1000).toFixed(0)}초)\n`, table(rows), '');
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
