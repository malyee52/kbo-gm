// 엔진 결과 지문: 같은 시드로 몇 시즌을 돌려 저장 상태·박스스코어·중계 기록 전체의 해시를 낸다.
// "결과 같음" 단계(구조만 바꾸는 수정)에서 고치기 전과 뒤의 지문이 같은지 본다.
//
// 사용법:  npx tsx tools/engine_fingerprint.ts [--years 2025,2019,1990] [--seed fp]

import { createHash } from 'node:crypto';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyBatLine, emptyLeagueCounters, emptyPitLine, Rng, Season, worldForYear } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const years = (arg('years') ?? '2025,2019,1990').split(',').map(Number);
const seed = arg('seed') ?? 'fp';
const store = loadDataStore();
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

for (const year of years) {
  const t0 = performance.now();
  const world = worldForYear(store, year, DEFAULT_PARAMS);
  const s = Season.start(world, DEFAULT_PARAMS, `${seed}-${year}`, { boxTeams: world.teams.map((t) => t.idx) });
  const plays: unknown[] = [];
  while (!s.done) {
    const before = s.log.length;
    s.simulateDay();
    for (let i = before; i < s.log.length; i++) plays.push(s.plays.get(i) ?? null);
  }
  // 시즌 뒤 경기 (포스트시즌과 같은 경로)와 시범 경기
  const n = world.players.length;
  const rec = { bat: Array.from({ length: n }, emptyBatLine), pit: Array.from({ length: n }, emptyPitLine), totals: emptyLeagueCounters() };
  const extra = s.playExtraGame(0, 1, s.schedule.length + 3, new Rng(`${seed}-${year}/extra`), 15, rec);
  const save = s.toSave();
  const ms = performance.now() - t0;
  console.log(`${year}  save ${hash(save)}  plays ${hash(plays)}  extra ${hash([extra.result, rec])}  (${(ms / 1000).toFixed(1)}초)`);
}
