// 한 경기 시뮬레이션. 타석 단위로 결과를 뽑고 주자·아웃·득점을 진행한다.

import type { Rates } from '../data/types';
import type { EngineParams } from './params';
import type { Rng } from './rng';
import { defenseAt } from './defense';
import { assignSlots, currentFatigue, FATIGUE_AVAILABLE_BELOW, needsRest, type PlayerStates, type TeamSeason } from './team';
import { fatigueScale, traitEdge, type Situation } from './traits';
import type { BatLine, LeagueEnv, PitLine, PitSkill, SimPlayer } from './types';

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
}

export function emptyLeagueCounters(): LeagueCounters {
  return {
    games: 0, ties: 0, extraInningGames: 0, homeWins: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, hbp: 0, so: 0,
    r: 0, er: 0, outs: 0, gdp: 0, sf: 0, sac: 0, sb: 0, cs: 0, roe: 0, outsOnBases: 0, wildPitches: 0,
  };
}

export interface GameContext {
  league: Rates;
  env: LeagueEnv;
  /** 환경 맞춤 계수 (사건별). 타자 쪽 비율에 곱한다 */
  cal: Rates;
  params: EngineParams;
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
}

interface PitcherInGame {
  p: SimPlayer;
  skill: PitSkill;
  line: PitLine;
  bf: number;
  runs: number;
  outs: number;
  limit: number;
  isStarter: boolean;
  /** 등판 시점의 점수 차 (자기 팀 기준) */
  enteredLead: number;
}

interface Runner {
  p: SimPlayer;
  resp: PitcherInGame;
  earned: boolean;
}

interface Side {
  ts: TeamSeason;
  lineup: SimPlayer[];
  spot: number;
  runs: number;
  pitcher: PitcherInGame;
  staff: PitcherInGame[];
  usedIdx: Set<number>;
  isHome: boolean;
  /** 라인업 가치의 중앙값 (희생번트를 누가 대는지 정할 때 쓴다) */
  medianValue: number;
  /** 수비 8명의 수비 런 합 (defense.ts) */
  def: number;
  /** 포수의 수비 런 */
  catcherDef: number;
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
}

const enum Ev { SO, BB, HBP, HR, S1, D2, T3, OUT }

const clampRate = (x: number) => (x < 0.0005 ? 0.0005 : x > 0.6 ? 0.6 : x);

/** 승산비 결합: 타자 비율과 투수 비율을 리그 평균 기준으로 합친다 */
function combine(batRate: number, pitRate: number, lg: number): number {
  const b = clampRate(batRate);
  const p = clampRate(pitRate);
  const o = ((b / (1 - b)) * (p / (1 - p))) / (lg / (1 - lg));
  return o / (1 + o);
}

const STARTER_LIMIT_SCALE = 1.08;
/** 어제 던진 필승조를 오늘 아낄 확률 (임시값, 상위 구원 투수 시즌 등판 80경기 안팎에 맞춤) */
const SPARE_YESTERDAY = 0.4;

function enterPitcher(p: SimPlayer, isStarter: boolean, lead: number, ctx: GameContext): PitcherInGame {
  const skill = p.pit!;
  const line = ctx.pit[p.idx];
  line.g++;
  if (isStarter) line.gs++;
  // 선발 한계는 기록으로 추정한 체력보다 조금 길게 (체력 추정이 평균 쪽으로 당겨져 있어 실제 선발 타자 수 23.4명에 맞춤, 임시값)
  const base = isStarter ? skill.stamina * STARTER_LIMIT_SCALE * (ctx.startLimitScale ?? 1) : skill.reliefStint;
  return { p, skill, line, bf: 0, runs: 0, outs: 0, limit: base * ctx.rng.range(0.82, 1.18), isStarter, enteredLead: lead };
}

