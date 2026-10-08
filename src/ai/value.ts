// 선수 가치와 구단 전력. 트레이드에 쓰고, 이후 드래프트·FA(M5)에서도 같은 함수를 쓴다 (기획서 10장).
//
// 단위는 "대체 선수 대비 한 시즌 득점 기여"(런). 1군 주전급 평균이 대략 10~20런이다.
// - 현재 능력: 엔진의 기대 타석 가치(batValue·pitValue)를 대체 선수와 비교해 한 시즌 출전량을 곱한다.
// - 잠재력: 선수별 잠재력(전성기 기여)이 있으면 성장 판정과 같은 식의 기댓값으로, 없으면 나이별 연간 변화량으로 향후 시즌을 추정한다.
// - 연봉 부담: 트레이드 판단(trade.ts)에서 연봉을 런으로 바꿔 뺀다.
// - 포지션 희소성: 선수 가치에는 포지션 보정을, 구단 전력에는 "그 자리를 맡을 선수가 없을 때의 손해"를 넣는다.

import { assignSlots, batValue, defenseAt, fieldPosOf, pitValue, type SimPlayer, type Slot, type World } from '../engine';

/** 선형 가중치(wOBA 계열)를 득점으로 바꾸는 배율. 공개된 세이버메트릭스 상수의 근사값 */
export const WOBA_SCALE = 1.2;
/** 한 시즌 출전량 (임시값) */
const FULL_PA = 600;
const STARTS_PER_SEASON = 28;
const RELIEF_APPEARANCES = 60;
/** 구원 투수는 접전 후반에 나오는 몫을 더 쳐준다 (임시값) */
const RELIEF_LEVERAGE = 1.3;
/** 포지션 보정 (600타석당 런). 공개된 세이버메트릭스 상수의 근사값 */
const POS_ADJ: Record<string, number> = {
  C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5, IF: 2.5, OF: -5,
};

/**
 * 31~35세의 연간 하락 (런/시즌, 리그 평균 주전 기준). tools/fit_aging.ts의 델타 방식 추정값 (reports/aging-fit.txt).
 * 색인 0 = 31세. 투수가 타자보다 일찍, 크게 떨어진다.
 */
const DECLINE_BAT = [-2, -3, -3.6, -4.3, -4.2];
const DECLINE_PIT = [-4.2, -3.5, -4.5, -6.4, -6.5];

/**
 * 나이별 연간 능력 변화량 (런/시즌). 잠재력이 없는 선수와 31세 이상의 하락에 쓴다.
 * 30세 이하는 임시값. 31~35세는 실제 기록에서 추정한 값, 36세 이상은 생존 편향 때문에 데이터가 하락을 작게 잡아서 임시값.
 */
export function agingDelta(age: number, isPitcher = false): number {
  if (age <= 23) return 6;
  if (age <= 26) return 3;
  if (age <= 30) return 0;
  if (age <= 35) return (isPitcher ? DECLINE_PIT : DECLINE_BAT)[age - 31];
  if (age <= 37) return isPitcher ? -7 : -6;
  return -9;
}

/** 나이를 모르는 선수는 이 나이로 본다 */
export const DEFAULT_AGE = 28;

/**
 * 한 해 동안의 기대 성장 (런). 성장 판정(league/growth.ts)이 여기에 출전 기회와 운을 더한다.
 * 27세까지는 잠재력과의 격차를 빠르게, 28~30세는 천천히 좁히고, 31세부터는 나이에 따라 떨어진다 (임시값).
 * 잠재력보다 이미 높으면 그 차이의 20%만큼 내려온다.
 */
export function expectedGrowth(age: number, runs: number, potential: number, isPitcher = false): number {
  if (age >= 31) return agingDelta(age, isPitcher);
  const gap = potential - runs;
  if (gap < 0) return gap * 0.2;
  const rate = age <= 22 ? 0.35 : age <= 25 ? 0.3 : age <= 27 ? 0.2 : 0.1;
  return gap * rate;
}
/** 앞으로 몇 시즌을 내다보는지 (이번 시즌 포함) */
export const HORIZON = 4;

