// 게임 진행 상태: 리그 상태(여러 해) + 지금 시즌(Season) + 오프시즌 단계, 플레이어 구단의 조작, 알림, 저장.
// 화면에 의존하지 않으므로 Node에서도 그대로 돌릴 수 있다 (시즌 완주·오프시즌 테스트가 이용).
//
// 흐름: 새 게임(createLeague) → 시즌 진행 → 시즌 종료 → beginOffseason(결산) → 오프시즌 단계들 → openNextSeason → 다음 시즌 ...
// 시즌 중 리그 상태는 "그 시즌 개막 때"로 고정되고, 트레이드·기록은 Season이 가진다. 결산 때 리그 상태에 반영한다.

import { markTold, pruneUndrafted, watchNews, watchStatus, type WatchEntry, type WatchNewsCtx, type WatchStatus } from './watch';
import type { DataStore } from '../data/types';
import {
  absenceLabel, assignSlots, condLine, conditionOf, battingOrder, bullpenOrder, currentFatigue, DEFAULT_PARAMS, isStarterSkill, Rng, LINEUP_SLOTS, MIN_ACTIVE_HITTERS, MIN_ACTIVE_PITCHERS, Season, todaysStarter,
  type Absence, type BatLine, type PitLine, type DepthPlan, type PenRole, type EngineParams, type GameCommand, type SeasonSave, type SimPlayer, type Slot, type TeamSeason, type World,
} from '../engine';
import { coreAge, evaluateTrade, horizonWeights, SALARY_WON_PER_RUN, suggestPackageWhy, tendencyOf, type PackageResult, type TeamSituation, type Tendency, type TradeEvaluation } from '../ai/trade';
import { currentRuns, playerValue, teamStrength, valueContext, type ValueContext } from '../ai/value';
import { createLeague } from '../league/create';
import * as Off from '../league/offseason';
import type { VoteChoice } from '../ai/vote';
import { leagueView } from '../league/offseason';
import type { LeaguePlayer, LeagueState } from '../league/types';
import { worldFromLeague } from '../league/world';
import { ruleNews, ruleSnapshot, type RuleNews } from '../league/ruleNews';
import { changeText } from '../league/eras';
import { quoteLine, voice } from '../league/voices';
import { condToday, ensureEvents, eventDef, formToday, resolveEvent, rollEvent, type EventContext, type PendingEvent } from '../league/events';
import { avg, era, fixed2, ipText, ops, rate3 } from './stats';
import { futuresExtras, futuresSeason, registeredOf, type FuturesExtra } from '../league/futures';
import { COACH_ROLE_LABEL, COACH_STYLE_LABEL, coachEdge, coachMarketInSeason, ensureCoaches, hireCoach, type Coach } from '../league/coaches';
import { AI_TRADE_CHANCE, AI_TRADE_EVERY, ensureGm, gmStyle } from '../league/gm';
import { pickTradeAllowed, settingsOf, type DifficultySettings } from '../league/difficulty';
import { activeLevel, MEDICAL_RATE } from '../league/finance';
import { dollarText, minSalary, wageIndex, wonText } from '../league/salary';
import { WON_PER_USD } from '../league/finance';
import { challengeById, challengeProgress, judgeChallenge, newChallenge } from '../league/challenges';
import { HOMEGROWN, type SeasonMark } from '../league/campaigns';
import type { BoxScore, CommandChoice, CommandRequest, Play } from '../engine';
import { lineTeam } from '../engine/types';
import { addFantasyEntry, applyArc, goodwillFor, type FantasyEntry, type FantasyState } from '../fantasy/types';
import type { FantasyEffect } from '../fantasy/effects';
import { looksForeignName, runsForGrade, type FreeOp } from '../fantasy/free';
import { applyPromises, type Now } from '../fantasy/promises';
import { offerExpired, RIVAL_OFFER_DAYS } from '../fantasy/rivals';
import { batValue, FIELD_POS, makeDefense, pitValue, type Defense } from '../engine';
import { skillForRuns } from '../league/growth';
import { ensureAlts, setTwoWay as setTwoWayAbility } from '../league/twoway';
import {
  aiMarketDay, financeMoves, foreignSwapsUsed, marketDeadlineDay, marketPlayers, releaseBlock, releaseCost, releasePlayer,
  settleMarketContracts, signBlock, signPlayer, type MarketCtx,
} from '../league/market';
import {
  careers, FAREWELL_DAYS, FAREWELL_FILL, farewellWorthy, hallOfFame, LEGEND_SEASONS, legendCandidates, recordSeasonBests, recordYear,
  seasonBests, yearbook,
} from '../league/history';
import { addArticle, crossed, josa, MILESTONES, STREAK_FROM, type ArticleKind } from '../league/articles';
import {
  ownedPicks, parsePick, PICK_MAX_ROUND, PICK_TRADE_FROM, PICK_YEARS_AHEAD, pickId, pickOwner, pickValue,
  pickLedger, tradablePick, transferPick, type DraftPick, type PickLedgerRow,
} from '../league/picks';
import { computeRivals, DYNASTY_TITLES, dynasties, rivalsOf, titleStreak } from '../league/rivals';
import {
  cashOf, ensureFinance, FINANCE_LABEL, seasonFlows, setInvest, settleSeason, trustFromFinance,
  type FinanceKind, type FinanceYear, type InvestKind, type SeasonFlows, type TradeMove,
} from '../league/finance';
import { ballHrMul, corRange, seasonCor, shiftsFor } from '../league/futureRules';
import { aiEnlistPicks, enlistCandidates, normalizeApply, normalizeEnlist, runsNow, type EnlistCandidate } from '../league/careers';
import {
  ACHIEVEMENTS, aiPotential, applyCapSanctions, applyFloorSanctions, FIRE_BELOW, GOAL_LABEL, goalFor, newAchievements, newOwner, outcomeLabel,
  outcomeOf, START_TRUST, trustDelta, type Difficulty, type OwnerState,
} from '../league/owner';
import {
  currentSeries, playNextGame, postseasonLines, PS_BAT_KEYS, PS_PIT_KEYS, resultOf, ROUND_LABEL, RULES, startPostseason, stillAlive,
  type PostseasonResult, type PostseasonState, type SeriesGame,
} from '../league/postseason';
import { dateOf, formatDate, shortDate } from './calendar';
import { addFanEvent, FAN_LOSS, orderStadium, starLeaves, type ParkSize } from '../league/stadium';
import { ALLSTAR_FAN, allStarDay, playAllStar, SIDE_NAMES, type AllStarRecord } from '../league/allstar';
import { DEFAULT_CAMP, isCampPick, runCamps, type CampPick } from '../league/camp';
import { openNaming, signNaming } from '../league/naming';
import { offersByRep, repGoodwill, repOf, updateReputation } from '../league/reputation';
import { isFuturesTeam } from '../league/world';
import { changeManagerInSeason, ensureManagers, fireManager, hireManager, infoOf, managerOf, openManagers, replaceManager, tacticsOf } from '../league/managers';
import { DEFAULT_STOPS, stopRules, stopsOnEvent, type Attention, type StopRules } from './stops';
import { ruleDate, ruleOf, RULE_DEFAULTS, RULE_DEFS } from '../league/rules';

/** 중계·하이라이트용 우리 경기 (정규시즌 또는 가을야구) */
export interface CastGame {
  key: string;
  year: number;
  /** 일정 색인 */
  day: number;
  home: number;
  away: number;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  /** 중계 기록 (최근 경기만 메모리에 남는다. 불러온 게임의 지난 경기는 없음) */
  plays?: Play[];
  box?: BoxScore;
  /** 가을야구 시리즈 이름 */
  label?: string;
  /** 정규시즌 경기 로그 색인 (차전·승패 투수를 찾는다). 가을야구는 없다 */
  logIdx?: number;
}

/** 직접 지휘 미리보기 결과 (commandPreview) */
export interface CommandPreview {
  /** 다음 물음. 없으면 경기가 끝났다 */
  req: CommandRequest | null;
  /** 지금까지의 선택 (자동으로 넘긴 물음은 빈 선택) */
  choices: CommandChoice[];
  plays: Play[];
  home: number;
  away: number;
  /** 경기가 끝났을 때 점수 */
  final?: { away: number; home: number };
}

/** 미리보기를 멈추는 신호 (엔진 지휘 함수가 던진다) */
class CommandPause {
  constructor(readonly req: CommandRequest) {}
}

/** 위기·승부처: 7회 이후, 2점 차 안, 득점권 주자 (StopRules.crisis) */
export function isCrisis(req: CommandRequest): boolean {
  return req.inn >= 7 && Math.abs(req.away - req.home) <= 2 && (req.bases[1] >= 0 || req.bases[2] >= 0);
}

export interface NewGameOptions {
  year: number;
  teamIdx: number;
  seed: string;
  /** 난이도 (AI의 잠재력 평가 오차, M7). 없으면 보통 */
  difficulty?: Difficulty;
  /** 도전 모드 id (league/challenges.ts). 구단 조건(직전 시즌 꼴찌 등)은 시작 화면이 맞춰 teamIdx로 넘긴다 */
  challenge?: string;
  /** 세부 난이도 (사용자 설정, league/difficulty.ts). 없으면 difficulty 묶음 */
  settings?: DifficultySettings;
  /** 시작 연도 능력 기준: 'season' 역사 재현(그 시즌 기록 중심), 'prior' 예측(직전 3시즌). 없으면 'prior' (예전 조작 기록과 같게) */
  ratingBasis?: 'season' | 'prior';
  /** 판타지 모드 (AI 이야기, docs/fantasy-mode.md). regressor: 회귀자 (단장이 원래 역사를 기억한다) */
  fantasy?: { regressor?: boolean; free?: boolean };
}

/** 버그 보고용 재현 정보. `GameSession.replay(store, opts, actions, at)`에 그대로 넣으면 같은 상태가 된다 */
export interface ReproInfo {
  /** 새 게임 조건: 시작 연도, 처음 맡은 구단, 게임 시드, 난이도 */
  opts: NewGameOptions;
  /** 지금 위치 (오프시즌이면 막 끝난 시즌 연도와 마지막 날) */
  at: { year: number; day: number; phase: 'season' | 'offseason' };
  actions: GameAction[];
}

export type NewsKind = 'absence' | 'return' | 'callup' | 'entry' | 'season' | 'trade' | 'offseason' | 'plan' | 'owner' | 'event' | 'watch';

/** 기용표를 선수 id로 적은 것 (조작 기록용) */
export interface PlanIds {
  starters: Partial<Record<Slot, string>>;
  rotation: string[];
  closer: string | null;
  order?: Slot[];
  pen?: Record<string, PenRole>;
}

/** 투수 보직. RP는 역할을 정하지 않은 구원 (AI 감독이 서열대로 추격조 등으로 쓴다) */
/** AI 구단이 트레이드를 제안해 오는 하루 확률 (트레이드 마감 전, 임시값). 마감까지 약 125일이라 한 시즌 대여섯 번 */
export const TRADE_OFFER_CHANCE = 0.05;

export type PitcherRole = 'SP' | 'SU' | 'RP' | 'LR' | 'MOP' | 'CL';
export const PITCHER_ROLE_LABEL: Record<PitcherRole, string> = { SP: '선발', CL: '마무리', SU: '필승조', RP: '추격조', LR: '롱릴리프', MOP: '패전조' };

export interface NewsItem {
  /** 시즌 연도 (없으면 시작 연도. 형식 1 저장 호환) */
  year?: number;
  /** 일정 색인. 오프시즌 알림은 -1 */
  day: number;
  kind: NewsKind;
  text: string;
}

/**
 * 플레이어의 조작 기록. 같은 시드에서 같은 조작을 같은 순서·같은 날에 다시 하면 같은 결과가 나온다 (버그 재현용).
 * 시즌 중 조작은 day(그날 경기 전), 오프시즌 조작은 순서대로 적용한다. year가 없으면 시작 연도 (형식 1 저장 호환).
 */
export type GameAction =
  | { year?: number; day: number; type: 'entry'; ids: string[] | null }
  | { year?: number; day: number; type: 'trade'; team: number; give: string[]; get: string[]; cash?: number; pg?: string[]; pr?: string[] }
  | { year: number; day: number; type: 'plan'; plan: PlanIds | null }
  | { year: number; day: number; type: 'event'; choice: number }
  /** 직접 지휘한 그날 우리 경기의 선택 (물음 순서대로, engine/game.ts CommandChoice). 선수는 그 시즌 월드의 색인 */
  | { year: number; day: number; type: 'command'; choices: CommandChoice[] }
  /** enlist: 결산 때 우리 구단 입대 명단 (시즌 결과의 입대 선택). 없으면 AI 규칙 (이전 저장).
   *  apply: 그중 군 야구단(상무·경찰) 지원 명단. 없으면 지원할 수 있는 선수 모두 (2026-10-21 전 기록) */
  | { year: number; type: 'begin-off'; enlist?: string[]; apply?: string[] }
  | { year: number; type: 'fa-offer'; id: string; salary: number; years: number }
  | { year: number; type: 'fa-withdraw'; id: string }
  | { year: number; type: 'foreign-keep'; id: string; keep: boolean }
  | { year: number; type: 'foreign-sign'; id: string }
  | { year: number; type: 'draft'; id: string | null }
  | { year: number; type: 'draft-auto' }
  | { year: number; type: 'salary-offer'; id: string; amount: number }
  | { year: number; type: 'comp-protect'; fa: string; ids: string[] }
  | { year: number; type: 'comp-pick'; fa: string; pick: string }
  | { year: number; type: 'comp-auto' }
  /** 2차 드래프트·창단 특별 지명: 우리 보호 명단, 지명 희망 순서 (offseason.ts ProtectDraft) */
  | { year: number; type: 'pd-protect'; kind: 'second' | 'expansion'; ids: string[] }
  | { year: number; type: 'pd-wish'; kind: 'second' | 'expansion'; ids: string[] }
  | { year: number; type: 'invest'; kind: InvestKind; level: number }
  /** 구장 공사 주문 (stadium.ts stadiumOptions의 id) */
  | { year: number; type: 'stadium'; id: string; size?: ParkSize; dome?: boolean; deal?: 'push' }
  | { year: number; type: 'camp'; pick: CampPick }
  | { year: number; type: 'naming'; id: string }
  /** 감독 해임·선임 (managers.ts) */
  | { year: number; type: 'mgr-fire' }
  | { year: number; type: 'mgr-hire'; name: string }
  | { year: number; type: 'mgr-replace'; name: string }
  | { year: number; type: 'legend'; id: string }
  | { year: number; type: 'to-dev'; id: string }
  | { year: number; type: 'sign-dev'; id: string }
  | { year: number; type: 'promote-dev'; id: string }
  | { year: number; type: 'hire-coach'; id: string }
  | { year: number; type: 'posting'; id: string; accept: boolean }
  | { year: number; type: 'extend'; id: string; years: number }
  /** 프랜차이즈 예외 선수 고르기 (2026~ 샐러리캡, league/salary.ts franchiseTag). null = 자동 지정 */
  | { year: number; type: 'franchise-tag'; id: string | null }
  | { year?: number; day: number; type: 'convert'; id: string }
  /** 시즌 중 방출(웨이버 공시)·시장 선수 영입 (league/market.ts) */
  | { year: number; day: number; type: 'release-in'; id: string }
  | { year: number; day: number; type: 'mgr-change'; name: string | null }
  | { year: number; day: number; type: 'hire-coach-in'; id: string }
  | { year: number; day: number; type: 'sign-in'; id: string }
  /** 판타지 모드: AI가 만든 글(기사·대화·사건). 재현 때는 AI를 다시 부르지 않고 이 기록을 그대로 넣는다 (docs/fantasy-mode.md) */
  | { year: number; day: number; type: 'ai'; entry: FantasyEntry }
  | { year: number; type: 'ai-off'; entry: FantasyEntry }
  /** 판타지 선택 (대화의 제안·사건의 선택지). id는 이야기 글 id */
  | { year: number; day: number; type: 'ai-choice'; id: string; choice: number }
  | { year: number; type: 'ai-choice-off'; id: string; choice: number }
  | { year?: number; day: number; type: 'settings'; s: DifficultySettings }
  /** 수비 능력치 직접 고치기 (2026-10-13 사용자 선택). def는 포지션별 수비 런 */
  | { year?: number; day: number; type: 'def-edit'; id: string; def: Defense }
  | { year: number; type: 'def-edit-off'; id: string; def: Defense }
  /** 이도류로 쓰기·그만두기 (league/twoway.ts, 우리 구단 선수) */
  | { year?: number; day: number; type: 'two-way'; id: string; on: boolean }
  | { year: number; type: 'two-way-off'; id: string; on: boolean }
  | { year: number; type: 'settings-off'; s: DifficultySettings }
  | { year: number; type: 'release'; id: string }
  | { year: number; type: 'release-auto' }
  | { year: number; type: 'claim'; id: string }
  /** 단장 회의 우리 표 (구단 투표, league/ruleVote.ts). agenda = 안건 id (없으면 첫 안건). 마지막 표로 개표, 안 내면 반대 */
  | { year: number; type: 'rule-vote'; choice: VoteChoice; agenda?: string }
  | { year: number; type: 'next' }
  | { year: number; type: 'accept-offer'; team: number }
  | { year: number; type: 'open' };

type OffAction = Exclude<GameAction, { day: number }>;

export interface TradeRecord {
  day: number;
  /** 상대 구단 색인 */
  team: number;
  give: number[];
  get: number[];
  /** 내준·받은 지명권 (picks.ts pickId) */
  pg?: string[];
  pr?: string[];
}

/** 진행을 멈출 만한 1군 선수 이탈 기간 기본값 (일, 임시값. 멈춤 설정 stops.ts injuryDays로 바꿀 수 있다) */
export const ATTENTION_DAYS = DEFAULT_STOPS.injuryDays;

/** 육성선수 정식 등록이 되는 첫날 (KBO 규정 5월 1일) */
export const DEV_REGISTER_FROM = { month: 5, date: 1 };
/** AI 구단은 5월 1일에 지금 기여가 이 런 이상인 육성선수를 정원 안에서 정식 등록한다 (2026-10-21 사용자 결정, 기준값은 임시값: 대체 선수 수준) */
export const AI_DEV_REGISTER_RUNS = 0;

/** 1군 말소 뒤 다시 등록할 수 있을 때까지 (KBO 규정 10일) */
export const REREGISTER_DAYS = 10;

/** 트레이드 마감: 7월 31일 (임시값. 실제 규정 날짜는 확인 필요) */
export const TRADE_DEADLINE = { month: 7, date: 31 };

/** 형식 1: M3·M4 (한 시즌만, 리그 상태 없음) */
export interface GameSaveV1 {
  app: 'kbo-gm';
  format: 1;
  year: number;
  teamIdx: number;
  teamName: string;
  seed: string;
  season: SeasonSave;
  news: NewsItem[];
  actions: GameAction[];
}

/** 형식 2: M5부터. 리그 상태와 단계(시즌·오프시즌)를 담는다 */
export interface GameSaveV2 {
  app: 'kbo-gm';
  format: 2;
  /** 지금 시즌 (오프시즌이면 막 끝난 시즌) */
  year: number;
  teamIdx: number;
  teamName: string;
  seed: string;
  phase: 'season' | 'offseason';
  /** 시즌 중: 그 시즌 개막 때의 리그 상태. 오프시즌: 지금 리그 상태 */
  league: LeagueState;
  season: SeasonSave;
  /** 가을야구 진행 상태 (정규시즌이 끝난 뒤, M7) */
  postseason?: PostseasonState;
  /** 오프시즌일 때: 막 끝난 시즌을 다시 열기 위한 개막 때 리그 상태 */
  finishedLeague?: LeagueState;
  offseason?: Off.OffseasonState;
  /** 시즌이 끝난 뒤 고른 우리 구단 입대 명단 (결산 전까지만. 없으면 추천대로) */
  enlistChoice?: string[];
  /** 그중 군 야구단 지원 명단 (결산 전까지만. 없으면 지원할 수 있는 선수 모두) */
  applyChoice?: string[];
  /** 관심 명단 (game/watch.ts, 2026-10-23). 조작 기록 밖 화면 상태라 예전 저장에는 없다 (빈 목록) */
  watch?: WatchEntry[];
  news: NewsItem[];
  actions: GameAction[];
}

export type GameSave = GameSaveV1 | GameSaveV2;

/** 트레이드에 넣는 지명권: give = 우리가 내주는 것, get = 받는 것 */
export interface PickSwap { give: DraftPick[]; get: DraftPick[] }
/** 선수 내놓기 제안 (session.shopOffers): 그 구단이 내줄 선수와 지명권, 우리 쪽에서 본 가치 (런) */
export interface ShopOffer { team: number; get: SimPlayer[]; picks: DraftPick[]; value: number }
/** 선수 내놓기에서 받고 싶은 것 */
export type ShopWant = 'any' | 'players' | 'picks';
const NO_PICKS: PickSwap = { give: [], get: [] };

/** 기사 판정용 (세션 메모리) */
type Tot = { h: number; hr: number; w: number; sv: number; so: number };
interface ArticleState {
  year: number;
  base: Map<string, Tot>;
  prev: Map<string, Tot>;
  records: Record<string, number>;
  broken: Set<string>;
  streak: number[];
  logIdx: number;
  // ---- 잡다한 기사 (2026-10-12): 경기·데뷔 첫 기록·순위·부상·월간 MVP·인터뷰
  /** 경기 기사를 어디까지 봤나 (season.log 색인) */
  gameIdx: number;
  /** 지난번 선두 (20경기 전에는 -1) */
  leader: number;
  /** 우리 구단이 가을야구권에 있었나 */
  psIn: boolean;
  /** 부상 기사를 어디까지 봤나 (season.absences 색인) */
  absSeen: number;
  /** 월간 MVP: 이번 달 */
  month: number;
}
/** 단장 인터뷰 간격 (일, 임시값) */
const GM_INTERVIEW_EVERY = 21;
/** 다른 구단 화제 경기 기사를 내는 하루 확률 (임시값) */
const LEAGUE_GAME_CHANCE = 0.3;
const SEASON_KEYS = ['hr', 'h', 'rbi', 'sb', 'w', 'sv', 'so'];
const SEASON_LABEL: Record<string, string> = { hr: '홈런', h: '안타', rbi: '타점', sb: '도루', w: '승', sv: '세이브', so: '탈삼진' };

export interface EntryCheck {
  /** 지켜야 하는 규정 위반. 있으면 바꾸지 않는다 */
  errors: string[];
  /** 바꿀 수는 있지만 알려 줄 것 */
  warnings: string[];
}

type Store = Pick<DataStore, 'meta' | 'players' | 'season' | 'contracts' | 'managers' | 'ruleChanges'>;

const clone = <T>(x: T): T => structuredClone(x);

/** 시즌별 시드: 첫 시즌은 게임 시드 그대로 (M3·M4 저장과 같은 결과), 그 뒤는 연도를 붙인다 */
function seasonSeed(league: LeagueState): string {
  return league.year === league.startYear ? league.seed : `${league.seed}/${league.year}`;
}

export class GameSession {
  readonly store: Store;
  readonly params: EngineParams;
  /** 맡은 구단. 해고된 뒤 영입 제의를 받아들이면 바뀐다 (M7) */
  teamIdx: number;
  league: LeagueState;
  /** 지금 시즌의 월드 (오프시즌이면 막 끝난 시즌의 것, 읽기 전용) */
  world: World;
  season: Season;
  phase: 'season' | 'offseason' = 'season';
  /** 가을야구 (정규시즌이 끝나면 대진이 정해지고 한 경기씩 진행한다). 결산 뒤에도 다음 개막 전까지 남겨 화면에 보여 준다 */
  postseason: PostseasonState | null = null;
  offseason: Off.OffseasonState | null = null;
  /** 오프시즌 동안 막 끝난 시즌을 다시 열 수 있게 둔 개막 때 리그 상태 */
  private finishedLeague: LeagueState | null = null;
  readonly news: NewsItem[] = [];
  readonly actions: GameAction[] = [];
  /** 이번 시즌 트레이드 */
  trades: TradeRecord[] = [];
  /** 시즌이 끝난 뒤 플레이어가 고른 입대 명단 (결산 때 쓴다). null이면 추천대로 */
  enlistChoice: string[] | null = null;
  /** 그중 군 야구단(상무·경찰) 지원 명단. null이면 지원할 수 있는 선수 모두 */
  applyChoice: string[] | null = null;
  /** 관심 명단 (game/watch.ts). 저장 파일에 담지만 조작 기록에는 넣지 않는다 (재현과 상관없음) */
  watch: WatchEntry[] = [];
  private lastCallUps = new Set<number>();
  /** 기사 판정용 기준값 (메모리에만, 불러오기·재현 때 같은 규칙으로 다시 만든다) */
  private articleState: ArticleState | null = null;
  private valueCtx: ValueContext | null = null;
  /** 오프시즌 화면용 가치 계산 (조작할 때마다 다시 만든다) */
  private viewCache: { version: number; view: Off.LeagueView } | null = null;
  private offVersion = 0;
  /** 이번 시즌 "달라지는 규칙" (메모리에만, 자료·연도·규칙 값으로 다시 계산한다) */
  private ruleCache: RuleNews | null = null;

  private constructor(store: Store, params: EngineParams, teamIdx: number, league: LeagueState, world: World, season: Season) {
    this.store = store;
    this.params = params;
    this.teamIdx = teamIdx;
    this.league = league;
    this.world = world;
    this.season = season;
    ensureManagers(league, store);
    this.applyTactics();
  }

  // ---- 직접 지휘 (경기 개입, 2026-10-12 사용자 요청: 대주자·대타·작전·투수 교체)

  /** 조작 기록으로 받은 그날 지휘 선택 (하루 진행 때 쓰고 비운다) */
  private pendingCommand: { day: number; choices: CommandChoice[] } | null = null;
  /** 자동 진행이 위기에서 멈췄을 때의 미리보기 (화면이 지휘 창을 연다) */
  crisis: CommandPreview | null = null;
  /** 미리보기용 개막 월드 (시즌마다 한 번 만든다. 시즌 중 리그 상태는 개막 때로 고정이다) */
  private openingWorld: { season: Season; world: World } | null = null;

  /** 오늘(아직 치르지 않은 날) 우리 경기가 있나 */
  get hasGameToday(): boolean {
    const s = this.season;
    return this.phase === 'season' && !s.done && !!s.schedule[s.day]?.some((g) => g.home === this.teamIdx || g.away === this.teamIdx);
  }

  /** 오늘 우리 경기를 직접 지휘할 수 있나 (정규시즌, 또는 가을야구에서 다음 경기가 우리 경기. 답할 이벤트 없음) */
  get canCommand(): boolean {
    return (this.hasGameToday || this.ourPostseasonGameNext) && !this.pendingEvent;
  }

  /** 가을야구의 다음 경기가 우리 경기인가 (직접 지휘, 2026-10-12) */
  get ourPostseasonGameNext(): boolean {
    if (!this.postseasonRunning) return false;
    const x = currentSeries(this.postseason!);
    return !!x && (x.high === this.teamIdx || x.low === this.teamIdx);
  }

  /** 하루 진행 직전 준비 (실제 진행과 미리보기가 같게) */
  private prepareDay(s: Season): void {
    s.setForm(this.formWithCoaches(formToday(this.league, this.world.year, s.day, this.world.players)));
    s.setCondEvents(condToday(this.league, this.world.year, s.day, this.world.players)?.value ?? null);
  }

  /**
   * 화면용 선수 컨디션 한 줄 "낱말 · 사유" (엔진 2 12단계, docs/컨디션_기획안.md 6장). 숫자는 내보내지 않는다.
   * 기복·숨은 능력·경기 결과를 읽지 않는다 (흐름 + 몸 상태 사건만)
   */
  conditionText(idx: number): string {
    const s = this.season;
    const day = Math.min(s.day, s.schedule.length - 1);
    const ev = condToday(this.league, this.world.year, day, this.world.players);
    return condLine(conditionOf(s.conditionFlow(idx, day), ev?.value[idx] ?? 0), this.params.cond, ev?.reason.get(idx));
  }

  /** 실제 시즌을 건드리지 않는 복사본 (개막 월드를 복사해 지금 시즌 상태를 복원한다) */
  private scratchSeason(): Season {
    if (this.openingWorld?.season !== this.season) {
      this.openingWorld = { season: this.season, world: worldFromLeague(clone(this.league), this.store, this.params) };
    }
    const base = this.openingWorld.world;
    const players = base.players.map((p) => ({ ...p }));
    const world: World = { ...base, players, teams: base.teams.map((t) => ({ ...t, org: t.org.map((p) => players[p.idx]) })) };
    const s = Season.restore(world, this.params, this.season.toSave());
    s.teamSeasons.forEach((ts, i) => { ts.tactics = this.season.teamSeasons[i].tactics; });
    return s;
  }

