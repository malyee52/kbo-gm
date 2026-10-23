// 리그 상태: 여러 해에 걸쳐 게임이 들고 다니는 선수·구단·계약 정보.
// 시즌 중에는 이 상태가 "그 시즌 개막 때"의 모습으로 고정되고, 시즌 중 변화(트레이드, 기록)는 Season이 가진다.
// 시즌이 끝나면 결산(commitSeason)에서 리그 상태에 반영한다.

import type { SeasonAwards } from './awards';
import type { TeamFinance } from './finance';
import type { EventState } from './events';
import type { ArchivedPlayer, SeasonBest, YearRecord } from './history';
import type { Article } from './articles';
import type { RivalPair } from './rivals';
import type { ChallengeState } from './challenges';
import type { Coach } from './coaches';
import type { Manager, ManagerChange } from './managers';
import type { AiTradeRecord, GmStyle } from './gm';
import type { AbroadState } from './overseas';
import type { DifficultySettings } from './difficulty';
import type { BatSkill, PitSkill, TeamRecord } from '../engine';
import type { Hand } from '../data/types';
import type { Difficulty, OwnerState } from './owner';
import type { PostseasonResult } from './postseason';

export type School = 'HS' | 'UNIV';

export type ContractKind =
  /** 보류 선수: 해마다 연봉 협상 */
  | 'reserve'
  /** 신인 (첫 시즌) */
  | 'rookie'
  /** FA 계약 */
  | 'fa'
  /** 비FA 다년 계약 */
  | 'nonFA'
  /** 외국인 선수 (연봉 단위는 달러) */
  | 'foreign';

export interface Contract {
  kind: ContractKind;
  /** 연봉. 만 원 단위 (외국인은 달러) */
  salary: number;
  /** 계약이 끝나는 마지막 시즌 */
  until: number;
  /** FA 계약금으로 미리 낸 한 해 몫 (만 원). 월말 연봉에서 빠진다 (finance.ts, 샐러리캡 계산은 salary 그대로) */
  prepaid?: number;
  /**
   * 외국인 계약금 (달러). 그 계약 시즌에 연봉과 함께 나가고, 외국인 금액 상한은 연봉 + 계약금으로 본다 (salary.ts foreignContractTotal,
   * 사용자 조사 2026-10-22). 지금은 실제 계약 자료(외국인_개막명단.csv)가 있는 선수만 있다 (생성식 계약은 연봉에 다 넣는다)
   */
  bonus?: number;
}