/** 쓸 수 있는 구원 투수: 이번 경기에 안 나왔고, 쉴 만큼 쉬었고, 3연투가 아닌 투수 */
function availableRelievers(fld: Side, ctx: GameContext): SimPlayer[] {
  const st = ctx.states;
  return fld.ts.bullpen.filter((p) => !fld.usedIdx.has(p.idx)
    && currentFatigue(st, p.idx, ctx.day) < FATIGUE_AVAILABLE_BELOW && !needsRest(st, p.idx, ctx.day));
}

/**
 * 구원 투수 고르기 (2026-10-08 사용자 지적 "투수 교체가 비현실적"으로 다시 짬).
 * 불펜을 좋은 순으로 줄 세워 역할을 나눈다: 마무리, 필승조(좋은 순 1·2번째 = 8회·7회 셋업), 추격조(그다음), 롱릴리프·패전조(나머지).
 * 역할 나누기와 점수 차 기준은 임시값.
 */
function pickReliever(fld: Side, lead: number, inning: number, ctx: GameContext): SimPlayer | null {
  const { ts } = fld;
  const st = ctx.states;
  const pool = availableRelievers(fld, ctx);
  if (pool.length === 0) {
    // 쉴 만큼 쉰 투수가 없으면 덜 지친 투수부터 (3연투는 마지막까지 미룬다)
    const rest = ts.bullpen.filter((p) => !fld.usedIdx.has(p.idx));
    if (rest.length === 0) return null;
    const cost = (p: SimPlayer) => currentFatigue(st, p.idx, ctx.day) + (needsRest(st, p.idx, ctx.day) ? 100 : 0);
    return rest.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  }
  const closer = ts.closer;
  const closerOk = !!closer && pool.includes(closer);
  // 마무리: 9회 이후 3점 차 이내 리드, 또는 9회 이후 동점(홈은 끝내기를 기다리며, 원정은 연장)
  if (closerOk && inning >= 9 && lead >= 0 && lead <= 3) return closer;
  // 불펜 서열: 좋은 순 (value가 낮을수록 좋다). 마무리는 빼고
  const order = ts.bullpen.filter((p) => p !== closer).sort((a, b) => a.value - b.value);
  const avail = order.filter((p) => pool.includes(p));
  if (avail.length === 0) return closerOk ? closer : null;
  const rank = (p: SimPlayer) => order.indexOf(p);
  const close = lead >= -2 && lead <= 3; // 이기고 있거나 근소하게 지는 접전
  const late = inning >= 7;
  if (late && close && lead >= 0) {
    // 필승조: 8회 이후는 1번 셋업, 7회는 2번 셋업부터. 없으면 다음으로 좋은 투수
    const want = inning >= 8 ? 0 : 1;
    const cands = avail.filter((p) => rank(p) >= want);
    const list = cands.length ? cands : avail;
    // 어제 던졌으면 확률적으로 아끼고 다음 투수를 쓴다
    const pick = list.find((p) => st.fatigueDay[p.idx] !== ctx.day - 1 || !ctx.rng.chance(SPARE_YESTERDAY));
    return pick ?? list[0];
  }
  if (late && close) {
    // 근소하게 지는 후반: 필승조는 아끼고 추격조(3~5번째)부터
    return avail.find((p) => rank(p) >= 2) ?? avail[avail.length - 1];
  }
  if (inning <= 5) {
    // 이른 강판: 아래쪽 절반 중 가장 길게 던질 투수 (롱릴리프)
    const low = avail.filter((p) => rank(p) >= 2);
    const cands = low.length ? low : avail;
    return cands.reduce((a, b) => (b.pit!.reliefStint > a.pit!.reliefStint ? b : a));
  }
  // 점수 차가 큰 경기나 중반: 필승조를 빼고 아래쪽에서 고른다
  const low = avail.filter((p) => rank(p) >= 2);
  const cands = low.length ? low : avail;
  return cands[ctx.rng.int(cands.length)];
}

