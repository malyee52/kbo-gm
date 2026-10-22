// 엔진의 사건별 득점 반응 재기 (2026-10-22, reports/hardhit-fill.md "사건별 구장 배율"): 모든 구단의 홈 구장에서
// 한 사건(단타·2루타·3루타·홈런)의 배율만 1 + d로 올렸을 때 리그 득점이 얼마나 느는지 잰다.
// 결과 = 사건 1개가 더 날 때 느는 득점 (아웃 대비 런과 같은 단위). build_data.py PARK_RUN_VALUE가 이 값을 쓴다.
// 사용법:  npx tsx tools/park_run_value.ts [--year 2025] [--seeds 8] [--d 0.15]
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const year = Number(arg('year') ?? 2025);
const seeds = Array.from({ length: Number(arg('seeds') ?? 8) }, (_, i) => `prv-${i}`);
const d = Number(arg('d') ?? 0.15);
const params = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const store = loadDataStore();
const lg = store.season(year)!.league;

function run(ev: { s1: number; d2: number; t3: number; hr: number }) {
  let runs = 0;
  let pa = 0;
  for (const seed of seeds) {
    const w = worldForYear(store, year);
    for (const t of w.teams) t.park = { hr: 1, run: 1.0001, ev };
    const s = Season.start(w, params, seed);
    s.runToEnd();
    runs += s.totals.r;
    pa += s.totals.pa;
  }
  return { runs, pa };
}

const base = run({ s1: 1, d2: 1, t3: 1, hr: 1 });
console.log(`${year}년 × ${seeds.length}시드, 배율 +${d}: 기준 득점/타석 ${(base.runs / base.pa).toFixed(4)}`);
for (const e of ['s1', 'd2', 't3', 'hr'] as const) {
  const r = run({ s1: 1, d2: 1, t3: 1, hr: 1, [e]: 1 + d });
  // 그 사건이 타석당 lg.rates[e] × d만큼 더 난다고 보고, 늘어난 득점/타석을 그것으로 나눈다
  const value = (r.runs / r.pa - base.runs / base.pa) / (lg.rates[e] * d);
  console.log(`${e}: 득점 가치 ${value.toFixed(2)}`);
}
