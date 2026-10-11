// 게임 진행 상태: 리그 상태(여러 해) + 지금 시즌(Season) + 오프시즌 단계, 플레이어 구단의 조작, 알림, 저장.
// 화면에 의존하지 않으므로 Node에서도 그대로 돌릴 수 있다 (시즌 완주·오프시즌 테스트가 이용).
//
// 흐름: 새 게임(createLeague) → 시즌 진행 → 시즌 종료 → beginOffseason(결산) → 오프시즌 단계들 → openNextSeason → 다음 시즌 ...
// 시즌 중 리그 상태는 "그 시즌 개막 때"로 고정되고, 트레이드·기록은 Season이 가진다. 결산 때 리그 상태에 반영한다.

import type { DataStore } from '../data/types';
import {
  absenceLabel, assignSlots, DEFAULT_PARAMS, isVirtual, LINEUP_SLOTS, MIN_ACTIVE_HITTERS, MIN_ACTIVE_PITCHERS, Season, todaysStarter,
  type Absence, type DepthPlan, type EngineParams, type SeasonSave, type SimPlayer, type Slot, type TeamSeason, type World,
} from '../engine';
import { coreAge, evaluateTrade, horizonWeights, suggestPackage, tendencyOf, type TeamSituation, type Tendency, type TradeEvaluation } from '../ai/trade';
import { currentRuns, teamStrength, valueContext, type ValueContext } from '../ai/value';
import { createLeague } from '../league/create';
import * as Off from '../league/offseason';
import type { LeaguePlayer, LeagueState } from '../league/types';
import { worldFromLeague } from '../league/world';
import { changeText } from '../league/eras';
import { ensureEvents, eventDef, resolveEvent, rollEvent, type EventContext, type PendingEvent } from '../league/events';
import { judgeScenario, scenarioById } from '../league/scenarios';
import {
  careers, FAREWELL_DAYS, FAREWELL_FILL, farewellWorthy, hallOfFame, LEGEND_SEASONS, legendCandidates, recordSeasonBests, recordYear,
  seasonBests,
} from '../league/history';
import { addArticle, crossed, josa, MILESTONES, STREAK_FROM } from '../league/articles';
import {
  cashOf, ensureFinance, FINANCE_LABEL, seasonFlows, setInvest, settleSeason, trustFromFinance,
  type FinanceKind, type FinanceYear, type InvestKind, type SeasonFlows, type TradeMove,
} from '../league/finance';
import { aiEnlistPicks, enlistCandidates, normalizeEnlist, runsNow, type EnlistCandidate } from '../league/careers';
import {
  ACHIEVEMENTS, aiPotential, applyCapSanctions, FIRE_BELOW, GOAL_LABEL, goalFor, newAchievements, newOwner, offersFor, outcomeLabel,
  outcomeOf, START_TRUST, trustDelta, type Difficulty, type OwnerState,
} from '../league/owner';
import {
  currentSeries, playNextGame, resultOf, ROUND_LABEL, startPostseason, stillAlive,
  type PostseasonResult, type PostseasonState, type SeriesGame,
} from '../league/postseason';
import { dateOf, formatDate } from './calendar';

export interface NewGameOptions {
  year: number;
  teamIdx: number;
  seed: string;
  /** 난이도 (AI의 잠재력 평가 오차, M7). 없으면 보통 */
  difficulty?: Difficulty;
  /** 역사 시나리오 id (league/scenarios.ts). 있으면 그 해 한국시리즈 우승이 목표 */
  scenario?: string;
}

/** 버그 보고용 재현 정보. `GameSession.replay(store, opts, actions, at)`에 그대로 넣으면 같은 상태가 된다 */
export interface ReproInfo {
  /** 새 게임 조건: 시작 연도, 처음 맡은 구단, 게임 시드, 난이도 */
  opts: NewGameOptions;
  /** 지금 위치 (오프시즌이면 막 끝난 시즌 연도와 마지막 날) */
  at: { year: number; day: number; phase: 'season' | 'offseason' };
  actions: GameAction[];
}

export type NewsKind = 'absence' | 'return' | 'callup' | 'entry' | 'season' | 'trade' | 'offseason' | 'plan' | 'owner' | 'event';

