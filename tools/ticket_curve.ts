// 입장권 가격 곡선 (재정 2 F3 탄력성 맞춤): 한 시즌을 기본 가격으로 돌린 뒤 구단마다 결산 수요 분포로
// "모두 X%"·등급 하나만 X%의 예상 관중 수입을 셈한다 (gatePredict, 다음 해 팬 만족도·관중 반응은 빼고 그 시즌 관중 수입만).
// 꼭대기 배율과 70%·150%가 이득인 구단 수를 본다.
//
// 실행: npx tsx tools/ticket_curve.ts [--seed tc-a] [--year 2026]

import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { basePrices, capOf, gatePredict, lastDemand, recommendPrices, SEAT_GRADES, type SeatGrade, type SeatPrices } from '../src/league/finance';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const seed = arg('seed', 'tc-a')!;
const year = Number(arg('year', '2026'));
const g = GameSession.create(loadDataStore(), { year, teamIdx: 0, seed, difficulty: 'normal', ratingBasis: 'season' }, DEFAULT_PARAMS);
g.advance(100000);
g.advancePostseason(10_000);
g.beginOffseason();
const L = g.league;
const scales = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];
const all = (x: number): SeatPrices => ({ general: x, reserved: x, premium: x });
const one = (k: SeatGrade, x: number): SeatPrices => ({ ...basePrices(), [k]: x });
console.log(`# 입장권 가격 곡선 (${year}, 시드 ${seed}, 기본 가격 시즌의 수요 분포, 관중 수입 = 기본 가격 대비 %)\n`);
console.log('| 구단 | 평균 수요 | 관중률 | 추천 | ' + scales.map((s) => `모두 ${Math.round(s * 100)}%`).join(' | ') + ' | 꼭대기 | 일반 꼭대기 | 지정 꼭대기 | 프리미엄 꼭대기 |');
console.log('|---|' + '---|'.repeat(scales.length + 7));
const peak = (f: (x: number) => number) => {
  let best = 1;
  let bv = -1;
  for (let x = 0.7; x <= 1.5001; x += 0.05) { const v = f(x); if (v > bv) { bv = v; best = x; } }
  return `${Math.round(best * 100)}%`;
};
for (let t = 0; t < L.teams.length; t++) {
  const h = L.finance?.[t]?.history.at(-1);
  if (!h?.homeGames) continue;
  const cap = capOf(L, t, h.year);
  const fill = (h.attendance ?? 0) / (h.homeGames * cap);
  const rev = (p: SeatPrices) => gatePredict(h.demand, fill, cap, 1, p).revenue;
  const b = rev(basePrices());
  const rec = recommendPrices(L, t);
  console.log(`| ${L.teams[t].name} | ${(lastDemand(L, t)! * 100).toFixed(0)}% | ${(fill * 100).toFixed(0)}% | ${SEAT_GRADES.map((k) => Math.round(rec[k] * 100)).join('/')} | `
    + scales.map((s) => (rev(all(s)) / b * 100).toFixed(1)).join(' | ')
    + ` | ${peak((x) => rev(all(x)))} | ${SEAT_GRADES.map((k) => peak((x) => rev(one(k, x)))).join(' | ')} |`);
}