/**
 * 투수 교체 판단. 타석마다 부르지만, 감독처럼 이닝 시작에 바꾸는 것이 기본이다.
 * 이닝 중간에는 한계를 크게 넘었거나 이번 이닝에 무너질 때만 바꾼다. 기준값은 임시값 (실제 2025 KBO의 선발 이닝·구원 이닝에 맞춤).
 * start: 반 이닝의 첫 타석. halfRuns: 이번 반 이닝에 내준 점수
 */
function maybeChangePitcher(fld: Side, bat: Side, inning: number, basesEmpty: boolean, start: boolean, halfRuns: number, ctx: GameContext): void {
  const pg = fld.pitcher;
  const lead = fld.runs - bat.runs;
  const closer = fld.ts.closer;
  let pull = false;
  if (pg.isStarter) {
    if (start) {
      // 이닝 시작: 한 이닝을 더 못 버티거나, 이미 많이 내줬으면 내린다
      pull = pg.bf + 2 >= pg.limit || pg.runs >= 6 || (pg.runs >= 5 && inning <= 4);
    } else {
      pull = pg.bf >= pg.limit + 4 // 한계를 크게 넘김
        || (pg.bf >= pg.limit && !basesEmpty) // 한계를 넘긴 뒤 주자를 내보냄
        || pg.runs >= 7
        || (halfRuns >= 3 && !basesEmpty && (pg.runs >= 4 || pg.bf >= pg.limit - 3)) // 이번 이닝 무너짐
        || (pg.runs >= 5 && inning <= 3 && !basesEmpty); // 초반 대량 실점
    }
  } else if (pg.p === closer) {
    // 마무리는 경기를 끝내게 둔다. 크게 흔들릴 때만
    pull = !start && (pg.runs >= 3 || pg.bf >= pg.limit + 4);
  } else if (start) {
    // 구원: 다음 이닝(타자 약 4명)을 맡기에 모자라면 이닝 시작에 바꾼다
    pull = pg.bf + 3 >= pg.limit || pg.runs >= 3;
  } else {
    pull = pg.runs >= 3 || pg.bf >= pg.limit + 3 || (halfRuns >= 2 && !basesEmpty && Math.abs(lead) <= 2 && inning >= 7);
  }
  // 9회 세이브 상황에서 마무리가 쉬었으면 이닝 시작에 마무리로
  if (!pull && start && inning >= 9 && lead >= 1 && lead <= 3 && closer && pg.p !== closer && availableRelievers(fld, ctx).includes(closer)) pull = true;
  if (!pull) return;
  const next = pickReliever(fld, lead, inning, ctx);
  if (!next) return;
  fld.usedIdx.add(next.idx);
  fld.pitcher = enterPitcher(next, false, lead, ctx);
  fld.staff.push(fld.pitcher);
}

function platoonEdge(b: SimPlayer, p: SimPlayer, size: number): number {
  if (!b.bats || !p.throws) return 0;
  if (b.bats === 'S') return size;
  return b.bats === p.throws ? -size : size;
}

/** 수비 배치에서 팀 수비 런과 포수 수비 런 */
function fieldDefense(ts: TeamSeason, lineup: SimPlayer[]): { def: number; catcherDef: number } {
  const slots = ts.field && lineup.every((p) => ts.field!.has(p.idx))
    ? lineup.map((p) => ({ p, slot: ts.field!.get(p.idx)! }))
    : assignSlots(lineup);
  let def = 0;
  let catcherDef = 0;
  for (const { p, slot } of slots) {
    const r = defenseAt(p, slot);
    def += r;
    if (slot === 'C') catcherDef = r;
  }
  return { def, catcherDef };
}

/** 주자·이닝·점수 상황 (숨겨진 특수능력 판정용) */
type PaState = Pick<Situation, 'runnersOn' | 'scoring' | 'late'>;
const NO_STATE: PaState = { runnersOn: false, scoring: false, late: false };

