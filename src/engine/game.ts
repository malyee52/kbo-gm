// 한 경기 시뮬레이션: 경기 상태(state.ts)를 만들고 반 이닝·타석을 차례로 진행한다.
// 타석은 공통 규칙(감독 판단 manager.ts, 주루·진루 rules.ts)과 해결기(resolver.ts)로 푼다 (docs/경기엔진2_기획안.md 3.2).

import type { PlateContext } from './pa';
import type { ParkRates, Rates } from '../data/types';
import type { BallTally } from './battedball';
import { availableRelievers, bringIn, enterPitcher, maybeChangePitcher, maybeOnePoint, tallySaveEntry, wantInfieldIn, wantIntentionalWalk, type PenTally } from './manager';
import { Ev, NEUTRAL_PARK, paRates, type GamePark, type PaRates } from './pa';
import type { EngineParams } from './params';
import { B0, drawInPlay, type PaResolver } from './resolver';
import type { Rng } from './rng';
import { addPitches, applyPlateAppearance, autoBunt, beginPlateAppearance, buntPitches, manualIntentionalWalk, orderedBunt, pickoff, steals, stealOne, stealPct, wantPitchout, wildPitch, type RunTally } from './rules';
import { earnsSave, fieldDefense, fielderAt, fieldSlots, GameState, isSaveSituation, substitute, tyingRunNear, type GameSub, type PitcherInGame, type Side } from './state';
import { aiDefense, pickPinchHitter, pickPinchRunner, replaceInjured } from './subs';
import { currentBody, currentFatigue, currentOveruse, type PlayerStates, type TeamSeason } from './team';
import { drawInjury, hitterAgeFactor, injuryProneness, type AbsenceKind, type InjuryCause, type InjuryPart } from './injury';
import { injuryScale } from './traits';
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
  /** 수비수별 자리 아웃 수 (선수 색인 × 8 + FIELD_POS 순서 C…RF, 능력치 v2 12.9). 없으면 세지 않는다 */
  defOuts?: Int32Array;
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
  /** 있으면 경기 중 부상을 뽑아 여기에 남긴다 (정규시즌, Season이 경기마다 비운다). 없으면 경기 중 부상이 없다 (가을야구·올스타전·시험) */
  injuries?: GameInjury[];
  /** 선수별 실제 한계 투구 수 배율 (선수 색인, 기획안 4.6, Season이 리그 시드로 만든다). 없으면 1 */
  realLimitScale?: Float32Array;
  /** 볼카운트 사슬 능력 (능력치 v2 16-1, Season이 만든다). 있으면 삼진·볼넷·사구와 투구 수를 칸 함수로 낸다. 없으면 예전 길 (결과 비율 → 손잡이 풀기) */
  plate?: PlateContext;
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
}

/** 지휘자에게 묻는 순간 (우리 공격 또는 우리 수비의 타석 직전) */
export interface CommandRequest {
  /** 이 경기에서 몇 번째 물음인가 (0부터) */
  n: number;
  side: 'bat' | 'field';
  /** run 주자 작전(투구 전: 대주자·도루), bat 타격 작전(도루 뒤: 대타·대주자·강공·번트), field 수비 */
  step: 'run' | 'bat' | 'field';
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
  /** 지금 투수가 상대한 타자 수, 내준 점수 */
  pitcherBf: number;
  pitcherRuns: number;
  /** 우리 라인업 (타순) */
  lineup: number[];
  /** 우리 공격: 대타·대주자로 쓸 수 있는 선수 */
  bench: number[];
  /** 우리 수비: 지금 올릴 수 있는 구원 투수 */
  bullpen: number[];
  /** 지금까지의 중계 기록 */
  plays: Play[];
}

