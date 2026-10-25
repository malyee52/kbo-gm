// 젊은 실존 선수의 실제 성장 여유분 실측 (능력치 v2 기획안 4.2, 16-5).
// 기준 해 Y(2001~2018)의 1군 국내 선수 중 그 해 나이 18~30세 (28~30세는 성장이 거의 끝난 나이의 "전성기 뽑기 덤" 기준): 지금 능력 = 게임이 Y를 시작 연도로 매겼을 런 (직전 기록, createLeague와 같은 식),
// 결과 = Y부터 8시즌(또는 5시즌) 안의 전성기 (realPeakRuns와 같은 방식, 그 해 리그 수준 → Y 리그 수준). 그 뒤 1군 기록이 없으면 "더 크지 않음" (여유분 0).
// 여유분 = max(0, 전성기 − 지금). 나이 칸 × 지금 기량 칸마다 평균·백분위. 그 해 입단 신인(지명 신인 생성기 몫)은 뺀다.
// 한계: 2군 기록이 없어 1군에 얼굴을 비친 선수만 들어간다 (시작 월드의 실존 유망주와 같은 모집단). 군 복무 공백은 따로 보지 않는다 (8시즌 창이 덮는다).
// 실행: npx tsx tools/fit_prospects.ts [--from 2001 --to 2018] > reports/prospect-growth.md   (약 2~4분)
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { careerIndex, realPeakRuns } from '../src/league/growth';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const from = Number(arg('from', '2001'));
const to = Number(arg('to', '2018'));
const store = loadDataStore();
const params = DEFAULT_PARAMS;
const idx = careerIndex(store);

const AGE_BANDS = [[18, 20], [21, 22], [23, 24], [25, 26], [27, 27], [28, 30]] as const;
const LEVELS = [[-Infinity, -5], [-5, 5], [5, 15], [15, Infinity]] as const;
interface Row { age: number; now: number; g8: number; g5: number; pitcher: boolean; year: number }
const rows: Row[] = [];

for (let y = from; y <= to; y++) {
  const world = worldForYear(store, y, params);
  const ctx = valueContext(world);
  for (const p of world.players) {
    const m = store.players.get(p.id);
    if (p.foreign || !m || m.entryYear >= y || p.age === null || p.age === undefined || p.age < 18 || p.age > 30) continue;
    const now = currentRuns(p, ctx);
    const peak = (n: number) => realPeakRuns(p, idx, store, ctx, params, y + n, undefined, y);
    const p8 = peak(8);
    const p5 = peak(5);
    rows.push({ age: p.age, now, g8: Math.max(0, (p8 ?? now) - now), g5: Math.max(0, (p5 ?? now) - now), pitcher: p.isPitcher, year: y });
  }
  process.stderr.write(`${y} `);
}
process.stderr.write('\n');

const q = (xs: number[], f: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');

console.log(`# 젊은 실존 선수 성장 여유분 실측 (tools/fit_prospects.ts)\n`);
console.log(`기준 해 ${from}~${to}, 국내 선수 ${rows.length}명·해 (그 해 입단 신인 제외). 여유분 = max(0, 기준 해부터 N시즌 안 전성기 − 지금), 런. 1군 기록이 끊기면 0.\n`);
for (const key of ['g8', 'g5'] as const) {
  console.log(`## ${key === 'g8' ? '8시즌' : '5시즌'} 안 전성기 − 지금\n`);
  console.log('| 나이 (그 해) | 지금 기량 (런) | 인원 | 평균 | 10% | 50% | 90% | +10런 이상 | +20런 이상 | 지금 평균 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [a0, a1] of AGE_BANDS) {
    for (const [l0, l1] of LEVELS) {
      const cell = rows.filter((r) => r.age >= a0 && r.age <= a1 && r.now >= l0 && r.now < l1);
      const g = cell.map((r) => r[key]);
      console.log(`| ${a0 === a1 ? a0 : `${a0}~${a1}`} | ${l0 === -Infinity ? `< ${l1}` : l1 === Infinity ? `≥ ${l0}` : `${l0}~${l1}`} | ${cell.length} | ${f1(mean(g))} | ${f1(q(g, 0.1))} | ${f1(q(g, 0.5))} | ${f1(q(g, 0.9))} | ${(100 * g.filter((x) => x >= 10).length / (g.length || 1)).toFixed(0)}% | ${(100 * g.filter((x) => x >= 20).length / (g.length || 1)).toFixed(0)}% | ${f1(mean(cell.map((r) => r.now)))} |`);
    }
    const all = rows.filter((r) => r.age >= a0 && r.age <= a1);
    console.log(`| ${a0 === a1 ? a0 : `${a0}~${a1}`} | 모두 | ${all.length} | ${f1(mean(all.map((r) => r[key])))} | | ${f1(q(all.map((r) => r[key]), 0.5))} | | | | ${f1(mean(all.map((r) => r.now)))} |`);
  }
  console.log('');
}
// 나이별 (1세) 평균·가운데값: growthRoom 표를 고칠 재료
console.log('## 나이 1세 단위 (8시즌, 모든 기량)\n');
console.log('| 나이 | 인원 | 평균 | 50% | 지금 평균 | 지금 ≥ 0 인원 | 그중 평균 | 그중 50% |');
console.log('|---|---|---|---|---|---|---|---|');
for (let a = 18; a <= 30; a++) {
  const c = rows.filter((r) => r.age === a);
  const hi = c.filter((r) => r.now >= 0);
  console.log(`| ${a} | ${c.length} | ${f1(mean(c.map((r) => r.g8)))} | ${f1(q(c.map((r) => r.g8), 0.5))} | ${f1(mean(c.map((r) => r.now)))} | ${hi.length} | ${f1(mean(hi.map((r) => r.g8)))} | ${f1(q(hi.map((r) => r.g8), 0.5))} |`);
}
