// 한 시즌 시뮬레이션: 일정 생성 → 매일 엔트리 점검 → 경기 → 기록·순위 집계.
// Season은 하루씩 진행할 수 있고, 진행 중 상태를 저장(toSave)했다가 같은 위치에서 이어갈 수 있다(restore).
// 저장 후 이어서 돌린 결과는 끊지 않고 돌린 결과와 같다 (테스트로 확인).

import type { Rates } from '../data/types';
import type { BallTally } from './battedball';
import { emptyLeagueCounters, simulateGame, type GameCommand, type GameContext, type GameResult, type GameSub, type LeagueCounters, type Play, type RunTally } from './game';
import { drawInjury, injuryChance, injuryProneness, pickEvent, type Absence } from './injury';
import { injuryScale } from './traits';
import { AUTO_IBB_YEAR, eraPitching } from './eras';
import { chainShapeFor, type EngineParams } from './params';
import { chainResolver, type PaResolver } from './resolver';
import { managerNorms } from './manager';
import { sbShiftOf } from './rules';
import { Rng } from './rng';
import { planForWorld, type PlanCancel, type PlanGame, type SchedulePlan } from './schedule';
import { knownSchedule, type KnownSchedule } from './weather';
import { CHURN_DAYS, currentBody, currentOveruse, newPlayerStates, refreshActive, slumpingPitchers, todaysLineup, todaysStarter, unitHash, type DepthPlan, type PlayerStates, type TeamSeason } from './team';
import { emptyBatLine, emptyPitLine, emptyTeamRecord, type BatLine, type PitLine, type SimPlayer, type TeamRecord, type World } from './types';

/** 그날 치르는 경기 한 건 (engine/schedule.ts PlanGame) */
export type ScheduledGame = PlanGame;

/** 시즌이 쓰는 일정 (일정 개편 기획안 3.4). 시즌 저장에 그대로 들어간다 */
export type SeasonPlan = Pick<SchedulePlan, 'opening' | 'days' | 'planned' | 'cancels' | 'remainingFrom' | 'held'>;

/** 저장한 일정. 경기는 [홈, 원정, 더블헤더 차전, 경기 중 비 회] (없는 값은 0, 뒤쪽 0은 줄인다) */
export interface SavedSchedule {
  opening: string;
  days: number[][][];
  planned: number[][][];
  cancels: PlanCancel[];
  remainingFrom: number;
  /** 옮긴 날을 잔여 경기 발표 때 알리는 취소 (cancels 색인) */
  held?: number[];
}

function packGame(g: PlanGame): number[] {
  const a = [g.home, g.away, g.dh ?? 0, g.rainInning ?? 0];
  while (a.length > 2 && a[a.length - 1] === 0) a.pop();
  return a;
}

function unpackGame(a: number[]): PlanGame {
  return { home: a[0], away: a[1], ...(a[2] ? { dh: a[2] as 1 | 2 } : {}), ...(a[3] ? { rainInning: a[3] } : {}) };
}

export function packSchedule(p: SeasonPlan): SavedSchedule {
  return {
    opening: p.opening, days: p.days.map((d) => d.map(packGame)), planned: p.planned.map((d) => d.map(packGame)),
    cancels: p.cancels.map((c) => [...c] as PlanCancel), remainingFrom: p.remainingFrom, held: [...p.held],
  };
}

export function unpackSchedule(s: SavedSchedule): SeasonPlan {
  return {
    opening: s.opening, days: s.days.map((d) => d.map(unpackGame)), planned: s.planned.map((d) => d.map(unpackGame)),
    cancels: s.cancels.map((c) => [...c] as PlanCancel), remainingFrom: s.remainingFrom, held: [...(s.held ?? [])],
  };
}

/** 시범 경기 한쪽 (Season.playExhibition): 야수 9명 이상, 투수 첫 번째가 선발 */
export interface ExhibitionSide {
  name: string;
  hitters: SimPlayer[];
  pitchers: SimPlayer[];
  closer: SimPlayer | null;
}

export interface SeasonResult {
  seed: string;
  year: number;
  cal: Rates;
  bat: BatLine[];
  pit: PitLine[];
  teams: TeamRecord[];
  totals: LeagueCounters;
  /** 승률 순 팀 색인 */
  standings: number[];
}

export interface SeasonOptions {
  /** 환경 맞춤 계수를 직접 줄 때 (예비 시즌을 건너뜀) */
  cal?: Rates;
}

/** 치른 경기 한 건 */
export interface GameLog {
  day: number;
  home: number;
  away: number;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  /** 승리·패전·세이브 투수 색인 */
  win: number | null;
  loss: number | null;
  save: number | null;
  /** 더블헤더 몇 차전 (일정 개편 9단계). 더블헤더가 아니면 없다 */
  dh?: 1 | 2;
  /** 경기 중 비로 멈춘 경기 (일정 개편 10단계): 강우 콜드(innings = 멈춘 회). 노게임은 log에 없고 Season.noGames에만 */
  rain?: 'cold' | 'nogame';
}

export interface BoxBatter {
  idx: number;
  /** 경기 중 교체로 들어온 타자 (2026-10-12부터. 예전 박스스코어에는 없다). DEF 대수비는 엔진 2 9단계부터 */
  sub?: 'PH' | 'PR' | 'DEF';
  /** 타순 (1~9). 교체 타자는 바꾼 선수의 타순 */
  order?: number;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  hr: number;
  bb: number;
  so: number;
}

export interface BoxPitcher {
  idx: number;
  outs: number;
  bf: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  /** 투구 수 (엔진 2) */
  np: number;
}

export interface BoxSide {
  batters: BoxBatter[];
  pitchers: BoxPitcher[];
}

/** 박스스코어. 타자는 타순, 투수는 등판 순 */
export interface BoxScore {
  /** 이닝별 득점. 치르지 않은 말 공격은 -1 */
  lineScore: { away: number[]; home: number[] };
  home: BoxSide;
  away: BoxSide;
}

const UNIT: Rates = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const BAT_KEYS = Object.keys(emptyBatLine()) as (keyof BatLine)[];
const PIT_KEYS = Object.keys(emptyPitLine()) as (keyof PitLine)[];

/** 메모리에 남기는 중계 기록 경기 수 */
export const PLAYS_KEEP = 32;

export function winPct(t: TeamRecord): number {
  return t.w + t.l > 0 ? t.w / (t.w + t.l) : 0;
}

/** 승률 순 팀 색인 (같으면 승수, 그다음 색인 순) */
export function rankTeams(teams: TeamRecord[]): number[] {
  return teams.map((_, i) => i).sort((x, y) => winPct(teams[y]) - winPct(teams[x]) || teams[y].w - teams[x].w || x - y);
}

