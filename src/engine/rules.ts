// 공통 규칙 계층: 타석 전 주루(도루·폭투), 희생번트, 타석 결과에 따른 주자 진루·아웃·기록.
// 해결기가 무엇이든 같은 코드를 쓴다 (docs/경기엔진2_기획안.md 3.2).

import { Ball, battedBall, errorPerBall, type BattedBall } from './battedball';
import type { PlayKind } from './game';
import { Ev, type PaRates } from './pa';
import { DEFAULT_PARAMS } from './params';
import { errorRateOf, fielderAt, type GameState, type PitcherInGame, type Runner } from './state';
import type { BatLine, LeagueEnv, SimPlayer } from './types';

/** 구장 쪽 [좌익선 쪽, 가운데, 우익선 쪽]의 외야수 */
const OF_SIDE = ['LF', 'CF', 'RF'] as const;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 0.98 ? 0.98 : x);

/** 실책·포일로 모든 주자가 n 베이스 더 간다 (타점 없음). 더 간 주자는 비자책으로 본다 (기록원 재구성의 근사, 엔진 2 7단계) */
function errorAdvance(st: GameState, n: number): void {
  const b = st.bases;
  for (let i = 2; i >= 0; i--) {
    const r = b[i];
    if (!r) continue;
    b[i] = null;
    r.earned = false;
    if (i + n >= 3) st.score(r, null);
    else b[i + n] = r;
  }
}

/** 지휘한 번트에서 주자가 한 베이스 이상 가는 몫 (성공 + 내야안타, 화면 안내용) */
export const BUNT_SUCCESS = 1 - DEFAULT_PARAMS.bunt.leadOut - DEFAULT_PARAMS.bunt.popOut - DEFAULT_PARAMS.bunt.dp;

/** 주루·작전 집계 (검증 도구용, 엔진 2 8단계). 저장하지 않는다 */
export interface RunTally {
  sb2: number; cs2: number; sb3: number; cs3: number; double: number; pickoff: number;
  pitchout: number; pitchoutRun: number; pitchoutCaught: number;
  hnr: number; hnrMiss: number; hnrFoul: number; hnrInPlay: number;
  bunt: number; buntSac: number; buntHit: number; buntLeadOut: number; buntPop: number; buntDp: number;
  squeeze: number; squeezeRun: number; buntPitches: number;
  /** 경기 중 교체 (엔진 2 9단계): 대타, 대주자, 대수비 */
  ph: number; pr: number; def: number;
}

export function emptyRunTally(): RunTally {
  return {
    sb2: 0, cs2: 0, sb3: 0, cs3: 0, double: 0, pickoff: 0, pitchout: 0, pitchoutRun: 0, pitchoutCaught: 0,
    hnr: 0, hnrMiss: 0, hnrFoul: 0, hnrInPlay: 0, bunt: 0, buntSac: 0, buntHit: 0, buntLeadOut: 0, buntPop: 0, buntDp: 0,
    squeeze: 0, squeezeRun: 0, buntPitches: 0, ph: 0, pr: 0, def: 0,
  };
}

/** 도루 한 번: 성공이면 주자를 to 베이스로, 실패면 아웃. 이닝이 끝나면 true */
export function stealOne(st: GameState, from: 0 | 1, pct: number): boolean {
  const { bases, bat, fld, ctx } = st;
  const r = bases[from]!;
  const line = ctx.bat[r.p.idx];
  const run = ctx.running;
  bases[from] = null;
  if (ctx.rng.chance(pct)) {
    line.sb++;
    ctx.totals.sb++;
    bases[from + 1] = r;
    if (run) { if (from === 0) run.sb2++; else run.sb3++; }
    st.note('SB', r.p.idx, fld.pitcher.p.idx, bat.runs);
    return false;
  }
  line.cs++;
  ctx.totals.cs++;
  if (run) { if (from === 0) run.cs2++; else run.cs3++; }
  st.out(1);
  st.note('CS', r.p.idx, fld.pitcher.p.idx, bat.runs);
  return st.outs >= 3;
}

