// 볼카운트 사슬 능력 맞춤 (능력치 v2 16-1, docs/능력치v2_기획안.md 1.7·1.8·1.12·9.1·9.6·11.2).
// 읽는 것: data-src/pbp_derived/count_zone.csv·batter_plate.csv·pitcher_plate.csv (tools/pbp_plate.py), 게임 시즌 자료.
// 하는 것:
//   1. 리그 칸 × 존 비율 (2023~2025 합) → params.plate.split
//   2. 구위의 존 밖 유인 몫 alpha (투수 존 밖 스윙 로짓 차를 구위·제구로 회귀)
//   3. 능력별 당김 상수 (해 사이 공분산으로 참 퍼짐 τ², 당김 = 1 ÷ (τ² × p(1 − p)) 공) → params.plate.regress
//   4. 2022년 이전 짐작 식: 적극성(·선구·맞히기는 견줌용)을 시즌 기록으로 (200타석 이상, 타석 가중) → params.plate.aggFormula
//   5. 결과 기록으로 푼 선구·맞히기(엔진의 짐작 길)와 실측의 견줌
//   6. 등급 눈금: 중앙·중간폭(사분위 범위 ÷ 1.349)·볼록 a/b (11.2) → params.plate.grades
// 사용법:  npx tsx tools/fit_plate_estimate.ts [--out reports/plate-estimate.md]
// 출력: params.ts에 붙일 plate 코드(표준 출력)와 보고서
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import type { SeasonData } from '../src/data/types';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { plateContext } from '../src/engine/pa';
import { chainShapeFor } from '../src/engine/params';
import { aggEstimate, convex, convexInv, leaguePlate, plateChain, plateGrade, plateInputs, solveBat, solvePit, ZERO_BAT, ZERO_PIT } from '../src/engine/plate';
import { cellProbs, solveKnobs } from '../src/engine/chain';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outPath = arg('out') ?? 'reports/plate-estimate.md';
const FIT_YEARS = [2023, 2024, 2025];

function csv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf-8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}
const num = (r: Record<string, string>, k: string) => Number(r[k]);
const logit = (p: number) => Math.log(p / (1 - p));
/** 로짓 차 (반 개씩 더해 0·1을 피함) */
const dl = (obs: number, exp: number, n: number) => logit((obs + 0.5) / (n + 1)) - logit((exp + 0.5) / (n + 1));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const r5 = (x: number) => Math.round(x * 100000) / 100000;

// ---- 1. 리그 칸 × 존 비율 ----
const zone = csv('data-src/pbp_derived/count_zone.csv').filter((r) => FIT_YEARS.includes(num(r, 'year')) && r.zone !== 'na');
const split: number[][] = [];
const lgRate: Record<string, [number, number]> = {}; // 능력별 리그 비율 (당김 상수용) [합 obs, 합 n]
const add = (k: string, o: number, n: number) => { const a = (lgRate[k] ??= [0, 0]); a[0] += o; a[1] += n; };
for (let c = 0; c < 12; c++) {
  const rows = zone.filter((r) => num(r, 'balls') * 3 + num(r, 'strikes') === c);
  const z = (zn: string) => {
    const s = { take: 0, cs: 0, swing: 0, contact: 0, foul: 0, n: 0 };
    for (const r of rows.filter((x) => x.zone === zn)) {
      s.take += num(r, 'ball') + num(r, 'called_strike') + num(r, 'hbp');
      s.cs += num(r, 'called_strike');
      s.swing += num(r, 'swinging_strike') + num(r, 'foul') + num(r, 'in_play');
      s.contact += num(r, 'foul') + num(r, 'in_play');
      s.foul += num(r, 'foul');
    }
    s.n = s.take + s.swing;
    return s;
  };
  const i = z('in');
  const o = z('out');
  split.push([i.n / (i.n + o.n), i.swing / i.n, o.swing / o.n, i.contact / i.swing, o.contact / o.swing, i.foul / i.contact, o.foul / o.contact, i.cs / i.take, o.cs / o.take]);
  add('swIn', i.swing, i.n); add('swOut', o.swing, o.n); add('con', i.contact + o.contact, i.swing + o.swing);
  add('tough', i.foul + o.foul, i.contact + o.contact); add('ctl', i.n, i.n + o.n);
  if (c % 3 === 2) add('two', i.contact + o.contact, i.swing + o.swing);
}
lgRate.stuff = lgRate.con;
lgRate.eff = lgRate.tough;
const pOf = (k: string) => lgRate[k][0] / lgRate[k][1];

