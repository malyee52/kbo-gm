// 수비 런 → 실책률 기울기 재기 (능력치 v2 16-3b, engine/state.ts ERROR_PER_RUN의 근거).
//
// 사용법:  npx tsx tools/error_slope.ts [--years 2010,2012,2014,2016,2018,2019,2021,2023,2025]
//
// 그 해 시작 월드의 v2 수비 런(그 해 전 기록으로 만든 값, 영점 m을 뺌)으로 그 해 실제 실책(수비 기록)을 얼마나 가르는지 본다.
// 실책 수 ~ Poisson(기회 × 자리·해 리그 실책률 × exp(−k × 수비 런))의 k를 최우도로 (격자). 투수·포수 자리는 뺀다.
// 엔진은 수비 런을 참값으로 쓰므로, 맞출 값은 "이 수비 런이면 실제로 실책이 얼마였나"(예측 기울기)이다.
import { readFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { defenseAt } from '../src/engine/defense';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const years = (arg('years') ?? '2010,2012,2014,2016,2018,2019,2021,2023,2025').split(',').map(Number);
const store = loadDataStore();
const def = JSON.parse(readFileSync(new URL('../public/data/defense.json', import.meta.url), 'utf-8'));
const F = def.fields as string[];
const [iE, iPO, iA, iO] = ['e', 'po', 'a', 'outs'].map((k) => F.indexOf(k));
const POS = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

interface Row { pos: string; year: number; e: number; ch: number; r: number; inn: number; playable: boolean }
const rows: Row[] = [];
for (const year of years) {
  const w = worldForYear(store, year, DEFAULT_PARAMS);
  const zero = w.env.defZero !== undefined ? (w.env.defZero - 50) / 2 : 0;
  const byId = new Map(w.players.filter((p) => !p.isPitcher).map((p) => [p.id, p]));
  for (const [id, ys] of Object.entries(def.players as Record<string, Record<string, { p?: Record<string, number[]> }>>)) {
    const y = ys[String(year)];
    const p = byId.get(id);
    if (!y?.p || !p) continue;
    for (const [pos, v] of Object.entries(y.p)) {
      if (!POS.includes(pos)) continue;
      const ch = v[iPO] + v[iA] + v[iE];
      if (ch <= 0) continue;
      rows.push({ pos, year, e: v[iE], ch, r: defenseAt(p, pos) - zero, inn: v[iO] / 3, playable: !!p.bat?.playable?.includes(pos as never) });
    }
  }
}

// 자리·해별 λ를 따로 두고 k만 공통 (Poisson 최우도, k 격자)
function loglik(k: number, rs: Row[]): number {
  const groups = new Map<string, Row[]>();
  for (const r of rs) (groups.get(`${r.pos}/${r.year}`) ?? groups.set(`${r.pos}/${r.year}`, []).get(`${r.pos}/${r.year}`)!).push(r);
  let ll = 0;
  for (const g of groups.values()) {
    const E = g.reduce((a, r) => a + r.e, 0);
    const X = g.reduce((a, r) => a + r.ch * Math.exp(-k * r.r), 0);
    const lam = E / X;
    for (const r of g) { const mu = r.ch * lam * Math.exp(-k * r.r); ll += r.e * Math.log(mu) - mu; }
  }
  return ll;
}
function fit(rs: Row[]): { k: number; se: number } {
  let best = 0, bestLL = -Infinity;
  for (let k = -0.05; k <= 0.15; k += 0.001) { const ll = loglik(k, rs); if (ll > bestLL) { bestLL = ll; best = k; } }
  const h = 0.002;
  const d2 = (loglik(best + h, rs) - 2 * bestLL + loglik(best - h, rs)) / (h * h);
  return { k: best, se: Math.sqrt(-1 / d2) };
}
const all = fit(rows);
console.log(`행 ${rows.length} · 공통 k ${all.k.toFixed(3)} ± ${all.se.toFixed(3)} `);
const pl = fit(rows.filter((r) => r.playable));
console.log(`수비 가능 자리만 k ${pl.k.toFixed(3)} ± ${pl.se.toFixed(3)}`);
for (const pos of POS) {
  const f = fit(rows.filter((r) => r.pos === pos));
  console.log(`${pos} k ${f.k.toFixed(3)} ± ${f.se.toFixed(3)}`);
}
// 수비 가능이 아닌 자리에서 실제로 뛴 몫과 그 실책 비율 (같은 자리·해 리그 대비)
for (const pos of POS) {
  const g = rows.filter((r) => r.pos === pos);
  const rate = (rs: Row[]) => rs.reduce((a, r) => a + r.e, 0) / Math.max(1, rs.reduce((a, r) => a + r.ch, 0));
  const lg = rate(g), bad = g.filter((r) => !r.playable);
  const inn = (rs: Row[]) => rs.reduce((a, r) => a + r.inn, 0);
  console.log(`${pos} 수비 가능 아님: 이닝 몫 ${(100 * inn(bad) / inn(g)).toFixed(1)}% · 실책률 리그 대비 ${(rate(bad) / lg).toFixed(2)} (기회 ${bad.reduce((a, r) => a + r.ch, 0)}) · 그 r 평균 ${(bad.reduce((a, r) => a + r.r * r.ch, 0) / Math.max(1, bad.reduce((a, r) => a + r.ch, 0))).toFixed(1)}`);
}
// r 구간별 실제 실책 비율 (자리·해 리그 대비)
const lgRate = new Map<string, number>();
for (const r of rows) { const k = `${r.pos}/${r.year}`; lgRate.set(k, 0); }
for (const k of lgRate.keys()) { const g = rows.filter((r) => `${r.pos}/${r.year}` === k); lgRate.set(k, g.reduce((a, r) => a + r.e, 0) / g.reduce((a, r) => a + r.ch, 0)); }
for (const [lo, hi] of [[-99, -10], [-10, -5], [-5, -2], [-2, 2], [2, 5], [5, 10], [10, 99]]) {
  const g = rows.filter((r) => r.r >= lo && r.r < hi);
  const E = g.reduce((a, r) => a + r.e, 0), X = g.reduce((a, r) => a + r.ch * lgRate.get(`${r.pos}/${r.year}`)!, 0);
  console.log(`r ${lo}~${hi}: 기회 ${g.reduce((a, r) => a + r.ch, 0)} · 실책 비 ${(E / X).toFixed(2)} (exp(−k × 구간 가운데) ${Math.exp(-all.k * (Math.max(lo, -15) + Math.min(hi, 15)) / 2).toFixed(2)})`);
}