/** 리그 하나의 순위 (Season.divisionStandings). teams는 1위부터 */
export interface DivisionTable {
  name: string;
  teams: number[];
}

/**
 * 양대 리그 해(1999·2000)의 순위 (일정 개편 기획안 10.4). ids를 승률 순으로 놓고, 승률이 같은 구단끼리는
 * ① 그 구단들 사이 상대 전적 다승 → ② 그 구단들 사이 맞대결 득점 → ③ 전년도 순위(prev에 없으면 뒤, 그다음 색인).
 * 셋 이상이 같으면 묶음 전체의 맞대결로 한 번에 가린다 (갈린 뒤 남은 구단끼리 다시 세지 않는다, 임시 규칙).
 * 상대 전적·득점은 경기 기록(log)에서 센다. 난수를 쓰지 않는다
 */
export function rankWithTiebreak(ids: number[], teams: TeamRecord[], log: readonly GameLog[], prev: readonly number[] = []): number[] {
  const byPct = [...ids].sort((x, y) => winPct(teams[y]) - winPct(teams[x]) || x - y);
  const prevAt = (t: number) => { const k = prev.indexOf(t); return k >= 0 ? k : prev.length + t; };
  const out: number[] = [];
  for (let i = 0; i < byPct.length;) {
    let j = i + 1;
    while (j < byPct.length && winPct(teams[byPct[j]]) === winPct(teams[byPct[i]])) j++;
    const group = byPct.slice(i, j);
    if (group.length > 1) {
      const inGroup = new Set(group);
      const wins = new Map(group.map((t) => [t, 0]));
      const runs = new Map(group.map((t) => [t, 0]));
      for (const g of log) {
        if (!inGroup.has(g.home) || !inGroup.has(g.away)) continue;
        runs.set(g.home, runs.get(g.home)! + g.homeRuns);
        runs.set(g.away, runs.get(g.away)! + g.awayRuns);
        if (g.homeRuns > g.awayRuns) wins.set(g.home, wins.get(g.home)! + 1);
        else if (g.awayRuns > g.homeRuns) wins.set(g.away, wins.get(g.away)! + 1);
      }
      group.sort((x, y) => wins.get(y)! - wins.get(x)! || runs.get(y)! - runs.get(x)! || prevAt(x) - prevAt(y));
    }
    out.push(...group);
    i = j;
  }
  return out;
}

interface FixedAbsence {
  p: number;
  team: number;
  until: number;
}

/** 시즌 저장 형식 2(일정 개편 전)를 거절하는 문구 (일정 개편 기획안 6.1) */
export const OLD_SCHEDULE_SAVE = '일정 개편 이전 저장이라 쓸 수 없습니다 (정규시즌 일정이 바뀌어 이어 할 수 없음)';
/** 지금 시즌 저장 형식. 이보다 낮은 저장은 불러오지 않는다 (브라우저 정리 기준, game/storage.ts) */
export const SEASON_SAVE_FORMAT = 3;

/** 진행 중 시즌의 저장 형태 (JSON으로 그대로 쓸 수 있다) */
export interface SeasonSave {
  /** 수비수별 실책 (예전 저장에는 없다) */
  errors?: number[];
  /** 3: 일정 개편 (연전 일정을 저장에 넣음, 2026-10-23). 2: 엔진 2 (경기마다 따로 난수 줄기, 2026-10-22). 1·2는 불러오지 않는다 */
  format: 3;
  /** 이 시즌의 일정 (일정 개편 기획안 6.1). 불러올 때 다시 만들지 않고 이것을 쓴다 */
  schedule: SavedSchedule;
  seed: string;
  year: number;
  /** 월드의 선수 구성 지문. 데이터가 바뀌면 선수 색인이 어긋나므로 불러오기를 막는다 */
  roster: string;
  cal: Rates;
  day: number;
  rngDays: number;
  absentUntil: number[];
  fatigue: number[];
  fatigueDay: number[];
  /** 연투 일수 (2026-10-08 추가, 예전 저장에는 없다) */
  streak?: number[];
  lastStartDay: number[];
  /** 선수별 기록. 필드 순서는 emptyBatLine / emptyPitLine의 키 순서 */
  bat: number[][];
  pit: number[][];
  teams: TeamRecord[];
  totals: LeagueCounters;
  log: GameLog[];
  boxes: [number, BoxScore][];
  boxTeams: number[];
  manual: (number[] | null)[];
  fixedAbsence: [number, FixedAbsence[]][];
  /** 시즌 중 이적: [날짜, 선수 색인, 새 구단 색인]. 불러올 때 이 순서대로 다시 적용한다 */
  transfers?: [number, number, number][];
  /** 선수별 1군 등록 경기일 수 (FA 연차 산정용) */
  activeDays?: number[];
  /** 직접 관리 1군에서 말소된 날 (선수 색인별, 없으면 −1). 2026-10-11 추가 */
  demotedDay?: number[];
  /** 부상·이탈 기록 (M6) */
  absences?: Absence[];
  /** 이탈 이벤트 난수 위치 (M6) */
  rngEvents?: number;
  /** 구단별 기용표 (선수 색인) */
  plans?: (DepthPlan | null)[];
  /** 엔트리 순환 대상 부진 투수: [순환 주기, 선수 색인들]. 2026-10-21 추가, 예전 저장에는 없다 (불러온 날 기록으로 다시 정한다) */
  slump?: [number, number[]];
  /** 혹사지수(fatigueDay에 기록한 값), 야수 피로와 그 날짜 (엔진 2 11단계, 예전 저장에는 없다: 0) */
  overuse?: number[];
  body?: number[];
  bodyDay?: number[];
  /** 숨은 능력 시드 (리그 시드, 엔진 2 11단계). 없으면 시즌 시드 */
  hiddenSeed?: string;
}

/** 월드의 선수 구성 지문 (FNV-1a) */
export function rosterFingerprint(world: World): string {
  let h = 2166136261 >>> 0;
  const s = `${world.year}|${world.players.map((p) => `${p.id}@${p.teamIdx}`).join(',')}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${world.players.length}-${(h >>> 0).toString(16)}`;
}

