import type { Hand, Rates, YearRules } from '../data/types';
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
  /** 개막부터 결장하는 일수 (지난 시즌에서 넘어온 부상, 병역 복귀 전 기간) */
  startAbsent?: number;
  /** 나이가 추정값 (생년 자료 없음, M8) */
  ageEstimated?: boolean;
  /** 숨겨진 특수능력 (traits.ts). 화면·AI·저장에 쓰지 않는다. 데이터에서 월드를 만들 때 붙는다 */
  traits?: readonly import('./traits').Trait[];
}

export interface SimTeam {
  idx: number;
  name: string;
  franchise: string;
  /** 구단 소속 전체 (1군 + 2군) */
  org: SimPlayer[];
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
  /** 주자가 있는 타석에서 폭투·포일·보크로 주자가 한 베이스씩 가는 확률 */
  wildPitch: number;
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

export function emptyPitLine(): PitLine {
  return { g: 0, gs: 0, w: 0, l: 0, sv: 0, outs: 0, bf: 0, h: 0, hr: 0, bb: 0, hbp: 0, so: 0, r: 0, er: 0 };
}

export function emptyTeamRecord(): TeamRecord {
  return { g: 0, w: 0, l: 0, t: 0, rs: 0, ra: 0, homeW: 0, homeL: 0, homeT: 0 };
}
