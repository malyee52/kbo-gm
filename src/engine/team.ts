// 선수 기용: 1군 엔트리, 선발 라인업, 타순, 선발 로테이션, 불펜.
// 경기 중 작전은 AI 감독이 처리한다는 기획에 따라 플레이어 구단도 같은 규칙을 쓴다.

import type { Rates } from '../data/types';
import { eraPitching } from './eras';
import type { EngineParams } from './params';
import type { Rng } from './rng';
import { defenseAt } from './defense';
import type { SimPlayer, SimTeam, World } from './types';

/** 시즌 중 바뀌는 선수 상태. 색인은 SimPlayer.idx */
export interface PlayerStates {
  /** 이 날짜 전까지 결장 */
  absentUntil: Int32Array;
  /** 불펜 피로도와 그 값을 기록한 날짜. 하루에 5씩 회복 */
  fatigue: Float32Array;
  fatigueDay: Int32Array;
  /** fatigueDay까지 연속으로 던진 날 수 (연투 관리) */
  streak: Int32Array;
  lastStartDay: Int32Array;
}

export function newPlayerStates(n: number): PlayerStates {
  return {
    absentUntil: new Int32Array(n),
    fatigue: new Float32Array(n),
    fatigueDay: new Int32Array(n),
    streak: new Int32Array(n),
    lastStartDay: new Int32Array(n).fill(-99),
  };
}

export const FATIGUE_RECOVERY_PER_DAY = 5;
export const FATIGUE_AVAILABLE_BELOW = 6;

/** 어제까지 이틀 연속 던져 오늘 쉬어야 하는가 (3연투는 피한다) */
export function needsRest(st: PlayerStates, idx: number, day: number): boolean {
  return st.fatigueDay[idx] === day - 1 && st.streak[idx] >= 2;
}

export function currentFatigue(st: PlayerStates, idx: number, day: number): number {
  return Math.max(0, st.fatigue[idx] - FATIGUE_RECOVERY_PER_DAY * (day - st.fatigueDay[idx]));
}

export interface TeamSeason {
  team: SimTeam;
  /** 1군 야수 (가치 높은 순) */
  hitters: SimPlayer[];
  rotation: SimPlayer[];
  /** 1군 구원 투수 (좋은 순 = value 낮은 순) */
  bullpen: SimPlayer[];
  closer: SimPlayer | null;
  /** 엔트리를 다시 짜야 하는 가장 이른 날짜 (결장 선수 복귀일) */
  nextReturnDay: number;
  dirty: boolean;
  /**
   * 플레이어가 직접 정한 1군 명단 (선수 색인). 있으면 이 명단 안에서만 기용하고, 없으면 AI가 엔트리를 짠다.
   * 라인업·로테이션·투수 교체는 어느 쪽이든 AI 감독이 정한다.
   */
  manual?: Set<number> | null;
  /** 직접 정한 1군만으로 경기를 치를 수 없어 이번에 2군에서 임시로 올린 선수 */
  callUps?: SimPlayer[];
  /** 오늘 경기의 수비 배치 (선수 색인 → 자리). todaysLineup이 정한다 */
  field?: Map<number, Slot>;
  /** 배치 계산 결과 저장 (쉬는 선수 조합 → 배치). 1군을 다시 짜면 비운다. 난수를 쓰지 않으므로 결과에 영향이 없다 */
  lineupCache?: Map<string, { p: SimPlayer; slot: Slot }[]>;
  /** 플레이어가 정한 기용표 (주전 자리, 선발 로테이션, 마무리). 없으면 AI 감독이 정한다 */
  plan?: DepthPlan | null;
  /** 선발 등판 사이 최소 휴식일 (시대별, eras.ts). 없으면 params.starterRestDays */
  restDays?: number;
}