/**
 * 지휘 선택. 비우면 자동(AI 감독).
 * 주자 작전(run, 1루 주자가 있고 2루가 비었을 때만 묻는다): pr 대주자, steal go 도루 시도·hold 도루 안 함.
 * 타격 작전(bat, 도루가 끝난 뒤): ph 대타(지금 타자 대신), pr 대주자, tactic swing 강공(번트 없음)·bunt 희생번트.
 * 수비: pitcher 투수 교체, keep 지금 투수 유지(자동 교체 안 함), walk 고의4구.
 * (2026-10-12 사용자: 도루는 타석과 별개이고 도루 뒤에 번트도 할 수 있다 → 주자 작전과 타격 작전을 나눴다)
 */
export interface CommandChoice {
  ph?: number;
  pr?: { base: 0 | 1 | 2; idx: number };
  steal?: 'go' | 'hold';
  /** 'steal'은 예전 기록 호환 (도루 시도로 본다) */
  tactic?: 'swing' | 'steal' | 'bunt';
  pitcher?: number;
  keep?: boolean;
  walk?: boolean;
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
}

export function simulateGame(homeTs: TeamSeason, awayTs: TeamSeason, homeLineup: SimPlayer[], awayLineup: SimPlayer[],
                             homeStarter: SimPlayer, awayStarter: SimPlayer, ctx: GameContext): GameResult {
  if (homeLineup.length !== 9 || awayLineup.length !== 9) {
    throw new Error(`라인업은 9명이어야 합니다 (홈 ${homeLineup.length}명, 원정 ${awayLineup.length}명)`);
  }
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
  // 홈 구장 사건별 배율: 실제 구장 표가 있으면 그 배율(meta.parkEvents, 좌타·우타 포함), 없으면 득점 계수 f를 지수로 나눈다.
  // 게임 안에서 지은 신구장의 홈런 배율(hr)은 곱한다
  const tp = homeTs.team.park;
  const run = tp?.run ?? 1;
  const hit = run ** ctx.params.park.hitExp;
  const withHr = (x: ParkRates | undefined): ParkRates | undefined => x && { s1: x.s1, d2: x.d2, t3: x.t3, hr: tp!.hr * x.hr };
  const park: GamePark = !tp ? NEUTRAL_PARK
    : tp.ev ? { ...withHr(tp.ev)!, L: withHr(tp.ev.L), R: withHr(tp.ev.R) }
    : { s1: hit, d2: hit, t3: hit, hr: tp.hr * run ** ctx.params.park.hrExp };
  const away = mkSide(awayTs, awayLineup, awayStarter, false);
  const st = new GameState(ctx, home, away, park);

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
    if (inning >= 9 && home.runs !== away.runs) break;
    if (ctx.maxInnings > 0 && inning >= ctx.maxInnings) break; // 0 = 무제한 (2008 끝장승부)
    // 시간 제한 흉내: 여기까지 오면 동점이다. 따로 둔 줄기에서만 뽑아 경기 난수 흐름은 그대로다
    if (tl && inning >= tl.from && (timeRng ??= ctx.rng.fork('time')).chance(tl.end)) break;
  }
  if (ctx.running) for (const side of [home, away]) for (const s of side.subs) ctx.running[s.kind === 'PH' ? 'ph' : s.kind === 'PR' ? 'pr' : 'def']++;
  return finishGame(st, inning, lineScore);
}

/** 직접 지휘자에게 묻는다 */
function ask(st: GameState, side: 'bat' | 'field', step: 'run' | 'bat' | 'field' = side): CommandChoice {
  const { bat, fld, ctx } = st;
  const plays = ctx.plays;
  return ctx.command!.decide({
    n: st.cmdN++, side, step, inn: st.inning, top: !bat.isHome, outs: st.outs, bases: st.baseIdx(),
    away: st.away.runs, home: st.home.runs, batter: bat.lineup[bat.spot].idx, onDeck: bat.lineup[(bat.spot + 1) % 9].idx,
    pitcher: fld.pitcher.p.idx, pitcherBf: fld.pitcher.bf, pitcherRuns: fld.pitcher.runs,
    lineup: (side === 'bat' ? bat : fld).lineup.map((p) => p.idx),
    bench: side === 'bat' ? bat.ts.hitters.filter((p) => !bat.lineup.includes(p) && !bat.removed.has(p.idx)).map((p) => p.idx) : [],
    bullpen: side === 'field' ? availableRelievers(fld, ctx).map((p) => p.idx) : [],
    plays: plays ? plays.slice() : [],
  });
}