export interface SeasonInit {
  /** 박스스코어를 남길 팀 색인 (보통 플레이어 구단). 기본은 남기지 않음 */
  boxTeams?: number[];
  /** 타석 해결기. 기본은 볼카운트 사슬 B1 (params.chainShape) */
  resolver?: PaResolver;
  /** 인플레이 타구 집계 (검증 도구용). 저장하지 않는다 */
  balls?: BallTally;
  /** 주루·작전 집계 (검증 도구용, 엔진 2 8단계). 저장하지 않는다 */
  running?: RunTally;
  /** 일정을 밖에서 줄 때 (저장에서 불러오기). 없으면 월드와 시드로 만든다 (engine/schedule.ts planForWorld) */
  plan?: SeasonPlan;
  /** 좌우 4칸 타석 결과 집계 (검증 도구용, 엔진 2 9단계). 저장하지 않는다 */
  splits?: GameContext['splits'];
  /** AI 감독 2 집계 (검증 도구용, 엔진 2 10단계). 저장하지 않는다 */
  pen?: GameContext['pen'];
  /**
   * 숨은 능력 시드 (엔진 2 11단계): 실제 한계 투구 수 배율을 `${hiddenSeed}/hidden/${선수 ID}/realLimit` 해시로 정한다.
   * 리그 시드를 넘기면 같은 리그는 해마다 같은 값이다. 없으면 시즌 시드 (저장에 들어간다)
   */
  hiddenSeed?: string;
}

export class Season {
  readonly world: World;
  readonly params: EngineParams;
  readonly seed: string;
  readonly cal: Rates;
  /** 이 시즌의 일정 (개막일, 날짜별 경기, 발표한 일정, 우천 취소). 시즌 중에 바뀌지 않는다 */
  readonly plan: SeasonPlan;
  /** 날짜별 경기 (plan.days). 빈 배열은 경기 없는 날 (월요일·쉬는 기간) */
  readonly schedule: ScheduledGame[][];
  /** 다음에 치를 날짜 (일정 색인) */
  day = 0;
  readonly states: PlayerStates;
  readonly bat: BatLine[];
  readonly pit: PitLine[];
  /** 수비수별 실책 (선수 색인, 정규시즌. 2026-10-13) */
  readonly errors: number[];
  readonly teams: TeamRecord[];
  readonly totals: LeagueCounters;
  readonly teamSeasons: TeamSeason[];
  readonly log: GameLog[] = [];
  /**
   * 노게임이 된 경기 (일정 개편 10단계): 순위·기록에 넣지 않고 다시 치른다 (일정의 cancels). 저장하지 않는다:
   * 그날 직접 지휘 미리보기가 점수·중계를 보여 줄 때만 쓴다. 일정 쪽 사실(어느 경기가 몇 회 노게임인지)은 plan에 있다
   */
  readonly noGames: (GameLog & { plays?: Play[] })[] = [];
  /** 경기 로그 색인 → 박스스코어 */
  readonly boxes = new Map<number, BoxScore>();
  /** 박스스코어 구단 경기의 중계 기록 (경기 로그 색인 → 기록). 저장하지 않고 최근 PLAYS_KEEP경기만 메모리에 둔다 */
  readonly plays = new Map<number, Play[]>();
  /** 직접 지휘 (경기 개입): 있으면 그 구단 경기에 건다. 저장하지 않는다 (조작 기록이 다시 채운다) */
  commander: GameCommand | null = null;
  readonly boxTeams: Set<number>;
  private dayRng: Rng;
  /** 정규시즌 경기 난수의 뿌리. 경기마다 여기서 따로 줄기를 갈라 쓴다 (gameRng) */
  private readonly gamesRoot: Rng;
  /** 이탈 이벤트 난수. 부상·경기 난수와 따로 둔다 */
  private eventRng: Rng;
  private ctx: GameContext;
  /** 이번 시즌 부상·이탈 기록 (발생 순) */
  readonly absences: Absence[] = [];
  private fixedAbsence = new Map<number, FixedAbsence[]>();
  /** 이적 전 월드의 선수 구성 지문 (저장 호환 확인용) */
  readonly baseRoster: string;
  readonly transfers: [number, number, number][] = [];
  /** 선수별로 1군에 등록돼 있던 경기일 수 (자기 팀 경기가 있는 날만 센다) */
  readonly activeDays: Int32Array;
  /** 직접 관리 1군에서 마지막으로 말소된 날 (−1 = 없음) */
  readonly demotedDay: Int32Array;
  /** 엔트리 순환 대상인 부진한 투수: 순환 주기(slumpCycle)가 시작할 때 기록으로 정해 그 주기 동안 그대로 쓴다 (저장에 넣는다) */
  private slump: Uint8Array | null = null;
  private slumpCycle = -1;
  /** 숨은 능력 시드 (SeasonInit.hiddenSeed) */
  readonly hiddenSeed: string;

  /** rng는 시즌의 뿌리 난수. 일정·결장·경기 난수를 여기서 갈라 쓴다 */
  constructor(world: World, params: EngineParams, rng: Rng, cal: Rates, init: SeasonInit = {}) {
    this.world = world;
    this.params = params;
    this.seed = rng.seed;
    this.cal = cal;
    this.baseRoster = rosterFingerprint(world);
    const n = world.players.length;
    this.states = newPlayerStates(n);
    this.activeDays = new Int32Array(n);
    this.demotedDay = new Int32Array(n).fill(-1);
    this.bat = Array.from({ length: n }, emptyBatLine);
    this.pit = Array.from({ length: n }, emptyPitLine);
    this.errors = new Array(n).fill(0);
    this.teams = world.teams.map(emptyTeamRecord);
    this.totals = emptyLeagueCounters();
    this.boxTeams = new Set(init.boxTeams ?? []);
    this.teamSeasons = world.teams.map((team) => ({
      team, hitters: [], rotation: [], bullpen: [], closer: null, nextReturnDay: 0, dirty: true, manual: null, callUps: [],
    }));
    this.plan = init.plan ?? planForWorld(world, rng);
    this.schedule = this.plan.days;
    this.dayRng = rng.fork('days');
    this.eventRng = rng.fork('events');
    this.gamesRoot = rng.fork('games');
    this.ctx = {
      league: world.league, env: world.env, cal, params, maxInnings: world.rules.maxInnings, day: 0, rng: this.gamesRoot,
      states: this.states, bat: this.bat, pit: this.pit, totals: this.totals, startLimitScale: eraPitching(world.year).limitScale,
      errors: this.errors, resolver: init.resolver ?? chainResolver(chainShapeFor(params, world.year)), balls: init.balls, running: init.running, splits: init.splits, pen: init.pen,
      autoIbb: world.year >= AUTO_IBB_YEAR,
    };
    this.ctx.planNorms = managerNorms(world.players, this.ctx);
    this.ctx.sbShift = sbShiftOf(world.players, world.env);
    // 실제 한계 투구 수 배율 (기획안 4.6, 엔진 2 11단계): 리그 시드·선수 ID 해시로 [1 − realSpread, 1 + realSpread] 고르게. 난수를 쓰지 않는다.
    // 저장·짐작 문구·리그 상태 보관은 16단계 (숨은 능력)
    this.hiddenSeed = init.hiddenSeed ?? this.seed;
    const ou = params.injury.overuse;
    if (ou.on && ou.realSpread > 0) {
      const scale = new Float32Array(n);
      for (const p of world.players) scale[p.idx] = 1 + ou.realSpread * (2 * unitHash(`${this.hiddenSeed}/hidden/${p.id}/realLimit`) - 1);
      this.ctx.realLimitScale = scale;
    }
    // 지난 시즌에서 넘어온 혹사지수 (league/offseason.ts). 개막일(0)에 기록한 값으로 둔다
    for (const p of world.players) {
      if (!p.overuseStart) continue;
      this.states.overuse[p.idx] = p.overuseStart;
      this.states.recoverMul[p.idx] = 1 / (1 + ou.recovery * this.states.overuse[p.idx]);
    }

    // 개막부터 결장하는 선수 (지난 시즌에서 넘어온 부상, 병역 복귀 전). 난수를 쓰지 않는다
    for (const p of world.players) if (p.startAbsent && p.startAbsent > 0) this.states.absentUntil[p.idx] = p.startAbsent;
    // 출전 가능 비율이 지정된 선수: 시즌 중 한 구간을 통째로 비운다
    for (const p of world.players) {
      if (p.availability === undefined || p.availability >= 0.97) continue;
      const miss = Math.round((1 - Math.max(0, p.availability)) * this.schedule.length);
      const start = this.dayRng.int(this.schedule.length - miss + 1);
      const list = this.fixedAbsence.get(start) ?? [];
      list.push({ p: p.idx, team: p.teamIdx, until: start + miss });
      this.fixedAbsence.set(start, list);
    }
  }