/** 기용표를 선수 id로 적은 것 (조작 기록용) */
export interface PlanIds {
  starters: Partial<Record<Slot, string>>;
  rotation: string[];
  closer: string | null;
}

export type PitcherRole = 'SP' | 'RP' | 'CL';
export const PITCHER_ROLE_LABEL: Record<PitcherRole, string> = { SP: '선발', RP: '중계', CL: '마무리' };

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
  | { year?: number; day: number; type: 'trade'; team: number; give: string[]; get: string[]; cash?: number }
  | { year: number; day: number; type: 'plan'; plan: PlanIds | null }
  | { year: number; day: number; type: 'event'; choice: number }
  /** enlist: 결산 때 우리 구단 입대 명단 (시즌 결과의 입대 선택). 없으면 AI 규칙 (이전 저장) */
  | { year: number; type: 'begin-off'; enlist?: string[] }
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
  | { year: number; type: 'invest'; kind: InvestKind; level: number }
  | { year: number; type: 'legend'; id: string }
  | { year: number; type: 'release'; id: string }
  | { year: number; type: 'release-auto' }
  | { year: number; type: 'claim'; id: string }
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
}

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
  news: NewsItem[];
  actions: GameAction[];
}

export type GameSave = GameSaveV1 | GameSaveV2;

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
}
const SEASON_KEYS = ['hr', 'h', 'rbi', 'sb', 'w', 'sv', 'so'];
const SEASON_LABEL: Record<string, string> = { hr: '홈런', h: '안타', rbi: '타점', sb: '도루', w: '승', sv: '세이브', so: '탈삼진' };

export interface EntryCheck {
  /** 지켜야 하는 규정 위반. 있으면 바꾸지 않는다 */
  errors: string[];
  /** 바꿀 수는 있지만 알려 줄 것 */
  warnings: string[];
}