/**
 * 플레이어의 기용표 (2026-10-08 사용자 요청으로 추가). 선수 색인으로 적는다.
 * - starters: 자리별 주전. 쉬거나 결장한 날은 AI 감독이 나머지 1군 야수(서브) 중에서 그 자리를 채운다.
 * - rotation: 선발 로테이션. 뛸 수 있는 선발이 4명보다 적으면 AI가 채운다. 나머지 1군 투수는 중계.
 * - closer: 마무리. 없거나 못 나오면 AI가 정한다.
 * 타순과 경기 중 투수 교체는 그대로 AI 감독이 한다.
 */
export interface DepthPlan {
  starters: Partial<Record<Slot, number>>;
  rotation: number[];
  closer: number | null;
}

/** 기용표 로테이션이 이보다 적게 남으면 AI가 채운다 */
export const MIN_PLAN_ROTATION = 4;

/** 직접 정한 1군에서 뛸 수 있는 선수가 이보다 적으면 2군에서 임시로 올린다 (임시값) */
export const MIN_ACTIVE_HITTERS = 10;
export const MIN_ACTIVE_PITCHERS = 9;

/** 주전 배치 순서 (희소한 자리부터). assignLineup 결과의 i번째 선수가 LINEUP_SLOTS[i]를 맡는다 */
export const LINEUP_SLOTS = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'] as const;
export type Slot = (typeof LINEUP_SLOTS)[number];

/** 타석 가치 1 = 한 시즌(600타석) 약 500런. 수비 런을 가치와 더할 때 쓴다 */
const RUNS_PER_VALUE = 500;


/**
 * 최적 배정 (헝가리안 알고리즘): score[i][j]는 i번째 자리에 j번째 선수를 세운 점수. 점수 합이 가장 큰 배정을 찾는다.
 * 반환값[i] = i번째 자리에 세운 선수 번호 (선수가 모자라 비운 자리는 -1). 같은 입력이면 늘 같은 답.
 */
export function bestAssignment(score: number[][]): number[] {
  const nRows = score.length;
  const nCols = score[0]?.length ?? 0;
  const n = Math.max(nRows, nCols);
  if (n === 0) return [];
  // 정사각형으로 채우고 최소 비용 문제로 바꾼다 (빈 칸은 점수 0의 가짜 자리·선수)
  let maxScore = 0;
  for (const row of score) for (const v of row) if (v > maxScore) maxScore = v;
  const cost = (i: number, j: number) => (i < nRows && j < nCols ? maxScore - score[i][j] : maxScore);
  const INF = Number.POSITIVE_INFINITY;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(INF);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(nRows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] >= 1 && p[j] <= nRows && j <= nCols) out[p[j] - 1] = j - 1;
  return out;
}

/** 자리 점수 → 한 시즌 런 단위: 타석 가치 × 500 + 그 자리 수비 런 */
export function slotRuns(p: SimPlayer, slot: Slot): number {
  return p.value * RUNS_PER_VALUE + defenseAt(p, slot);
}

/**
 * 자리에 야수를 배정한다. 9개 자리 전체의 (타격 + 그 자리 수비) 합이 가장 큰 배정 (헝가리안 알고리즘).
 * fixed: 미리 정해진 자리 (플레이어가 정한 주전). 반환값의 i번째 선수가 LINEUP_SLOTS[i]를 맡는다 (못 채운 자리는 빠진다).
 */
export function assignLineup(avail: SimPlayer[], fixed?: Map<Slot, SimPlayer>): SimPlayer[] {
  return assignSlots(avail, fixed).map((x) => x.p);
}

