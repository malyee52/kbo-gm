// 갈래 성장과 갈래 천장 (능력치 v2 16-4a, 기획안 2.3·2.4·17.2).
//
// - 갈래: 타자 so(맞히기, 작을수록 좋음)·bb(선구)·s1(컨택)·d2·hr(파워)·t3(주력), 투수 so(구위)·bb(제구, 작을수록 좋음)·hr(장타 억제, 작을수록)·hit(타구 억제, 작을수록).
//   값은 능력 비율 그대로이고, 갈래 사이 거리는 로그로 잰다. 볼카운트 사슬 능력(plateRes)은 결과 비율을 따라가므로 따로 키우지 않는다.
// - 한 해 변화의 크기(런)는 지금 성장 판정(growth.ts growthRuns: 나이·기회·성장 성향·터지는 해·운, 천장 자르기)이 정한다.
//   이 파일은 그 변화를 갈래에 나눠 싣는다: 자랄 때는 갈래별 나이 곡선(params.growth2, 시기 τ로 나이를 당기거나 밂) × 그 갈래 천장 P_c까지 남은 거리,
//   떨어질 때는 갈래별 노화 곡선. 그래서 파워 히터는 일찍·크게, 교타자는 늦게·작게 떨어지고, 천장이 다 찬 갈래는 더 크지 않는다 (엇갈린 성장).
//   크기를 갈래 곡선 측정값으로 바꾸는 것(결정 2)은 16-5 장기 균형 맞춤과 함께 한다.
// - 갈래 천장 P_c: 종합 천장(LeaguePlayer.potential)을 갈래로 나눈 것. 실존 선수는 고점 시즌 갈래 모양에서(3.2), 그 밖은 지금 능력 모양에서
//   한 방향으로 옮겨 종합이 천장과 같게 맞추고, 선수·갈래마다 작은 엇갈림을 넣는다. 지금 능력보다 나쁜 쪽으로는 두지 않는다.
// - 시기 τ (해): 성장이 몰리는 나이를 당기거나(음수) 민다(양수). 노화에는 쓰지 않는다. 숨은 값이라 화면·AI 가치·알림에 쓰지 않는다.
// 난수는 모두 시드 줄기 (Rng): 천장 엇갈림 `${시드}/pc/${ID}/${갈래}`, τ `${시드}/growth2/${ID}/timing`, 해마다 `${시드}/growth2/${해}/${ID}/${갈래}`.

import { DEFAULT_PARAMS, Rng, type BatSkill, type EngineParams, type PitSkill } from '../engine';
import type { ValueContext } from '../ai/value';
import { runsOf, type SkillHolder } from './growth';
import { triangular } from './potential';
import type { LeaguePlayer } from './types';

export const BAT_BRANCHES = ['so', 'bb', 's1', 'd2', 't3', 'hr'] as const;
export const PIT_BRANCHES = ['so', 'bb', 'hr', 'hit'] as const;
export type BatBranch = (typeof BAT_BRANCHES)[number];
export type PitBranch = (typeof PIT_BRANCHES)[number];
/** 갈래가 좋아지는 방향 (로그 비율이 커지면 좋으면 +1) */
const BAT_GOOD: Record<BatBranch, 1 | -1> = { so: -1, bb: 1, s1: 1, d2: 1, t3: 1, hr: 1 };
const PIT_GOOD: Record<PitBranch, 1 | -1> = { so: 1, bb: -1, hr: -1, hit: -1 };
/** 천장으로 옮기는 기본 방향의 크기 (growth.ts BAT_SHIFT·PIT_SHIFT와 같은 비율) */
const BAT_W: Record<BatBranch, number> = { so: 0.6, bb: 0.7, s1: 0.4, d2: 0.7, t3: 0.3, hr: 1.2 };
const PIT_W: Record<PitBranch, number> = { so: 0.6, bb: 0.6, hr: 0.8, hit: 0.3 };

type G2 = EngineParams['growth2'];

/** 갈래 천장 (능력 비율 그대로). pa: 이 천장을 맞춘 종합 천장 (종합 천장이 바뀌면 같은 모양으로 다시 맞춘다) */
export interface BranchCeiling {
  pa: number;
  bat?: Record<BatBranch, number>;
  pit?: Record<PitBranch, number>;
}

/** 다음 시즌 나이 → 나이 칸 (≤22 · 23~26 · 27~30 · 31~34 · 35+) */
function bandOf(age: number): number {
  return age <= 22 ? 0 : age <= 26 ? 1 : age <= 30 ? 2 : age <= 34 ? 3 : 4;
}

/** 표준정규에 가까운 값 (균등 넷의 합) */
function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.sqrt(3);
}