/** 주자의 도루 성공률 (포수 수비, 좌투수, 피치아웃, 3루 도루 보정) */
export function stealPct(st: GameState, r: Runner, third: boolean, extra = 0): number {
  const { params } = st.ctx;
  const run = params.run;
  return r.p.bat!.sbPct + (st.ctx.sbShift ?? 0) - st.fld.catcherDef * params.catcherStealPerRun
    + (third ? run.thirdPct : st.fld.pitcher.p.throws === 'L' ? run.leftyPct : run.rightyPct) + extra;
}

/**
 * 리그 도루 환경 (2026-10-23): 선수 성공률은 직전 시즌들 기록이라 리그 성공률이 해마다 오르내리는 몫(2022 0.709 → 2025 0.749, 2009 0.726 → 2012 0.690)을 못 따라간다.
 * 그 해 리그 성공률(env.sbPct)과 선수 성공률 평균(도루 시도율 × 표본 타석 가중, 표본 600타석까지)의 차. 리그 성공률을 모르면 0.
 * 다른 환경 값(희생번트·폭투)처럼 그 해 리그 값에 맞춘다
 */
export function sbShiftOf(players: readonly SimPlayer[], env: LeagueEnv): number {
  if (!env.sbPct) return 0;
  let w = 0;
  let s = 0;
  for (const p of players) {
    if (p.isPitcher || !p.bat) continue;
    const x = p.bat.sbAtt * Math.min(600, Math.max(50, p.bat.sample));
    w += x;
    s += x * p.bat.sbPct;
  }
  return w > 0 ? env.sbPct - s / w : 0;
}

/**
 * 견제사 (엔진 2 8단계): 도루할 수 있는 1루 주자(2루 빔)가 있는 타석마다 주자의 도루 시도율과 투수 손으로. 이닝이 끝나면 true
 */
export function pickoff(st: GameState): boolean {
  const { bases, bat, fld, ctx } = st;
  const run = ctx.params.run;
  const r1 = bases[0];
  if (!r1 || bases[1]) return false;
  const lefty = fld.pitcher.p.throws === 'L';
  if (!ctx.rng.chance(run.pickoff * Math.min(3, r1.p.bat!.sbAtt / 0.05) * (lefty ? run.leftyPickoff : 1))) return false;
  bases[0] = null;
  ctx.totals.outsOnBases++;
  if (ctx.running) ctx.running.pickoff++;
  st.out(1);
  st.note('PO', r1.p.idx, fld.pitcher.p.idx, bat.runs);
  return st.outs >= 3;
}

/** 피치아웃 (AI 감독, 엔진 2 8단계): 도루 시도율이 높은 1루 주자(2루 빔), 2아웃 전. 걸면 true (공 하나는 볼) */
export function wantPitchout(st: GameState): boolean {
  const { bases, ctx } = st;
  const run = ctx.params.run;
  const r1 = bases[0];
  if (!r1 || bases[1] || st.outs >= 2 || r1.p.bat!.sbAtt < run.pitchoutThreat || !ctx.rng.chance(run.pitchout)) return false;
  if (ctx.running) ctx.running.pitchout++;
  return true;
}

/**
 * 도루 (엔진 2 8단계): 1루 주자(2루 빔)의 2루 도루, 2루 주자(3루 빔)의 3루 도루, 1·2루의 이중 도루.
 * steal: go면 1루 주자가 반드시, hold면 아무도 안 뛴다, 없으면 감독 판단 (3루·이중 도루는 감독 판단일 때만).
 * pitchout: 피치아웃 공이면 성공률이 준다. 도루 실패로 이닝이 끝나면 true
 */