  /** 환경 맞춤부터 해서 새 시즌을 연다 (simulateSeason과 같은 시드 규칙) */
  static start(world: World, params: EngineParams, seed: string | number, opts: SeasonOptions & SeasonInit = {}): Season {
    const rng = new Rng(seed);
    const cal = opts.cal ?? (params.pilotSeasons > 0 ? calibrate(world, params, rng.fork('pilot')) : { ...UNIT });
    return new Season(world, params, rng, cal, opts);
  }

  get done(): boolean {
    return this.day >= this.schedule.length;
  }

  /** 통합 순위 (승률 순 팀 색인). 양대 리그 해는 동률 규칙(rankWithTiebreak)으로, 다른 해는 rankTeams */
  standings(): number[] {
    if (!this.world.divisions) return rankTeams(this.teams);
    return rankWithTiebreak(this.teams.map((_, i) => i), this.teams, this.log, this.world.prevStandings);
  }

  /** 리그별 순위 (양대 리그 해, 기획안 10.4). 단일 리그 해는 null */
  divisionStandings(): DivisionTable[] | null {
    const d = this.world.divisions;
    if (!d) return null;
    return d.names.map((name, k) => ({ name, teams: rankWithTiebreak(d.teams[k], this.teams, this.log, this.world.prevStandings) }));
  }

  /** 플레이어의 기용표를 바꾼다. null이면 AI 감독에게 맡긴다. 직접 정한 1군(manual)일 때만 쓰인다 */
  /**
   * day날 아침에 알려진 일정 (기획안 4.5). 화면은 앞날 일정을 이것으로만 본다:
   * 지난 날은 실제 일정, day부터는 발표 일정 + day까지의 우천 취소·순연 (+ 발표 뒤 잔여 경기). 앞날의 취소와 경기 중 비 회는 없다
   */
  knownSchedule(day = this.day): KnownSchedule {
    return knownSchedule(this.plan, day);
  }

  setPlan(teamIdx: number, plan: DepthPlan | null): void {
    const ts = this.teamSeasons[teamIdx];
    ts.plan = plan ? { starters: { ...plan.starters }, rotation: [...plan.rotation], closer: plan.closer, ...(plan.order ? { order: [...plan.order] } : {}), ...(plan.pen ? { pen: { ...plan.pen } } : {}) } : null;
    ts.dirty = true;
  }

  /** 플레이어가 정한 1군 명단을 바꾼다. null이면 AI에게 맡긴다 */
  setManualEntry(teamIdx: number, idxs: Iterable<number> | null): void {
    const ts = this.teamSeasons[teamIdx];
    const next = idxs ? new Set(idxs) : null;
    // 직접 관리하는 1군에서 빠진 선수는 말소한 날을 남긴다 (10일 재등록 제한, game/session.ts)
    if (ts.manual && next) for (const i of ts.manual) if (!next.has(i)) this.demotedDay[i] = this.day;
    ts.manual = next;
    ts.dirty = true;
  }

  /**
   * 선수를 다른 구단으로 옮긴다 (트레이드). world의 구단 소속을 바꾸므로 이 월드를 다른 시즌과 함께 쓰지 않는다.
   * 시즌 기록은 선수에게 그대로 남는다. 새 구단이 직접 관리하는 구단이면 2군으로 들어간다.
   */
  /**
   * 선수를 다른 구단으로 옮긴다. toTeam = -1이면 방출(어느 명단에도 없다, formerTeam에 마지막 소속),
   * 지금 -1인 선수(방출 선수·시즌 중 시장의 선수)를 구단으로 옮기면 영입 (league/market.ts)
   */
  transfer(playerIdx: number, toTeam: number): void {
    const p = this.world.players[playerIdx];
    const from = p.teamIdx;
    if (from === toTeam) return;
    if (toTeam !== -1 && !this.world.teams[toTeam]) throw new Error(`구단 색인이 잘못됐습니다: ${toTeam}`);
    if (from >= 0) {
      const src = this.world.teams[from].org;
      src.splice(src.indexOf(p), 1);
      this.teamSeasons[from].manual?.delete(playerIdx);
      const plan = this.teamSeasons[from].plan;
      if (plan) {
        for (const k of Object.keys(plan.starters) as (keyof DepthPlan['starters'])[]) if (plan.starters[k] === playerIdx) delete plan.starters[k];
        plan.rotation = plan.rotation.filter((i) => i !== playerIdx);
        if (plan.closer === playerIdx) plan.closer = null;
        if (plan.pen) delete plan.pen[playerIdx];
      }
      this.teamSeasons[from].dirty = true;
    }
    if (toTeam >= 0) {
      this.world.teams[toTeam].org.push(p);
      this.teamSeasons[toTeam].dirty = true;
      delete p.formerTeam;
    } else if (from >= 0) p.formerTeam = from;
    p.teamIdx = toTeam;
    this.transfers.push([this.day, playerIdx, toTeam]);
  }

