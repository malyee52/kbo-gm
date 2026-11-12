// 코치 연봉·단장 평판 측정 (2026-11-12 사용자 그릴 Q37·Q38, 카드 '코치 연봉·평판 효과·감독 스타일').
// tools/nominal_measure.ts(브랜치 measure/nominal-content)의 session 갈래를 줄여 가져왔다. 게임 규칙·값은 바꾸지 않는다.
//
// 갈래 (--part):
//   session  GameSession 장기 진행: 플레이어 자리 구단(기본 LG)도 AI 판단 그대로(FA는 AI 규칙, 이벤트는 첫 선택지 자동) N시즌.
//            해마다 모든 구단 코치 등급·연봉, 자금·긴급 지원, 평판 값과 그 해 항목, 순위·가을야구, FA 요구액 상위 15명,
//            선수별 성장(개막 → 다음 개막, 같은 구단에 남은 선수)과 상위 25명 안 여부를 JSONL로 쓴다.
//   report   session 결과 여러 개(전 → 후)를 모아 표를 쓴다. 성장이 같은 구단 상위 25명 안에 남는 햇수(지속 K)와
//            2군 유망주 성장이 나중에 1군 몫이 되는 햇수(K_dev)를 재고, 평판 식을 오프라인으로 다시 돌려 본 값도 함께.
//
// 실행 (무거운 갈래는 heavy2.sh로 하나씩):
//   npx tsx tools/coach_rep_measure.ts --part session --seed cr-a --seasons 50 --team LG --out reports/tmp/coachrep-before-cr-a.jsonl
//   npx tsx tools/coach_rep_measure.ts --part report --before reports/tmp/coachrep-before-cr-a.jsonl,... --after reports/tmp/coachrep-after-cr-a.jsonl,...
//        --out reports/coach-rep.md

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { COACH_ROLES } from '../src/league/coaches';
import { cashOf } from '../src/league/finance';
import { runsOf } from '../src/league/growth';
import { valueContext } from '../src/ai/value';
import { REP, REP_FA, REP_TRADE, REP_START } from '../src/league/reputation';
import { wageIndex } from '../src/league/salary';
import { installCalCache } from './calCache';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const part = arg('part', 'report')!;
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

interface PlayerRec { id: string; t: number; pit: boolean; gain: number; runs: number; top: boolean; fut: boolean }
interface YearRec {
  seed: string; year: number; team: number; teams: number; wage: number;
  coaches: { lv: number; sal: number }[][];
  coachPay: number[]; cash: number[]; rescued: number; zero: number;
  rep: number; repParts: { d: number; r: string }[];
  wins: number[]; losses: number[]; standings: number[]; post: number[]; seriesWon: number[]; champion: number | null;
  faAsks: number[];
  players: PlayerRec[];
}

