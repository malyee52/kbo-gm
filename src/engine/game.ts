// 한 경기 시뮬레이션: 경기 상태(state.ts)를 만들고 반 이닝·타석을 차례로 진행한다.
// 타석은 공통 규칙(감독 판단 manager.ts, 주루·진루 rules.ts)과 해결기(resolver.ts)로 푼다 (docs/경기엔진2_기획안.md 3.2).

import type { PlateContext } from './pa';
import type { Rates } from '../data/types';
import type { BallTally } from './battedball';
import { availableRelievers, bringIn, enterPitcher, maybeChangePitcher, maybeOnePoint, tallySaveEntry, wantInfieldIn, wantIntentionalWalk, type PenTally } from './manager';
import { Ev, paRates, type GamePark, type PaRates } from './pa';
import { gameParkOf } from './park';
import type { EngineParams } from './params';
import { B0, drawInPlay, type PaResolver } from './resolver';
import { End, foldFrom, type SolvedChain } from './chain';
import { applyPitch, drawPitch, newCount, type Count } from './pitch';
import type { Situation } from './traits';
import type { Rng } from './rng';
import { abortPlateAppearance, addPitches, applyPlateAppearance, autoBunt, beginPlateAppearance, buntPitches, manualIntentionalWalk, orderedBunt, orderedSteal, pickoff, steals, stealOne, stealPct, wantPitchout, wildPitch, type RunTally } from './rules';
import { earnsSave, fieldDefense, fielderAt, fieldSlots, GameState, isSaveSituation, substitute, tyingRunNear, type GameSub, type PitcherInGame, type Side } from './state';
import { aiDefense, aiLateDefense, orderedDefSub, pickPinchHitter, pickPinchRunner, replaceInjured } from './subs';
import { currentBody, currentFatigue, currentOveruse, type PlayerStates, type Slot, type TeamSeason } from './team';
import { drawInjury, hitterAgeFactor, injuryProneness, type AbsenceKind, type InjuryCause, type InjuryPart } from './injury';
import { injuryScale } from './traits';
import { isNoGame } from './weather';
import type { BatLine, LeagueEnv, PitLine, SimPlayer } from './types';

export { BUNT_SUCCESS, emptyRunTally, type RunTally } from './rules';
export { bullpenOrder, emptyPenTally, type PenTally } from './manager';
export { errorRateOf, type GameSub } from './state';

/** 시즌 전체 리그 합계 (검증용) */
export interface LeagueCounters {
  games: number;
  ties: number;
  extraInningGames: number;
  homeWins: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  hbp: number;
  so: number;
  r: number;
  er: number;
  outs: number;
  gdp: number;
  sf: number;
  sac: number;
  sb: number;
  cs: number;
  roe: number;
  outsOnBases: number;
  wildPitches: number;
  /** 투구 수 (엔진 2 3단계) */
  pitches: number;
}

export function emptyLeagueCounters(): LeagueCounters {
  return {
    games: 0, ties: 0, extraInningGames: 0, homeWins: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hbp: 0, so: 0,
    r: 0, er: 0, outs: 0, gdp: 0, sf: 0, sac: 0, sb: 0, cs: 0, roe: 0, outsOnBases: 0, wildPitches: 0, pitches: 0,
  };
}

export interface GameContext {
  league: Rates;
  env: LeagueEnv;
  /** 환경 맞춤 계수 (사건별). 타자 쪽 비율에 곱한다 */
  cal: Rates;
  params: EngineParams;
  /** 최대 이닝. 0 = 무제한 (승부가 날 때까지) */
  maxInnings: number;
  /** 시간 제한 흉내 (params.timeLimit의 그 해 값). 없으면 시간 제한 없음 */
  timeLimit?: { from: number; end: number };
  day: number;
  rng: Rng;
  states: PlayerStates;
  bat: BatLine[];
  pit: PitLine[];
  totals: LeagueCounters;
  /** 포스트시즌 경기인가 (숨겨진 특수능력 '가을 사나이'용). 없으면 정규시즌 */
  postseason?: boolean;
  /** 정규시즌 더블헤더 몇 차전 (일정 개편 기획안 4.6). 없으면 더블헤더가 아닌 경기. 더블헤더 이닝 규정은 엔진 2 14단계가 본다 */
  dh?: 1 | 2;
  /** 선발 한계 배율 (시대별, eras.ts). 없으면 1 */
  startLimitScale?: number;
  /** AI 감독의 투구 수 기준 (선발, 구원). 시즌마다 managerNorms로 정한다. 없으면 그 투수의 한계 투구 수(몸 상태 뺀 값) */
  planNorms?: { starter: number; relief: number };
  /** 모든 도루 성공률에 더하는 값 = 그 해 리그 도루 성공률 − 선수 성공률 평균 (sbShiftOf). 없으면 0 */
  sbShift?: number;
  /** 선수별 경기력 (선수 색인, 무작위 이벤트·코치·캠프 효과, league/events.ts). 타자는 +면 유리, 투수는 +면 투수가 유리. 없으면 0 */
  form?: Float64Array;
  /** 선수별 컨디션 사건 값 (선수 색인, 감기·몸살 같은 몸 상태 이벤트, league/events.ts condToday). 흐름(states.cond)에 더한다. 없으면 0 */
  condEvent?: Float64Array;
  /** 있으면 이 경기의 타석·주루·교체를 차례로 남긴다 (중계 화면). 난수를 더 쓰지 않아 결과는 같다 */
  plays?: Play[] | null;
  /** 직접 지휘 (경기 개입): 이 구단의 타석마다 지휘자에게 묻는다. 고른 것이 '자동'이면 AI 감독과 똑같이 진행한다 */
  command?: GameCommand | null;
  /** 수비수별 실책 수 (선수 색인). 없으면 남기지 않는다 */
  errors?: number[];
  /** 인플레이 타구 집계 (검증 도구용, battedball.ts). 없으면 세지 않는다. 난수를 쓰지 않아 결과는 같다 */
  balls?: BallTally;
  /** 주루·작전 집계 (검증 도구용, 엔진 2 8단계) */
  running?: RunTally;
  /** AI 감독 2 집계 (검증 도구용, 엔진 2 10단계): 고의4구·전진 수비·원포인트·세이브 상황 등판과 블론 */
  pen?: PenTally;
  /** 고의4구를 공 없이 하나 (자동 고의4구, eras.ts AUTO_IBB_YEAR 이후). false면 공 4개를 실제로 던진다. 없으면 자동 */
  autoIbb?: boolean;
  /** 좌우 4칸 집계 (엔진 2 9단계 점검 도구만): 'LL'(좌타·좌투) 'LR' 'RL' 'RR' → 타석 결과 수. 양타는 투수 반대 손. 없으면 세지 않는다 */
  splits?: Record<string, Partial<Record<PlayKind, number>>>;
  /** 타석을 끝내는 해결기. 없으면 B0 (엔진 1의 타석 뽑기) */
  resolver?: PaResolver;
  /**
   * 'A'면 타석을 공 하나씩 끝낸다 (A 해결기, pitch.ts, 엔진 2 17단계): 직접 지휘하는 경기와 A 검증. 해결기(B)와 같은 사슬을 쓴다
   * (사슬이 없는 해결기 B0이면 B로). 없으면 B (resolver)
   */
  engine?: 'A';
  /** 있으면 경기 중 부상을 뽑아 여기에 남긴다 (정규시즌, Season이 경기마다 비운다). 없으면 경기 중 부상이 없다 (가을야구·올스타전·시험) */
  injuries?: GameInjury[];
  /** 선수별 실제 한계 투구 수 배율 (선수 색인, 기획안 4.6, Season이 리그 시드로 만든다). 없으면 1 */
  realLimitScale?: Float32Array;
  /** 볼카운트 사슬 능력 (능력치 v2 16-1, Season이 만든다). 있으면 삼진·볼넷·사구와 투구 수를 칸 함수로 낸다. 없으면 예전 길 (결과 비율 → 손잡이 풀기) */
  plate?: PlateContext;
  /**
   * 경기 중 비 (일정 개편 기획안 4.7, 8장 10단계): 이 회(말 공격까지)를 마치고 멈춘다. 5~8회면 강우 콜드(그때 점수로 끝, 기록은 남는다),
   * 1~4회면 노게임(기록·집계를 경기 전으로 되돌리고 피로·부상만 남긴다). 없으면 끝까지 치른다.
   * 임시 단순화: 온 이닝을 마친 뒤에만 멈춘다. 실제 규정의 "5회초 끝에 홈 팀이 앞서면 성립(4.5회)"은 두지 않는다 (2026-10-23 클사장 정함)
   */
  rainInning?: number;
}

