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
  /** 도루 성공률: 도루 실패가 기록된 타자 행의 도루 ÷ (도루 + 도루 실패). 불러올 때 계산 (decodeSeason), 기록이 없으면 null */
  sbPct?: number | null;
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
  /** 포지션 출처: 'H' 하드힛 확인값, 'E' 하드힛 해의 추정값(2009년·포지션 파일에 없는 타자), 없으면 자료집 그대로 (build_data.py fill_positions) */
  posSrc?: 'H' | 'E' | null;
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
  /** 등판 때 평균 레버리지 gmLI (하드힛, 2010~). 없으면 null·undefined (2026-10-22) */
  gmli?: number | null;
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
  /** 정규시즌 최대 이닝. 0 = 무제한 (2008 끝장승부, 무승부 없음) */
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
   * salary·bonus: 실제 계약 연봉·계약금 (달러, 있는 선수만, source = 출처). 시작 계약에 그대로 쓴다
   */
  foreignOpening?: Record<string, Record<string, { id: string; asia: boolean; confirmed: boolean; salary?: number; bonus?: number; source?: string }[]>>;
  /**
   * 연도별 특별 엔트리 선수 id (은퇴식 등으로 하루 1군에 등록된 선수. tools/build_data.py의 규칙으로 고른 값).
   * 새 게임은 시작 연도 명단의 선수를 리그에 넣지 않는다.
   */
  specialEntries?: Record<string, string[]>;
  /**
   * 연도 → 구단 계보 → 홈 구장 득점 계수 (1 = 중립). 하드힛 파크팩터(2015~)에서 build_data.py가 만든다.
   * 없는 해(2015년 이전)는 중립으로 본다.
   */
  parkFactors?: Record<string, Record<string, number>>;
  /**
   * 연도 → 구단 계보 → 사건별 홈 구장 배율 (구장 자체 값, 1 = 중립). 하드힛 구장 표(2022~2025 묶음)의 구성 모양에
   * 그 해 parkFactors 수준을 맞춰 build_data.py(park_events)가 만든다. 표에 있는 구장을 쓰는 해만 있고, 없으면 엔진이 f^hitExp·f^hrExp로 나눈다.
   */
  parkEvents?: Record<string, Record<string, ParkEvents>>;
}

/** 사건별 구장 배율: 단타·2루타·3루타·홈런 (볼넷·삼진은 구장 효과를 넣지 않는다) */
export interface ParkRates {
  s1: number;
  d2: number;
  t3: number;
  hr: number;
}

/** 전체 타자 배율 + 좌타(L)·우타(R) 배율 */
export interface ParkEvents extends ParkRates {
  L?: ParkRates;
  R?: ParkRates;
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
  /** 이 지명으로 입단한 실제 선수 ID (tools/build_data.py defer_unsigned가 붙인다). 있으면 이름 대신 이것으로 맞춘다 */
  pid?: string;
  /** 지명받고 몇 해 뒤 입단해 입단 해로 옮긴 행의 원래 지명 연도 (해외 진출·대학 진학) */
  drafted?: number;
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
  /** 실제 병역 자료: 선수 ID → 상무·경찰 복무, 국제대회 금메달 면제. military.json. 없으면 나이·기록 공백으로 짐작한다 */
  military?: Record<string, MilitaryRecord>;
  /** KBO 수비상 순위 (2023~, defense_awards.json, tools/build_defense_awards.py): 선수 ID → 그 해 포지션·순위. 수비 추정 보정에 쓴다 */
  defenseAwards?: Record<string, DefenseAward[]>;
  /** 연도별 구단 감독과 감독 경력·운영 경향 (managers.json). 없으면 감독 기능을 쓰지 않는다 */
  managers?: ManagerData;
  /** 연도별 리그 규칙 변경과 공인구 (rule_changes.json). 없으면 "달라지는 규칙" 알림에 게임 규칙 값의 변화만 보인다 */
  ruleChanges?: RuleChangeData;
  /** 구단 계보별 연고 도시와 위·경도 (homes.json, data-src/연고지.csv). 거리 측정(tools/condition_check.ts)에만 쓴다 (원정 거리 컨디션은 2026-10-22 사용자 결정으로 없앰). 없으면 거리를 모른다 */
  homes?: HomeCity[];
  /** 선수별 타석당 투구 수의 리그 대비 비율 (ppa.json, 엔진 2 D단계). 없으면 사슬 값 그대로 */
  ppa?: PpaData;
}

/** 규칙 변경 자료 (tools/build_data.py build_rule_changes, data-src/규칙변경.csv·공인구.csv) */
export interface RuleChangeData {
  version: number;
  items: RuleChangeItem[];
  ball: BallYear[];
}