// ---- 선수-시즌 실측 ----
interface BatM { year: number; id: string; pa: number; nIn: number; nOut: number; sw: number; sw2: number; ct: number; dIn: number; dOut: number; con: number; two: number; tough: number }
interface PitM { year: number; id: string; bf: number; n: number; sw: number; ct: number; nOut: number; ctl: number; stuff: number; eff: number; swOut: number }
const bats: BatM[] = csv('data-src/pbp_derived/batter_plate.csv').map((r) => {
  const con = dl(num(r, 'contact'), num(r, 'exp_contact'), num(r, 'swings'));
  return {
    year: num(r, 'year'), id: r.id, pa: num(r, 'pa'), nIn: num(r, 'n_in'), nOut: num(r, 'n_out'), sw: num(r, 'swings'), sw2: num(r, 'swings_2s'), ct: num(r, 'contacts'),
    dIn: dl(num(r, 'sw_in'), num(r, 'exp_sw_in'), num(r, 'n_in')), dOut: dl(num(r, 'sw_out'), num(r, 'exp_sw_out'), num(r, 'n_out')), con,
    two: dl(num(r, 'contact_2s'), num(r, 'exp_contact_2s'), num(r, 'swings_2s')) - con,
    tough: dl(num(r, 'fouls'), num(r, 'exp_fouls'), num(r, 'contacts')),
  };
});
const pits: PitM[] = csv('data-src/pbp_derived/pitcher_plate.csv').map((r) => ({
  year: num(r, 'year'), id: r.id, bf: num(r, 'bf'), n: num(r, 'pitches'), sw: num(r, 'swings'), ct: num(r, 'contacts'), nOut: num(r, 'n_out'),
  ctl: dl(num(r, 'n_in'), num(r, 'exp_in'), num(r, 'pitches')), stuff: -dl(num(r, 'contact'), num(r, 'exp_contact'), num(r, 'swings')),
  eff: -dl(num(r, 'fouls'), num(r, 'exp_fouls'), num(r, 'contacts')), swOut: dl(num(r, 'sw_out'), num(r, 'exp_sw_out'), num(r, 'n_out')),
}));

/** 가중 최소제곱 (상수항 포함). 반환: 계수, R² */
function wls(X: number[][], y: number[], w: number[]): { b: number[]; r2: number } {
  const k = X[0].length + 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  X.forEach((x, i) => {
    const xx = [1, ...x];
    for (let a = 0; a < k; a++) {
      v[a] += w[i] * xx[a] * y[i];
      for (let b = 0; b < k; b++) A[a][b] += w[i] * xx[a] * xx[b];
    }
  });
  // 가우스 소거
  const M = A.map((row, i) => [...row, v[i]]);
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    [M[i], M[p]] = [M[p], M[i]];
    for (let j = i + 1; j < k; j++) { const f = M[j][i] / M[i][i]; for (let q = i; q <= k; q++) M[j][q] -= f * M[i][q]; }
  }
  const b = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) { let s = M[i][k]; for (let j = i + 1; j < k; j++) s -= M[i][j] * b[j]; b[i] = s / M[i][i]; }
  const W = w.reduce((a, c) => a + c, 0);
  const my = y.reduce((a, c, i) => a + w[i] * c, 0) / W;
  let ss = 0, sr = 0;
  X.forEach((x, i) => { const f = b[0] + x.reduce((a, c, j) => a + c * b[j + 1], 0); ss += w[i] * (y[i] - my) ** 2; sr += w[i] * (y[i] - f) ** 2; });
  return { b, r2: 1 - sr / ss };
}
function corr(a: number[], b: number[], w?: number[]): number {
  const ww = w ?? a.map(() => 1);
  const W = ww.reduce((s, c) => s + c, 0);
  const ma = a.reduce((s, c, i) => s + ww[i] * c, 0) / W;
  const mb = b.reduce((s, c, i) => s + ww[i] * c, 0) / W;
  let sab = 0, saa = 0, sbb = 0;
  a.forEach((_, i) => { sab += ww[i] * (a[i] - ma) * (b[i] - mb); saa += ww[i] * (a[i] - ma) ** 2; sbb += ww[i] * (b[i] - mb) ** 2; });
  return sab / Math.sqrt(saa * sbb);
}

