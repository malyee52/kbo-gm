// 시간 제한 흉내 규칙 맞추기 (엔진 2 14단계 물음 1, 2026-10-23 사용자 결정): 시간 제한이 있던 해(1982~2002 야간 4시간, 2004 4시간)의
// 정규시즌 경기는 from회 뒤 동점이면 이닝마다 확률 end로 끝나 무승부. end를 그 해 실제 무승부 비율에 맞춘다.
//
// 사용법:  npx tsx tools/time_limit_fit.ts [--years 1983,1985,...] [--seasons 40]
//
// 시간 제한 없이(params.timeLimit = {}) 돌려 "k회 끝에 동점인 경기 비율" r_k를 재고, 동점이 이어질 조건부 확률 c_k = r_{k+1} / r_k가
// 시간 제한과 무관하다고 보고 무승부 비율 T(end) = Σ_k r_from · Π((1−end)·c_j) · end (+ 최대 이닝에서 남은 몫)를 풀어 end를 찾는다.
// 시드는 validate와 같다 (`validate-{연도}-{i}`). 결과는 params.ts timeLimit에 손으로 옮긴다.

import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, Rng, Season, worldForYear, type EngineParams } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const store = loadDataStore();
const defaultYears = [...Array.from({ length: 21 }, (_, i) => 1982 + i), 2004];
const years = arg('years') ? arg('years')!.split(',').map(Number) : defaultYears;
const nSeasons = Number(arg('seasons') ?? 40);
const params: EngineParams = { ...DEFAULT_PARAMS, timeLimit: {} };

/** from회 뒤 이닝마다 end로 끝날 때의 무승부 비율 */
function tieRate(r: number[], from: number, max: number, end: number): number {
  let alive = r[from];
  let ties = 0;
  for (let k = from; k < max; k++) {
    ties += alive * end;
    alive *= (1 - end) * (r[k] > 0 ? r[k + 1] / r[k] : 0);
  }
  return ties + alive;
}

console.log('| 해 | 최대 이닝 | 실제 무승부 | 시뮬 (제한 없음) | 9회 끝 동점 | 10회 | 11회 | 12회 | 시작 회 | 끝 확률 | 어림 무승부 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const fitted: Record<number, { from: number; end: number }> = {};
for (const year of years) {
  const season = store.season(year);
  if (!season) continue;
  const games = season.teams.reduce((a, t) => a + t.g, 0) / 2;
  const target = season.teams.reduce((a, t) => a + t.t, 0) / 2 / games;
  const world = worldForYear(store, year, params);
  const max = world.rules.maxInnings;
  const seedBase = `validate-${year}`;
  const cal = calibrate(world, { ...params, pilotSeasons: 12 }, new Rng(`${seedBase}-cal`));
  const tiedAfter = new Array(max + 2).fill(0);
  let n = 0, ties = 0;
  for (let i = 0; i < nSeasons; i++) {
    const s = Season.start(world, params, `${seedBase}-${i}`, { cal });
    s.runToEnd();
    for (const g of s.log) {
      n++;
      const tie = g.homeRuns === g.awayRuns;
      if (tie) ties++;
      // k회 끝에 동점 = k+1회로 간 경기, 또는 k회에 무승부로 끝난 경기
      for (let k = 9; k <= max; k++) if (g.innings > k || (tie && g.innings === k)) tiedAfter[k]++;
    }
  }
  const r = tiedAfter.map((x) => x / n);
  // 시작 회는 12회 (사용자 결정). 12회 끝 동점 비율이 실제 무승부보다 적으면(또는 최대 이닝이 12회면) 한 회씩 앞당긴다
  let from = Math.min(12, max - 1);
  while (from > 9 && r[from] < target) from--;
  let lo = 0, hi = 1;
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (tieRate(r, from, max, mid) < target) lo = mid; else hi = mid;
  }
  const end = target <= tieRate(r, from, max, 0) ? 0 : Math.round(hi * 1000) / 1000;
  fitted[year] = { from, end };
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log(`| ${year} | ${max} | ${pct(target)} | ${pct(ties / n)} | ${pct(r[9])} | ${pct(r[10])} | ${pct(r[11])} | ${pct(r[12])} | ${from} | ${end} | ${pct(tieRate(r, from, max, end))} |`);
}
console.log();
console.log(JSON.stringify(fitted));