  /**
   * 직접 지휘 미리보기: choices까지 고른 상태로 오늘을 복사본에서 돌려 다음 물음에서 멈춘다. 실제 게임은 그대로다.
   * mode: next 바로 다음 물음, crisis 위기·승부처까지 자동, inning 이 반 이닝이 끝날 때까지 자동, auto 경기 끝까지 자동
   */
  commandPreview(choices: CommandChoice[], mode: 'next' | 'crisis' | 'inning' | 'auto' = 'next'): CommandPreview {
    if (this.postseasonRunning) return this.postseasonCommandPreview(choices, mode);
    const s = this.scratchSeason();
    const out = choices.map((c) => ({ ...c }));
    const me = this.teamIdx;
    const game = s.schedule[s.day].find((g) => g.home === me || g.away === me);
    let half: { inn: number; top: boolean } | null = null;
    s.commander = {
      team: me,
      decide: (req) => {
        if (req.n < choices.length) return choices[req.n];
        half ??= { inn: req.inn, top: req.top };
        const stop = mode === 'next' || (mode === 'crisis' && isCrisis(req)) || (mode === 'inning' && (req.inn !== half.inn || req.top !== half.top));
        if (stop) throw new CommandPause(req);
        out.push({});
        return {};
      },
    };
    this.prepareDay(s);
    try {
      s.simulateDay();
    } catch (e) {
      if (!(e instanceof CommandPause)) throw e;
      return { req: e.req, choices: out, plays: e.req.plays, home: game?.home ?? -1, away: game?.away ?? -1 };
    }
    const i = s.log.findIndex((g, k) => k >= this.season.log.length && (g.home === me || g.away === me));
    const g = s.log[i];
    return { req: null, choices: out, plays: s.plays.get(i) ?? [], home: g?.home ?? -1, away: g?.away ?? -1, ...(g ? { final: { away: g.awayRuns, home: g.homeRuns } } : {}) };
  }

  /** 가을야구 직접 지휘 미리보기: 가을야구 상태와 시즌을 복사해 다음 경기를 돌려 본다 (실제 진행은 그대로) */
  private postseasonCommandPreview(choices: CommandChoice[], mode: 'next' | 'crisis' | 'inning' | 'auto'): CommandPreview {
    const s = this.scratchSeason();
    const st: PostseasonState = JSON.parse(JSON.stringify(this.postseason));
    const x = currentSeries(st)!;
    const rule = RULES[x.round];
    const highHome = rule.homePattern[x.games.length] ?? true;
    const home = highHome ? x.high : x.low;
    const away = highHome ? x.low : x.high;
    const out = choices.map((c) => ({ ...c }));
    let half: { inn: number; top: boolean } | null = null;
    const commander: GameCommand = {
      team: this.teamIdx,
      decide: (req) => {
        if (req.n < choices.length) return choices[req.n];
        half ??= { inn: req.inn, top: req.top };
        const stop = mode === 'next' || (mode === 'crisis' && isCrisis(req)) || (mode === 'inning' && (req.inn !== half.inn || req.top !== half.top));
        if (stop) throw new CommandPause(req);
        out.push({});
        return {};
      },
    };
    s.boxTeams.add(this.teamIdx);
    try {
      const g = playNextGame(st, s, commander)!;
      return { req: null, choices: out, plays: g.plays ?? [], home, away, final: { away: g.awayRuns, home: g.homeRuns } };
    } catch (e) {
      if (!(e instanceof CommandPause)) throw e;
      return { req: e.req, choices: out, plays: e.req.plays, home, away };
    }
  }

  /** 직접 지휘 확정: 고른 대로 오늘(가을야구면 다음 경기)을 진행한다 (조작 기록에 남아 다시 돌려도 같다) */
  commitCommand(choices: CommandChoice[]): { ok: boolean; message: string } {
    if (!this.canCommand) return { ok: false, message: '오늘 지휘할 경기가 없습니다.' };
    this.dispatchSeason({ year: this.year, day: this.currentDay, type: 'command', choices: choices.map((c) => ({ ...c })) });
    this.crisis = null;
    if (this.postseasonRunning) this.advancePostseason(1);
    else this.advance(1);
    return { ok: true, message: '경기를 마쳤습니다.' };
  }

  /**
   * 우리 구단의 지난 시즌 정규시즌 최종 순위 (1부터). 게임 안에서 치른 시즌이 있으면 그것, 첫 시즌이면 실제 자료.
   * 지난 시즌에 없던 구단(창단)이면 null
   */
  lastSeasonRank(): number | null {
    const L = this.league;
    if (L.lastSeason && L.lastSeason.year === this.world.year - 1) {
      const k = L.lastSeason.standings.indexOf(this.teamIdx);
      return k >= 0 ? k + 1 : null;
    }
    const prev = this.store.season(this.world.year - 1);
    if (!prev) return null;
    const order = [...prev.teams].sort((a, b) => b.pct - a.pct || b.w - a.w);
    const k = order.findIndex((t) => t.franchise === this.team.franchise);
    return k >= 0 ? k + 1 : null;
  }

  /** 우리 구단 경기 (fromDay 일정 색인부터, 날짜 순). 가을야구 경기도 뒤에 붙는다 */
  ourGames(fromDay = 0): CastGame[] {
    const me = this.teamIdx;
    const s = this.season;
    const out: CastGame[] = [];
    s.log.forEach((g, i) => {
      if (g.day < fromDay || (g.home !== me && g.away !== me)) return;
      out.push({
        key: `${this.world.year}-${i}`, year: this.world.year, day: g.day, home: g.home, away: g.away, homeRuns: g.homeRuns, awayRuns: g.awayRuns,
        innings: g.innings, plays: s.plays.get(i), box: s.boxes.get(i), logIdx: i,
      });
    });
    for (const x of this.postseason?.series ?? []) {
      x.games.forEach((g, i) => {
        if (g.day < fromDay || (g.home !== me && g.away !== me)) return;
        out.push({ ...g, key: `${this.world.year}-ps-${x.round}-${i}`, year: this.world.year, label: `${ROUND_LABEL[x.round]} ${i + 1}차전` });
      });
    }
    return out;
  }

  /** 기획안 도전의 한 시즌 결과 (campaigns.ts SeasonMark): 정규시즌 순위·승률·가을야구·자체 육성 주전 */
  private challengeMark(team: number, standings: number[], ps: { seeds: number[]; champion?: number | null; runnerUp?: number | null }): SeasonMark {
    const r = this.season.teams[team];
    const ids = new Set(this.league.challenge?.homegrown ?? []);
    const home = this.world.players.filter((p) => p.teamIdx === team && ids.has(p.id)).filter((p) => {
      const b = this.season.bat[p.idx];
      const q = this.season.pit[p.idx];
      return b.pa >= HOMEGROWN.pa || q.outs >= HOMEGROWN.outs || q.g - q.gs >= HOMEGROWN.relief;
    }).length;
    return {
      year: this.year, rank: standings.indexOf(team) + 1, teams: standings.length, pct: r && r.w + r.l ? r.w / (r.w + r.l) : 0,
      ps: ps.seeds.includes(team), ks: ps.champion === team || ps.runnerUp === team, champ: ps.champion === team, home,
      w: r?.w ?? 0, half: this.halfWinner(team),
    };
  }

  /**
   * 전기 또는 후기 1위인가 (클래식 캠페인, 1982~1988년 전·후기리그). 게임에는 전·후기 제도가 없어
   * 정규시즌 일정을 날짜 절반으로 나눈 반기 승률(무승부 제외)로 본다. 같은 승률이면 함께 1위
   */
  private halfWinner(team: number): boolean {
    const mid = Math.floor(this.season.schedule.length / 2);
    const n = this.season.teams.length;
    for (const first of [true, false]) {
      const w = new Array(n).fill(0);
      const l = new Array(n).fill(0);
      for (const g of this.season.log) {
        if ((g.day < mid) !== first || g.homeRuns === g.awayRuns) continue;
        const win = g.homeRuns > g.awayRuns ? g.home : g.away;
        const lose = win === g.home ? g.away : g.home;
        w[win]++;
        l[lose]++;
      }
      const pct = (t: number) => (w[t] + l[t] ? w[t] / (w[t] + l[t]) : 0);
      const best = Math.max(...Array.from({ length: n }, (_, t) => pct(t)));
      if (w[team] + l[team] > 0 && pct(team) >= best - 1e-9) return true;
    }
    return false;
  }

  /** 감독 작전 배율을 이번 시즌 팀에 건다 (managers.ts). 감독은 오프시즌에만 바뀌므로 시즌을 만들 때 한 번 */
  private applyTactics(): void {
    for (const ts of this.season.teamSeasons) {
      const m = managerOf(this.league, ts.team.idx);
      ts.tactics = m ? tacticsOf(infoOf(this.store, m.name), m.name, this.season.world.year) : undefined;
    }
  }

  /**
   * 새 게임. store에는 모든 시즌과 계약 기록이 불러와져 있어야 한다 (잠재력·연차 산출).
   * 첫 시즌은 worldForYear와 같은 월드에 게임 시드를 그대로 써서, 같은 시드면 M3·M4와 같은 결과가 나온다.
   */
  static create(store: Store, opts: NewGameOptions, baseParams: EngineParams = DEFAULT_PARAMS): GameSession {
    // 능력 기준은 시작 때(createLeague의 월드)에만 쓰인다. 그 뒤 시즌은 리그 상태의 능력으로 만든다
    const params: EngineParams = { ...baseParams, ratingBasis: opts.ratingBasis ?? 'prior' };
    const { league, world } = createLeague(store, opts.year, opts.seed, params);
    if (opts.ratingBasis) league.ratingBasis = opts.ratingBasis;
    if (opts.fantasy) league.fantasy = { log: [], ...(opts.fantasy.regressor ? { regressor: true } : {}), ...(opts.fantasy.free ? { free: true } : {}) };
    if (!world.teams[opts.teamIdx]) throw new Error(`구단 색인이 잘못됐습니다: ${opts.teamIdx}`);
    league.difficulty = opts.difficulty ?? 'normal';
    if (opts.settings) { league.settings = { ...opts.settings }; league.startSettings = { ...opts.settings }; }
    applyCapSanctions(league, league.year);
    applyFloorSanctions(league, league.year);
    league.owner = newOwner(opts.teamIdx);
    let w = world;
    if (opts.fantasy?.free) {
      // 자유 모드: 시즌 중 AI가 새 선수를 만들 때 채울 빈 자리 (src/fantasy/free.ts). 월드에 소속 없이 들어가야 해서 월드를 다시 만든다
      Off.openReserves(league, store, params);
      ensureAlts(league, opts.year);
      w = worldFromLeague(structuredClone(league), store, params);
    }
    const season = Season.start(w, params, seasonSeed(league), { boxTeams: [opts.teamIdx], hiddenSeed: league.seed });
    ensureCoaches(league);
    ensureGm(league);
    const g = new GameSession(store, params, opts.teamIdx, league, w, season);
    g.refreshInjury(); // 월드를 만들 때는 아직 구단주(우리 구단)가 없었다
    g.refreshRivals();
    g.startEntry();
    g.addNews(0, 'season', `${world.year} 시즌 ${world.teams[opts.teamIdx].name} 단장으로 부임했습니다. 개막일은 ${formatDate(world.year, 0)}입니다.`);
    g.addNews(0, 'season', g.ruleNewsFor().headline);
    const ch = opts.challenge ? challengeById(opts.challenge) : undefined;
    if (ch) {
      // 기획안 도전: 시작 때 만 23세 이하 우리 선수가 자체 육성 후보 (campaigns.ts HOMEGROWN)
      const young = ch.plan ? league.players.filter((p) => p.team === opts.teamIdx && (p.birthYear ? world.year - p.birthYear : 99) <= HOMEGROWN.age).map((p) => p.id) : [];
      league.challenge = newChallenge(ch, opts.teamIdx, world.year, young);
      g.addNews(0, 'season', `도전 「${ch.title}」: ${ch.intro}. ${ch.plan ? `${ch.plan.stages.length > 1 ? `단계 목표: ${ch.plan.stages.slice(0, -1).map((x) => x.label).join(' → ')}. ` : ''}` : ''}기한은 ${league.challenge.until} 시즌까지입니다.`);
    }
    for (const e of league.expansions ?? []) {
      g.addNews(0, 'season', `${league.teams[e.team].name}: 창단 구단으로 ${world.year} 시즌은 퓨처스리그에서 뛰고 ${e.firstYear}년 1군에 들어옵니다.`);
    }
    g.setSeasonGoal();
    return g;
  }

  static load(store: Store, save: GameSave, params: EngineParams = DEFAULT_PARAMS): GameSession {
    if (save?.app !== 'kbo-gm') throw new Error('KBO 단장 게임의 저장 파일이 아닙니다');
    if (save.format === 1) return GameSession.loadV1(store, save, params);
    if (save.format !== 2) throw new Error(`지원하지 않는 저장 형식입니다 (${String((save as { format: unknown }).format)})`);
    if (!save.league.teams[save.teamIdx] || save.league.teams[save.teamIdx].name !== save.teamName) {
      throw new Error('저장한 구단을 찾을 수 없습니다');
    }
    const opening = save.phase === 'offseason' ? save.finishedLeague! : save.league;
    const world = worldFromLeague(clone(opening), store, params);
    const season = Season.restore(world, params, save.season);
    const g = new GameSession(store, params, save.teamIdx, clone(save.league), world, season);
    g.phase = save.phase;
    g.postseason = save.postseason ? clone(save.postseason) : null;
    if (save.phase === 'offseason') {
      g.offseason = clone(save.offseason!);
      g.finishedLeague = clone(save.finishedLeague!);
    }
    g.news.push(...save.news);
    g.actions.push(...save.actions);
    g.enlistChoice = save.phase === 'season' && save.enlistChoice ? [...save.enlistChoice] : null;
    g.applyChoice = save.phase === 'season' && save.applyChoice ? [...save.applyChoice] : null;
    g.watch = save.watch ? clone(save.watch) : [];
    // 알린 일 칸이 없는 관심 선수(2026-10-23 소식 알림 전 저장)는 지금 상태를 알린 것으로 둔다
    if (g.watch.some((w) => !w.told)) g.watch = g.watch.map((w) => (w.told ? w : markTold(g.watchCtx(), w)));
    g.ensureOwner();
    ensureFinance(g.league);
    ensureCoaches(g.league);
    ensureGm(g.league);
    g.rebuildTrades();
    g.lastCallUps = new Set(season.teamSeasons[save.teamIdx].callUps?.map((p) => p.idx) ?? []);
    return g;
  }

  /** 형식 1(M3·M4) 저장: 같은 시드로 리그 상태를 다시 만들고 시즌을 복원한다 */
  private static loadV1(store: Store, save: GameSaveV1, params: EngineParams): GameSession {
    const { league, world } = createLeague(store, save.year, save.seed, params);
    const team = world.teams[save.teamIdx];
    if (!team || team.name !== save.teamName) throw new Error('저장한 구단을 지금 데이터에서 찾을 수 없습니다');
    const season = Season.restore(world, params, save.season);
    ensureCoaches(league);
    ensureGm(league);
    const g = new GameSession(store, params, save.teamIdx, league, world, season);
    g.news.push(...save.news.map((n) => ({ ...n, year: n.year ?? save.year })));
    g.ensureOwner();
    g.actions.push(...save.actions.map((a) => ({ ...a, year: a.year ?? save.year })));
    g.rebuildTrades();
    g.lastCallUps = new Set(season.teamSeasons[save.teamIdx].callUps?.map((p) => p.idx) ?? []);
    return g;
  }

  private rebuildTrades(): void {
    const byId = new Map(this.world.players.map((p) => [p.id, p.idx]));
    this.trades = [];
    for (const a of this.actions) {
      if (a.type !== 'trade' || (a.year ?? this.league.startYear) !== this.world.year) continue;
      this.trades.push({ day: a.day, team: a.team, give: a.give.map((id) => byId.get(id)!), get: a.get.map((id) => byId.get(id)!), pg: a.pg, pr: a.pr });
    }
    // 이벤트로 받아들인 트레이드 (조작 기록에는 'event'로만 남는다)
    for (const t of this.league.eventTrades ?? []) {
      if (t.year !== this.world.year) continue;
      this.trades.push({ day: t.day, team: t.team, give: t.give.map((id) => byId.get(id)!), get: t.get.map((id) => byId.get(id)!) });
    }
    this.trades.sort((a, b) => a.day - b.day);
  }

  /**
   * 조작 기록을 처음부터 다시 실행한다. 기록을 모두 적용한 뒤 until(연도·날짜)까지 진행하고 멈춘다.
   * 같은 시드·같은 조작이면 원래 게임과 같은 상태가 나와야 한다.
   */
  static replay(store: Store, opts: NewGameOptions, actions: GameAction[], until?: number | { year: number; day: number },
                params: EngineParams = DEFAULT_PARAMS): GameSession {
    const g = GameSession.create(store, opts, params);
    const target = typeof until === 'number' ? { year: opts.year, day: until } : until;
    const byYearDay = (a: GameAction) => ('day' in a ? { year: a.year ?? opts.year, day: a.day } : null);
    for (const a of actions) {
      const at = byYearDay(a);
      if (at) {
        while (g.phase === 'season' && g.world.year === at.year && g.day < at.day && !g.done) g.advance(1);
        // 가을야구 중 조작: 그 날짜까지 가을야구를 진행한다
        while (g.phase === 'season' && g.world.year === at.year && g.postseasonRunning && g.postseason!.day < at.day) g.advancePostseason(1);
        g.dispatchSeason(a as Extract<GameAction, { day: number }>);
      } else {
        if (a.type === 'begin-off') g.advance(100000);
        g.dispatchOff(a as OffAction);
      }
    }
    const end = target ?? actions.reduce<{ year: number; day: number } | null>((m, a) => {
      const at = byYearDay(a);
      return at && (!m || at.year > m.year || (at.year === m.year && at.day > m.day)) ? at : m;
    }, null);
    if (end) {
      while (g.phase === 'season' && g.world.year === end.year && g.day < end.day && !g.done) g.advance(1);
      while (g.phase === 'season' && g.world.year === end.year && g.postseasonRunning && g.postseason!.day < end.day) g.advancePostseason(1);
    }
    return g;
  }

  private dispatchSeason(a: Extract<GameAction, { day: number }>): void {
    const byId = new Map(this.world.players.map((p) => [p.id, p.idx]));
    const idxs = (ids: string[]) => ids.map((id) => byId.get(id)).filter((x): x is number => x !== undefined);
    if (a.type === 'entry') this.applyEntry(a.ids ? idxs(a.ids) : null);
    else if (a.type === 'plan') this.season.setPlan(this.teamIdx, a.plan ? this.planFromIds(a.plan) : null);
    else if (a.type === 'event') this.applyEventChoice(a.choice);
    else if (a.type === 'command') this.pendingCommand = { day: a.day, choices: a.choices.map((c) => ({ ...c })) };
    else if (a.type === 'convert') this.applyConvert(a.id);
    else if (a.type === 'release-in') this.applyRelease(a.id);
    else if (a.type === 'sign-in') this.applySign(a.id);
    else if (a.type === 'mgr-change') this.applyManagerChange(a.name);
    else if (a.type === 'hire-coach-in') this.applyHireCoachIn(a.id);
    else if (a.type === 'ai') this.applyFantasy(a.entry);
    else if (a.type === 'ai-choice') this.applyFantasyChoice(a.id, a.choice);
    else if (a.type === 'settings') this.applySettings(a.s);
    else if (a.type === 'def-edit') this.applyDefenseEdit(a.id, a.def);
    else if (a.type === 'two-way') this.applyTwoWay(a.id, a.on);
    else this.applyTrade(a.team, idxs(a.give), idxs(a.get), a.cash ?? 0, { give: (a.pg ?? []).map(parsePick), get: (a.pr ?? []).map(parsePick) });
    this.actions.push(clone(a));
  }

  get team() {
    return this.world.teams[this.teamIdx];
  }

  /**
   * 구단 이름·계보. 막 끝난 시즌의 월드에 있으면 그것을, 없으면 리그 상태의 것을 쓴다.
   * 창단이 있는 해의 오프시즌에는 리그 상태에만 새 구단이 있다 (월드 8구단, 리그 9구단).
   */
  teamInfo(idx: number): { name: string; franchise: string } {
    const t = this.world.teams[idx] ?? this.league.teams[idx];
    if (!t) throw new Error(`구단 색인이 잘못됐습니다: ${idx}`);
    return t;
  }

  get day(): number {
    return this.season.day;
  }

  /** 정규시즌이 끝났는가 (오프시즌 중에도 true) */
  get done(): boolean {
    return this.season.done;
  }

  get year(): number {
    return this.world.year;
  }

  /**
   * 그 해 "달라지는 규칙" 알림 (league/ruleNews.ts). 표시 기능이라 저장하지 않고 다시 계산한다 (난수 없음).
   * 기본은 지금 시즌. 오프시즌 "개막 준비" 카드는 다음 시즌(year + 1)을 미리 본다.
   */
  ruleNewsFor(year = this.year): RuleNews {
    const cur = year === this.year && this.phase === 'season';
    if (cur && this.ruleCache?.year === year) return this.ruleCache;
    const L = this.league;
    const shape = (y: number) => {
      const sd = this.store.season(y);
      return sd ? { teams: sd.teams.length, games: sd.games } : undefined;
    };
    const last = L.lastSeason?.year === year - 1 ? L.lastSeason : null;
    const g = last ? last.teams.reduce((n, t) => n + t.g, 0) : 0;
    const news = ruleNews({
      year, data: this.store.ruleChanges, start: year === L.startYear,
      now: ruleSnapshot(this.store.meta, year, L, shape(year)), prev: ruleSnapshot(this.store.meta, year - 1, L, shape(year - 1)),
      seasonDays: year === this.year ? this.season.schedule.length : undefined,
      shifts: shiftsFor(L, year),
      rejected: (L.ruleVotes ?? []).filter((v) => v.year === year && !v.passed),
      ...(() => {
        const value = seasonCor(L, year);
        return value === null ? {} : { cor: { value, prev: seasonCor(L, year - 1), range: corRange(L, year), hrMul: ballHrMul(L, year) } };
      })(),
      lastSeason: last && g > 0 && last.hr !== undefined
        ? { year: last.year, runsPerGame: last.teams.reduce((n, t) => n + t.rs, 0) / g, hrPerGame: last.hr / (g / 2) } : undefined,
    });
    if (cur) this.ruleCache = news;
    return news;
  }

  /**
   * 버그 보고용 재현 정보. 시즌 시드·지금 구단이 아니라 처음 게임을 만든 조건을 담는다
   * (두 번째 시즌부터 시즌 시드는 `시드/연도`로 바뀌고, 해고 뒤에는 맡은 구단도 바뀐다).
   */
  reproInfo(): ReproInfo {
    const L = this.league;
    const firstTeam = L.owner?.history[0]?.team ?? L.owner?.team ?? this.teamIdx;
    return {
      opts: { year: L.startYear, teamIdx: firstTeam, seed: L.seed, difficulty: L.difficulty ?? 'normal', ...(L.challenge ? { challenge: L.challenge.id } : {}), ...(L.startSettings ? { settings: L.startSettings } : {}), ...(L.ratingBasis ? { ratingBasis: L.ratingBasis } : {}), ...(L.fantasy ? { fantasy: { ...(L.fantasy.regressor ? { regressor: true } : {}), ...(L.fantasy.free ? { free: true } : {}) } } : {}) },
      // 가을야구 중이면 가을야구 날짜 (2026-10-12: 정규시즌 날짜를 적어 다시 돌리면 가을야구 경기를 치르지 않던 문제)
      at: { year: this.year, day: this.currentDay, phase: this.phase },
      actions: clone(this.actions),
    };
  }

  // ---- 엔트리

  /** 개막 때 1군: AI가 짠 엔트리를 그대로 받아 플레이어가 관리한다 */
  private startEntry(): void {
    const ts = this.season.refresh(this.teamIdx);
    this.season.setManualEntry(this.teamIdx, activeOf(ts).map((p) => p.idx));
  }

  /** 지금까지의 퓨처스리그(2군) 성적과 순위 (league/futures.ts, 필요할 때 계산). AI 구단 1군은 지금 명단을 읽기만 한다 */
  futures(): ReturnType<typeof futuresSeason> {
    const off = this.phase === 'offseason';
    const r = futuresSeason(this.world, this.season, this.league.seed, (t) => registeredOf(this.season, t), off ? [] : this.futuresExtras());
    // 오프시즌: 결산 때 남긴 순위 (창단 퓨처스 구단 포함. 결산 뒤 리그 상태가 바뀌어 다시 계산하지 않는다)
    const last = this.league.lastFutures;
    return off && last?.year === this.year ? { ...r, teams: last.teams } : r;
  }

  /** 1군 진입 전 창단 구단의 선수 (퓨처스리그 성적용, 시즌 중 리그 상태는 개막 모습 그대로라 해마다 한 번 만든다) */
  private futuresExtras(): FuturesExtra[] {
    if (this.futExtra?.year !== this.year) this.futExtra = { year: this.year, extra: futuresExtras(this.league, this.store, this.world, this.params) };
    return this.futExtra.extra;
  }
  private futExtra: { year: number; extra: FuturesExtra[] } | null = null;

  /** 다음 경기일 기준 1군 (엔진이 실제로 쓸 명단). 플레이어가 정한 명단에서 결장 선수는 빠지고 임시 승격 선수가 들어간다 */
  activeTeam(): TeamSeason {
    return this.season.refresh(this.teamIdx, this.currentDay);
  }

  /** 지금 날짜 (일정 색인): 정규시즌 중이면 다음 경기일, 가을야구 중이면 다음 가을야구 경기일 */
  get currentDay(): number {
    return this.postseasonRunning ? this.postseason!.day : this.season.day;
  }

  /** 가을야구가 진행 중인가 (대진이 정해졌고 아직 끝나지 않음) */
  get postseasonRunning(): boolean {
    return this.phase === 'season' && this.done && !!this.postseason && !this.postseason.done;
  }

  /** 엔트리·기용표를 바꿀 수 있는가: 정규시즌 중이거나, 가을야구에서 아직 탈락하지 않았을 때 */
  get canManage(): boolean {
    if (this.phase !== 'season') return false;
    if (!this.done) return true;
    return this.postseasonRunning && stillAlive(this.postseason!, this.teamIdx);
  }

  /** 플레이어가 정한 1군 명단. AI에게 맡긴 상태면 null */
  get manualEntry(): Set<number> | null {
    return this.season.teamSeasons[this.teamIdx].manual ?? null;
  }

  /** 지금 1군으로 등록된 선수 (플레이어 명단, AI 모드면 AI가 짠 명단) */
  registered(): SimPlayer[] {
    const m = this.manualEntry;
    if (m) return this.team.org.filter((p) => m.has(p.idx));
    return activeOf(this.activeTeam());
  }

  isAbsent(p: SimPlayer): boolean {
    return this.season.states.absentUntil[p.idx] > this.currentDay;
  }

  /** 지금 결장의 기록 (개막부터의 결장이면 null) */
  absenceOf(p: SimPlayer): Absence | null {
    if (!this.isAbsent(p)) return null;
    for (let i = this.season.absences.length - 1; i >= 0; i--) {
      const a = this.season.absences[i];
      if (a.idx === p.idx) return a.until === this.season.states.absentUntil[p.idx] ? a : null;
    }
    return null;
  }

  /** 결장 까닭 (짧은 문구). 부상은 부위·정도, 실존 선수의 이탈은 중립 문구만 나온다 (eventLabel이 막는다) */
  absenceReason(p: SimPlayer): string | null {
    if (!this.isAbsent(p)) return null;
    const a = this.absenceOf(p);
    if (a) return absenceLabel(a, p, a.until >= this.season.schedule.length);
    const lp = this.leaguePlayer(p.id);
    if (lp?.startAbsentReason === 'military') return '군 복무 (전역 전)';
    // 부상은 실존·가상 선수가 같은 문구 (엔진 2 11단계)
    if (lp?.startAbsentReason === 'injury') return '지난 시즌 부상 재활';
    return '결장';
  }

  /** 우리 구단의 복무 중인 선수 (월드에 없다) */
  servingPlayers(): LeaguePlayer[] {
    return this.league.players.filter((p) => p.team === this.teamIdx && p.military?.state === 'serving');
  }