// ---- 2. alpha: 투수 존 밖 스윙 로짓 차 ~ 구위 + 제구 (200타자 이상) ----
const pq = pits.filter((p) => p.bf >= 200 && FIT_YEARS.includes(p.year));
const aFit = wls(pq.map((p) => [p.stuff, p.ctl]), pq.map((p) => p.swOut), pq.map((p) => p.nOut));
const alpha = Math.max(0, aFit.b[1]);

// ---- 3. 당김 상수: 같은 선수 이어진 두 해의 공분산 = 참 퍼짐 τ² (두 해 모두 분모 100 이상) ----
type Comp = { key: string; side: 'bat' | 'pit'; val: (m: any) => number; n: (m: any) => number };
const COMPS: Comp[] = [
  { key: 'swIn', side: 'bat', val: (m: BatM) => m.dIn, n: (m: BatM) => m.nIn },
  { key: 'swOut', side: 'bat', val: (m: BatM) => m.dOut, n: (m: BatM) => m.nOut },
  { key: 'con', side: 'bat', val: (m: BatM) => m.con, n: (m: BatM) => m.sw },
  { key: 'two', side: 'bat', val: (m: BatM) => m.two, n: (m: BatM) => m.sw2 },
  { key: 'tough', side: 'bat', val: (m: BatM) => m.tough, n: (m: BatM) => m.ct },
  { key: 'ctl', side: 'pit', val: (m: PitM) => m.ctl, n: (m: PitM) => m.n },
  { key: 'stuff', side: 'pit', val: (m: PitM) => m.stuff, n: (m: PitM) => m.sw },
  { key: 'eff', side: 'pit', val: (m: PitM) => m.eff, n: (m: PitM) => m.ct },
];
const regress: Record<string, number> = {};
const relRows: string[] = [];
for (const comp of COMPS) {
  const list: any[] = comp.side === 'bat' ? bats : pits;
  const by = new Map<string, any>();
  for (const m of list) by.set(`${m.id}/${m.year}`, m);
  const xs: number[] = [], ys: number[] = [], ws: number[] = [];
  for (const m of list) {
    const nx = by.get(`${m.id}/${m.year + 1}`);
    if (!nx || comp.n(m) < 100 || comp.n(nx) < 100) continue;
    xs.push(comp.val(m)); ys.push(comp.val(nx)); ws.push(Math.min(comp.n(m), comp.n(nx)));
  }
  const W = ws.reduce((a, c) => a + c, 0);
  const mx = xs.reduce((a, c, i) => a + ws[i] * c, 0) / W;
  const my = ys.reduce((a, c, i) => a + ws[i] * c, 0) / W;
  const cov = xs.reduce((a, c, i) => a + ws[i] * (c - mx) * (ys[i] - my), 0) / W;
  const p = pOf(comp.key);
  // two는 두 로짓 차의 차라 잡음이 2스트라이크 스윙 몫에서 온다: 같은 꼴로 둔다
  const n0 = cov > 0 ? 1 / (cov * p * (1 - p)) : 100000;
  regress[comp.key] = Math.round(n0);
  relRows.push(`| ${comp.key} | ${xs.length} | ${r3(corr(xs, ys, ws))} | ${r4(cov)} | ${r3(Math.sqrt(Math.max(0, cov)))} | ${r3(p)} | ${Math.round(n0)} |`);
}

