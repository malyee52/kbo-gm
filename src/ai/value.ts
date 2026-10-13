// 선수 가치와 구단 전력. 트레이드에 쓰고, 이후 드래프트·FA(M5)에서도 같은 함수를 쓴다 (기획서 10장).
//
// 단위는 "대체 선수 대비 한 시즌 득점 기여"(런). 1군 주전급 평균이 대략 10~20런이다.
// - 현재 능력: 엔진의 기대 타석 가치(batValue·pitValue)를 대체 선수와 비교해 한 시즌 출전량을 곱한다.
// - 잠재력: 선수별 잠재력(전성기 기여)이 있으면 성장 판정과 같은 식의 기댓값으로, 없으면 나이별 연간 변화량으로 향후 시즌을 추정한다.
// - 연봉 부담: 트레이드 판단(trade.ts)에서 연봉을 런으로 바꿔 뺀다.
// - 포지션 희소성: 선수 가치에는 포지션 보정을, 구단 전력에는 "그 자리를 맡을 선수가 없을 때의 손해"를 넣는다.

import { assignSlots, batValue, DECLINE_START_AGE, defenseAt, eraPitching, fieldPosOf, isStarterSkill, pitValue, type SimPlayer, type Slot, type World } from '../engine';

/** 선형 가중치(wOBA 계열)를 득점으로 바꾸는 배율. 공개된 세이버메트릭스 상수의 근사값 */
export const WOBA_SCALE = 1.2;
/** 한 시즌 출전량 (임시값) */
const FULL_PA = 600;
/** 선발 등판 수를 셀 수 없을 때 (월드 정보가 없을 때) */
const STARTS_PER_SEASON = 28;
const RELIEF_APPEARANCES = 60;
/**
 * 구원 투수는 접전 후반에 나오는 몫을 더 쳐준다. 2026-10-12 기준표(tools/calibrate_value.ts)에 맞춰 1.3 → 1.6:
 * 실제 시즌의 WAR와 비교하면 구원의 런이 타자보다 1.23배쯤 작게 잡혀 있었다
 */
const RELIEF_LEVERAGE = 1.6;
/**
 * 선발의 대체 선수 수준 (피타석 가치, 클수록 나쁘다): 리그의 대체 투수(replPit)보다 이만큼 나쁜 투수를 기준으로 본다.
 * 2026-10-12 기준표에 맞춘 값: 같은 WAR에서 선발의 런이 타자보다 약 10런 작았다 (선발 한 시즌 약 660타자 × 0.0176 ÷ 1.2 ≈ 9.7런)
 */
const SP_REPL_SHIFT = 0.0176;
/** 포지션 보정 (600타석당 런). 공개된 세이버메트릭스 상수의 근사값 */
const POS_ADJ: Record<string, number> = {
  C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5, IF: 2.5, OF: -5,
};

/**
 * 하락 첫 5년의 연간 하락 (런/시즌, 리그 평균 주전 기준). 색인 0 = 하락 첫해 (DECLINE_START_AGE, 32세).
 * 2026-10-12 사용자 "하락 나이는 낮추되 하락 폭은 둔화": 실제 기록 추정치(reports/aging-fit.txt, 31~35세: 타자 -2~-4.3, 투수 -4.2~-6.5)의
 * 절반쯤에서 시작해 해마다 조금씩 커진다 (임시값). 투수가 타자보다 조금 더 떨어진다.
 */
const DECLINE_BAT = [-1, -1.5, -2, -2.5, -3];
const DECLINE_PIT = [-1.5, -2, -2.5, -3.5, -4];

/**
 * 나이별 연간 능력 변화량 (런/시즌). 잠재력이 없는 선수와 하락 나이(DECLINE_START_AGE, 지금 32세) 이후에 쓴다.
 * 하락 전은 임시값. 하락 첫 5년은 DECLINE_BAT·DECLINE_PIT, 그 뒤(37세~)는 더 가파르다 (임시값).
 */
export function agingDelta(age: number, isPitcher = false): number {
  const k = age - DECLINE_START_AGE;
  if (k < 0) return age <= 23 ? 6 : age <= 26 ? 3 : 0;
  if (k < 5) return (isPitcher ? DECLINE_PIT : DECLINE_BAT)[k];
  if (k < 7) return isPitcher ? -5 : -4;
  return isPitcher ? -7 : -6;
}

/** 나이를 모르는 선수는 이 나이로 본다 */
export const DEFAULT_AGE = 28;

/**
 * 한 해 성장의 상한 (런, 임시값). 등급(ui/grades.ts, 런당 0.45)으로 25세 이하 약 +3, 26~27세 +2.5, 28세 이상 +2.
 * 2026-10-12 사용자: "10이 넘는 과도한 성장은 있을 수는 있지만 매번 일어나는 일은 아니다" → 잠재력이 높아도 해마다 조금씩 큰다.
 * 상한을 넘는 급성장은 성장 판정(league/growth.ts)의 '터지는 해'로만 가끔 생긴다
 */
export function growthCap(age: number): number {
  return age <= 25 ? 6.5 : age <= 27 ? 5.5 : 4;
}