/** 경기 중 부상 한 건 (엔진 2 11단계). 다음 날부터 days일 결장 */
export interface GameInjury {
  idx: number;
  cause: InjuryCause;
  /** 혹사로 생긴 부상 (혹사지수로 더해진 몫, 실제 한계를 넘긴 공) */
  overuse?: true;
  kind: Exclude<AbsenceKind, 'event'>;
  days: number;
  part: InjuryPart;
}

/** 직접 지휘하는 구단과 판단 함수 (game/session.ts가 조작 기록·미리보기로 채운다) */
export interface GameCommand {
  team: number;
  decide: (req: CommandRequest) => CommandChoice;
  /**
   * 그날 이 경기를 지휘하나 (더블헤더 차전: 2차전이면 2). 없으면 우리 경기 모두. 지휘하는 경기만 A 해결기로 치르고 묻는다 (엔진 2 17단계):
   * 더블헤더 날 한 차전만 지휘하면 다른 차전은 지휘하지 않은 경기(B)와 같다
   */
  covers?: (dh?: 1 | 2) => boolean;
  /** 그 경기(더블헤더 차전)의 지휘 방식 (엔진 2 18단계). 없거나 undefined면 처음부터 끝까지 지휘한다 (A) */
  mode?: (dh?: 1 | 2) => CommandMode | undefined;
}

/** 한 경기 지휘 방식 (엔진 2 18단계, docs/경기엔진2_기획안.md 3.8) */
export interface CommandMode {
  /**
   * B → A 끼어들기 (위기 멈춤, 기획안 7장 결정 6): 지휘 없이(B, 지휘하지 않은 경기와 똑같이) 시작해 우리 경기의 타석 경계마다 묻고,
   * true인 경계부터 지휘한다 (A, 난수는 경기 줄기의 a@k). k는 타석 경계 번호 (0부터), req.n은 0. 묻기만 하고 난수·상태를 건드리지 않는다
   */
  takeover?: (req: CommandRequest, k: number) => boolean;
  /**
   * A → B 넘기기 ("빠르게 끝내기", 결정 5): 이 물음 번호부터 묻지 않고 남은 경기를 B로 (난수는 경기 줄기의 b@번호).
   * 공 사이 물음이면 그 카운트에서 남은 타석을 접는다 (chain.ts foldFrom)
   */
  handoff?: number;
}

/** 지휘자에게 묻는 순간 (우리 공격 또는 우리 수비의 타석 직전) */
export interface CommandRequest {
  /** 이 경기에서 몇 번째 물음인가 (0부터) */
  n: number;
  side: 'bat' | 'field';
  /**
   * run 주자 작전(투구 전: 대주자·도루·히트앤드런), bat 타격 작전(도루 뒤: 대타·대주자·강공·번트), field 수비(투수·고의4구·전진 수비·피치아웃·대수비),
   * pitch 공 사이 (A 해결기, 공마다: 공격은 대주자·도루·히트앤드런, 수비는 투수 교체·고의4구)
   */
  step: 'run' | 'bat' | 'field' | 'pitch';
  inn: number;
  top: boolean;
  outs: number;
  bases: [number, number, number];
  away: number;
  home: number;
  batter: number;
  /** 다음 타자 (대타 판단용) */
  onDeck: number;
  pitcher: number;
  /** 지금 투수가 상대한 타자 수, 내준 점수, 이 경기 투구 수 */
  pitcherBf: number;
  pitcherRuns: number;
  pitcherPitches: number;
  /** 공 사이 물음(pitch)의 카운트 [볼, 스트라이크]와 이 타석에 던진 공 기호 (pitch.ts PitchCode) */
  count?: [number, number];
  seq?: string;
  /** 우리 라인업 (타순) */
  lineup: number[];
  /** 우리 공격: 대타·대주자로 쓸 수 있는 선수 */
  bench: number[];
  /** 우리 수비: 지금 올릴 수 있는 구원 투수 */
  bullpen: number[];
  /** 우리 수비 물음(field): 대수비로 쓸 수 있는 벤치 야수 */
  fieldBench?: number[];
  /** 우리 수비 물음(field): 라인업 순서대로 수비 자리 (대수비 화면용, 지명타자는 'DH') */
  fieldSlots?: Slot[];
  /** 지금까지의 중계 기록 */
  plays: Play[];
  /** 더블헤더 2차전이면 2 (지휘자가 같은 날 두 경기를 가린다, GameContext.dh). 그 밖에는 없다 */
  dh?: 2;
}

/**
 * 지휘 선택. 항목마다 값이 없으면 자동(그 일은 AI 감독이 한다), 값이 있으면 고른 대로 (엔진 2 17단계 정리: 지휘하는 구단의 대타·대주자·대수비도
 * 그 항목이 자동일 때만 AI 감독이 한다).
 * 주자 작전(run, 1루 주자가 있고 2루가 비었을 때만 묻는다): pr 대주자(null = 대주자 없음), steal go 도루 시도·hold 도루 안 함·hnr 히트앤드런.
 * 타격 작전(bat, 도루가 끝난 뒤): ph 대타(지금 타자 대신, −1 = 대타 없음), pr 대주자, tactic swing 강공(번트 없음)·bunt 희생번트.
 * 수비(field): pitcher 투수 교체, keep 지금 투수 유지(자동 교체 안 함), walk 고의4구(false = 승부), infield 전진 수비(in)·정상(back),
 * pitchout 피치아웃(false = 안 함), def 대수비(out 대신 in, null = 대수비 없음).
 * 공 사이(pitch, A 해결기): 공격은 pr·steal go(앞 주자 도루)·hnr, 수비는 pitcher·walk.
 * (2026-10-12 사용자: 도루는 타석과 별개이고 도루 뒤에 번트도 할 수 있다 → 주자 작전과 타격 작전을 나눴다)
 */
export interface CommandChoice {
  ph?: number;
  pr?: { base: 0 | 1 | 2; idx: number } | null;
  steal?: 'go' | 'hold' | 'hnr';
  /** 'steal'은 예전 기록 호환 (도루 시도로 본다) */
  tactic?: 'swing' | 'steal' | 'bunt';
  pitcher?: number;
  keep?: boolean;
  walk?: boolean;
  infield?: 'in' | 'back';
  pitchout?: boolean;
  def?: { out: number; in: number } | null;
}