// ---- 4. 짐작 식 (2023~2025, 200타석 이상) ----
const store = loadDataStore();
const seasons = new Map<number, SeasonData>();
for (const y of [2023, 2024, 2025, 2026]) { const s = store.season(y); if (s) seasons.set(y, s); }
interface Est { m: BatM; x: [number, number, number, number]; K: number; W: number; H: number; hits: { hr: number; s1: number; d2: number; t3: number }; lg: SeasonData['league']['rates'] }
const est: Est[] = [];
for (const m of bats) {
  if (!FIT_YEARS.includes(m.year) || m.pa < 200) continue;
  const s = seasons.get(m.year)!;
  const row = s.bat.find((b) => b.id === m.id);
  if (!row || row.pa < 200 || row.so === null || row.bb === null) continue;
  const pa = row.pa;
  const hits = { hr: row.hr / pa, s1: (row.h - row.d - row.t - row.hr) / pa, d2: row.d / pa, t3: row.t / pa };
  const K = row.so / pa, W = row.bb / pa, H = (row.hbp ?? 0) / pa;
  est.push({ m, x: plateInputs(K, W, H, hits, s.league.rates), K, W, H, hits, lg: s.league.rates });
}
const agg = (m: BatM) => (m.dIn + m.dOut) / 2;
const eye = (m: BatM) => m.dIn - m.dOut;
const fits = {
  agg: wls(est.map((e) => e.x), est.map((e) => agg(e.m)), est.map((e) => e.m.pa)),
  eye: wls(est.map((e) => e.x), est.map((e) => eye(e.m)), est.map((e) => e.m.pa)),
  con: wls(est.map((e) => e.x), est.map((e) => e.m.con), est.map((e) => e.m.pa)),
};
const aggFormula = fits.agg.b.map(r4);

// ---- 5. 결과 기록으로 푼 값과 실측 (엔진의 짐작 길: 적극성 = 짐작 식, 선구·맞히기 = K·W에 맞춤, 2S = 0) ----
const lpOf = new Map<number, ReturnType<typeof leaguePlate>>();
for (const y of FIT_YEARS) {
  const lg = seasons.get(y)!.league.rates;
  const shape = chainShapeFor(DEFAULT_PARAMS, y);
  lpOf.set(y, leaguePlate(cellProbs(shape, solveKnobs(shape, lg.so, lg.bb, lg.hbp)), split, alpha));
}
const solvedEye: number[] = [], solvedCon: number[] = [], measEye: number[] = [], measCon: number[] = [], wEst: number[] = [], fEye: number[] = [], fCon: number[] = [];
for (const e of est) {
  const a = aggEstimate(aggFormula, e.K, e.W, e.H, e.hits, e.lg);
  const s = solveBat(lpOf.get(e.m.year)!, e.K, e.W, undefined, a);
  solvedEye.push(s.eye); solvedCon.push(s.con); measEye.push(eye(e.m)); measCon.push(e.m.con); wEst.push(e.m.pa);
  fEye.push(fits.eye.b[0] + e.x.reduce((t, v, j) => t + v * fits.eye.b[j + 1], 0));
  fCon.push(fits.con.b[0] + e.x.reduce((t, v, j) => t + v * fits.con.b[j + 1], 0));
}
const rmse = (a: number[], b: number[], w: number[]) => Math.sqrt(a.reduce((s, c, i) => s + w[i] * (c - b[i]) ** 2, 0) / w.reduce((s, c) => s + c, 0));
const sd = (a: number[], w: number[]) => { const W = w.reduce((s, c) => s + c, 0); const m = a.reduce((s, c, i) => s + w[i] * c, 0) / W; return Math.sqrt(a.reduce((s, c, i) => s + w[i] * (c - m) ** 2, 0) / W); };
// 투수: 결과로 푼 제구·구위 대 실측 (200타자 이상)
const pSolvedCtl: number[] = [], pSolvedStuff: number[] = [], pMeasCtl: number[] = [], pMeasStuff: number[] = [], pw: number[] = [];
for (const p of pq) {
  const row = seasons.get(p.year)!.pit.find((x) => x.id === p.id);
  if (!row || !(row.tbf > 0) || row.so === null || row.bb === null) continue;
  const s = solvePit(lpOf.get(p.year)!, row.so / row.tbf, row.bb / row.tbf, undefined);
  pSolvedCtl.push(s.ctl); pSolvedStuff.push(s.stuff); pMeasCtl.push(p.ctl); pMeasStuff.push(p.stuff); pw.push(row.tbf);
}