/** fieldDef: 수비하는 팀의 수비 런 합. 좋을수록 인플레이 안타가 아웃이 된다 */
function samplePlateAppearance(b: SimPlayer, pg: PitcherInGame, batIsHome: boolean, ctx: GameContext, fieldDef = 0, state: PaState = NO_STATE): Ev {
  const { league: lg, cal, params } = ctx;
  const bs = b.bat!;
  const ps = pg.skill;
  // 타자에게 유리한 정도: 좌우 상성 + 홈 이점 + 숨겨진 특수능력 (둘 다 없으면 0)
  const edge = platoonEdge(b, pg.p, params.platoon) + (batIsHome ? params.homeEdge : -params.homeEdge)
    + (b.traits || pg.p.traits ? traitEdge(b, pg.p, { ...state, postseason: !!ctx.postseason, home: batIsHome }, params.traits) : 0);
  // 투수 피로: 한계를 넘긴 타자 수에 비례
  const over = pg.bf - pg.limit;
  const fat = over > 0 ? Math.min(0.3, over * params.fatiguePerBatter * fatigueScale(pg.p, params.traits)) : 0;
  const up = 1 + edge;
  const down = 1 - edge;
  const worse = 1 + fat;

  const pSo = combine(bs.so * cal.so * lg.so * down, ps.so * lg.so * (1 - fat), lg.so);
  const pBb = combine(bs.bb * cal.bb * lg.bb * up, ps.bb * lg.bb * worse, lg.bb);
  const pHbp = combine(bs.hbp * cal.hbp * lg.hbp, ps.hbp * lg.hbp, lg.hbp);
  const pHr = combine(bs.hr * cal.hr * lg.hr * up, ps.hr * lg.hr * worse, lg.hr);
  const hitP = ps.hit * worse * Math.max(0.5, 1 - fieldDef * params.defenseHitPerRun);
  const pS1 = combine(bs.s1 * cal.s1 * lg.s1 * up, hitP * lg.s1, lg.s1);
  const pD2 = combine(bs.d2 * cal.d2 * lg.d2 * up, hitP * lg.d2, lg.d2);
  const pT3 = combine(bs.t3 * cal.t3 * lg.t3 * up, hitP * lg.t3, lg.t3);

  const sum = pSo + pBb + pHbp + pHr + pS1 + pD2 + pT3;
  const scale = sum > 0.93 ? 0.93 / sum : 1;
  let u = ctx.rng.next() / scale;
  if ((u -= pSo) < 0) return Ev.SO;
  if ((u -= pBb) < 0) return Ev.BB;
  if ((u -= pHbp) < 0) return Ev.HBP;
  if ((u -= pHr) < 0) return Ev.HR;
  if ((u -= pS1) < 0) return Ev.S1;
  if ((u -= pD2) < 0) return Ev.D2;
  if ((u -= pT3) < 0) return Ev.T3;
  return Ev.OUT;
}