export function assignSlots(avail: SimPlayer[], fixed?: Map<Slot, SimPlayer>, runsOf: (p: SimPlayer, slot: Slot) => number = slotRuns): { p: SimPlayer; slot: Slot }[] {
  const taken = new Set<number>();
  for (const p of fixed?.values() ?? []) taken.add(p.idx);
  const openSlots = LINEUP_SLOTS.filter((s) => !fixed?.has(s));
  const pool = avail.filter((p) => !taken.has(p.idx));
  // 점수가 음수가 되지 않게 옮긴다 (배정 결과는 같다)
  const raw = openSlots.map((slot) => pool.map((p) => runsOf(p, slot)));
  let min = 0;
  for (const row of raw) for (const x of row) if (x < min) min = x;
  const pick = bestAssignment(raw.map((row) => row.map((x) => x - min + 1)));
  const bySlot = new Map<Slot, SimPlayer>(fixed ?? []);
  openSlots.forEach((slot, i) => { if (pick[i] >= 0) bySlot.set(slot, pool[pick[i]]); });
  return LINEUP_SLOTS.filter((s) => bySlot.has(s)).map((slot) => ({ p: bySlot.get(slot)!, slot }));
}

function onBaseScore(p: SimPlayer, lg: Rates): number {
  const b = p.bat!;
  return b.s1 * lg.s1 + b.d2 * lg.d2 + b.t3 * lg.t3 + b.hr * lg.hr + b.bb * lg.bb + b.hbp * lg.hbp;
}

/** 타순: 1·2번은 출루, 3번은 최고 타자, 4번은 장타, 나머지는 가치 순 */
export function battingOrder(nine: SimPlayer[], lg: Rates): SimPlayer[] {
  const rest = [...nine];
  const take = (score: (p: SimPlayer) => number): SimPlayer => {
    let bi = 0;
    for (let i = 1; i < rest.length; i++) if (score(rest[i]) > score(rest[bi])) bi = i;
    return rest.splice(bi, 1)[0];
  };
  if (rest.length < 9) return rest;
  const third = take((p) => p.value);
  const fourth = take((p) => p.bat!.hr * lg.hr * 3 + p.value);
  const first = take((p) => onBaseScore(p, lg) + 0.05 * p.bat!.speed);
  const second = take((p) => onBaseScore(p, lg));
  rest.sort((a, b) => b.value - a.value);
  return [first, second, third, fourth, ...rest];
}

function pitcherCount(rosterSize: number): number {
  if (rosterSize >= 28) return 14;
  if (rosterSize === 27) return 13;
  return 12;
}

/** 외국인 보유 한도 안에서 쓸 외국인을 고른다. 투수 2명을 먼저, 그다음 타자 순으로 번갈아 채운다 */
function allowedForeigners(avail: SimPlayer[], limit: number): Set<number> {
  const fp = avail.filter((p) => p.foreign && p.isPitcher).sort((a, b) => a.value - b.value);
  const fh = avail.filter((p) => p.foreign && !p.isPitcher).sort((a, b) => b.value - a.value);
  const pattern = ['P', 'P', 'H', 'H', 'P', 'H'];
  const out = new Set<number>();
  let k = 0;
  while (out.size < limit && (fp.length || fh.length)) {
    const want = pattern[k++ % pattern.length];
    const src = want === 'P' ? (fp.length ? fp : fh) : fh.length ? fh : fp;
    out.add(src.shift()!.idx);
  }
  return out;
}