/** 시기 τ (해). 극단 선수(역사 재현 쪽)는 성장 성향처럼 extremeDrive만큼 줄인다 */
export function timingOf(seed: string, id: string, extreme = false, params: EngineParams = DEFAULT_PARAMS): number {
  const t = triangular(new Rng(`${seed}/growth2/${id}/timing`)) * params.growth2.tauSpan * (extreme ? params.potential.extremeDrive : 1);
  return Math.round(t * 100) / 100;
}

/** 방향 v(로그)로 t만큼 옮긴 능력 */
function moveBat(s: BatSkill, v: Partial<Record<BatBranch, number>>, t: number): BatSkill {
  const out = { ...s };
  for (const k of BAT_BRANCHES) if (v[k]) out[k] = s[k] * Math.exp(v[k]! * t);
  return out;
}
function movePit(s: PitSkill, v: Partial<Record<PitBranch, number>>, t: number): PitSkill {
  const out = { ...s };
  for (const k of PIT_BRANCHES) if (v[k]) out[k] = s[k] * Math.exp(v[k]! * t);
  return out;
}

interface Dir { bat?: Partial<Record<BatBranch, number>>; pit?: Partial<Record<PitBranch, number>> }

/** 방향 dir로 옮겨 목표 런이 되는 능력 (이분법, t ∈ [0, 2]. 방향은 런이 늘거나(up) 줄어드는 쪽이어야 한다) */
function moveForRuns<T extends SkillHolder>(p: T, dir: Dir, target: number, up: boolean, ctx: ValueContext, year: number): Pick<T, 'bat' | 'pit'> {
  const at = (t: number) => ({ bat: p.bat && dir.bat ? moveBat(p.bat, dir.bat, t) : p.bat, pit: p.pit && dir.pit ? movePit(p.pit, dir.pit, t) : p.pit });
  const runs = (t: number) => runsOf({ ...p, ...at(t) }, ctx, year);
  let lo = 0;
  let hi = 2;
  const reach = runs(hi);
  if (up ? reach <= target : reach >= target) return at(hi);
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    if (up ? runs(mid) < target : runs(mid) > target) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}

/** 크기가 가장 큰 성분이 1이 되게 */
function normalize<K extends string>(v: Partial<Record<K, number>>): Partial<Record<K, number>> {
  const m = Math.max(...Object.values<number>(v as Record<K, number>).map(Math.abs), 1e-9);
  const out: Partial<Record<K, number>> = {};
  for (const k of Object.keys(v) as K[]) out[k] = v[k]! / m;
  return out;
}

/**
 * 갈래 천장을 만든다: 모양(shape, 없으면 지금 능력)에서 기본 방향 × 갈래 엇갈림으로 옮겨 종합 런이 potential이 되게 하고,
 * 갈래마다 지금 능력보다 나쁘지 않게 자른다. 지금 종합이 이미 천장 이상이면 지금 능력이 천장 (더 자라지 않음)
 */
export function makeCeiling(p: SkillHolder & { potential: number }, ctx: ValueContext, year: number, seed: string,
                            shape?: { bat?: BatSkill | null; pit?: PitSkill | null }, params: EngineParams = DEFAULT_PARAMS): BranchCeiling {
  const g2 = params.growth2;
  const base: SkillHolder = { ...p, bat: p.bat ? (shape?.bat ? { ...p.bat, ...pickBat(shape.bat) } : p.bat) : null,
    pit: p.pit ? (shape?.pit ? { ...p.pit, ...pickPit(shape.pit) } : p.pit) : null };
  const scatter = (k: string) => Math.exp(g2.ceilSd * gauss(new Rng(`${seed}/pc/${p.id}/${k}`)));
  const dir: Dir = {};
  if (p.bat) { dir.bat = {}; for (const k of BAT_BRANCHES) dir.bat[k] = BAT_GOOD[k] * BAT_W[k] * scatter(`b${k}`); }
  if (p.pit) { dir.pit = {}; for (const k of PIT_BRANCHES) dir.pit[k] = PIT_GOOD[k] * PIT_W[k] * scatter(`p${k}`); }
  const now = runsOf(p, ctx, year);
  const from = runsOf(base, ctx, year);
  const target = Math.max(p.potential, now);
  // 모양이 천장보다 높으면(고점 시즌이 천장보다 좋음) 내려서 맞춘다
  const up = from <= target;
  const neg = (d: Dir): Dir => ({ bat: d.bat && Object.fromEntries(Object.entries(d.bat).map(([k, x]) => [k, -x!])), pit: d.pit && Object.fromEntries(Object.entries(d.pit).map(([k, x]) => [k, -x!])) });
  const moved = Math.abs(from - target) < 1e-6 ? base : moveForRuns(base, up ? dir : neg(dir), target, up, ctx, year);
  const out: BranchCeiling = { pa: Math.round(p.potential * 1000) / 1000 };
  if (p.bat && moved.bat) out.bat = clampBetter(pickBat(moved.bat), pickBat(p.bat), BAT_GOOD) as Record<BatBranch, number>;
  if (p.pit && moved.pit) out.pit = clampBetter(pickPit(moved.pit), pickPit(p.pit), PIT_GOOD) as Record<PitBranch, number>;
  return out;
}