/**
 * 중계 기록 한 줄. SO 삼진, BB 볼넷, HBP 몸에 맞는 공, HR·3B·2B·1B 안타, E 실책 출루, GDP 병살, GO 땅볼 아웃, FO 뜬공 아웃,
 * SF 희생플라이, SAC 희생번트, SB 도루, CS 도루 실패, WP 폭투·포일·보크, PC 투수 교체, IBB 고의4구, BF 번트 실패, PH 대타, PR 대주자, DEF 대수비
 */
export type PlayKind = 'SO' | 'BB' | 'HBP' | 'HR' | '3B' | '2B' | '1B' | 'E' | 'GDP' | 'GO' | 'FO' | 'SF' | 'SAC' | 'SB' | 'CS' | 'WP' | 'PO' | 'PC' | 'IBB' | 'BF' | 'PH' | 'PR' | 'DEF';

export interface Play {
  inn: number;
  /** 초(원정 공격) */
  top: boolean;
  kind: PlayKind;
  /** 타자 (도루는 주자, 투수 교체는 −1) */
  bat: number;
  /** 투수 (투수 교체는 새 투수) */
  pit: number;
  /** 플레이 뒤 아웃, 주자(1·2·3루 선수 색인, 없으면 −1), 점수 */
  outs: number;
  bases: [number, number, number];
  away: number;
  home: number;
  /** 이 플레이로 난 점수 */
  runs: number;
  /** 실책(E)을 한 수비수 (선수 색인) */
  fielder?: number;
  /** A 해결기로 끝낸 타석의 공 기호 (pitch.ts PitchCode, 첫 공부터)와 그 뒤 투수의 경기 투구 수 */
  seq?: string;
  np?: number;
}

export interface GameResult {
  homeRuns: number;
  awayRuns: number;
  innings: number;
  /** 승리·패전·세이브 투수의 선수 색인 */
  win: number | null;
  loss: number | null;
  save: number | null;
  /** 이닝별 득점. 치르지 않은 말 공격은 -1 */
  lineScore: { away: number[]; home: number[] };
  /** 등판 순서대로 투수 색인 */
  homeStaff: number[];
  awayStaff: number[];
  /** 경기 중 들어온 대타·대주자 (들어온 순서) */
  homeSubs: GameSub[];
  awaySubs: GameSub[];
  /** 경기 중 비로 멈춘 경기: 강우 콜드(innings = 멈춘 회) 또는 노게임(기록 없음, 승패·세이브 없음) */
  rain?: 'cold' | 'nogame';
}

export function simulateGame(homeTs: TeamSeason, awayTs: TeamSeason, homeLineup: SimPlayer[], awayLineup: SimPlayer[],
                             homeStarter: SimPlayer, awayStarter: SimPlayer, ctx: GameContext): GameResult {
  if (homeLineup.length !== 9 || awayLineup.length !== 9) {
    throw new Error(`라인업은 9명이어야 합니다 (홈 ${homeLineup.length}명, 원정 ${awayLineup.length}명)`);
  }
  // 노게임이 될 경기는 기록·집계를 경기 전 모습으로 잡아 둔다 (온 이닝 끝에서만 멈추므로 점수와 무관하게 미리 안다)
  const noGame = isNoGame(ctx.rainInning);
  const before = noGame ? snapshotRecords(ctx) : null;
  const mkSide = (ts: TeamSeason, lineup: SimPlayer[], starter: SimPlayer, isHome: boolean): Side => {
    const pitcher = enterPitcher(starter, true, 0, ctx);
    // 감독 작전: 선발을 일찍(작으면)·늦게 바꾸는 정도 (league/managers.ts). 난수를 더 쓰지 않는다
    if (ts.tactics) pitcher.plan *= ts.tactics.hook;
    for (const p of lineup) ctx.bat[p.idx].g++;
    const vals = lineup.map((p) => p.value).sort((a, b) => a - b);
    const medianValue = vals[vals.length >> 1] ?? 0;
    const slots = fieldSlots(ts, lineup);
    const defZero = ctx.env.defZero !== undefined ? (ctx.env.defZero - 50) / 2 : 0;
    const fd = fieldDefense(lineup, slots, defZero);
    return {
      ts, lineup: [...lineup], spot: 0, runs: 0, pitcher, staff: [pitcher], usedIdx: new Set([starter.idx]), isHome, medianValue, ...fd, defZero, removed: new Set(), slots, subs: [],
      starters: lineup.map((p) => ({ p, slot: slots.get(p.idx) })),
    };
  };
  const home = mkSide(homeTs, homeLineup, homeStarter, true);
  // 홈 구장 사건별 배율: 실제 구장 표가 있으면 그 배율(좌타·우타 포함), 없으면 득점 계수 f를 지수로 나눈다.
  // 게임 안에서 지은 신구장의 홈런 배율(hr)은 곱한다 (park.ts)
  const park: GamePark = gameParkOf(homeTs.team.park, ctx.params.park);
  const away = mkSide(awayTs, awayLineup, awayStarter, false);
  const st = new GameState(ctx, home, away, park);
  // 지휘 방식 (엔진 2 18단계): 끼어들기면 지휘 없이 B로 시작하고, 넘기기 물음 번호를 잡아 둔다
  const mode = ctx.command?.mode?.(ctx.dh);
  if (mode?.takeover) {
    st.cmdWatch = { cmd: ctx.command!, takeover: mode.takeover, k: 0 };
    ctx.command = null;
    ctx.engine = undefined;
  }
  st.cmdHandoff = mode?.handoff ?? -1;

  let inning = 0;
  const lineScore = { away: [] as number[], home: [] as number[] };
  const tl = ctx.timeLimit;
  let timeRng: Rng | null = null;
  for (;;) {
    inning++;
    const a0 = away.runs;
    playHalf(st, away, home, inning);
    lineScore.away.push(away.runs - a0);
    if (ctx.pen && inning >= 7) ctx.pen.lateRuns += away.runs - a0;
    if (inning >= 9 && home.runs > away.runs) {
      lineScore.home.push(-1);
      break;
    }
    const h0 = home.runs;
    const walkOff = playHalf(st, home, away, inning);
    lineScore.home.push(home.runs - h0);
    if (ctx.pen && inning >= 7) ctx.pen.lateRuns += home.runs - h0;
    if (walkOff) break;
    // 경기 중 비: 그 회를 마치고 멈춘다 (1~8회라 끝내기·9회 판정보다 먼저 온다)
    if (ctx.rainInning && inning >= ctx.rainInning) break;
    if (inning >= 9 && home.runs !== away.runs) break;
    if (ctx.maxInnings > 0 && inning >= ctx.maxInnings) break; // 0 = 무제한 (2008 끝장승부)
    // 시간 제한 흉내: 여기까지 오면 동점이다. 따로 둔 줄기에서만 뽑아 경기 난수 흐름은 그대로다
    if (tl && inning >= tl.from && (timeRng ??= ctx.rng.fork('time')).chance(tl.end)) break;
  }
  if (ctx.running) for (const side of [home, away]) for (const s of side.subs) ctx.running[s.kind === 'PH' ? 'ph' : s.kind === 'PR' ? 'pr' : 'def']++;
  const res = finishGame(st, inning, lineScore);
  if (!ctx.rainInning) return res;
  if (!before) return { ...res, rain: 'cold' };
  // 노게임: 피로·혹사·선발일(finishGame이 states에 남긴 것)과 경기 중 부상(ctx.injuries)은 그대로, 기록·집계만 되돌린다
  restoreRecords(ctx, before);
  return { ...res, win: null, loss: null, save: null, rain: 'nogame' };
}