  /** 그날 순환 주기의 부진한 투수 (EngineParams.churnSlump이 없으면 null = 모든 국내 투수가 순환 대상) */
  private slumpOn(day: number): Uint8Array | null {
    const rule = this.params.churnSlump;
    if (!rule || !(this.params.rosterChurn ?? 0)) return null;
    const cycle = Math.floor(day / CHURN_DAYS);
    if (cycle !== this.slumpCycle || !this.slump) {
      this.slump = slumpingPitchers(this.world, this.pit, rule);
      this.slumpCycle = cycle;
    }
    return this.slump;
  }

  /** 다음 경기일 기준으로 1군을 다시 짠다 (화면에 현재 1군을 보여줄 때). 난수를 쓰지 않으므로 결과에 영향이 없다 */
  refresh(teamIdx: number, day = this.day): TeamSeason {
    const ts = this.teamSeasons[teamIdx];
    refreshActive(ts, this.world, this.states, day, this.params.rosterChurn ?? 0, this.params.rosterJitter ?? 0, this.slumpOn(day));
    return ts;
  }

  /** 하루를 진행한다. 끝난 시즌이면 아무것도 하지 않는다 */
  simulateDay(): void {
    if (this.done) return;
    const { world, params, states, ctx, dayRng } = this;
    const day = this.day;
    const games = this.schedule[day];
    const season = this.teamSeasons;
    ctx.day = day;

    for (const a of this.fixedAbsence.get(day) ?? []) {
      states.absentUntil[a.p] = a.until;
      season[a.team].dirty = true;
    }
    // 부상과 이탈 이벤트 (injury.ts). 부상은 하루·선수당 난수 한 번, 이벤트는 따로 둔 난수에서.
    // 최근 1군 경기에 나온 선수(야수 3일·투수 7일 안, 저장되는 상태로 판정해 화면 조회·저장과 상관없다)는 경기 중 부상(game.ts)이
    // 몫을 나눠 맡아 경기 전 확률이 inGame.preShare배.
    // 투수는 혹사지수만큼 확률이 오르고(1 + overuse.injury × 혹사지수), 그 더해진 몫에서 생긴 부상은 혹사 부상으로 표시한다
    if (games.length) {
      const ip = params.injury;
      const ou = ip.overuse;
      const perTeam = world.gamesPerTeam;
      for (const ts of season) {
        const played = this.teams[ts.team.idx].g;
        for (const p of ts.team.org) {
          const active = p.isPitcher ? states.streak[p.idx] > 0 && day - states.fatigueDay[p.idx] <= 7 : day - states.bodyDay[p.idx] <= 3;
          if (p.availability !== undefined || states.absentUntil[p.idx] > day) continue;
          const base = injuryChance(p, this.pit[p.idx], played, perTeam, ip) * injuryScale(p, params.traits) * (ts.team.injuryRate ?? 1)
            * injuryProneness(p) * (active ? ip.inGame.preShare : 1);
          const extra = ou.on && p.isPitcher ? base * ou.injury * currentOveruse(states, p.idx, day, ou) : 0;
          const u = dayRng.next();
          if (u < base + extra) {
            const inj = drawInjury(dayRng, ip, p.isPitcher);
            const days = ts.team.injuryDays ? Math.max(1, Math.round(inj.days * ts.team.injuryDays)) : inj.days;
            this.addAbsence({ day, idx: p.idx, until: day + days, kind: inj.kind, part: inj.part, ...(u >= base ? { overuse: true as const } : {}) }, ts);
          } else if (this.eventRng.chance(ip.eventChance)) {
            const ev = pickEvent(p, this.eventRng, ip);
            this.addAbsence({ day, idx: p.idx, until: day + ev.days, kind: 'event', event: ev.event }, ts);
          }
        }
      }
    }
    // 방위병이 있는 구단은 홈·원정이 바뀌는 날 엔트리를 다시 짠다 (없는 구단은 away 값만 바뀌고 결과는 같다)
    for (const g of games) {
      for (const [t, away] of [[g.home, false], [g.away, true]] as const) {
        const ts = season[t];
        if (ts.away !== away && ts.team.org.some((p) => p.homeOnlyUntil !== undefined && p.homeOnlyUntil > day)) ts.dirty = true;
        ts.away = away;
      }
    }
    for (const ts of season) if (ts.dirty || day >= ts.nextReturnDay) refreshActive(ts, world, states, day, params.rosterChurn ?? 0, params.rosterJitter ?? 0, this.slumpOn(day));
    // 1군 연차는 경기가 있는 날을 하루로 센다 (더블헤더 날도 하루)
    for (const t of new Set(games.flatMap((g) => [g.home, g.away]))) {
      const ts = season[t];
      for (const p of ts.hitters) this.activeDays[p.idx]++;
      for (const p of ts.rotation) this.activeDays[p.idx]++;
      for (const p of ts.bullpen) this.activeDays[p.idx]++;
    }

    // 더블헤더 날은 1차전 묶음을 모두 치른 뒤 2차전 묶음 (일정 개편 기획안 4.6). 2차전 전에 두 팀 엔트리를 다시 짠다:
    // 1차전 부상(경기 중 부상은 다음 날부터가 아니라 그날 2차전부터 빠진다)·피로를 본다. 1차전 선발은 lastStartDay가 오늘이라 2차전에 못 나오고,
    // 같은 날 두 번 던진 투수·뛴 야수의 피로는 회복 없이 쌓인다 (fatigueDay·bodyDay가 같은 날)
    const second = games.filter((g) => g.dh === 2);
    const order = second.length ? [...games.filter((g) => g.dh !== 2), ...second] : games;
    for (const g of order) {
      if (g === second[0]) {
        for (const x of second) for (const t of [x.home, x.away]) refreshActive(season[t], world, states, day, params.rosterChurn ?? 0, params.rosterJitter ?? 0, this.slumpOn(day));
      }
      const h = season[g.home];
      const a = season[g.away];
      // 선발 투수를 먼저 정한다 (난수를 쓰지 않는다): 라인업이 상대 선발의 손을 본다 (플래툰, 엔진 2 9단계)
      const homeStarter = todaysStarter(h, states, day, params);
      const awayStarter = todaysStarter(a, states, day, params);
      // 야수 휴식은 경기 전 피로로 (엔진 2 11단계)
      const tired = (p: SimPlayer) => currentBody(states, p.idx, day, params.body);
      // 2차전 라인업(주전 휴식)은 그 경기 줄기에서 갈라 쓴다: 1차전 결과(피로·부상)에 따라 뽑는 횟수가 달라져도
      // 그날 뒤에 오는 다른 경기의 하루 난수(dayRng)를 밀지 않는다 (tests/engine2-rng.test.ts)
      const lineupRng = g.dh === 2 ? this.gameRng(day, g).fork('lineup') : dayRng;
      const homeLineup = todaysLineup(h, world.league, params, lineupRng, awayStarter.throws, tired);
      const awayLineup = todaysLineup(a, world.league, params, lineupRng, homeStarter.throws, tired);
      const wantBox = this.boxTeams.has(g.home) || this.boxTeams.has(g.away);
      const pitBefore = wantBox ? this.snapshotPitchers([h, a]) : null;
      // 경기 전 타격 기록: 선발 라인업과 벤치(대타·대주자로 나올 수 있는 1군 야수) 모두
      const batBefore = wantBox ? new Map([...homeLineup, ...awayLineup, ...h.hitters, ...a.hitters].map((p) => [p.idx, { ...this.bat[p.idx] }])) : null;
      ctx.plays = wantBox ? [] : null;
      ctx.command = this.commander && (g.home === this.commander.team || g.away === this.commander.team) ? this.commander : null;
      ctx.rng = this.gameRng(day, g);
      ctx.injuries = [];
      ctx.dh = g.dh;
      ctx.rainInning = g.rainInning;
      const res = simulateGame(h, a, homeLineup, awayLineup, homeStarter, awayStarter, ctx);
      const plays = ctx.plays;
      ctx.plays = null;
      ctx.command = null;
      ctx.dh = undefined;
      ctx.rainInning = undefined;
      // 경기 중 부상 (엔진 2 11단계): 다음 날부터 결장. 구단 의료 투자의 기간 배율은 경기 전 부상과 같다
      for (const inj of ctx.injuries) {
        const ts = season[world.players[inj.idx].teamIdx];
        const days = ts.team.injuryDays ? Math.max(1, Math.round(inj.days * ts.team.injuryDays)) : inj.days;
        this.addAbsence({
          day, idx: inj.idx, until: day + 1 + days, kind: inj.kind, part: inj.part, cause: inj.cause, ...(inj.overuse ? { overuse: true as const } : {}),
        }, ts);
      }
      ctx.injuries = undefined;
      // 노게임: 피로·부상만 남고 순위·기록·경기 기록(log)에는 없다. 다시 치르는 경기는 개막 때 일정에 들어가 있다 (weather.ts)
      if (res.rain === 'nogame') {
        this.noGames.push({
          day, home: g.home, away: g.away, homeRuns: res.homeRuns, awayRuns: res.awayRuns, innings: res.innings,
          win: null, loss: null, save: null, ...(g.dh ? { dh: g.dh } : {}), rain: 'nogame', ...(plays ? { plays } : {}),
        });
        continue;
      }
      const ht = this.teams[g.home];
      const at = this.teams[g.away];
      ht.g++; at.g++;
      ht.rs += res.homeRuns; ht.ra += res.awayRuns;
      at.rs += res.awayRuns; at.ra += res.homeRuns;
      if (res.homeRuns > res.awayRuns) { ht.w++; at.l++; ht.homeW++; }
      else if (res.homeRuns < res.awayRuns) { at.w++; ht.l++; ht.homeL++; }
      else { ht.t++; at.t++; ht.homeT++; }
      this.log.push({
        day, home: g.home, away: g.away, homeRuns: res.homeRuns, awayRuns: res.awayRuns, innings: res.innings,
        win: res.win, loss: res.loss, save: res.save, ...(g.dh ? { dh: g.dh } : {}), ...(res.rain ? { rain: res.rain } : {}),
      });
      if (pitBefore && batBefore) {
        const line = (idx: number): BoxBatter => {
          const now = this.bat[idx];
          const was = batBefore.get(idx)!;
          return {
            idx, ab: now.ab - was.ab, r: now.r - was.r, h: now.h - was.h, rbi: now.rbi - was.rbi, hr: now.hr - was.hr,
            bb: now.bb - was.bb, so: now.so - was.so,
          };
        };
        // 타순대로, 교체로 들어온 타자는 그 타순의 선수 바로 아래에
        const boxBat = (lineup: SimPlayer[], subs: GameSub[]): BoxBatter[] => lineup.flatMap((p, i) => [
          { ...line(p.idx), order: i + 1 },
          ...subs.filter((s) => s.order === i && batBefore.has(s.idx)).map((s) => ({ ...line(s.idx), order: i + 1, sub: s.kind })),
        ]);
        const boxPit = (staff: number[]): BoxPitcher[] => staff.map((idx) => {
          const now = this.pit[idx];
          const was = pitBefore.get(idx)!;
          return {
            idx, outs: now.outs - was.outs, bf: now.bf - was.bf, h: now.h - was.h, r: now.r - was.r, er: now.er - was.er,
            bb: now.bb - was.bb, so: now.so - was.so, hr: now.hr - was.hr, np: now.np - was.np,
          };
        });
        if (plays) {
          this.plays.set(this.log.length - 1, plays);
          for (const k of this.plays.keys()) if (this.plays.size > PLAYS_KEEP) this.plays.delete(k);
        }
        this.boxes.set(this.log.length - 1, {
          lineScore: res.lineScore,
          home: { batters: boxBat(homeLineup, res.homeSubs), pitchers: boxPit(res.homeStaff) },
          away: { batters: boxBat(awayLineup, res.awaySubs), pitchers: boxPit(res.awayStaff) },
        });
      }
    }
    this.day++;
  }

