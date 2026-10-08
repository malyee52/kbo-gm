// Node용 데이터 로더. 검증 스크립트와 테스트에서만 쓴다 (브라우저에서는 loadBrowser.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSeason, type ContractRow, type DataStore, type Meta, type PlayerMaster, type RawSeason, type SeasonData } from './types';

export type { DataStore } from './types';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');

function read<T>(rel: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, rel), 'utf-8')) as T;
}

export function loadDataStore(): DataStore {
  const meta = read<Meta>('meta.json');
  const players = new Map(read<{ players: PlayerMaster[] }>('players.json').players.map((p) => [p.id, p]));
  const cache = new Map<number, SeasonData>();
  return {
    meta,
    players,
    contracts: read<{ contracts: ContractRow[] }>('contracts.json').contracts,
    season(year) {
      if (!meta.years.includes(year)) return undefined;
      let s = cache.get(year);
      if (!s) {
        s = decodeSeason(read<RawSeason>(`seasons/${year}.json`));
        cache.set(year, s);
      }
      return s;
    },
  };
}