/**
 * 한 해 동안의 기대 성장 (런). 성장 판정(league/growth.ts)이 여기에 출전 기회와 운을 더한다.
 * 잠재력과의 격차를 나이에 따라 좁히되(27세까지 빠르게, 28세부터 천천히) 한 해 상한(growthCap)을 넘지 않고,
 * 하락 나이(DECLINE_START_AGE)부터 떨어진다 (임시값). 잠재력보다 이미 높으면 그 차이의 20%만큼 내려온다.
 */
export function expectedGrowth(age: number, runs: number, potential: number, isPitcher = false, cap = true): number {
  if (age >= DECLINE_START_AGE) return agingDelta(age, isPitcher);
  const gap = potential - runs;
  if (gap < 0) return gap * 0.2;
  const rate = age <= 22 ? 0.35 : age <= 25 ? 0.3 : age <= 27 ? 0.25 : 0.15;
  return cap ? Math.min(gap * rate, growthCap(age)) : gap * rate;
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
  return p.isPitcher && isStarterSkill(p.pit);
}

/**
 * 그 시대 선발 한 명의 한 시즌 선발 등판 수와 등판당 소화 배율 (2026-10-12): 경기 수 ÷ 로테이션 인원, 시대별 투구 한계 배율(engine/eras.ts).
 * 예전에는 모든 시대 28경기·배율 1이라 4인 로테이션에 완투가 많던 1980~90년대 에이스의 가치가 절반쯤으로 잡혔다 (tools/calibrate_value.ts)
 */
function starterLoad(world: World | undefined): { starts: number; scale: number } {
  if (!world) return { starts: STARTS_PER_SEASON, scale: 1 };
  const era = eraPitching(world.year);
  return { starts: world.gamesPerTeam / era.rotation, scale: era.limitScale };
}

/** 타자의 이번 시즌 타격 기여 (포지션 보정 없음) */
function batRuns(p: SimPlayer, ctx: ValueContext): number {
  return ((p.value - ctx.replBat) / WOBA_SCALE) * FULL_PA;
}

/** 투수의 한 시즌 기여. role을 주지 않으면 선발 비율로 정한다 */
export function pitRuns(p: SimPlayer, ctx: ValueContext, role: PitchRole = isStarter(p) ? 'SP' : 'RP'): number {
  const s = p.pit!;
  if (role === 'RP') return ((ctx.replPit - p.value) / WOBA_SCALE) * s.reliefStint * RELIEF_APPEARANCES * RELIEF_LEVERAGE;
  const load = starterLoad(ctx.world);
  return ((ctx.replPit + SP_REPL_SHIFT - p.value) / WOBA_SCALE) * s.stamina * load.scale * load.starts;
}

/**
 * 선수 가치·능력 등급에 넣는 수비 비중 (2026-10-13 사용자 선택 "수비 비중 낮춤"): 주 포지션 수비 런의 절반만.
 * 수비는 기록이 없는 추정값이라 오버롤을 크게 흔들지 않게. 경기 시뮬레이션의 수비 효과와 팀 전력 계산(teamStrength)은 그대로
 */
export const DEFENSE_VALUE_WEIGHT = 0.5;

/** 주 포지션 수비 런 (지명타자는 0) */
function primaryDefense(p: SimPlayer): number {
  return p.pos === 'DH' ? 0 : defenseAt(p, fieldPosOf(p.pos));
}

/** 지금 능력 기준 한 시즌 기여 (런). 타자는 포지션 보정과 주 포지션 수비 포함 */
export function currentRuns(p: SimPlayer, ctx: ValueContext): number {
  const base = p.isPitcher ? pitRuns(p, ctx) : batRuns(p, ctx) + ((POS_ADJ[p.pos ?? ''] ?? 0) + primaryDefense(p) * DEFENSE_VALUE_WEIGHT) * (FULL_PA / 600);
  // 이도류 (league/twoway.ts): 반대쪽 기여의 일부 (한 시즌을 둘로 나눠 쓰므로)
  const face = twoWayFace(p, ctx.world);
  return face ? base + Math.max(0, currentRuns(face, ctx)) * TWO_WAY_SHARE : base;
}

/** 이도류 선수가 반대쪽에서 내는 기여의 몫 (임시값: 투수 겸업은 지명타자로 등판 다음 날을 빼고 거의 매일, 타자 겸업은 선발 로테이션 한 자리) */
export const TWO_WAY_SHARE = 0.6;

/** 이도류 선수의 반대쪽 얼굴 (engine/team.ts refreshActive와 같은 모양). 없으면 null */
export function twoWayFace(p: SimPlayer, world: Pick<World, 'league'>): SimPlayer | null {
  if (!p.alt) return null;
  if (p.isPitcher && p.alt.bat) return { ...p, alt: undefined, isPitcher: false, bat: p.alt.bat, pos: 'DH', value: batValue(p.alt.bat, world.league) };
  if (!p.isPitcher && p.alt.pit) return { ...p, alt: undefined, isPitcher: true, pit: p.alt.pit, value: pitValue(p.alt.pit, world.league) };
  return null;
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
