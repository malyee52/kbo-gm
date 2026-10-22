// 한 경기 시뮬레이션: 경기 상태(state.ts)를 만들고 반 이닝·타석을 차례로 진행한다.
// 타석은 공통 규칙(감독 판단 manager.ts, 주루·진루 rules.ts)과 해결기(resolver.ts)로 푼다 (docs/경기엔진2_기획안.md 3.2).

import type { ParkRates, Rates } from '../data/types';
import { availableRelievers, bringIn, enterPitcher, maybeChangePitcher } from './manager';
import { Ev, NEUTRAL_PARK, paRates, type GamePark } from './pa';
import type { EngineParams } from './params';
import { B0, type PaResolver } from './resolver';
import type { Rng } from './rng';
import { applyPlateAppearance, autoSacBunt, beginPlateAppearance, orderedBunt, stealSecond, wildPitch } from './rules';
import { fieldDefense, fieldSlots, GameState, substitute, type GameSub, type PitcherInGame, type Side } from './state';
import { currentFatigue, type PlayerStates, type TeamSeason } from './team';
import type { BatLine, LeagueEnv, PitLine, SimPlayer } from './types';

export { BUNT_SUCCESS } from './rules';
export { bullpenOrder } from './manager';
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
  /** 선수별 컨디션 (선수 색인, 무작위 이벤트 효과, league/events.ts). 타자는 +면 유리, 투수는 +면 투수가 유리. 없으면 0 */
  form?: Float64Array;
  /** 있으면 이 경기의 타석·주루·교체를 차례로 남긴다 (중계 화면). 난수를 더 쓰지 않아 결과는 같다 */
  plays?: Play[] | null;
  /** 직접 지휘 (경기 개입): 이 구단의 타석마다 지휘자에게 묻는다. 고른 것이 '자동'이면 AI 감독과 똑같이 진행한다 */
  command?: GameCommand | null;
  /** 수비수별 실책 수 (선수 색인). 없으면 남기지 않는다 */
  errors?: number[];
  /** 타석을 끝내는 해결기. 없으면 B0 (엔진 1의 타석 뽑기) */
  resolver?: PaResolver;
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
 * SF 희생플라이, SAC 희생번트, SB 도루, CS 도루 실패, WP 폭투·포일·보크, PC 투수 교체, IBB 고의4구, BF 번트 실패, PH 대타, PR 대주자
 */
export type PlayKind = 'SO' | 'BB' | 'HBP' | 'HR' | '3B' | '2B' | '1B' | 'E' | 'GDP' | 'GO' | 'FO' | 'SF' | 'SAC' | 'SB' | 'CS' | 'WP' | 'PC' | 'IBB' | 'BF' | 'PH' | 'PR';

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
    if (ts.tactics) pitcher.limit *= ts.tactics.hook;
    for (const p of lineup) ctx.bat[p.idx].g++;
    const vals = lineup.map((p) => p.value).sort((a, b) => a - b);
    const medianValue = vals[vals.length >> 1] ?? 0;
    const slots = fieldSlots(ts, lineup);
    const fd = fieldDefense(lineup, slots);
    return { ts, lineup: [...lineup], spot: 0, runs: 0, pitcher, staff: [pitcher], usedIdx: new Set([starter.idx]), isHome, medianValue, ...fd, removed: new Set(), slots, subs: [] };
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
  for (;;) {
    inning++;
    const a0 = away.runs;
    playHalf(st, away, home, inning);
    lineScore.away.push(away.runs - a0);
    if (inning >= 9 && home.runs > away.runs) {
      lineScore.home.push(-1);
      break;
    }
    const h0 = home.runs;
    const walkOff = playHalf(st, home, away, inning);
    lineScore.home.push(home.runs - h0);
    if (walkOff) break;
    if (inning >= 9 && home.runs !== away.runs) break;
    if (ctx.maxInnings > 0 && inning >= ctx.maxInnings) break; // 0 = 무제한 (2008 끝장승부)
  }
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
  const resolver = ctx.resolver ?? B0;
  const cmd = ctx.command;
  let first = true;

  while (st.outs < 3) {
    // 직접 지휘: 우리 수비면 투수 교체·유지·고의4구, 우리 공격이면 대타·대주자·작전
    const fc = cmd && fld.ts.team.idx === cmd.team ? ask(st, 'field') : null;
    const was = fld.pitcher;
    const next = fc?.pitcher !== undefined ? availableRelievers(fld, ctx).find((p) => p.idx === fc.pitcher) : undefined;
    if (next) bringIn(fld, next, fld.runs - bat.runs, ctx);
    else if (!fc?.keep) maybeChangePitcher(fld, bat, inning, st.basesEmpty, first, bat.runs - st.runsAtStart, ctx);
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

    // 주자 작전 (투구 전, 도루할 수 있을 때만): 대주자, 도루
    const rc = ours && st.bases[0] && !st.bases[1] ? ask(st, 'bat', 'run') : null;
    pinchRun(rc);
    const steal = rc?.steal ?? (rc?.tactic === 'steal' ? 'go' : undefined);
    if (stealSecond(st, steal)) break;
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

    const { batter, bl, pg } = beginPlateAppearance(st);
    // 지휘한 희생번트: 2아웃 전, 주자가 있을 때
    if (tactic === 'bunt' && st.outs < 2 && !st.basesEmpty && !fc?.walk) {
      const end = orderedBunt(st, batter, bl, pg);
      addPitches(ctx, pg, resolver.inPlayPitches?.(ctx.rng) ?? 0);
      if (end) return true;
      continue;
    }
    if (!tactic && !fc?.walk && autoSacBunt(st, batter, bl, pg)) {
      addPitches(ctx, pg, resolver.inPlayPitches?.(ctx.rng) ?? 0);
      continue;
    }

    // 지휘한 고의4구는 공 없이 (자동 고의4구)
    let ev: Ev;
    if (fc?.walk) ev = Ev.BB;
    else {
      const rates = paRates(batter, pg, bat.isHome, ctx, fld.def, {
        runnersOn: !st.basesEmpty, scoring: !!(st.bases[1] || st.bases[2]), late: inning >= 7 && Math.abs(bat.runs - fld.runs) <= 2,
      }, st.park);
      const res = resolver.resolve(rates, ctx.rng);
      ev = res.ev;
      addPitches(ctx, pg, res.pitches);
    }
    const r0 = bat.runs;
    const kind = applyPlateAppearance(st, ev, batter, bl, pg, !!fc?.walk);
    st.note(kind, batter.idx, pg.p.idx, r0);
    if (st.walkOff()) return true;
  }
  return false;
}

