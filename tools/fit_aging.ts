// 노화 곡선 추정 (M6).
//
// 사용법:  npx tsx tools/fit_aging.ts > reports/aging-fit.txt
//
// 1. 델타 방식: 같은 선수의 연속된 두 시즌(둘 다 100타석·상대 타자 100명 이상)을 짝지어,
//    사건별 리그 대비 비율의 로그 변화를 "두 번째 시즌 나이"별로 평균한다 (가중치는 두 표본의 조화평균).
//    외국인과 진행 중 시즌은 뺀다. 이웃 나이와 1:2:1로 다듬는다.
//    알려진 한계: 계속 뛴 선수만 짝이 되므로(생존 편향) 하락을 실제보다 작게 잡는다. 그래서 2단계에서 배율을 맞춘다.
// 2. 예측 시험: 직전 3시즌으로 그 해 비율을 예측할 때(ratings.ts와 같은 식) 노화 보정에 배율 α를 곱해 넣고,
//    실제 비율과의 가중 제곱 오차가 가장 작은 α를 찾는다. α = 0이 보정 없음.
// 3. 런 환산: 리그 평균 주전이 한 해 나이 들 때 기여가 얼마나 바뀌는지 (성장 판정의 31세 이후 하락에 쓴다).
//
// 2026-10-08 결과: 능력 산출에 넣어도 예측 오차가 타자 -0.06%(α=0.5), 투수는 오히려 나빠져서 능력 산출에는 넣지 않았다.
// 3의 런 변화 중 31~35세 값을 ai/value.ts의 agingDelta에 옮겼다 (36세 이상은 생존 편향이 커서 임시값 유지).

import { loadDataStore } from '../src/data/loadNode';
import type { BatRow, PitRow, Rates, SeasonData } from '../src/data/types';
import { batSkillFrom, DEFAULT_PARAMS, pitSkillFrom } from '../src/engine';
import { LINEAR_WEIGHTS } from '../src/engine/ratings';

const store = loadDataStore();
const { meta, players } = store;
const MIN_AGE = 20;
const MAX_AGE = 40;
const MIN_N = 100;
const BAT_EV = ['so', 'bb', 'hbp', 'hr', 's1', 'd2', 't3'] as const;
const PIT_EV = ['so', 'bb', 'hbp', 'hr', 'hit'] as const;
type BatEv = (typeof BAT_EV)[number];
type PitEv = (typeof PIT_EV)[number];

const seasons = new Map<number, SeasonData>();
for (const y of meta.years) {
  const s = store.season(y);
  if (s && s.complete) seasons.set(y, s);
}

const batCount = (r: BatRow, e: BatEv): number | null =>
  e === 's1' ? r.h - r.d - r.t - r.hr : e === 'd2' ? r.d : e === 't3' ? r.t : (r[e] as number | null);
const pitCount = (r: PitRow, e: PitEv): number => (e === 'hit' ? r.h - r.hr : r[e]);
const lgRate = (lg: Rates, e: BatEv | PitEv): number => (e === 'hit' ? lg.s1 + lg.d2 + lg.t3 : lg[e as keyof Rates]);

function ageOf(id: string, year: number): number | null {
  const m = players.get(id);
  if (!m?.birthYear || m.foreign) return null;
  return Math.min(MAX_AGE, Math.max(MIN_AGE, year - m.birthYear));
}

