// 갈래별 나이 곡선 (능력치 v2 16-4a, 기획안 2.4) — 가벼운 맞춤.
//
// 사용법:  npx tsx tools/fit_aging.ts > reports/aging-fit.txt   (먼저, 노화 곡선 델타 표)
//          npx tsx tools/fit_aging_components.ts [reports/aging-fit.txt]
//
// fit_aging.ts의 "나이별 한 해 변화" 표(사건별 리그 대비 비율의 로그 변화, 이웃 나이 1:2:1로 다듬은 값)를
// 나이 칸 다섯(다음 시즌 나이 22세 이하 · 23~26 · 27~30 · 31~34 · 35~38)으로 평균해 params.growth2.bat·pit 꼴로 찍는다.
// 39세 이상은 표본이 아주 적어(생존 편향) 뺀다. 이 값은 갈래 성장의 "모양"(어느 갈래가 일찍·늦게 크고 지는가)에만 쓰고,
// 한 해 변화의 크기는 지금 런 단위 성장 판정(growthRuns)이 정한다 (16-5 장기 균형 맞춤 전까지, league/branches.ts).
// 기획안 2.4의 1~7번(갈래 재정의·생존 편향 상하한·기량 층·상관 행렬·선발/구원·주력·체력)은 아직 하지 않았다.

import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'reports/aging-fit.txt';
const lines = readFileSync(file, 'utf8').split(/\r?\n/);
const head = lines.findIndex((l) => l.startsWith('나이 |'));
if (head < 0) throw new Error(`${file}에 "나이별 한 해 변화" 표가 없습니다 (tools/fit_aging.ts를 먼저 돌린다)`);
const BAT = ['so', 'bb', 'hbp', 'hr', 's1', 'd2', 't3'];
const PIT = ['so', 'bb', 'hbp', 'hr', 'hit'];
const rows = new Map<number, { bat: number[]; pit: number[] }>();
for (const l of lines.slice(head + 1)) {
  const m = l.match(/^(\d+) \| ([^|]+) \| ([^|]+) \|/);
  if (!m) break;
  rows.set(Number(m[1]), { bat: m[2].trim().split(/\s+/).map(Number), pit: m[3].trim().split(/\s+/).map(Number) });
}
const BANDS: [number, number][] = [[20, 22], [23, 26], [27, 30], [31, 34], [35, 38]];
const band = (kind: 'bat' | 'pit', k: number) => BANDS.map(([lo, hi]) => {
  const v: number[] = [];
  for (let a = lo; a <= hi; a++) { const r = rows.get(a); if (r) v.push(r[kind][k]); }
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 1000) / 1000 : 0;
});
const out = (kind: 'bat' | 'pit', keys: string[], use: string[]) =>
  `${kind}: { ${use.map((e) => `${e}: [${band(kind, keys.indexOf(e)).join(', ')}]`).join(', ')} },`;
console.log('// params.growth2 (나이 칸: ≤22 · 23~26 · 27~30 · 31~34 · 35+), 로그 변화/년');
console.log(out('bat', BAT, ['so', 'bb', 's1', 'd2', 't3', 'hr']));
console.log(out('pit', PIT, ['so', 'bb', 'hr', 'hit']));