function pickBat(s: BatSkill): Record<BatBranch, number> {
  return { so: s.so, bb: s.bb, s1: s.s1, d2: s.d2, t3: s.t3, hr: s.hr };
}
function pickPit(s: PitSkill): Record<PitBranch, number> {
  return { so: s.so, bb: s.bb, hr: s.hr, hit: s.hit };
}
/** 천장 갈래가 지금보다 나쁘면 지금 값으로 (천장 ≥ 지금, 17.2) */
function clampBetter<K extends string>(ceil: Record<K, number>, now: Record<K, number>, good: Record<K, 1 | -1>): Record<K, number> {
  const out = { ...ceil };
  for (const k of Object.keys(ceil) as K[]) {
    if (good[k] * (Math.log(ceil[k]) - Math.log(now[k])) < 0) out[k] = now[k];
    out[k] = Math.round(out[k] * 1e6) / 1e6;
  }
  return out;
}

/**
 * 실존 선수 갈래 천장의 모양 (3.2): 고점 시즌 갈래 값에서 갈래마다 커리어 최고 쪽으로 peakPull만큼 당긴다
 * (최고값을 그대로 모으면 한 번도 없었던 더 좋은 선수가 된다). 시즌이 없으면 undefined
 */
export function peakShape(isPitcher: boolean, out: { peak?: BatSkill | PitSkill; seasons?: (BatSkill | PitSkill)[] }, params: EngineParams = DEFAULT_PARAMS):
  { bat?: BatSkill; pit?: PitSkill } | undefined {
  if (!out.peak || !out.seasons?.length) return undefined;
  const pull = params.growth2.peakPull;
  if (isPitcher) {
    const peak = out.peak as PitSkill;
    const shape = { ...peak };
    for (const k of PIT_BRANCHES) {
      const vals = (out.seasons as PitSkill[]).map((x) => x[k]);
      const best = PIT_GOOD[k] > 0 ? Math.max(...vals) : Math.min(...vals);
      shape[k] = Math.exp(Math.log(peak[k]) + pull * (Math.log(best) - Math.log(peak[k])));
    }
    return { pit: shape };
  }
  const peak = out.peak as BatSkill;
  const shape = { ...peak };
  for (const k of BAT_BRANCHES) {
    const vals = (out.seasons as BatSkill[]).map((x) => x[k]);
    const best = BAT_GOOD[k] > 0 ? Math.max(...vals) : Math.min(...vals);
    shape[k] = Math.exp(Math.log(peak[k]) + pull * (Math.log(best) - Math.log(peak[k])));
  }
  return { bat: shape };
}

/** 종합 천장이 바뀌었으면(부상 후유증·이벤트·자유 모드) 같은 모양으로 다시 맞춘 갈래 천장 */
export function ceilingFor(p: LeaguePlayer, ctx: ValueContext, year: number, seed: string, params: EngineParams = DEFAULT_PARAMS): BranchCeiling {
  const c = p.ceil;
  if (c && Math.abs(c.pa - p.potential) < 0.01 && (!p.bat || c.bat) && (!p.pit || c.pit)) return c;
  const shape = c ? { bat: c.bat && p.bat ? { ...p.bat, ...c.bat } : null, pit: c.pit && p.pit ? { ...p.pit, ...c.pit } : null } : undefined;
  return makeCeiling(p, ctx, year, seed, shape, params);
}

export interface GrowOpts {
  /** 다음 시즌 나이 (조기 노쇠 몫 포함) */
  age: number;
  /** 시기 τ */
  timing: number;
  /** 해마다 갈래 무게 운 줄기 (`${시드}/growth2/${해}/${ID}`) */
  stream: string;
  /** 터지는 해에 고른 갈래 (해마다 운 줄기에서 고른다). 없으면 터지지 않음 */
  breakout?: boolean;
  /** 훈련 집중 갈래 (16-4c 훈련 탭, 본업 쪽 갈래 이름): 그 갈래 성장 × up, 나머지 × down */
  focus?: { branch: string; up: number; down: number };
}

/**
 * 성장 판정이 정한 새 종합 런(target)이 되도록 갈래를 옮긴다 (2.3). 자랄 때는 갈래 곡선 × 천장까지 남은 거리 방향,
 * 떨어질 때는 노화 곡선 방향. 자란 갈래는 천장에서 자른다 (이미 천장 위인 갈래는 오르지만 않음)
 */