/** 노게임 때 되돌릴 기록·집계 (선수별 기록은 객체를 그대로 두고 값만 되돌린다: 경기 중 PitcherInGame.line이 같은 객체를 가리킨다) */
interface RecordSnapshot {
  bat: BatLine[];
  pit: PitLine[];
  totals: LeagueCounters;
  errors?: number[];
  tallies: Partial<Pick<GameContext, 'balls' | 'running' | 'pen' | 'splits'>>;
}

const TALLIES = ['balls', 'running', 'pen', 'splits'] as const;

function snapshotRecords(ctx: GameContext): RecordSnapshot {
  const tallies: RecordSnapshot['tallies'] = {};
  for (const k of TALLIES) if (ctx[k]) (tallies as Record<string, unknown>)[k] = structuredClone(ctx[k]);
  return {
    bat: ctx.bat.map((l) => ({ ...l })), pit: ctx.pit.map((l) => ({ ...l })), totals: { ...ctx.totals },
    ...(ctx.errors ? { errors: ctx.errors.slice() } : {}), tallies,
  };
}

function restoreInto(target: object, snap: object): void {
  const t = target as Record<string, unknown>;
  for (const k of Object.keys(t)) if (!(k in snap)) delete t[k];
  Object.assign(t, snap);
}

function restoreRecords(ctx: GameContext, s: RecordSnapshot): void {
  s.bat.forEach((l, i) => Object.assign(ctx.bat[i], l));
  s.pit.forEach((l, i) => Object.assign(ctx.pit[i], l));
  Object.assign(ctx.totals, s.totals);
  if (ctx.errors && s.errors) {
    ctx.errors.length = s.errors.length;
    s.errors.forEach((v, i) => { ctx.errors![i] = v; });
  }
  for (const k of TALLIES) if (ctx[k] && s.tallies[k]) restoreInto(ctx[k]!, s.tallies[k]!);
}

/**
 * 직접 지휘자에게 묻는다. 지휘하지 않는 동안(끼어들기 전, 넘긴 뒤)은 빈 선택(자동).
 * 넘기기 물음 번호(CommandMode.handoff)에 오면 묻지 않고 지휘를 그만둔다: 남은 경기는 B, 난수는 경기 줄기의 b@번호
 */
function ask(st: GameState, side: 'bat' | 'field', step: CommandRequest['step'] = side, cnt?: Count): CommandChoice {
  const { ctx } = st;
  const cmd = ctx.command;
  if (!cmd) return {};
  if (st.cmdN === st.cmdHandoff) {
    ctx.command = null;
    ctx.engine = undefined;
    ctx.rng = ctx.rng.fork(`b@${st.cmdN}`);
    return {};
  }
  return cmd.decide(commandRequest(st, side, step, st.cmdN++, cnt));
}

/** 끼어들기 (CommandMode.takeover): 우리 경기의 타석 경계마다 묻고, 그러자고 하면 그 자리부터 지휘한다 (A, 난수는 경기 줄기의 a@k) */
function checkTakeover(st: GameState): void {
  const w = st.cmdWatch!;
  const { ctx } = st;
  const side = st.bat.ts.team.idx === w.cmd.team ? 'bat' : 'field';
  const k = w.k++;
  if (!w.takeover(commandRequest(st, side, side, st.cmdN), k)) return;
  st.cmdWatch = null;
  ctx.command = w.cmd;
  ctx.engine = 'A';
  ctx.rng = ctx.rng.fork(`a@${k}`);
}

/** 지휘자에게 보이는 지금 상황 (난수·상태를 건드리지 않는다) */
function commandRequest(st: GameState, side: 'bat' | 'field', step: CommandRequest['step'], n: number, cnt?: Count): CommandRequest {
  const { bat, fld, ctx } = st;
  const plays = ctx.plays;
  // 공 사이 물음은 타석을 시작한 뒤라 타순이 이미 다음 타자로 넘어가 있다 (beginPlateAppearance)
  const spot = step === 'pitch' ? (bat.spot + 8) % 9 : bat.spot;
  return {
    n, side, step, inn: st.inning, top: !bat.isHome, outs: st.outs, bases: st.baseIdx(),
    away: st.away.runs, home: st.home.runs, batter: bat.lineup[spot].idx, onDeck: bat.lineup[(spot + 1) % 9].idx,
    pitcher: fld.pitcher.p.idx, pitcherBf: fld.pitcher.bf, pitcherRuns: fld.pitcher.runs, pitcherPitches: fld.pitcher.pitches,
    ...(cnt ? { count: [cnt.b, cnt.s] as [number, number], seq: cnt.seq } : {}),
    lineup: (side === 'bat' ? bat : fld).lineup.map((p) => p.idx),
    bench: side === 'bat' ? bat.ts.hitters.filter((p) => !bat.lineup.includes(p) && !bat.removed.has(p.idx)).map((p) => p.idx) : [],
    bullpen: side === 'field' ? availableRelievers(fld, ctx).map((p) => p.idx) : [],
    ...(side === 'field' && step === 'field' ? { fieldBench: fld.ts.hitters.filter((p) => !p.isPitcher && !fld.lineup.includes(p) && !fld.removed.has(p.idx)).map((p) => p.idx),
      fieldSlots: fld.lineup.map((p) => fld.slots.get(p.idx) ?? 'DH') } : {}),
    plays: plays ? plays.slice() : [],
    ...(ctx.dh === 2 ? { dh: 2 as const } : {}),
  };
}