/** 공격 반 이닝. 끝내기면 true */
function playHalf(st: GameState, bat: Side, fld: Side, inning: number): boolean {
  st.startHalf(bat, fld, inning);
  const { ctx } = st;
  if (ctx.pen && inning >= 7) {
    ctx.pen.lateHalf++;
    ctx.pen.lateLead[Math.max(-4, Math.min(4, fld.runs - bat.runs)) + 4]++;
  }
  // AI 감독 수비 교체 (엔진 2 9단계): 대타·대주자 뒤 수비 위치 다시 정하기, 후반 리드 때 대수비
  aiDefense(st, fld, bat);
  const resolver = ctx.resolver ?? B0;
  const cmd = ctx.command;
  let first = true;

  while (st.outs < 3) {
    // 직접 지휘: 우리 수비면 투수 교체·유지·고의4구, 우리 공격이면 대타·대주자·작전
    const fc = cmd && fld.ts.team.idx === cmd.team ? ask(st, 'field') : null;
    const was = fld.pitcher;
    const next = fc?.pitcher !== undefined ? availableRelievers(fld, ctx).find((p) => p.idx === fc.pitcher) : undefined;
    if (next) bringIn(fld, next, fld.runs - bat.runs, ctx);
    else if (!fc?.keep || fld.pitcher.injured) {
      maybeChangePitcher(fld, bat, inning, st.basesEmpty, first, bat.runs - st.runsAtStart, ctx);
      // 좌우 원포인트 (엔진 2 10단계): 바꾸지 않았으면 좌타 강타자에 좌완 구원
      if (fld.pitcher === was) maybeOnePoint(fld, bat, inning, ctx);
    }
    // 세이브 상황은 등판 때 누상 주자까지 보고 정한다 (4점 이상 리드에 동점 주자가 누상·타석·대기 타석)
    if (fld.pitcher !== was) {
      const runners = st.bases.filter(Boolean).length;
      fld.pitcher.saveSit = isSaveSituation(fld.pitcher.enteredLead, runners);
      fld.pitcher.tyingNear = tyingRunNear(fld.pitcher.enteredLead, runners);
      fld.pitcher.entryInning = inning;
      if (ctx.pen) tallySaveEntry(fld, fld.pitcher, inning, runners, ctx);
    }
    if (ctx.plays && fld.pitcher !== was) st.note('PC', -1, fld.pitcher.p.idx, bat.runs);
    first = false;
    const ours = !!cmd && bat.ts.team.idx === cmd.team;
    const bench = (idx: number | undefined) => (idx === undefined ? undefined
      : bat.ts.hitters.find((p) => p.idx === idx && !bat.lineup.includes(p) && !bat.removed.has(p.idx)));
    const pinchRun = (c: CommandChoice | null) => {
      const runnerIn = bench(c?.pr?.idx);
      const old = c?.pr ? st.bases[c.pr.base] : null;
      if (!runnerIn || !old) return;
      const slot = bat.lineup.indexOf(old.p);
      if (slot >= 0) substitute(bat, slot, runnerIn, 'PR');
      else bat.removed.add(old.p.idx);
      st.bases[c!.pr!.base] = { p: runnerIn, resp: old.resp, earned: old.earned };
      ctx.bat[runnerIn.idx].g++;
      st.note('PR', runnerIn.idx, fld.pitcher.p.idx, bat.runs);
    };

    // AI 감독 대주자·대타 (엔진 2 9단계, subs.ts): 투구 전에. 직접 지휘 팀도 같다 (모두 자동 = 지휘 안 한 경기)
    const aiPr = pickPinchRunner(st);
    if (aiPr) pinchRun({ pr: { base: aiPr[0], idx: aiPr[1].idx } });
    const aiPh = pickPinchHitter(st);
    if (aiPh) {
      substitute(bat, bat.spot, aiPh, 'PH');
      ctx.bat[aiPh.idx].g++;
      st.note('PH', aiPh.idx, fld.pitcher.p.idx, bat.runs);
    }

    // 주자 작전 (투구 전, 도루할 수 있을 때만): 대주자, 도루
    const rc = ours && st.bases[0] && !st.bases[1] ? ask(st, 'bat', 'run') : null;
    pinchRun(rc);
    const steal = rc?.steal ?? (rc?.tactic === 'steal' ? 'go' : undefined);
    // 견제사, 피치아웃, 히트앤드런 → 도루 (엔진 2 8단계). 피치아웃·히트앤드런은 타석 첫 공에 거는 AI 감독 작전 (직접 지휘로는 아직 못 건다, 17단계).
    // 직접 지휘 중에도 도루를 고르지 않으면(자동) AI 감독이 한다: 모두 자동인 경기가 지휘하지 않은 경기와 같다
    if (pickoff(st)) break;
    const po = wantPitchout(st);
    if (po) addPitches(ctx, fld.pitcher, 1);
    let going = false;
    if (steal === undefined && hitAndRun(st)) {
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
    } else if (steals(st, steal, po)) break;
    if (wildPitch(st)) return true;

    // 타격 작전 (도루가 끝난 뒤): 대타, 대주자, 강공·번트
    const bc = ours ? ask(st, 'bat', 'bat') : null;
    pinchRun(bc);
    const hitter = bench(bc?.ph);
    if (hitter) {
      substitute(bat, bat.spot, hitter, 'PH');
      ctx.bat[hitter.idx].g++;
      st.note('PH', hitter.idx, fld.pitcher.p.idx, bat.runs);
    }
    const tactic = bc?.tactic === 'steal' ? undefined : bc?.tactic;
    // 고의4구 (지휘, 또는 AI 감독 엔진 2 10단계)와 전진 수비 (AI 감독). 자동 고의4구 전 시대는 공 4개를 실제로 던진다 (타석이 끝나기 전 폭투로 끝내기면 타석 없음)
    const walk = !!fc?.walk || (!going && wantIntentionalWalk(st));
    st.infieldIn = !walk && wantInfieldIn(st);
    if (walk && ctx.autoIbb === false && manualIntentionalWalk(st, fld.pitcher)) return true;

    const { batter, bl, pg } = beginPlateAppearance(st);
    // 히트앤드런 첫 공 인플레이: 그 공으로 타석이 끝난다 (그 사이 지휘로 대타·번트·고의4구를 골랐으면 작전은 풀린다)
    if (going && !tactic && !walk && !hitter) {
      const rates = paRates(batter, pg, bat.isHome, ctx, {
        runnersOn: true, scoring: false, late: inning >= 7 && Math.abs(bat.runs - fld.runs) <= 2,
      }, st.park);
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
    if (walk) ev = Ev.BB;
    else {
      rates = paRates(batter, pg, bat.isHome, ctx, {
        runnersOn: !st.basesEmpty, scoring: !!(st.bases[1] || st.bases[2]), late: inning >= 7 && Math.abs(bat.runs - fld.runs) <= 2,
      }, st.park);
      const res = resolver.resolve(rates, ctx.rng);
      ev = res.ev;
      addPitches(ctx, pg, res.pitches);
    }
    const r0 = bat.runs;
    const kind = applyPlateAppearance(st, ev, batter, bl, pg, walk, rates);
    if (ctx.splits) tallySplit(ctx.splits, batter, pg.p, kind);
    st.note(kind, batter.idx, pg.p.idx, r0);
    if (ctx.injuries) inGameInjury(st, batter, pg, kind);
    if (st.walkOff()) return true;
  }
  return false;
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