type Store = Pick<DataStore, 'meta' | 'players' | 'season' | 'contracts'>;

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
  private lastCallUps = new Set<number>();
  /** 기사 판정용 기준값 (메모리에만, 불러오기·재현 때 같은 규칙으로 다시 만든다) */
  private articleState: ArticleState | null = null;
  private valueCtx: ValueContext | null = null;
  /** 오프시즌 화면용 가치 계산 (조작할 때마다 다시 만든다) */
  private viewCache: { version: number; view: Off.LeagueView } | null = null;
  private offVersion = 0;

  private constructor(store: Store, params: EngineParams, teamIdx: number, league: LeagueState, world: World, season: Season) {
    this.store = store;
    this.params = params;
    this.teamIdx = teamIdx;
    this.league = league;
    this.world = world;
    this.season = season;
  }

  /**
   * 새 게임. store에는 모든 시즌과 계약 기록이 불러와져 있어야 한다 (잠재력·연차 산출).
   * 첫 시즌은 worldForYear와 같은 월드에 게임 시드를 그대로 써서, 같은 시드면 M3·M4와 같은 결과가 나온다.
   */
  static create(store: Store, opts: NewGameOptions, params: EngineParams = DEFAULT_PARAMS): GameSession {
    const { league, world } = createLeague(store, opts.year, opts.seed, params);
    if (!world.teams[opts.teamIdx]) throw new Error(`구단 색인이 잘못됐습니다: ${opts.teamIdx}`);
    league.difficulty = opts.difficulty ?? 'normal';
    applyCapSanctions(league, league.year);
    league.owner = newOwner(opts.teamIdx);
    const season = Season.start(world, params, seasonSeed(league), { boxTeams: [opts.teamIdx] });
    const g = new GameSession(store, params, opts.teamIdx, league, world, season);
    g.startEntry();
    g.addNews(0, 'season', `${world.year} 시즌 ${world.teams[opts.teamIdx].name} 단장으로 부임했습니다. 개막일은 ${formatDate(world.year, 0)}입니다.`);
    const sc = opts.scenario ? scenarioById(opts.scenario) : undefined;
    if (sc) {
      league.scenario = { id: sc.id, year: sc.year, team: opts.teamIdx };
      g.addNews(0, 'season', `역사 시나리오 「${sc.title}」: ${sc.intro} 목표는 ${sc.year} 한국시리즈 우승입니다.`);
    }
    for (const e of league.expansions ?? []) {
      g.addNews(0, 'season', `${league.teams[e.team].name}: 창단 구단으로 ${world.year} 시즌은 퓨처스리그에서 뛰고 ${e.firstYear}년 1군에 들어옵니다.`);
    }
    g.setSeasonGoal();
    // 시나리오: 구단주 목표도 한국시리즈 우승
    if (sc && g.owner.goal) g.owner.goal = { ...g.owner.goal, kind: 'champion' };
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
    g.ensureOwner();
    ensureFinance(g.league);
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
      this.trades.push({ day: a.day, team: a.team, give: a.give.map((id) => byId.get(id)!), get: a.get.map((id) => byId.get(id)!) });
    }
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
    else this.applyTrade(a.team, idxs(a.give), idxs(a.get), a.cash ?? 0);
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
   * 버그 보고용 재현 정보. 시즌 시드·지금 구단이 아니라 처음 게임을 만든 조건을 담는다
   * (두 번째 시즌부터 시즌 시드는 `시드/연도`로 바뀌고, 해고 뒤에는 맡은 구단도 바뀐다).
   */
  reproInfo(): ReproInfo {
    const L = this.league;
    const firstTeam = L.owner?.history[0]?.team ?? L.owner?.team ?? this.teamIdx;
    return {
      opts: { year: L.startYear, teamIdx: firstTeam, seed: L.seed, difficulty: L.difficulty ?? 'normal', ...(L.scenario ? { scenario: L.scenario.id } : {}) },
      at: { year: this.year, day: this.day, phase: this.phase },
      actions: clone(this.actions),
    };
  }

  // ---- 엔트리

  /** 개막 때 1군: AI가 짠 엔트리를 그대로 받아 플레이어가 관리한다 */
  private startEntry(): void {
    const ts = this.season.refresh(this.teamIdx);
    this.season.setManualEntry(this.teamIdx, activeOf(ts).map((p) => p.idx));
  }

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

  /** 결장 까닭 (짧은 문구). 실존 선수의 이탈은 중립 문구만 나온다 (eventLabel이 막는다) */
  absenceReason(p: SimPlayer): string | null {
    if (!this.isAbsent(p)) return null;
    const a = this.absenceOf(p);
    if (a) return absenceLabel(a, p, a.until >= this.season.schedule.length);
    const lp = this.leaguePlayer(p.id);
    if (lp?.startAbsentReason === 'military') return '군 복무 (전역 전)';
    if (lp?.startAbsentReason === 'injury') return isVirtual(p) ? '지난 시즌 부상 재활' : '지난 시즌부터 결장';
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

  checkEntry(idxs: Iterable<number>): EntryCheck {
    const set = new Set(idxs);
    const players = this.team.org.filter((p) => set.has(p.idx));
    const { rosterSize, foreignLimit } = this.world.rules;
    const errors: string[] = [];
    const warnings: string[] = [];
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
    return pl.closer === p.idx ? 'CL' : pl.rotation.includes(p.idx) ? 'SP' : 'RP';
  }

  /** 야수를 주전 자리에 세우거나(slot) 서브로 돌린다(null). 그 자리에 있던 선수는 서브가 된다 */
  setHitterSlot(p: SimPlayer, slot: Slot | null): EntryCheck {
    const pl = structuredClone(this.effectivePlan());
    for (const s of LINEUP_SLOTS) if (pl.starters[s] === p.idx) delete pl.starters[s];
    if (slot) pl.starters[slot] = p.idx;
    return this.setPlan(pl);
  }

  /** 투수 보직을 바꾼다. 마무리는 한 명이라, 새로 정하면 기존 마무리는 중계로 간다 */
  setPitcherRole(p: SimPlayer, role: PitcherRole): EntryCheck {
    const pl = structuredClone(this.effectivePlan());
    pl.rotation = pl.rotation.filter((i) => i !== p.idx);
    if (pl.closer === p.idx) pl.closer = null;
    if (role === 'SP') pl.rotation.push(p.idx);
    if (role === 'CL') pl.closer = p.idx;
    return this.setPlan(pl);
  }

  /** 기용표 검사: 주전·로테이션·마무리는 지금 1군에 등록된 우리 선수여야 한다 */
  checkPlan(plan: DepthPlan): EntryCheck {
    const errors: string[] = [];
    const warnings: string[] = [];
    const reg = new Map(this.registered().map((p) => [p.idx, p]));
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
    return { starters, rotation: plan.rotation.map(id), closer: plan.closer === null ? null : id(plan.closer) };
  }

  private planFromIds(ids: PlanIds): DepthPlan {
    const byId = new Map(this.world.players.map((p) => [p.id, p.idx]));
    const starters: DepthPlan['starters'] = {};
    for (const s of LINEUP_SLOTS) {
      const i = ids.starters[s] === undefined ? undefined : byId.get(ids.starters[s]!);
      if (i !== undefined) starters[s] = i;
    }
    const rotation = ids.rotation.map((x) => byId.get(x)).filter((x): x is number => x !== undefined);
    return { starters, rotation, closer: ids.closer === null ? null : byId.get(ids.closer) ?? null };
  }

  // ---- 시즌 진행

  /** days일 진행한다 (시즌이 끝나면 멈춤). 실제로 진행한 날 수를 돌려준다 */
  /**
   * days일 진행한다. stopOnEvent면 이벤트가 생긴 날 멈추고, 답을 기다리는 이벤트가 있으면 진행하지 않는다 (화면).
   * 아니면(테스트·장기 진행) 답을 기다리는 이벤트를 첫 번째 선택지로 자동 처리하고 계속 간다 (events.ts).
   */
  advance(days: number, stopOnEvent = false): number {
    let n = 0;
    while (n < days && this.phase === 'season' && !this.season.done) {
      if (this.league.events?.pending) {
        if (stopOnEvent) break;
        this.applyEventChoice(0, true);
      }
      this.stepDay();
      n++;
      if (stopOnEvent && this.league.events?.pending) break;
    }
    return n;
  }

  /** 다음 경기일까지 진행한다 (중간의 휴식일 포함) */
  advanceToNextGameDay(): number {
    let n = 0;
    do {
      n += this.advance(1);
    } while (this.phase === 'season' && !this.season.done && !this.season.schedule[this.season.day - 1]?.length);
    return n;
  }

  private stepDay(): void {
    const s = this.season;
    const day = s.day;
    const year = this.world.year;
    const org = this.team.org;
    const manual = this.manualEntry;

    // 오늘 복귀하는 선수
    if (day > 0) {
      for (const p of org) {
        if (s.states.absentUntil[p.idx] !== day) continue;
        const where = manual && !manual.has(p.idx) ? ' 지금 2군에 있습니다.' : '';
        this.addNews(day, 'return', `${p.name} 복귀.${where}`);
      }
    }
    const before = org.map((p) => s.states.absentUntil[p.idx]);
    s.simulateDay();

    org.forEach((p, i) => {
      const until = s.states.absentUntil[p.idx];
      if (until > day && until !== before[i]) {
        const inFirst = !manual || manual.has(p.idx);
        // 이탈 사유는 실존 선수에게 중립 문구만 쓴다 (기획서 7장, absenceReason → eventLabel)
        const reason = this.absenceReason(p) ?? '결장';
        const back = until >= s.schedule.length ? '이번 시즌 복귀 어려움' : `복귀 예정 ${formatDate(year, until)} (${until - day}일)`;
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
      this.dailyArticles();
      // 무작위 이벤트 (정규시즌 중, events.ts)
      const ev = rollEvent(ensureEvents(this.league), this.eventContext());
      if (ev) this.addNews(this.season.day, 'event', `이벤트: ${eventDef(ev.id)!.title}`);
    }
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
    };
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
    const st = this.season.standings();
    this.postseason = startPostseason(this.season, st, this.world.rules.postseasonTeams, seasonSeed(this.league));
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
      const g = playNextGame(st, this.season)!;
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
      ctx.salary = new Map(this.league.players.filter((p) => !p.foreign).map((p) => [p.id, p.contract.salary]));
      this.valueCtx = ctx;
    }
    return this.valueCtx;
  }

  /** 트레이드를 할 수 있는 마지막 날 (일정 색인). 이 날의 경기 전까지 가능 */
  get tradeDeadlineDay(): number {
    let last = -1;
    for (let d = 0; d < this.season.schedule.length; d++) {
      const dt = dateOf(this.world.year, d);
      if (dt.month < TRADE_DEADLINE.month || (dt.month === TRADE_DEADLINE.month && dt.date <= TRADE_DEADLINE.date)) last = d;
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
    };
  }

  tendency(teamIdx: number): Tendency {
    return tendencyOf(this.situation(teamIdx));
  }

  /**
   * 트레이드 제안을 AI 구단 입장에서 평가만 한다.
   * cash: 우리가 주는 현금 (만 원, 음수면 받는다). 선수를 현금만으로 사고팔 수도 있다 (재정 상세형)
   */
  evaluateTrade(aiTeam: number, give: SimPlayer[], get: SimPlayer[], cash = 0): TradeEvaluation {
    const none = { gain: 0, need: 0, before: 0, after: 0, tendency: 'rebuild' as const };
    if (aiTeam === this.teamIdx || !this.world.teams[aiTeam]) return { verdict: 'reject-invalid', message: '상대 구단을 고르세요.', detail: none };
    if (!this.tradeOpen) {
      const why = this.done ? '시즌이 끝났습니다.' : `트레이드 마감(${TRADE_DEADLINE.month}월 ${TRADE_DEADLINE.date}일)이 지났습니다.`;
      return { verdict: 'reject-invalid', message: why, detail: none };
    }
    if (give.some((p) => p.teamIdx !== this.teamIdx)) return { verdict: 'reject-invalid', message: '우리 구단 선수만 내줄 수 있습니다.', detail: none };
    const foreign = [...give, ...get].filter((p) => p.foreign);
    if (foreign.length) return { verdict: 'reject-invalid', message: `외국인 선수는 트레이드할 수 없습니다 (${foreign.map((p) => p.name).join(', ')}).`, detail: none };
    if (!Number.isFinite(cash) || Math.round(cash) !== cash) return { verdict: 'reject-invalid', message: '현금은 만 원 단위 정수여야 합니다.', detail: none };
    if (cash > 0 && cash > this.cashNow()) return { verdict: 'reject-invalid', message: `줄 현금(${(cash / 10000).toFixed(1)}억 원)보다 자금이 모자랍니다.`, detail: none };
    if (cash < 0 && -cash > this.cashNow(aiTeam)) return { verdict: 'reject-value', message: '그만한 현금은 우리 구단 자금으로 감당할 수 없습니다.', detail: none };
    return evaluateTrade({ aiTeam, receive: give, give: get, cash }, this.world.teams[aiTeam].org, this.situation(aiTeam), this.values);
  }

  /** 트레이드를 제안한다. AI가 수락하면 바로 실행한다 */
  proposeTrade(aiTeam: number, give: SimPlayer[], get: SimPlayer[], cash = 0): TradeEvaluation {
    const ev = this.evaluateTrade(aiTeam, give, get, cash);
    if (ev.verdict !== 'accept') return ev;
    this.applyTrade(aiTeam, give.map((p) => p.idx), get.map((p) => p.idx), cash);
    this.actions.push({ year: this.year, day: this.day, type: 'trade', team: aiTeam, give: give.map((p) => p.id), get: get.map((p) => p.id), ...(cash ? { cash } : {}) });
    const names = (ps: SimPlayer[]) => ps.map((p) => p.name).join(', ') || '없음';
    const money = cash > 0 ? ` (현금 ${(cash / 10000).toFixed(1)}억 원 지급)` : cash < 0 ? ` (현금 ${(-cash / 10000).toFixed(1)}억 원 받음)` : '';
    this.addNews(this.day, 'trade', `트레이드 성사: ${this.world.teams[aiTeam].name}에 ${names(give)}을(를) 내주고 ${names(get)}을(를) 받았습니다${money}. 받은 선수는 2군에 등록됩니다.`);
    return ev;
  }

  /** AI 구단에게 "이 선수를 주려면 무엇을 원하나"를 묻는다. 수락할 만한 조합이 없으면 null */
  askPackage(aiTeam: number, want: SimPlayer[]): SimPlayer[] | null {
    if (!this.tradeOpen || want.length === 0 || want.some((p) => p.teamIdx !== aiTeam || p.foreign)) return null;
    const mine = horizonWeights(this.tendency(this.teamIdx), this.situation(this.teamIdx).remaining);
    return suggestPackage(want, aiTeam, this.world.teams[aiTeam].org, this.team.org, this.situation(aiTeam), this.values, mine);
  }

  private applyTrade(aiTeam: number, give: number[], get: number[], cash = 0): void {
    if (cash) {
      const [from, to, amount] = cash > 0 ? [this.teamIdx, aiTeam, cash] : [aiTeam, this.teamIdx, -cash];
      this.league.ledger.push({ year: this.year, from, to, amount, note: `트레이드 현금 (${this.world.teams[aiTeam].name})`, kind: 'trade' });
    }
    for (const i of give) this.season.transfer(i, aiTeam);
    for (const i of get) this.season.transfer(i, this.teamIdx);
    this.trades.push({ day: this.day, team: aiTeam, give: [...give], get: [...get] });
  }

  // ---- 오프시즌

  /** 시즌이 끝났으면 결산하고 오프시즌을 연다 */
  beginOffseason(): void {
    if (this.phase !== 'season' || !this.done) throw new Error('정규시즌이 끝나야 오프시즌을 열 수 있습니다');
    this.dispatchOff({ year: this.year, type: 'begin-off', enlist: this.enlistOptions().chosen });
  }

  // ---- 입대 선택 (시즌이 끝난 뒤, 결산 때 입대)

  /**
   * 우리 구단 입대 후보와 추천·지금 고른 명단. 기여는 지금 능력 기준 (결산의 성장 판정 전).
   * 시즌 중 트레이드로 바뀐 소속은 월드에서 읽는다 (리그 상태는 결산 때 반영된다).
   */
  enlistOptions(): { cands: EnlistCandidate[]; recommended: string[]; chosen: string[] } {
    const L = this.league;
    const teamOf = new Map(this.world.players.map((p) => [p.id, p.teamIdx]));
    const now = { ...L, players: L.players.map((p) => (teamOf.has(p.id) ? { ...p, team: teamOf.get(p.id)! } : p)) };
    const ctx = this.values;
    const cands = enlistCandidates(now, this.teamIdx, this.year, (p) => runsNow(p, ctx, this.year));
    const recommended = aiEnlistPicks(L, this.year, cands);
    return { cands, recommended, chosen: this.enlistChoice ? normalizeEnlist(cands, this.enlistChoice) : recommended };
  }

  /** 입대 명단을 고른다 (null = 추천대로). 강제 입대는 늘 포함되고, 그 밖에는 상한까지만 남는다 */
  setEnlist(ids: string[] | null): string[] {
    if (this.phase !== 'season' || !this.done) throw new Error('입대 선택은 정규시즌이 끝난 뒤 결산 전에 합니다');
    this.enlistChoice = ids === null ? null : normalizeEnlist(this.enlistOptions().cands, ids);
    return this.enlistOptions().chosen;
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
        // 재정 결산: 선수 소속이 결산으로 바뀌기 전에 (트레이드는 기록으로 따라간다)
        const fin = settleSeason({
          league: L, world: this.world, season: this.season, trades: this.tradeMoves(),
          postseason: this.postseason!.series.flatMap((x) => x.games), standings, champion: ps.champion ?? null,
          postseasonDepth: (t) => (ps.seeds.includes(t) ? 1 + ps.series.filter((x) => x.winner === t).length : 0),
          trust: (t) => (t === this.teamIdx ? this.owner.trust : 50),
        });
        this.finishedLeague = clone(L);
        const prevStandings = L.lastSeason?.standings ?? null;
        this.offseason = Off.beginOffseason(L, this.world, this.season, this.store, this.teamIdx, this.params, a.enlist);
        this.enlistChoice = null;
        L.lastSeason!.postseason = ps;
        this.evaluateOwner(standings, ps, prevStandings, fin[this.teamIdx]);
        // 기사: 우승·MVP (articles.ts)
        {
          const champ = ps.champion ?? null;
          if (champ !== null) {
            const t = this.world.teams[champ];
            addArticle(L, { year: this.year, day: -1, kind: 'title', franchise: t.franchise, title: `${t.name}, ${this.year} 한국시리즈 우승`,
              body: `${josa(t.name, '이', '가')} 한국시리즈에서 ${josa(this.world.teams[ps.runnerUp].name, '을', '를')} 꺾고 ${this.year} 시즌 정상에 올랐다.` });
          }
          const aw = L.awards?.find((a) => a.year === this.year);
          if (aw?.mvp) {
            const t = this.world.teams[aw.mvp.team];
            addArticle(L, { year: this.year, day: -1, kind: 'award', franchise: t?.franchise, title: `${this.year} MVP ${aw.mvp.name}`, body: `${t?.name ?? ''} ${aw.mvp.name}: ${aw.mvp.line}.` });
          }
        }
        // 연표 (history.ts)
        recordYear(L, this.year, this.world.teams, this.season.teams, standings, ps.champion ?? null, ps.runnerUp ?? null);
        recordSeasonBests(L, this.year, this.world.gamesPerTeam, this.world.players.map((p) => ({
          id: p.id, name: p.name, team: this.world.teams[p.teamIdx].name,
          bat: this.season.bat[p.idx].pa > 0 ? Object.values(this.season.bat[p.idx]) : undefined,
          pit: this.season.pit[p.idx].bf > 0 ? Object.values(this.season.pit[p.idx]) : undefined,
        })));
        // 역사 시나리오 판정 (scenarios.ts)
        const was = L.scenario?.result;
        const sc = judgeScenario(L, this.year, ps.champion ?? null);
        const def = sc ? scenarioById(sc.id) : undefined;
        if (sc && def && !was && sc.result) {
          this.news.push({ year: this.year, day: -1, kind: 'owner', text: sc.result === 'success'
            ? `역사 시나리오 「${def.title}」 성공! ${def.year} 한국시리즈 우승으로 역사를 바꿨습니다. (${def.real})`
            : `역사 시나리오 「${def.title}」 실패. ${def.real} 이 게임은 그대로 이어서 할 수 있습니다.` });
          addArticle(L, { year: this.year, day: -1, kind: 'scenario', franchise: this.team.franchise,
            title: `「${def.title}」 ${sc.result === 'success' ? '성공' : '실패'}`,
            body: sc.result === 'success' ? `${josa(this.team.name, '이', '가')} ${def.year} 한국시리즈 우승으로 역사를 바꿨다. ${def.real}` : `${def.real}` });
        }
        this.phase = 'offseason';
        this.valueCtx = null;
        this.offVersion++;
        this.offNews(0);
        this.actions.push(clone(a));
        this.awardNews();
        this.addOffNews(`${this.year} 오프시즌 시작. FA 신청 ${this.offseason.fa.entries.length}명.`);
        return res;
      }
      case 'open': {
        if (!off || off.stage !== 'ready') return { ok: false, message: '오프시즌 단계를 모두 마쳐야 개막할 수 있습니다.' };
        const changes = off.changes ?? [];
        Off.closeOffseason(L, off);
        this.postseason = null;
        this.hallOfFameAndFarewells(L.year - 1);
        const sanctions = applyCapSanctions(L, L.year);
        this.offseason = null;
        this.finishedLeague = null;
        this.phase = 'season';
        this.world = worldFromLeague(clone(L), this.store, this.params);
        this.season = Season.start(this.world, this.params, seasonSeed(L), { boxTeams: [this.teamIdx] });
        this.trades = [];
        this.lastCallUps = new Set();
        this.valueCtx = null;
        this.startEntry();
        for (const c of changes) this.addNews(0, 'season', `${L.year} 시즌: ${changeText(c)}.`);
        // 창단 구단: 1군 진입 2년 전 창단해 1년 동안 퓨처스리그를 뛴다 (2026-10-11)
        for (const e of L.expansions ?? []) {
          const name = L.teams[e.team].name;
          if (e.firstYear === L.year) this.addNews(0, 'season', `${L.year} 시즌: ${name} 1군 진입.`);
          else if (e.firstYear === L.year + 1) this.addNews(0, 'season', `${L.year} 시즌: ${name} 창단, 올해는 퓨처스리그에서 뛰고 ${e.firstYear}년 1군에 들어옵니다.`);
        }
        this.actions.push(clone(a));
        this.addNews(0, 'season', `${this.year} 시즌을 시작합니다. 개막일은 ${formatDate(this.year, 0)}입니다.`);
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
        this.setSeasonGoal();
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
      case 'salary-offer': res = Off.setSalaryOffer(off, a.id, a.amount); break;
      case 'comp-protect': res = Off.setProtectByUser(L, off, a.fa, a.ids); break;
      case 'comp-pick': res = Off.pickCompByUser(L, off, a.fa, a.pick); break;
      case 'comp-auto': Off.autoCompUser(L, off, this.store, this.params); break;
      case 'invest': res = setInvest(L, this.teamIdx, a.kind, a.level); break;
      case 'legend': res = this.applyLegend(a.id); break;
      case 'release': res = Off.releaseByUser(L, off, a.id); break;
      case 'release-auto': Off.autoReleaseUser(L, off, this.store, this.params); break;
      case 'claim': res = Off.claimByUser(L, off, a.id); break;
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
    const { achieved, delta } = trustDelta(goal.kind, outcome);
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
    for (const id of newAchievements(o, prevLast)) {
      o.achievements.push({ id, year: this.year, team });
      say(`업적 달성: ${ACHIEVEMENTS[id].label} (${ACHIEVEMENTS[id].note})`);
    }
    if (o.trust < FIRE_BELOW) {
      o.firedYears.push(this.year);
      o.offers = offersFor(standings, team);
      say(`해고되었습니다. 신뢰도 ${o.trust}. 영입 제의: ${o.offers.map((t) => L.teams[t].name).join(', ')}. 구단 화면에서 고르세요.`);
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
    const st: ArticleState = { year, base, prev: new Map(), records, broken: new Set(), streak: this.world.teams.map(() => 0), logIdx: 0 };
    // 지금까지(불러오기·재현) 이미 지난 일은 기사를 다시 내지 않는다
    for (const p of this.world.players) st.prev.set(p.id, this.totalNow(st, p.idx, p.id));
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
      const team = this.world.teams[p.teamIdx];
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
    return this.trades.map((t) => ({ day: t.day, from: this.teamIdx, to: t.team, give: t.give.map((i) => W[i].id), get: t.get.map((i) => W[i].id) }));
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
  setInvest(kind: InvestKind, level: number) { return this.dispatchOff({ year: this.year, type: 'invest', kind, level }); }
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
  nextStage() { return this.dispatchOff({ year: this.year, type: 'next' }); }
  /** 해고된 뒤 영입 제의를 받아들인다 (M7) */
  acceptOffer(team: number) { return this.dispatchOff({ year: this.year, type: 'accept-offer', team }); }
  /** 오프시즌을 끝내고 다음 시즌을 연다 (환경 맞춤 때문에 1초 안팎 걸린다) */
  openNextSeason() { return this.dispatchOff({ year: this.year, type: 'open' }); }

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
    };
    if (this.phase === 'offseason') {
      return { ...base, phase: 'offseason', league: clone(this.league), finishedLeague: clone(this.finishedLeague!), offseason: clone(this.offseason!) };
    }
    return { ...base, phase: 'season', league: clone(this.league), ...(this.enlistChoice ? { enlistChoice: [...this.enlistChoice] } : {}) };
  }
}

/** TeamSeason의 1군 전체 (야수 + 선발 + 구원) */
export function activeOf(ts: TeamSeason): SimPlayer[] {
  return [...ts.hitters, ...ts.rotation, ...ts.bullpen];
}