/** 공격 반 이닝. 끝내기면 true */
function playHalf(st: GameState, bat: Side, fld: Side, inning: number): boolean {
  st.startHalf(bat, fld, inning);
  const { ctx } = st;
  if (ctx.pen && inning >= 7) {
    ctx.pen.lateHalf++;
    ctx.pen.lateLead[Math.max(-4, Math.min(4, fld.runs - bat.runs)) + 4]++;
  }
  const resolver = ctx.resolver ?? B0;
  // AI 감독 수비 교체 (엔진 2 9단계): 대타·대주자 뒤 수비 위치 다시 정하기, 후반 리드 때 대수비.
  // 지휘하는 수비의 대수비는 반 이닝 첫 물음에서 (그 항목이 자동일 때만)
  aiDefense(st, fld, bat, !(ctx.command && fld.ts.team.idx === ctx.command.team));
  let first = true;

  while (st.outs < 3) {
    // 끼어들기·넘기기 (엔진 2 18단계)로 지휘 여부가 경기 중에 바뀐다
    if (st.cmdWatch) checkTakeover(st);
    const cmd = ctx.command;
    // 직접 지휘 (엔진 2 17단계 정리): 물음의 항목마다 '자동'(값 없음)이면 AI 감독이, 고르면 고른 대로 한다 (CommandChoice).
    // 우리 수비면 투수 교체·유지, 고의4구, 전진 수비, 피치아웃, 대수비
    const fcAsk = !!cmd && fld.ts.team.idx === cmd.team;
    const fc = fcAsk ? ask(st, 'field') : null;
    const was = fld.pitcher;
    const next = fc?.pitcher !== undefined ? availableRelievers(fld, ctx).find((p) => p.idx === fc.pitcher) : undefined;
    if (next) bringIn(fld, next, fld.runs - bat.runs, ctx);
    else if (!fc?.keep || fld.pitcher.injured) {
      maybeChangePitcher(fld, bat, inning, st.basesEmpty, first, bat.runs - st.runsAtStart, ctx);
      // 좌우 원포인트 (엔진 2 10단계): 바꾸지 않았으면 좌타 강타자에 좌완 구원
      if (fld.pitcher === was) maybeOnePoint(fld, bat, inning, ctx);
    }
    // 대수비: 지휘하는 수비는 반 이닝 첫 물음의 대수비 항목이 자동일 때만 AI 감독이 한다 (aiDefense에서 미룬 몫)
    if (fcAsk && first && fc!.def === undefined) aiLateDefense(st, fld, bat);
    if (fc?.def) orderedDefSub(st, fld, fc.def.out, fc.def.in);
    pitcherEntered(st, was);
    first = false;
    const ours = !!cmd && bat.ts.team.idx === cmd.team;
    const bench = (idx: number | undefined) => (idx === undefined || idx < 0 ? undefined
      : bat.ts.hitters.find((p) => p.idx === idx && !bat.lineup.includes(p) && !bat.removed.has(p.idx)));
    const pinchRun = (c: CommandChoice | null) => runnerSub(st, c?.pr ?? undefined);

    // AI 감독 대주자·대타 (엔진 2 9단계, subs.ts): 투구 전에. 지휘하는 공격은 아래 물음의 항목이 자동일 때만
    if (!ours) {
      const aiPr = pickPinchRunner(st);
      if (aiPr) pinchRun({ pr: { base: aiPr[0], idx: aiPr[1].idx } });
      const aiPh = pickPinchHitter(st);
      if (aiPh) pinchHit(st, aiPh);
    }

    // 주자 작전 (투구 전, 도루할 수 있을 때만: 1루 주자·2루 빔 또는 2루 주자·3루 빔): 대주자, 도루·히트앤드런
    const rc = ours && ((st.bases[0] && !st.bases[1]) || (st.bases[1] && !st.bases[2])) ? ask(st, 'bat', 'run') : null;
    pinchRun(rc);
    if (rc && rc.pr === undefined) aiPinchRun(st);
    const steal = rc?.steal ?? (rc?.tactic === 'steal' ? 'go' : undefined);
    // 견제사, 피치아웃, 히트앤드런 → 도루 (엔진 2 8단계). 지휘하는 쪽은 고른 대로 (피치아웃은 우리 수비, 히트앤드런은 우리 공격)
    if (pickoff(st)) break;
    const po = fc?.pitchout !== undefined ? fc.pitchout && pitchoutOk(st) : wantPitchout(st);
    if (po) addPitches(ctx, fld.pitcher, 1);
    let going = false;
    if (steal === 'go' && !(st.bases[0] && !st.bases[1])) {
      // 2루 주자의 3루 도루·이중 도루 (지휘). 1루 주자의 2루 도루는 아래 steals (피치아웃과 함께)
      if (orderedSteal(st)) break;
    } else if (steal === 'hnr' ? hnrOk(st) : steal === undefined && hitAndRun(st)) {
      // 타자는 첫 공에 반드시 휘두른다 (피치아웃이면 못 맞힌다): 헛스윙이면 주자는 도루, 파울이면 돌아가고, 인플레이면 그 공으로 타석이 끝난다
      const sw = ctx.params.run.hnrSwing;
      const u = ctx.rng.next() * (sw[0] + sw[1] + sw[2]);
      if (po || u < sw[0]) {
        if (ctx.running) ctx.running.hnrMiss++;
        if (!po) addPitches(ctx, fld.pitcher, 1);
        if (stealOne(st, 0, stealPct(st, st.bases[0]!, false, ctx.params.run.hnrMissPct + (po ? ctx.params.run.pitchoutPct : 0)))) break;
      } else if (u < sw[0] + sw[1]) {
        if (ctx.running) ctx.running.hnrFoul++;
        addPitches(ctx, fld.pitcher, 1);
      } else {
        if (ctx.running) ctx.running.hnrInPlay++;
        going = true;
      }
    } else if (steals(st, steal === 'hnr' ? 'hold' : steal, po)) break;
    if (wildPitch(st)) return true;

    // 타격 작전 (도루가 끝난 뒤): 대타, 대주자, 강공·번트
    const bc = ours ? ask(st, 'bat', 'bat') : null;
    pinchRun(bc);
    if (bc && !rc && bc.pr === undefined) aiPinchRun(st);
    const hitter = bench(bc?.ph);
    if (hitter) pinchHit(st, hitter);
    else if (bc && bc.ph === undefined) {
      const aiPh = pickPinchHitter(st);
      if (aiPh) pinchHit(st, aiPh);
    }
    const tactic = bc?.tactic === 'steal' ? undefined : bc?.tactic;
    // 고의4구 (지휘, 또는 AI 감독 엔진 2 10단계)와 전진 수비. 자동 고의4구 전 시대는 공 4개를 실제로 던진다 (타석이 끝나기 전 폭투로 끝내기면 타석 없음)
    const walk = fc?.walk !== undefined ? fc.walk : !going && wantIntentionalWalk(st);
    st.infieldIn = !walk && (fc?.infield !== undefined ? fc.infield === 'in' && infieldInOk(st) : wantInfieldIn(st));
    if (walk && ctx.autoIbb === false && manualIntentionalWalk(st, fld.pitcher)) return true;

    const { batter, bl, pg } = beginPlateAppearance(st);
    const sit = { runnersOn: !st.basesEmpty, scoring: !!(st.bases[1] || st.bases[2]), late: inning >= 7 && Math.abs(bat.runs - fld.runs) <= 2 };
    // 히트앤드런 첫 공 인플레이: 그 공으로 타석이 끝난다 (그 사이 지휘로 대타·번트·고의4구를 골랐으면 작전은 풀린다)
    if (going && !tactic && !walk && !hitter) {
      const rates = paRates(batter, pg, bat.isHome, ctx, { ...sit, runnersOn: true, scoring: false }, st.park);
      addPitches(ctx, pg, 1);
      const r0 = bat.runs;
      const kind = applyPlateAppearance(st, drawInPlay(rates, ctx.rng), batter, bl, pg, false, rates, st.bases[0] !== null);
      if (ctx.splits) tallySplit(ctx.splits, batter, pg.p, kind);
      st.note(kind, batter.idx, pg.p.idx, r0);
      if (ctx.injuries) inGameInjury(st, batter, pg, kind);
      if (st.walkOff()) return true;
      continue;
    }
    // 지휘한 번트: 2아웃 전, 주자가 있을 때 (3루 주자가 있으면 스퀴즈)
    if (tactic === 'bunt' && st.outs < 2 && !st.basesEmpty && !walk) {
      if (resolver.inPlayPitches) addPitches(ctx, pg, buntPitches(st));
      if (orderedBunt(st, batter, bl, pg)) return true;
      continue;
    }
    // 감독 판단 번트 (희생번트·스퀴즈). 번트 타석 투구 수는 HF 투구 자료 (투구 수를 세지 않는 해결기는 0)
    const bunted = !tactic && !walk ? autoBunt(st, batter, bl, pg) : null;
    if (bunted !== null) {
      if (resolver.inPlayPitches) addPitches(ctx, pg, buntPitches(st));
      if (bunted) return true;
      continue;
    }

    // 고의4구: 공은 위에서 던졌다 (자동 고의4구 시대는 공 없이)
    let ev: Ev;
    let rates: PaRates | null = null;
    let mound = pg;
    let intentional = walk;
    let runnerGoing = false;
    let extra: Pick<Play, 'seq' | 'np'> | undefined;
    if (walk) ev = Ev.BB;
    else {
      rates = paRates(batter, pg, bat.isHome, ctx, sit, st.park);
      const chain = ctx.engine === 'A' ? rates.chain ?? resolver.chainFor?.(rates) : undefined;
      if (chain) {
        // A 해결기 (엔진 2 17단계): 공 하나씩. 지휘하는 경기는 공 사이에 묻는다
        const out = playPitches(st, batter, bl, pg, rates, chain, sit);
        if (out === 'end') break;
        if (out === 'walkoff') return true;
        ({ ev, pg: mound, rates, intentional, going: runnerGoing } = out);
        if (!out.folded) extra = { seq: out.seq, np: mound.pitches };
      } else {
        const res = resolver.resolve(rates, ctx.rng);
        ev = res.ev;
        addPitches(ctx, pg, res.pitches);
      }
    }
    const r0 = bat.runs;
    const kind = applyPlateAppearance(st, ev, batter, bl, mound, intentional, intentional ? null : rates, runnerGoing);
    if (ctx.splits) tallySplit(ctx.splits, batter, mound.p, kind);
    st.note(kind, batter.idx, mound.p.idx, r0, extra);
    if (ctx.injuries) inGameInjury(st, batter, mound, kind);
    if (st.walkOff()) return true;
  }
  return false;
}

