// 브라우저용 데이터 로더. public/data/ 의 JSON을 fetch로 읽는다.
import { decodeSeason, type ContractRow, type DataStore, type DraftRow, type Meta, type PlayerMaster, type RawSeason, type SeasonData } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function get<T>(rel: string): Promise<T> {
  const res = await fetch(BASE + rel);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다: ${rel} (${res.status})`);
  return (await res.json()) as T;
}

export interface BrowserStore extends DataStore {
  /** 그 해와 직전 3시즌을 불러온다 (능력 산출에 필요한 범위) */
  ensureYear(year: number): Promise<void>;
  /** 모든 시즌과 계약 기록을 불러온다 (새 게임의 잠재력·연차 산출에 필요. 약 2MB) */
  ensureAll(): Promise<void>;
}

export async function loadBrowserStore(): Promise<BrowserStore> {
  // 신인 지명(drafts.json)은 오프시즌 드래프트와 새 게임에 필요해서 처음부터 불러온다 (약 640KB, 압축 전송)
  const [meta, pl, dr, tr] = await Promise.all([
    get<Meta>('meta.json'), get<{ players: PlayerMaster[] }>('players.json'), get<{ years: Record<string, DraftRow[]> }>('drafts.json'),
    // 숨겨진 특수능력 표. 파일이 없어도 게임은 돌아간다 (아무도 능력이 없는 것으로)
    get<{ traits: Record<string, string[]> }>('traits.json').then((t) => t.traits, () => undefined),
  ]);
  const seasons = new Map<number, SeasonData>();
  const load = async (years: number[]) => {
    const need = years.filter((y) => meta.years.includes(y) && !seasons.has(y));
    const loaded = await Promise.all(need.map((y) => get<RawSeason>(`seasons/${y}.json`)));
    loaded.forEach((raw) => seasons.set(raw.year, decodeSeason(raw)));
  };
  const store: BrowserStore = {
    meta,
    players: new Map(pl.players.map((p) => [p.id, p])),
    season: (year) => seasons.get(year),
    contracts: [],
    drafts: dr.years,
    traits: tr,
    async ensureYear(year) {
      await load([year, year - 1, year - 2, year - 3]);
    },
    async ensureAll() {
      await load(meta.years);
      if (!store.contracts?.length) store.contracts = (await get<{ contracts: ContractRow[] }>('contracts.json')).contracts;
    },
  };
  return store;
}
