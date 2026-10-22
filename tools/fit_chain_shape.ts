// 볼카운트 사슬 리그 모양 맞춤 (경기 엔진 2 3단계, docs/경기엔진2_기획안.md 3.6.2).
// 매치업마다 손잡이가 달라서 리그 모양 그대로의 사슬을 매치업별로 풀어 합치면 리그 칸 비율이 모양과 어긋난다 (매치업 섞임 효과).
// 그래서 시뮬로 칸별 공 결과 비율을 재고, 칸·결과마다 (실제 ÷ 시뮬) 비를 모양에 곱해 다시 정규화하는 일을 몇 번 되풀이한다.
// 결과(삼진·볼넷·안타 등)는 해결기와 상관없이 같은 확률표에서 뽑으므로 맞춤은 투구 수·칸 비율만 바꾼다.
// 사용법:  npx tsx tools/fit_chain_shape.ts [--years 2023,2024,2025] [--seasons 6] [--iters 3]
// 출력: params.ts에 붙일 chainShapeByYear와 chainShape(세 해를 실제 공 수로 가중 평균) 코드, 반복마다 칸 차이 최대값
import { readFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, Rng, Season, worldForYear } from '../src/engine';
import type { ChainShape } from '../src/engine/chain';
import { chainShapeFor } from '../src/engine/params';
import { chainResolver } from '../src/engine/resolver';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2023,2024,2025').split(',').map(Number);
const nSeasons = Number(arg('seasons') ?? 6);
const iters = Number(arg('iters') ?? 3);
const params = { ...DEFAULT_PARAMS };

/** 실제 칸별 공 수 [볼, 스트라이크, 파울, 맞힘, 사구] (engine2_baseline.ts의 realCells와 같은 묶음) */
function realCounts(year: number): number[][] {
  const lines = readFileSync('data-src/pbp_derived/count_pitch.csv', 'utf-8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])))
    .filter((r) => Number(r.year) === year && Number(r.balls) <= 3 && Number(r.strikes) <= 2);
  return Array.from({ length: 12 }, (_, c) => {
    const r = rows.find((x) => Number(x.balls) * 3 + Number(x.strikes) === c)!;
    const n = (k: string) => Number(r[`n_${k}`]);
    const two = Number(r.strikes) === 2;
    return [n('ball'), n('called_strike') + n('swinging_strike') + n('bunt_miss') + (two ? n('bunt_foul') : 0), n('foul') + (two ? 0 : n('bunt_foul')), n('in_play'), n('hbp')];
  });
}
const norm = (v: number[]) => { const z = v.reduce((a, b) => a + b, 0); return v.map((x) => x / z); };

const store = loadDataStore();
const fitted = new Map<number, number[][]>();
for (const year of years) {
  const world = worldForYear(store, year, params);
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`validate-${year}-cal`));
  const real = realCounts(year).map(norm);
  let shape = chainShapeFor(params, year).map((c) => [...c]);
  const measure = (sh: number[][]) => {
    const cells = Array.from({ length: 12 }, () => [0, 0, 0, 0, 0]);
    const resolver = chainResolver(sh as unknown as ChainShape, { observe: (c, k) => { cells[c][k]++; } });
    for (let i = 0; i < nSeasons; i++) Season.start(world, params, `fitshape-${year}-${i}`, { cal, resolver }).runToEnd();
    return cells.map(norm);
  };
  for (let it = 0; it <= iters; it++) {
    const sim = measure(shape);
    const worst = Math.max(...sim.flatMap((v, c) => v.map((x, j) => Math.abs(x - real[c][j]))));
    console.error(`${year} 반복 ${it}: 칸 차이 최대 ${(worst * 100).toFixed(2)}%p`);
    if (it === iters) break;
    shape = shape.map((v, c) => norm(v.map((x, j) => x * (sim[c][j] > 0 ? real[c][j] / sim[c][j] : 1))));
  }
  fitted.set(year, shape);
}

const fmt = (sh: number[][]) => sh.map((v, c) => `      [${v.map((x) => Number(x.toFixed(5))).join(', ')}], // ${Math.floor(c / 3)}-${c % 3}`).join('\n');
for (const [year, sh] of fitted) console.log(`    ${year}: [\n${fmt(sh)}\n    ],`);
if (fitted.size === 3) {
  // 그 해 자료가 없는 해의 모양: 세 해 맞춘 모양을 칸마다 실제 공 수로 가중 평균
  const w = [...fitted.keys()].map((y) => realCounts(y).map((v) => v.reduce((a, b) => a + b, 0)));
  const avg = Array.from({ length: 12 }, (_, c) => norm([0, 1, 2, 3, 4].map((j) => [...fitted.values()].reduce((a, sh, k) => a + sh[c][j] * w[k][c], 0))));
  console.log(`  chainShape: [\n${fmt(avg).replace(/^ {6}/gm, '    ')}\n  ],`);
}
