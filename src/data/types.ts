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
  /** 학력: 2026 프로필의 출신교로 가른 값 (HS 고졸, UNIV 대졸). 없으면 모름 */
  school?: 'HS' | 'UNIV';
  /** 실존 선수 여부. 구체적 사건 이벤트는 false인 선수에게만 걸린다. */
  real: boolean;
  /** 아시아쿼터 대상 (data-src/외국인_개막명단.csv에서. 없으면 일반 외국인으로 본다) */
  asia?: boolean;
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
  /**
   * 시작 연도 개막 때 구단별 외국인 (연도 → 구단 이름 → 선수). data-src/외국인_개막명단.csv에서 만든다.
   * 그 해 기록에는 시즌 중 교체된 외국인까지 있어서, 새 게임은 이 명단에 있는 외국인만 넣는다. 없는 해는 기록 그대로.
   */
  foreignOpening?: Record<string, Record<string, { id: string; asia: boolean; confirmed: boolean }[]>>;
  /**
   * 연도별 특별 엔트리 선수 id (은퇴식 등으로 하루 1군에 등록된 선수. tools/build_data.py의 규칙으로 고른 값).
   * 새 게임은 시작 연도 명단의 선수를 리그에 넣지 않는다.
   */
  specialEntries?: Record<string, string[]>;
}

/**
 * 신인 지명 한 명 (drafts.json, baseballchart.kr 원본 → tools/build_data.py). 연도는 입단 시즌.
 * 원본 순서(지명 순)를 그대로 둔다.
 */
export interface DraftRow {
  /** 갈래: 라운드, 1차, 고졸연고, 우선, 특별, 해외, 육성선수, 원년 멤버 */
  kind: string;
  /** kind가 '라운드'일 때 라운드 */
  round: number | null;
  /** 전체 지명 순위 (라운드 지명만) */
  overall: number | null;
  /** 실제 지명 구단 (그 시절 이름) */
  team: string;
  name: string;
  /** P 투수, C 포수, IF 내야수, OF 외야수, DH 지명타자 (세부 내야·외야 포지션 없음) */
  pos: 'P' | 'C' | 'IF' | 'OF' | 'DH';
  /** 원본 포지션이 둘 (투타겸업 등). pos는 앞의 것, 투타겸업은 투수 */
  twoWay?: boolean;
  school: string;
  /** 이력에 대학이 있음 (대졸) */
  univ: boolean;
  /** 1군 통산 경기 (원본 작성 시점) */
  games: number;
}

/** FA·비FA 다년 계약 (자료집 FA계약 시트, 금액 미검증) */
export interface ContractRow {
  /** 계약 첫 시즌 */
  first: number;
  id: string;
  name: string;
  kind: 'FA' | 'nonFA';
  /** 보장 기간 (년) */
  years: number;
  /** 보장액 (억 원, 옵션 제외) */
  guaranteed: number;
  option: number;
  note?: string;
}

/** 불러온 데이터에 접근하는 창구. Node용(loadNode)과 브라우저용(loadBrowser) 구현이 있다 */
export interface DataStore {
  meta: Meta;
  players: Map<string, PlayerMaster>;
  /** 불러오지 않았거나 없는 해는 undefined */
  season(year: number): SeasonData | undefined;
  /** 계약 기록. 불러오지 않았으면 빈 배열 */
  contracts?: ContractRow[];
  /** 신인 지명 (입단 연도 → 지명 순). drafts.json. 없으면 가상 신인만 쓴다 */
  drafts?: Record<string, DraftRow[]>;
  /** 숨겨진 특수능력: 선수 ID 해시(engine/traits.ts의 traitKey) → 능력 코드. traits.json. 없으면 아무도 없다 */
  traits?: Record<string, string[]>;
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
