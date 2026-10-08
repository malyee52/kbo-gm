// 게임 진행 상태: 리그 상태(여러 해) + 지금 시즌(Season) + 오프시즌 단계, 플레이어 구단의 조작, 알림, 저장.
// 화면에 의존하지 않으므로 Node에서도 그대로 돌릴 수 있다 (시즌 완주·오프시즌 테스트가 이용).
//
// 흐름: 새 게임(createLeague) → 시즌 진행 → 시즌 종료 → beginOffseason(결산) → 오프시즌 단계들 → openNextSeason → 다음 시즌 ...
// 시즌 중 리그 상태는 "그 시즌 개막 때"로 고정되고, 트레이드·기록은 Season이 가진다. 결산 때 리그 상태에 반영한다.

import type { DataStore } from '../data/types';
import {
  DEFAULT_PARAMS, MIN_ACTIVE_HITTERS, MIN_ACTIVE_PITCHERS, Season, todaysStarter,
  type EngineParams, type SeasonSave, type SimPlayer, type TeamSeason, type World,
} from '../engine';
import { coreAge, evaluateTrade, horizonWeights, suggestPackage, tendencyOf, type TeamSituation, type Tendency, type TradeEvaluation } from '../ai/trade';
import { currentRuns, teamStrength, valueContext, type ValueContext } from '../ai/value';
import { createLeague } from '../league/create';
import * as Off from '../league/offseason';
import type { LeaguePlayer, LeagueState } from '../league/types';
import { worldFromLeague } from '../league/world';
import { dateOf, formatDate } from './calendar';

export interface NewGameOptions {
  year: number;
  teamIdx: number;
  seed: string;
}

export type NewsKind = 'absence' | 'return' | 'callup' | 'entry' | 'season' | 'trade' | 'offseason';

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
  | { year?: number; day: number; type: 'trade'; team: number; give: string[]; get: string[] }
  | { year: number; type: 'begin-off' }
  | { year: number; type: 'fa-offer'; id: string; salary: number; years: number }
  | { year: number; type: 'fa-withdraw'; id: string }
  | { year: number; type: 'foreign-keep'; id: string; keep: boolean }
  | { year: number; type: 'foreign-sign'; id: string }
  | { year: number; type: 'draft'; id: string | null }
  | { year: number; type: 'draft-auto' }
  | { year: number; type: 'salary-offer'; id: string; amount: number }
  | { year: number; type: 'release'; id: string }
  | { year: number; type: 'release-auto' }
  | { year: number; type: 'next' }
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
  /** 오프시즌일 때: 막 끝난 시즌을 다시 열기 위한 개막 때 리그 상태 */
  finishedLeague?: LeagueState;
  offseason?: Off.OffseasonState;
  news: NewsItem[];
  actions: GameAction[];
}