/** 그날 뛸 수 있는 선수로 1군 엔트리를 짠다 */
export function refreshActive(ts: TeamSeason, world: World, st: PlayerStates, day: number): void {
  const limit = world.rules.foreignLimit;
  const manual = ts.manual ?? null;
  const ready = (p: SimPlayer) => st.absentUntil[p.idx] <= day;
  const availAll = ts.team.org.filter((p) => ready(p) && (!manual || manual.has(p.idx)));
  ts.callUps = [];
  if (manual) {
    // 직접 정한 1군만으로 모자라면 2군에서 가장 나은 선수를 임시로 올린다
    const callUp = (isPitcher: boolean, need: number) => {
      const have = availAll.filter((p) => p.isPitcher === isPitcher).length;
      if (have >= need) return;
      const extra = ts.team.org
        .filter((p) => p.isPitcher === isPitcher && !manual.has(p.idx) && ready(p))
        .sort((a, b) => (isPitcher ? a.value - b.value : b.value - a.value))
        .slice(0, need - have);
      availAll.push(...extra);
      ts.callUps!.push(...extra);
    };
    callUp(false, MIN_ACTIVE_HITTERS);
    callUp(true, MIN_ACTIVE_PITCHERS);
  }
  // 뛸 수 있는 선수가 모자라면 결장 중인 선수라도 복귀가 가까운 순으로 채운다 (경기를 못 치르는 일은 없게)
  const fill = (isPitcher: boolean, need: number) => {
    const have = availAll.filter((p) => p.isPitcher === isPitcher).length;
    if (have >= need) return;
    const out = ts.team.org
      .filter((p) => p.isPitcher === isPitcher && st.absentUntil[p.idx] > day)
      .sort((a, b) => st.absentUntil[a.idx] - st.absentUntil[b.idx]);
    availAll.push(...out.slice(0, need - have));
  };
  fill(false, 11);
  fill(true, 9);
  const okForeign = allowedForeigners(availAll, limit);
  const avail = availAll.filter((p) => !p.foreign || okForeign.has(p.idx));

  // 직접 정한 1군은 투수·야수 인원도 플레이어가 정한 그대로 쓴다
  const nPit = manual ? Number.MAX_SAFE_INTEGER : pitcherCount(world.rules.rosterSize);
  const nHit = manual ? Number.MAX_SAFE_INTEGER : world.rules.rosterSize - nPit;

  // 투수: 선발 로테이션(시대별 4~5명), 나머지 구원. 기용표가 있으면 그 로테이션부터
  const era = eraPitching(world.year);
  const nRot = era.rotation;
  ts.restDays = era.restDays;
  const pitchers = avail.filter((p) => p.isPitcher);
  const plan = manual ? ts.plan ?? null : null;
  const inAvail = new Set(pitchers.map((p) => p.idx));
  const planned = plan ? plan.rotation.filter((i) => inAvail.has(i)).map((i) => pitchers.find((p) => p.idx === i)!) : [];
  const starters = pitchers.filter((p) => p.pit!.startShare >= 0.5 && !planned.includes(p) && p.idx !== plan?.closer).sort((a, b) => a.value - b.value);
  const rotation = plan && plan.rotation.length ? [...planned] : starters.slice(0, nRot);
  if (plan && plan.rotation.length && rotation.length < MIN_PLAN_ROTATION) rotation.push(...starters.slice(0, nRot - rotation.length));
  if (rotation.length < nRot) {
    const extra = pitchers
      .filter((p) => !rotation.includes(p))
      .sort((a, b) => b.pit!.startShare - a.pit!.startShare || a.value - b.value);
    rotation.push(...extra.slice(0, nRot - rotation.length));
  }
  const bullpen = pitchers
    .filter((p) => !rotation.includes(p))
    .sort((a, b) => a.value - b.value)
    .slice(0, Math.max(0, nPit - rotation.length));
  let closer: SimPlayer | null = plan?.closer !== null && plan?.closer !== undefined ? bullpen.find((p) => p.idx === plan.closer) ?? null : null;
  if (!closer) for (const p of bullpen) if (p.lastSaves >= 5 && (!closer || p.lastSaves > closer.lastSaves)) closer = p;
  if (!closer) closer = bullpen[0] ?? null;

  // 야수: 주전 9명 → 백업 포수 → 가치 순
  const hittersAll = avail.filter((p) => !p.isPitcher).sort((a, b) => b.value - a.value);
  const chosen = assignLineup(hittersAll);
  const pick = new Set(chosen.map((p) => p.idx));
  const backupC = hittersAll.find((p) => p.pos === 'C' && !pick.has(p.idx));
  if (backupC && chosen.length < nHit) {
    chosen.push(backupC);
    pick.add(backupC.idx);
  }
  for (const p of hittersAll) {
    if (chosen.length >= nHit) break;
    if (!pick.has(p.idx)) {
      chosen.push(p);
      pick.add(p.idx);
    }
  }

  ts.hitters = chosen.sort((a, b) => b.value - a.value);
  ts.lineupCache = new Map();
  ts.rotation = rotation;
  ts.bullpen = bullpen;
  ts.closer = closer;
  ts.dirty = false;
  let next = Number.MAX_SAFE_INTEGER;
  for (const p of ts.team.org) if (st.absentUntil[p.idx] > day && st.absentUntil[p.idx] < next) next = st.absentUntil[p.idx];
  ts.nextReturnDay = next;
}