  /** 결장 중이면 복귀하는 날짜 색인, 아니면 null */
  returnDay(p: SimPlayer): number | null {
    const u = this.season.states.absentUntil[p.idx];
    return u > this.currentDay ? u : null;
  }

  // ---- 육성선수 정식 등록 (시즌 중: 5월 1일 ~ 7월 31일, 정원 안)

  /** 지금 정식 선수 수 (복무 중 제외, 육성선수 제외) */
  regularCount(): number {
    return this.team.org.filter((p) => !p.dev).length;
  }

  // ---- 시즌 중 방출·영입 (league/market.ts)

  get marketCtx(): MarketCtx {
    return { league: this.league, world: this.world, season: this.season, meta: this.store.meta, values: this.values, userTeam: this.teamIdx };
  }

  /** 시장에서 데려올 수 있는 선수 (외국인 후보, 자유계약 선수) */
  marketPlayers(): SimPlayer[] {
    return this.phase === 'season' ? marketPlayers(this.marketCtx, this.teamIdx) : [];
  }

  get marketDeadlineDay(): number {
    return marketDeadlineDay(this.world.year, this.season.schedule.length, this.league);
  }

  releaseBlock(p: SimPlayer): string | null {
    if (this.phase !== 'season') return '시즌 중에만 방출할 수 있습니다 (오프시즌에는 정원 정리 단계에서).';
    return releaseBlock(this.marketCtx, p, this.teamIdx);
  }

  signBlock(p: SimPlayer): string | null {
    if (this.phase !== 'season') return '시즌 중에만 영입할 수 있습니다.';
    return signBlock(this.marketCtx, p, this.teamIdx);
  }

  /** 웨이버 공시. 데려간 구단이 있으면 그 이름을 메시지에 */
  releaseInSeason(p: SimPlayer): { ok: boolean; message: string } {
    const why = this.releaseBlock(p);
    if (why) return { ok: false, message: why };
    const to = this.applyRelease(p.id);
    this.actions.push({ year: this.year, day: this.day, type: 'release-in', id: p.id });
    return { ok: true, message: to >= 0 ? `${p.name}: ${this.world.teams[to].name}에서 웨이버로 데려갔습니다 (계약 승계).` : `${p.name} 방출: 자유계약 선수가 됐습니다.` };
  }

  signInSeason(p: SimPlayer): { ok: boolean; message: string } {
    const why = this.signBlock(p);
    if (why) return { ok: false, message: why };
    this.applySign(p.id);
    this.actions.push({ year: this.year, day: this.day, type: 'sign-in', id: p.id });
    return { ok: true, message: `${p.name} 영입 (2군에 들어갑니다. 1군은 따로 올리세요).` };
  }

  private applyRelease(id: string): number {
    const p = this.world.players.find((x) => x.id === id);
    if (!p || p.teamIdx < 0) return -1;
    const from = p.teamIdx;
    this.fanStarLeaves(from, p);
    const lp = this.leaguePlayer(id);
    const cost = lp ? releaseCost(lp, this.world.year, this.season.schedule.length, this.season.day) : 0;
    const to = releasePlayer(this.marketCtx, p, from);
    this.valueCtx = null;
    if (from === this.teamIdx) {
      this.addNews(this.day, 'entry', to >= 0
        ? `${p.name} 웨이버 공시: ${this.world.teams[to].name}에서 데려갔습니다 (계약 승계).`
        : `${p.name} 웨이버 공시: 데려가는 구단이 없어 자유계약 선수가 됐습니다.${cost > 0 ? ` 남은 보장 연봉 ${wonText(cost)}을 냈습니다.` : ''}`);
    } else if (to === this.teamIdx) this.addNews(this.day, 'entry', `${p.name}: 웨이버로 데려왔습니다.`);
    return to;
  }

  private applySign(id: string): void {
    const p = this.world.players.find((x) => x.id === id);
    if (!p || p.teamIdx !== -1) return;
    signPlayer(this.marketCtx, p, this.teamIdx);
    this.valueCtx = null;
    const lp = this.leaguePlayer(id);
    this.addNews(this.day, 'entry', p.foreign && lp
      ? `${p.name} 영입 (외국인 교체 ${foreignSwapsUsed(this.marketCtx, this.teamIdx)}/${ruleOf(this.league, 'foreignSwaps')}, 연봉 ${dollarText(lp.contract.salary)}의 남은 달 몫)`
      : `${p.name} 영입 (최저 연봉, 이번 시즌까지)`);
  }

  /** 하루 뒤 AI 구단의 외국인 교체 (market.ts). 결정적이라 재현·불러오기와 같다 */
  private aiMarket(): void {
    for (const m of aiMarketDay(this.marketCtx)) {
      this.valueCtx = null;
      const t = this.world.teams[m.team];
      const body = `${t.name}, 외국인 ${josa(m.out.name, '을', '를')} 내보내고 ${josa(m.in.name, '을', '를')} 영입했다${m.why === 'injury' ? ' (부상 대체)' : ''}.`;
      this.addNews(this.season.day, 'trade', `[외국인 교체] ${body}`);
      addArticle(this.league, { year: this.world.year, day: this.season.day, kind: 'trade', franchise: t.franchise, title: `${t.name} 외국인 교체`, body });
    }
  }

  // ---- 판타지 모드 (src/fantasy, docs/fantasy-mode.md)

  get fantasy(): FantasyState | null {
    return this.league.fantasy ?? null;
  }

  /** AI가 만든 글을 이야기 기록에 넣고 조작 기록에 남긴다 (화면이 AI를 부른 뒤). 판타지 게임이 아니면 넣지 않는다 */
  addFantasy(entry: Omit<FantasyEntry, 'year' | 'day'>): { ok: boolean; message: string } {
    if (!this.league.fantasy) return { ok: false, message: '판타지 모드 게임이 아닙니다.' };
    if (this.phase === 'season') {
      const e: FantasyEntry = { ...entry, year: this.year, day: this.currentDay };
      this.dispatchSeason({ year: this.year, day: this.currentDay, type: 'ai', entry: e });
    } else {
      const e: FantasyEntry = { ...entry, year: this.year, day: -1 };
      this.dispatchOff({ year: this.year, type: 'ai-off', entry: e });
    }
    return { ok: true, message: '이야기에 남겼습니다.' };
  }

  private applyFantasy(entry: FantasyEntry): void {
    const f = this.league.fantasy;
    if (!f) return;
    const e = addFantasyEntry(f, entry);
    if (e.arc) applyArc(f, e.arc, { year: e.year, day: e.day });
    if (e.effects?.length) this.applyFantasyEffects(e.effects, e.title);
    if (e.ops?.length) this.applyFreeOps(e.ops, e.title);
    if (e.promises?.length || e.settles?.length) applyPromises(f, e.id!, { year: e.year, day: e.day }, e.promises, e.settles);
    // 구단 연대기: 해마다 한 장, 이야기 기록과 따로
    if (e.chronicle !== undefined) {
      f.chronicles = (f.chronicles ?? []).filter((c) => c.year !== e.chronicle);
      f.chronicles.push({ year: e.chronicle, title: e.title, text: e.text });
      f.chronicles.sort((a, b) => a.year - b.year);
    }
    // 단장 노트 (자유 모드): 더하고 지운다. 최근 40개까지
    if (e.noteDrop?.length) f.notes = (f.notes ?? []).filter((n) => !e.noteDrop!.includes(n.id));
    for (const text of e.notes ?? []) {
      f.nseq = (f.nseq ?? 0) + 1;
      (f.notes ??= []).push({ id: `n${f.nseq}`, year: e.year, text });
    }
    if (f.notes && f.notes.length > 40) f.notes.splice(0, f.notes.length - 40);
    if (e.kind === 'event' && e.choices?.length) this.addNews(Math.max(0, this.phase === 'season' ? this.day : 0), 'event', `판타지 사건: ${e.title} (판타지 화면에서 고르세요)`);
  }

  /** 약속 장부의 기한 판단용 지금 때 (promises.ts) */
  get promiseNow(): Now {
    return this.phase === 'season'
      ? { phase: 'season', year: this.world.year, day: this.currentDay, seasonDays: this.season.schedule.length }
      : { phase: 'offseason', year: this.year, day: 0, seasonDays: 144 };
  }

  /** 대화의 제안·사건의 선택지를 고른다 */
  chooseFantasy(id: string, choice: number): { ok: boolean; message: string } {
    const e = this.league.fantasy?.log.find((x) => x.id === id);
    if (!e || !e.choices?.[choice]) return { ok: false, message: '고를 수 없는 선택지입니다.' };
    if (e.chosen !== undefined) return { ok: false, message: '이미 골랐습니다.' };
    if (offerExpired(this, e)) return { ok: false, message: `제안이 만료됐습니다 (${RIVAL_OFFER_DAYS}일 안에 답해야 합니다).` };
    if (this.phase === 'season') this.dispatchSeason({ year: this.year, day: this.currentDay, type: 'ai-choice', id, choice });
    else this.dispatchOff({ year: this.year, type: 'ai-choice-off', id, choice });
    return { ok: true, message: e.choices[choice].result || '골랐습니다.' };
  }

  private applyFantasyChoice(id: string, choice: number): void {
    const e = this.league.fantasy?.log.find((x) => x.id === id);
    const c = e?.choices?.[choice];
    if (!e || !c || e.chosen !== undefined) return;
    e.chosen = choice;
    if (c.effects.length) this.applyFantasyEffects(c.effects, `${e.title}: ${c.label}`);
    if (c.ops?.length) this.applyFreeOps(c.ops, `${e.title}: ${c.label}`);
    if (c.promises?.length && this.league.fantasy) applyPromises(this.league.fantasy, e.id!, { year: this.year, day: this.phase === 'season' ? this.currentDay : -1 }, c.promises);
  }

  /**
   * 자유 모드 조작 적용 (src/fantasy/free.ts). 판단 상한은 없다. 시즌 중 소속 이동은 월드(Season.transfer)로, 리그 소속은 결산 때 따라간다.
   * 오프시즌에는 리그 상태를 바로 바꾼다. 안 되는 조작(선수가 없어짐 등)은 건너뛴다
   */
  private applyFreeOps(ops: FreeOp[], note: string): void {
    const L = this.league;
    const season = this.phase === 'season';
    const year = season ? this.world.year : this.year + 1;
    const ctx = this.values;
    const lpOf = (id: string) => L.players.find((p) => p.id === id);
    const spOf = (id: string) => (season ? this.world.players.find((p) => p.id === id) : undefined);
    const syncSim = (lp: LeaguePlayer) => {
      const sp = spOf(lp.id);
      if (!sp) return;
      // 수비는 리그 쪽 값을 따른다 (없던 예전 저장만 월드 값을 남긴다). 전에는 월드 값이 앞서 만든 선수의 새 수비가 들어가지 않았다
      sp.bat = lp.bat ? { ...lp.bat, def: lp.bat.def ?? sp.bat?.def } : null;
      sp.pit = lp.pit;
      sp.value = sp.isPitcher ? pitValue(sp.pit!, this.world.league) : batValue(sp.bat!, this.world.league);
      if (sp.teamIdx >= 0) this.season.teamSeasons[sp.teamIdx].dirty = true;
    };
    for (const op of ops) {
      switch (op.op) {
        case 'move': {
          const lp = lpOf(op.player);
          if (!lp) break;
          if (season) {
            const sp = spOf(op.player);
            if (!sp || sp.teamIdx === op.to || (op.to >= 0 && !this.world.teams[op.to])) break;
            const from = sp.teamIdx;
            this.season.transfer(sp.idx, op.to);
            (L.marketMoves ??= []).push({ year: this.world.year, day: this.season.day, id: sp.id, kind: op.to < 0 ? 'release' : from < 0 ? 'sign' : 'claim', from, to: op.to });
            if (op.to === this.teamIdx) this.autoRegister(sp);
          } else {
            lp.team = op.to;
          }
          break;
        }
        case 'create': {
          const runs = runsForGrade(op.now, year);
          const pot = Math.max(runs, runsForGrade(op.potential, year));
          if (season) {
            if (!this.world.teams[op.team]) break;
            const slot = this.world.players.find((p) => p.reserve && p.teamIdx === -1 && p.isPitcher === (op.pos === 'P'));
            const lp = slot && lpOf(slot.id);
            if (!slot || !lp) { this.addNews(this.day, 'event', `자유 모드: 이번 시즌 빈 자리가 없어 ${op.name}을(를) 만들지 못했습니다 (다음 개막부터 다시).`); break; }
            lp.name = op.name; slot.name = op.name;
            lp.real = false; slot.real = false;
            if (op.real) lp.outsider = true; else delete lp.outsider;
            lp.birthYear = year - op.age; slot.age = op.age;
            lp.potential = pot;
            if (!slot.isPitcher) {
              // 주 포지션과 그 자리 기준 수비 (빈 자리 바탕의 수비를 그대로 쓰면 모든 자리가 유격수 기준이 됐다, 2026-10-13 푸홀스 보고)
              const pos = op.pos === 'IF' ? '2B' : op.pos === 'OF' ? 'RF' : op.pos;
              lp.pos = pos; slot.pos = pos;
              if (lp.bat) lp.bat = { ...lp.bat, def: makeDefense(lp.id, pos, pos === 'DH' ? [] : [pos], lp.bat.speed, op.age) };
            }
            this.setPitchRole(lp, op.role);
            this.typicalStarterStamina(lp);
            this.applyNationality(lp, op);
            slot.foreign = lp.foreign;
            Object.assign(lp, skillForRuns({ ...lp }, runs, ctx, year));
            delete slot.reserve;
            syncSim(lp);
            // 마무리로 데려온 정상급 구원: 세이브 경력으로 AI 감독이 마무리로 쓴다
            if (op.role === 'RP' && op.now >= 60) { lp.lastSaves = 20; slot.lastSaves = 20; }
            this.season.transfer(slot.idx, op.team);
            (L.marketMoves ??= []).push({ year: this.world.year, day: this.season.day, id: slot.id, kind: 'sign', from: -1, to: op.team });
            if (op.team === this.teamIdx) this.autoRegister(slot);
          } else {
            const np = Off.addFreePlayer(L, this.store, this.params, op.team, { name: op.name, pos: op.pos, age: op.age, runs, potential: pot });
            if (op.real) np.outsider = true;
            this.setPitchRole(np, op.role);
            this.typicalStarterStamina(np);
            this.applyNationality(np, op);
            Object.assign(np, skillForRuns({ ...np }, runs, ctx, year));
          }
          break;
        }
        case 'ability': {
          const lp = lpOf(op.player);
          if (!lp) break;
          if (op.now !== undefined) Object.assign(lp, skillForRuns({ ...lp }, runsForGrade(op.now, year), ctx, year));
          if (op.potential !== undefined) lp.potential = runsForGrade(op.potential, year);
          lp.estimated = false;
          syncSim(lp);
          break;
        }
        case 'contract': {
          const lp = lpOf(op.player);
          if (lp) lp.contract = { ...lp.contract, kind: lp.foreign ? 'foreign' : lp.contract.kind, salary: op.salary, until: year + op.years - 1 };
          break;
        }
        case 'teamCash':
          L.ledger.push(op.amount > 0 ? { year, from: -1, to: op.team, amount: op.amount, note: `자유 모드: ${note}`, kind: 'event' }
            : { year, from: op.team, to: -1, amount: -op.amount, note: `자유 모드: ${note}`, kind: 'event' });
          break;
        case 'effect':
          this.applyFantasyEffects([op.effect], note);
          break;
        case 'pick':
          if (L.teams[op.to]) transferPick(L, { draft: op.draft, round: op.round, from: op.from }, op.to);
          break;
        case 'future':
          // 입단 예약: 그 해 개막 때 들어온다 (openPipeline)
          if (L.fantasy) (L.fantasy.pipeline ??= []).push({ name: op.name, team: op.team, pos: op.pos, ...(op.role ? { role: op.role } : {}), birthYear: op.birthYear,
            joinYear: op.joinYear, now: op.now, potential: op.potential, ...(op.foreign ? { foreign: true } : {}), ...(op.real ? { real: true } : {}), from: note });
          break;
        case 'rule': {
          // 리그 규정 (league/rules.ts). 기본값으로 돌리면 기록에서 지운다
          const r = (L.rules ??= {}) as Record<string, number | null>;
          if (op.value === RULE_DEFAULTS[op.key]) delete r[op.key];
          else r[op.key] = op.value;
          if (!Object.keys(r).length) delete L.rules;
          this.addNews(Math.max(0, season ? this.day : 0), 'event', `규정 변경: ${RULE_DEFS.find((d) => d.key === op.key)?.label ?? op.key} → ${op.value ?? '실제 규정'}`);
          break;
        }
      }
    }
    this.valueCtx = null;
  }

  /** 판타지 효과 적용 (src/fantasy/effects.ts). 시즌 중에는 이벤트 도구, 오프시즌에는 리그 상태에 바로 */
  private applyFantasyEffects(effects: FantasyEffect[], note: string): void {
    const L = this.league;
    const f = L.fantasy!;
    const team = this.teamIdx;
    const season = this.phase === 'season' && !this.done ? this.eventContext() : null;
    const year = this.phase === 'season' ? this.year : this.year + 1;
    for (const e of effects) {
      switch (e.type) {
        case 'trust': { const o = this.owner; o.trust = Math.max(0, Math.min(100, o.trust + e.delta)); break; }
        case 'fans': addFanEvent(L, team, this.year, season ? season.day : -2, e.delta, `판타지: ${note}`); break;
        case 'cash':
          L.ledger.push(e.amount > 0 ? { year, from: -1, to: team, amount: e.amount, note: `판타지: ${note}`, kind: 'event' }
            : { year, from: team, to: -1, amount: -e.amount, note: `판타지: ${note}`, kind: 'event' });
          break;
        case 'fill': season?.addFill(e.fill, e.days, `판타지: ${note}`); break;
        case 'teamForm': season?.addForm(e.edge, e.days, `판타지: ${note}`, { side: e.side }); break;
        case 'playerForm': season?.addForm(e.edge, e.days, `판타지: ${note}`, { player: e.player }); break;
        case 'rest': season?.rest(e.player, e.days); break;
        case 'potential': {
          const p = L.players.find((x) => x.id === e.player && x.team === team && x.real === false);
          if (p) p.potential += e.delta;
          break;
        }
        case 'prospect': (f.prospects ??= []).push({ ...e }); this.addNews(Math.max(0, this.phase === 'season' ? this.day : 0), 'event', `판타지: 유망주 ${e.name}이(가) 다음 개막에 입단합니다.`); break;
        case 'tradeGoodwill': {
          const day = this.phase === 'season' ? this.currentDay : 0;
          f.goodwill = (f.goodwill ?? []).filter((x) => x.team !== e.team || x.year !== this.world.year);
          if (e.runs) f.goodwill.push({ team: e.team, runs: e.runs, year: this.world.year, until: day + e.days });
          break;
        }
        case 'demandDiscount': {
          f.discounts = (f.discounts ?? []).filter((x) => x.id !== e.player || x.year !== this.year);
          if (e.pct) f.discounts.push({ id: e.player, pct: e.pct, year: this.year });
          break;
        }
        case 'ownerChange': { const o = this.owner; o.trust = e.trust; this.addNews(Math.max(0, this.phase === 'season' ? this.day : 0), 'owner', `판타지: 구단주가 바뀌었습니다. 새 구단주의 신뢰 ${e.trust}에서 시작합니다.`); break; }
      }
    }
  }

  /** 육성선수를 정식 등록할 수 있나. 안 되면 이유 */
  convertBlock(p: SimPlayer): string | null {
    if (!p.dev || p.teamIdx !== this.teamIdx) return '정식 등록할 육성선수가 아닙니다.';
    if (this.phase !== 'season' || this.done) return '시즌 중에만 정식 등록할 수 있습니다 (오프시즌에는 정원 정리 단계에서).';
    const dt = dateOf(this.world.year, Math.min(this.day, this.season.schedule.length - 1));
    if (dt.month < DEV_REGISTER_FROM.month) return `육성선수는 ${DEV_REGISTER_FROM.month}월 ${DEV_REGISTER_FROM.date}일부터 정식 등록할 수 있습니다.`;
    if (this.day > this.tradeDeadlineDay) return `선수 등록 마감(${this.tradeDl.month}월 ${this.tradeDl.date}일)이 지났습니다.`;
    if (this.regularCount() >= ruleOf(this.league, 'orgLimit')) return `정식 선수 정원(${ruleOf(this.league, 'orgLimit')}명)이 차 있습니다. 오프시즌에 정리하세요.`;
    return null;
  }

  /** 육성선수를 정식 선수로 등록한다 (2군에 남는다. 1군은 따로 올린다) */
  convertDev(p: SimPlayer): { ok: boolean; message: string } {
    const why = this.convertBlock(p);
    if (why) return { ok: false, message: why };
    this.applyConvert(p.id);
    this.actions.push({ year: this.year, day: this.day, type: 'convert', id: p.id });
    return { ok: true, message: `${p.name} 정식 등록` };
  }

  private applyConvert(id: string, quiet = false): void {
    const p = this.world.players.find((x) => x.id === id);
    if (!p) return;
    p.dev = false;
    const lp = this.leaguePlayer(id);
    if (lp) lp.dev = false;
    this.season.teamSeasons[p.teamIdx].dirty = true;
    if (!quiet) this.addNews(this.day, 'entry', `${p.name}, 육성선수에서 정식 선수로 등록`);
  }

  /**
   * AI 구단의 육성선수 정식 등록 (5월 1일 경기 전, 하루 진행 뒤 훅): 플레이어와 같은 조건(정식 등록 첫날, 정식 선수 정원 안)으로,
   * 지금 기여가 AI_DEV_REGISTER_RUNS 이상인 선수를 기여 순으로. 난수를 쓰지 않아 재현·불러오기와 같다
   */
  private aiDevRegister(): void {
    if (this.season.day !== this.devRegisterDay || this.season.day > this.tradeDeadlineDay) return;
    const limit = ruleOf(this.league, 'orgLimit');
    const names: string[] = [];
    for (const t of this.world.teams) {
      if (t.idx === this.teamIdx) continue;
      let room = limit - t.org.filter((p) => !p.dev).length;
      const devs = t.org.filter((p) => p.dev).map((p) => ({ p, r: currentRuns(p, this.values) }))
        .filter((x) => x.r >= AI_DEV_REGISTER_RUNS)
        .sort((a, b) => b.r - a.r || a.p.id.localeCompare(b.p.id));
      for (const { p } of devs) {
        if (room <= 0) break;
        this.applyConvert(p.id, true);
        names.push(`${p.name}(${t.name})`);
        room--;
      }
    }
    if (!names.length) return;
    this.valueCtx = null;
    this.addNews(this.season.day, 'trade', `[육성선수 정식 등록] 다른 구단: ${names.join(', ')}`);
  }

  /**
   * 말소된 선수가 다시 1군에 등록될 수 있는 날 (일정 색인). 제한이 없으면 null (KBO: 말소 뒤 10일).
   * 지금 1군에 있는 선수는 제한이 없다 (AI에게 맡겼다가 다시 직접 관리로 바꿀 때 AI 명단은 그대로 넘어온다)
   */
  reregisterDay(p: SimPlayer): number | null {
    if (this.registered().some((x) => x.idx === p.idx)) return null;
    const d = this.season.demotedDay[p.idx];
    if (d < 0) return null;
    const ok = d + REREGISTER_DAYS;
    return this.currentDay < ok ? ok : null;
  }

  checkEntry(idxs: Iterable<number>): EntryCheck {
    const set = new Set(idxs);
    const players = this.team.org.filter((p) => set.has(p.idx));
    const { rosterSize, foreignLimit } = this.world.rules;
    const errors: string[] = [];
    const warnings: string[] = [];
    const devs = players.filter((p) => p.dev);
    if (devs.length) errors.push(`육성선수는 정식 등록한 뒤에 1군에 올릴 수 있습니다: ${devs.map((p) => p.name).join(', ')}`);
    const blocked = players.filter((p) => this.reregisterDay(p) !== null);
    if (blocked.length) {
      errors.push(`1군에서 말소된 선수는 ${REREGISTER_DAYS}일이 지나야 다시 등록할 수 있습니다: ${blocked.map((p) => `${p.name} (${shortDate(this.world.year, this.reregisterDay(p)!)}부터)`).join(', ')}`);
    }
    if (players.length > rosterSize) errors.push(`1군 엔트리는 최대 ${rosterSize}명입니다 (지금 ${players.length}명)`);
    const foreign = players.filter((p) => p.foreign).length;
    if (foreign > foreignLimit) errors.push(`외국인 선수는 1군에 ${foreignLimit}명까지 등록할 수 있습니다 (지금 ${foreign}명)`);
    const ready = players.filter((p) => !this.isAbsent(p));
    const hit = ready.filter((p) => !p.isPitcher).length;
    const pit = ready.filter((p) => p.isPitcher).length;
    if (hit < MIN_ACTIVE_HITTERS) warnings.push(`뛸 수 있는 야수가 ${hit}명뿐이라 경기 때 2군에서 ${MIN_ACTIVE_HITTERS - hit}명을 임시로 올립니다`);
    if (pit < MIN_ACTIVE_PITCHERS) warnings.push(`뛸 수 있는 투수가 ${pit}명뿐이라 경기 때 2군에서 ${MIN_ACTIVE_PITCHERS - pit}명을 임시로 올립니다`);
    const absent = players.filter((p) => this.isAbsent(p));
    if (absent.length) warnings.push(`결장 중인 선수 ${absent.length}명이 1군 자리를 차지하고 있습니다`);
    return { errors, warnings };
  }

  /** 1군 명단을 통째로 바꾼다. 규정 위반이면 바꾸지 않고 errors를 돌려준다. null이면 AI에게 맡긴다 */
  setEntry(idxs: number[] | null): EntryCheck {
    if (!this.canManage) return { errors: [this.done ? '시즌이 끝났습니다 (가을야구에서 탈락했거나 진출하지 못함)' : '지금은 바꿀 수 없습니다'], warnings: [] };
    const check = idxs ? this.checkEntry(idxs) : { errors: [], warnings: [] };
    if (check.errors.length) return check;
    this.applyEntry(idxs);
    const byIdx = this.world.players;
    this.actions.push({ year: this.year, day: this.currentDay, type: 'entry', ids: idxs ? idxs.map((i) => byIdx[i].id) : null });
    return check;
  }

  /** 한 선수를 1군으로 올리거나 2군으로 내린다 */
  move(p: SimPlayer, toFirst: boolean): EntryCheck {
    if (p.teamIdx !== this.teamIdx) return { errors: ['다른 구단 선수입니다'], warnings: [] };
    const cur = new Set(this.registered().map((x) => x.idx));
    if (toFirst) cur.add(p.idx);
    else cur.delete(p.idx);
    const res = this.setEntry([...cur]);
    if (!res.errors.length) {
      this.addNews(this.day, 'entry', `${p.name} ${toFirst ? '1군 등록' : '1군 말소'}`);
    }
    return res;
  }

  private applyEntry(idxs: number[] | null): void {
    this.season.setManualEntry(this.teamIdx, idxs);
  }

  // ---- 기용표 (주전 자리, 선발 로테이션, 마무리)

  /** 플레이어가 정한 기용표. AI 감독에게 맡긴 상태면 null */
  get plan(): DepthPlan | null {
    return this.season.teamSeasons[this.teamIdx].plan ?? null;
  }

  /** 화면에 보일 기용표: 정한 기용표가 있으면 그것, 없으면 지금 AI 감독의 배치 */
  effectivePlan(): DepthPlan {
    if (this.plan) return this.plan;
    const ts = this.activeTeam();
    const starters: DepthPlan['starters'] = {};
    for (const { p, slot } of assignSlots(ts.hitters)) starters[slot] = p.idx;
    return { starters, rotation: ts.rotation.map((p) => p.idx), closer: ts.closer?.idx ?? null };
  }

  /** 야수의 지금 자리 (기용표 기준). 주전이 아니면 null (서브) */
  slotOf(p: SimPlayer): Slot | null {
    const st = this.effectivePlan().starters;
    return LINEUP_SLOTS.find((s) => st[s] === p.idx) ?? null;
  }

