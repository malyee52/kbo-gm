// 선수 구성 지문 모음: 데이터를 다시 만든 뒤 저장 호환이 깨지는지 견줄 때 쓴다.
//   npx tsx tools/fingerprints.ts > before.txt   (데이터 바꾸기 전)
//   npx tsx tools/fingerprints.ts > after.txt    (바꾼 뒤) → 두 파일을 견준다
// 연도별 시즌 자료 월드(worldForYear, 형식 1 저장)와 시작 연도별 새 리그(createLeague → worldFromLeague)의 지문,
// 새 리그의 병역 상태 개수를 찍는다. 형식 2 저장은 리그 상태를 담고 있어 새 리그 지문이 달라도 불러온다.
import { loadDataStore } from '../src/data/loadNode';
import { rosterFingerprint, worldForYear } from '../src/engine';
import { createLeague } from '../src/league/create';
import { worldFromLeague } from '../src/league/world';

const store = loadDataStore();
for (const y of store.meta.years) console.log(`world ${y} ${rosterFingerprint(worldForYear(store, y))}`);
const starts = process.argv.slice(2).map(Number);
for (const y of starts.length ? starts : [1982, 1995, 2012, 2026]) {
  const { league } = createLeague(store, y, 'fp');
  const mil = new Map<string, number>();
  for (const p of league.players) {
    const k = `${p.military?.state ?? '-'}/${p.military?.basis ?? '-'}`;
    mil.set(k, (mil.get(k) ?? 0) + 1);
  }
  const birthKnown = league.players.filter((p) => p.real && p.birthYearEstimated).length;
  console.log(`league ${y} players ${league.players.length} ${rosterFingerprint(worldFromLeague(league, store))} ageEstimated ${birthKnown}`);
  console.log(`  military ${[...mil].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