export interface ValueContext {
  world: World;
  /** 대체 선수의 타석 가치 (규정급 타자 하위 10% 수준) */
  replBat: number;
  /** 대체 선수의 피타석 가치 (규정급 투수 하위 10% 수준, 클수록 나쁨) */
  replPit: number;
  /** 선수 id → 잠재력 (런). 없으면 나이별 변화량으로 추정 */
  potential?: Map<string, number>;
  /** 선수 id → 연봉 (만 원, 외국인은 달러를 원화 환산하지 않고 빼둔다). 없으면 연봉 부담을 보지 않는다 */
  salary?: Map<string, number>;
}

/**
 * 대체 선수 수준 = 리그 평균 선수(모든 비율 1.00)의 가치 × 이 비율.
 * 2010~2026년 실제 월드에서 "규정급(타자 300타석·투수 상대 타자 200명 이상) 하위 10%"를 잰 값의 평균이다.
 * 해마다 타자 0.81~0.84, 투수 1.13~1.16으로 거의 일정하다.
 * 선수 표본으로 해마다 재면 여러 해 진행 때 가상 선수(표본 0)만 남으면서 기준이 무너지므로(M6 장기 시뮬레이션에서 발견) 고정 비율로 둔다.
 */
export const REPL_BAT_RATIO = 0.823;
export const REPL_PIT_RATIO = 1.143;
const AVG_BAT = { so: 1, bb: 1, hbp: 1, hr: 1, s1: 1, d2: 1, t3: 1, sbAtt: 0, sbPct: 0.7, speed: 0.5, sample: 0 };
const AVG_PIT = { so: 1, bb: 1, hbp: 1, hr: 1, hit: 1, stamina: 22, reliefStint: 5, startShare: 0, sample: 0 };

export function valueContext(world: World): ValueContext {
  return {
    world,
    replBat: REPL_BAT_RATIO * batValue(AVG_BAT, world.league),
    replPit: REPL_PIT_RATIO * pitValue(AVG_PIT, world.league),
  };
}

export type PitchRole = 'SP' | 'RP';

export function isStarter(p: SimPlayer): boolean {
  return p.isPitcher && (p.pit?.startShare ?? 0) >= 0.5;
}

/** 타자의 이번 시즌 타격 기여 (포지션 보정 없음) */
function batRuns(p: SimPlayer, ctx: ValueContext): number {
  return ((p.value - ctx.replBat) / WOBA_SCALE) * FULL_PA;
}

/** 투수의 한 시즌 기여. role을 주지 않으면 선발 비율로 정한다 */
export function pitRuns(p: SimPlayer, ctx: ValueContext, role: PitchRole = isStarter(p) ? 'SP' : 'RP'): number {
  const s = p.pit!;
  const per = (ctx.replPit - p.value) / WOBA_SCALE;
  return role === 'SP' ? per * s.stamina * STARTS_PER_SEASON : per * s.reliefStint * RELIEF_APPEARANCES * RELIEF_LEVERAGE;
}

/** 주 포지션 수비 런 (지명타자는 0) */
function primaryDefense(p: SimPlayer): number {
  return p.pos === 'DH' ? 0 : defenseAt(p, fieldPosOf(p.pos));
}

/** 지금 능력 기준 한 시즌 기여 (런). 타자는 포지션 보정과 주 포지션 수비 포함 */
export function currentRuns(p: SimPlayer, ctx: ValueContext): number {
  if (p.isPitcher) return pitRuns(p, ctx);
  return batRuns(p, ctx) + ((POS_ADJ[p.pos ?? ''] ?? 0) + primaryDefense(p)) * (FULL_PA / 600);
}

/** y시즌 뒤(0 = 이번 시즌)의 추정 기여 변화량. ctx에 잠재력이 있으면 성장 기댓값으로 계산한다 */
export function agingShift(p: SimPlayer, y: number, ctx?: ValueContext): number {
  if (y === 0) return 0;
  let age = p.age ?? DEFAULT_AGE;
  const pot = ctx?.potential?.get(p.id);
  if (pot === undefined || !ctx) {
    let shift = 0;
    for (let k = 0; k < y; k++) shift += agingDelta(age++, p.isPitcher);
    return shift;
  }
  const start = currentRuns(p, ctx);
  let r = start;
  for (let k = 0; k < y; k++) r += expectedGrowth(++age, r, pot, p.isPitcher);
  return r - start;
}

