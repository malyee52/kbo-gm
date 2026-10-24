import type { Hand, ParkEvents, Rates, YearRules } from '../data/types';
import type { Defense } from './defense';

/** 타자 능력: 타석 결과별 리그 대비 비율 (1.00 = 리그 평균) */
export interface BatSkill {
  so: number;
  bb: number;
  hbp: number;
  hr: number;
  s1: number;
  d2: number;
  t3: number;
  /** 1루에 나갔을 때 도루를 시도하는 비율 (절대값) */
  sbAtt: number;
  /** 도루 성공률 */
  sbPct: number;
  /** 주루 속도 0~1 (0.5 = 평균). 추가 진루 확률에 쓴다 */
  speed: number;
  /** 능력 산출에 쓴 가중 타석 수 */
  sample: number;
  /**
   * 타구 성향: 아웃 타구의 땅볼 승산에 곱하는 배율 (1 = 리그 평균, 클수록 땅볼형, 엔진 2 6단계). 타구 자료가 없어 병살 기록으로 추정한다
   * (ratings.ts batGbOf). 없으면 1
   */
  gb?: number;
  /** 타석당 투구 수 ÷ 그 해 리그 값 (D단계 가공값을 시즌 가중·평균 쪽으로 당긴 값, "끈질김"). 자료가 없으면 undefined (사슬 값 그대로) */
  ppaRel?: number;
  /** 포지션별 수비 런 (defense.ts). 없으면 주 포지션에서 옮긴 평균값 */
  def?: Defense;
}

/** 투수 능력: 상대 타석 결과별 리그 대비 비율 (1.00 = 리그 평균, 삼진은 클수록 좋고 나머지는 작을수록 좋다) */
export interface PitSkill {
  so: number;
  bb: number;
  hbp: number;
  hr: number;
  /** 홈런을 뺀 피안타 */
  hit: number;
  /** 선발일 때 한 경기에 상대하는 타자 수 */
  stamina: number;
  /** 구원일 때 한 번 등판에 상대하는 타자 수 */
  reliefStint: number;
  /** 등판 중 선발 비율 */
  startShare: number;
  /** 능력 산출에 쓴 가중 상대 타자 수 */
  sample: number;
  /** 땅볼 성향: 아웃 타구의 땅볼 승산 배율 (1 = 리그 평균, 엔진 2 6단계). 타구 자료가 없어 피홈런 능력으로 추정한다 (ratings.ts pitGbOf). 없으면 1 */
  gb?: number;
  /** 상대 타석당 투구 수 ÷ 그 해 리그 값 ("투구 효율"의 역, D단계 가공값). 자료가 없으면 undefined */
  ppaRel?: number;
}

export interface SimPlayer {
  /** 이 월드 안에서의 일련번호 (기록 배열의 색인) */
  idx: number;
  id: string;
  name: string;
  teamIdx: number;
  isPitcher: boolean;
  /** 야수: C 1B 2B 3B SS LF CF RF DH IF OF, 모르면 null */
  pos: string | null;
  bats: Hand | null;
  throws: 'R' | 'L' | null;
  foreign: boolean;
  age: number | null;
  bat: BatSkill | null;
  pit: PitSkill | null;
  /** 직전 시즌 세이브 수 (마무리 지정용) */
  lastSaves: number;
  /** 언더·사이드 투수 (자료집·하드힛 투구손 우언·좌언, 가상 투수는 생성 때). 표시용, 엔진 효과는 없다 (2026-10-22) */
  underhand?: boolean;
  /** 불펜 신뢰도 (ratings.ts penTrustOf): 지난 시즌 실제 쓰임으로 정한 시작 불펜 서열. 없으면 능력 순 (2026-10-22) */
  penTrust?: number;
  /** 타자: 기대 타석 가치(클수록 좋음). 투수: 기대 실점 가치(작을수록 좋음) */
  value: number;
  /** 직전 기록이 없어 해당 시즌 기록으로 능력을 추정한 선수 */
  debutEstimate: boolean;
  /**
   * 시즌 중 뛸 수 있는 기간의 비율 (0~1). 값이 있으면 무작위 결장 대신 이 비율만큼만 뛴다.
   * 검증에서 실제 출전량을 재현할 때 쓴다.
   */
  availability?: number;
  /** 실존 선수 여부. false면 가상 선수. 값이 없으면 실존 선수로 본다 (구체적 사건 이벤트를 막는 쪽) */
  real?: boolean;
  /** 육성선수: 1군에 못 나간다 (정식 등록 전, league/offseason.ts) */
  dev?: boolean;
  /**
   * 시즌 중 방출된 선수의 마지막 소속 (teamIdx = -1, league/market.ts). 기록·이름 표시는 이 구단으로 한다.
   * 시즌 중 시장의 미계약 선수는 teamIdx = -1이고 이 값이 없다 (어느 구단 명단에도 없다)
   */
  formerTeam?: number;
  /** 자유 모드의 빈 자리 (아직 쓰지 않은 가상 선수 자리, src/fantasy/free.ts). 시장 목록에 나오지 않는다 */
  reserve?: boolean;
  /** 개막부터 결장하는 일수 (지난 시즌에서 넘어온 부상, 병역 복귀 전 기간) */
  startAbsent?: number;
  /** 방위병 (league/careers.ts, 1982~1994): 이 날(개막 뒤 일수) 전까지는 홈경기에만 나온다 */
  homeOnlyUntil?: number;
  /** 이도류로 쓰는 선수의 반대쪽 능력 (투수의 타격 bat, 타자의 투구 pit). 있으면 refreshActive가 반대쪽 자리 후보에도 넣는다 */
  alt?: { bat?: BatSkill; pit?: PitSkill };
  /** 나이가 추정값 (생년 자료 없음, M8) */
  ageEstimated?: boolean;
  /** 숨겨진 특수능력 (traits.ts). 화면·AI·저장에 쓰지 않는다. 데이터에서 월드를 만들 때 붙는다 */
  traits?: readonly import('./traits').Trait[];
  /** 숨은 능력 '부상 경향' (부상 확률 배율, 엔진 2 16단계에서 붙는다). 없으면 1.00 */
  injuryProne?: number;
  /** 개막 때 혹사지수 (지난 시즌에서 넘어온 값, league/offseason.ts). 없으면 0 */
  overuseStart?: number;
}