  /**
   * 정규시즌 경기 하나의 난수 줄기 (docs/경기엔진2_기획안.md 3.7.1). 날짜와 대진으로만 정해지므로
   * 한 경기의 난수 소비가 그날 다른 경기나 다음 날 경기에 영향을 주지 않고, 저장에 경기 난수 위치가 필요 없다
   */
  gameRng(day: number, g: ScheduledGame): Rng {
    // 더블헤더 2차전은 /2를 붙인다 (1차전과 한 경기 날의 키는 그대로, 일정 개편 기획안 1장)
    return this.gamesRoot.fork(`g/${day}/${g.home}-${g.away}${g.dh === 2 ? '/2' : ''}`);
  }

  /** 그 선수를 until 전날까지 쉬게 한다 (무작위 이벤트의 휴식 처방). 부상 기록에는 남기지 않는다 */
  restPlayer(idx: number, until: number): void {
    if (this.states.absentUntil[idx] >= until) return;
    this.states.absentUntil[idx] = until;
    const ts = this.teamSeasons[this.world.players[idx].teamIdx];
    if (ts) ts.dirty = true;
  }

  /** 투수 피로를 없앤다 (무작위 이벤트의 휴식 처방) */
  clearFatigue(idx: number): void {
    this.states.fatigue[idx] = 0;
    this.states.streak[idx] = 0;
  }