export interface LeaguePlayer {
  /** 해외에서 돌아온 시즌 (다시 포스팅을 요청하지 않는다, overseas.ts) */
  returnedFromAbroad?: number;
  /** 해외에 있다 (team = ABROAD, overseas.ts) */
  abroad?: AbroadState;
  /** 자유 모드에서 리그 밖(해외 리그·은퇴 등)에서 데려온 실존 인물. 엔진에서는 가상 선수(real false)로 다룬다 (자료에 기록이 없어서) */
  outsider?: boolean;
  /** 본업 반대쪽 능력 (투수의 타격, 타자의 투구, league/twoway.ts). 예전 저장에는 없다 */
  alt?: import('./twoway').AltAbility;
  /** 구단이 이도류로 쓴다 (반대쪽 자리에도 나간다) */
  twoWay?: boolean;
  /** 겸업 재능: 반대쪽 잠재력이 높다 (실제 지명 자료의 투타겸업, 가상 신인 일부) */
  twoWayTalent?: boolean;
  /** 육성선수: 정원(ORG_LIMIT) 밖, 1군에 못 나간다. 5월 1일~7월 31일에 정식 등록 (offseason.ts·session.ts) */
  dev?: boolean;
  /**
   * 계약하지 못한 FA (team = -1, 2026-10-21 사용자: "그걸 이제 육성선수나 2차드랩으로 만들어야지"). since = 미계약이 된 오프시즌, from = 원 소속.
   * 그 오프시즌 2차 드래프트 지명·육성선수 계약 후보가 되고, 남으면 다음 시즌 중 자유계약 선수(market)로 남는다. 그 시즌도 계약하지 못하면 은퇴 (offseason.ts)
   */
  freeAgent?: { since: number; from: number };
  /** 그 해 시즌 중 시장의 선수 (team = -1, market.ts). 시즌 월드에 소속 없이 들어와 시즌 중 영입할 수 있다 */
  market?: number;
  /** 자유 모드의 빈 자리 (그 해, src/fantasy/free.ts): 시즌 중 AI가 새 선수를 만들 때 채워 쓴다. 쓰기 전에는 어디에도 보이지 않는다 */
  reserve?: number;
  /** 시장에 나오는 때 (시즌의 몫 0~1). 실제 시즌 중 교체 외국인은 실제로 들어온 무렵부터 (create.ts, market.ts) */
  marketFrom?: number;
  /** 넘겨받은 지명권으로 입단한 선수: 이 시즌에는 트레이드할 수 없다 (picks.ts) */
  noTradeYear?: number;
  id: string;
  name: string;
  /** 새 외국인 후보의 이적료 (달러). 계약할 때 낸다 (finance.ts) */
  transferFee?: number;
  /** 실존 선수. 가상 선수(신인·외국인 후보)는 false */
  real: boolean;
  isPitcher: boolean;
  pos: string | null;
  bats: Hand | null;
  throws: 'R' | 'L' | null;
  foreign: boolean;
  /** 아시아쿼터 대상 (가상 외국인만 알 수 있다. 실존 외국인은 국적 자료가 없어 false) */
  asia: boolean;
  birthYear: number | null;
  school: School | null;
  entryYear: number;
  /** 지금 능력 (리그 대비 비율). 성장 판정 때 바뀐다 */
  bat: BatSkill | null;
  pit: PitSkill | null;
  /** 잠재력: 전성기에 도달할 수 있는 한 시즌 기여 (대체 선수 대비 런, 주전 출전 기준) */
  potential: number;
  /** 스카우트 평가 잠재력 (가상 신인만. 실제 잠재력 대신 화면과 AI 지명에 쓴다) */
  scoutPotential?: number;
  /** 직전 기록이 없어 그 해 기록으로 능력을 추정한 선수 (첫 시즌만) */
  estimated: boolean;
  /** 소속 구단 색인. -1 = 무소속 (방출, 미계약 FA) */
  team: number;
  contract: Contract;
  /** FA 자격 연차 (마지막 FA 계약 이후 또는 입단 이후 1군 시즌 수) */
  service: number;
  faCount: number;
  lastFaYear: number | null;
  /** 직전 시즌 세이브 (마무리 지정용) */
  lastSaves: number;
  /** 언더·사이드 투수 (실존은 자료, 가상 투수는 생성 때 실제 비율로). 없으면 정통파 (2026-10-22) */
  underhand?: boolean;
  /** 불펜 신뢰도 (engine/ratings.ts penTrustOf). 없으면 0 = 능력 순 (2026-10-22 추가, 예전 저장에는 없다) */
  penTrust?: number;
  /** 지난 시즌 기록 (게임 안에서 치른 시즌만) */
  history: SeasonLine[];
  /** 게임 시작 전 실제 기록에서 시작 구단 계보로 뛴 시즌 수 (팬덤의 프랜차이즈 스타 판정, stadium.ts). 게임 안 시즌은 history로 센다 */
  tenure0?: { franchise: string; seasons: number };
  // ---- M6 (없으면 기본값. M5 저장 호환)
  /** 병역. 외국인은 없음. 국내 선수인데 없으면 careers.ts의 ensureMilitary가 채운다 */
  military?: Military;
  /** 조기 노쇠: 노화 판정 때 이만큼 나이를 더 먹은 것으로 본다 */
  decline?: number;
  /** 다음 시즌 슬럼프: 그 시즌 동안만 능력을 이만큼 옮긴다 (shiftBat·shiftPit의 d, 음수) */
  slump?: number;
  /** 다음 시즌 개막부터 결장하는 일수 (넘어온 부상, 병역 복귀 전) */
  startAbsent?: number;
  /** 개막부터 결장하는 까닭 */
  startAbsentReason?: 'injury' | 'military';
  /** 다음 시즌 개막 때 혹사지수 (엔진 2 11단계, 기획안 4.6: 시즌 끝 값 × overuse.offseason). 숨김 값, 화면에 쓰지 않는다 */
  overuse?: number;
  /** 부상 이력 (게임 안에서 치른 시즌만, 장기·큰 부상) */
  injuries?: InjuryLine[];
  /** 생년이 자료에 없어 입단 연도로 가늠한 값 (M8). 화면에는 "약 N세" */
  birthYearEstimated?: boolean;
}