export function steals(st: GameState, steal: 'go' | 'hold' | undefined, pitchout = false): boolean {
  const { bases, bat, fld, ctx } = st;
  const { params, rng } = ctx;
  const run = params.run;
  const tac = bat.ts.tactics?.steal ?? 1;
  const out = pitchout ? run.pitchoutPct : 0;
  const r1 = bases[0];
  const r2 = bases[1];
  if (r1 && !r2) {
    const lefty = fld.pitcher.p.throws === 'L';
    if (steal === 'go' || (steal === undefined && rng.chance(r1.p.bat!.sbAtt * params.stealScale * tac * (lefty ? run.leftyAttempt : 1)))) {
      if (pitchout && ctx.running) ctx.running.pitchoutRun++;
      const end = stealOne(st, 0, stealPct(st, r1, false, out));
      if (pitchout && ctx.running && !bases[1]) ctx.running.pitchoutCaught++;
      return end;
    }
    return false;
  }
  if (steal !== undefined || !r2 || bases[2] || !rng.chance(r2.p.bat!.sbAtt * params.stealScale * tac * run.thirdShare)) return false;
  if (r1) {
    // 1·2루: 이중 도루만 (2루 주자 혼자 3루로 뛰면 1루 주자가 묶인다). 포수는 3루로 던진다: 선행 주자가 잡혀도 1루 주자는 2루에
    if (!rng.chance(run.double)) return false;
    if (ctx.running) ctx.running.double++;
    const caught = stealOne(st, 1, stealPct(st, r2, true));
    if (caught) return true;
    // 선행 주자가 잡히면 뒤 주자는 도루가 아니다 (야수선택으로 진루)
    if (!bases[2]) { bases[1] = r1; bases[0] = null; return false; }
    return stealOne(st, 0, 1);
  }
  return stealOne(st, 1, stealPct(st, r2, true));
}

/** 폭투·포일·보크: 주자 전원 한 베이스씩. 투수 제구(볼넷 배율)가 나쁠수록 잦다 (엔진 2 8단계). 끝내기면 true */
export function wildPitch(st: GameState): boolean {
  const { bases, bat, fld, ctx } = st;
  const control = Math.min(2.5, Math.max(0.4, (fld.pitcher.p.pit?.bb ?? 1) ** ctx.params.run.wildPitchControl));
  if ((bases[0] || bases[1] || bases[2]) && ctx.rng.chance(ctx.env.wildPitch * control * Math.max(0.3, 1 - fld.catcherDef * ctx.params.catcherWildPitchPerRun))) {
    ctx.totals.wildPitches++;
    const r0 = bat.runs;
    // 포일 몫 (엔진 2 7단계, 임시값): 포일로 들어온 3루 주자의 득점은 비자책. 다른 주자는 그대로 둔다
    // (누상 주자를 모두 비자책으로 굳히면 시대와 관계없이 비자책이 일정량 늘어 2012년이 +19%였다)
    if (ctx.rng.chance(ctx.params.error.passedBall) && bases[2]) bases[2].earned = false;
    if (bases[2]) { st.score(bases[2], null); bases[2] = null; }
    if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
    if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
    st.note('WP', -1, fld.pitcher.p.idx, r0);
    if (st.walkOff()) return true;
  }
  return false;
}

/** 타석을 시작한다: 타순을 넘기고 타석·상대 타자 수를 센다 */
export function beginPlateAppearance(st: GameState): { batter: SimPlayer; bl: BatLine; pg: PitcherInGame } {
  const { bat, ctx } = st;
  const pg = st.fld.pitcher;
  const batter = bat.lineup[bat.spot];
  bat.spot = (bat.spot + 1) % 9;
  const bl = ctx.bat[batter.idx];
  bl.pa++;
  ctx.totals.pa++;
  pg.bf++;
  pg.line.bf++;
  return { batter, bl, pg };
}

/** 번트 타석의 투구 수 (HF 투구 자료 희생번트 타석 분포, params.bunt.pitches) */
export function buntPitches(st: GameState): number {
  const p = st.ctx.params.bunt.pitches;
  let u = st.ctx.rng.next() * p.reduce((a, b) => a + b, 0);
  let n = p.length;
  for (let i = 0; i < p.length; i++) if ((u -= p[i]) < 0) { n = i + 1; break; }
  if (st.ctx.running) st.ctx.running.buntPitches += n;
  return n;
}

/** 모든 주자 한 베이스 (3루 주자 득점, rbi가 있으면 타점) */
function advanceAll(st: GameState, rbi: BatLine | null): void {
  const b = st.bases;
  if (b[2]) { st.score(b[2], rbi); b[2] = null; }
  if (b[1]) { b[2] = b[1]; b[1] = null; }
  if (b[0]) { b[1] = b[0]; b[0] = null; }
}

/**
 * 번트 한 번 (엔진 2 8단계): 희생번트(성공·내야안타·선행 주자 포스아웃·타자 아웃·병살), 3루 주자가 있으면 스퀴즈(성공·홈 아웃·병살).
 * 결과 몫은 params.bunt (임시값). 끝내기면 true
 */