/** 마운드 투수의 투구 수를 센다 (기록·박스스코어용. 피로·교체에는 아직 쓰지 않는다, 엔진 2 4단계) */
function addPitches(ctx: GameContext, pg: PitcherInGame, n: number): void {
  pg.pitches += n;
  pg.line.np += n;
  ctx.totals.pitches += n;
}

/** 경기 뒤 처리: 피로·선발 기록, 승리·패전·세이브·홀드 */
function finishGame(st: GameState, inning: number, lineScore: GameResult['lineScore']): GameResult {
  const { ctx, home, away, rec } = st;
  ctx.totals.games++;
  if (inning > 9) ctx.totals.extraInningGames++;
  const ps = ctx.states;
  for (const side of [home, away]) {
    for (const pg of side.staff) {
      const i = pg.p.idx;
      if (pg.isStarter) {
        ps.lastStartDay[i] = ctx.day;
        if (pg.outs >= 18 && pg.er <= 3) pg.line.qs++;
      }
      ps.fatigue[i] = currentFatigue(ps, i, ctx.day) + pg.bf;
      ps.streak[i] = ps.fatigueDay[i] === ctx.day - 1 ? ps.streak[i] + 1 : ps.fatigueDay[i] === ctx.day ? Math.max(1, ps.streak[i]) : 1;
      ps.fatigueDay[i] = ctx.day;
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
    let wp: PitcherInGame | null = rec.leader === winner ? rec.win : null;
    // 선발은 5이닝을 채워야 승리. 못 채웠으면 첫 번째 구원에게
    if (!wp || (wp.isStarter && wp.outs < 15)) wp = winner.staff.find((x) => !x.isStarter) ?? winner.staff[0];
    wp.line.w++;
    win = wp.p.idx;
    const lp = rec.loss;
    if (lp) {
      lp.line.l++;
      loss = lp.p.idx;
    }
    const last = winner.staff[winner.staff.length - 1];
    if (last !== wp && !last.isStarter && ((last.enteredLead >= 1 && last.enteredLead <= 3 && last.outs >= 1) || last.outs >= 9)) {
      last.line.sv++;
      save = last.p.idx;
    }
  }
  // 홀드 (2026-10-12): 3점 차 이내 리드에서 나온 구원 투수가 아웃을 하나 이상 잡고 리드를 지킨 채 내려가면.
  // 경기를 끝낸 투수, 승리 투수, 블론 세이브를 한 투수는 받지 않는다. 진 팀 투수도 받을 수 있다 (리드는 뒤에 나온 투수가 잃었다). 리드 유지는 자기 실점으로 근사
  for (const side of [home, away]) {
    const fin = side.staff[side.staff.length - 1];
    for (const pg of side.staff) {
      if (pg.isStarter || pg === fin || pg.p.idx === win || pg.blown) continue;
      if (pg.enteredLead >= 1 && pg.enteredLead <= 3 && pg.outs >= 1 && pg.enteredLead - pg.runs > 0) pg.line.hld++;
    }
  }
  return {
    homeRuns: home.runs, awayRuns: away.runs, innings: inning, win, loss, save, lineScore,
    homeStaff: home.staff.map((x) => x.p.idx), awayStaff: away.staff.map((x) => x.p.idx),
    homeSubs: home.subs, awaySubs: away.subs,
  };
}