// ---- 6. 등급 눈금: 규정타석(팀 경기 × 3.1) 타자-시즌, 200타자 이상 투수-시즌 (2023~2025) ----
const qualPa = (y: number) => Math.max(...seasons.get(y)!.teams.map((t) => t.g)) * 3.1;
const qb = bats.filter((m) => FIT_YEARS.includes(m.year) && m.pa >= qualPa(m.year));
const NORM_Z = [1.5, 2, 2.5];
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
function quantile(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}
const round05 = (x: number) => Math.round(x * 20) / 20;
interface GradeFit { mid: number; half: number; a: number; b: number; fitA: number; fitB: number; n: number; top: number; bottom: number; over70: number; over80: number }
function gradeFit(vals: number[], curve: boolean): GradeFit {
  const s = [...vals].sort((x, y) => x - y);
  const mid = quantile(s, 0.5);
  const half = (quantile(s, 0.75) - quantile(s, 0.25)) / 1.349;
  let na = 0, da = 0, nb = 0, db = 0;
  for (const z of NORM_Z) {
    const yu = (quantile(s, normCdf(z)) - mid) / half;
    const yl = (quantile(s, 1 - normCdf(z)) - mid) / half;
    na += (yu - z) * (z - 1) ** 2; da += (z - 1) ** 4;
    nb += (-yl - z) * (z - 1) ** 2; db += (z - 1) ** 4;
  }
  const fitA = Math.max(0, na / da);
  const fitB = Math.max(0, nb / db);
  const a = curve ? Math.max(0.1, round05(fitA)) : 0;
  const b = curve ? Math.max(0.1, round05(fitB)) : 0;
  const g = (v: number) => 50 + 10 * convexInv((v - mid) / half, a, b);
  return { mid, half, a, b, fitA, fitB, n: vals.length, top: g(s[s.length - 1]), bottom: g(s[0]), over70: vals.filter((v) => g(v) >= 70).length, over80: vals.filter((v) => g(v) >= 80).length };
}
const grades: Record<string, GradeFit> = {
  agg: gradeFit(qb.map(agg), false),
  eye: gradeFit(qb.map(eye), true),
  con: gradeFit(qb.map((m) => m.con), true),
  two: gradeFit(qb.map((m) => m.two), true),
  tough: gradeFit(qb.map((m) => m.tough), true),
  ctl: gradeFit(pq.map((p) => p.ctl), true),
  stuff: gradeFit(pq.map((p) => p.stuff), true),
  eff: gradeFit(pq.map((p) => p.eff), true),
};
// 등급 식 왕복 검사 (plateGrade ∘ plateValue = 그대로)
for (const g of Object.values(grades)) {
  for (const x of [20, 35, 50, 65, 80, 95]) {
    const v = g.mid + g.half * convex((x - 50) / 10, g.a, g.b);
    if (Math.abs(plateGrade(g, v) - x) > 1e-9) throw new Error('등급 식 왕복이 어긋남');
  }
}