/** 투수가 바뀌었으면 등판 기록 (세이브 상황은 등판 때 누상 주자까지 보고 정한다: 4점 이상 리드에 동점 주자가 누상·타석·대기 타석) */
function pitcherEntered(st: GameState, was: PitcherInGame): void {
  const { fld, bat, ctx } = st;
  if (fld.pitcher === was) return;
  const runners = st.bases.filter(Boolean).length;
  fld.pitcher.saveSit = isSaveSituation(fld.pitcher.enteredLead, runners);
  fld.pitcher.tyingNear = tyingRunNear(fld.pitcher.enteredLead, runners);
  fld.pitcher.entryInning = st.inning;
  if (ctx.pen) tallySaveEntry(fld, fld.pitcher, st.inning, runners, ctx);
  if (ctx.plays) st.note('PC', -1, fld.pitcher.p.idx, bat.runs);
}

/** 대주자 (지휘 선택 또는 AI 감독): 그 베이스 주자 대신 벤치 선수 */
function runnerSub(st: GameState, pr: { base: 0 | 1 | 2; idx: number } | undefined): void {
  const { bat, fld, ctx } = st;
  if (!pr) return;
  const runnerIn = bat.ts.hitters.find((p) => p.idx === pr.idx && !bat.lineup.includes(p) && !bat.removed.has(p.idx));
  const old = st.bases[pr.base];
  if (!runnerIn || !old) return;
  const slot = bat.lineup.indexOf(old.p);
  if (slot >= 0) substitute(bat, slot, runnerIn, 'PR');
  else bat.removed.add(old.p.idx);
  st.bases[pr.base] = { p: runnerIn, resp: old.resp, earned: old.earned };
  ctx.bat[runnerIn.idx].g++;
  st.note('PR', runnerIn.idx, fld.pitcher.p.idx, bat.runs);
}

/** AI 감독 대주자 한 번 */
function aiPinchRun(st: GameState): void {
  const aiPr = pickPinchRunner(st);
  if (aiPr) runnerSub(st, { base: aiPr[0], idx: aiPr[1].idx });
}

/** 대타: 지금 타자 대신 */
function pinchHit(st: GameState, hitter: SimPlayer): void {
  const { bat, fld, ctx } = st;
  substitute(bat, bat.spot, hitter, 'PH');
  ctx.bat[hitter.idx].g++;
  st.note('PH', hitter.idx, fld.pitcher.p.idx, bat.runs);
}

/** 플레이어가 고른 히트앤드런을 걸 수 있나 (1루 주자, 2루 빔, 2아웃 전). 걸면 집계 */
function hnrOk(st: GameState): boolean {
  if (!st.bases[0] || st.bases[1] || st.outs >= 2) return false;
  if (st.ctx.running) st.ctx.running.hnr++;
  return true;
}

/** 플레이어가 고른 피치아웃을 할 수 있나 (1루 주자, 2루 빔). 하면 집계 */
function pitchoutOk(st: GameState): boolean {
  if (!st.bases[0] || st.bases[1]) return false;
  if (st.ctx.running) st.ctx.running.pitchout++;
  return true;
}

/** 플레이어가 고른 전진 수비를 할 수 있나 (3루 주자, 2아웃 전) */
function infieldInOk(st: GameState): boolean {
  return !!st.bases[2] && st.outs < 2;
}

/** A 해결기 타석 결과 */
interface PitchOutcome {
  ev: Ev;
  /** 타석을 끝낸 투수 (공 사이 투수 교체가 있으면 새 투수) */
  pg: PitcherInGame;
  rates: PaRates | null;
  intentional: boolean;
  /** 히트앤드런으로 1루 주자가 뛰었다 */
  going: boolean;
  seq: string;
  /** 타석 중간에 B로 넘겨 남은 공을 계산으로 접었다 (공 기호가 모자라 중계에 남기지 않는다) */
  folded?: true;
}

/**
 * A 해결기 한 타석 (엔진 2 17단계, docs/경기엔진2_기획안.md 3.4): 사슬을 공 하나씩 돌린다. 지휘하는 경기는 공마다 우리 쪽에 묻는다
 * ('pitch' 물음: 공격은 대주자·도루·히트앤드런, 수비는 투수 교체·고의4구). AI 감독은 공 사이에 판단하지 않는다 (B와 같은 분포, 3.6.3).
 * 피로는 B처럼 타석을 시작할 때의 확률표(타석 중간 시점의 투구 수)를 끝까지 쓴다. 공 사이 투수 교체만 새 투수의 확률표로 지금 카운트부터 잇는다.
 * 도루 실패로 이닝이 끝나면 'end'(타석은 없던 일), 고의4구 공의 폭투로 끝내기면 'walkoff'
 */