/** 나이별 사건별 로그 변화 (한 해 동안, 그 나이가 된 해 기준) */
function deltas<E extends string, R>(events: readonly E[], rows: (s: SeasonData) => Map<string, R>, n: (r: R) => number,
                                     count: (r: R, e: E) => number | null, skip: (id: string) => boolean): Record<E, number[]> {
  const sum = Object.fromEntries(events.map((e) => [e, new Array(MAX_AGE + 1).fill(0)])) as Record<E, number[]>;
  const wsum = Object.fromEntries(events.map((e) => [e, new Array(MAX_AGE + 1).fill(0)])) as Record<E, number[]>;
  for (const [y, s] of seasons) {
    const prev = seasons.get(y - 1);
    if (!prev) continue;
    const a = rows(prev);
    for (const [id, r2] of rows(s)) {
      const r1 = a.get(id);
      if (!r1 || skip(id)) continue;
      const age = ageOf(id, y);
      if (age === null) continue;
      const n1 = n(r1);
      const n2 = n(r2);
      if (n1 < MIN_N || n2 < MIN_N) continue;
      const w = (2 * n1 * n2) / (n1 + n2);
      for (const e of events) {
        const c1 = count(r1, e);
        const c2 = count(r2, e);
        if (c1 === null || c2 === null) continue;
        // 0회를 피하려고 0.5회를 더한다
        const v1 = (c1 + 0.5) / n1 / lgRate(prev.league.rates, e as BatEv);
        const v2 = (c2 + 0.5) / n2 / lgRate(s.league.rates, e as BatEv);
        sum[e][age] += w * Math.log(v2 / v1);
        wsum[e][age] += w;
      }
    }
  }
  const out = {} as Record<E, number[]>;
  for (const e of events) {
    const raw = sum[e].map((v, i) => (wsum[e][i] > 0 ? v / wsum[e][i] : 0));
    const sm = raw.map((_, i) => {
      if (i < MIN_AGE + 1) return raw[i];
      const lo = Math.max(MIN_AGE + 1, i - 1);
      const hi = Math.min(MAX_AGE, i + 1);
      let s = 0;
      let w = 0;
      for (let k = lo; k <= hi; k++) {
        const kw = (k === i ? 2 : 1) * wsum[e][k];
        s += kw * raw[k];
        w += kw;
      }
      return w > 0 ? s / w : 0;
    });
    out[e] = sm.map((v) => Math.round(v * 10000) / 10000);
  }
  return out;
}

const batMap = (s: SeasonData) => new Map(s.bat.map((r) => [r.id, r]));
const pitMap = (s: SeasonData) => new Map(s.pit.map((r) => [r.id, r]));
const isPitcher = (id: string) => players.get(id)?.kind === 'P';
const BAT = deltas(BAT_EV, batMap, (r: BatRow) => r.pa, batCount, isPitcher);
const PIT = deltas(PIT_EV, pitMap, (r: PitRow) => r.tbf, pitCount, () => false);

/** from살 → to살 동안의 누적 로그 변화 */
function cumulative(table: number[], from: number, to: number): number {
  let s = 0;
  const a = Math.min(MAX_AGE, Math.max(MIN_AGE, from));
  const b = Math.min(MAX_AGE + 5, Math.max(MIN_AGE, to));
  if (b > a) for (let k = a + 1; k <= b; k++) s += table[Math.min(MAX_AGE, k)];
  else for (let k = b + 1; k <= a; k++) s -= table[Math.min(MAX_AGE, k)];
  return s;
}

// ---- 2. 예측 시험
interface Case { target: number; n: number; rows: { row: BatRow | PitRow; w: number; lg: Rates; age: number }[]; actual: Record<string, number>; age: number }

function cases(kind: 'bat' | 'pit'): Case[] {
  const out: Case[] = [];
  for (const [y, s] of seasons) {
    if (y < 1990) continue;
    const list = kind === 'bat' ? s.bat : s.pit;
    for (const r of list) {
      const n = kind === 'bat' ? (r as BatRow).pa : (r as PitRow).tbf;
      if (n < MIN_N || (kind === 'bat' && isPitcher(r.id))) continue;
      const age = ageOf(r.id, y);
      if (age === null) continue;
      const rows: Case['rows'] = [];
      for (let i = 0; i < 3; i++) {
        const h = seasons.get(y - 1 - i);
        const hr = h && (kind === 'bat' ? h.bat : h.pit).find((x) => x.id === r.id);
        if (h && hr) rows.push({ row: hr, w: DEFAULT_PARAMS.seasonWeights[i], lg: h.league.rates, age: age - 1 - i });
      }
      if (!rows.length) continue;
      const actual: Record<string, number> = {};
      for (const e of kind === 'bat' ? BAT_EV : PIT_EV) {
        const c = kind === 'bat' ? batCount(r as BatRow, e as BatEv) : pitCount(r as PitRow, e as PitEv);
        if (c !== null) actual[e] = c / n / lgRate(s.league.rates, e);
      }
      out.push({ target: y, n, rows, actual, age });
    }
  }
  return out;
}