  /** 오늘부터 쓸 선수별 컨디션 (무작위 이벤트 효과). null이면 없앤다. 저장하지 않는다: 세션이 날마다 리그 상태에서 다시 만든다 */
  setForm(form: Float64Array | null): void {
    this.ctx.form = form ?? undefined;
  }

  private addAbsence(a: Absence, ts: TeamSeason): void {
    this.states.absentUntil[a.idx] = a.until;
    this.absences.push(a);
    ts.dirty = true;
  }

  /**
   * 시즌이 끝난 뒤 경기 하나 (포스트시즌). 정규시즌 기록·순위·경기 로그에는 남기지 않고, 주어진 기록 배열(rec)에만 쌓는다.
   * 1군은 그날 기준으로 다시 짜고(부상 선수는 계속 빠진다), 주전 휴식은 없다. 난수는 넘겨받은 rng만 쓴다.
   */
  playExtraGame(home: number, away: number, day: number, rng: Rng, maxInnings: number,
                rec: { bat: BatLine[]; pit: PitLine[]; totals: LeagueCounters },
                command: GameCommand | null = null): { result: GameResult; home: SimPlayer[]; away: SimPlayer[]; plays?: Play[] } {
    const params = { ...this.params, restChance: 0, catcherRestChance: 0 };
    const plays = this.boxTeams.has(home) || this.boxTeams.has(away) ? [] as Play[] : null;
    // 직접 지휘 (2026-10-12 가을야구까지): 우리 경기에만
    const cmd = command && (command.team === home || command.team === away) ? command : null;
    const ctx: GameContext = { ...this.ctx, params, day, rng, maxInnings, bat: rec.bat, pit: rec.pit, totals: rec.totals, postseason: true, plays, command: cmd, injuries: undefined };
    const h = this.teamSeasons[home];
    const a = this.teamSeasons[away];
    h.away = false;
    a.away = true;
    refreshActive(h, this.world, this.states, day, this.params.rosterChurn ?? 0, this.params.rosterJitter ?? 0, this.slumpOn(day));
    refreshActive(a, this.world, this.states, day, this.params.rosterChurn ?? 0, this.params.rosterJitter ?? 0, this.slumpOn(day));
    const hs = todaysStarter(h, this.states, day, params);
    const as = todaysStarter(a, this.states, day, params);
    const hl = todaysLineup(h, this.world.league, params, rng, as.throws);
    const al = todaysLineup(a, this.world.league, params, rng, hs.throws);
    const result = simulateGame(h, a, hl, al, hs, as, ctx);
    return { result, home: hl, away: al, ...(plays ? { plays } : {}) };
  }

  /**
   * 시즌과 따로 도는 시범 경기 (올스타전, league/allstar.ts). 정규시즌 기록·선수 상태·난수에 손대지 않는다:
   * 피로·결장 없는 새 상태로 치르고, 기록은 새 배열에 쌓아 돌려준다. 투수는 hook(선발 한계 배율)만큼 일찍 바꾼다.
   */
  playExhibition(home: ExhibitionSide, away: ExhibitionSide, rng: Rng, hook = 0.3): { result: GameResult; home: SimPlayer[]; away: SimPlayer[]; bat: BatLine[]; pit: PitLine[] } {
    const n = this.world.players.length;
    const bat = Array.from({ length: n }, emptyBatLine);
    const pit = Array.from({ length: n }, emptyPitLine);
    const params = { ...this.params, restChance: 0, catcherRestChance: 0 };
    const ctx: GameContext = {
      ...this.ctx, params, rng, bat, pit, totals: emptyLeagueCounters(), states: newPlayerStates(n),
      plays: null, command: null, form: undefined, errors: undefined, balls: undefined, running: undefined, postseason: false, injuries: undefined,
    };
    const side = (s: ExhibitionSide, idx: number): TeamSeason => ({
      team: { idx, name: s.name, franchise: s.name, org: [...s.hitters, ...s.pitchers] },
      hitters: s.hitters, rotation: s.pitchers.slice(0, 1), bullpen: s.pitchers.slice(1), closer: s.closer,
      nextReturnDay: 0, dirty: false, tactics: { steal: 1, bunt: 0.3, hook },
    });
    const h = side(home, -2);
    const a = side(away, -3);
    const hl = todaysLineup(h, this.world.league, params, rng, away.pitchers[0].throws);
    const al = todaysLineup(a, this.world.league, params, rng, home.pitchers[0].throws);
    const result = simulateGame(h, a, hl, al, home.pitchers[0], away.pitchers[0], ctx);
    return { result, home: hl, away: al, bat, pit };
  }

  private snapshotPitchers(sides: TeamSeason[]): Map<number, PitLine> {
    const m = new Map<number, PitLine>();
    // 이도류 타자(반대쪽 투구 능력이 있는 선수)도 던질 수 있다 (league/twoway.ts)
    for (const ts of sides) for (const p of ts.team.org) if (p.isPitcher || p.alt?.pit) m.set(p.idx, { ...this.pit[p.idx] });
    return m;
  }

  runToEnd(): void {
    while (!this.done) this.simulateDay();
  }

  result(): SeasonResult {
    return {
      seed: this.seed, year: this.world.year, cal: this.cal, bat: this.bat, pit: this.pit, teams: this.teams, totals: this.totals,
      standings: this.standings(),
    };
  }