function bunt(st: GameState, batter: SimPlayer, bl: BatLine, pg: PitcherInGame): boolean {
  const { bases, bat, ctx } = st;
  const { rng, totals } = ctx;
  const b = ctx.params.bunt;
  const run = ctx.running;
  const r0 = bat.runs;
  const me: Runner = { p: batter, resp: pg, earned: true };
  const asOut = () => { bl.ab++; totals.ab++; };
  if (run) run.bunt++;
  if (bases[2] && st.outs < 2) {
    // 스퀴즈: 성공이면 3루 주자 득점(희생번트·타점), 실패면 3루 주자 홈 아웃(타자 1루) 또는 뜬공 병살
    if (run) run.squeeze++;
    const u = rng.next();
    if (u < b.squeezeOut) {
      asOut();
      bases[2] = null;
      st.out(1);
      if (st.outs < 3) { advanceAll(st, null); bases[0] = me; }
      st.note('BF', batter.idx, pg.p.idx, r0);
      return false;
    }
    if (u < b.squeezeOut + b.squeezeDp) {
      asOut();
      bases[2] = null;
      st.out(2);
      st.note('BF', batter.idx, pg.p.idx, r0);
      return false;
    }
    bl.sac++; totals.sac++;
    st.out(1);
    if (run) run.squeezeRun++;
    advanceAll(st, bl);
    st.note('SAC', batter.idx, pg.p.idx, r0);
    return st.walkOff();
  }
  const u = rng.next();
  const hit = b.hit * batter.bat!.speed / 0.5;
  if (u < hit) {
    bl.ab++; bl.h++; pg.line.h++; totals.ab++; totals.h++;
    if (run) run.buntHit++;
    advanceAll(st, bl);
    bases[0] = me;
    st.note('1B', batter.idx, pg.p.idx, r0);
    return st.walkOff();
  }
  if (u < hit + b.leadOut) {
    // 선행 주자 포스아웃 (1루 주자는 2루에서, 2루 주자는 3루에서), 뒤 주자는 한 베이스, 타자 1루
    asOut();
    if (run) run.buntLeadOut++;
    const lead = bases[1] ? 1 : 0;
    bases[lead] = null;
    st.out(1);
    if (st.outs < 3) { advanceAll(st, null); bases[0] = me; }
    st.note('BF', batter.idx, pg.p.idx, r0);
    return st.walkOff();
  }
  if (u < hit + b.leadOut + b.popOut) {
    asOut();
    if (run) run.buntPop++;
    st.out(1);
    st.note('BF', batter.idx, pg.p.idx, r0);
    return false;
  }
  if (u < hit + b.leadOut + b.popOut + b.dp) {
    // 뜬공 병살 (타자와 선행 주자)
    asOut();
    if (run) run.buntDp++;
    bases[bases[1] ? 1 : 0] = null;
    st.out(2);
    st.note('BF', batter.idx, pg.p.idx, r0);
    return false;
  }
  bl.sac++; totals.sac++;
  if (run) run.buntSac++;
  st.out(1);
  if (st.outs < 3) advanceAll(st, bl);
  st.note('SAC', batter.idx, pg.p.idx, r0);
  return st.walkOff();
}

/** 지휘한 번트 (2아웃 전, 주자가 있을 때). 3루 주자가 있으면 스퀴즈. 끝내기면 true */
export function orderedBunt(st: GameState, batter: SimPlayer, bl: BatLine, pg: PitcherInGame): boolean {
  return bunt(st, batter, bl, pg);
}

/**
 * 감독 판단 번트. 희생번트: 무사, 주자 1루 또는 2루, 3루는 비었을 때, 약한 타자가 주로 댄다.
 * 스퀴즈: 3루 주자, 2아웃 전, 7회 이후 1점 차 이내, 약한 타자. 댔으면 결과(끝내기면 true), 안 댔으면 null
 */