// ---- 7. 시작판 (2026): 실측 능력이 사슬에서 내는 삼진·볼넷 대 지금 산출(BatSkill·PitSkill, 직전 3시즌 가중 + 당김) ----
// 결정 1(측정값 그대로, 결과 맞춤 없음)이라 실측이 있는 선수는 리그 평균 상대 삼진·볼넷이 지금 산출과 조금 다르다. 선수별 차이를 QA 자료로 남긴다
const startYear = 2026;
const world = worldForYear(store, startYear, DEFAULT_PARAMS);
const pc = plateContext(world.players, world.league, DEFAULT_PARAMS, startYear);
interface Dev { name: string; team: string; kind: string; n: number; k0: number; k1: number; w0: number; w1: number }
const devs: Dev[] = [];
for (const p of world.players) {
  const lg = world.league;
  if (!p.isPitcher && p.bat?.plateRes && p.bat.sample >= 300) {
    const ch = plateChain(pc.lp, pc.bat[p.idx], ZERO_PIT);
    devs.push({ name: p.name, team: world.teams[p.teamIdx].name, kind: '타자', n: p.bat.sample, k0: p.bat.so * lg.so, k1: ch.e[0], w0: p.bat.bb * lg.bb, w1: ch.e[1] });
  }
  if (p.isPitcher && p.pit?.plateRes && p.pit.sample >= 300) {
    const ch = plateChain(pc.lp, ZERO_BAT, pc.pit[p.idx]);
    devs.push({ name: p.name, team: world.teams[p.teamIdx].name, kind: '투수', n: p.pit.sample, k0: p.pit.so * lg.so, k1: ch.e[0], w0: p.pit.bb * lg.bb, w1: ch.e[1] });
  }
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const devSummary = (kind: string) => {
  const d = devs.filter((x) => x.kind === kind);
  const w = d.map((x) => x.n);
  const lk0 = d.map((x) => logit(x.k0)), lk1 = d.map((x) => logit(x.k1)), lw0 = d.map((x) => logit(x.w0)), lw1 = d.map((x) => logit(x.w1));
  return `| ${kind} | ${d.length} | ${r3(corr(lk0, lk1, w))} | ${r3(sd(lk1, w) / sd(lk0, w))} | ${r3(rmse(lk0, lk1, w))} | ${r3(corr(lw0, lw1, w))} | ${r3(sd(lw1, w) / sd(lw0, w))} | ${r3(rmse(lw0, lw1, w))} |`;
};
const devRows = (kind: string, key: 'k' | 'w') => devs.filter((x) => x.kind === kind)
  .sort((a, b) => Math.abs(logit(b[`${key}1`]) - logit(b[`${key}0`])) - Math.abs(logit(a[`${key}1`]) - logit(a[`${key}0`])) || a.name.localeCompare(b.name))
  .slice(0, 8).map((x) => `| ${x.name} | ${x.team} | ${Math.round(x.n)} | ${pct(x.k0)} → ${pct(x.k1)} | ${pct(x.w0)} → ${pct(x.w1)} |`);

// ---- 출력 ----
const code = [
  '  plate: {',
  `    split: [`,
  ...split.map((v, c) => `      [${v.map(r5).join(', ')}], // ${Math.floor(c / 3)}-${c % 3}`),
  '    ],',
  `    alpha: ${r3(alpha)},`,
  `    aggFormula: [${aggFormula.join(', ')}],`,
  `    regress: { ${Object.entries(regress).map(([k, v]) => `${k}: ${v}`).join(', ')} },`,
  '    grades: {',
  ...Object.entries(grades).map(([k, g]) => `      ${k}: { mid: ${r4(g.mid)}, half: ${r4(g.half)}, a: ${g.a}, b: ${g.b} },`),
  '    },',
  '  },',
].join('\n');
console.log(code);

const ABIL_KO: Record<string, string> = { agg: '적극성', eye: '선구', con: '맞히기', two: '2S 대처', tough: '끈질김', ctl: '제구', stuff: '구위', eff: '투구 효율', swIn: '존 안 스윙', swOut: '존 밖 스윙' };
const md = [
  '# 볼카운트 사슬 능력 맞춤 (능력치 v2 16-1)',
  '',
  '`npx tsx tools/fit_plate_estimate.ts` 결과. 자료: 투구 단위 2023~2025 (`data-src/pbp_derived/` count_zone·batter_plate·pitcher_plate, `tools/pbp_plate.py`,',
  'slothman3878 KBO Play-by-Play v0, CC BY 4.0), 게임 시즌 자료. 능력은 리그 대비 로짓 차 = logit(실제) − logit(같은 칸·존에서 리그 평균이 냈을 값).',
  '',
  '## 1. 구위의 존 밖 유인 몫 alpha',
  '',
  `투수-시즌 200타자 이상 ${pq.length}개, 존 밖 공 가중. 존 밖 스윙 로짓 차 = ${r3(aFit.b[0])} + **${r3(aFit.b[1])}** × 구위 + ${r3(aFit.b[2])} × 제구 (R² ${r3(aFit.r2)}). 기획안 9.1의 0.32(헛스윙·존·경계 로짓 셋으로 회귀)와 견줌.`,
  '',
  '## 2. 당김 상수',
  '',
  '같은 선수의 이어진 두 해(두 해 모두 분모 100 이상, 2023~2026)의 가중 공분산을 참 퍼짐 τ²로 보고, 공 n개의 로짓 차 잡음 1 ÷ (n p(1 − p))와 같아지는 n을 당김 상수로 둔다.',
  '선수 값 = (Σ 시즌 가중 × n × 실측 + 당김 × 짐작) ÷ (Σ 시즌 가중 × n + 당김). 짐작 = 결과 기록으로 푼 값 (2S 대처·끈질김·투구 효율은 0 또는 P/PA로 푼 값).',
  '',
  '| 능력 | 쌍 | 해 사이 상관 | τ² | τ | 리그 비율 p | 당김 (공) |',
  '|---|---|---|---|---|---|---|',
  ...relRows,
  '',
  '## 3. 2022년 이전 짐작 식 (2023~2025 200타석 이상, 타석 가중)',
  '',
  `표본 ${est.length}개. 입력: 삼진·볼넷 로짓 차, 안타당 추가 루 차(파워), 인플레이(홈런 포함)당 안타 차(컨택). 볼넷은 고의4구를 빼지 못했다 (게임 자료에 고의4구 열 없음, 9.6에서 차이가 거의 없음을 확인).`,
  '',
  '| 짐작할 값 | 상수 | 삼진 | 볼넷 | 파워 | 컨택 | R² | 기획안 1.12·9.6 R² |',
  '|---|---|---|---|---|---|---|---|',
  `| 적극성 (엔진이 씀) | ${fits.agg.b.map(r3).join(' | ')} | ${r3(fits.agg.r2)} | 0.62~0.64 |`,
  `| 선구 (견줌) | ${fits.eye.b.map(r3).join(' | ')} | ${r3(fits.eye.r2)} | 0.23~0.25 |`,
  `| 맞히기 (견줌) | ${fits.con.b.map(r3).join(' | ')} | ${r3(fits.con.r2)} | 0.85 |`,
  '',
  '## 4. 결과로 푼 값 대 실측 (엔진의 짐작 길)',
  '',
  '실측이 없는 선수(2022년 이전 해, 가상 선수)는 적극성을 짐작 식으로 두고 선구·맞히기를 그 선수의 삼진·볼넷이 사슬에서 그대로 나오게 푼다 (기획안 1.12 "처리", 결정 1은 실측 선수에만).',
  '같은 표본에서 시즌 삼진·볼넷으로 푼 값을 실측과 견준다 (타석 가중). 짐작 식(회귀)은 평균 쪽으로 당겨져 퍼짐이 줄고, 푼 값은 퍼짐을 지킨다.',
  '',
  '| 능력 | 실측 퍼짐 | 푼 값 퍼짐 | 푼 값 상관 | 푼 값 오차 | 짐작 식 퍼짐 | 짐작 식 상관 | 짐작 식 오차 |',
  '|---|---|---|---|---|---|---|---|',
  `| 선구 | ${r3(sd(measEye, wEst))} | ${r3(sd(solvedEye, wEst))} | ${r3(corr(solvedEye, measEye, wEst))} | ${r3(rmse(solvedEye, measEye, wEst))} | ${r3(sd(fEye, wEst))} | ${r3(corr(fEye, measEye, wEst))} | ${r3(rmse(fEye, measEye, wEst))} |`,
  `| 맞히기 | ${r3(sd(measCon, wEst))} | ${r3(sd(solvedCon, wEst))} | ${r3(corr(solvedCon, measCon, wEst))} | ${r3(rmse(solvedCon, measCon, wEst))} | ${r3(sd(fCon, wEst))} | ${r3(corr(fCon, measCon, wEst))} | ${r3(rmse(fCon, measCon, wEst))} |`,
  `| 제구 (투수 ${pw.length}) | ${r3(sd(pMeasCtl, pw))} | ${r3(sd(pSolvedCtl, pw))} | ${r3(corr(pSolvedCtl, pMeasCtl, pw))} | ${r3(rmse(pSolvedCtl, pMeasCtl, pw))} | — | — | — |`,
  `| 구위 (투수) | ${r3(sd(pMeasStuff, pw))} | ${r3(sd(pSolvedStuff, pw))} | ${r3(corr(pSolvedStuff, pMeasStuff, pw))} | ${r3(rmse(pSolvedStuff, pMeasStuff, pw))} | — | — | — |`,
  '',
  '## 5. 등급 눈금 (기획안 1.7, 11.2)',
  '',
  `표본: 타자 2023~2025 규정타석(그 해 팀 경기 × 3.1) ${qb.length}명-시즌, 투수 200타자 이상 ${pq.length}명-시즌, 한 시즌 실측값.`,
  '등급 = 50 + 10 × e⁻¹((값 − 중앙) ÷ 중간폭), 중간폭 = 사분위 범위 ÷ 1.349, e(z) = z + a·max(0, z − 1)² − b·max(0, −z − 1)².',
  'a·b는 다시 매긴 등급의 1.5·2·2.5 표준편차 자리 분위가 정규분포와 같아지게 최소제곱으로 맞추고, 바닥 0.1·0.05 단위로 둥글렸다 (결정 21). 적극성은 곡선 없음 (결정 16).',
  '',
  '| 능력 | n | 중앙 | 중간폭 | 맞춘 a / b | 쓴 a / b | 70+ | 80+ | 최고 | 최저 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...Object.entries(grades).map(([k, g]) => `| ${ABIL_KO[k]} | ${g.n} | ${r3(g.mid)} | ${r3(g.half)} | ${r3(g.fitA)} / ${r3(g.fitB)} | ${g.a} / ${g.b} | ${g.over70} | ${g.over80} | ${r3(g.top)} | ${r3(g.bottom)} |`),
  '',
  '기획안 11.2 제안값(같은 방식, 표본 조금 다름): 선구 0.1/0.1, 맞히기 0.25/0.1, 제구 존 0.1/0.4, 구위 0.3/0.15.',
  '',
  `## 6. 시작판 ${startYear}: 실측 능력이 내는 삼진·볼넷 대 지금 산출`,
  '',
  '결정 1(측정값 그대로, 결과 맞춤 없음, 기획안 1.9 2)대로 실측이 있는 선수는 리그 평균 상대 삼진·볼넷이 지금 산출(직전 3시즌 가중 + 당김 비율)과 다르다.',
  '가중 표본 300 이상, 로짓 기준 (상관, 퍼짐 비 = 사슬 ÷ 지금, 오차). 퍼짐 비가 1보다 작으면 실측 능력이 결과를 평균 쪽으로 모은다.',
  '',
  '| 구분 | 선수 | 삼진 상관 | 삼진 퍼짐 비 | 삼진 오차 | 볼넷 상관 | 볼넷 퍼짐 비 | 볼넷 오차 |',
  '|---|---|---|---|---|---|---|---|',
  devSummary('타자'),
  devSummary('투수'),
  '',
  '차이가 큰 선수 (삼진, 지금 → 사슬):',
  '',
  '| 선수 | 구단 | 표본 | 삼진 | 볼넷 |',
  '|---|---|---|---|---|',
  ...devRows('타자', 'k'),
  ...devRows('투수', 'k'),
  '',
  '차이가 큰 선수 (볼넷):',
  '',
  '| 선수 | 구단 | 표본 | 삼진 | 볼넷 |',
  '|---|---|---|---|---|',
  ...devRows('타자', 'w'),
  ...devRows('투수', 'w'),
  '',
];
writeFileSync(outPath, md.join('\n'), 'utf-8');
console.error(`보고서: ${outPath}`);
