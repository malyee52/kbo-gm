// 경기 결과 지문: 기록 규정(세이브·홀드·블론)만 바꾼 수정에서 경기 결과가 그대로인지 본다.
// 중계 기록·경기 결과·타자 기록·투수 기록(세이브·홀드·블론 뺌)의 해시와, 세이브·홀드·블론 합계를 따로 낸다.
//
// 사용법:  npx tsx tools/engine_fingerprint_games.ts [--years 2025,2019] [--seed fpg]

import { createHash } from 'node:crypto';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const years = (arg('years') ?? '2025,2019').split(',').map(Number);
const seed = arg('seed') ?? 'fpg';
const store = loadDataStore();
/** 세이브·홀드·블론 칸(경기 기록의 save, 투수 기록·박스스코어의 sv·hld·bsv)은 빼고 해시한다 */
const RECORD_KEYS = new Set(['save', 'sv', 'hld', 'bsv']);
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x, (k, v) => (RECORD_KEYS.has(k) ? undefined : v))).digest('hex').slice(0, 16);

for (const year of years) {
  const world = worldForYear(store, year, DEFAULT_PARAMS);
  const s = Season.start(world, DEFAULT_PARAMS, `${seed}-${year}`, { boxTeams: world.teams.map((t) => t.idx) });
  const plays: unknown[] = [];
  while (!s.done) {
    const before = s.log.length;
    s.simulateDay();
    for (let i = before; i < s.log.length; i++) plays.push(s.plays.get(i) ?? null);
  }
  const r = s.result();
  const sum = (k: 'sv' | 'hld' | 'bsv') => r.pit.reduce((a, q) => a + q[k], 0);
  console.log(`${year}  games ${hash([s.log, plays, r.bat, r.pit, r.teams])}  세이브 ${sum('sv')} 홀드 ${sum('hld')} 블론 ${sum('bsv')}`);
}
