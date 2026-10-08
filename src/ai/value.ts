// 선수 가치와 구단 전력. 트레이드에 쓰고, 이후 드래프트·FA(M5)에서도 같은 함수를 쓴다 (기획서 10장).
//
// 단위는 "대체 선수 대비 한 시즌 득점 기여"(런). 1군 주전급 평균이 대략 10~20런이다.
// - 현재 능력: 엔진의 기대 타석 가치(batValue·pitValue)를 대체 선수와 비교해 한 시즌 출전량을 곱한다.
// - 잠재력: 아직 잠재력 모델(M5)이 없어 나이에 따른 연간 변화량으로 향후 시즌을 추정한다 (임시).
// - 연봉 부담: 연봉 자료가 없어 넣지 않았다. M5에서 연봉이 생기면 더한다.
// - 포지션 희소성: 선수 가치에는 포지션 보정을, 구단 전력에는 "그 자리를 맡을 선수가 없을 때의 손해"를 넣는다.

import { assignLineup, LINEUP_SLOTS, positionFit, type SimPlayer, type World } from '../engine';

/** 선형 가중치(wOBA 계열)를 득점으로 바꾸는 배율. 공개된 세이버메트릭스 상수의 근사값 */
const WOBA_SCALE = 1.2;
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
/** 제 포지션이 아닌 자리를 맡을 때의 수비 손해: (1 - 적합도) × 이 값 (런, 임시값) */
const MISFIT_RUNS = 40;

/** 나이별 연간 능력 변화량 (런/시즌, 임시값). 잠재력 모델(M5)과 노화 곡선(M6)이 들어오면 바꾼다 */
export function agingDelta(age: number): number {
  if (age <= 23) return 6;
  if (age <= 26) return 3;
  if (age <= 30) return 0;
  if (age <= 33) return -3;
  if (age <= 35) return -6;
  return -9;
}

/** 나이를 모르는 선수는 이 나이로 본다 */
const DEFAULT_AGE = 28;
/** 앞으로 몇 시즌을 내다보는지 (이번 시즌 포함) */
export const HORIZON = 4;

export interface ValueContext {
  world: World;
  /** 대체 선수의 타석 가치 (규정급 타자 하위 10%) */
  replBat: number;
  /** 대체 선수의 피타석 가치 (규정급 투수 하위 10%, 클수록 나쁨) */
  replPit: number;
}

function quantile(sorted: number[], q: number, fallback: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : fallback;
}

export function valueContext(world: World): ValueContext {
  const hv = world.players.filter((p) => !p.isPitcher && p.bat && p.bat.sample >= 300).map((p) => p.value).sort((a, b) => a - b);
  const pv = world.players.filter((p) => p.isPitcher && p.pit && p.pit.sample >= 200).map((p) => p.value).sort((a, b) => a - b);
  return { world, replBat: quantile(hv, 0.1, 0.27), replPit: quantile(pv, 0.9, 0.38) };
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

/** 지금 능력 기준 한 시즌 기여 (런). 타자는 포지션 보정 포함 */
export function currentRuns(p: SimPlayer, ctx: ValueContext): number {
  if (p.isPitcher) return pitRuns(p, ctx);
  return batRuns(p, ctx) + (POS_ADJ[p.pos ?? ''] ?? 0) * (FULL_PA / 600);
}

/** y시즌 뒤(0 = 이번 시즌)의 추정 기여 변화량 */
export function agingShift(p: SimPlayer, y: number): number {
  let age = p.age ?? DEFAULT_AGE;
  let shift = 0;
  for (let k = 0; k < y; k++) shift += agingDelta(age++);
  return shift;
}

/**
 * 선수 한 명의 가치: 시즌별 추정 기여를 가중 합한 값.
 * weights[y]는 y시즌 뒤의 가중치. 구단 성향(우승 도전·리빌딩)에 따라 다르다.
 */
export function playerValue(p: SimPlayer, ctx: ValueContext, weights: number[]): number {
  const now = currentRuns(p, ctx);
  let v = 0;
  for (let y = 0; y < weights.length; y++) v += weights[y] * Math.max(-5, now + agingShift(p, y));
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
 * 주전 배치는 AI 감독과 같은 규칙(assignLineup)을 쓰고, 제 포지션이 아닌 자리는 수비 손해를 뺀다.
 */
export function teamStrength(org: SimPlayer[], ctx: ValueContext, y: number): number {
  const proj = (p: SimPlayer, base: number) => base + agingShift(p, y);
  const hitters = org.filter((p) => !p.isPitcher && p.bat);
  // 미래 시즌은 그때 능력 순으로 주전을 다시 고른다
  const hv = new Map(hitters.map((p) => [p.idx, proj(p, batRuns(p, ctx))]));
  const ranked = [...hitters].sort((a, b) => hv.get(b.idx)! - hv.get(a.idx)! || a.idx - b.idx);
  const lineup = assignLineupByRuns(ranked, hv);
  let total = 0;
  const used = new Set<number>();
  for (const { p, misfit } of lineup) {
    total += hv.get(p.idx)! - misfit * MISFIT_RUNS;
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

/** 주전 9명 배치. assignLineup과 같은 순서·적합도를 쓰되, 가치 대신 추정 기여로 고른다 */
function assignLineupByRuns(ranked: SimPlayer[], runs: Map<number, number>): { p: SimPlayer; misfit: number }[] {
  // assignLineup은 p.value × 적합도로 고르므로, 추정 기여를 양수로 옮긴 값을 value 자리에 넣은 복사본으로 부른다
  const shift = 100;
  const proxies = ranked.map((p) => ({ ...p, value: runs.get(p.idx)! + shift }));
  const chosen = assignLineup(proxies);
  return chosen.map((c, i) => ({ p: ranked.find((r) => r.idx === c.idx)!, misfit: 1 - positionFit(c.pos, LINEUP_SLOTS[i]) }));
}

/** 시즌별 가중치를 곱해 합한 구단 전력 */
export function teamValue(org: SimPlayer[], ctx: ValueContext, weights: number[]): number {
  let v = 0;
  for (let y = 0; y < weights.length; y++) if (weights[y] > 0) v += weights[y] * teamStrength(org, ctx, y);
  return v;
}