export type MilitaryState =
  /** 아직 복무하지 않음 */
  | 'pending'
  /** 복무 중 (월드에서 빠진다) */
  | 'serving'
  /** 방위병 복무 중 (1994년 입대까지, careers.ts): 리그에 남아 홈경기에만 나온다 */
  | 'homeOnly'
  /** 마침 (또는 시작 때 마친 것으로 본 선수) */
  | 'done'
  /** 면제 (아시안게임 금메달 등) */
  | 'exempt';

export interface Military {
  state: MilitaryState;
  /** 복무 중일 때: 입대한 해(이 시즌이 끝나고 입대) */
  enlisted?: number;
  /** 복무 중일 때: 복귀하는 시즌 */
  returnYear?: number;
  /** 복귀하는 시즌의 개막 뒤 복귀 일수 (0 = 개막 전). 없으면 MILITARY_RETURN_DAY (시작 자료의 복무, 2026-10-21 전 저장) */
  returnDay?: number;
  /** 복무 형태 (careers.ts ServiceKind): unit = 군 야구단(상무·경찰), active = 현역, reserve = 보충역. 없으면 unit (예전 저장·시작 자료) */
  kind?: 'unit' | 'active' | 'reserve';
  /** 시작 때 정한 상태의 근거: record = 실제 자료(military.json), estimate = 나이·1군 기록 공백으로 짐작 */
  basis?: 'record' | 'estimate';
  /** 근거 설명 (예: '상무', '2026 아이치·나고야 아시안게임 금메달'). 군 야구단 복무 중이면 '상무'·'경찰' */
  note?: string;
}

export interface InjuryLine {
  year: number;
  kind: 'long' | 'major';
  days: number;
  /** 부위 (엔진 2 11단계부터) */
  part?: import('../engine').InjuryPart;
  /** 시즌 끝까지 이어졌는가 */
  seasonOut: boolean;
}

/** 은퇴한 선수 (리그 상태에서는 빠지고 여기만 남는다) */
export interface RetiredRecord {
  id: string;
  name: string;
  real: boolean;
  /** 마지막 시즌 */
  year: number;
  age: number | null;
  /** 마지막 소속 구단 색인 */
  team: number;
  /** 은퇴 사유 */
  reason: 'age' | 'performance';
}

export interface SeasonLine {
  year: number;
  team: string;
  /** emptyBatLine / emptyPitLine 키 순서의 값 */
  bat?: number[];
  pit?: number[];
  /** 퓨처스리그(2군) 성적: futures.ts FUT_BAT_KEYS / FUT_PIT_KEYS 순서 (2026-10-12부터. 예전 시즌에는 없다) */
  fbat?: number[];
  fpit?: number[];
  /** 가을야구 성적: postseason.ts PS_BAT_KEYS / PS_PIT_KEYS 순서 (2026-10-12부터) */
  pbat?: number[];
  ppit?: number[];
}

export interface LeagueTeam {
  name: string;
  franchise: string;
}

/** 구단 돈 거래 기록. 구단 자금은 장부의 합이다 (finance.ts, 2026-10-11 재정 상세형) */
export interface LedgerEntry {
  year: number;
  /** 받는 구단 (-1 = 리그·모기업·바깥) */
  to: number;
  /** 내는 구단 (-1 = 리그·모기업·바깥) */
  from: number;
  /** 만 원 (2026년 돈) */
  amount: number;
  note: string;
  /** 구분 (finance.ts의 FinanceKind). 예전 장부에는 없다 */
  kind?: string;
}