export function autoBunt(st: GameState, batter: SimPlayer, bl: BatLine, pg: PitcherInGame): boolean | null {
  const { bases, bat, fld, ctx } = st;
  if (ctx.env.sac <= 0) return null;
  const weak = batter.value < bat.medianValue;
  const tac = bat.ts.tactics?.bunt ?? 1;
  if (st.outs === 0 && !bases[2] && (bases[0] || bases[1])) {
    if (!ctx.rng.chance(ctx.env.sac * ctx.params.sacBuntScale * (weak ? 1.6 : 0.4) * tac)) return null;
    return bunt(st, batter, bl, pg);
  }
  if (bases[2] && st.outs < 2 && st.inning >= 7 && Math.abs(bat.runs - fld.runs) <= 1 && weak && ctx.rng.chance(ctx.params.bunt.squeeze * tac)) {
    return bunt(st, batter, bl, pg);
  }
  return null;
}

/**
 * 타석 결과를 경기에 적용한다: 인플레이 타구(타구 모형, 수비수가 안타 ↔ 아웃을 바꿈), 기록, 주자 진루, 인플레이 아웃 처리(실책·병살·희생플라이).
 * rates: 이 타석의 결과 확률 (나쁜 수비가 아웃을 안타로 바꿀 때 안타 ÷ 아웃 비). 없으면 리그 비율. 중계 기록 종류를 돌려준다.
 * going: 히트앤드런으로 1루 주자가 뛰고 있다 (병살 없음, 안타에 한 베이스 더, 라이너에 귀루 실패, 엔진 2 8단계)
 */