  toSave(): SeasonSave {
    const st = this.states;
    return {
      format: 3,
      schedule: packSchedule(this.plan),
      seed: this.seed,
      year: this.world.year,
      roster: this.baseRoster,
      cal: { ...this.cal },
      day: this.day,
      rngDays: this.dayRng.state(),
      absentUntil: Array.from(st.absentUntil),
      fatigue: Array.from(st.fatigue),
      fatigueDay: Array.from(st.fatigueDay),
      streak: Array.from(st.streak),
      lastStartDay: Array.from(st.lastStartDay),
      bat: this.bat.map((b) => BAT_KEYS.map((k) => b[k])),
      pit: this.pit.map((p) => PIT_KEYS.map((k) => p[k])),
      errors: [...this.errors],
      teams: this.teams.map((t) => ({ ...t })),
      totals: { ...this.totals },
      log: this.log.map((g) => ({ ...g })),
      boxes: [...this.boxes.entries()],
      boxTeams: [...this.boxTeams],
      manual: this.teamSeasons.map((ts) => (ts.manual ? [...ts.manual] : null)),
      fixedAbsence: [...this.fixedAbsence.entries()],
      transfers: this.transfers.map((t) => [...t] as [number, number, number]),
      activeDays: Array.from(this.activeDays),
      demotedDay: Array.from(this.demotedDay),
      absences: this.absences.map((a) => ({ ...a })),
      rngEvents: this.eventRng.state(),
      plans: this.teamSeasons.map((ts) => (ts.plan ? structuredClone(ts.plan) : null)),
      overuse: Array.from(st.overuse),
      body: Array.from(st.body),
      bodyDay: Array.from(st.bodyDay),
      hiddenSeed: this.hiddenSeed,
      ...(this.slump ? { slump: [this.slumpCycle, [...this.slump.keys()].filter((i) => this.slump![i])] as [number, number[]] } : {}),
    };
  }

  /** 저장한 위치에서 시즌을 다시 연다. world는 저장할 때와 같은 데이터·연도로 만든 것이어야 한다 */
  static restore(world: World, params: EngineParams, save: SeasonSave): Season {
    if ((save.format as number) === 1) throw new Error('엔진 2 이전 저장이라 쓸 수 없습니다 (경기 엔진이 바뀌어 이어 할 수 없음)');
    if ((save.format as number) === 2) throw new Error(OLD_SCHEDULE_SAVE);
    if (save.format !== 3) throw new Error(`알 수 없는 저장 형식입니다 (${String(save.format)})`);
    if (save.year !== world.year) throw new Error(`저장한 연도(${save.year})와 월드 연도(${world.year})가 다릅니다`);
    if (save.roster !== rosterFingerprint(world)) {
      throw new Error('게임 데이터가 저장할 때와 달라 이 저장을 이어갈 수 없습니다 (선수 구성이 바뀜)');
    }
    const root = new Rng(save.seed);
    const s = new Season(world, params, root, save.cal, { boxTeams: save.boxTeams, plan: unpackSchedule(save.schedule), hiddenSeed: save.hiddenSeed });
    for (const [d, idx, to] of save.transfers ?? []) {
      s.day = d;
      s.transfer(idx, to);
    }
    s.day = save.day;
    s.dayRng = Rng.fromState(root.fork('days').seed, save.rngDays);
    if (save.rngEvents !== undefined) s.eventRng = Rng.fromState(root.fork('events').seed, save.rngEvents);
    s.absences.push(...(save.absences ?? []).map((a) => ({ ...a })));
    if (save.activeDays) s.activeDays.set(save.activeDays);
    if (save.demotedDay) s.demotedDay.set(save.demotedDay);
    s.states.absentUntil.set(save.absentUntil);
    s.states.fatigue.set(save.fatigue);
    s.states.fatigueDay.set(save.fatigueDay);
    if (save.streak) s.states.streak.set(save.streak);
    if (save.overuse) {
      s.states.overuse.set(save.overuse);
      save.overuse.forEach((v, i) => { s.states.recoverMul[i] = 1 / (1 + params.injury.overuse.recovery * v); });
    }
    if (save.body) s.states.body.set(save.body);
    if (save.bodyDay) s.states.bodyDay.set(save.bodyDay);
    s.states.lastStartDay.set(save.lastStartDay);
    save.bat.forEach((row, i) => BAT_KEYS.forEach((k, j) => { s.bat[i][k] = row[j]; }));
    save.pit.forEach((row, i) => PIT_KEYS.forEach((k, j) => { s.pit[i][k] = row[j] ?? 0; })); // 예전 저장에는 뒤에 붙인 항목(홀드)이 없다
    save.errors?.forEach((v, i) => { if (i < s.errors.length) s.errors[i] = v; }); // 예전 저장에는 없다 (0)
    save.teams.forEach((t, i) => Object.assign(s.teams[i], t));
    Object.assign(s.totals, save.totals);
    s.log.push(...save.log.map((g) => ({ ...g })));
    for (const [k, v] of save.boxes) s.boxes.set(k, v);
    save.manual.forEach((m, i) => { s.teamSeasons[i].manual = m ? new Set(m) : null; });
    (save.plans ?? []).forEach((pl, i) => { s.teamSeasons[i].plan = pl ? structuredClone(pl) : null; });
    s.fixedAbsence = new Map(save.fixedAbsence);
    if (save.slump) {
      s.slump = new Uint8Array(world.players.length);
      for (const i of save.slump[1]) if (i < s.slump.length) s.slump[i] = 1;
      s.slumpCycle = save.slump[0];
    }
    return s;
  }
}

/**
 * 환경 맞춤: 예비 시즌을 돌려 리그 전체 비율이 목표(그 해의 리그 평균)에 오도록 사건별 계수를 구한다.
 * 능력치는 리그 평균 대비 값이라, 누가 얼마나 뛰느냐에 따라 리그 합계가 목표에서 조금씩 벗어나기 때문이다.
 */
export function calibrate(world: World, params: EngineParams, rng: Rng): Rates {
  const cal = { ...UNIT };
  const keys = Object.keys(cal) as (keyof Rates)[];
  for (let round = 0; round < 2; round++) {
    const sum = emptyLeagueCounters();
    for (let i = 0; i < params.pilotSeasons; i++) {
      const pilot = new Season(world, params, rng.fork(`r${round}s${i}`), cal);
      pilot.runToEnd();
      const t = pilot.totals;
      for (const k of Object.keys(sum) as (keyof LeagueCounters)[]) sum[k] += t[k];
    }
    if (sum.pa === 0) break;
    const got: Rates = {
      s1: (sum.h - sum.d - sum.t - sum.hr) / sum.pa, d2: sum.d / sum.pa, t3: sum.t / sum.pa, hr: sum.hr / sum.pa,
      bb: sum.bb / sum.pa, hbp: sum.hbp / sum.pa, so: sum.so / sum.pa,
    };
    for (const k of keys) if (got[k] > 0) cal[k] *= world.league[k] / got[k];
  }
  return cal;
}

export function simulateSeason(world: World, params: EngineParams, seed: string | number, opts: SeasonOptions = {}): SeasonResult {
  const s = Season.start(world, params, seed, opts);
  s.runToEnd();
  return s.result();
}