  pitcherRole(p: SimPlayer): PitcherRole {
    const pl = this.effectivePlan();
    if (pl.closer === p.idx) return 'CL';
    if (pl.rotation.includes(p.idx)) return 'SP';
    const r = pl.pen?.[p.idx];
    if (r) return r;
    // 역할을 아무것도 정하지 않았으면 AI 감독처럼 마무리를 뺀 불펜 서열 1·2번째를 필승조로 보인다 (game.ts pickReliever·bullpenOrder:
    // 개막에는 지난 시즌 실제 쓰임 순, 시즌이 지나며 능력 순)
    if (!pl.pen || !Object.keys(pl.pen).length) {
      const ts = this.activeTeam();
      const order = bullpenOrder(ts.bullpen.filter((x) => x.idx !== pl.closer && !pl.rotation.includes(x.idx)), this.season.day, this.params.penBlendDays);
      const k = order.findIndex((x) => x.idx === p.idx);
      if (k >= 0 && k < 2) return 'SU';
    }
    return 'RP';
  }

  /**
   * 기용표의 한 곳만 고친다. 지금 1군에 없는 선수(2군으로 내렸거나 임시 승격이 끝난 선수)가 기용표에 남아 있으면
   * 빼고 고친다. 예전에는 그런 선수 하나 때문에 다른 자리도 못 바꿨다 (2026-10-12 사용자: 포수를 고르는데
   * "선발 로테이션은 1군 투수여야 합니다"). 뺀 선수는 경고로 알린다
   */
  private editPlan(edit: (pl: DepthPlan) => void): EntryCheck {
    const pl = structuredClone(this.effectivePlan());
    const dropped = this.prunePlan(pl, this.registered().map((p) => p.idx));
    edit(pl);
    const r = this.setPlan(pl);
    if (!r.errors.length && dropped.size) r.warnings.unshift(this.droppedText(dropped));
    return r;
  }

  /** 기용표에서 1군(reg)에 없는 선수와 야수 자리의 투수를 뺀다. 뺀 선수 색인을 돌려준다 */
  private prunePlan(pl: DepthPlan, reg: Iterable<number>): Set<number> {
    const set = new Set(reg);
    const players = this.world.players;
    const isPit = (i: number) => set.has(i) && !!players[i]?.isPitcher;
    const dropped = new Set<number>();
    for (const s of LINEUP_SLOTS) {
      const i = pl.starters[s];
      if (i !== undefined && (!set.has(i) || players[i]?.isPitcher)) { delete pl.starters[s]; dropped.add(i); }
    }
    pl.rotation = pl.rotation.filter((i) => (isPit(i) ? true : (dropped.add(i), false)));
    if (pl.closer !== null && !isPit(pl.closer)) { dropped.add(pl.closer); pl.closer = null; }
    if (pl.pen) for (const k of Object.keys(pl.pen)) if (!isPit(Number(k))) { dropped.add(Number(k)); delete pl.pen[Number(k)]; }
    return dropped;
  }

  private droppedText(dropped: Set<number>): string {
    return `지금 1군에 없는 ${[...dropped].map((i) => this.world.players[i]?.name ?? i).join(', ')}을(를) 기용표에서 뺐습니다`;
  }