/**
 * 선수 한 명의 가치: 시즌별 추정 기여를 가중 합한 값.
 * weights[y]는 y시즌 뒤의 가중치. 구단 성향(우승 도전·리빌딩)에 따라 다르다.
 */
export function playerValue(p: SimPlayer, ctx: ValueContext, weights: number[]): number {
  const now = currentRuns(p, ctx);
  let v = 0;
  for (let y = 0; y < weights.length; y++) v += weights[y] * Math.max(-5, now + agingShift(p, y, ctx));
  return v;
}

/** 전력 계산에서 주전 아닌 선수에게 주는 몫 (부상 대비 등, 임시값) */
const DEPTH_SHARE = 0.15;
const BENCH_HITTERS = 4;
const ROTATION = 5;
const SPARE_STARTERS = 2;
const BULLPEN = 7;
const SPARE_RELIEVERS = 3;

/**
 * y시즌 뒤 구단 전력 (런). 주전 9명 + 선발 5명 + 구원 7명의 기여와 예비 선수의 일부.
 * 주전 배치는 AI 감독과 같은 규칙(희소한 자리부터 타격 + 그 자리 수비)을 쓰고, 그 자리의 수비 런을 더한다.
 */
export function teamStrength(org: SimPlayer[], ctx: ValueContext, y: number): number {
  const proj = (p: SimPlayer, base: number) => base + agingShift(p, y, ctx);
  const hitters = org.filter((p) => !p.isPitcher && p.bat);
  // 미래 시즌은 그때 능력 순으로 주전을 다시 고른다
  const hv = new Map(hitters.map((p) => [p.idx, proj(p, batRuns(p, ctx))]));
  const ranked = [...hitters].sort((a, b) => hv.get(b.idx)! - hv.get(a.idx)! || a.idx - b.idx);
  const lineup = assignLineupByRuns(ranked, hv);
  let total = 0;
  const used = new Set<number>();
  for (const { p, slot } of lineup) {
    total += hv.get(p.idx)! + defenseAt(p, slot);
    used.add(p.idx);
  }
  total -= (9 - lineup.length) * 30; // 9명을 못 채우면 큰 손해
  let bench = 0;
  for (const p of ranked) {
    if (used.has(p.idx) || bench >= BENCH_HITTERS) continue;
    total += DEPTH_SHARE * Math.max(0, hv.get(p.idx)!);
    bench++;
  }

  const pitchers = org.filter((p) => p.isPitcher && p.pit);
  const sp = pitchers.filter(isStarter).map((p) => ({ p, r: proj(p, pitRuns(p, ctx, 'SP')) })).sort((a, b) => b.r - a.r || a.p.idx - b.p.idx);
  const rotation = sp.slice(0, ROTATION);
  for (const x of rotation) total += x.r;
  total -= (ROTATION - rotation.length) * 10;
  for (const x of sp.slice(ROTATION, ROTATION + SPARE_STARTERS)) total += DEPTH_SHARE * Math.max(0, x.r);
  const inRotation = new Set(rotation.map((x) => x.p.idx));
  const rp = pitchers.filter((p) => !inRotation.has(p.idx)).map((p) => ({ p, r: proj(p, pitRuns(p, ctx, 'RP')) })).sort((a, b) => b.r - a.r || a.p.idx - b.p.idx);
  for (const x of rp.slice(0, BULLPEN)) total += x.r;
  total -= Math.max(0, BULLPEN - rp.length) * 5;
  for (const x of rp.slice(BULLPEN, BULLPEN + SPARE_RELIEVERS)) total += DEPTH_SHARE * Math.max(0, x.r);
  return total;
}

/** 주전 9명 배치: AI 감독과 같은 최적 배정(assignSlots)에 추정 타격 기여 + 그 자리 수비 런을 점수로 준다 */
function assignLineupByRuns(ranked: SimPlayer[], runs: Map<number, number>): { p: SimPlayer; slot: Slot }[] {
  return assignSlots(ranked, undefined, (p, slot) => runs.get(p.idx)! + defenseAt(p, slot));
}

/** 시즌별 가중치를 곱해 합한 구단 전력 */
export function teamValue(org: SimPlayer[], ctx: ValueContext, weights: number[]): number {
  let v = 0;
  for (let y = 0; y < weights.length; y++) if (weights[y] > 0) v += weights[y] * teamStrength(org, ctx, y);
  return v;
}