export type GameSave = GameSaveV1 | GameSaveV2;

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
  readonly teamIdx: number;
  league: LeagueState;
  /** 지금 시즌의 월드 (오프시즌이면 막 끝난 시즌의 것, 읽기 전용) */
  world: World;
  season: Season;
  phase: 'season' | 'offseason' = 'season';
  offseason: Off.OffseasonState | null = null;
  /** 오프시즌 동안 막 끝난 시즌을 다시 열 수 있게 둔 개막 때 리그 상태 */
  private finishedLeague: LeagueState | null = null;
  readonly news: NewsItem[] = [];
  readonly actions: GameAction[] = [];
  /** 이번 시즌 트레이드 */
  trades: TradeRecord[] = [];
  private lastCallUps = new Set<number>();
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
    const season = Season.start(world, params, seasonSeed(league), { boxTeams: [opts.teamIdx] });
    const g = new GameSession(store, params, opts.teamIdx, league, world, season);
    g.startEntry();
    g.addNews(0, 'season', `${world.year} 시즌 ${world.teams[opts.teamIdx].name} 단장으로 부임했습니다. 개막일은 ${formatDate(world.year, 0)}입니다.`);
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
    if (save.phase === 'offseason') {
      g.offseason = clone(save.offseason!);
      g.finishedLeague = clone(save.finishedLeague!);
    }
    g.news.push(...save.news);
    g.actions.push(...save.actions);
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
    if (end) while (g.phase === 'season' && g.world.year === end.year && g.day < end.day && !g.done) g.advance(1);
    return g;
  }

  private dispatchSeason(a: Extract<GameAction, { day: number }>): void {
    const byId = new Map(this.world.players.map((p) => [p.id, p.idx]));
    const idxs = (ids: string[]) => ids.map((id) => byId.get(id)).filter((x): x is number => x !== undefined);
    if (a.type === 'entry') this.applyEntry(a.ids ? idxs(a.ids) : null);
    else this.applyTrade(a.team, idxs(a.give), idxs(a.get));
    this.actions.push(clone(a));
  }

  get team() {
    return this.world.teams[this.teamIdx];
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

  // ---- 엔트리

  /** 개막 때 1군: AI가 짠 엔트리를 그대로 받아 플레이어가 관리한다 */
  private startEntry(): void {
    const ts = this.season.refresh(this.teamIdx);
    this.season.setManualEntry(this.teamIdx, activeOf(ts).map((p) => p.idx));
  }

  /** 다음 경기일 기준 1군 (엔진이 실제로 쓸 명단). 플레이어가 정한 명단에서 결장 선수는 빠지고 임시 승격 선수가 들어간다 */
  activeTeam(): TeamSeason {
    return this.season.refresh(this.teamIdx);
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
    return this.season.states.absentUntil[p.idx] > this.season.day;
  }

  /** 결장 중이면 복귀하는 날짜 색인, 아니면 null */
  returnDay(p: SimPlayer): number | null {
    const u = this.season.states.absentUntil[p.idx];
    return u > this.season.day ? u : null;
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
    if (this.done) return { errors: ['시즌이 끝났습니다'], warnings: [] };
    const check = idxs ? this.checkEntry(idxs) : { errors: [], warnings: [] };
    if (check.errors.length) return check;
    this.applyEntry(idxs);
    const byIdx = this.world.players;
    this.actions.push({ year: this.year, day: this.day, type: 'entry', ids: idxs ? idxs.map((i) => byIdx[i].id) : null });
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

  // ---- 시즌 진행

  /** days일 진행한다 (시즌이 끝나면 멈춤). 실제로 진행한 날 수를 돌려준다 */
  advance(days: number): number {
    let n = 0;
    while (n < days && this.phase === 'season' && !this.season.done) {
      this.stepDay();
      n++;
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
        // 실존 선수에게는 사유를 붙이지 않는다 (기획서 7장)
        this.addNews(day, 'absence', `${p.name} 결장. 복귀 예정 ${formatDate(year, until)} (${until - day}일).${inFirst && manual ? ' 1군 자리를 비워 두려면 2군으로 내리세요.' : ''}`);
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
    }
  }

  private addNews(day: number, kind: NewsKind, text: string): void {
    this.news.push({ year: this.year, day, kind, text });
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
      ctx.potential = new Map(this.league.players.map((p) => [p.id, p.scoutPotential ?? p.potential]));
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

  /** 트레이드 제안을 AI 구단 입장에서 평가만 한다 */
  evaluateTrade(aiTeam: number, give: SimPlayer[], get: SimPlayer[]): TradeEvaluation {
    const none = { gain: 0, need: 0, before: 0, after: 0, tendency: 'rebuild' as const };
    if (aiTeam === this.teamIdx || !this.world.teams[aiTeam]) return { verdict: 'reject-invalid', message: '상대 구단을 고르세요.', detail: none };
    if (!this.tradeOpen) {
      const why = this.done ? '시즌이 끝났습니다.' : `트레이드 마감(${TRADE_DEADLINE.month}월 ${TRADE_DEADLINE.date}일)이 지났습니다.`;
      return { verdict: 'reject-invalid', message: why, detail: none };
    }
    if (give.some((p) => p.teamIdx !== this.teamIdx)) return { verdict: 'reject-invalid', message: '우리 구단 선수만 내줄 수 있습니다.', detail: none };
    return evaluateTrade({ aiTeam, receive: give, give: get }, this.world.teams[aiTeam].org, this.situation(aiTeam), this.values);
  }

  /** 트레이드를 제안한다. AI가 수락하면 바로 실행한다 */
  proposeTrade(aiTeam: number, give: SimPlayer[], get: SimPlayer[]): TradeEvaluation {
    const ev = this.evaluateTrade(aiTeam, give, get);
    if (ev.verdict !== 'accept') return ev;
    this.applyTrade(aiTeam, give.map((p) => p.idx), get.map((p) => p.idx));
    this.actions.push({ year: this.year, day: this.day, type: 'trade', team: aiTeam, give: give.map((p) => p.id), get: get.map((p) => p.id) });
    const names = (ps: SimPlayer[]) => ps.map((p) => p.name).join(', ') || '없음';
    this.addNews(this.day, 'trade', `트레이드 성사: ${this.world.teams[aiTeam].name}에 ${names(give)}을(를) 내주고 ${names(get)}을(를) 받았습니다. 받은 선수는 2군에 등록됩니다.`);
    return ev;
  }

  /** AI 구단에게 "이 선수를 주려면 무엇을 원하나"를 묻는다. 수락할 만한 조합이 없으면 null */
  askPackage(aiTeam: number, want: SimPlayer[]): SimPlayer[] | null {
    if (!this.tradeOpen || want.length === 0 || want.some((p) => p.teamIdx !== aiTeam)) return null;
    const mine = horizonWeights(this.tendency(this.teamIdx), this.situation(this.teamIdx).remaining);
    return suggestPackage(want, aiTeam, this.world.teams[aiTeam].org, this.team.org, this.situation(aiTeam), this.values, mine);
  }

  private applyTrade(aiTeam: number, give: number[], get: number[]): void {
    for (const i of give) this.season.transfer(i, aiTeam);
    for (const i of get) this.season.transfer(i, this.teamIdx);
    this.trades.push({ day: this.day, team: aiTeam, give: [...give], get: [...get] });
  }

  // ---- 오프시즌

  /** 시즌이 끝났으면 결산하고 오프시즌을 연다 */
  beginOffseason(): void {
    if (this.phase !== 'season' || !this.done) throw new Error('정규시즌이 끝나야 오프시즌을 열 수 있습니다');
    this.dispatchOff({ year: this.year, type: 'begin-off' });
  }

  /** 오프시즌 조작을 적용하고 기록한다. 결과 메시지가 있으면 돌려준다 */
  private dispatchOff(a: OffAction): Off.OfferCheck {
    const L = this.league;
    const off = this.offseason;
    let res: Off.OfferCheck = { ok: true, message: '' };
    const logBefore = off?.log.length ?? 0;
    switch (a.type) {
      case 'begin-off': {
        this.finishedLeague = clone(L);
        this.offseason = Off.beginOffseason(L, this.world, this.season, this.store, this.teamIdx, this.params);
        this.phase = 'offseason';
        this.valueCtx = null;
        this.offVersion++;
        this.offNews(0);
        this.actions.push(clone(a));
        this.addOffNews(`${this.year} 오프시즌 시작. FA 신청 ${this.offseason.fa.entries.length}명.`);
        return res;
      }
      case 'open': {
        if (!off || off.stage !== 'ready') return { ok: false, message: '오프시즌 단계를 모두 마쳐야 개막할 수 있습니다.' };
        Off.closeOffseason(L, off);
        this.offseason = null;
        this.finishedLeague = null;
        this.phase = 'season';
        this.world = worldFromLeague(clone(L), this.store, this.params);
        this.season = Season.start(this.world, this.params, seasonSeed(L), { boxTeams: [this.teamIdx] });
        this.trades = [];
        this.lastCallUps = new Set();
        this.valueCtx = null;
        this.startEntry();
        this.actions.push(clone(a));
        this.addNews(0, 'season', `${this.year} 시즌을 시작합니다. 개막일은 ${formatDate(this.year, 0)}입니다.`);
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
      case 'release': res = Off.releaseByUser(L, off, a.id); break;
      case 'release-auto': Off.autoReleaseUser(L, off, this.store, this.params); break;
      case 'next': {
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
      if (l.mine || (l.stage === 'fa' && l.text.includes('→'))) this.addOffNews(l.text);
    }
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
  release(id: string) { return this.dispatchOff({ year: this.year, type: 'release', id }); }
  autoRelease() { return this.dispatchOff({ year: this.year, type: 'release-auto' }); }
  nextStage() { return this.dispatchOff({ year: this.year, type: 'next' }); }
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
      news: this.news.map((n) => ({ ...n })),
      actions: this.actions.map((a) => clone(a)),
    };
    if (this.phase === 'offseason') {
      return { ...base, phase: 'offseason', league: clone(this.league), finishedLeague: clone(this.finishedLeague!), offseason: clone(this.offseason!) };
    }
    return { ...base, phase: 'season', league: clone(this.league) };
  }
}

/** TeamSeason의 1군 전체 (야수 + 선발 + 구원) */
export function activeOf(ts: TeamSeason): SimPlayer[] {
  return [...ts.hitters, ...ts.rotation, ...ts.bullpen];
}
