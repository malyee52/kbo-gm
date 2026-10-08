// 게임 데이터(JSON) 타입. public/data/ 의 파일 구조와 1:1로 대응한다.

export type Hand = 'R' | 'L' | 'S';

export interface PlayerMaster {
  id: string;
  name: string;
  /** B = 타자, P = 투수, BP = 타자인데 투수 기록도 있음 */
  kind: 'B' | 'P' | 'BP';
  /** 주포지션. C 1B 2B 3B SS LF CF RF DH, 세부 포지션을 모르면 IF/OF, 투수는 SP RP CL P */
  pos?: string;
  throws?: 'R' | 'L';
  bats?: Hand;
  underhand?: boolean;
  birthYear?: number;
  /** 없으면 미확인 */
  foreign?: boolean;
  entryYear: number;
  entryExact?: number;
  first: number;
  last: number;
  /** 실존 선수 여부. 구체적 사건 이벤트는 false인 선수에게만 걸린다. */
  real: boolean;
}

export interface TeamRow {
  name: string;
  franchise: string;
  league: string | null;
  rank: number;
  g: number;
  w: number;
  l: number;
  t: number;
  pct: number;
  /** "승-무-패" */
  home: string;
  away: string;
}

/** 타석당 결과 비율 */
export interface Rates {
  s1: number;
  d2: number;
  t3: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
}

export interface LeagueTotals {
  teamGames: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  r: number;
  gdp: number;
  sb: number;
  sf: number;
  sac: number;
  tbf: number;
  bb: number;
  hbp: number;
  so: number;
  hrAllowed: number;
  er: number;
  runsAllowed: number;
  outs: number;
  rates: Rates;
  avg: number;
  runsPerTeamGame: number;
  era: number;
  gdpPerPa: number;
  sacPerPa: number;
  sfPerPa: number;
  /** 실점 중 비자책점 비율 (실책이 많던 시대일수록 큼) */
  unearnedShare: number;
  /** 타석당 폭투+보크. 2000년 이전은 기록이 없어 null */
  wpbkPerPa: number | null;
}

export interface BatRow {
  id: string;
  team: string;
  pos: string | null;
  g: number;
  pa: number;
  ab: number;
  r: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  rbi: number;
  sb: number | null;
  cs: number | null;
  bb: number | null;
  hbp: number | null;
  so: number | null;
  gdp: number | null;
  sf: number | null;
  sac: number | null;
}

export interface PitRow {
  id: string;
  team: string;
  role: string | null;
  g: number;
  gs: number | null;
  w: number;
  l: number;
  sv: number;
  hld: number | null;
  outs: number;
  tbf: number;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  r: number;
  er: number;
}

export interface SeasonData {
  year: number;
  /** false면 진행 중 시즌의 스냅샷 */
  complete: boolean;
  /** 팀당 정규시즌 경기 수 */
  games: number;
  teams: TeamRow[];
  league: LeagueTotals;
  bat: BatRow[];
  pit: PitRow[];
}

export interface YearRules {
  rosterSize: number;
  foreignLimit: number;
  maxInnings: number;
  postseasonTeams: number;
  [source: string]: number | string;
}

export interface Meta {
  version: number;
  source: string;
  years: number[];
  inProgress: number[];
  franchises: Record<string, { name: string; from: number; to: number }[]>;
  successors: Record<string, string>;
  rules: Record<string, YearRules>;
  priors: {
    batter: Rates;
    pitcher: { hit: number; hr: number; bb: number; hbp: number; so: number };
    note: string;
  };
}

/** 불러온 데이터에 접근하는 창구. Node용(loadNode)과 브라우저용(loadBrowser) 구현이 있다 */
export interface DataStore {
  meta: Meta;
  players: Map<string, PlayerMaster>;
  /** 불러오지 않았거나 없는 해는 undefined */
  season(year: number): SeasonData | undefined;
}

/** 파일에 저장된 시즌 형태. 기록 행은 필드 목록 + 배열로 압축돼 있다. */
export interface RawSeason extends Omit<SeasonData, 'bat' | 'pit'> {
  batFields: string[];
  bat: unknown[][];
  pitFields: string[];
  pit: unknown[][];
}

function unpack<T>(fields: string[], rows: unknown[][]): T[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i++) o[fields[i]] = r[i] ?? null;
    return o as T;
  });
}

export function decodeSeason(raw: RawSeason): SeasonData {
  const { batFields, bat, pitFields, pit, ...rest } = raw;
  return { ...rest, bat: unpack<BatRow>(batFields, bat), pit: unpack<PitRow>(pitFields, pit) };
}