  /**
   * 기용 보드의 변경 묶음을 검사한다 (2026-10-22 UI 대개편 2차). 적용하지 않는다.
   * entry: 새 1군 명단(바꾸지 않으면 생략), plan: 새 기용표(바꾸지 않으면 생략, null이면 AI 감독).
   * 기용표는 새 1군 명단 기준으로 본다
   */
  checkBoard(change: { entry?: number[]; plan?: DepthPlan | null }): EntryCheck {
    if (!this.canManage) return { errors: [this.done ? '시즌이 끝났습니다 (가을야구에서 탈락했거나 진출하지 못함)' : '지금은 바꿀 수 없습니다'], warnings: [] };
    const errors: string[] = [];
    const warnings: string[] = [];
    const entry = change.entry ?? (change.plan && !this.manualEntry ? this.registered().map((p) => p.idx) : undefined);
    if (entry) {
      const r = this.checkEntry(entry);
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
    if (change.plan) {
      const reg = entry ?? this.registered().map((p) => p.idx);
      const pl = structuredClone(change.plan);
      const dropped = this.prunePlan(pl, reg);
      if (dropped.size) warnings.unshift(this.droppedText(dropped));
      const r = this.checkPlan(pl, reg);
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
    return { errors, warnings };
  }

  /**
   * 기용 보드의 변경 묶음을 한 번에 적용한다. 엔트리와 기용표를 함께 검사해 하나라도 어기면 아무것도 바꾸지 않는다.
   * AI가 엔트리를 관리하던 중이면 지금 1군 명단으로 직접 관리를 시작한다.
   * 조작 기록은 기존 'entry'·'plan' 그대로 남는다 (재현·저장 호환)
   */
  applyBoard(change: { entry?: number[]; plan?: DepthPlan | null }): EntryCheck {
    const check = this.checkBoard(change);
    if (check.errors.length) return check;
    const entry = change.entry ?? (change.plan && !this.manualEntry ? this.registered().map((p) => p.idx) : undefined);
    if (entry) {
      const before = new Set(this.registered().map((p) => p.idx));
      const after = new Set(entry);
      const r = this.setEntry(entry);
      if (r.errors.length) return r;
      for (const p of this.team.org) {
        if (before.has(p.idx) !== after.has(p.idx)) this.addNews(this.day, 'entry', `${p.name} ${after.has(p.idx) ? '1군 등록' : '1군 말소'}`);
      }
    }
    if (change.plan !== undefined) {
      const pl = change.plan ? structuredClone(change.plan) : null;
      if (pl) this.prunePlan(pl, this.registered().map((p) => p.idx));
      const r = this.setPlan(pl);
      if (r.errors.length) return r;
    }
    return check;
  }

  /** 야수를 주전 자리에 세우거나(slot) 서브로 돌린다(null). 그 자리에 있던 선수는 서브가 된다 */
  setHitterSlot(p: SimPlayer, slot: Slot | null): EntryCheck {
    return this.editPlan((pl) => {
      for (const s of LINEUP_SLOTS) if (pl.starters[s] === p.idx) delete pl.starters[s];
      if (slot) pl.starters[slot] = p.idx;
    });
  }

  /**
   * 화면에 보일 타순 (자리 순서): 정한 타순이 있으면 그것, 없으면 AI 감독이 지금 주전으로 짤 타순.
   * 어느 자리가 몇 번인지로 정하므로, 그 자리 주전이 빠지면 대신 나온 선수가 그 타순에 선다
   */
  battingOrderSlots(): { order: Slot[]; manual: boolean } {
    const plan = this.plan;
    if (plan?.order?.length === 9) return { order: [...plan.order], manual: true };
    const ts = this.activeTeam();
    const fixed = new Map<Slot, SimPlayer>();
    for (const s of LINEUP_SLOTS) {
      const i = plan?.starters[s];
      const p = i === undefined ? undefined : ts.hitters.find((x) => x.idx === i);
      if (p) fixed.set(s, p);
    }
    const placed = assignSlots(ts.hitters, fixed.size ? fixed : undefined);
    const bySlot = new Map(placed.map((x) => [x.p.idx, x.slot]));
    const ai = battingOrder(placed.map((x) => x.p), this.world.league).map((p) => bySlot.get(p.idx)!).filter(Boolean);
    const rest = LINEUP_SLOTS.filter((s) => !ai.includes(s));
    return { order: [...ai, ...rest].slice(0, 9), manual: false };
  }

  /** 타순을 정한다 (자리 순서). null이면 AI 감독에게 맡긴다. 기용표를 직접 정한 상태로 바뀐다 */
  setBattingOrder(order: Slot[] | null): EntryCheck {
    return this.editPlan((pl) => {
      if (order) pl.order = [...order];
      else delete pl.order;
    });
  }

  /**
   * 투수 보직을 바꾼다. 마무리는 한 명이라, 새로 정하면 기존 마무리는 추격조로 간다.
   * 불펜 역할(필승조·롱릴리프·패전조)을 처음 하나 정할 때는 지금 화면에 보이던 필승조(AI 서열 1·2번째)를 그대로 옮겨 적어,
   * 하나 바꿨다고 나머지 필승조가 추격조로 떨어지지 않게 한다
   */
  setPitcherRole(p: SimPlayer, role: PitcherRole): EntryCheck {
    const shown = new Map(this.registered().filter((x) => x.isPitcher).map((x) => [x.idx, this.pitcherRole(x)]));
    return this.editPlan((pl) => {
      if (!pl.pen || !Object.keys(pl.pen).length) {
        pl.pen = {};
        for (const [i, r] of shown) if (r === 'SU') pl.pen[i] = 'SU';
      }
      pl.rotation = pl.rotation.filter((i) => i !== p.idx);
      if (pl.closer === p.idx) pl.closer = null;
      delete pl.pen[p.idx];
      if (role === 'SP') pl.rotation.push(p.idx);
      if (role === 'CL') pl.closer = p.idx;
      if (role === 'SU' || role === 'LR' || role === 'MOP') pl.pen[p.idx] = role;
      if (!Object.keys(pl.pen).length) delete pl.pen;
    });
  }

  /** 기용표 검사: 주전·로테이션·마무리는 지금 1군(regIdxs가 있으면 그 명단)에 등록된 우리 선수여야 한다 */
  checkPlan(plan: DepthPlan, regIdxs?: Iterable<number>): EntryCheck {
    const errors: string[] = [];
    const warnings: string[] = [];
    const regSet = regIdxs ? new Set(regIdxs) : null;
    const reg = new Map((regSet ? this.team.org.filter((p) => regSet.has(p.idx)) : this.registered()).map((p) => [p.idx, p]));
    const seen = new Set<number>();
    for (const s of LINEUP_SLOTS) {
      const i = plan.starters[s];
      if (i === undefined) continue;
      const p = reg.get(i);
      if (!p || p.isPitcher) errors.push(`${s} 주전은 1군 야수여야 합니다`);
      if (seen.has(i)) errors.push(`${p?.name ?? i}이(가) 두 자리에 들어 있습니다`);
      seen.add(i);
    }
    for (const i of plan.rotation) {
      const p = reg.get(i);
      if (!p || !p.isPitcher) errors.push('선발 로테이션은 1군 투수여야 합니다');
    }
    if (plan.closer !== null) {
      const p = reg.get(plan.closer);
      if (!p || !p.isPitcher) errors.push('마무리는 1군 투수여야 합니다');
      if (plan.rotation.includes(plan.closer)) errors.push('선발 투수를 마무리로 함께 쓸 수 없습니다');
    }
    for (const k of Object.keys(plan.pen ?? {})) {
      const i = Number(k);
      if (!reg.get(i)?.isPitcher) errors.push('불펜 역할은 1군 투수에게만 줄 수 있습니다');
      if (plan.rotation.includes(i) || plan.closer === i) errors.push('선발·마무리에게 불펜 역할을 함께 줄 수 없습니다');
    }
    if (plan.order && (plan.order.length !== 9 || new Set(plan.order).size !== 9 || plan.order.some((s) => !LINEUP_SLOTS.includes(s)))) {
      errors.push('타순은 아홉 자리를 한 번씩 넣어야 합니다');
    }
    const nStart = LINEUP_SLOTS.filter((s) => plan.starters[s] !== undefined).length;
    if (nStart < 9) warnings.push(`주전이 ${9 - nStart}자리 비어 있어 그 자리는 AI 감독이 채웁니다`);
    if (plan.rotation.length < 4) warnings.push(`선발이 ${plan.rotation.length}명이라 AI 감독이 선발을 더 채웁니다`);
    if (plan.rotation.length > 6) warnings.push(`선발이 ${plan.rotation.length}명입니다. 등판 간격이 길어집니다`);
    return { errors, warnings };
  }

  /** 기용표를 정한다. null이면 AI 감독에게 맡긴다 */
  setPlan(plan: DepthPlan | null): EntryCheck {
    if (!this.canManage) return { errors: [this.done ? '시즌이 끝났습니다 (가을야구에서 탈락했거나 진출하지 못함)' : '지금은 바꿀 수 없습니다'], warnings: [] };
    if (!this.manualEntry) return { errors: ['1군을 직접 관리할 때만 기용표를 정할 수 있습니다'], warnings: [] };
    const check = plan ? this.checkPlan(plan) : { errors: [], warnings: [] };
    if (check.errors.length) return check;
    this.season.setPlan(this.teamIdx, plan);
    this.actions.push({ year: this.year, day: this.currentDay, type: 'plan', plan: plan ? this.planToIds(plan) : null });
    return check;
  }

  private planToIds(plan: DepthPlan): PlanIds {
    const id = (i: number) => this.world.players[i].id;
    const starters: PlanIds['starters'] = {};
    for (const s of LINEUP_SLOTS) if (plan.starters[s] !== undefined) starters[s] = id(plan.starters[s]!);
    const pen = plan.pen ? Object.fromEntries(Object.entries(plan.pen).map(([i, r]) => [id(Number(i)), r])) : undefined;
    return { starters, rotation: plan.rotation.map(id), closer: plan.closer === null ? null : id(plan.closer), ...(plan.order ? { order: [...plan.order] } : {}), ...(pen ? { pen } : {}) };
  }

  private planFromIds(ids: PlanIds): DepthPlan {
    const byId = new Map(this.world.players.map((p) => [p.id, p.idx]));
    const starters: DepthPlan['starters'] = {};
    for (const s of LINEUP_SLOTS) {
      const i = ids.starters[s] === undefined ? undefined : byId.get(ids.starters[s]!);
      if (i !== undefined) starters[s] = i;
    }
    const rotation = ids.rotation.map((x) => byId.get(x)).filter((x): x is number => x !== undefined);
    const pen: Record<number, PenRole> = {};
    for (const [id, r] of Object.entries(ids.pen ?? {})) { const i = byId.get(id); if (i !== undefined) pen[i] = r; }
    return { starters, rotation, closer: ids.closer === null ? null : byId.get(ids.closer) ?? null, ...(ids.order ? { order: [...ids.order] } : {}), ...(Object.keys(pen).length ? { pen } : {}) };
  }

  // ---- 시즌 진행

  /**
   * days일 진행한다 (시즌이 끝나면 멈춤). 실제로 진행한 날 수를 돌려준다.
   * stops: 무엇에서 멈출지 (stops.ts). 빠진 칸은 멈추지 않는다. 기본은 아무 데서도 멈추지 않는다 (테스트·장기 진행·시즌 끝까지).
   * - 이벤트: 멈추는 이벤트면 그날 멈추고, 답을 기다리는 동안 진행하지 않는다.
   *   멈추지 않는 이벤트는 다음 날 첫 번째 선택지로 자동 처리하고 조작 기록에 남기지 않는다 (재현해도 같은 자리에서 자동 처리된다).
   * - 손볼 일(1군 선수 이탈·연패·트레이드 마감일·육성선수 등록일): 생긴 날 멈추고 attention에 남는다.
   * 멈췄으면 stopped가 true다.
   */
  advance(days: number, stops?: Partial<StopRules> | null): number {
    const r = stopRules(stops);
    let n = 0;
    this.attention = [];
    this.stopped = false;
    while (n < days && this.phase === 'season' && !this.season.done) {
      const ev = this.league.events?.pending;
      if (ev) {
        if (stopsOnEvent(r, ev)) { this.stopped = true; break; }
        this.applyEventChoice(0, true);
      }
      // 위기 멈춤 (직접 지휘): 오늘 우리 경기를 미리 돌려 위기가 오면 그날을 진행하지 않고 멈춘다
      if (r.crisis && this.hasGameToday && this.pendingCommand?.day !== this.day) {
        const pv = this.commandPreview([], 'crisis');
        if (pv.req) {
          this.crisis = pv;
          this.attention.push({ kind: 'crisis', text: `오늘 경기 ${pv.req.inn}회${pv.req.top ? '초' : '말'} 위기·승부처입니다. 직접 지휘하세요.` });
          this.stopped = true;
          break;
        }
      }
      const streak0 = r.losing ? this.currentStreak() : 0;
      this.stepDay();
      n++;
      this.checkStops(r, streak0);
      const now = this.league.events?.pending;
      if ((now && stopsOnEvent(r, now)) || this.attention.length) { this.stopped = true; break; }
    }
    return n;
  }

  /** 하루 진행한 뒤 멈춤 조건(이벤트 밖)을 본다 */
  private checkStops(r: StopRules, streak0: number): void {
    if (r.injury) {
      for (const a of this.absencesToday) {
        if (a.days >= r.injuryDays) this.attention.push({ kind: 'injury', text: a.text });
      }
    }
    if (this.season.done) return;
    if (r.losing) {
      const k = this.currentStreak();
      if (k <= -r.losingN && streak0 > -r.losingN) this.attention.push({ kind: 'losing', text: `${-k}연패에 빠졌습니다. 엔트리·기용표·타순을 점검해 보세요.` });
    }
    const day = this.season.day;
    if (r.deadline && day === this.tradeDeadlineDay) {
      this.attention.push({ kind: 'deadline', text: `오늘이 트레이드 마감일(${this.tradeDl.month}월 ${this.tradeDl.date}일)입니다. 오늘 경기 전까지 트레이드할 수 있습니다.` });
    }
    if (r.devDay && day === this.devRegisterDay && this.team.org.some((p) => p.dev)) {
      this.attention.push({ kind: 'dev', text: `오늘(${DEV_REGISTER_FROM.month}월 ${DEV_REGISTER_FROM.date}일)부터 육성선수를 정식 등록할 수 있습니다 (${this.tradeDl.month}월 ${this.tradeDl.date}일까지).` });
    }
  }

  /** 육성선수 정식 등록이 되는 첫날 (일정 색인) */
  get devRegisterDay(): number {
    const n = this.season.schedule.length;
    for (let d = 0; d < n; d++) {
      const dt = dateOf(this.world.year, d);
      if (dt.month > DEV_REGISTER_FROM.month || (dt.month === DEV_REGISTER_FROM.month && dt.date >= DEV_REGISTER_FROM.date)) return d;
    }
    return n;
  }

  private formWithCoaches(form: Float64Array | null): Float64Array | null {
    if (!this.league.coaches) return form;
    const out = form ?? new Float64Array(this.world.players.length);
    const edges = this.world.teams.map((t) => coachEdge(this.league, t.idx));
    for (const p of this.world.players) {
      const e = edges[p.teamIdx];
      if (e) out[p.idx] += p.isPitcher ? e.pit : e.bat;
    }
    return out;
  }

  /** 마지막 진행에서 생긴, 플레이어가 손봐야 할 일 (화면이 진행을 멈추고 보여 준다) */
  attention: Attention[] = [];
  /** 마지막 진행이 멈춤 조건(이벤트 포함)에 걸려 멈췄나 */
  stopped = false;
  /** 오늘 빠진, 직접 관리하는 1군 선수 (멈춤 판정용) */
  private absencesToday: { text: string; days: number }[] = [];

  /** 다음 경기일까지 진행한다 (중간의 휴식일 포함). 멈춤 조건에 걸리면 거기서 멈춘다 */
  advanceToNextGameDay(stops?: Partial<StopRules> | null): number {
    let n = 0;
    const attention: Attention[] = [];
    do {
      n += this.advance(1, stops);
      attention.push(...this.attention);
      if (this.stopped) break;
    } while (this.phase === 'season' && !this.season.done && !this.season.schedule[this.season.day - 1]?.length);
    this.attention = attention;
    return n;
  }

  private stepDay(): void {
    const s = this.season;
    const day = s.day;
    const year = this.world.year;
    const org = this.team.org;
    const manual = this.manualEntry;
    // 기사 기준점은 그날 경기 전에 잡는다 (새 게임이든 불러온 게임이든 같은 시점이라 같은 기사가 나온다)
    if (!s.done) this.articleBase();

    // 오늘 복귀하는 선수
    if (day > 0) {
      for (const p of org) {
        if (s.states.absentUntil[p.idx] !== day) continue;
        const where = manual && !manual.has(p.idx) ? ' 지금 2군에 있습니다.' : '';
        this.addNews(day, 'return', `${p.name} 복귀.${where}`);
      }
    }
    // 그날 바뀌는 규칙·공인구 검사 발표 (ruleNews.ts, 날짜로만 정해진다)
    if (day > 0) for (const n of this.ruleNewsFor().dated) if (n.day === day) this.addNews(day, 'season', n.text);
    const before = org.map((p) => s.states.absentUntil[p.idx]);
    this.absencesToday = [];
    // 무작위 이벤트의 경기력 효과 (events.ts formToday) + 코치 (coaches.ts coachEdge)
    this.prepareDay(s);
    // 직접 지휘한 경기: 조작 기록의 선택을 물음 순서대로 (모자라면 자동)
    const cmd = this.pendingCommand?.day === day ? this.pendingCommand : null;
    s.commander = cmd ? { team: this.teamIdx, decide: (req) => cmd.choices[req.n] ?? {} } : null;
    s.simulateDay();
    s.commander = null;
    this.pendingCommand = null;

    org.forEach((p, i) => {
      const until = s.states.absentUntil[p.idx];
      if (until > day && until !== before[i]) {
        const inFirst = !manual || manual.has(p.idx);
        // 이탈 사유는 실존 선수에게 중립 문구만 쓴다 (기획서 7장, absenceReason → eventLabel)
        const reason = this.absenceReason(p) ?? '결장';
        const back = until >= s.schedule.length ? '이번 시즌 복귀 어려움' : `복귀 예정 ${formatDate(year, until)} (${until - day}일)`;
        // 직접 관리하는 1군 선수가 빠지면 멈춤 판정에 넘긴다 (엔트리·기용표를 손볼 수 있게, checkStops)
        if (manual?.has(p.idx)) this.absencesToday.push({ text: `${p.name}: ${reason}, ${back}`, days: until - day });
        this.addNews(day, 'absence', `${p.name}: ${reason}. ${back}.${inFirst && manual ? ' 1군 자리를 비워 두려면 2군으로 내리세요.' : ''}`);
      }
    });

    const ups = s.teamSeasons[this.teamIdx].callUps ?? [];
    const fresh = ups.filter((p) => !this.lastCallUps.has(p.idx));
    if (fresh.length) {
      this.addNews(day, 'callup', `1군에서 뛸 수 있는 선수가 모자라 2군의 ${fresh.map((p) => p.name).join(', ')}을(를) 임시로 올렸습니다.`);
    }
    this.lastCallUps = new Set(ups.map((p) => p.idx));

    if (s.done) {
      const rank = s.standings().indexOf(this.teamIdx) + 1;
      const t = s.teams[this.teamIdx];
      this.addNews(day, 'season', `정규시즌 종료. ${this.team.name} 최종 ${rank}위 (${t.w}승 ${t.l}패 ${t.t}무).`);
      this.openPostseason();
    } else {
      if (day === this.allStarDay) this.allStarBreak(day);
      this.dailyArticles();
      this.aiTradeDay();
      this.aiMarket();
      this.aiDevRegister();
      this.tradeOfferDay();
      // 무작위 이벤트 (정규시즌 중, events.ts)
      const ev = rollEvent(ensureEvents(this.league), this.eventContext());
      if (ev) this.addNews(this.season.day, 'event', `이벤트: ${eventDef(ev.id)!.title}`);
    }
    this.watchCheck(day);
  }

  /**
   * AI 구단의 트레이드 제안 (2026-10-12): 트레이드 마감 전까지 날마다 TRADE_OFFER_CHANCE 확률로 한 구단이 연락해 온다.
   * 받아들일 만한 조건이 없으면 그날은 넘어간다. 답을 기다리는 이벤트가 있으면 굴리지 않는다.
   * 화면·선택지는 이벤트 'trade-offer'를 그대로 쓴다 (멈춤 설정의 '트레이드 제안'에서 멈춘다)
   */
  private tradeOfferDay(): void {
    const st = ensureEvents(this.league);
    if (st.pending || !this.tradeOpen) return;
    const rng = new Rng(`${this.league.seed}/trade-offer/${this.year}/${this.season.day}`);
    if (!rng.chance(TRADE_OFFER_CHANCE)) return;
    const o = this.aiTradeOffer(rng);
    if (!o) return;
    st.pending = { id: 'trade-offer', year: this.year, day: this.season.day, vars: { team: o.team, teamName: o.teamName, give: o.give, giveName: o.giveName, get: o.get, getName: o.getName } };
    this.addNews(this.season.day, 'event', `이벤트: ${eventDef('trade-offer')!.title} (${o.teamName})`);
  }

  // ---- 무작위 이벤트 (events.ts)

  /** 답을 기다리는 이벤트 */
  get pendingEvent(): PendingEvent | null {
    return this.league.events?.pending ?? null;
  }

  /** 이벤트 효과를 적용할 도구 */
  eventContext(): EventContext {
    const L = this.league;
    const s = this.season;
    const st = s.standings();
    const rec = s.teams[this.teamIdx];
    const day = s.day;
    const year = this.world.year;
    const team = this.teamIdx;
    return {
      league: L, team, teamName: this.team.name, year, day, seasonDays: s.schedule.length,
      rank: st.indexOf(team) + 1, teams: st.length,
      winPct: rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : 0.5,
      cash: this.cashNow(),
      roster: L.players.filter((p) => p.team === team),
      addCash: (amount, note) => {
        if (!amount) return;
        L.ledger.push(amount > 0
          ? { year, from: -1, to: team, amount, note, kind: 'event' }
          : { year, from: team, to: -1, amount: -amount, note, kind: 'event' });
      },
      addTrust: (d) => { const o = this.owner; o.trust = Math.max(0, Math.min(100, o.trust + d)); },
      addFill: (fill, days, note) => { ensureEvents(L).buffs.push({ team, year, from: day, until: day + days, fill, note }); },
      addFans: (delta, note) => addFanEvent(L, team, year, day, delta, note),
      addPotential: (id, delta) => { const p = L.players.find((x) => x.id === id && x.team === team); if (p) p.potential += delta; },
      // ---- 경기에 영향을 주는 도구
      players: this.team.org.map((p) => {
        const b = s.bat[p.idx];
        const pt = s.pit[p.idx];
        return {
          id: p.id, name: p.name, isPitcher: p.isPitcher, starter: isStarterSkill(p.pit), age: p.age, foreign: p.foreign,
          pa: b.pa, ops: b.pa ? ops(b) : 0, outs: pt.outs, era: pt.outs ? (pt.er * 27) / pt.outs : 0,
          fatigue: currentFatigue(s.states, p.idx, day),
        };
      }),
      recent: this.recentRecord(10),
      streak: this.currentStreak(),
      month: dateOf(year, Math.min(day, s.schedule.length - 1)).month,
      hasRival: rivalsOf(L, this.team.franchise).length > 0,
      tradeOpen: this.tradeOpen,
      addForm: (edge, days, note, opts) => {
        const from = day + (opts?.delay ?? 0);
        (ensureEvents(L).forms ??= []).push({ team, year, from, until: from + days, edge, note,
          ...(opts?.player ? { player: opts.player } : {}), ...(opts?.side && opts.side !== 'all' ? { side: opts.side } : {}) });
      },
      addCond: (value, days, reason, opts) => {
        const from = day + (opts?.delay ?? 0);
        (ensureEvents(L).conds ??= []).push({ team, year, from, until: from + days, value, reason, ...(opts?.player ? { player: opts.player } : {}) });
      },
      restPitchers: (all) => {
        for (const p of this.team.org) if (p.isPitcher && (all || !isStarterSkill(p.pit))) s.clearFatigue(p.idx);
      },
      rest: (id, days) => {
        const p = this.world.players.find((x) => x.id === id && x.teamIdx === team);
        if (p) s.restPlayer(p.idx, day + days);
      },
      tradeOffer: (rng) => this.aiTradeOffer(rng),
      trade: (ai, giveId, getId) => {
        const give = this.world.players.find((x) => x.id === giveId);
        const get = this.world.players.find((x) => x.id === getId);
        if (!give || !get || give.teamIdx !== team || get.teamIdx !== ai) return '선수 소속이 바뀌어 트레이드가 무산됐습니다.';
        const ev = this.evaluateTrade(ai, [give], [get]);
        if (ev.verdict !== 'accept') return `조건이 바뀌어 트레이드가 무산됐습니다 (${ev.message})`;
        this.applyTrade(ai, [give.idx], [get.idx]);
        (L.eventTrades ??= []).push({ year: this.year, day: this.day, team: ai, give: [give.id], get: [get.id] });
        this.addNews(this.day, 'trade', `트레이드 성사: ${this.world.teams[ai].name}에 ${give.name}을(를) 내주고 ${get.name}을(를) 받았습니다. 받은 선수는 2군에 등록됩니다.`);
        return `${give.name} ↔ ${get.name} 트레이드가 성사됐습니다.`;
      },
    };
  }

  /** 우리 구단 최근 n경기 승패 */
  private recentRecord(n: number): { w: number; l: number } {
    let w = 0;
    let l = 0;
    const log = this.season.log;
    for (let i = log.length - 1; i >= 0 && w + l < n; i--) {
      const g = log[i];
      if (g.home !== this.teamIdx && g.away !== this.teamIdx) continue;
      const mine = g.home === this.teamIdx ? g.homeRuns - g.awayRuns : g.awayRuns - g.homeRuns;
      if (mine > 0) w++; else if (mine < 0) l++;
    }
    return { w, l };
  }

  /** 지금 연승(+)·연패(−). 무승부는 끊는다 */
  private currentStreak(): number {
    let k = 0;
    const log = this.season.log;
    for (let i = log.length - 1; i >= 0; i--) {
      const g = log[i];
      if (g.home !== this.teamIdx && g.away !== this.teamIdx) continue;
      const mine = Math.sign(g.home === this.teamIdx ? g.homeRuns - g.awayRuns : g.awayRuns - g.homeRuns);
      if (mine === 0 || (k !== 0 && Math.sign(k) !== mine)) break;
      k += mine;
    }
    return k;
  }

  /**
   * AI 구단이 먼저 거는 1대1 트레이드 제안: 우리 구단의 쓸 만한 선수(가치 8~25위) 하나를 원하고,
   * AI가 받아들이는 조건 안에서 우리에게 가장 가치 있는 선수를 준다. 우리 쪽 손해가 크면(받는 가치 < 주는 가치의 85%) 내지 않는다.
   */
  private aiTradeOffer(rng: Rng): { team: number; teamName: string; give: string; giveName: string; get: string; getName: string } | null {
    if (!this.tradeOpen) return null;
    const w = [1, 0.6];
    const val = (p: SimPlayer) => playerValue(p, this.values, w);
    const ok = (p: SimPlayer) => !p.foreign && this.leaguePlayer(p.id)?.noTradeYear !== this.year;
    const mine = this.team.org.filter(ok).sort((a, b) => val(b) - val(a) || a.idx - b.idx).slice(7, 25);
    const others = this.world.teams.filter((t) => t.idx !== this.teamIdx);
    if (!mine.length || !others.length) return null;
    for (let tries = 0; tries < 4; tries++) {
      const ai = others[rng.int(others.length)];
      const give = mine[rng.int(mine.length)];
      const cands = ai.org.filter(ok).sort((a, b) => val(b) - val(a) || a.idx - b.idx);
      for (const get of cands) {
        if (val(get) < val(give) * 0.85) break;
        if (this.evaluateTrade(ai.idx, [give], [get]).verdict === 'accept') {
          return { team: ai.idx, teamName: ai.name, give: give.id, giveName: give.name, get: get.id, getName: get.name };
        }
      }
    }
    return null;
  }

  /** 이벤트에 답한다 (화면). 조작 기록에 남는다 */
  answerEvent(choice: number): { ok: boolean; message: string } {
    const ev = this.pendingEvent;
    if (!ev) return { ok: false, message: '답할 이벤트가 없습니다.' };
    const def = eventDef(ev.id)!;
    if (!def.choices[choice]) return { ok: false, message: '없는 선택지입니다.' };
    const result = this.applyEventChoice(choice);
    this.actions.push({ year: this.year, day: this.day, type: 'event', choice });
    return { ok: true, message: result };
  }

  /** auto: 답하지 않고 진행해 첫 번째 선택지로 자동 처리 (조작 기록에 남기지 않는다. 다시 돌려도 같은 자리에서 자동 처리된다) */
  private applyEventChoice(choice: number, auto = false): string {
    const ev = this.pendingEvent;
    if (!ev) return '';
    const def = eventDef(ev.id)!;
    const result = resolveEvent(ensureEvents(this.league), this.eventContext(), choice);
    this.addNews(this.season.day, 'event', `${def.title}: ${def.choices[choice].label}${auto ? ' (자동)' : ''} — ${result}`);
    return result;
  }

  private addNews(day: number, kind: NewsKind, text: string): void {
    this.news.push({ year: this.year, day, kind, text });
  }

  // ---- 가을야구 (M7, 2026-10-08 사용자 요청으로 한 경기씩 진행)

  /** 정규시즌이 끝나면 대진을 정한다 (난수를 쓰지 않는다) */
  private openPostseason(): void {
    if (this.postseason) return;
    this.season.setForm(null);
    const st = this.season.standings();
    this.postseason = startPostseason(this.season, st, this.world.rules.postseasonTeams, seasonSeed(this.league));
    if (ruleOf(this.league, 'postseasonMaxInnings') !== RULE_DEFAULTS.postseasonMaxInnings) this.postseason.maxInnings = ruleOf(this.league, 'postseasonMaxInnings');
    const name = (t: number) => this.world.teams[t].name;
    const mine = this.postseason.seeds.includes(this.teamIdx);
    this.addNews(this.day, 'season', `가을야구 대진: ${this.postseason.seeds.map((t, i) => `${i + 1}위 ${name(t)}`).join(', ')}.${mine ? ' 우리 구단이 진출했습니다!' : ''}`);
  }

  /** 가을야구를 games경기 진행한다. 실제로 치른 경기 수를 돌려준다 */
  advancePostseason(games: number): number {
    let n = 0;
    while (n < games && this.postseasonRunning) {
      const st = this.postseason!;
      const before = currentSeries(st)!;
      // 직접 지휘한 경기 (조작 기록 command, 그 경기 날짜): 고른 대로, 나머지 물음은 감독에게
      const cmd = this.pendingCommand?.day === st.day ? this.pendingCommand : null;
      const commander: GameCommand | null = cmd ? { team: this.teamIdx, decide: (req) => cmd.choices[req.n] ?? {} } : null;
      if (cmd) this.pendingCommand = null;
      const g = playNextGame(st, this.season, commander)!;
      n++;
      this.postseasonGameNews(before, g);
    }
    return n;
  }

  /** 지금 시리즈가 끝날 때까지 */
  advanceSeries(): number {
    const x = this.postseason && currentSeries(this.postseason);
    if (!x) return 0;
    let n = 0;
    while (this.postseasonRunning && currentSeries(this.postseason!) === x) n += this.advancePostseason(1);
    return n;
  }

  /** 우리 구단의 다음 가을야구 경기까지 (탈락했으면 끝까지) */
  advanceToOurPostseasonGame(): number {
    let n = 0;
    while (this.postseasonRunning) {
      const x = currentSeries(this.postseason!)!;
      const ours = x.high === this.teamIdx || x.low === this.teamIdx;
      n += this.advancePostseason(1);
      if (ours) break;
    }
    return n;
  }

  private postseasonGameNews(x: ReturnType<typeof currentSeries> & object, g: SeriesGame): void {
    const name = (t: number) => this.world.teams[t].name;
    const mine = x.high === this.teamIdx || x.low === this.teamIdx;
    const no = x.games.length;
    if (mine) {
      this.addNews(g.day, 'season', `${ROUND_LABEL[x.round]} ${no}차전: ${name(g.away)} ${g.awayRuns} - ${g.homeRuns} ${name(g.home)}${g.innings > 9 ? ` (${g.innings}회)` : ''} · 시리즈 ${name(x.high)} ${x.winsHigh} - ${x.winsLow} ${name(x.low)}`);
    }
    if (x.winner >= 0) {
      this.addNews(g.day, 'season', `${ROUND_LABEL[x.round]} 종료: ${name(x.winner)} 승리 (${x.winsHigh} - ${x.winsLow}).`);
      if (x.mvp) this.addNews(g.day, 'season', `${ROUND_LABEL[x.round]} MVP: ${name(x.mvp.team)} ${x.mvp.name} (${x.mvp.line})`);
      if (this.postseason!.done) this.addNews(g.day, 'season', `${this.year} 한국시리즈 우승: ${name(x.winner)}!`);
    }
  }

  /** 다음에 치를 이 구단 경기 (없으면 null) */
  nextGame(teamIdx = this.teamIdx): { day: number; home: number; away: number } | null {
    const sch = this.season.schedule;
    for (let d = this.season.day; d < sch.length; d++) {
      const g = sch[d].find((x) => x.home === teamIdx || x.away === teamIdx);
      if (g) return { day: d, ...g };
    }
    return null;
  }

  /** 다음 경기일의 예상 선발 투수 */
  probableStarter(teamIdx: number): SimPlayer | null {
    const ts = this.season.refresh(teamIdx);
    if (!ts.rotation.length && !ts.bullpen.length) return null;
    const next = this.nextGame(teamIdx);
    return todaysStarter(ts, this.season.states, next?.day ?? this.season.day, this.season.params);
  }

  // ---- 관심 명단 (game/watch.ts, 조작 기록 밖)

  isWatched(id: string): boolean {
    return this.watch.some((w) => w.id === id);
  }

  /** 담거나 뺀다. 돌려주는 값: 이제 담겨 있나 */
  toggleWatch(id: string, name: string): boolean {
    if (this.isWatched(id)) {
      this.watch = this.watch.filter((w) => w.id !== id);
      return false;
    }
    // 담을 때 이미 참인 일(FA 시장에 있음, 트레이드 가능 등)은 알리지 않는다
    this.watch = [...this.watch, markTold(this.watchCtx(), { id, name, year: this.year })];
    return true;
  }

  watchStatus(id: string): WatchStatus {
    return watchStatus(this.watchCtx(), id);
  }

  private watchCtx(): WatchNewsCtx {
    return {
      phase: this.phase, league: this.league, worldPlayers: this.world.players, offseason: this.offseason,
      year: this.year, userTeam: this.teamIdx, tradeOpen: this.tradeOpen, deadline: this.tradeDl,
    };
  }

  /**
   * 관심 선수 소식 (game/watch.ts watchNews): 하루 진행·오프시즌 조작 뒤 그날 상태에서 새로 생긴 일만 소식에 한 줄씩.
   * 난수를 쓰지 않고 진행 상태를 바꾸지 않는다 (관심 명단의 알린 일 칸만 고친다). 결정함에는 띄우지 않는다
   */
  private watchCheck(day: number): void {
    if (!this.watch.length) return;
    const r = watchNews(this.watchCtx(), this.watch);
    this.watch = r.watch;
    for (const text of r.lines) this.news.push({ year: this.year, day, kind: 'watch', text });
  }

  // ---- 리그 상태 조회

  /** 선수 id → 리그 상태의 선수 (계약·잠재력). 시즌 중에는 개막 때 값 */
  leaguePlayer(id: string): LeaguePlayer | undefined {
    return this.league.players.find((p) => p.id === id);
  }

  // ---- 트레이드

  /** 선수 가치 계산의 기준 (대체 선수 수준, 잠재력, 연봉). 시즌 시작 때 한 번 정한다 */
  get values(): ValueContext {
    if (!this.valueCtx) {
      const ctx = valueContext(this.world);
      // AI 구단이 보는 잠재력 (난이도 오차, owner.ts). 트레이드 판단은 AI 쪽 판단이다
      ctx.potential = new Map(this.league.players.map((p) => [p.id, aiPotential(this.league, p)]));
      // 연봉은 그 해 연봉 상승 지수로 나눠 2026년 돈으로 (AI의 연봉 부담 단가가 2026년 값이다)
      const wage = wageIndex(this.year, this.league);
      ctx.salary = new Map(this.league.players.filter((p) => !p.foreign).map((p) => [p.id, p.contract.salary / wage]));
      this.valueCtx = ctx;
    }
    return this.valueCtx;
  }

  /** 올스타전 날 (일정 색인, 휴식일). 없으면 -1 (league/allstar.ts) */
  get allStarDay(): number {
    return allStarDay(this.season.schedule, this.world.year);
  }

  /** 올해 올스타전 기록 (아직이면 null) */
  get allStarThisYear(): AllStarRecord | null {
    return this.league.allStars?.find((r) => r.year === this.world.year) ?? null;
  }

  /** 올스타전 하루: 선발·경기·홈런 더비, 우리 선수 소식과 팬 만족도, 기사 */
  private allStarBreak(day: number): void {
    const year = this.world.year;
    const rec = playAllStar(this.league, this.world, this.season, this.values, day);
    if (!rec) return;
    const nameOf = (id: string | null) => (id ? rec.roster.find((x) => x.id === id)?.name ?? this.world.players.find((p) => p.id === id)?.name ?? id : '-');
    const ours = rec.roster.filter((x) => x.team === this.teamIdx);
    const [d, n] = rec.game.score;
    const result = d === n ? `${d}-${n} 무승부` : `${SIDE_NAMES[d > n ? 0 : 1]} ${Math.max(d, n)}-${Math.min(d, n)} 승리`;
    const mvpOurs = rec.game.mvp !== null && ours.some((x) => x.id === rec.game.mvp);
    const derbyOurs = rec.derby.winner !== null && ours.some((x) => x.id === rec.derby.winner);
    this.addNews(day, 'season', `올스타전: ${result}, MVP ${nameOf(rec.game.mvp)}. 홈런 더비 우승 ${nameOf(rec.derby.winner)}.`
      + (ours.length ? ` 우리 구단 ${ours.length}명 출전 (${ours.map((x) => x.name).join(', ')}).` : ' 우리 구단 출전 선수는 없습니다.'));
    const fan = Math.min(ALLSTAR_FAN.max, ours.length * ALLSTAR_FAN.perPlayer + (mvpOurs ? ALLSTAR_FAN.mvp : 0) + (derbyOurs ? ALLSTAR_FAN.derby : 0));
    if (fan > 0) addFanEvent(this.league, this.teamIdx, year, day, fan, mvpOurs ? '올스타전 MVP' : '올스타 선발');
    const mvpTeam = rec.roster.find((x) => x.id === rec.game.mvp)?.team;
    addArticle(this.league, {
      year, day, kind: 'allstar', title: `올스타전 ${result}, MVP ${nameOf(rec.game.mvp)}`,
      body: `${josa(SIDE_NAMES[0], '과', '와')} ${josa(SIDE_NAMES[1], '이', '가')} 맞붙은 ${year} 올스타전은 ${josa(result, '으로', '로')} 끝났다. MVP는 ${nameOf(rec.game.mvp)}${mvpTeam !== undefined ? `(${this.world.teams[mvpTeam].name})` : ''}. `
        + `앞서 열린 홈런 더비에서는 ${josa(nameOf(rec.derby.winner), '이', '가')} 정상에 올랐다.`,
      ...(mvpTeam !== undefined ? { franchise: this.world.teams[mvpTeam].franchise } : {}),
    });
  }

  /** 트레이드 마감 월일 (리그 규정, league/rules.ts) */
  get tradeDl(): { month: number; date: number } {
    return ruleDate(this.league, 'tradeDeadline');
  }

  /** 트레이드를 할 수 있는 마지막 날 (일정 색인). 이 날의 경기 전까지 가능 */
  get tradeDeadlineDay(): number {
    let last = -1;
    for (let d = 0; d < this.season.schedule.length; d++) {
      const dt = dateOf(this.world.year, d);
      if (dt.month < this.tradeDl.month || (dt.month === this.tradeDl.month && dt.date <= this.tradeDl.date)) last = d;
    }
    return last;
  }

  get tradeOpen(): boolean {
    return this.phase === 'season' && !this.done && this.day <= this.tradeDeadlineDay;
  }

  /** AI 구단의 현재 상황 (성향 판정 입력) */
  situation(teamIdx: number): TeamSituation {
    const s = this.season;
    const n = this.world.teams.length;
    let rank: number;
    if (s.teams[teamIdx].g < 20) {
      // 시즌 초반은 전력 순위로
      const str = this.world.teams.map((t) => teamStrength(t.org, this.values, 0));
      rank = 1 + str.filter((v, i) => v > str[teamIdx] || (v === str[teamIdx] && i < teamIdx)).length;
    } else {
      rank = s.standings().indexOf(teamIdx) + 1;
    }
    const played = s.teams[teamIdx].g;
    return {
      teamIdx, rank, nTeams: n, cut: this.world.rules.postseasonTeams,
      coreAge: coreAge(this.world.teams[teamIdx].org, this.values),
      remaining: 1 - played / this.world.gamesPerTeam,
      ...(teamIdx !== this.teamIdx ? { style: gmStyle(this.league, teamIdx) } : {}),
    };
  }

  tendency(teamIdx: number): Tendency {
    return tendencyOf(this.situation(teamIdx));
  }

  /**
   * 트레이드 제안을 AI 구단 입장에서 평가만 한다.
   * cash: 우리가 주는 현금 (만 원, 음수면 받는다). 선수를 현금만으로 사고팔 수도 있다 (재정 상세형)
   */
  evaluateTrade(aiTeam: number, give: SimPlayer[], get: SimPlayer[], cash = 0, picks: PickSwap = NO_PICKS): TradeEvaluation {
    const none = { gain: 0, need: 0, before: 0, after: 0, tendency: 'rebuild' as const };
    if (aiTeam === this.teamIdx || !this.world.teams[aiTeam]) return { verdict: 'reject-invalid', message: '상대 구단을 고르세요.', detail: none };
    if (!this.tradeOpen) {
      const why = this.done ? '시즌이 끝났습니다.' : `트레이드 마감(${this.tradeDl.month}월 ${this.tradeDl.date}일)이 지났습니다.`;
      return { verdict: 'reject-invalid', message: why, detail: none };
    }
    if (give.some((p) => p.teamIdx !== this.teamIdx)) return { verdict: 'reject-invalid', message: '우리 구단 선수만 내줄 수 있습니다.', detail: none };
    const foreign = [...give, ...get].filter((p) => p.foreign);
    if (foreign.length) return { verdict: 'reject-invalid', message: `외국인 선수는 트레이드할 수 없습니다 (${foreign.map((p) => p.name).join(', ')}).`, detail: none };
    if (!Number.isFinite(cash) || Math.round(cash) !== cash) return { verdict: 'reject-invalid', message: '현금은 만 원 단위 정수여야 합니다.', detail: none };
    if (cash > 0 && cash > this.cashNow()) return { verdict: 'reject-invalid', message: `줄 현금(${(cash / 10000).toFixed(1)}억 원)보다 자금이 모자랍니다.`, detail: none };
    if (cash < 0 && -cash > this.cashNow(aiTeam)) return { verdict: 'reject-value', message: '그만한 현금은 우리 구단 자금으로 감당할 수 없습니다.', detail: none };
    const locked = [...give, ...get].filter((p) => this.leaguePlayer(p.id)?.noTradeYear === this.year);
    if (locked.length) return { verdict: 'reject-invalid', message: `넘겨받은 지명권으로 입단한 선수는 입단 첫해 트레이드할 수 없습니다 (${locked.map((p) => p.name).join(', ')}).`, detail: none };
    const pickErr = this.checkPicks(aiTeam, give, get, picks, cash);
    if (pickErr) return { verdict: 'reject-invalid', message: pickErr, detail: none };
    const sit = this.situation(aiTeam);
    const pv = (ps: DraftPick[]) => ps.reduce((s, p) => s + this.pickValueFor(p, tendencyOf(sit)), 0);
    const pickVals = picks.give.length || picks.get.length ? { receive: pv(picks.give), give: pv(picks.get) } : undefined;
    // 판타지 설득의 호의 + 단장 평판 (league/reputation.ts)
    const goodwill = goodwillFor(this.league.fantasy, aiTeam, this.world.year, this.currentDay) + repGoodwill(this.league);
    return evaluateTrade({ aiTeam, maxPerSide: ruleOf(this.league, 'maxPerSide'), receive: give, give: get, cash: cash / wageIndex(this.year, this.league), picks: pickVals, strict: settingsOf(this.league).tradeStrict, ...(goodwill ? { goodwill } : {}) },
      this.world.teams[aiTeam].org, sit, this.values);
  }

  /** 트레이드를 제안한다. AI가 수락하면 바로 실행한다 */
  proposeTrade(aiTeam: number, give: SimPlayer[], get: SimPlayer[], cash = 0, picks: PickSwap = NO_PICKS): TradeEvaluation {
    const ev = this.evaluateTrade(aiTeam, give, get, cash, picks);
    if (ev.verdict !== 'accept') return ev;
    this.applyTrade(aiTeam, give.map((p) => p.idx), get.map((p) => p.idx), cash, picks);
    const pg = picks.give.map(pickId);
    const pr = picks.get.map(pickId);
    this.actions.push({ year: this.year, day: this.day, type: 'trade', team: aiTeam, give: give.map((p) => p.id), get: get.map((p) => p.id),
      ...(cash ? { cash } : {}), ...(pg.length ? { pg } : {}), ...(pr.length ? { pr } : {}) });
    const names = (ps: SimPlayer[], pks: DraftPick[]) => [...ps.map((p) => p.name), ...pks.map((p) => this.pickLabel(p))].join(', ') || '없음';
    const money = cash > 0 ? ` (현금 ${(cash / 10000).toFixed(1)}억 원 지급)` : cash < 0 ? ` (현금 ${(-cash / 10000).toFixed(1)}억 원 받음)` : '';
    this.addNews(this.day, 'trade', `트레이드 성사: ${this.world.teams[aiTeam].name}에 ${names(give, picks.give)}을(를) 내주고 ${names(get, picks.get)}을(를) 받았습니다${money}. 받은 선수는 2군에 등록됩니다.`);
    return ev;
  }

  // ---- 지명권 (league/picks.ts)

  /** 지명권 트레이드가 되는 시즌인가 */
  get pickTradeOpen(): boolean {
    return pickTradeAllowed(this.league, this.year, PICK_TRADE_FROM);
  }

  /** 그 구단이 가진 트레이드 가능한 지명권 */
  ownedPicks(team: number): DraftPick[] {
    return ownedPicks(this.league, team, this.year, this.world.teams.map((t) => t.idx));
  }

  /** 우리 구단의 지명권 장부: 다음 두 드래프트의 1~PICK_MAX_ROUND라운드 (오프시즌 화면) */
  pickLedger(): PickLedgerRow[] {
    const teams = this.league.teams.map((_, i) => i);
    return pickLedger(this.league, this.teamIdx, [this.year + 1, this.year + 2], teams);
  }

  /** 다음 드래프트에서 우리 1라운드 예상 순번 (1부터. 지난 시즌 역순 기준, 제재·창단 특례 전) */
  nextDraftSlot(team = this.teamIdx): number {
    return Off.pickOrder(this.league).indexOf(team) + 1;
  }

  /** "2027 1라운드 (LG)": 원래 구단 이름 */
  pickLabel(p: DraftPick): string {
    return `${p.draft} ${p.round}라운드${this.league.teams[p.from] ? ` (${this.league.teams[p.from].name})` : ''}`;
  }

  /** AI가 보는 지명권 가치 (순번은 원래 구단의 지금 순위로) */
  private pickValueFor(p: DraftPick, tendency: Tendency): number {
    return pickValue(p, this.year, this.world.teams.length, (t) => this.situation(t).rank, tendency, Off.DRAFT_POTENTIAL_SCALE);
  }

  private checkPicks(aiTeam: number, give: SimPlayer[], get: SimPlayer[], picks: PickSwap, cash = 0): string | null {
    const all = [...picks.give, ...picks.get];
    if (all.length === 0) return null;
    if (!this.pickTradeOpen) return `지명권 트레이드는 ${PICK_TRADE_FROM}년부터 할 수 있습니다 (2019년 8월 규약 개정, 세부 난이도에서 모든 시대 허용으로 바꿀 수 있습니다).`;
    if (all.length > ruleOf(this.league, 'maxPicksPerTrade')) return `한 트레이드에 지명권은 ${ruleOf(this.league, 'maxPicksPerTrade')}장까지 넣을 수 있습니다.`;
    // 2026-10-12 사용자 요청으로 현금 ↔ 지명권 트레이드도 연다 (실제 규약은 선수와 함께였다). 지명권끼리만 바꾸는 것은 막는다
    if (give.length + get.length === 0 && !cash) return '지명권은 선수나 현금과 함께 트레이드해야 합니다.';
    if (new Set(all.map(pickId)).size !== all.length) return '같은 지명권이 두 번 들어 있습니다.';
    if (all.some((p) => !tradablePick(p, this.year) || !this.world.teams[p.from])) return `트레이드할 수 없는 지명권입니다 (다음 ${PICK_YEARS_AHEAD}번의 드래프트, ${PICK_MAX_ROUND}라운드까지).`;
    if (picks.give.some((p) => pickOwner(this.league, p) !== this.teamIdx)) return '우리 구단이 가진 지명권만 내줄 수 있습니다.';
    if (picks.get.some((p) => pickOwner(this.league, p) !== aiTeam)) return '상대 구단이 가진 지명권만 받을 수 있습니다.';
    return null;
  }

  /**
   * 선수 내놓기 (2026-10-12 사용자 요청): 우리 선수(offer)를 내놓으면, 구단마다 받아들일 수 있는 조건 가운데
   * 우리 쪽에서 가장 가치 있는 1~2명 조합을 제안한다. 직접 제안과 같은 판정(evaluateTrade, 세부 난이도 포함)으로 걸러서
   * 그대로 받으면 성사된다. 우리 쪽에서 본 가치가 높은 순. 제안이 없는 구단은 빠진다
   */
  shopOffers(offer: SimPlayer[], cash = 0, want: ShopWant = 'any'): ShopOffer[] {
    if (!this.tradeOpen || offer.length > ruleOf(this.league, 'maxPerSide') || offer.some((p) => p.teamIdx !== this.teamIdx || p.foreign)) return [];
    if (offer.length === 0 && cash <= 0) return [];
    if (cash > 0 && cash > this.cashNow()) return [];
    const mine = horizonWeights(this.tendency(this.teamIdx), this.situation(this.teamIdx).remaining);
    const myTendency = this.tendency(this.teamIdx);
    const ctx = this.values;
    // 우리 쪽에서 본 가치: 기여에서 연봉 부담을 뺀다 (AI가 고액 연봉자를 떠넘기는 제안이 맨 위에 오지 않게, evaluateTrade와 같은 환산)
    const years = mine.reduce((a, b) => a + b, 0);
    const worth = (p: SimPlayer) => playerValue(p, ctx, mine) - (p.foreign ? 0 : (ctx.salary?.get(p.id) ?? 0) / SALARY_WON_PER_RUN) * years;
    type Item = { p?: SimPlayer; k?: DraftPick; v: number };
    const out: ShopOffer[] = [];
    for (const t of this.world.teams) {
      if (t.idx === this.teamIdx) continue;
      const ok = (items: Item[]) => {
        const ps = items.flatMap((x) => (x.p ? [x.p] : []));
        const ks = items.flatMap((x) => (x.k ? [x.k] : []));
        return this.evaluateTrade(t.idx, offer, ps, cash, { give: [], get: ks }).verdict === 'accept';
      };
      // 받을 후보: 외국인·육성·지명권 첫해 선수 제외, 우리 쪽에서 본 가치 순 상위 30명 + 그 구단이 가진 지명권 (2026-10-12 사용자: AI 제안에 지명권)
      const players: Item[] = t.org.filter((p) => !p.foreign && !this.leaguePlayer(p.id)?.dev && this.leaguePlayer(p.id)?.noTradeYear !== this.year)
        .map((p) => ({ p, v: worth(p) })).filter((x) => x.v > 0);
      const picks: Item[] = this.pickTradeOpen ? this.ownedPicks(t.idx).map((k) => ({ k, v: this.pickValueFor(k, myTendency) })).filter((x) => x.v > 0) : [];
      // 받고 싶은 것 (2026-10-12 사용자: 선수 또는 지명권을 고를 수 있게)
      const cands = [...(want === 'picks' ? [] : players.sort((a, b) => b.v - a.v).slice(0, 30)), ...(want === 'players' ? [] : picks)].sort((a, b) => b.v - a.v);
      let best: { items: Item[]; value: number } | null = null;
      for (const c of cands) if (ok([c])) { best = { items: [c], value: c.v }; break; }
      // 두 개: 상위 15개 안의 조합 가운데 한 개보다 나은 것 (지명권은 2장까지, 규약)
      const top = cands.slice(0, 15);
      const pairs: { items: Item[]; v: number }[] = [];
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push({ items: [top[i], top[j]], v: top[i].v + top[j].v });
      pairs.sort((a, b) => b.v - a.v);
      for (const x of pairs) {
        if (best && x.v <= best.value) break;
        if (ok(x.items)) { best = { items: x.items, value: x.v }; break; }
      }
      if (best) {
        out.push({
          team: t.idx, value: best.value,
          get: best.items.flatMap((x) => (x.p ? [x.p] : [])), picks: best.items.flatMap((x) => (x.k ? [x.k] : [])),
        });
      }
    }
    return out.sort((a, b) => b.value - a.value);
  }

  /** AI 구단에게 "이 선수를 주려면 무엇을 원하나"를 묻는다. 수락할 만한 조합이 없으면 null */
  askPackage(aiTeam: number, want: SimPlayer[]): SimPlayer[] | null {
    return this.askPackageWhy(aiTeam, want).pkg;
  }

  /** askPackage와 같고, 조합이 없으면 이유(평가의 세 구분)를 함께 돌려준다 */
  askPackageWhy(aiTeam: number, want: SimPlayer[]): PackageResult {
    const invalid = (message: string): PackageResult => ({ pkg: null, verdict: 'reject-invalid', message });
    if (!this.tradeOpen) return invalid('지금은 트레이드를 할 수 없습니다.');
    if (want.length === 0) return invalid('받을 선수를 고르세요.');
    if (want.some((p) => p.foreign)) return invalid('외국인 선수는 트레이드할 수 없습니다.');
    if (want.some((p) => p.teamIdx !== aiTeam)) return invalid('상대 구단 소속이 아닌 선수가 있습니다.');
    const mine = horizonWeights(this.tendency(this.teamIdx), this.situation(this.teamIdx).remaining);
    return suggestPackageWhy(want, aiTeam, this.world.teams[aiTeam].org, this.team.org, this.situation(aiTeam), this.values, mine);
  }

  private applyTrade(aiTeam: number, give: number[], get: number[], cash = 0, picks: PickSwap = NO_PICKS): void {
    for (const p of picks.give) transferPick(this.league, p, aiTeam);
    for (const p of picks.get) transferPick(this.league, p, this.teamIdx);
    if (cash) {
      const [from, to, amount] = cash > 0 ? [this.teamIdx, aiTeam, cash] : [aiTeam, this.teamIdx, -cash];
      this.league.ledger.push({ year: this.year, from, to, amount, note: `트레이드 현금 (${this.world.teams[aiTeam].name})`, kind: 'trade' });
    }
    for (const i of give) this.fanStarLeaves(this.teamIdx, this.world.players[i]);
    for (const i of get) this.fanStarLeaves(aiTeam, this.world.players[i]);
    for (const i of give) this.season.transfer(i, aiTeam);
    for (const i of get) this.season.transfer(i, this.teamIdx);
    this.trades.push({ day: this.day, team: aiTeam, give: [...give], get: [...get],
      ...(picks.give.length ? { pg: picks.give.map(pickId) } : {}), ...(picks.get.length ? { pr: picks.get.map(pickId) } : {}) });
  }

  /** 프랜차이즈 스타를 트레이드로 내보내면 팬 만족도가 떨어진다 (stadium.ts). 소속이 바뀌기 전에 부른다 */
  private fanStarLeaves(team: number, sp: SimPlayer): void {
    const lp = this.league.players.find((p) => p.id === sp.id);
    if (!lp || !starLeaves(this.league, team, this.year, this.day, lp, currentRuns(sp, this.values), 'trade')) return;
    if (team === this.teamIdx) this.addNews(this.day, 'owner', `팬들이 실망했습니다: 프랜차이즈 스타 ${sp.name} 트레이드 (팬 만족도 ${FAN_LOSS.trade})`);
  }

  // ---- 오프시즌

  /** 시즌이 끝났으면 결산하고 오프시즌을 연다 */
  beginOffseason(): void {
    if (this.phase !== 'season' || !this.done) throw new Error('정규시즌이 끝나야 오프시즌을 열 수 있습니다');
    const { chosen, apply } = this.enlistOptions();
    this.dispatchOff({ year: this.year, type: 'begin-off', enlist: chosen, apply });
  }

  // ---- 입대 선택 (시즌이 끝난 뒤, 결산 때 입대)

  /**
   * 우리 구단 입대 후보와 추천·지금 고른 명단. 기여는 지금 능력 기준 (결산의 성장 판정 전).
   * 시즌 중 트레이드로 바뀐 소속은 월드에서 읽는다 (리그 상태는 결산 때 반영된다).
   */
  enlistOptions(): { cands: EnlistCandidate[]; recommended: string[]; chosen: string[]; apply: string[] } {
    const L = this.league;
    const teamOf = new Map(this.world.players.map((p) => [p.id, p.teamIdx]));
    const now = { ...L, players: L.players.map((p) => (teamOf.has(p.id) ? { ...p, team: teamOf.get(p.id)! } : p)) };
    const ctx = this.values;
    const cands = enlistCandidates(now, this.teamIdx, this.year, (p) => runsNow(p, ctx, this.year));
    const recommended = aiEnlistPicks(L, this.year, cands);
    const chosen = this.enlistChoice ? normalizeEnlist(cands, this.enlistChoice) : recommended;
    return { cands, recommended, chosen, apply: normalizeApply(cands, chosen, this.applyChoice) };
  }

  /** 입대 명단을 고른다 (null = 추천대로). 강제 입대는 늘 포함된다 */
  setEnlist(ids: string[] | null): string[] {
    if (this.phase !== 'season' || !this.done) throw new Error('입대 선택은 정규시즌이 끝난 뒤 결산 전에 합니다');
    this.enlistChoice = ids === null ? null : normalizeEnlist(this.enlistOptions().cands, ids);
    return this.enlistOptions().chosen;
  }

  /**
   * 입대 명단 중 군 야구단(상무·경찰)에 지원할 선수를 고른다 (null = 지원할 수 있는 선수 모두). 떨어지면 현역으로 입대한다.
   * 입대 명단에서 빠진 선수는 지원 명단에서도 빠진다
   */
  setApply(ids: string[] | null): string[] {
    if (this.phase !== 'season' || !this.done) throw new Error('입대 선택은 정규시즌이 끝난 뒤 결산 전에 합니다');
    const { cands, chosen } = this.enlistOptions();
    this.applyChoice = ids === null ? null : normalizeApply(cands, chosen, ids);
    return this.enlistOptions().apply;
  }

  /** 오프시즌 조작을 적용하고 기록한다. 결과 메시지가 있으면 돌려준다 */
  private dispatchOff(a: OffAction): Off.OfferCheck {
    const L = this.league;
    const off = this.offseason;
    let res: Off.OfferCheck = { ok: true, message: '' };
    const logBefore = off?.log.length ?? 0;
    switch (a.type) {
      case 'begin-off': {
        const standings = this.season.standings();
        if (!this.postseason) this.openPostseason();
        const rest = this.postseason!.series.reduce((n, x) => n + x.games.length, 0);
        this.advancePostseason(10_000); // 남은 경기를 치른다 (경기마다 알림)
        const ps = resultOf(this.postseason!);
        if (this.postseason!.series.reduce((n, x) => n + x.games.length, 0) > rest) this.addNews(this.day, 'season', '남은 가을야구 경기를 끝까지 치렀습니다.');
        // 발표일을 모르거나 정규시즌 뒤 발표된 공인구 검사 (ruleNews.ts)
        for (const t of this.ruleNewsFor().closing) this.addNews(this.day, 'season', t);
        // 재정 결산: 선수 소속이 결산으로 바뀌기 전에 (트레이드는 기록으로 따라간다)
        const fin = settleSeason({
          league: L, world: this.world, season: this.season, trades: this.tradeMoves(),
          postseason: this.postseason!.series.flatMap((x) => x.games), standings, champion: ps.champion ?? null,
          postseasonDepth: (t) => (ps.seeds.includes(t) ? 1 + ps.series.filter((x) => x.winner === t).length : 0),
          trust: (t) => (t === this.teamIdx ? this.owner.trust : 50),
        });
        this.finishedLeague = clone(L);
        const prevStandings = L.lastSeason?.standings ?? null;
        settleMarketContracts(L, this.year);
        this.offseason = Off.beginOffseason(L, this.world, this.season, this.store, this.teamIdx, this.params, a.enlist, a.apply);
        this.enlistChoice = null;
        this.applyChoice = null;
        L.lastSeason!.postseason = ps;
        // 가을야구 개인 기록: 선수의 이번 시즌 줄에 붙인다 (postseason.ts, 2026-10-12)
        {
          const lines = postseasonLines(this.postseason!.series.flatMap((x) => x.games));
          const byId = new Map(L.players.map((p) => [p.id, p]));
          for (const l of lines.values()) {
            const sp = this.world.players[l.idx];
            const hist = sp ? byId.get(sp.id)?.history : undefined;
            const h = hist?.[hist.length - 1]?.year === this.year ? hist[hist.length - 1] : undefined;
            if (!h) continue;
            if (l.bat && !sp.isPitcher) h.pbat = PS_BAT_KEYS.map((k) => l.bat![k]);
            if (l.pit) h.ppit = PS_PIT_KEYS.map((k) => l.pit![k]);
          }
        }
        this.evaluateOwner(standings, ps, prevStandings, fin[this.teamIdx]);
        // 연표 (history.ts)
        recordYear(L, this.year, this.world.teams, this.season.teams, standings, ps.champion ?? null, ps.runnerUp ?? null,
          ps.series.map((x) => ({ high: x.high, low: x.low, winner: x.winner, ks: x === ps.series[ps.series.length - 1] })));
        // 기사: 우승(연속 우승·왕조)·MVP (articles.ts)
        {
          const champ = ps.champion ?? null;
          if (champ !== null) {
            const t = this.world.teams[champ];
            const yb = yearbook(L, this.store);
            const streak = titleStreak(yb, this.year);
            const dyn = dynasties(yb).find((d) => d.franchise === t.franchise && d.to === this.year);
            addArticle(L, { year: this.year, day: -1, kind: 'title', franchise: t.franchise,
              title: `${t.name}, ${this.year} 한국시리즈 우승${streak >= 2 ? ` (${streak}년 연속)` : ''}`,
              body: `${josa(t.name, '이', '가')} 한국시리즈에서 ${josa(this.world.teams[ps.runnerUp].name, '을', '를')} 꺾고 ${this.year} 시즌 정상에 올랐다.`
                + (streak >= 2 ? ` ${streak}년 연속 우승이다.` : '')
                + (dyn ? ` ${dyn.from}년부터 ${dyn.titles.length}번째 우승으로 왕조를 ${dyn.titles.length === DYNASTY_TITLES ? '열었다' : '이어 가고 있다'}.` : '') });
          }
          const psMvps = ps.series.filter((x) => x.mvp).map((x) => ({ round: x.round, ...x.mvp! }));
          const awNow = L.awards?.find((a) => a.year === this.year);
          if (awNow && psMvps.length) awNow.postseasonMvps = psMvps;
          const ksMvp = ps.series.find((x) => x.round === 'ks')?.mvp;
          if (ksMvp) {
            const t = this.world.teams[ksMvp.team];
            addArticle(L, { year: this.year, day: -1, kind: 'award', franchise: t?.franchise, title: `${this.year} 한국시리즈 MVP ${ksMvp.name}`, body: `${t?.name ?? ''} ${ksMvp.name}: 한국시리즈 ${ksMvp.line}.` });
          }
          const aw = L.awards?.find((a) => a.year === this.year);
          if (aw?.mvp) {
            const t = this.world.teams[aw.mvp.team];
            addArticle(L, { year: this.year, day: -1, kind: 'award', franchise: t?.franchise, title: `${this.year} MVP ${aw.mvp.name}`, body: `${t?.name ?? ''} ${aw.mvp.name}: ${aw.mvp.line}.` });
          }
        }
        recordSeasonBests(L, this.year, this.world.gamesPerTeam, this.world.players.map((p) => ({
          id: p.id, name: p.name, team: this.world.teams[lineTeam(p)]?.name ?? '',
          bat: this.season.bat[p.idx].pa > 0 ? Object.values(this.season.bat[p.idx]) : undefined,
          pit: this.season.pit[p.idx].bf > 0 ? Object.values(this.season.pit[p.idx]) : undefined,
        })));
        // 도전 모드 판정 (challenges.ts)
        const chWas = L.challenge?.result;
        const chs = judgeChallenge(L, this.year, {
          userTeam: this.teamIdx, champion: ps.champion ?? null, first: standings[0] ?? null, postseason: ps.seeds, rescue: fin[L.challenge?.team ?? this.teamIdx]?.rescue ?? 0,
          ...(L.challenge?.homegrown ? { mark: this.challengeMark(L.challenge.team, standings, ps) } : {}),
        });
        const chDef = chs ? challengeById(chs.id) : undefined;
        if (chs && chDef && !chWas && chs.result) {
          const text = chs.result === 'success'
            ? `도전 「${chDef.title}」 ${chs.complete ? '완전 클리어' : '성공'}! (${chs.from}~${this.year}, ${challengeProgress(chs, this.year)})`
            : `도전 「${chDef.title}」 실패: ${chs.why ?? ''}. 이 게임은 그대로 이어서 할 수 있습니다.`;
          this.news.push({ year: this.year, day: -1, kind: 'owner', text });
          addArticle(L, { year: this.year, day: -1, kind: 'scenario', franchise: L.teams[chs.team]?.franchise, title: `도전 「${chDef.title}」 ${chs.result === 'success' ? '성공' : '실패'}`, body: text });
        } else if (chs && chDef && !chs.result) {
          this.news.push({ year: this.year, day: -1, kind: 'owner', text: `도전 「${chDef.title}」 진행: ${challengeProgress(chs, this.year + 1)}.` });
        }
        this.phase = 'offseason';
        this.valueCtx = null;
        this.offVersion++;
        this.offNews(0);
        this.actions.push(clone(a));
        this.awardNews();
        this.addOffNews(`${this.year} 오프시즌 시작. FA 신청 ${this.offseason.fa.entries.length}명.`);
        this.watchCheck(-1);
        return res;
      }
      case 'open': {
        if (!off || off.stage !== 'ready') return { ok: false, message: '오프시즌 단계를 모두 마쳐야 개막할 수 있습니다.' };
        const changes = off.changes ?? [];
        const undrafted = new Set(off.draft?.pool ?? []);
        Off.closeOffseason(L, off);
        this.watch = pruneUndrafted(this.watch, undrafted, L); // 지명 안 된 신인 후보는 관심 명단에서 뺀다 (결정 9)
        // 감독: 재계약·실제 개막 감독·교체 (managers.ts). 지난 시즌 순위로 판단한다
        const mgrNews = openManagers(L, this.store, this.teamIdx, L.lastSeason?.standings ?? [],
          this.store.meta.rules[String(L.year - 1)]?.postseasonTeams ?? 5);
        this.postseason = null;
        this.hallOfFameAndFarewells(L.year - 1);
        const sanctions = applyCapSanctions(L, L.year);
        const floorSanctions = applyFloorSanctions(L, L.year);
        this.offseason = null;
        this.finishedLeague = null;
        this.phase = 'season';
        this.refreshRivals();
        Off.openMarket(L, this.store, this.params); // 시즌 중 시장의 외국인 후보 (market.ts)
        if (L.fantasy?.free) Off.openReserves(L, this.store, this.params); // 자유 모드 빈 자리
        const pipelineNews = this.openPipeline(); // 자유 모드 입단 예약
        const twoWayNews = Off.openTwoWay(L, this.store, this.params, this.teamIdx); // 이도류 (league/twoway.ts)
        twoWayNews.unshift(...pipelineNews);
        // 스프링캠프 (league/camp.ts): 비용·개막 뒤 경기력·유망주 성장
        {
          const w = worldFromLeague(L, this.store, this.params, { form: false });
          const userPick = L.campPlan?.year === L.year ? L.campPlan.pick : null;
          const teams = L.teams.map((_, i) => i).filter((i) => !isFuturesTeam(L, i, L.year));
          twoWayNews.push(...runCamps(L, L.year, teams, this.teamIdx, userPick, (t) => cashOf(L, t), new Map(w.players.map((p) => [p.id, p])), valueContext(w)));
          delete L.campPlan;
        }
        twoWayNews.push(...openNaming(L, this.teamIdx)); // 구장 명명권 (league/naming.ts)
        // 예전 저장 정정: 리그 밖에서 데려온 선수가 잘못 입대했으면 돌려보내고, 외국 이름이면 외국인으로 (2026-10-13 사용자 보고)
        for (const p of L.players) {
          if (!p.outsider) continue;
          if (looksForeignName(p.name) && !p.foreign) {
            p.foreign = true;
            p.contract = { ...p.contract, kind: 'foreign', salary: Math.max(300_000, Math.round(p.contract.salary / WON_PER_USD)) };
            delete p.military;
          }
          if (p.military?.state === 'serving' || p.military?.state === 'homeOnly' || (p.foreign && p.startAbsentReason === 'military')) {
            if (p.military) p.military = { state: 'done', basis: 'estimate', note: '자유 모드 영입 (병역 해당 없음)' };
            if (p.startAbsentReason === 'military') { delete p.startAbsent; delete p.startAbsentReason; }
            twoWayNews.push(`${p.name} 병역 정정 (리그 밖에서 데려온 선수라 해당 없음)`);
          } else if (p.military?.state === 'pending' && p.birthYear && L.year - p.birthYear >= 28) p.military = { state: 'done', basis: 'estimate', note: '자유 모드' };
        }
        // 판타지 큰 변화: 입단 예정 유망주 (src/fantasy/effects.ts 'prospect')
        if (L.fantasy?.prospects?.length) {
          for (const sp of L.fantasy.prospects) {
            const p = Off.addFantasyProspect(L, this.store, this.params, this.teamIdx, sp);
            this.addNews(0, 'season', `${L.year} 시즌: 유망주 ${p.name} 입단 (판타지).`);
          }
          L.fantasy.prospects = [];
        }
        this.world = worldFromLeague(clone(L), this.store, this.params);
        this.season = Season.start(this.world, this.params, seasonSeed(L), { boxTeams: [this.teamIdx], hiddenSeed: L.seed });
        this.applyTactics();
        this.trades = [];
        this.lastCallUps = new Set();
        this.valueCtx = null;
        this.startEntry();
        for (const c of changes) this.addNews(0, 'season', `${L.year} 시즌: ${changeText(c)}.`);
        for (const t of mgrNews) this.addNews(0, 'season', `${L.year} 시즌: ${t}.`);
        for (const t of twoWayNews) this.addNews(0, 'season', `${L.year} 시즌: ${t}.`);
        // 창단 구단: 1군 진입 2년 전 창단해 1년 동안 퓨처스리그를 뛴다 (2026-10-11)
        for (const e of L.expansions ?? []) {
          const name = L.teams[e.team].name;
          if (e.firstYear === L.year) this.addNews(0, 'season', `${L.year} 시즌: ${name} 1군 진입.`);
          else if (e.firstYear === L.year + 1) this.addNews(0, 'season', `${L.year} 시즌: ${name} 창단, 올해는 퓨처스리그에서 뛰고 ${e.firstYear}년 1군에 들어옵니다.`);
        }
        this.actions.push(clone(a));
        this.addNews(0, 'season', `${this.year} 시즌을 시작합니다. 개막일은 ${formatDate(this.year, 0)}입니다.`);
        this.addNews(0, 'season', this.ruleNewsFor().headline);
        for (const p of this.team.org) {
          const until = this.season.states.absentUntil[p.idx];
          if (until > 0) this.addNews(0, 'absence', `${p.name}: ${this.absenceReason(p)}. 복귀 예정 ${formatDate(this.year, until)}.`);
        }
        const serving = this.servingPlayers();
        if (serving.length) this.addNews(0, 'season', `군 복무 중: ${serving.map((p) => `${p.name}(${p.military?.returnYear}년 복귀)`).join(', ')}`);
        for (const x of sanctions) {
          const mine = x.team === this.teamIdx;
          if (!mine && !x.pickDrop) continue;
          this.addNews(0, 'owner', `${this.league.teams[x.team].name}: 샐러리캡 ${x.strike}회 연속 초과 (초과 ${(x.over / 10000).toFixed(1)}억 원). 제재금 ${(x.fine / 10000).toFixed(1)}억 원${x.pickDrop ? ', 이번 시즌 뒤 드래프트 1라운드 지명권 9단계 하락' : ''}.`);
        }
        // 샐러리캡 하한 (2027~): 미달하면 유소년 발전기금 (owner.ts applyFloorSanctions)
        for (const x of floorSanctions) {
          if (x.team !== this.teamIdx) continue;
          this.addNews(0, 'owner', `샐러리캡 하한 ${x.strike}회 연속 미달: 캡 대상 연봉 ${(x.pay / 10000).toFixed(1)}억 원으로 하한 ${(x.floor / 10000).toFixed(1)}억 원보다 ${((x.floor - x.pay) / 10000).toFixed(1)}억 원 적습니다. 유소년 발전기금 ${(x.fine / 10000).toFixed(1)}억 원.`);
        }
        this.setSeasonGoal();
        this.watchCheck(0);
        return res;
      }
    }
    if (!off || this.phase !== 'offseason') return { ok: false, message: '지금은 오프시즌이 아닙니다.' };
    switch (a.type) {
      case 'fa-offer': res = Off.offerFa(L, off, a.id, a.salary, a.years); break;
      case 'fa-withdraw': Off.withdrawFa(off, a.id); break;
      case 'foreign-keep': res = Off.setForeignKeep(L, off, a.id, a.keep); break;
      case 'foreign-sign': res = Off.signForeignByUser(L, off, a.id); break;
      case 'draft': res = Off.draftByUser(L, off, a.id); break;
      case 'draft-auto': Off.autoDraftRest(L, off); break;
      case 'salary-offer': res = Off.setSalaryOffer(off, a.id, a.amount, minSalary(off.year + 1, this.league)); break;
      case 'comp-protect': res = Off.setProtectByUser(L, off, a.fa, a.ids); break;
      case 'comp-pick': res = Off.pickCompByUser(L, off, a.fa, a.pick); break;
      case 'comp-auto': Off.autoCompUser(L, off, this.store, this.params); break;
      case 'pd-protect': res = Off.setDraftProtectByUser(L, off, a.kind, a.ids); break;
      case 'pd-wish': res = Off.setDraftWishByUser(L, off, a.kind, a.ids); break;
      case 'invest': res = setInvest(L, this.teamIdx, a.kind, a.level); break;
      case 'stadium': res = orderStadium(L, this.teamIdx, this.year, a.id, this.cashNow(), { ...(a.size ? { size: a.size } : {}), ...(a.dome ? { dome: true } : {}), ...(a.deal ? { deal: a.deal } : {}) }); break;
      case 'naming': res = signNaming(L, this.teamIdx, this.year, a.id); break;
      case 'camp':
        if (!isCampPick(a.pick)) { res = { ok: false, message: '없는 캠프입니다.' }; break; }
        L.campPlan = { year: this.year + 1, pick: { place: a.pick.place, focus: a.pick.focus } };
        res = { ok: true, message: '스프링캠프를 정했습니다. 개막 때 비용을 내고 효과가 납니다.' };
        break;
      case 'mgr-fire': res = fireManager(L, this.teamIdx, this.year); break;
      case 'mgr-hire': res = hireManager(L, this.store, this.teamIdx, this.year, a.name); break;
      case 'mgr-replace': res = replaceManager(L, this.store, this.teamIdx, this.year, a.name); break;
      case 'legend': res = this.applyLegend(a.id); break;
      case 'to-dev': res = Off.toDevByUser(L, off!, a.id); break;
      case 'sign-dev': res = Off.signDevByUser(L, off!, a.id); break;
      case 'promote-dev': res = Off.promoteDevByUser(L, off!, a.id); break;
      case 'hire-coach': res = this.applyHireCoach(a.id); break;
      case 'posting': res = Off.answerPosting(L, off!, a.id, a.accept); break;
      case 'extend': res = Off.extendByUser(L, off!, this.store, this.params, a.id, a.years); break;
      case 'franchise-tag': res = Off.setFranchiseTagByUser(L, off!, a.id); break;
      case 'settings-off': this.applySettings(a.s); res = { ok: true, message: '난이도를 바꿨습니다.' }; break;
      case 'def-edit-off': this.applyDefenseEdit(a.id, a.def); res = { ok: true, message: '수비 능력치를 고쳤습니다.' }; break;
      case 'two-way-off': this.applyTwoWay(a.id, a.on); res = { ok: true, message: a.on ? '이도류로 씁니다.' : '본업만 맡깁니다.' }; break;
      case 'ai-off': this.applyFantasy(a.entry); break;
      case 'ai-choice-off': this.applyFantasyChoice(a.id, a.choice); break;
      case 'release': res = Off.releaseByUser(L, off, a.id); break;
      case 'release-auto': Off.autoReleaseUser(L, off, this.store, this.params); break;
      case 'claim': res = Off.claimByUser(L, off, a.id); break;
      case 'rule-vote':
        // 해고된 채 맞은 단장 회의는 표를 막는다. 예전에 해고 중 낸 표가 기록에 있으면 재현 때 여기서 버려져 AI 표로 개표된다
        res = Off.voteLockedByFiring(L, off) ? { ok: false, message: Off.VOTE_LOCKED_TEXT } : Off.castVote(off!, a.choice, a.agenda);
        break;
      case 'accept-offer': {
        const o = L.owner;
        if (!o?.offers?.includes(a.team)) return { ok: false, message: '받은 영입 제의가 아닙니다.' };
        const from = this.teamIdx;
        this.teamIdx = a.team;
        off.userTeam = a.team;
        off.fa.userOffers = {};
        o.team = a.team;
        o.trust = START_TRUST;
        o.offers = null;
        this.valueCtx = null;
        this.addOffNews(`${L.teams[from].name}을(를) 떠나 ${L.teams[a.team].name} 단장으로 부임했습니다.`);
        this.news.push({ year: this.year, day: -1, kind: 'owner', text: `${L.teams[a.team].name} 단장 부임. 구단주 신뢰도 ${START_TRUST}에서 다시 시작합니다.` });
        break;
      }
      case 'next': {
        if (L.owner?.offers) return { ok: false, message: '해고되었습니다. 영입 제의 중 하나를 받아들여야 오프시즌을 이어갈 수 있습니다.' };
        const why = Off.blockedReason(L, off);
        if (why) return { ok: false, message: why };
        Off.advanceStage(L, off, this.store, this.params);
        break;
      }
    }
    if (res.ok) this.actions.push(clone(a));
    this.offVersion++;
    this.offNews(logBefore);
    this.watchCheck(-1);
    return res;
  }

  // ---- 구단주 평가 (M7)

  get owner(): OwnerState {
    this.ensureOwner();
    return this.league.owner!;
  }

  /** 구단주 상태가 없는 저장(M6 이전)은 지금 구단·신뢰도 50으로 시작한다 */
  ensureOwner(): void {
    if (this.league.owner) return;
    this.league.owner = newOwner(this.teamIdx);
    this.league.difficulty ??= 'normal';
    if (this.phase === 'season' && !this.done) this.setSeasonGoal();
  }

  /** 개막 때 전력 예상 순위로 이번 시즌 목표를 정한다 */
  private setSeasonGoal(): void {
    const o = this.league.owner!;
    const str = this.world.teams.map((t) => teamStrength(t.org, this.values, 0));
    const rank = 1 + str.filter((v, i) => v > str[this.teamIdx] || (v === str[this.teamIdx] && i < this.teamIdx)).length;
    const kind = goalFor(rank, this.world.rules.postseasonTeams);
    o.goal = { year: this.year, kind, projectedRank: rank };
    this.news.push({ year: this.year, day: 0, kind: 'owner', text: `구단주가 정한 ${this.year} 시즌 목표: ${GOAL_LABEL[kind]} (전력 예상 ${rank}위). 신뢰도 ${o.trust}.` });
  }

  /** 시즌 평가: 목표 달성, 신뢰도, 업적. 신뢰도가 바닥나면 해고되고 하위권 구단의 영입 제의를 받는다 */
  private evaluateOwner(standings: number[], ps: PostseasonResult, prevStandings: number[] | null, fin?: FinanceYear): void {
    const o = this.owner;
    const L = this.league;
    const team = this.teamIdx;
    const goal = o.goal?.year === this.year ? o.goal : { year: this.year, kind: goalFor(5, this.world.rules.postseasonTeams), projectedRank: 5 };
    const capOver = (L.capStrikes?.[team] ?? 0) > 0;
    const outcome = outcomeOf(team, standings, ps, this.world.rules.postseasonTeams, capOver);
    const td = trustDelta(goal.kind, outcome);
    const achieved = td.achieved;
    const delta = td.delta < 0 ? Math.round(td.delta * settingsOf(this.league).ownerPressure) : td.delta;
    const before = o.trust;
    o.trust = Math.max(0, Math.min(100, before + delta));
    o.history.push({
      year: this.year, team, goal: goal.kind, projectedRank: goal.projectedRank, rank: outcome.rank, result: outcomeLabel(outcome),
      // 구단 이름은 막 끝난 시즌의 월드에서 (결산 때 승계·명칭 변경이 먼저 적용돼 리그 상태는 이미 새 이름이다)
      achieved, trustBefore: before, trustAfter: o.trust, champion: outcome.champion, capOver, teamName: this.world.teams[team].name,
    });
    const say = (text: string) => this.news.push({ year: this.year, day: -1, kind: 'owner', text });
    say(`구단주 평가: 목표 ${GOAL_LABEL[goal.kind]} ${achieved ? '달성' : '미달'} (${outcomeLabel(outcome)}${capOver ? ', 샐러리캡 초과' : ''}). 신뢰도 ${before} → ${o.trust}.`);
    // 재정: 적자를 모기업이 메우면 신뢰도가 떨어지고, 흑자면 조금 오른다 (finance.ts)
    if (fin) {
      const fd = trustFromFinance(fin);
      const b2 = o.trust;
      o.trust = Math.max(0, Math.min(100, o.trust + fd));
      o.history[o.history.length - 1].trustAfter = o.trust;
      const money = (v: number) => `${(v / 10000).toFixed(1)}억 원`;
      say(fin.rescue > 0
        ? `재정 결산: 적자 ${money(-fin.net)}, 모기업이 ${money(fin.rescue)}을 메웠습니다. 신뢰도 ${b2} → ${o.trust}.`
        : `재정 결산: ${fin.net >= 0 ? '흑자' : '적자'} ${money(Math.abs(fin.net))}, 자금 ${money(fin.cash)}.${fd ? ` 신뢰도 ${b2} → ${o.trust}.` : ''}`);
    }
    const prevLast = !!prevStandings && prevStandings[prevStandings.length - 1] === team;
    const got = newAchievements(o, prevLast);
    for (const id of got) {
      o.achievements.push({ id, year: this.year, team });
      say(`업적 달성: ${ACHIEVEMENTS[id].label} (${ACHIEVEMENTS[id].note})`);
    }
    const fired = o.trust < FIRE_BELOW;
    // 단장 평판 (league/reputation.ts)
    const rec = this.season.teams[team];
    const rep = updateReputation(L, {
      year: this.year, winPct: rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : 0.5,
      postseason: ps.seeds.includes(team), seriesWon: ps.series.filter((x) => x.winner === team).length, champion: outcome.champion,
      goalMet: achieved, capOver, rescued: !!fin && fin.rescue > 0, achievements: got.length, fired,
    });
    say(`단장 평판 ${rep.before} → ${rep.after} (${rep.parts.join(', ')}).`);
    if (fired) {
      o.firedYears.push(this.year);
      o.offers = offersByRep(standings, team, repOf(L));
      say(`해고되었습니다. 신뢰도 ${o.trust}. 영입 제의: ${o.offers.map((t) => L.teams[t].name).join(', ')}. 구단 화면에서 고르세요.`);
    }
  }

  // ---- AI 구단끼리 트레이드 (gm.ts)

  /**
   * 트레이드 마감 전 AI_TRADE_EVERY일마다: 우승 도전 AI 구단이 리빌딩 AI 구단의 28세 이상 주축을 원하고,
   * 25세 이하 선수 한 명(모자라면 다음 드래프트 2라운드 지명권을 얹어)을 내준다. 양쪽 AI 평가가 모두 수락일 때만.
   * 난수는 리그 시드·날짜에서 가르므로 재현·불러오기와 같다
   */
  private aiTradeDay(): void {
    const day = this.season.day - 1;
    const year = this.world.year;
    if (day <= 0 || day % AI_TRADE_EVERY !== 0 || day > this.tradeDeadlineDay) return;
    const rng = new Rng(`${this.league.seed}/ai-trade/${year}/${day}`);
    if (!rng.chance(AI_TRADE_CHANCE)) return;
    const ai = this.world.teams.filter((t) => t.idx !== this.teamIdx);
    const sit = new Map(ai.map((t) => [t.idx, this.situation(t.idx)]));
    const buyers = ai.filter((t) => tendencyOf(sit.get(t.idx)!) === 'contend');
    const sellers = ai.filter((t) => tendencyOf(sit.get(t.idx)!) === 'rebuild');
    if (!buyers.length || !sellers.length) return;
    const A = buyers[rng.int(buyers.length)];
    const B = sellers[rng.int(sellers.length)];
    const ctx = this.values;
    const ok = (p: SimPlayer) => !p.foreign && !p.dev && this.leaguePlayer(p.id)?.noTradeYear !== year;
    const now = (p: SimPlayer) => playerValue(p, ctx, [1]);
    const future = (p: SimPlayer) => playerValue(p, ctx, horizonWeights('rebuild', 1));
    // 파는 쪽의 얼굴(현재 가치 상위 2명)과 34세 이상 베테랑·레전드는 AI끼리 거래하지 않는다 (실제로 거의 없는 일)
    const core = new Set([...B.org].sort((a, b) => now(b) - now(a) || a.idx - b.idx).slice(0, 2).map((p) => p.idx));
    const targets = B.org.filter((p) => ok(p) && !core.has(p.idx) && (p.age ?? 28) >= 28 && (p.age ?? 28) <= 33)
      .sort((a, b) => now(b) - now(a) || a.idx - b.idx).slice(0, 5);
    const youngA = A.org.filter((p) => ok(p) && (p.age ?? 28) <= 25).sort((a, b) => future(a) - future(b) || a.idx - b.idx);
    const pick = this.pickTradeOpen ? this.ownedPicks(A.idx).find((p) => p.draft === year + 1 && p.round === 2) : undefined;
    const sA = sit.get(A.idx)!;
    const sB = sit.get(B.idx)!;
    for (const x of targets) {
      for (const withPick of pick ? [false, true] : [false]) {
        const pv = withPick && pick ? { b: this.pickValueFor(pick, tendencyOf(sB)), a: this.pickValueFor(pick, tendencyOf(sA)) } : null;
        for (const y of youngA) {
          const evB = evaluateTrade({ aiTeam: B.idx, receive: [y], give: [x], ...(pv ? { picks: { receive: pv.b, give: 0 } } : {}) }, B.org, sB, ctx);
          if (evB.verdict !== 'accept') continue;
          const evA = evaluateTrade({ aiTeam: A.idx, receive: [x], give: [y], ...(pv ? { picks: { receive: 0, give: pv.a } } : {}) }, A.org, sA, ctx);
          if (evA.verdict !== 'accept') continue;
          this.fanStarLeaves(B.idx, x);
          this.fanStarLeaves(A.idx, y);
          this.season.transfer(x.idx, A.idx);
          this.season.transfer(y.idx, B.idx);
          if (pv && pick) transferPick(this.league, pick, B.idx);
          (this.league.aiTrades ??= []).push({ year, day, buyer: A.idx, seller: B.idx, got: [x.id], gave: [y.id], ...(pv && pick ? { picks: [pickId(pick)] } : {}) });
          const pickText = pv && pick ? `, ${this.pickLabel(pick)}` : '';
          const body = `${josa(A.name, '이', '가')} ${josa(B.name, '으로부터', '로부터')} ${josa(x.name, '을', '를')} 받고 ${josa(y.name, '을', '를')} 내줬다${pickText ? ` (${pickText.slice(2)} 포함)` : ''}.`;
          this.addNews(day, 'trade', `[리그 트레이드] ${body}`);
          addArticle(this.league, { year, day, kind: 'trade', franchise: A.franchise, title: `${A.name}·${B.name} 트레이드`, body });
          return;
        }
      }
    }
  }

  // ---- 라이벌 (rivals.ts)

  /** 시즌 개막 때 라이벌 쌍을 다시 계산하고 우리 구단 라이벌을 알린다 */
  private refreshRivals(): void {
    const L = this.league;
    L.rivals = { year: L.year, pairs: computeRivals(yearbook(L, this.store), L.year) };
    const me = L.teams[this.teamIdx];
    const mine = rivalsOf(L, me.franchise);
    if (mine.length) {
      const names = mine.map((p) => L.teams.find((t) => t.franchise === (p.a === me.franchise ? p.b : p.a))?.name ?? '').filter(Boolean);
      if (names.length) this.addNews(0, 'season', `${L.year} 시즌 라이벌: ${names.join(', ')}. 라이벌전 홈 경기는 관중이 더 듭니다.`);
    }
  }

  // ---- 기사 (articles.ts)

  /** 기사 판정 기준값: 시즌 시작 통산, 지금까지 본 통산, 역대 시즌 최고, 연승·연패 */
  private articleBase(): ArticleState {
    const year = this.world.year;
    if (this.articleState?.year === year) return this.articleState;
    const all = careers(this.league, this.store);
    const base = new Map<string, Tot>();
    for (const p of this.world.players) {
      const c = all.get(p.id);
      base.set(p.id, c ? { h: c.bat.h, hr: c.bat.hr, w: c.pit.w, sv: c.pit.sv, so: c.pit.so } : { h: 0, hr: 0, w: 0, sv: 0, so: 0 });
    }
    const records: Record<string, number> = {};
    for (const k of SEASON_KEYS) records[k] = seasonBests(this.league, this.store, k, 1)[0]?.value ?? 0;
    const s = this.season;
    const order = s.standings();
    const st: ArticleState = {
      year, base, prev: new Map(), records, broken: new Set(), streak: this.world.teams.map(() => 0), logIdx: 0,
      gameIdx: s.log.length, leader: s.teams[order[0]].g >= 20 ? order[0] : -1,
      psIn: order.indexOf(this.teamIdx) < this.world.rules.postseasonTeams, absSeen: s.absences.length,
      month: dateOf(year, s.day).month,
    };
    // 월간 MVP 기준점: 저장에 남아 있으면 그것, 없으면(새 시즌·예전 저장) 지금
    if (this.league.storyMonth?.year !== year) this.league.storyMonth = { year, month: st.month, lines: this.lineSnapshot() };
    // 지금까지(불러오기·재현) 이미 지난 일은 기사를 다시 내지 않는다
    for (const p of this.world.players) st.prev.set(p.id, this.totalNow(st, p.idx, p.id));
    for (const p of this.world.players) {
      const b0 = base.get(p.id)!;
      if (b0.hr === 0 && s.bat[p.idx].hr > 0) st.broken.add(`${p.id}/홈런`);
      if (b0.w === 0 && s.pit[p.idx].w > 0) st.broken.add(`${p.id}/승`);
      if (b0.sv === 0 && s.pit[p.idx].sv > 0) st.broken.add(`${p.id}/세이브`);
    }
    for (const k of SEASON_KEYS) if (this.world.players.some((p) => this.seasonValue(k, p.idx) > records[k])) st.broken.add(k);
    this.advanceStreaks(st, false);
    this.articleState = st;
    return st;
  }

  private totalNow(st: ArticleState, idx: number, id: string): Tot {
    const b = st.base.get(id) ?? { h: 0, hr: 0, w: 0, sv: 0, so: 0 };
    const bat = this.season.bat[idx];
    const pit = this.season.pit[idx];
    return { h: b.h + bat.h, hr: b.hr + bat.hr, w: b.w + pit.w, sv: b.sv + pit.sv, so: b.so + pit.so };
  }

  private seasonValue(k: string, idx: number): number {
    const bat = this.season.bat[idx];
    const pit = this.season.pit[idx];
    return k === 'hr' ? bat.hr : k === 'h' ? bat.h : k === 'rbi' ? bat.rbi : k === 'sb' ? bat.sb : k === 'w' ? pit.w : k === 'sv' ? pit.sv : pit.so;
  }

  /** 경기 기록에서 연승·연패를 따라가고, announce면 기준을 넘을 때 기사를 낸다 */
  private advanceStreaks(st: ArticleState, announce: boolean): void {
    const log = this.season.log;
    for (; st.logIdx < log.length; st.logIdx++) {
      const g = log[st.logIdx];
      const res: [number, number][] = g.homeRuns === g.awayRuns ? [[g.home, 0], [g.away, 0]] : g.homeRuns > g.awayRuns ? [[g.home, 1], [g.away, -1]] : [[g.home, -1], [g.away, 1]];
      for (const [t, r] of res) {
        const s0 = st.streak[t];
        st.streak[t] = r === 0 ? 0 : Math.sign(s0) === r ? s0 + r : r;
        const n = Math.abs(st.streak[t]);
        if (announce && r !== 0 && n >= STREAK_FROM && (n - STREAK_FROM) % 2 === 0) {
          const team = this.world.teams[t];
          addArticle(this.league, { year: this.year, day: g.day, kind: 'streak', franchise: team.franchise,
            title: `${team.name} ${n}${r > 0 ? '연승' : '연패'}`, body: `${josa(team.name, '이', '가')} ${formatDate(this.year, g.day)} 경기까지 ${josa(`${n}${r > 0 ? '연승' : '연패'}`, '을', '를')} 기록했다.` });
        }
      }
    }
  }

  /** 하루 경기 뒤 기사: 통산 마일스톤, 시즌 신기록, 연승·연패 */
  private dailyArticles(): void {
    const st = this.articleBase();
    const day = this.season.day - 1;
    const date = formatDate(this.year, day);
    for (const p of this.world.players) {
      const now = this.totalNow(st, p.idx, p.id);
      const prev = st.prev.get(p.id) ?? now;
      const team = this.world.teams[lineTeam(p)];
      if (!team) continue; // 시즌 중 시장의 미계약 선수 (market.ts)
      for (const m of MILESTONES) {
        for (const t of crossed(prev[m.key], now[m.key], m.every, m.from)) {
          addArticle(this.league, { year: this.year, day, kind: 'milestone', franchise: team.franchise,
            title: `${p.name}, ${m.label} ${t.toLocaleString('ko-KR')}${m.unit}`, body: `${team.name} ${josa(p.name, '이', '가')} ${date} 경기에서 ${m.label} ${josa(`${t.toLocaleString('ko-KR')}${m.unit}`, '을', '를')} 기록했다.` });
        }
      }
      st.prev.set(p.id, now);
      for (const k of SEASON_KEYS) {
        if (st.broken.has(k)) continue;
        const v = this.seasonValue(k, p.idx);
        if (v > st.records[k] && st.records[k] > 0) {
          st.broken.add(k);
          addArticle(this.league, { year: this.year, day, kind: 'record', franchise: team.franchise,
            title: `${p.name}, 시즌 최다 ${SEASON_LABEL[k]} 신기록`, body: `${team.name} ${josa(p.name, '이', '가')} ${date} 경기에서 시즌 ${josa(`${v}${SEASON_LABEL[k]}`, '으로', '로')} 종전 시즌 최다(${st.records[k]})를 넘어섰다.` });
        }
      }
    }
    this.advanceStreaks(st, true);
    this.storyArticles(st, day);
  }

  /** 지금 시즌 기록 (월간 MVP 기준점, 기록이 있는 선수만) */
  private lineSnapshot(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const p of this.world.players) {
      const b = this.season.bat[p.idx];
      const q = this.season.pit[p.idx];
      if (b.pa === 0 && q.bf === 0) continue;
      out[p.id] = [b.pa, b.ab, b.h, b.d, b.t, b.hr, b.bb, b.hbp, b.sf, b.rbi, q.outs, q.er, q.w, q.so, q.sv];
    }
    return out;
  }

  /**
   * 잡다한 기사 (2026-10-12 사용자 요청: 기사·인터뷰로 현실감). 그날 경기 뒤에 부른다.
   * 실존 선수·감독은 기록 사실만 쓰고, 인터뷰는 이름 없는 관계자·팬과 플레이어인 단장의 말만 (voices.ts)
   */
  private storyArticles(st: ArticleState, day: number): void {
    const L = this.league;
    const s = this.season;
    const year = this.year;
    const me = this.teamIdx;
    const W = this.world;
    const P = W.players;
    const rng = new Rng(`${L.seed}/story/${year}/${day}`);
    const date = formatDate(year, day);
    const tname = (t: number) => W.teams[t].name;
    const fr = (t: number) => W.teams[t].franchise;
    const put = (kind: ArticleKind, team: number | undefined, title: string, body: string) =>
      addArticle(L, { year, day, kind, title, body, ...(team !== undefined ? { franchise: fr(team) } : {}) });

    // 경기: 우리 경기의 완봉승·두 자릿수 득점·연장·대패, 다른 구단 화제 경기 하나
    let leagueDone = false;
    for (; st.gameIdx < s.log.length; st.gameIdx++) {
      const g = s.log[st.gameIdx];
      const mine = g.home === me || g.away === me;
      const us = g.home === me ? g.homeRuns : g.awayRuns;
      const them = g.home === me ? g.awayRuns : g.homeRuns;
      if (mine) {
        const opp = g.home === me ? g.away : g.home;
        const wp = g.win !== null ? P[g.win] : null;
        const score = `${us}:${them}`;
        if (us > them && them === 0) {
          const pl = wp ? ` 승리 투수는 ${wp.name}.` : '';
          put('game', me, `${tname(me)}, ${tname(opp)} 상대 ${score} 완봉승`, `${josa(tname(me), '이', '가')} ${date} ${josa(tname(opp), '을', '를')} ${josa(score, '으로', '로')} 꺾었다.${pl}${quoteLine('shutout', rng)}`);
        } else if (g.innings > 9 && us !== them) {
          const win = us > them;
          put('game', me, `연장 ${g.innings}회 혈투, ${tname(me)} ${win ? '승리' : '패배'}`, `${josa(tname(me), '과', '와')} ${josa(tname(opp), '이', '가')} ${date} 연장 ${g.innings}회까지 가는 접전을 벌였다. 최종 ${score}.${quoteLine(win ? 'extra-win' : 'extra-loss', rng)}`);
        } else if (us >= 10 && us > them) {
          put('game', me, `${tname(me)} 타선 폭발, ${tname(opp)}에 ${score}`, `${josa(tname(me), '이', '가')} ${date} ${tname(opp)}전에서 ${us}점을 몰아쳤다. 최종 ${score}.${quoteLine('win-big', rng)}`);
        } else if (them - us >= 8) {
          put('game', me, `${tname(me)}, ${tname(opp)}에 ${score} 대패`, `${josa(tname(me), '이', '가')} ${date} ${tname(opp)}전에서 ${them}점을 내줬다.${quoteLine('loss-big', rng)}`);
        }
      } else if (!leagueDone && rng.chance(LEAGUE_GAME_CHANCE)) {
        const hi = Math.max(g.homeRuns, g.awayRuns);
        const lo = Math.min(g.homeRuns, g.awayRuns);
        const winT = g.homeRuns > g.awayRuns ? g.home : g.away;
        const loseT = winT === g.home ? g.away : g.home;
        if (hi >= 15) { put('game', winT, `${tname(winT)}, ${tname(loseT)} 상대 ${hi}득점`, `${josa(tname(winT), '이', '가')} ${date} ${tname(loseT)}전에서 ${hi}:${lo} 대승을 거뒀다.`); leagueDone = true; }
        else if (g.innings >= 12) { put('game', undefined, `${tname(g.away)}·${tname(g.home)}, 연장 ${g.innings}회 승부`, `${date} ${josa(tname(g.away), '과', '와')} ${tname(g.home)}의 경기가 연장 ${g.innings}회까지 이어졌다. 최종 ${g.awayRuns}:${g.homeRuns}.`); leagueDone = true; }
        else if (hi === 1 && lo === 0) { const wp = g.win !== null ? P[g.win] : null; put('game', winT, `${tname(winT)}, 1:0 투수전 승리`, `${josa(tname(winT), '이', '가')} ${date} ${josa(tname(loseT), '을', '를')} 1:0으로 눌렀다.${wp ? ` 승리 투수는 ${wp.name}.` : ''}`); leagueDone = true; }
      }
    }

    // 데뷔 첫 기록: 통산 0이던 선수의 첫 홈런·첫 승·첫 세이브 (우리 선수는 모두, 다른 구단은 일부)
    for (const p of P) {
      if (p.teamIdx < 0) continue;
      const b0 = st.base.get(p.id);
      if (!b0) continue;
      const firsts: [number, number, string][] = [[b0.hr, s.bat[p.idx].hr, '홈런'], [b0.w, s.pit[p.idx].w, '승'], [b0.sv, s.pit[p.idx].sv, '세이브']];
      for (const [career0, now, label] of firsts) {
        if (career0 !== 0 || now !== 1) continue;
        const key = `${p.id}/${label}`;
        if (st.broken.has(key)) continue;
        st.broken.add(key);
        if (p.teamIdx !== me && !rng.chance(0.25)) continue;
        put('debut', p.teamIdx, `${p.name}, 프로 첫 ${label}`, `${tname(p.teamIdx)} ${josa(p.name, '이', '가')} ${date} 경기에서 1군 무대 첫 ${josa(label, '을', '를')} 기록했다.`);
      }
    }

    // 순위: 선두 교체, 우리 구단의 가을야구권 진입·이탈 (20경기부터)
    const order = s.standings();
    if (s.teams[order[0]].g >= 20) {
      const lead = order[0];
      if (st.leader >= 0 && lead !== st.leader) {
        put('rank', lead, `선두 교체: ${tname(lead)} 1위`, `${josa(tname(lead), '이', '가')} ${date} 경기 뒤 ${josa(tname(st.leader), '을', '를')} 끌어내리고 1위에 올랐다.${lead === me ? quoteLine('first', rng) : ''}`);
      }
      st.leader = lead;
      const cut = W.rules.postseasonTeams;
      const inNow = order.indexOf(me) < cut;
      if (inNow !== st.psIn) {
        const rank = order.indexOf(me) + 1;
        put('rank', me, inNow ? `${tname(me)}, 가을야구권 진입 (${rank}위)` : `${tname(me)}, 가을야구권 밖으로 (${rank}위)`,
          `${josa(tname(me), '이', '가')} ${date} 경기 뒤 ${rank}위가 됐다.${quoteLine(inNow ? 'ps-in' : 'ps-out', rng)}`);
        st.psIn = inNow;
      }
    }

    // 부상: 우리 선수 열흘 넘는 이탈은 모두, 다른 구단은 주전급(기여 30런 이상)만
    for (; st.absSeen < s.absences.length; st.absSeen++) {
      const a = s.absences[st.absSeen];
      if (a.kind === 'event' || a.until - a.day < 10) continue;
      const p = P[a.idx];
      if (!p || p.teamIdx < 0) continue;
      const mine = p.teamIdx === me;
      if (!mine && currentRuns(p, this.values) < 30) continue;
      const out = a.until >= s.schedule.length ? '시즌 아웃' : `${formatDate(year, a.until)}께 복귀 예정`;
      put('injury', p.teamIdx, `${tname(p.teamIdx)} ${p.name}, 부상으로 이탈`, `${tname(p.teamIdx)} ${josa(p.name, '이', '가')} 부상으로 1군에서 빠졌다. ${out}.${mine ? quoteLine('injury', rng) : ''}`);
    }

    // 월간 MVP: 그 달 마지막 경기일 다음 날 (달이 바뀌면)
    const nextMonth = dateOf(year, Math.min(day + 1, s.schedule.length - 1)).month;
    const done = day + 1 >= s.schedule.length;
    if (nextMonth !== st.month || done) {
      const snap = L.storyMonth?.lines ?? {};
      const d = (idx: number) => {
        const z = snap[P[idx].id] ?? [];
        const v = (i: number) => z[i] ?? 0;
        const b = s.bat[idx];
        const q = s.pit[idx];
        const bat: BatLine = { ...b, pa: b.pa - v(0), ab: b.ab - v(1), h: b.h - v(2), d: b.d - v(3), t: b.t - v(4), hr: b.hr - v(5), bb: b.bb - v(6), hbp: b.hbp - v(7), sf: b.sf - v(8), rbi: b.rbi - v(9) };
        const pit: PitLine = { ...q, outs: q.outs - v(10), er: q.er - v(11), w: q.w - v(12), so: q.so - v(13), sv: q.sv - v(14) };
        return { bat, pit };
      };
      const hitters = P.filter((p) => p.teamIdx >= 0 && !p.isPitcher).map((p) => ({ p, ...d(p.idx) })).filter((x) => x.bat.pa >= 60);
      const pitchers = P.filter((p) => p.teamIdx >= 0 && p.isPitcher).map((p) => ({ p, ...d(p.idx) })).filter((x) => x.pit.outs >= 60);
      const bh = hitters.sort((a, b) => ops(b.bat) - ops(a.bat) || a.p.idx - b.p.idx)[0];
      const bp = pitchers.sort((a, b) => era(a.pit) - era(b.pit) || b.pit.outs - a.pit.outs || a.p.idx - b.p.idx)[0];
      if (bh || bp) {
        const m = st.month;
        const parts: string[] = [];
        if (bh) parts.push(`타자 부문 ${tname(bh.p.teamIdx)} ${bh.p.name} (${bh.bat.pa}타석 타율 ${rate3(avg(bh.bat))}, ${bh.bat.hr}홈런, OPS ${rate3(ops(bh.bat))})`);
        if (bp) parts.push(`투수 부문 ${tname(bp.p.teamIdx)} ${bp.p.name} (${ipText(bp.pit.outs)}이닝 평균자책 ${fixed2(era(bp.pit))}, ${bp.pit.w}승 ${bp.pit.so}탈삼진)`);
        addArticle(L, { year, day, kind: 'monthly', title: `${m}월 MVP: ${[bh?.p.name, bp?.p.name].filter(Boolean).join('·')}`, body: `${m}월 기록으로 본 이달의 선수. ${parts.join(', ')}.`,
          ...(bh && bh.p.teamIdx === me ? { franchise: fr(me) } : bp && bp.p.teamIdx === me ? { franchise: fr(me) } : {}) });
      }
      st.month = nextMonth;
      L.storyMonth = { year, month: nextMonth, lines: this.lineSnapshot() };
    }

    // 단장 인터뷰: 3주마다 (일정 날짜로 정해 불러오기와 상관없이 같은 날), 순위·흐름에 따라
    if (day > 0 && day % GM_INTERVIEW_EVERY === 0 && s.teams[me].g >= 15) {
      const rank = order.indexOf(me) + 1;
      const n = order.length;
      const streak = st.streak[me];
      const sit = streak >= 4 ? 'gm-hot' : streak <= -4 ? 'gm-cold' : rank <= 2 ? 'gm-top' : rank >= n - 2 ? 'gm-low' : 'gm-mid';
      const t = s.teams[me];
      put('interview', me, `[인터뷰] ${tname(me)} 단장 "${voice(sit, rng).say.split('.')[0]}"`,
        `${josa(tname(me), '은', '는')} ${date} 현재 ${t.w}승 ${t.l}패${t.t ? ` ${t.t}무` : ''}로 ${rank}위다.${quoteLine(sit, rng, tname(me))}`);
    }
  }

  // ---- 역사: 명예의 전당, 구단 레전드, 은퇴식 (history.ts)

  private applyLegend(id: string): { ok: boolean; message: string } {
    const L = this.league;
    const fr = L.teams[this.teamIdx].franchise;
    if ((L.legends ?? []).some((l) => l.franchise === fr && l.id === id)) return { ok: false, message: '이미 구단 레전드입니다.' };
    const c = legendCandidates(careers(L, this.store), fr).find((x) => x.id === id);
    if (!c) return { ok: false, message: `은퇴했고 우리 구단에서 ${LEGEND_SEASONS}시즌 이상 뛴 선수만 레전드로 지정할 수 있습니다.` };
    (L.legends ??= []).push({ franchise: fr, id, name: c.name, year: this.year + 1 });
    this.addOffNews(`${c.name}, ${L.teams[this.teamIdx].name} 구단 레전드로 지정`);
    return { ok: true, message: `${c.name} 선수를 구단 레전드로 지정했습니다.` };
  }

  /** 새 시즌 개막 때: 막 은퇴한 선수의 명예의 전당 헌액과 프랜차이즈 선수 은퇴식 (lastYear: 막 끝난 시즌) */
  private hallOfFameAndFarewells(lastYear: number): void {
    const L = this.league;
    const all = careers(L, this.store);
    const leftNow = new Set((L.archive ?? []).filter((a) => a.lastYear === lastYear).map((a) => a.id));
    for (const h of hallOfFame(L, all).filter((x) => leftNow.has(x.c.id))) {
      this.addNews(0, 'season', `명예의 전당 헌액: ${h.c.name} (${h.reasons.join(', ')}).`);
      addArticle(L, { year: L.year, day: 0, kind: 'retire', franchise: undefined, title: `${h.c.name}, 명예의 전당 헌액`, body: `${h.c.firstYear}~${h.c.lastYear}년. 기준: ${h.reasons.join(', ')}.` });
    }
    // 은퇴식: 막 은퇴한 프랜차이즈 스타(farewellWorthy)가 있으면 그 구단 개막 사흘 동안 관중이 는다
    const ev = ensureEvents(L);
    for (const a of (L.archive ?? []).filter((x) => x.lastYear === lastYear && x.why === 'retired')) {
      const c = all.get(a.id);
      if (!c) continue;
      for (const [fr, n] of Object.entries(c.franchiseSeasons)) {
        if (!farewellWorthy(c, fr)) continue;
        const t = L.teams.findIndex((x) => x.franchise === fr);
        if (t < 0) continue;
        ev.buffs.push({ team: t, year: L.year, from: 0, until: FAREWELL_DAYS, fill: FAREWELL_FILL, note: `${c.name} 은퇴식` });
        this.addNews(0, 'season', `${L.teams[t].name}, ${c.name} 은퇴식 (${n}시즌). 개막 첫 홈 경기들에 팬이 몰릴 것으로 보입니다.`);
        addArticle(L, { year: L.year, day: 0, kind: 'retire', franchise: fr, title: `${L.teams[t].name} ${c.name} 은퇴식`, body: `${L.teams[t].name}에서 ${n}시즌을 뛴 ${josa(c.name, '이', '가')} 개막 홈 경기에서 은퇴식을 연다.` });
      }
    }
  }

  // ---- 재정 (finance.ts)

  /** 시즌 중 우리 구단 트레이드를 선수 id로 (재정의 월말 연봉 계산용) */
  tradeMoves(): TradeMove[] {
    const W = this.world.players;
    const mine = this.trades.map((t) => ({ day: t.day, from: this.teamIdx, to: t.team, give: t.give.map((i) => W[i].id), get: t.get.map((i) => W[i].id) }));
    // AI 구단끼리 트레이드도 연봉 귀속에 넣는다 (gm.ts)
    const ai = (this.league.aiTrades ?? []).filter((t) => t.year === this.world.year)
      .map((t) => ({ day: t.day, from: t.buyer, to: t.seller, give: [...t.gave], get: [...t.got] }));
    return [...mine, ...ai, ...financeMoves(this.league, this.world.year)].sort((a, b) => a.day - b.day);
  }

  /** 진행 중인 시즌의 수입·지출 (오프시즌이면 null) */
  seasonFinance(team = this.teamIdx): SeasonFlows | null {
    if (this.phase !== 'season') return null;
    return seasonFlows({
      league: this.league, world: this.world, season: this.season, trades: this.tradeMoves(),
      postseason: this.postseason?.series.flatMap((x) => x.games),
    }, team, this.postseason?.done ? Number.MAX_SAFE_INTEGER : this.currentDay); // 가을야구가 끝나면 현재 날짜가 정규시즌 끝으로 돌아가므로 전부 넣는다
  }

  /** 지금 자금 (장부 + 진행 중인 시즌의 수입·지출, 만 원) */
  cashNow(team = this.teamIdx): number {
    const flows = this.seasonFinance(team);
    const inSeason = flows ? Object.values(flows.items).reduce((s, v) => s + (v ?? 0), 0) : 0;
    return cashOf(this.league, team) + inSeason;
  }

  financeLabel(k: FinanceKind): string {
    return FINANCE_LABEL[k];
  }

  /** 오프시즌 화면용: 다음 시즌 기준 선수 가치 계산 도구 */
  offView(): Off.LeagueView {
    if (!this.viewCache || this.viewCache.version !== this.offVersion) {
      this.viewCache = { version: this.offVersion, view: Off.leagueView(this.league, this.store, this.params) };
    }
    return this.viewCache.view;
  }

  /** 다음 시즌 기준 한 시즌 기여 (런). 오프시즌에만 */
  nextRuns(id: string): number {
    const v = this.offView();
    const sp = v.sim.get(id);
    return sp ? currentRuns(sp, v.ctx) : 0;
  }

  /** 오프시즌 로그 중 새로 생긴 것 가운데 우리 구단 관련과 주요 이적을 알림으로 옮긴다 */
  private offNews(from: number): void {
    const off = this.offseason;
    if (!off) return;
    for (const l of off.log.slice(from)) {
      if (l.mine || l.major || (l.stage === 'fa' && l.text.includes('→'))) this.addOffNews(l.text);
    }
  }

  /** 시상 알림: MVP·신인상, 우리 구단 수상 */
  private awardNews(): void {
    const aw = this.league.awards?.at(-1);
    if (!aw || aw.year !== this.year) return;
    const name = (t: number) => this.league.teams[t].name;
    if (aw.mvp) this.addOffNews(`${aw.year} MVP: ${aw.mvp.name} (${name(aw.mvp.team)}) — ${aw.mvp.line}`);
    if (aw.rookie) this.addOffNews(`${aw.year} 신인상: ${aw.rookie.name} (${name(aw.rookie.team)})`);
    const gg = aw.goldenGlove.filter((x) => x.winner.team === this.teamIdx).map((x) => x.winner.name);
    if (gg.length) this.addOffNews(`골든글러브 수상: ${gg.join(', ')}`);
    const tt = aw.titles.flatMap((t) => t.winners.filter((w) => w.team === this.teamIdx).map((w) => `${w.name} ${t.label}`));
    if (tt.length) this.addOffNews(`타이틀 홀더: ${tt.join(', ')}`);
  }

  private addOffNews(text: string): void {
    this.news.push({ year: this.year, day: -1, kind: 'offseason', text });
  }

  offerFa(id: string, salary: number, years: number) { return this.dispatchOff({ year: this.year, type: 'fa-offer', id, salary, years }); }
  withdrawFa(id: string) { return this.dispatchOff({ year: this.year, type: 'fa-withdraw', id }); }
  setForeignKeep(id: string, keep: boolean) { return this.dispatchOff({ year: this.year, type: 'foreign-keep', id, keep }); }
  signForeign(id: string) { return this.dispatchOff({ year: this.year, type: 'foreign-sign', id }); }
  draft(id: string | null) { return this.dispatchOff({ year: this.year, type: 'draft', id }); }
  autoDraft() { return this.dispatchOff({ year: this.year, type: 'draft-auto' }); }
  setSalaryOffer(id: string, amount: number) { return this.dispatchOff({ year: this.year, type: 'salary-offer', id, amount }); }
  setProtect(fa: string, ids: string[]) { return this.dispatchOff({ year: this.year, type: 'comp-protect', fa, ids }); }
  pickComp(fa: string, pick: string) { return this.dispatchOff({ year: this.year, type: 'comp-pick', fa, pick }); }
  autoComp() { return this.dispatchOff({ year: this.year, type: 'comp-auto' }); }
  /** 우리 보상 건의 추천 (자동 선택과 같은 기준, 조작 아님): 선수 id 또는 'cash' */
  compRecommendation(fa: string): string | null {
    const off = this.offseason;
    const c = off?.comp?.find((x) => x.fa === fa);
    return off && c ? Off.compRecommendation(this.league, off, c, this.store, this.params) : null;
  }
  setDraftProtect(kind: 'second' | 'expansion', ids: string[]) { return this.dispatchOff({ year: this.year, type: 'pd-protect', kind, ids }); }
  setDraftWish(kind: 'second' | 'expansion', ids: string[]) { return this.dispatchOff({ year: this.year, type: 'pd-wish', kind, ids }); }
  setInvest(kind: InvestKind, level: number) { return this.dispatchOff({ year: this.year, type: 'invest', kind, level }); }
  orderStadium(id: string, park: { size?: ParkSize; dome?: boolean; deal?: 'standard' | 'push' } = {}) {
    return this.dispatchOff({ year: this.year, type: 'stadium', id, ...(park.size && park.size !== 'neutral' ? { size: park.size } : {}), ...(park.dome ? { dome: true } : {}), ...(park.deal === 'push' ? { deal: 'push' as const } : {}) });
  }
  setCamp(pick: CampPick) { return this.dispatchOff({ year: this.year, type: 'camp', pick }); }
  /** 구장 명명권 제안 받기 (오프시즌) */
  signNaming(id: string) { return this.dispatchOff({ year: this.year, type: 'naming', id }); }
  /** 다음 시즌 우리 캠프 (정하지 않았으면 기본) */
  get campPlan(): CampPick { return this.league.campPlan?.year === this.year + 1 ? this.league.campPlan.pick : DEFAULT_CAMP; }
  fireManager() { return this.dispatchOff({ year: this.year, type: 'mgr-fire' }); }
  hireManager(name: string) { return this.dispatchOff({ year: this.year, type: 'mgr-hire', name }); }
  /** 오프시즌: 해임과 선임을 한 번에 */
  replaceManager(name: string) { return this.dispatchOff({ year: this.year, type: 'mgr-replace', name }); }

  /** 시즌 중 감독 교체 (name null = 감독 대행). 정규시즌 중에만 */
  changeManager(name: string | null): { ok: boolean; message: string } {
    if (this.phase !== 'season' || this.season.done) return { ok: false, message: '시즌 중 감독 교체는 정규시즌 동안만 할 수 있습니다. 오프시즌에는 구단 → 감독·코치에서 바꿉니다.' };
    const r = this.applyManagerChange(name);
    if (r.ok) this.actions.push({ year: this.year, day: this.day, type: 'mgr-change', name });
    return r;
  }

  private applyManagerChange(name: string | null): { ok: boolean; message: string } {
    const r = changeManagerInSeason(this.league, this.store, this.teamIdx, this.world.year, name);
    if (r.ok) {
      this.applyTactics();
      this.addNews(this.season.day, 'season', r.message);
    }
    return r;
  }

  /** 지금 고용할 수 있는 코치 (시즌 중 시장 / 오프시즌 시장) */
  coachCandidates(): Coach[] {
    if (this.phase === 'season') return this.season.done ? [] : coachMarketInSeason(this.league, this.world.year);
    return this.offseason?.coachMarket ?? [];
  }

  /** 시즌 중 코치 고용 (같은 역할 코치는 위약금을 내고 바꾼다) */
  hireCoachInSeason(id: string): { ok: boolean; message: string } {
    if (this.phase !== 'season' || this.season.done) return { ok: false, message: '시즌 중 코치 고용은 정규시즌 동안만 할 수 있습니다.' };
    const r = this.applyHireCoachIn(id);
    if (r.ok) this.actions.push({ year: this.year, day: this.day, type: 'hire-coach-in', id });
    return r;
  }

  private applyHireCoachIn(id: string): { ok: boolean; message: string } {
    const year = this.world.year;
    const c = coachMarketInSeason(this.league, year).find((x) => x.id === id);
    if (!c) return { ok: false, message: '고용할 수 없는 코치입니다.' };
    const buyout = hireCoach(this.league, this.teamIdx, c, year);
    const label = `${COACH_ROLE_LABEL[c.role]} (${c.level}등급·${COACH_STYLE_LABEL[c.style]})`;
    this.addNews(this.season.day, 'season', `${label} 고용${buyout ? `, 전임 코치 위약금 ${(buyout / 10000).toFixed(1)}억 원` : ''}.`);
    return { ok: true, message: `${label}를 고용했습니다. 오늘부터 경기력에 반영됩니다.` };
  }
  /**
   * 수비 능력치를 직접 고친다 (2026-10-13 사용자 선택 "공개 수상·평가로 보정 + 직접 고치기"). 수비 기록 자료가 없어 추정값이라,
   * 플레이어가 아는 실제에 맞게 포지션별 수비 런을 바꿀 수 있다. 조작 기록에 남아 재현된다
   */
  editDefense(id: string, def: Defense): { ok: boolean; message: string } {
    const lp = this.leaguePlayer(id);
    if (!lp?.bat) return { ok: false, message: '타자 능력이 없는 선수입니다.' };
    const clean: Defense = {};
    for (const q of FIELD_POS) {
      const v = def[q];
      if (typeof v === 'number' && Number.isFinite(v)) clean[q] = Math.round(Math.max(-40, Math.min(25, v)) * 10) / 10;
    }
    if (this.phase === 'season') {
      this.dispatchSeason({ year: this.year, day: this.currentDay, type: 'def-edit', id, def: clean });
      return { ok: true, message: '수비 능력치를 고쳤습니다.' };
    }
    return this.dispatchOff({ year: this.year, type: 'def-edit-off', id, def: clean });
  }

  /**
   * 이도류로 쓰기·그만두기 (2026-10-13 사용자 선택 "오타니식 + 구단이 역할 선택"). 투수는 지명타자로도, 타자는 선발 투수 후보로도 나간다.
   * 반대쪽 능력이 낮으면 써도 손해일 뿐 막지는 않는다. 우리 구단 선수만
   */
  setTwoWay(id: string, on: boolean): { ok: boolean; message: string } {
    const lp = this.leaguePlayer(id);
    if (!lp || lp.team !== this.teamIdx) return { ok: false, message: '우리 구단 선수만 정할 수 있습니다.' };
    if (!!lp.twoWay === on) return { ok: false, message: on ? '이미 이도류입니다.' : '이미 본업만 맡고 있습니다.' };
    if (this.phase === 'season') {
      this.dispatchSeason({ year: this.year, day: this.currentDay, type: 'two-way', id, on });
      return { ok: true, message: on ? `${lp.name}을(를) 이도류로 씁니다.` : `${lp.name}은(는) 본업만 맡습니다.` };
    }
    return this.dispatchOff({ year: this.year, type: 'two-way-off', id, on });
  }

  private applyTwoWay(id: string, on: boolean): void {
    const lp = this.leaguePlayer(id);
    if (!lp) return;
    const year = this.phase === 'season' ? this.world.year : this.year + 1;
    setTwoWayAbility(lp, on, this.values, year);
    if (this.phase === 'season') {
      const sp = this.world.players.find((p) => p.id === id);
      if (sp) {
        if (on && (lp.alt?.bat || lp.alt?.pit)) sp.alt = { ...(lp.alt.bat ? { bat: lp.alt.bat } : {}), ...(lp.alt.pit ? { pit: lp.alt.pit } : {}) };
        else delete sp.alt;
        if (sp.teamIdx >= 0) this.season.teamSeasons[sp.teamIdx].dirty = true;
      }
    }
    this.valueCtx = null;
  }

  /**
   * 자유 모드로 시즌 중 우리 구단에 온 선수는 1군에 바로 등록한다 (2026-10-13 사용자 보고: 데려온 선동열이 2군에 머물러 던지지 않았다).
   * 1군이 꽉 차면 같은 쪽(투수·야수)에서 가장 약한 선수를 내린다. 조작 적용의 일부라 재현에도 같다
   */
  private autoRegister(p: SimPlayer): void {
    const ts = this.season.teamSeasons[this.teamIdx];
    if (!ts.manual || p.dev) return;
    const cur = new Set(ts.manual);
    cur.add(p.idx);
    const size = this.world.rules.rosterSize;
    if (cur.size > size) {
      const same = [...cur].map((i) => this.world.players[i]).filter((x) => x.idx !== p.idx && x.isPitcher === p.isPitcher);
      // 투수 value는 작을수록, 야수는 클수록 좋다
      const weakest = same.sort((a, b) => (p.isPitcher ? b.value - a.value : a.value - b.value))[0];
      if (weakest) {
        cur.delete(weakest.idx);
        this.addNews(this.day, 'entry', `${weakest.name} 1군 말소 (${p.name} 등록 자리)`);
      }
    }
    this.season.setManualEntry(this.teamIdx, [...cur]);
    this.addNews(this.day, 'entry', `${p.name} 1군 등록`);
  }

  /** 자유 모드 입단 예약: 이 시즌 개막 때 들어올 선수를 만든다 (리그 상태, 오프시즌 끝 open 때). 소식을 돌려준다 */
  private openPipeline(): string[] {
    const L = this.league;
    const due = (L.fantasy?.pipeline ?? []).filter((x) => x.joinYear <= L.year);
    if (!due.length) return [];
    L.fantasy!.pipeline = L.fantasy!.pipeline!.filter((x) => x.joinYear > L.year);
    const out: string[] = [];
    for (const x of due) {
      if (!L.teams[x.team]) continue;
      const age = L.year - x.birthYear;
      const runs = runsForGrade(x.now, L.year);
      const pot = Math.max(runs, runsForGrade(x.potential, L.year));
      const pos = x.pos === 'IF' ? '2B' : x.pos === 'OF' ? 'RF' : x.pos;
      const np = Off.addFreePlayer(L, this.store, this.params, x.team, { name: x.name, pos, age, runs, potential: pot });
      if (x.real) np.outsider = true;
      const op = { op: 'create' as const, name: x.name, team: x.team, pos: x.pos as Extract<FreeOp, { op: 'create' }>['pos'], age, now: x.now, potential: x.potential,
        ...(x.role ? { role: x.role } : {}), ...(x.foreign ? { foreign: true } : {}), military: age >= 28 ? 'done' as const : 'pending' as const };
      this.setPitchRole(np, op.role);
      this.applyNationality(np, op);
      const ctx = leagueView({ ...L, year: L.year - 1 }, this.store, this.params).ctx;
      Object.assign(np, skillForRuns({ ...np }, runs, ctx, L.year));
      out.push(`${L.teams[x.team].name} ${x.name} 입단 (예약, ${age}세)`);
    }
    return out;
  }

  /** 만든 선수의 국적·병역 (자유 모드 create). 외국인은 병역이 없고 달러 계약 */
  private applyNationality(lp: LeaguePlayer, op: Extract<FreeOp, { op: 'create' }>): void {
    if (op.foreign) {
      lp.foreign = true;
      delete lp.military;
      lp.contract = { ...lp.contract, kind: 'foreign', salary: Math.max(lp.contract.kind === 'foreign' ? lp.contract.salary : 0, 300_000) };
    } else {
      lp.foreign = false;
      lp.military = { state: op.military ?? 'pending', basis: 'estimate', note: '자유 모드' };
    }
  }

  /** 만든 투수의 역할 (선발·구원). 구원이면 선발 비율을 낮게 */
  private setPitchRole(lp: LeaguePlayer, role: 'SP' | 'RP' | undefined): void {
    if (!lp.pit || !role) return;
    lp.pit = role === 'RP' ? { ...lp.pit, startShare: 0.02, reliefStint: Math.max(4, lp.pit.reliefStint) } : { ...lp.pit, startShare: Math.max(0.9, lp.pit.startShare) };
  }

  /**
   * 만든 선발 투수의 체력을 리그 선발 중간값까지 (빈 자리·가상 선수 바탕은 체력이 낮아 일찍 내려갔다, 2026-10-13). 바꿨으면 true
   */
  private typicalStarterStamina(lp: LeaguePlayer): boolean {
    if (!lp.pit || !isStarterSkill(lp.pit)) return false;
    const st = this.world.players.filter((p) => p.pit && isStarterSkill(p.pit) && p.pit.sample >= 300).map((p) => p.pit!.stamina).sort((a, b) => a - b);
    const mid = st.length ? st[Math.floor(st.length / 2)] : 24;
    if (lp.pit.stamina >= mid) return false;
    lp.pit = { ...lp.pit, stamina: mid };
    return true;
  }

  private applyDefenseEdit(id: string, def: Defense): void {
    const lp = this.leaguePlayer(id);
    if (!lp?.bat) return;
    lp.bat = { ...lp.bat, def: { ...lp.bat.def, ...def } };
    if (this.phase === 'season') {
      const sp = this.world.players.find((p) => p.id === id);
      if (sp?.bat) {
        sp.bat = { ...sp.bat, def: { ...sp.bat.def, ...def } };
        if (sp.teamIdx >= 0) this.season.teamSeasons[sp.teamIdx].dirty = true;
      }
    }
    this.valueCtx = null;
  }

  /**
   * 세부 난이도를 바꾼다 (게임 중에도, 조작 기록에 남는다). 부상 빈도는 다음 경기부터
   */
  setDifficulty(s: DifficultySettings): { ok: boolean; message: string } {
    if (this.phase === 'season') {
      this.applySettings(s);
      this.actions.push({ year: this.year, day: this.currentDay, type: 'settings', s: { ...s } });
      return { ok: true, message: '난이도를 바꿨습니다.' };
    }
    return this.dispatchOff({ year: this.year, type: 'settings-off', s: { ...s } });
  }

  private applySettings(s: DifficultySettings): void {
    this.league.settings = { ...s };
    this.refreshInjury();
  }

  /** 세부 난이도의 부상 빈도를 지금 시즌 우리 구단에 (의료 투자 배율과 곱한다) */
  private refreshInjury(): void {
    const med = activeLevel(this.league, this.teamIdx, 'medical');
    const t = this.world.teams[this.teamIdx];
    if (t) t.injuryRate = (med ? MEDICAL_RATE[med] : 1) * settingsOf(this.league).injury;
  }

  /** 우리 선수의 포스팅(해외 진출) 요청에 답한다 */
  answerPosting(id: string, accept: boolean) { return this.dispatchOff({ year: this.year, type: 'posting', id, accept }); }
  setFranchiseTag(id: string | null) { return this.dispatchOff({ year: this.year, type: 'franchise-tag', id }); }

  /** 비FA 다년 계약 (오프시즌, 요구 연봉 그대로) */
  extend(id: string, years: number) { return this.dispatchOff({ year: this.year, type: 'extend', id, years }); }

  /** 다년 계약 후보와 기간별 요구 연봉 (화면용) */
  extensionOffers(): { p: LeaguePlayer; toFa: number; demands: { years: number; salary: number }[] }[] {
    const off = this.offseason;
    if (!off) return [];
    const view = Off.leagueView(this.league, this.store, this.params);
    const ys = Array.from({ length: ruleOf(this.league, 'extMaxYears') - Off.EXT_MIN_YEARS + 1 }, (_, i) => Off.EXT_MIN_YEARS + i);
    return Off.extensionCandidates(this.league, off).map((p) => ({
      p, toFa: Off.seasonsToFa(p, off.year), demands: ys.map((years) => ({ years, salary: Off.extensionAsk(this.league, view, p, off.year, years) })),
    }));
  }

  /** 해외에 있는 선수 (overseas.ts) */
  abroadPlayers(): LeaguePlayer[] {
    return this.league.players.filter((p) => p.abroad && p.team === -2);
  }

  /** 오프시즌 코치 후보를 고용한다 (같은 역할 코치가 있으면 위약금을 내고 바꾼다) */
  hireCoach(id: string) { return this.dispatchOff({ year: this.year, type: 'hire-coach', id }); }

  private applyHireCoach(id: string): { ok: boolean; message: string } {
    const off = this.offseason;
    const c = off?.coachMarket?.find((x) => x.id === id);
    if (!off || !c) return { ok: false, message: '고용할 수 없는 코치입니다.' };
    const buyout = hireCoach(this.league, this.teamIdx, c, off.year);
    off.coachMarket = off.coachMarket!.filter((x) => x.id !== id);
    const label = `${COACH_ROLE_LABEL[c.role]} (${c.level}등급·${COACH_STYLE_LABEL[c.style]})`;
    this.addOffNews(`${label} 고용${buyout ? `, 전임 코치 위약금 ${(buyout / 10000).toFixed(1)}억 원` : ''}`);
    return { ok: true, message: `${label}를 고용했습니다.` };
  }

  /** 육성선수로 데려올 수 있는 선수 (정원 정리 단계) */
  devPool(): LeaguePlayer[] {
    return this.offseason ? Off.devPool(this.league, this.offseason) : [];
  }
  /** 정원 정리: 우리 선수를 육성선수로, 육성선수 영입, 육성선수 정식 등록 */
  toDev(id: string) { return this.dispatchOff({ year: this.year, type: 'to-dev', id }); }
  signDev(id: string) { return this.dispatchOff({ year: this.year, type: 'sign-dev', id }); }
  promoteDevOff(id: string) { return this.dispatchOff({ year: this.year, type: 'promote-dev', id }); }
  /** 은퇴 선수를 우리 구단 레전드로 지정 (오프시즌) */
  designateLegend(id: string) { return this.dispatchOff({ year: this.year, type: 'legend', id }); }
  release(id: string) { return this.dispatchOff({ year: this.year, type: 'release', id }); }
  autoRelease() { return this.dispatchOff({ year: this.year, type: 'release-auto' }); }
  /** 정원 정리: 우리 구단 방출 순서 (자동 방출과 같은 기준)와 최소 인원 때문에 뒤로 미룬 선수 */
  releasePlan(): { order: LeaguePlayer[]; kept: LeaguePlayer[] } {
    return Off.releaseSplit(this.league, this.offseason!, this.offView(), this.teamIdx);
  }
  /** 정원 정리: 지금 데려올 수 있는 다른 구단 방출 선수 */
  claimable(): LeaguePlayer[] {
    return this.offseason ? Off.claimablePlayers(this.league, this.offseason, this.teamIdx) : [];
  }
  /** 다른 구단이 방출한 선수를 데려온다 (정원 정리 단계, 방출 선수 시장) */
  claim(id: string) { return this.dispatchOff({ year: this.year, type: 'claim', id }); }
  /** 이번 단장 회의에 우리 표를 낼 수 없는가 (이 결산에서 해고됨) */
  get voteLocked(): boolean { return !!this.offseason && Off.voteLockedByFiring(this.league, this.offseason); }
  /** 단장 회의 우리 표 (구단 투표). 단장 회의 단계에서만, 몇 번이고 바꿀 수 있다. 해고된 채 맞은 회의는 막힌다 */
  voteRule(choice: VoteChoice, agenda?: string) { return this.dispatchOff({ year: this.year, type: 'rule-vote', choice, ...(agenda ? { agenda } : {}) }); }
  nextStage() { return this.dispatchOff({ year: this.year, type: 'next' }); }
  /** 해고된 뒤 영입 제의를 받아들인다 (M7) */
  acceptOffer(team: number) { return this.dispatchOff({ year: this.year, type: 'accept-offer', team }); }
  /** 오프시즌을 끝내고 다음 시즌을 연다 (환경 맞춤 때문에 1초 안팎 걸린다) */
  openNextSeason() { return this.dispatchOff({ year: this.year, type: 'open' }); }

  /**
   * 개막 준비 단계의 기용 보드 (2026-10-23 사용자 결정): 지금 오프시즌을 저장·불러오기로 복사해 개막까지 한 세션.
   * 개막은 결정적이라 실제로 개막하면 같은 월드가 된다. 화면은 이 세션에서 1군·기용표를 고치고,
   * 개막 때 그 조작(openingBoardActions)을 실제 세션에 applyOpeningBoard로 옮긴다. 이 세션 자체는 버린다.
   */
  previewOpening(): GameSession | null {
    if (this.phase !== 'offseason' || this.offseason?.stage !== 'ready') return null;
    const g = GameSession.load(this.store, clone(this.toSave()), this.params);
    g.watch = [];
    return g.openNextSeason().ok ? g : null;
  }

  /** 개막 날(첫 경기 전)에 한 1군·기용표 조작. previewOpening 세션에서 꺼낸다 */
  openingBoardActions(): GameAction[] {
    return this.actions.filter((a) => (a.type === 'entry' || a.type === 'plan') && 'day' in a && a.day === 0 && a.year === this.year).map((a) => clone(a));
  }

  /**
   * 미리 보기에서 한 개막 날 조작을 그대로 한다 (조작 기록에 남아 재현된다). 개막 직후(0일, 첫 경기 전)에만.
   * 선수는 id로 적혀 있어 월드 색인과 상관없다. 돌려주는 값: 옮긴 조작 수
   */
  applyOpeningBoard(actions: readonly GameAction[]): number {
    if (this.phase !== 'season' || this.day !== 0) return 0;
    let n = 0;
    for (const a of actions) {
      if ((a.type !== 'entry' && a.type !== 'plan') || a.day !== 0 || (a.year ?? this.league.startYear) !== this.year) continue;
      this.dispatchSeason(clone(a));
      n++;
    }
    return n;
  }

  toSave(): GameSaveV2 {
    const base = {
      app: 'kbo-gm' as const,
      format: 2 as const,
      year: this.year,
      teamIdx: this.teamIdx,
      teamName: this.league.teams[this.teamIdx].name,
      seed: this.league.seed,
      season: this.season.toSave(),
      ...(this.postseason ? { postseason: clone(this.postseason) } : {}),
      news: this.news.map((n) => ({ ...n })),
      actions: this.actions.map((a) => clone(a)),
      ...(this.watch.length ? { watch: clone(this.watch) } : {}),
    };
    if (this.phase === 'offseason') {
      return { ...base, phase: 'offseason', league: clone(this.league), finishedLeague: clone(this.finishedLeague!), offseason: clone(this.offseason!) };
    }
    return { ...base, phase: 'season', league: clone(this.league), ...(this.enlistChoice ? { enlistChoice: [...this.enlistChoice] } : {}),
      ...(this.applyChoice ? { applyChoice: [...this.applyChoice] } : {}) };
  }
}

/** TeamSeason의 1군 전체 (야수 + 선발 + 구원) */
export function activeOf(ts: TeamSeason): SimPlayer[] {
  return [...ts.hitters, ...ts.rotation, ...ts.bullpen];
}