/** 기용표의 주전 중 오늘 쓸 수 있는 선수 (pool 안에 있는 선수만) */
function planFixed(ts: TeamSeason, pool: SimPlayer[]): Map<Slot, SimPlayer> | undefined {
  if (!ts.plan || !ts.manual) return undefined;
  const byIdx = new Map(pool.map((p) => [p.idx, p]));
  const fixed = new Map<Slot, SimPlayer>();
  for (const slot of LINEUP_SLOTS) {
    const i = ts.plan.starters[slot];
    const p = i === undefined ? undefined : byIdx.get(i);
    if (p) fixed.set(slot, p);
  }
  return fixed;
}

/** 오늘의 선발 라인업 (타순 포함). 주전에게 확률로 휴식을 준다. 수비 배치는 ts.field에 남긴다 */
export function todaysLineup(ts: TeamSeason, lg: Rates, params: EngineParams, rng: Rng): SimPlayer[] {
  ts.lineupCache ??= new Map();
  let full = ts.lineupCache.get('');
  if (!full) ts.lineupCache.set('', (full = assignSlots(ts.hitters, planFixed(ts, ts.hitters))));
  const regulars = full.map((x) => x.p);
  const resting = new Set<number>();
  // 주전 중 가치 상위 3명은 덜 쉬고 하위 3명은 더 쉰다 (하위 타선의 플래툰·교체 출전 몫)
  const byValue = [...regulars].sort((a, b) => b.value - a.value);
  byValue.forEach((p, rank) => {
    const factor = rank < 3 ? 0.4 : rank < 6 ? 1 : 1.8;
    const base = p.pos === 'C' ? params.catcherRestChance : params.restChance;
    if (rng.chance(Math.min(0.6, base * factor))) resting.add(p.idx);
  });
  const key = [...resting].sort((a, b) => a - b).join(',');
  ts.lineupCache ??= new Map();
  let placed = ts.lineupCache.get(key);
  if (!placed) {
    const avail = ts.hitters.filter((p) => !resting.has(p.idx));
    const pool = avail.length >= 9 ? avail : ts.hitters;
    placed = assignSlots(pool, planFixed(ts, pool));
    ts.lineupCache.set(key, placed);
  }
  ts.field = new Map(placed.map((x) => [x.p.idx, x.slot]));
  return battingOrder(placed.map((x) => x.p), lg);
}

/** 오늘의 선발 투수. 가장 오래 쉰 로테이션 투수, 없으면 불펜에서 길게 던질 수 있는 투수 */
export function todaysStarter(ts: TeamSeason, st: PlayerStates, day: number, params: EngineParams): SimPlayer {
  let best: SimPlayer | null = null;
  for (const p of ts.rotation) {
    if (day - st.lastStartDay[p.idx] < (ts.restDays ?? params.starterRestDays)) continue;
    if (!best || st.lastStartDay[p.idx] < st.lastStartDay[best.idx]) best = p;
  }
  if (best) return best;
  let spot: SimPlayer | null = null;
  for (const p of ts.bullpen) {
    if (p === ts.closer || currentFatigue(st, p.idx, day) > 0) continue;
    if (!spot || p.pit!.reliefStint > spot.pit!.reliefStint) spot = p;
  }
  return spot ?? ts.rotation[0] ?? ts.bullpen[0];
}
