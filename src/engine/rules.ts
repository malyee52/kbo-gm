// 공통 규칙 계층: 타석 전 주루(도루·폭투), 희생번트, 타석 결과에 따른 주자 진루·아웃·기록.
// 해결기가 무엇이든 같은 코드를 쓴다 (docs/경기엔진2_기획안.md 3.2).

import { Ball, battedBall, type BattedBall } from './battedball';
import type { PlayKind } from './game';
import { Ev, type PaRates } from './pa';
import type { GameState, PitcherInGame, Runner } from './state';
import type { BatLine, SimPlayer } from './types';

/** 구장 쪽 [좌익선 쪽, 가운데, 우익선 쪽]의 외야수 */
const OF_SIDE = ['LF', 'CF', 'RF'] as const;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 0.98 ? 0.98 : x);

/** 지휘한 희생번트가 성공할 확률 (임시값) */
export const BUNT_SUCCESS = 0.85;

/**
 * 도루: 1루 주자, 2루가 비었을 때. steal: go면 반드시, hold면 안 한다, 없으면 감독 판단.
 * 도루 실패로 이닝이 끝나면 true
 */
export function stealSecond(st: GameState, steal: 'go' | 'hold' | undefined): boolean {
  const { bases, bat, fld, ctx } = st;
  const { params, rng, totals } = ctx;
  const r1 = bases[0];
  const pg = fld.pitcher;
  if (r1 && !bases[1] && (steal === 'go' || (steal === undefined && rng.chance(r1.p.bat!.sbAtt * params.stealScale * (bat.ts.tactics?.steal ?? 1))))) {
    const line = ctx.bat[r1.p.idx];
    if (rng.chance(r1.p.bat!.sbPct - fld.catcherDef * params.catcherStealPerRun)) {
      line.sb++;
      totals.sb++;
      bases[1] = r1;
      bases[0] = null;
      st.note('SB', r1.p.idx, pg.p.idx, bat.runs);
    } else {
      line.cs++;
      totals.cs++;
      bases[0] = null;
      st.out(1);
      st.note('CS', r1.p.idx, pg.p.idx, bat.runs);
      if (st.outs >= 3) return true;
    }
  }
  return false;
}

/** 폭투·포일·보크: 주자 전원 한 베이스씩. 끝내기면 true */
export function wildPitch(st: GameState): boolean {
  const { bases, bat, fld, ctx } = st;
  if ((bases[0] || bases[1] || bases[2]) && ctx.rng.chance(ctx.env.wildPitch * Math.max(0.3, 1 - fld.catcherDef * ctx.params.catcherWildPitchPerRun))) {
    ctx.totals.wildPitches++;
    const r0 = bat.runs;
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

/** 지휘한 희생번트 (2아웃 전, 주자가 있을 때). 실패하면 타자만 아웃. 끝내기면 true */
export function orderedBunt(st: GameState, batter: SimPlayer, bl: BatLine, pg: PitcherInGame): boolean {
  const { bases, bat, ctx } = st;
  if (ctx.rng.chance(BUNT_SUCCESS)) {
    bl.sac++;
    ctx.totals.sac++;
    st.out(1);
    const r0 = bat.runs;
    if (bases[2] && st.outs < 3) { st.score(bases[2], bl); bases[2] = null; }
    if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
    if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
    st.note('SAC', batter.idx, pg.p.idx, r0);
    if (st.walkOff()) return true;
  } else {
    bl.ab++; ctx.totals.ab++;
    st.out(1);
    st.note('BF', batter.idx, pg.p.idx, bat.runs);
  }
  return false;
}

/** 감독 판단 희생번트: 무사, 주자 1루 또는 2루, 3루는 비었을 때. 약한 타자가 주로 댄다. 댔으면 true */
export function autoSacBunt(st: GameState, batter: SimPlayer, bl: BatLine, pg: PitcherInGame): boolean {
  const { bases, bat, ctx } = st;
  if (st.outs === 0 && !bases[2] && (bases[0] || bases[1]) && ctx.env.sac > 0) {
    const weak = batter.value < bat.medianValue ? 1.6 : 0.4;
    if (ctx.rng.chance(ctx.env.sac * ctx.params.sacBuntScale * weak * (bat.ts.tactics?.bunt ?? 1))) {
      bl.sac++;
      ctx.totals.sac++;
      st.out(1);
      if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
      if (bases[0]) { bases[1] = bases[0]; bases[0] = null; }
      st.note('SAC', batter.idx, pg.p.idx, bat.runs);
      return true;
    }
  }
  return false;
}

/**
 * 타석 결과를 경기에 적용한다: 인플레이 타구(타구 모형, 수비수가 안타 ↔ 아웃을 바꿈), 기록, 주자 진루, 인플레이 아웃 처리(실책·병살·희생플라이).
 * rates: 이 타석의 결과 확률 (나쁜 수비가 아웃을 안타로 바꿀 때 안타 ÷ 아웃 비). 없으면 리그 비율. 중계 기록 종류를 돌려준다
 */
export function applyPlateAppearance(st: GameState, ev: Ev, batter: SimPlayer, bl: BatLine, pg: PitcherInGame, intentional: boolean, rates: PaRates | null = null): PlayKind {
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
        if (rng.chance(params.firstToHomeOnDouble + twoOut + speedAdj(f) - arm)) {
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
        if (!bases[2] && st.outs < 3 && rng.chance(params.firstToThirdOnSingle * pp.firstToThirdSide[side] + twoOut * 0.5 + speedAdj(f) - arm)) {
          if (tryAdvance()) bases[2] = f;
        } else bases[1] = f;
      }
      bases[0] = me;
      break;
    }
    default: {
      // 인플레이 아웃이 될 타구
      bl.ab++; totals.ab++;
      if (rng.chance(ctx.env.roe * fld.errMult)) {
        // 실책 출루: 그 타구를 받은 수비수의 실책률로 (fieldDefense). 주자는 한 베이스씩, 타자 주자는 비자책
        totals.roe++;
        kind = 'E';
        let u = rng.next() * fld.errBy.reduce((s, x) => s + x.w, 0);
        st.errFielder = fld.errBy.find((x) => (u -= x.w) < 0)?.idx ?? fld.errBy.at(-1)?.idx ?? -1;
        if (st.errFielder >= 0 && ctx.errors) ctx.errors[st.errFielder] = (ctx.errors[st.errFielder] ?? 0) + 1;
        me.earned = false;
        if (st.outs === 2) st.halfUnearned = true;
        if (bases[2]) { st.score(bases[2], null); bases[2] = null; }
        if (bases[1]) { bases[2] = bases[1]; bases[1] = null; }
        if (bases[0]) { bases[1] = bases[0]; }
        bases[0] = me;
        break;
      }
      const slot = ball?.slot ?? 'SS';
      const depth = ball ? Math.floor(ball.zone / 3) : 2;
      if (ball?.type === Ball.GB) {
        // 땅볼: 병살은 받은 자리(유격·2루 쪽이 많다)와 타자 주력으로, 포스·야수선택(선행 주자 아웃, 타자 1루)도 받은 자리로
        const fs = slot as keyof typeof pp.dpSlot;
        if (bases[0] && st.outs < 2) {
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
  return kind;
}
