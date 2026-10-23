// 브라우저용 데이터 로더. public/data/ 의 JSON을 fetch로 읽는다.
import { decodeSeason, type ContractRow, type DataStore, type DefenseData, type DraftRow, type ManagerData, type Meta, type MilitaryRecord, type DefenseAward, type HomeCity, type PlayerMaster, type PpaData, type RawSeason, type SeasonData } from './types';

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
  const [meta, pl, dr, tr, mil, mgr, dfa, homes, ppa, defense] = await Promise.all([
    get<Meta>('meta.json'), get<{ players: PlayerMaster[] }>('players.json'), get<{ years: Record<string, DraftRow[]> }>('drafts.json'),
    // 숨겨진 특수능력 표. 파일이 없어도 게임은 돌아간다 (아무도 능력이 없는 것으로)
    get<{ traits: Record<string, string[]> }>('traits.json').then((t) => t.traits, () => undefined),
    // 실제 병역 자료 (새 게임의 시작 병역 상태). 없으면 나이·기록 공백으로 짐작한다
    get<{ players: Record<string, MilitaryRecord> }>('military.json').then((t) => t.players, () => undefined),
    // 감독 실명 명단과 운영 경향 (약 35KB). 없으면 감독 기능을 쓰지 않는다
    get<ManagerData>('managers.json').catch(() => undefined),
    // KBO 수비상 순위 (수비 추정 보정, 약 3KB). 없으면 보정하지 않는다
    get<{ players: Record<string, DefenseAward[]> }>('defense_awards.json').then((t) => t.players, () => undefined),
    // 구단 연고지 (원정 거리, 약 1KB). 없으면 거리를 모른다
    get<{ homes: HomeCity[] }>('homes.json').then((t) => t.homes, () => undefined),
    // 선수별 타석당 투구 수 (약 100KB). 없으면 사슬 값 그대로
    get<PpaData>('ppa.json').catch(() => undefined),
    // 수비 이닝·평판 (약 650KB, 능력치 v2 16-3a). 판정에 커리어 전체가 필요해 한 번에 받는다. 없으면 판정하지 않는다
    get<DefenseData>('defense.json').catch(() => undefined),
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
    military: mil,
    managers: mgr,
    defenseAwards: dfa,
    homes,
    ppa,
    defense,
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