function playPitches(st: GameState, batter: SimPlayer, bl: BatLine, pg0: PitcherInGame, rates0: PaRates, chain0: SolvedChain,
                     sit: Pick<Situation, 'runnersOn' | 'scoring' | 'late'>): PitchOutcome | 'end' | 'walkoff' {
  const { ctx, bat, fld } = st;
  const cmd = ctx.command;
  const asks = !!cmd && (bat.ts.team.idx === cmd.team || fld.ts.team.idx === cmd.team);
  let pg = pg0;
  let rates = rates0;
  let chain = chain0;
  const cnt = newCount();
  const done = (ev: Ev, extra: Partial<PitchOutcome> = {}): PitchOutcome => ({ ev, pg, rates, intentional: false, going: false, seq: cnt.seq, ...extra });
  for (;;) {
    if (asks) {
      const side = bat.ts.team.idx === cmd!.team ? 'bat' : 'field';
      const c = ask(st, side, 'pitch', cnt);
      if (ctx.engine !== 'A') {
        // A → B 넘기기 (엔진 2 18단계): 지금 카운트에서 남은 타석을 계산으로 접는다
        const { end, pitches } = foldFrom(chain, cnt.b, cnt.s, ctx.rng);
        addPitches(ctx, pg, pitches);
        return done(end === End.K ? Ev.SO : end === End.W ? Ev.BB : end === End.H ? Ev.HBP : drawInPlay(rates, ctx.rng), { folded: true });
      }
      if (side === 'field') {
        const next = c.pitcher !== undefined ? availableRelievers(fld, ctx).find((p) => p.idx === c.pitcher) : undefined;
        if (next) {
          // 공 사이 투수 교체: 이 타석은 새 투수 몫 (상대 타자 수를 옮긴다), 지금 카운트부터 새 투수의 확률표로
          const was = fld.pitcher;
          bringIn(fld, next, fld.runs - bat.runs, ctx);
          pitcherEntered(st, was);
          was.bf--;
          was.line.bf--;
          pg = fld.pitcher;
          pg.bf++;
          pg.line.bf++;
          rates = paRates(batter, pg, bat.isHome, ctx, sit, st.park);
          chain = rates.chain ?? ctx.resolver?.chainFor?.(rates) ?? chain;
        }
        if (c.walk) {
          // 공 사이 고의4구: 자동 고의4구 시대는 공 없이, 그 전은 남은 볼을 던진다 (폭투·포일 가능)
          if (ctx.autoIbb === false) {
            const n = 4 - cnt.b;
            if (manualIntentionalWalk(st, pg, n)) { abortPlateAppearance(st, bl, pg); return 'walkoff'; }
            cnt.seq += 'I'.repeat(n);
          }
          return done(Ev.BB, { intentional: true, rates: null });
        }
      } else {
        runnerSub(st, c.pr ?? undefined);
        if (c.steal === 'go') {
          if (orderedSteal(st)) { abortPlateAppearance(st, bl, pg); return 'end'; }
        } else if (c.steal === 'hnr' && hnrOk(st)) {
          // 공 사이 히트앤드런: 타자는 이 공에 반드시 휘두른다 (헛스윙 → 주자 도루, 파울 → 돌아감, 인플레이 → 타석 끝)
          const run = ctx.params.run;
          const sw = run.hnrSwing;
          const u = ctx.rng.next() * (sw[0] + sw[1] + sw[2]);
          addPitches(ctx, pg, 1);
          if (u < sw[0]) {
            if (ctx.running) ctx.running.hnrMiss++;
            cnt.seq += 'S';
            if (stealOne(st, 0, stealPct(st, st.bases[0]!, false, run.hnrMissPct))) { abortPlateAppearance(st, bl, pg); return 'end'; }
            if (++cnt.s === 3) return done(Ev.SO);
          } else if (u < sw[0] + sw[1]) {
            if (ctx.running) ctx.running.hnrFoul++;
            applyPitch(cnt, 'F');
          } else {
            if (ctx.running) ctx.running.hnrInPlay++;
            cnt.seq += 'X';
            return done(drawInPlay(rates, ctx.rng), { going: st.bases[0] !== null });
          }
          continue;
        }
      }
    }
    const code = drawPitch(chain, cnt.b, cnt.s, ctx.rng, rates.called);
    addPitches(ctx, pg, 1);
    const end = applyPitch(cnt, code);
    if (end === null) {
      if (cnt.seq.length > 60) return done(Ev.OUT); // 안전장치 (파울이 끝없이 이어지는 일은 없다)
      continue;
    }
    if (end === End.K) return done(Ev.SO);
    if (end === End.W) return done(Ev.BB);
    if (end === End.H) return done(Ev.HBP);
    return done(drawInPlay(rates, ctx.rng));
  }
}

/** 타자가 1루로 달린 타석 (주루 부상): 홈런·볼넷·삼진 등은 아니다 */
const RAN = new Set<PlayKind>(['1B', '2B', '3B', 'E', 'GDP', 'GO', 'FO', 'SF']);

/** 부상 확률 배율: 특수능력 '철인', 구단 의료 투자, 숨은 능력 '부상 경향' (지금은 1.00) */
function injuryMult(p: SimPlayer, ts: TeamSeason, ctx: GameContext): number {
  return injuryScale(p, ctx.params.traits) * (ts.team.injuryRate ?? 1) * injuryProneness(p);
}

/**
 * 경기 중 부상 (엔진 2 11단계, docs/경기엔진2_기획안.md 3.10·4.6): 타석이 끝날 때 그 경기 난수를 한 번 뽑아 투구·주루·수비 부상을 함께 정한다.
 * 투구: 지난번 판정 뒤 던진 공 수 × inGame.perPitch × (1 + 혹사 배율), 그리고 실제 한계를 넘긴 공 × overuse.overInjury (혹사 부상).
 * 주루: 타자가 1루로 달린 타석. 수비: 인플레이 타구를 맡은 수비수. 다친 투수는 다음 타석 전에, 야수는 바로 바뀐다 (AI 감독).
 * 한 경기에 한 선수는 한 번만 다친다. 정도·부위는 다친 뒤에만 뽑는다
 */
function inGameInjury(st: GameState, batter: SimPlayer, pg: PitcherInGame, kind: PlayKind): void {
  const { ctx, bat, fld } = st;
  const list = ctx.injuries!;
  const ip = ctx.params.injury;
  const g = ip.inGame;
  const o = ip.overuse;
  const n = pg.pitches - pg.injChecked;
  const overN = o.on ? Math.max(0, pg.pitches - Math.max(pg.injChecked, pg.realLimit)) : 0;
  pg.injChecked = pg.pitches;
  const hurt = (p: SimPlayer) => list.some((x) => x.idx === p.idx);
  const mPit = pg.injured || hurt(pg.p) ? 0 : injuryMult(pg.p, fld.ts, ctx);
  const pPit = g.perPitch * n * mPit;
  const pOver = (o.on ? pPit * o.injury * pg.overuse : 0) + o.overInjury * overN * mPit;
  const pRun = RAN.has(kind) && !hurt(batter) ? g.perRun * injuryMult(batter, bat.ts, ctx) * hitterAgeFactor(batter.age) : 0;
  const fIdx = st.ballSlot && kind !== 'HR' ? fielderAt(fld, st.ballSlot) : -1;
  const fielder = fIdx < 0 ? null : fIdx === pg.p.idx ? pg.p : fld.lineup.find((p) => p.idx === fIdx) ?? null;
  const pField = fielder && !hurt(fielder) && !(fielder === pg.p && pg.injured)
    ? g.perField * injuryMult(fielder, fld.ts, ctx) * hitterAgeFactor(fielder.isPitcher ? null : fielder.age) : 0;
  const total = pPit + pOver + pRun + pField;
  if (total <= 0) return;
  const u = ctx.rng.next();
  if (u >= total) return;
  const record = (p: SimPlayer, cause: InjuryCause, overuse: boolean) => {
    const inj = drawInjury(ctx.rng, ip, p.isPitcher, cause);
    list.push({ idx: p.idx, cause, ...(overuse ? { overuse: true as const } : {}), ...inj });
  };
  if (u < pPit + pOver) {
    record(pg.p, 'pitch', u >= pPit);
    pg.injured = true;
  } else if (u < pPit + pOver + pRun) {
    record(batter, 'run', false);
    replaceInjured(st, bat, batter);
  } else if (fielder) {
    record(fielder, 'field', false);
    if (fielder === pg.p) pg.injured = true;
    else replaceInjured(st, fld, fielder);
  }
}

/** 좌우 4칸 집계 한 타석 (점검 도구) */
function tallySplit(splits: NonNullable<GameContext['splits']>, b: SimPlayer, p: SimPlayer, kind: PlayKind): void {
  if (!b.bats || !p.throws) return;
  const key = (b.bats === 'S' ? (p.throws === 'L' ? 'R' : 'L') : b.bats) + p.throws;
  const t = (splits[key] ??= {});
  t[kind] = (t[kind] ?? 0) + 1;
}

/**
 * 히트앤드런 (AI 감독, 엔진 2 8단계): 1루 주자(2루 빔), 2아웃 전, 빠른 주자, 삼진이 적은 타자 (params.run, 임시값). 걸면 true
 */
function hitAndRun(st: GameState): boolean {
  const { bases, bat, ctx } = st;
  const run = ctx.params.run;
  const r1 = bases[0];
  const batter = bat.lineup[bat.spot];
  if (!r1 || bases[1] || st.outs >= 2 || r1.p.bat!.speed < run.hnrSpeed || (batter.bat?.so ?? 1) > run.hnrContact) return false;
  if (!ctx.rng.chance(run.hnr * (bat.ts.tactics?.steal ?? 1))) return false;
  if (ctx.running) ctx.running.hnr++;
  return true;
}

