// 브라우저용 데이터 로더. public/data/ 의 JSON을 fetch로 읽는다.
import { decodeSeason, type DataStore, type Meta, type PlayerMaster, type RawSeason, type SeasonData } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function get<T>(rel: string): Promise<T> {
  const res = await fetch(BASE + rel);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다: ${rel} (${res.status})`);
  return (await res.json()) as T;
}

export interface BrowserStore extends DataStore {
  /** 그 해와 직전 3시즌을 불러온다 (능력 산출에 필요한 범위) */
  ensureYear(year: number): Promise<void>;
}

export async function loadBrowserStore(): Promise<BrowserStore> {
  const [meta, pl] = await Promise.all([get<Meta>('meta.json'), get<{ players: PlayerMaster[] }>('players.json')]);
  const seasons = new Map<number, SeasonData>();
  return {
    meta,
    players: new Map(pl.players.map((p) => [p.id, p])),
    season: (year) => seasons.get(year),
    async ensureYear(year) {
      const need = [year, year - 1, year - 2, year - 3].filter((y) => meta.years.includes(y) && !seasons.has(y));
      const loaded = await Promise.all(need.map((y) => get<RawSeason>(`seasons/${y}.json`)));
      loaded.forEach((raw) => seasons.set(raw.year, decodeSeason(raw)));
    },
  };
}