export function growBranches<T extends SkillHolder>(p: T, ceil: BranchCeiling, target: number, ctx: ValueContext, year: number, o: GrowOpts,
                                                   params: EngineParams = DEFAULT_PARAMS): Pick<T, 'bat' | 'pit'> {
  const now = runsOf(p, ctx, year);
  if (Math.abs(target - now) < 1e-6) return { bat: p.bat, pit: p.pit };
  const up = target > now;
  const g2: G2 = params.growth2;
  const rng = new Rng(o.stream);
  const bandUp = bandOf(o.age - o.timing);
  const bandDown = bandOf(o.age);
  const keys = [...(p.bat ? BAT_BRANCHES.map((k) => `b${k}`) : []), ...(p.pit ? PIT_BRANCHES.map((k) => `p${k}`) : [])];
  // 난수는 늘 같은 수만큼 쓴다: 갈래마다 무게 운 하나, 터지는 해 갈래 하나
  const luck = new Map(keys.map((k) => [k, Math.exp(g2.yearSd * gauss(rng))]));
  const burst = keys[Math.floor(rng.next() * keys.length)];
  const main = p.isPitcher ? 'p' : 'b';
  const weight = (k: string, curve: number[], good: 1 | -1, band: number, dist: number) => {
    const table: number[][] = Object.values(k[0] === 'b' ? g2.bat : g2.pit);
    const scale = Math.max(1e-9, ...table.map((c) => Math.abs(c[band] ?? 0)));
    const m = curve[band] ?? 0;
    const signal = up ? Math.max(0, good * m) : Math.max(0, -good * m);
    let w = (signal + g2.floor * scale) * luck.get(k)!;
    if (up) {
      w *= Math.max(0, Math.min(1, dist / g2.room));
      if (o.breakout && k === burst) w *= g2.breakout;
      if (o.focus) w *= k === `${main}${o.focus.branch}` ? o.focus.up : o.focus.down;
    }
    return w;
  };
  const dir: Dir = {};
  if (p.bat) {
    const v: Partial<Record<BatBranch, number>> = {};
    for (const k of BAT_BRANCHES) {
      const dist = ceil.bat ? BAT_GOOD[k] * (Math.log(ceil.bat[k]) - Math.log(p.bat[k])) : 0;
      v[k] = (up ? BAT_GOOD[k] : -BAT_GOOD[k]) * weight(`b${k}`, g2.bat[k], BAT_GOOD[k], up ? bandUp : bandDown, dist);
    }
    dir.bat = v;
  }
  if (p.pit) {
    const v: Partial<Record<PitBranch, number>> = {};
    for (const k of PIT_BRANCHES) {
      const dist = ceil.pit ? PIT_GOOD[k] * (Math.log(ceil.pit[k]) - Math.log(p.pit[k])) : 0;
      v[k] = (up ? PIT_GOOD[k] : -PIT_GOOD[k]) * weight(`p${k}`, g2.pit[k], PIT_GOOD[k], up ? bandUp : bandDown, dist);
    }
    dir.pit = v;
  }
  const all = [...Object.values(dir.bat ?? {}), ...Object.values(dir.pit ?? {})];
  // 자랄 갈래가 없다 (모든 갈래가 천장): 그대로
  if (!all.some((x) => Math.abs(x!) > 1e-12)) return { bat: p.bat, pit: p.pit };
  const nd: Dir = { bat: dir.bat && normalize(dir.bat), pit: dir.pit && normalize(dir.pit) };
  const moved = moveForRuns(p, nd, target, up, ctx, year);
  if (!up) return moved;
  return {
    bat: moved.bat && ceil.bat && p.bat ? { ...moved.bat, ...capBranches(pickBat(moved.bat), pickBat(p.bat), ceil.bat, BAT_GOOD) } : moved.bat,
    pit: moved.pit && ceil.pit && p.pit ? { ...moved.pit, ...capBranches(pickPit(moved.pit), pickPit(p.pit), ceil.pit, PIT_GOOD) } : moved.pit,
  };
}

/** 자란 갈래를 천장에서 자른다. 이미 천장 위였던 갈래는 그 값에서 오르지 않게 */
function capBranches<K extends string>(next: Record<K, number>, before: Record<K, number>, ceil: Record<K, number>, good: Record<K, 1 | -1>): Record<K, number> {
  const out = { ...next };
  for (const k of Object.keys(next) as K[]) {
    const over = good[k] * (Math.log(next[k]) - Math.log(ceil[k]));
    if (over <= 0) continue;
    const wasOver = good[k] * (Math.log(before[k]) - Math.log(ceil[k])) > 0;
    out[k] = wasOver ? before[k] : ceil[k];
  }
  return out;
}