function predictError(kind: 'bat' | 'pit', cs: Case[], alpha: number): Record<string, number> {
  const events = kind === 'bat' ? BAT_EV : PIT_EV;
  const table = (kind === 'bat' ? BAT : PIT) as Record<string, number[]>;
  const err: Record<string, number> = {};
  const wsum: Record<string, number> = {};
  for (const c of cs) {
    const rows = c.rows.map((x) => ({
      row: x.row, w: x.w, lg: x.lg,
      aging: Object.fromEntries(events.map((e) => [e, Math.exp(alpha * cumulative(table[e], x.age, c.age))])),
    }));
    const skill = kind === 'bat'
      ? batSkillFrom(rows as never, meta.priors.batter, DEFAULT_PARAMS)
      : pitSkillFrom(rows as never, meta.priors.pitcher, DEFAULT_PARAMS);
    for (const e of events) {
      if (c.actual[e] === undefined) continue;
      const d = (skill as unknown as Record<string, number>)[e] - c.actual[e];
      err[e] = (err[e] ?? 0) + c.n * d * d;
      wsum[e] = (wsum[e] ?? 0) + c.n;
    }
  }
  for (const e of Object.keys(err)) err[e] /= wsum[e];
  return err;
}

/** 리그 평균 주전 기준 런 변화 (한 해) */
function runsPerYear(age: number, alpha: number): { bat: number; pit: number } {
  const lg = seasons.get(2025)!.league.rates;
  const f = (t: Record<string, number[]>, e: string) => Math.exp(alpha * t[e][Math.min(MAX_AGE, age)]) - 1;
  const W = LINEAR_WEIGHTS;
  const bat = (W.bb * lg.bb * f(BAT, 'bb') + W.hbp * lg.hbp * f(BAT, 'hbp') + W.s1 * lg.s1 * f(BAT, 's1') + W.d2 * lg.d2 * f(BAT, 'd2')
    + W.t3 * lg.t3 * f(BAT, 't3') + W.hr * lg.hr * f(BAT, 'hr')) / 1.2 * 600;
  // 투수: 피안타·피홈런·볼넷이 늘면 손해, 삼진이 늘면 인플레이 타구가 줄어 이득. 선발 650명 상대 기준
  const hitV = W.s1 * lg.s1 + W.d2 * lg.d2 + W.t3 * lg.t3;
  const pit = -(W.bb * lg.bb * f(PIT, 'bb') + W.hbp * lg.hbp * f(PIT, 'hbp') + hitV * f(PIT, 'hit') + W.hr * lg.hr * f(PIT, 'hr')
    - hitV * lg.so * 0.9 * f(PIT, 'so')) / 1.2 * 650;
  return { bat: Math.round(bat * 10) / 10, pit: Math.round(pit * 10) / 10 };
}

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const GRID = [0, 0.5, 1, 1.25, 1.5, 1.75, 2, 2.5];
const best: Record<'bat' | 'pit', number> = { bat: 0, pit: 0 };
for (const kind of ['bat', 'pit'] as const) {
  const cs = cases(kind);
  console.log(`\n## ${kind === 'bat' ? '타자' : '투수'} 예측 오차 (${cs.length}건, 1990년 이후)`);
  let bestErr = Infinity;
  const base = total(predictError(kind, cs, 0));
  for (const a of GRID) {
    const e = total(predictError(kind, cs, a));
    console.log(`α=${a}: 오차 합 ${e.toFixed(5)} (보정 없음 대비 ${(((e - base) / base) * 100).toFixed(2)}%)`);
    if (e < bestErr) {
      bestErr = e;
      best[kind] = a;
    }
  }
}

console.log('\n## 나이별 한 해 변화 (로그, 다듬은 값)');
console.log('나이 | ' + BAT_EV.map((e) => `타${e}`).join(' ') + ' | ' + PIT_EV.map((e) => `투${e}`).join(' ') + ' | 런(타,투)');
const runs: { bat: number[]; pit: number[] } = { bat: [], pit: [] };
for (let a = MIN_AGE + 1; a <= MAX_AGE; a++) {
  const r = runsPerYear(a, 1);
  runs.bat[a] = r.bat;
  runs.pit[a] = r.pit;
  console.log(`${a} | ${BAT_EV.map((e) => BAT[e][a].toFixed(3)).join(' ')} | ${PIT_EV.map((e) => PIT[e][a].toFixed(3)).join(' ')} | ${r.bat}, ${r.pit}`);
}
console.log(`\n가장 좋은 배율: 타자 α=${best.bat}, 투수 α=${best.pit}`);