async function partSession(): Promise<void> {
  installCalCache();
  const store = loadDataStore();
  const seed = arg('seed', 'cr-a')!;
  const n = Number(arg('seasons', '50'));
  const team = arg('team', 'LG')!;
  const out = arg('out') ?? `reports/tmp/coachrep-${seed}.jsonl`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, '');
  const teamIdx0 = store.season(2026)!.teams.findIndex((t) => t.name === team);
  const g = GameSession.create(store, { year: 2026, teamIdx: teamIdx0, seed, difficulty: 'normal' }, FAST);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const L = g.league;
    const year = g.year;
    const T = g.world.teams.length;
    const ctx0 = valueContext(g.world);
    const before = new Map(L.players.filter((p) => p.team >= 0 && p.team < T).map((p) => [p.id, { team: p.team, pit: !!p.isPitcher, runs: runsOf(p, ctx0, year) }]));
    g.advance(100000);
    const s = g.season;
    const st = s.standings();
    // 1군 출전량 (offseason.ts firstTeam 근사: 타자 타석 ÷ 550, 투수 상대 타자 ÷ 450)
    const firstTeam = new Map<string, number>();
    for (const p of g.world.players) {
      const b = s.bat[p.idx];
      const q = s.pit[p.idx];
      firstTeam.set(p.id, p.isPitcher ? (q?.bf ?? 0) / 450 : (b?.pa ?? 0) / 550);
    }
    const wins = s.teams.map((x) => x.w);
    const losses = s.teams.map((x) => x.l);
    const repLen = L.reputation?.log.length ?? 0;
    const repBefore = L.reputation?.value ?? REP_START;

    g.beginOffseason();
    const L2 = g.league;
    // 이번 해 평판 항목: 로그는 30개까지만 남으니 해마다 바로 읽는다
    const log = L2.reputation?.log ?? [];
    const repParts = log.filter((x) => x.year === year).map((x) => ({ d: x.delta, r: x.reason }));
    void repLen; void repBefore;
    const ps = L2.lastSeason?.postseason;
    const post = ps ? [...new Set(ps.series.flatMap((x) => [x.high, x.low]))] : [];
    const seriesWon = Array.from({ length: T }, (_, t) => (ps?.series ?? []).filter((x) => x.winner === t).length);
    const champion = ps?.champion ?? null;
    let k = 0;
    let faAsks: number[] = [];
    while (g.offseason!.stage !== 'ready' && k++ < 60) {
      const stg = g.offseason!.stage;
      if (stg === 'draft') g.autoDraft();
      if (stg === 'comp') g.autoComp();
      if (stg === 'release') g.autoRelease();
      if (stg === 'fa') faAsks = (g.offseason!.fa?.entries ?? []).filter((e) => !e.returnee).map((e) => e.ask).sort((a, b) => b - a).slice(0, 15);
      g.offseason!.userTeam = stg === 'fa' ? -1 : g.teamIdx;
      const r = g.nextStage();
      if (!r.ok && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
    }
    g.offseason!.userTeam = g.teamIdx;
    const o = g.openNextSeason();
    if (!o.ok) throw new Error(o.message);
    const L3 = g.league;
    // 개막 때 코치진 (closeOffseason이 빈자리를 채운 뒤)
    const coaches = Array.from({ length: T }, (_, t) => COACH_ROLES.map((r) => {
      const c = L3.coaches?.[t]?.find((x) => x.role === r);
      return { lv: c?.level ?? 0, sal: c?.salary ?? 0 };
    }));
    const coachPay = coaches.map((cs) => cs.reduce((a, c) => a + c.sal, 0));
    const cash = Array.from({ length: T }, (_, t) => cashOf(L3, t));
    const hist = Array.from({ length: T }, (_, t) => L3.finance?.[t]?.history.find((h) => h.year === year));
    const rescued = hist.filter((h) => (h?.rescue ?? 0) > 0).length;
    const zero = cash.filter((c) => c <= 0).length;
    const ctx1 = valueContext(g.world);
    const players: PlayerRec[] = [];
    const now = new Map<string, number>();
    for (const p of L3.players) if (p.team >= 0 && p.team < T) now.set(p.id, runsOf(p, ctx1, g.year));
    for (let t = 0; t < T; t++) {
      const mine = L3.players.filter((p) => p.team === t);
      const top = new Set(mine.map((p) => ({ id: p.id, r: now.get(p.id) ?? 0 })).sort((a, b) => b.r - a.r).slice(0, 25).map((x) => x.id));
      for (const p of mine) {
        const b = before.get(p.id);
        const gain = b && b.team === t ? (now.get(p.id) ?? 0) - b.runs : 0;
        players.push({ id: p.id, t, pit: !!p.isPitcher, gain: Math.round(gain * 100) / 100, runs: Math.round((now.get(p.id) ?? 0) * 10) / 10,
          top: top.has(p.id), fut: b ? (firstTeam.get(p.id) ?? 0) < 0.5 : false });
      }
    }
    const rec: YearRec = {
      seed, year, team: g.teamIdx, teams: T, wage: wageIndex(g.year, L3),
      coaches, coachPay, cash, rescued, zero, rep: L2.reputation?.value ?? REP_START, repParts,
      wins, losses, standings: st, post, seriesWon, champion, faAsks, players,
    };
    appendFileSync(out, JSON.stringify(rec) + '\n');
    console.log(`[${seed}] ${year} 평판 ${rec.rep} 코치 등급 ${coaches[g.teamIdx].map((c) => c.lv).join('')} 자금 평균 ${(cash.reduce((a, b) => a + b, 0) / T / 10000).toFixed(0)}억 긴급 ${rescued} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  }
}

// ---------------------------------------------------------------- report

const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const eok = (man: number, d = 1) => f1(man / 10000, d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const read = (paths: string) => paths.split(',').filter(Boolean).map((p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as YearRec));

/** 성장 지속: 그 해 오른 몫(같은 구단)이 그 뒤 H년 안에 같은 구단 상위 25명으로 남은 햇수 (오른 몫 가중 평균). fut = 2군 유망주만 */
function persistence(runs: YearRec[], fut: boolean, H = 6): { k: number; gainPerTeam: number } {
  const byYear = runs.map((r) => new Map(r.players.map((p) => [p.id, p])));
  let w = 0;
  let wk = 0;
  let gainSum = 0;
  let teamYears = 0;
  for (let i = 0; i + H < runs.length; i++) {
    teamYears += runs[i].teams;
    for (const p of runs[i].players) {
      if (p.gain <= 0 || p.fut !== fut || (!fut && !p.top)) continue;
      let yrs = 0;
      for (let h = 0; h < H; h++) {
        const q = byYear[i + h].get(p.id);
        if (!q || q.t !== p.t) break;
        if (q.top) yrs++;
      }
      w += p.gain;
      wk += p.gain * yrs;
      gainSum += p.gain;
    }
  }
  return { k: w ? wk / w : NaN, gainPerTeam: teamYears ? gainSum / teamYears : NaN };
}

/** 평판 식을 오프라인으로 다시 돌린다: 그 해 항목(지금 식으로 낸 값)을 새 배율로 바꿔 더하고 revert */
function replayRep(recs: YearRec[], scale: (reason: string, d: number) => number, revert: number, start = REP_START): number[] {
  let v = start;
  const out: number[] = [];
  for (const r of recs) {
    for (const x of r.repParts) if (x.r !== '시간이 지나며 무뎌짐') v += scale(x.r, x.d);
    v = Math.max(0, Math.min(100, v + (50 - v) * revert));
    out.push(v);
  }
  return out;
}

async function partReport(): Promise<void> {
  const B = read(arg('before', '')!);
  const A = read(arg('after', '') ?? '');
  const P: string[] = ['# 코치 연봉·단장 평판 측정 (2026-11-12)', '',
    '도구: `tools/coach_rep_measure.ts`. 세션: 2026 시작, 플레이어 자리 LG (AI가 운영, FA는 AI 규칙, 이벤트는 첫 선택지 자동). 금액은 장부 그대로(그 해 연봉 지수가 곱해진 값)이고 ÷지수는 2026년 돈.', ''];
  const sets: [string, YearRec[][]][] = [['전', B], ...(A.length ? [['후', A] as [string, YearRec[][]]] : [])];

  // 1. 성장 지속
  P.push('## 1. 성장 지속 (코치 값 셈의 재료)', '', '| 판 | 시드 | 상위 25명 오른 몫 (구단·해, 런) | 지속 K (해) | 2군 유망주 오른 몫 (구단·해, 런) | 유망주 지속 K_dev (해) |', '|---|---|---|---|---|---|');
  for (const [name, runs] of sets) for (const r of runs) {
    const a = persistence(r, false);
    const d = persistence(r, true);
    P.push(`| ${name} | ${r[0].seed} | ${f1(a.gainPerTeam)} | ${f1(a.k, 2)} | ${f1(d.gainPerTeam)} | ${f1(d.k, 2)} |`);
  }
  P.push('');

  // 2. 코치 등급 분포·연봉
  P.push('## 2. 코치 등급 분포 (개막 때, 0 = 빈자리)', '', '| 판 | 자리 | 0 | 1 | 2 | 3 | 4 | 5 | 평균 등급 | 코치 연봉 합 평균 (억, ÷지수) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, runs] of sets) {
    const all = runs.flat();
    for (const who of ['플레이어', 'AI'] as const) {
      const lv: number[] = [];
      const pay: number[] = [];
      for (const r of all) for (let t = 0; t < r.teams; t++) {
        if ((who === '플레이어') !== (t === r.team)) continue;
        for (const c of r.coaches[t]) lv.push(c.lv);
        pay.push(r.coachPay[t] / r.wage);
      }
      const share = (x: number) => `${f1((lv.filter((v) => v === x).length / lv.length) * 100, 0)}%`;
      P.push(`| ${name} | ${who} | ${[0, 1, 2, 3, 4, 5].map(share).join(' | ')} | ${f1(mean(lv), 2)} | ${eok(mean(pay))} |`);
    }
  }
  P.push('');

  // 3. 재정 균형
  P.push('## 3. 재정 균형 (개막 때, 구단 평균)', '', '| 판 | 시드 | 자금 평균 (억, ÷지수) | 자금 최소 10% (억) | 자금 0 이하 (구단·해) | 긴급 지원 (구단·해) |', '|---|---|---|---|---|---|');
  for (const [name, runs] of sets) for (const r of runs) {
    const cash = r.flatMap((y) => y.cash.map((c) => c / y.wage));
    P.push(`| ${name} | ${r[0].seed} | ${eok(mean(cash))} | ${eok(pct(cash, 0.1))} | ${f1(mean(r.map((y) => y.zero)), 2)} | ${f1(mean(r.map((y) => y.rescued)), 2)} |`);
  }
  P.push('');

  // 4. 평판
  P.push('## 4. 단장 평판 (플레이어 자리, 결산 뒤)', '', '| 판 | 시드 | 평균 | 10% | 90% | 최소 | 최대 | 70 이상 (해) | 30 미만 (해) |', '|---|---|---|---|---|---|---|---|---|');
  for (const [name, runs] of sets) for (const r of runs) {
    const v = r.map((y) => y.rep);
    P.push(`| ${name} | ${r[0].seed} | ${f1(mean(v))} | ${f1(pct(v, 0.1))} | ${f1(pct(v, 0.9))} | ${f1(Math.min(...v))} | ${f1(Math.max(...v))} | ${v.filter((x) => x >= 70).length} | ${v.filter((x) => x < 30).length} |`);
  }
  P.push('');
  // 항목별 해마다 평균
  const kinds = (reason: string) => reason.startsWith('승률') ? '승률' : reason.startsWith('가을야구 진출') ? '가을야구 진출' : reason.includes('시리즈 승리') ? '시리즈 승리' : reason.startsWith('업적') ? '업적' : reason;
  P.push('### 평판 항목별 해마다 평균 (플레이어 자리)', '', '| 판 | 항목 | 해마다 평균 | 나온 해 비율 |', '|---|---|---|---|');
  for (const [name, runs] of sets) {
    const all = runs.flat();
    const m = new Map<string, { s: number; n: number }>();
    for (const y of all) for (const x of y.repParts) { const k = kinds(x.r); const e = m.get(k) ?? { s: 0, n: 0 }; e.s += x.d; e.n++; m.set(k, e); }
    for (const [k, e] of [...m].sort((a, b) => a[1].s - b[1].s)) P.push(`| ${name} | ${k} | ${f1(e.s / all.length, 2)} | ${f1((e.n / all.length) * 100, 0)}% |`);
  }
  P.push('');

  // 5. 효과 크기
  P.push('## 5. 평판 효과 (FA 요구액 상위 15명 평균, 전 판 값으로 셈)', '');
  const asks = B.flat().map((y) => mean(y.faAsks) / y.wage).filter(Number.isFinite);
  const top = B.flat().map((y) => (y.faAsks[0] ?? NaN) / y.wage).filter(Number.isFinite);
  P.push(`FA 요구액 상위 15명 평균 ${eok(mean(asks), 2)}억, 최고 평균 ${eok(mean(top), 2)}억 (2026년 돈). 평판 100 대비 0의 요구 배율 차는 지금 식 ±${REP_FA * 100}%, 트레이드 호의 ±${REP_TRADE}런.`, '');
  P.push(`평판 식 지금 값: 승률 ×${REP.winPct}, 가을야구 +${REP.postseason}, 시리즈 +${REP.series}, 우승 +${REP.champion}, 목표 +${REP.goalMet}/${REP.goalMissed}, 캡 ${REP.capOver}, 긴급 ${REP.rescue}, 해고 ${REP.fired}, 해마다 50 쪽 ${REP.revert * 100}%.`, '');
  writeFileSync(arg('out', 'reports/coach-rep.md')!, P.join('\n') + '\n');
  console.log(`${arg('out', 'reports/coach-rep.md')}에 썼습니다.`);
}

export { replayRep };

if (part === 'session') await partSession();
else await partReport();