export function applyPlateAppearance(st: GameState, ev: Ev, batter: SimPlayer, bl: BatLine, pg: PitcherInGame, intentional: boolean, rates: PaRates | null = null,
  going = false): PlayKind {
  const { bases, fld, ctx } = st;
  const { params, rng, totals } = ctx;
  const me: Runner = { p: batter, resp: pg, earned: true };
  // 인플레이 타구 (홈런 제외): 유형·방향·담당 수비수. 양타는 투수 손의 반대쪽 타석, 모르면 우타.
  // 땅볼 성향 = 그 해 리그 값 × 타자 × 투수 (엔진 2 6단계)
  let ball: BattedBall | null = null;
  if (ev === Ev.S1 || ev === Ev.D2 || ev === Ev.T3 || ev === Ev.OUT) {
    const pullLeft = batter.bats === 'L' ? false : batter.bats === 'S' ? pg.p.throws === 'L' : true;
    const gb = (ctx.env.gbOdds ?? 1) * (batter.bat!.gb ?? 1) * (pg.skill.gb ?? 1);
    ball = battedBall(ev, rates, ctx.league, pullLeft, (s) => fld.slotDef[s as keyof typeof fld.slotDef] ?? 0, params, rng, gb);
    ev = ball.ev;
    const t = ctx.balls;
    if (t) {
      t.type[ball.type]++;
      if (ev === Ev.OUT) t.outType[ball.type]++;
      t.dir[ball.dir]++;
      t.slot[ball.slot] = (t.slot[ball.slot] ?? 0) + 1;
      if (ball.converted) { if (ev === Ev.OUT) t.toOut++; else t.toHit++; }
    }
  }
  const pp = params.play;
  /** 공이 간 구장 쪽 (0 좌익, 1 중견, 2 우익)과 그쪽 외야수의 어깨 보정 (수비 런으로 추정, + 면 주자가 덜 간다) */
  const side = ball ? ball.zone % 3 : 1;
  const arm = (fld.slotDef[OF_SIDE[side]] ?? 0) * pp.armPerRun;
  let kind: PlayKind = ev === Ev.SO ? 'SO' : ev === Ev.BB ? (intentional ? 'IBB' : 'BB') : ev === Ev.HBP ? 'HBP' : ev === Ev.HR ? 'HR' : ev === Ev.T3 ? '3B' : ev === Ev.D2 ? '2B' : ev === Ev.S1 ? '1B' : 'GO';
  const speedAdj = (r: Runner) => (r.p.bat!.speed - 0.5) * 0.3;
  const twoOut = st.outs === 2 ? params.twoOutBonus : 0;
  const hnrExtra = going ? params.run.hnrExtra : 0;
  /** 추가 진루 시도: 성공이면 true, 주루사면 아웃을 올리고 false */
  const tryAdvance = (): boolean => {
    if (!rng.chance(params.outOnAdvance)) return true;
    totals.outsOnBases++;
    st.out(1);
    return false;
  };

  switch (ev) {
    case Ev.SO:
      bl.ab++; bl.so++; pg.line.so++; totals.ab++; totals.so++;
      st.out(1);
      break;
    case Ev.BB:
    case Ev.HBP: {
      if (ev === Ev.BB) { bl.bb++; pg.line.bb++; totals.bb++; } else { bl.hbp++; pg.line.hbp++; totals.hbp++; }
      if (bases[0]) {
        if (bases[1]) {
          if (bases[2]) st.score(bases[2], bl);
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
        if (r) st.score(r, bl);
        bases[i] = null;
      }
      st.score(me, bl);
      break;
    case Ev.T3:
      bl.ab++; bl.h++; bl.t++; pg.line.h++; totals.ab++; totals.h++; totals.t++;
      for (let i = 2; i >= 0; i--) {
        const r = bases[i];
        if (r) st.score(r, bl);
        bases[i] = null;
      }
      bases[2] = me;
      break;
    case Ev.D2: {
      bl.ab++; bl.h++; bl.d++; pg.line.h++; totals.ab++; totals.h++; totals.d++;
      if (bases[2]) { st.score(bases[2], bl); bases[2] = null; }
      if (bases[1]) { st.score(bases[1], bl); bases[1] = null; }
      const f = bases[0];
      if (f) {
        bases[0] = null;
        if (rng.chance(params.firstToHomeOnDouble + twoOut + hnrExtra + speedAdj(f) - arm)) {
          if (tryAdvance()) st.score(f, bl);
        } else bases[2] = f;
      }
      bases[1] = me;
      break;
    }
    case Ev.S1: {
      bl.ab++; bl.h++; pg.line.h++; totals.ab++; totals.h++;
      if (bases[2]) { st.score(bases[2], bl); bases[2] = null; }
      const s = bases[1];
      if (s) {
        bases[1] = null;
        if (rng.chance(params.secondToHomeOnSingle + twoOut + speedAdj(s) - arm)) {
          if (tryAdvance()) st.score(s, bl);
        } else bases[2] = s;
      }
      const f = bases[0];
      if (f) {
        bases[0] = null;
        if (!bases[2] && st.outs < 3 && rng.chance(params.firstToThirdOnSingle * pp.firstToThirdSide[side] + twoOut * 0.5 + hnrExtra + speedAdj(f) - arm)) {
          if (tryAdvance()) bases[2] = f;
        } else bases[1] = f;
      }
      bases[0] = me;
      break;
    }
    default: {
      // 인플레이 아웃이 될 타구
      bl.ab++; totals.ab++;
      const slot = ball?.slot ?? 'SS';
      const depth = ball ? Math.floor(ball.zone / 3) : 2;
      const pe = params.error;
      if (rng.chance(ctx.env.roe * pe.norm * errorPerBall(ctx.league, params)[slot] * errorRateOf(fld.slotDef[slot as keyof typeof fld.slotDef] ?? 0))) {
        // 실책 출루 (엔진 2 7단계): 타구를 맡은 수비수가 자기 실책률로. 땅볼은 송구·포구 실책, 공중 타구는 포구 실책.
        // 주자는 한 베이스씩, 송구 실책과 외야 포구 실책은 확률로 모두 한 베이스 더. 타자 주자는 비자책, 실책은 이닝 재구성의 아웃 하나 (errOuts)
        totals.roe++;
        kind = 'E';
        st.errFielder = fielderAt(fld, slot);
        if (st.errFielder >= 0 && ctx.errors) ctx.errors[st.errFielder] = (ctx.errors[st.errFielder] ?? 0) + 1;
        me.earned = false;
        st.errOuts++;
        const extra = rng.chance(ball?.type === Ball.GB ? (pe.throwShare[slot] ?? 0) * pe.throwExtra : depth === 2 ? pe.outfieldExtra : 0);
        if (bases[2]) { st.score(bases[2], null); bases[2] = null; }
        if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
        if (bases[0]) { bases[1] = bases[0]; }
        bases[0] = me;
        if (extra) errorAdvance(st, 1);
        break;
      }
      if (ball?.type === Ball.GB) {
        // 땅볼: 병살은 받은 자리(유격·2루 쪽이 많다)와 타자 주력으로, 포스·야수선택(선행 주자 아웃, 타자 1루)도 받은 자리로
        const fs = slot as keyof typeof pp.dpSlot;
        if (going && bases[0]) {
          // 히트앤드런: 1루 주자가 이미 뛰어 병살·포스아웃이 없다. 타자 아웃, 주자 2루
          st.out(1);
          if (st.outs < 3) {
            if (bases[2] && rng.chance(params.groundOutScores + speedAdj(bases[2]))) { st.score(bases[2], bl); bases[2] = null; }
            if (!bases[1]) { bases[1] = bases[0]; bases[0] = null; }
          }
        } else if (bases[0] && st.outs < 2) {
          if (rng.chance(params.doublePlay * (pp.dpSlot[fs] ?? 1) * (1 - pp.dpSpeed * (batter.bat!.speed - 0.5) * 2))) {
            bl.gdp++; totals.gdp++;
            kind = 'GDP';
            st.out(2);
            bases[0] = null;
            if (st.outs < 3) {
              if (bases[2]) { st.score(bases[2], null); bases[2] = null; }
              if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
            }
          } else {
            st.out(1);
            if (bases[2] && rng.chance(params.groundOutScores + speedAdj(bases[2]))) { st.score(bases[2], bl); bases[2] = null; }
            if (bases[1] && !bases[2]) { bases[2] = bases[1]; bases[1] = null; }
            // 선행 주자 포스아웃(타자 1루) 또는 타자 아웃(주자 2루)
            if (rng.chance(pp.forceLead[fs] ?? 0.5)) bases[0] = me;
            else if (!bases[1]) { bases[1] = bases[0]; bases[0] = null; }
          }
        } else {
          st.out(1);
          if (st.outs < 3) {
            if (bases[2] && rng.chance(params.groundOutScores + speedAdj(bases[2]))) { st.score(bases[2], bl); bases[2] = null; }
            // 2루 주자는 오른쪽 땅볼에 3루로 간다 (자기 앞·왼쪽 땅볼에는 묶인다)
            if (bases[1] && !bases[2] && rng.chance(pp.groundAdvance[fs] ?? 0.5)) { bases[2] = bases[1]; bases[1] = null; }
          }
        }
      } else {
        // 뜬공·라인드라이브: 내야 공중(내야 뜬공·내야수 라이너)은 주자가 못 간다. 외야는 희생플라이·2루 주자 태그업을 구장 쪽·어깨·주력으로
        kind = 'FO';
        st.out(1);
        // 히트앤드런 라이너: 뛰던 1루 주자가 못 돌아와 아웃
        if (going && bases[0] && st.outs < 3 && ball?.type === Ball.LD && rng.chance(params.run.hnrDoubledOff)) {
          bases[0] = null;
          totals.outsOnBases++;
          st.out(1);
        }
        if (st.outs < 3 && depth === 2) {
          const line = ball?.type === Ball.LD ? pp.sfLineDrive : 1;
          const t = bases[2];
          if (t && rng.chance(clamp01(params.sacFly * pp.sfSide[side] * line + speedAdj(t) - arm))) {
            st.score(t, bl);
            bases[2] = null;
            bl.ab--; totals.ab--; bl.sf++; totals.sf++;
            kind = 'SF';
          }
          if (bases[1] && !bases[2] && rng.chance(clamp01(pp.flyAdvance[side] * line - arm))) { bases[2] = bases[1]; bases[1] = null; }
        }
      }
    }
  }
  // 외야 안타에 외야수 실책 (공 빠뜨림·송구, 엔진 2 7단계): 모든 주자가 한 베이스 더. 실책은 그 외야수에게, 실책 출루 수에는 넣지 않는다
  if (ball && (ev === Ev.S1 || ev === Ev.D2) && Math.floor(ball.zone / 3) === 2 && st.outs < 3
    && rng.chance(ctx.env.roe * params.error.onHit * errorRateOf(fld.slotDef[ball.slot as keyof typeof fld.slotDef] ?? 0))) {
    const f = fielderAt(fld, ball.slot);
    if (f >= 0 && ctx.errors) ctx.errors[f] = (ctx.errors[f] ?? 0) + 1;
    errorAdvance(st, 1);
  }
  return kind;
}