export interface SimTeam {
  idx: number;
  name: string;
  franchise: string;
  /** 구단 소속 전체 (1군 + 2군) */
  org: SimPlayer[];
  /** 의료·트레이닝 투자: 부상 확률 배율, 결장 기간 배율 (없으면 1, league/finance.ts) */
  injuryRate?: number;
  injuryDays?: number;
  /**
   * 홈 구장 특성: hr = 게임 안에서 지은 신구장의 홈런 배율 (league/stadium.ts parkFactor, 없으면 1),
   * run = 실제 구장 득점 계수 (meta.parkFactors), ev = 실제 구장 사건별 배율 (meta.parkEvents, 있으면 run 대신 쓴다)
   */
  park?: { hr: number; run?: number; ev?: ParkEvents };
}

/** 한 시즌을 돌리는 데 필요한 모든 입력 */
export interface World {
  year: number;
  gamesPerTeam: number;
  rules: YearRules;
  /** 이 시즌의 목표 리그 비율 */
  league: Rates;
  /** 타석 결과 외의 시대 환경 */
  env: LeagueEnv;
  teams: SimTeam[];
  players: SimPlayer[];
}

/** 타석 결과 비율 외에 시대마다 달라지는 값 */
export interface LeagueEnv {
  /** 인플레이 아웃이 될 타구가 실책 출루가 될 확률 */
  roe: number;
  /** 타석당 희생번트 */
  sac: number;
  /** 득점이 (타자 출루 외의 실책 때문에) 비자책으로 기록될 확률 */
  unearnedRun: number;
  /** 그 해 리그 비자책 실점 비율 (엔진 2 14단계: 시대 표의 경기 안 몫으로 unearnedRun을 다시 낼 때, eras.ts eraEnv). 없으면 다시 내지 않는다 */
  unearnedShare?: number;
  /** 주자가 있는 타석에서 폭투·포일·보크로 주자가 한 베이스씩 가는 확률 */
  wildPitch: number;
  /** 그 해 아웃 타구 땅볼 몫의 승산 ÷ 기본값(params.groundBallShare)의 승산 (엔진 2 6단계). 없으면 1 */
  gbOdds?: number;
  /** 그 해 리그 도루 성공률 (엔진 2 9단계 앞, 도루 실패 2025 +11.5% 고침). 시즌 시작 때 선수 성공률 평균과의 차를 모든 도루에 더한다 (GameCtx.sbShift). 없으면 0 */
  sbPct?: number;
}

export interface BatLine {
  g: number;
  pa: number;
  ab: number;
  r: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  rbi: number;
  bb: number;
  hbp: number;
  so: number;
  sb: number;
  cs: number;
  gdp: number;
  sf: number;
  sac: number;
}

export interface PitLine {
  g: number;
  gs: number;
  w: number;
  l: number;
  sv: number;
  outs: number;
  bf: number;
  h: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  r: number;
  er: number;
  /** 홀드 (2026-10-12 추가, 맨 뒤라 예전 저장의 배열에는 없다 → 0) */
  hld: number;
  /** 퀄리티 스타트: 선발 6이닝 이상·3자책 이하 (2026-10-22 추가, 맨 뒤라 예전 저장에는 없다 → 0) */
  qs: number;
  /** 블론 세이브: 세이브 상황(1~3점 리드)에 나와 동점·역전을 허용 (2026-10-22 추가) */
  bsv: number;
  /** 투구 수 (엔진 2 3단계, 2026-10-22 추가. 기록·박스스코어에만 쓰고 피로·교체에는 아직 쓰지 않는다) */
  np: number;
}

export interface TeamRecord {
  g: number;
  w: number;
  l: number;
  t: number;
  rs: number;
  ra: number;
  homeW: number;
  homeL: number;
  homeT: number;
}

export function emptyBatLine(): BatLine {
  return { g: 0, pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, so: 0, sb: 0, cs: 0, gdp: 0, sf: 0, sac: 0 };
}

/** 기록·이름 표시에 쓰는 구단: 지금 소속, 방출됐으면 마지막 소속, 시장의 미계약 선수면 -1 */
export function lineTeam(p: Pick<SimPlayer, 'teamIdx' | 'formerTeam'>): number {
  return p.teamIdx >= 0 ? p.teamIdx : p.formerTeam ?? -1;
}

export function emptyPitLine(): PitLine {
  return { g: 0, gs: 0, w: 0, l: 0, sv: 0, outs: 0, bf: 0, h: 0, hr: 0, bb: 0, hbp: 0, so: 0, r: 0, er: 0, hld: 0, qs: 0, bsv: 0, np: 0 };
}

export function emptyTeamRecord(): TeamRecord {
  return { g: 0, w: 0, l: 0, t: 0, rs: 0, ra: 0, homeW: 0, homeL: 0, homeT: 0 };
}