/**
 * 혹사지수 쌓기 (기획안 4.6, 경기 뒤): 오늘까지 빠진 값 + 실제 한계를 넘긴 공 × overPitch + 연투 b2b·3연투 이상 b3b
 * + 선발이 정해진 휴식보다 일찍 나온 날 수 × shortRest. 투구 피로 회복 배율도 새 값으로 (ps.streak은 오늘 등판을 넣은 값)
 */
function addOveruse(ps: PlayerStates, pg: PitcherInGame, side: Side, prevStart: number, ctx: GameContext): void {
  const o = ctx.params.injury.overuse;
  const i = pg.p.idx;
  let v = currentOveruse(ps, i, ctx.day, o) + Math.max(0, pg.pitches - pg.realLimit) * o.overPitch;
  if (ps.streak[i] === 2) v += o.b2b;
  else if (ps.streak[i] >= 3) v += o.b3b;
  if (pg.isStarter) {
    const rest = side.ts.restDays ?? ctx.params.starterRestDays;
    const gap = ctx.day - prevStart;
    if (gap < rest) v += o.shortRest * (rest - gap);
  }
  ps.overuse[i] = v;
  // 저장된 값(Float32)으로 계산해야 불러온 뒤에도 같다
  ps.recoverMul[i] = 1 / (1 + o.recovery * ps.overuse[i]);
}

/**
 * 승리 투수 (기록 규정, 엔진 2 14단계). record: 이긴 팀이 마지막으로 앞설 때 마운드에 있던 투수 (pitcher of record).
 * - 선발은 5이닝(15아웃)을 채워야 승리. 못 채웠으면 구원 가운데 가장 길게 던진 투수 (같으면 실점이 적은, 그다음 먼저 나온 투수).
 *   규정의 "가장 효과적인 구원"은 기록원 판단이라 아웃 수·실점으로 대신한다 (임시 규칙)
 * - 구원이 짧고 나쁘게 던졌으면 (아웃 3개 미만에 2실점 이상) 뒤에 나와 1이닝 이상 무실점으로 리드를 지킨 구원에게 넘긴다
 */
function winningPitcher(winner: Side, record: PitcherInGame | null): PitcherInGame {
  const relievers = winner.staff.filter((x) => !x.isStarter);
  const longest = (list: PitcherInGame[]) => list.reduce<PitcherInGame | null>((b, x) => (!b || x.outs > b.outs || (x.outs === b.outs && x.runs < b.runs) ? x : b), null);
  if (!record || (record.isStarter && record.outs < 15)) return longest(relievers) ?? winner.staff[0];
  if (!record.isStarter && record.outs < 3 && record.runs >= 2) {
    const after = relievers.slice(relievers.indexOf(record) + 1).filter((x) => x.outs >= 3 && x.runs === 0);
    return longest(after) ?? record;
  }
  return record;
}

/** 경기 뒤 처리: 피로·선발 기록, 승리·패전·세이브·홀드 */
function finishGame(st: GameState, inning: number, lineScore: GameResult['lineScore']): GameResult {
  const { ctx, home, away, rec } = st;
  ctx.totals.games++;
  if (inning > 9) ctx.totals.extraInningGames++;
  const ps = ctx.states;
  const o = ctx.params.injury.overuse;
  // 짧은 휴식 판정용: 이번 등판 전 마지막 선발일
  const prevStart = new Map<number, number>();
  for (const side of [home, away]) for (const pg of side.staff) if (pg.isStarter) prevStart.set(pg.p.idx, ps.lastStartDay[pg.p.idx]);
  for (const side of [home, away]) {
    for (const pg of side.staff) {
      const i = pg.p.idx;
      if (pg.isStarter) {
        ps.lastStartDay[i] = ctx.day;
        if (pg.outs >= 18 && pg.er <= 3) pg.line.qs++;
      }
      ps.fatigue[i] = currentFatigue(ps, i, ctx.day) + pg.pitches;
      ps.streak[i] = ps.fatigueDay[i] === ctx.day - 1 ? ps.streak[i] + 1 : ps.fatigueDay[i] === ctx.day ? Math.max(1, ps.streak[i]) : 1;
      if (o.on) addOveruse(ps, pg, side, prevStart.get(i) ?? -99, ctx);
      ps.fatigueDay[i] = ctx.day;
    }
  }
  // 야수 피로 (엔진 2 11단계): 선발 출전은 load(포수·지명타자 배율, 30세 넘으면 나이 몫, 연장이면 이닝 ÷ 9배), 교체 출전은 sub
  const bp = ctx.params.body;
  const long = Math.max(1, inning / 9);
  for (const side of [home, away]) {
    const add = (p: SimPlayer, load: number) => {
      const age = 1 + bp.agePer * Math.max(0, (p.age ?? 30) - 30);
      ps.body[p.idx] = Math.min(bp.cap, currentBody(ps, p.idx, ctx.day, bp) + load * age);
      ps.bodyDay[p.idx] = ctx.day;
    };
    for (const { p, slot } of side.starters) if (!p.isPitcher) add(p, bp.load * (slot === 'C' ? bp.catcher : slot === 'DH' ? bp.dh : 1) * long);
    for (const s of side.subs) {
      const p = side.ts.hitters.find((x) => x.idx === s.idx);
      if (p && !side.starters.some((x) => x.p === p)) add(p, bp.sub);
    }
  }

  let win: number | null = null;
  let loss: number | null = null;
  let save: number | null = null;
  if (home.runs === away.runs) {
    ctx.totals.ties++;
  } else {
    const winner = home.runs > away.runs ? home : away;
    if (winner === home) ctx.totals.homeWins++;
    const wp = winningPitcher(winner, rec.leader === winner ? rec.win : null);
    wp.line.w++;
    win = wp.p.idx;
    const lp = rec.loss;
    if (lp) {
      lp.line.l++;
      loss = lp.p.idx;
    }
    const last = winner.staff[winner.staff.length - 1];
    if (last !== wp && earnsSave(last)) {
      last.line.sv++;
      save = last.p.idx;
    }
  }
  // 홀드 (2026-10-12, 엔진 2 14단계): 세이브 상황(isSaveSituation: 1~3점 리드, 또는 동점 주자가 누상·타석·대기 타석)에 나온 구원 투수가
  // 아웃을 하나 이상 잡고 리드를 지킨 채 내려가면 (exitLead, 내려갈 때 리드. 남긴 주자가 뒤에 들어와도 홀드는 그대로).
  // 경기를 끝낸 투수, 승리 투수, 블론 세이브를 한 투수는 받지 않는다. 진 팀 투수도 받을 수 있다 (리드는 뒤에 나온 투수가 잃었다)
  for (const side of [home, away]) {
    const fin = side.staff[side.staff.length - 1];
    for (const pg of side.staff) {
      if (pg.isStarter || pg === fin || pg.p.idx === win || pg.blown) continue;
      if (pg.saveSit && pg.outs >= 1 && (pg.exitLead ?? 0) > 0) pg.line.hld++;
    }
  }
  return {
    homeRuns: home.runs, awayRuns: away.runs, innings: inning, win, loss, save, lineScore,
    homeStaff: home.staff.map((x) => x.p.idx), awayStaff: away.staff.map((x) => x.p.idx),
    homeSubs: home.subs, awaySubs: away.subs,
  };
}
