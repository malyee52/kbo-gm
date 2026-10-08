// 리그 상태: 여러 해에 걸쳐 게임이 들고 다니는 선수·구단·계약 정보.
// 시즌 중에는 이 상태가 "그 시즌 개막 때"의 모습으로 고정되고, 시즌 중 변화(트레이드, 기록)는 Season이 가진다.
// 시즌이 끝나면 결산(commitSeason)에서 리그 상태에 반영한다.

import type { BatSkill, PitSkill, TeamRecord } from '../engine';
import type { Hand } from '../data/types';

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
}

export interface LeaguePlayer {
  id: string;
  name: string;
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
  /** 지난 시즌 기록 (게임 안에서 치른 시즌만) */
  history: SeasonLine[];
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
  /** 부상 이력 (게임 안에서 치른 시즌만, 장기·큰 부상) */
  injuries?: InjuryLine[];
}

export type MilitaryState =
  /** 아직 복무하지 않음 */
  | 'pending'
  /** 복무 중 (월드에서 빠진다) */
  | 'serving'
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
}

export interface InjuryLine {
  year: number;
  kind: 'long' | 'major';
  days: number;
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
}

export interface LeagueTeam {
  name: string;
  franchise: string;
}

/** 구단 돈 거래 기록 (보상금 등). 예산 모델(M7) 전에는 기록만 한다 */
export interface LedgerEntry {
  year: number;
  /** 받는 구단 (-1 = 리그) */
  to: number;
  /** 내는 구단 */
  from: number;
  /** 만 원 */
  amount: number;
  note: string;
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
  lastSeason: { year: number; teams: TeamRecord[]; standings: number[] } | null;
  ledger: LedgerEntry[];
  /** 가상 선수 일련번호 */
  nextVirtualId: number;
  /** 은퇴한 선수 (M6) */
  retired?: RetiredRecord[];
}
