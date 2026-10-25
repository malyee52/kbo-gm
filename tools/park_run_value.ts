// 엔진의 사건별 득점 반응 재기 (2026-10-22, reports/hardhit-fill.md "사건별 구장 배율"): 모든 구단의 홈 구장에서
// 한 사건(단타·2루타·3루타·홈런)의 배율만 1 + d로 올렸을 때 리그 득점이 얼마나 느는지 잰다.
// 결과 = 사건 1개가 더 날 때 느는 득점 (아웃 대비 런과 같은 단위). build_data.py PARK_RUN_VALUE가 이 값을 쓴다.
// 여러 해를 주면 해마다 따로 재고, 시드마다 센 값의 평균 ± 표준오차와 모든 해를 합친 값(해마다 같은 무게)을 함께 쓴다.
// 3루타는 드물어 같은 d로는 흔들림이 커서 따로 더 크게 올린다 (--dt3).
// 사용법:  npx tsx tools/park_run_value.ts [--years 2023,2024,2025] [--seeds 16] [--d 0.15] [--dt3 0.6]
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? arg('year') ?? '2025').split(',').map(Number);
const seeds = Array.from({ length: Number(arg('seeds') ?? 8) }, (_, i) => `prv-${i}`);
const d = Number(arg('d') ?? 0.15);
const dt3 = Number(arg('dt3') ?? d);
const params = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const store = loadDataStore();
const EVENTS = ['s1', 'd2', 't3', 'hr'] as const;
type Ev = Record<(typeof EVENTS)[number], number>;

function run(year: number, seed: string, ev: Ev) {
  const w = worldForYear(store, year);
  for (const t of w.teams) t.park = { hr: 1, run: 1.0001, ev };
  const s = Season.start(w, params, seed);
  s.runToEnd();
  return s.totals.r / s.totals.pa;
}

const stat = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  return { m, se: sd / Math.sqrt(xs.length) };
};

const all: Record<string, number[]> = { s1: [], d2: [], t3: [], hr: [] };
const perYear: Record<string, { m: number; se: number }>[] = [];
for (const year of years) {
  const lg = store.season(year)!.league;
  const vals: Record<string, number[]> = { s1: [], d2: [], t3: [], hr: [] };
  let rpa = 0;
  for (const seed of seeds) {
    const base = run(year, seed, { s1: 1, d2: 1, t3: 1, hr: 1 });
    rpa += base / seeds.length;
    for (const e of EVENTS) {
      const de = e === 't3' ? dt3 : d;
      const r = run(year, seed, { s1: 1, d2: 1, t3: 1, hr: 1, [e]: 1 + de });
      // 그 사건이 타석당 lg.rates[e] × d만큼 더 난다고 보고, 늘어난 득점/타석을 그것으로 나눈다
      vals[e].push((r - base) / (lg.rates[e] * de));
    }
  }
  const row: Record<string, { m: number; se: number }> = {};
  for (const e of EVENTS) {
    row[e] = stat(vals[e]);
    all[e].push(...vals[e]);
  }
  perYear.push(row);
  console.log(`${year}년 × ${seeds.length}시드 (d ${d}, 3루타 ${dt3}), 기준 득점/타석 ${rpa.toFixed(4)}: ` +
    EVENTS.map((e) => `${e} ${row[e].m.toFixed(3)} ± ${row[e].se.toFixed(3)}`).join(' · '));
}
if (years.length > 1) {
  // 해마다 같은 무게 (시드 수가 같으므로 모든 값을 한데 모은 평균과 같다)
  console.log(`합침 ${years.join(',')} × ${seeds.length}시드: ` +
    EVENTS.map((e) => { const s = stat(all[e]); return `${e} ${s.m.toFixed(3)} ± ${s.se.toFixed(3)}`; }).join(' · '));
}