export interface LeagueState {
  format: 1;
  /** 게임 시드 (오프시즌 난수도 여기서 갈라 쓴다) */
  seed: string;
  startYear: number;
  /** 지금 시즌 (오프시즌이면 막 끝난 시즌) */
  year: number;
  teams: LeagueTeam[];
  players: LeaguePlayer[];
  /** 막 끝난 시즌의 구단 성적 (드래프트 순서·성향 판정용) */
  /** hr: 리그 전체 홈런 ("달라지는 규칙"의 지난 시즌 한 줄, 2026-10-22부터. 예전 저장에는 없다) */
  lastSeason: { year: number; teams: TeamRecord[]; standings: number[]; postseason?: PostseasonResult; hr?: number } | null;
  /** 구장 (stadium.ts, 구단 색인) */
  stadiums?: import('./stadium').StadiumState[];
  /** 팬 만족도 (stadium.ts, 구단 색인) */
  fans?: import('./stadium').FanState[];
  /** 지난 결산 때 구장 소식 (완공·AI 공사) */
  stadiumNews?: string[];
  /** 지난 시즌 퓨처스리그 순위 (futures.ts, 결산 때). 오프시즌 순위 화면 */
  lastFutures?: { year: number; teams: { team: number; g: number; w: number; l: number; rs: number; ra: number }[] };
  ledger: LedgerEntry[];
  /** 가상 선수 일련번호 */
  nextVirtualId: number;
  /** 은퇴한 선수 (M6) */
  retired?: RetiredRecord[];
  // ---- M7 (없으면 기본값. M6 이전 저장 호환)
  /** 난이도 (AI의 잠재력 평가 오차). 없으면 보통 */
  difficulty?: Difficulty;
  /** 세부 난이도 (사용자 설정, difficulty.ts). 없으면 difficulty 묶음 */
  settings?: DifficultySettings;
  /** 시작 때의 세부 난이도 (재현 정보용. 게임 중 바꾼 것은 조작 기록에 남는다) */
  startSettings?: DifficultySettings;
  /** 시작 연도 능력 기준 (engine/params.ts ratingBasis, 2026-10-12). 없으면 'prior'(예전 저장) */
  ratingBasis?: 'season' | 'prior';
  /** 플레이어(단장)의 구단주 평가 상태 */
  owner?: OwnerState;
  /** 구단별 샐러리캡 연속 초과 횟수 */
  capStrikes?: number[];
  /**
   * 플레이어가 고른 프랜차이즈 예외 선수 id (구단 색인, salary.ts franchiseTag). 없거나 자격이 없어지면 연봉 최고 자격 선수를 자동 지정한다.
   * 2026-10-22부터, 예전 저장에는 없다 (모두 자동 지정)
   */
  franchiseTags?: (string | null)[];
  /** 미래 규칙 변경 ② (2028~, league/futureRules.ts): 바뀐 기록과 결산 때 남긴 신호. 2026-10-22부터, 예전 저장에는 없다 (변경 없음) */
  ruleShifts?: import('./futureRules').RuleShift[];
  ruleSignals?: import('./futureRules').RuleSignal[];
  /** 구단 투표 단장 회의 기록 (가결·부결 모두, ai/vote.ts·league/ruleVote.ts). 2026-10-23부터, 예전 저장에는 없다 */
  ruleVotes?: import('../ai/vote').RuleVoteRecord[];
  /** 구단별 샐러리캡 하한(2027~) 연속 미달 횟수 (owner.ts applyFloorSanctions). 예전 저장에는 없다 */
  floorStrikes?: number[];
  /** 구단별 지명권 하락 제재가 걸린 시즌 (그 시즌 뒤 드래프트에 적용) */
  draftPenalty?: (number | null)[];
  /** 구단별 재정 상태: 투자 단계, 지난 결산 (2026-10-11 재정 상세형). 자금은 장부의 합 */
  finance?: TeamFinance[];
  /** 시즌 중 무작위 이벤트: 오늘 확률, 답을 기다리는 이벤트, 기록, 관중 효과 (events.ts, 2026-10-11) */
  events?: EventState;
  /** 리그를 떠난 선수의 게임 안 통산 (history.ts, 2026-10-11) */
  archive?: ArchivedPlayer[];
  /** 게임 안 시즌의 리그 환경 (war.ts, 결산 때). 시즌 가치(WAR)를 다시 계산할 때 쓴다. 예전 저장에는 없다 (그 해 실제 자료로 대신) */
  seasonEnv?: Record<string, import('./war').WarEnv>;
  /** 게임 안 시즌의 세이버 리그 기준값 (game/saber.ts leagueBase, 결산 때). 선수 상세의 지난 시즌 wRC+·FIP. 예전 저장에는 없다 (2026-10-22) */
  seasonSaber?: Record<string, { woba: number; runsPerPa: number; fipConst: number }>;
  /** 게임 안 시즌의 연표: 순위·우승·준우승 (history.ts) */
  yearbook?: YearRecord[];
  /** 게임 안 시즌의 단일 시즌 기록 부문별 상위 (history.ts) */
  seasonBests?: Record<string, SeasonBest[]>;
  /** 구단 레전드 (영구결번 대신, history.ts) */
  legends?: { franchise: string; id: string; name: string; year: number }[];
  /** 규칙으로 만든 기사 (articles.ts, 최근 400건) */
  articles?: Article[];
  /** 그 시즌의 라이벌 쌍 (개막 때 연표로 계산, rivals.ts) */
  rivals?: { year: number; pairs: RivalPair[] };
  /** 넘어간 신인 지명권 (picks.ts). 없으면 원래 구단 것 */
  pickOwners?: { draft: number; round: number; from: number; owner: number }[];
  /** 도전 모드 진행 (challenges.ts) */
  challenge?: ChallengeState;
  /** 판타지 모드 (AI 이야기, src/fantasy). 없으면 보통 게임 */
  fantasy?: import('../fantasy/types').FantasyState;
  /** 바뀐 리그 규정 (league/rules.ts). 자유 모드에서만 바뀐다. 없으면 실제 규정 */
  rules?: Partial<import('./rules').RuleSet>;
  /** 구단별 코치 (coaches.ts) */
  coaches?: Coach[][];
  /** 구단별 감독 (managers.ts). 해임 뒤 개막 전까지는 null */
  managers?: (Manager | null)[];
  /** 감독 교체 기록 (최근 200건) */
  managerLog?: ManagerChange[];
  /** 구단별 AI 단장 성향 (gm.ts) */
  gm?: GmStyle[];
  /** AI 구단끼리 트레이드 기록 (gm.ts) */
  aiTrades?: AiTradeRecord[];
  /** 시즌 중 방출·영입 (market.ts) */
  marketMoves?: import('./market').MarketMove[];
  /**
   * 이벤트(AI 구단의 트레이드 제안)를 받아들여 이뤄진 우리 트레이드 (선수 ID). 조작 기록에는 'event'로만 남아
   * 불러오기 때 그해 트레이드 목록(연봉 귀속)을 다시 만들려면 따로 적어 둬야 한다 (2026-10-12)
   */
  eventTrades?: { year: number; day: number; team: number; give: string[]; get: string[] }[];
  /**
   * 월간 MVP 기사의 기준점: 그 달이 시작될 때의 선수별 시즌 기록 (선수 ID → [타석, 타수, 안타, 2루타, 3루타, 홈런, 볼넷, 사구, 희생플라이, 타점, 아웃, 자책, 승, 탈삼진, 세이브]).
   * 저장했다 불러와도 같은 기사가 나오게 리그 상태에 둔다 (2026-10-12)
   */
  storyMonth?: { year: number; month: number; lines: Record<string, number[]> };
  /** 시즌 시상 기록 (2026-10-08 추가, 게임 안에서 치른 시즌만) */
  awards?: SeasonAwards[];
  /** 올스타전 기록 (allstar.ts, 2026-10-14) */
  allStars?: import('./allstar').AllStarRecord[];
  /** 스프링캠프 기록 (camp.ts, 최근 5년) */
  camps?: import('./camp').CampRecord[];
  /** 단장 평판 (reputation.ts). 구단을 옮겨도 따라간다 */
  reputation?: import('./reputation').RepState;
  /** 플레이어가 고른 다음 시즌 캠프 (year = 그 시즌) */
  campPlan?: { year: number; pick: import('./camp').CampPick };
  /**
   * 창단 구단 (M8): 첫 시즌 뒤 두 번째 드래프트까지 추가 지명권, 1군 첫 두 시즌 창단 특례 (eras.ts expansionPerk).
   * 시작 때 이미 1군인 구단도 특례 기간이 남았으면 넣는다 (create.ts, 2026-10-23)
   */
  expansions?: { team: number; firstYear: number }[];
}