export function simulateGame(homeTs: TeamSeason, awayTs: TeamSeason, homeLineup: SimPlayer[], awayLineup: SimPlayer[],
                             homeStarter: SimPlayer, awayStarter: SimPlayer, ctx: GameContext): GameResult {
  const { params, rng, totals } = ctx;
  if (homeLineup.length !== 9 || awayLineup.length !== 9) {
    throw new Error(`라인업은 9명이어야 합니다 (홈 ${homeLineup.length}명, 원정 ${awayLineup.length}명)`);
  }
  const mkSide = (ts: TeamSeason, lineup: SimPlayer[], starter: SimPlayer, isHome: boolean): Side => {
    const pitcher = enterPitcher(starter, true, 0, ctx);
    for (const p of lineup) ctx.bat[p.idx].g++;
    const vals = lineup.map((p) => p.value).sort((a, b) => a - b);
    const medianValue = vals[vals.length >> 1] ?? 0;
    const fd = fieldDefense(ts, lineup);
    return { ts, lineup, spot: 0, runs: 0, pitcher, staff: [pitcher], usedIdx: new Set([starter.idx]), isHome, medianValue, ...fd };
  };
  const home = mkSide(homeTs, homeLineup, homeStarter, true);
  const away = mkSide(awayTs, awayLineup, awayStarter, false);

  // 승리·패전 후보: 리드를 잡은 시점의 투수와 그 점수를 내준 투수. 동점이 되면 지운다
  const rec: { win: PitcherInGame | null; loss: PitcherInGame | null; leader: Side | null } = { win: null, loss: null, leader: null };
  // 2아웃에서 실책이 나오면 그 이닝의 이후 실점은 비자책
  let halfUnearned = false;

  const score = (bat: Side, fld: Side, runner: Runner, batterLine: BatLine | null) => {
    const before = bat.runs - fld.runs;
    bat.runs++;
    totals.r++;
    ctx.bat[runner.p.idx].r++;
    if (batterLine) batterLine.rbi++;
    runner.resp.runs++;
    runner.resp.line.r++;
    if (runner.earned && !halfUnearned && !rng.chance(ctx.env.unearnedRun)) {
      runner.resp.line.er++;
      totals.er++;
    }
    const after = before + 1;
    if (before <= 0 && after > 0) {
      rec.win = bat.pitcher;
      rec.loss = runner.resp;
      rec.leader = bat;
    } else if (after === 0) {
      rec.win = null;
      rec.loss = null;
      rec.leader = null;
    }
  };

  /** 공격 반 이닝. 끝내기면 true */
  const playHalf = (bat: Side, fld: Side, inning: number): boolean => {
    let outs = 0;
    let first = true;
    const runsAtStart = bat.runs;
    halfUnearned = false;
    const bases: (Runner | null)[] = [null, null, null];
    const walkOff = () => bat.isHome && inning >= 9 && bat.runs > fld.runs;
    const out = (n: number) => {
      outs += n;
      fld.pitcher.outs += n;
      fld.pitcher.line.outs += n;
      totals.outs += n;
    };

    while (outs < 3) {
      maybeChangePitcher(fld, bat, inning, !bases[0] && !bases[1] && !bases[2], first, bat.runs - runsAtStart, ctx);
      first = false;
      const pg = fld.pitcher;

      // 도루: 1루 주자, 2루가 비었을 때
      const r1 = bases[0];
      if (r1 && !bases[1] && rng.chance(r1.p.bat!.sbAtt * params.stealScale)) {
        const line = ctx.bat[r1.p.idx];
        if (rng.chance(r1.p.bat!.sbPct - fld.catcherDef * params.catcherStealPerRun)) {
          line.sb++;
          totals.sb++;
          bases[1] = r1;
          bases[0] = null;
        } else {
          line.cs++;
          totals.cs++;
          bases[0] = null;
          out(1);
          if (outs >= 3) break;
        }
      }

      // 폭투·포일·보크: 주자 전원 한 베이스씩
      if ((bases[0] || bases[1] || bases[2]) && rng.chance(ctx.env.wildPitch * Math.max(0.3, 1 - fld.catcherDef * params.catcherWildPitchPerRun))) {
        totals.wildPitches++;
        if (bases[2]) { score(bat, fld, bases[2], null); bases[2] = null; }
        if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
        if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
        if (walkOff()) return true;
      }

      const batter = bat.lineup[bat.spot];
      bat.spot = (bat.spot + 1) % 9;
      const bl = ctx.bat[batter.idx];
      bl.pa++;
      totals.pa++;
      pg.bf++;
      pg.line.bf++;

      // 희생번트: 무사, 주자 1루 또는 2루, 3루는 비었을 때. 약한 타자가 주로 댄다
      if (outs === 0 && !bases[2] && (bases[0] || bases[1]) && ctx.env.sac > 0) {
        const weak = batter.value < bat.medianValue ? 1.6 : 0.4;
        if (rng.chance(ctx.env.sac * params.sacBuntScale * weak)) {
          bl.sac++;
          totals.sac++;
          out(1);
          if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
          if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
          continue;
        }
      }
      const ev = samplePlateAppearance(batter, pg, bat.isHome, ctx, fld.def, {
        runnersOn: !!(bases[0] || bases[1] || bases[2]), scoring: !!(bases[1] || bases[2]), late: inning >= 7 && Math.abs(bat.runs - fld.runs) <= 2,
      });
      const me: Runner = { p: batter, resp: pg, earned: true };
      const speedAdj = (r: Runner) => (r.p.bat!.speed - 0.5) * 0.3;
      const twoOut = outs === 2 ? params.twoOutBonus : 0;
      /** 추가 진루 시도: 성공이면 true, 주루사면 아웃을 올리고 false */
      const tryAdvance = (): boolean => {
        if (!rng.chance(params.outOnAdvance)) return true;
        totals.outsOnBases++;
        out(1);
        return false;
      };

      switch (ev) {
        case Ev.SO:
          bl.ab++; bl.so++; pg.line.so++; totals.ab++; totals.so++;
          out(1);
          break;
        case Ev.BB:
        case Ev.HBP: {
          if (ev === Ev.BB) { bl.bb++; pg.line.bb++; totals.bb++; } else { bl.hbp++; pg.line.hbp++; totals.hbp++; }
          if (bases[0]) {
            if (bases[1]) {
              if (bases[2]) score(bat, fld, bases[2], bl);
              bases[2] = bases[1];
            }
            bases[1] = bases[0];
          }
          bases[0] = me;
          break;
        }
        case Ev.HR:
          bl.ab++; bl.h++; bl.hr++; pg.line.h++; pg.line.hr++; totals.ab++; totals.h++; totals.hr++;
          for (let i = 2; i >= 0; i--) {
            const r = bases[i];
            if (r) score(bat, fld, r, bl);
            bases[i] = null;
          }
          score(bat, fld, me, bl);
          break;
        case Ev.T3:
          bl.ab++; bl.h++; bl.t++; pg.line.h++; totals.ab++; totals.h++; totals.t++;
          for (let i = 2; i >= 0; i--) {
            const r = bases[i];
            if (r) score(bat, fld, r, bl);
            bases[i] = null;
          }
          bases[2] = me;
          break;
        case Ev.D2: {
          bl.ab++; bl.h++; bl.d++; pg.line.h++; totals.ab++; totals.h++; totals.d++;
          if (bases[2]) { score(bat, fld, bases[2], bl); bases[2] = null; }
          if (bases[1]) { score(bat, fld, bases[1], bl); bases[1] = null; }
          const f = bases[0];
          if (f) {
            bases[0] = null;
            if (rng.chance(params.firstToHomeOnDouble + twoOut + speedAdj(f))) {
              if (tryAdvance()) score(bat, fld, f, bl);
            } else bases[2] = f;
          }
          bases[1] = me;
          break;
        }
        case Ev.S1: {
          bl.ab++; bl.h++; pg.line.h++; totals.ab++; totals.h++;
          if (bases[2]) { score(bat, fld, bases[2], bl); bases[2] = null; }
          const s = bases[1];
          if (s) {
            bases[1] = null;
            if (rng.chance(params.secondToHomeOnSingle + twoOut + speedAdj(s))) {
              if (tryAdvance()) score(bat, fld, s, bl);
            } else bases[2] = s;
          }
          const f = bases[0];
          if (f) {
            bases[0] = null;
            if (!bases[2] && outs < 3 && rng.chance(params.firstToThirdOnSingle + twoOut * 0.5 + speedAdj(f))) {
              if (tryAdvance()) bases[2] = f;
            } else bases[1] = f;
          }
          bases[0] = me;
          break;
        }
        default: {
          // 인플레이 아웃이 될 타구
          bl.ab++; totals.ab++;
          if (rng.chance(ctx.env.roe * Math.max(0.3, 1 - fld.def * params.defenseHitPerRun * 3))) {
            // 실책 출루: 주자는 한 베이스씩, 타자 주자는 비자책
            totals.roe++;
            me.earned = false;
            if (outs === 2) halfUnearned = true;
            if (bases[2]) { score(bat, fld, bases[2], null); bases[2] = null; }
            if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
            if (bases[0]) { bases[1] = bases[0]; }
            bases[0] = me;
            break;
          }
          if (rng.chance(params.groundBallShare)) {
            // 땅볼
            if (bases[0] && outs < 2) {
              if (rng.chance(params.doublePlay)) {
                bl.gdp++; totals.gdp++;
                out(2);
                bases[0] = null;
                if (outs < 3) {
                  if (bases[2]) { score(bat, fld, bases[2], null); bases[2] = null; }
                  if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
                }
              } else {
                out(1);
                if (bases[2] && rng.chance(params.groundOutScores)) { score(bat, fld, bases[2], bl); bases[2] = null; }
                if (bases[1] && !bases[2]) { bases[2] = bases[1]; bases[1] = null; }
                // 절반은 선행 주자 포스아웃(타자 1루), 절반은 타자 아웃(주자 2루)
                if (rng.chance(0.5)) bases[0] = me;
                else if (!bases[1]) { bases[1] = bases[0]; bases[0] = null; }
              }
            } else {
              out(1);
              if (outs < 3) {
                if (bases[2] && rng.chance(params.groundOutScores)) { score(bat, fld, bases[2], bl); bases[2] = null; }
                if (bases[1] && !bases[2] && rng.chance(0.55)) { bases[2] = bases[1]; bases[1] = null; }
              }
            }
          } else {
            // 뜬공
            out(1);
            if (outs < 3) {
              const t = bases[2];
              if (t && rng.chance(params.sacFly + speedAdj(t))) {
                score(bat, fld, t, bl);
                bases[2] = null;
                bl.ab--; totals.ab--; bl.sf++; totals.sf++;
              }
              if (bases[1] && !bases[2] && rng.chance(0.2)) { bases[2] = bases[1]; bases[1] = null; }
            }
          }
        }
      }
      if (walkOff()) return true;
    }
    return false;
  };

  let inning = 0;
  const lineScore = { away: [] as number[], home: [] as number[] };
  for (;;) {
    inning++;
    const a0 = away.runs;
    playHalf(away, home, inning);
    lineScore.away.push(away.runs - a0);
    if (inning >= 9 && home.runs > away.runs) {
      lineScore.home.push(-1);
      break;
    }
    const h0 = home.runs;
    const walkOff = playHalf(home, away, inning);
    lineScore.home.push(home.runs - h0);
    if (walkOff) break;
    if (inning >= 9 && home.runs !== away.runs) break;
    if (inning >= ctx.maxInnings) break;
  }

  // ---- 경기 뒤 처리
  totals.games++;
  if (inning > 9) totals.extraInningGames++;
  const st = ctx.states;
  for (const side of [home, away]) {
    for (const pg of side.staff) {
      const i = pg.p.idx;
      if (pg.isStarter) st.lastStartDay[i] = ctx.day;
      st.fatigue[i] = currentFatigue(st, i, ctx.day) + pg.bf;
      st.streak[i] = st.fatigueDay[i] === ctx.day - 1 ? st.streak[i] + 1 : st.fatigueDay[i] === ctx.day ? Math.max(1, st.streak[i]) : 1;
      st.fatigueDay[i] = ctx.day;
    }
  }

  let win: number | null = null;
  let loss: number | null = null;
  let save: number | null = null;
  if (home.runs === away.runs) {
    totals.ties++;
  } else {
    const winner = home.runs > away.runs ? home : away;
    if (winner === home) totals.homeWins++;
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
  return {
    homeRuns: home.runs, awayRuns: away.runs, innings: inning, win, loss, save, lineScore,
    homeStaff: home.staff.map((x) => x.p.idx), awayStaff: away.staff.map((x) => x.p.idx),
  };
}