/** 분류: 공인구·경기 규칙·엔트리·외국인·FA·드래프트·샐러리캡·리그 운영 */
export type RuleCat = 'ball' | 'game' | 'roster' | 'foreign' | 'fa' | 'draft' | 'cap' | 'league';
/** 게임 반영: 표시만 / 표시만(그 해 리그 평균으로 녹음) / 리그 운영 / 경기 엔진 */
export type RuleEffect = 'show' | 'show-env' | 'league' | 'engine';
/** 확인 상태: 자료집 확인 / 조사값(웹 조사, 제도연표 확인 전) / 출처 갈림 / 미확인 */
/** virtual = 게임 속 가상 결정 (2028년 이후 미래 규칙 변경, league/futureRules.ts). 자료에는 없다 */
export type RuleStatus = 'confirmed' | 'research' | 'conflict' | 'unknown' | 'virtual';

export interface RuleChangeItem {
  year: number;
  /** 시즌 중 바뀐 날짜 (MM-DD). 없으면 개막 때 */
  date?: string;
  cat: RuleCat;
  /** 게임 규칙 값 키 (league/ruleNews.ts RULE_KEYS). 있으면 전·후를 게임 값에서 읽는다 */
  key?: string;
  title: string;
  before?: string;
  after?: string;
  unit?: string;
  effect: RuleEffect;
  status: RuleStatus;
  source?: string;
  /** 게임이 실제와 다르게 단순화한 내용 ("게임은 단순화: …") */
  simplified?: string;
  note?: string;
}

/** 한 해의 공인구 (기준 범위는 바뀐 해에만 있다) */
export interface BallYear {
  year: number;
  range?: [number, number];
  /** 단일 공인구인가 (바뀐 해에만) */
  single?: boolean;
  tests?: { round: number; date?: string; avg?: number; note?: string }[];
  note?: string;
  status: RuleStatus;
  source?: string;
}

/** ppa.json: 타자(bat)·투수(pit) → 선수 ID → 연도 → [타석, 그 선수 P/PA ÷ 그 해 리그 P/PA] */
export interface PpaData {
  bat: Record<string, Record<string, [number, number]>>;
  pit: Record<string, Record<string, [number, number]>>;
}

/** 계보의 연고 도시 한 구간 (homes.json). to가 없으면 지금까지. 위·경도는 임시값 (data-src/연고지.csv 출처 열) */
export interface HomeCity {
  franchise: string;
  from: number;
  to?: number;
  city: string;
  lat: number;
  lon: number;
}

/** 감독 자료 (tools/build_data.py build_managers, data-src/감독.csv) */
export interface ManagerData {
  /** 연도 → 계보 → 그 해 감독 (개막 감독이 먼저, mid는 시즌 중 바뀐 감독) */
  seasons: Record<string, Record<string, { name: string; kind: string; mid?: boolean }[]>>;
  people: Record<string, ManagerInfo>;
}

/** 감독 한 사람의 실제 경력과 운영 경향 (기록 사실) */
export interface ManagerInfo {
  first: number;
  last: number;
  /** 정식 감독으로 맡은 시즌 수, 대행 횟수 */
  seasons: number;
  acting: number;
  /** 맡은 계보 */
  teams: string[];
  /** 시즌 내내 맡아 최종 1위(한국시리즈 우승)한 횟수 */
  titles: number;
  /** 운영 경향 계산에 쓴 시즌 수 (개막부터 끝까지 맡은 해) */
  full: number;
  /** 리그 평균 대비 팀 도루 시도, 희생번트, 구원 등판 배율 (시즌이 적으면 1 쪽으로 당김) */
  steal: number;
  bunt: number;
  relief: number;
  /**
   * 투구 단위 자료(2023~)의 팀 선발 평균 투구 수 ÷ 리그, 팀 구원 연투 비율 ÷ 리그 (시즌 내내 맡은 해 평균, 시즌이 적으면 1 쪽으로 당김).
   * byYear: 개막 감독으로 맡은 해의 팀 값 그대로 (엔진 2 10단계). 자료가 없으면 없다
   */
  push?: number;
  pen?: number;
  byYear?: Record<string, { push: number; pen: number }>;
}

/** 한 선수의 실제 병역 자료 (tools/build_data.py build_military) */
export interface MilitaryRecord {
  /** 2026 프로필 경력에 상무·경찰이 있다. end = 1군 기록 공백으로 본 복무 끝 해 (추정, 없으면 모름) */
  served?: { unit: string; end?: number };
  /** 국제대회 금메달 대표팀 (미필이었으면 면제). year = 대회 연도 */
  exempt?: { year: number; event: string };
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
  const batRows = unpack<BatRow>(batFields, bat);
  let sb = 0;
  let cs = 0;
  for (const r of batRows) if (r.sb !== null && r.cs !== null && r.cs !== undefined) { sb += r.sb; cs += r.cs; }
  return { ...rest, league: { ...rest.league, sbPct: sb + cs > 0 ? sb / (sb + cs) : null }, bat: batRows, pit: unpack<PitRow>(pitFields, pit) };
}

/** KBO 수비상 한 건 (감독·코치·단장 투표 75% + 수비 기록 25%, 언론 보도) */
export interface DefenseAward {
  year: number;
  pos: string;
  /** 1 수상, 2·3 순위 */
  rank: number;
}
