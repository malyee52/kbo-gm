// 선수 기용: 1군 엔트리, 선발 라인업, 타순, 선발 로테이션, 불펜.
// 경기 중 작전은 AI 감독이 처리한다는 기획에 따라 플레이어 구단도 같은 규칙을 쓴다.

import type { Rates } from '../data/types';
import type { EngineParams } from './params';
import type { Rng } from './rng';
import type { SimPlayer, SimTeam, World } from './types';

/** 시즌 중 바뀌는 선수 상태. 색인은 SimPlayer.idx */
export interface PlayerStates {
  /** 이 날짜 전까지 결장 */
  absentUntil: Int32Array;
  /** 불펜 피로도와 그 값을 기록한 날짜. 하루에 5씩 회복 */
  fatigue: Float32Array;
  fatigueDay: Int32Array;
  lastStartDay: Int32Array;
}

export function newPlayerStates(n: number): PlayerStates {
  return {
    absentUntil: new Int32Array(n),
    fatigue: new Float32Array(n),
    fatigueDay: new Int32Array(n),
    lastStartDay: new Int32Array(n).fill(-99),
  };
}

export const FATIGUE_RECOVERY_PER_DAY = 5;
export const FATIGUE_AVAILABLE_BELOW = 6;

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
}

/** 직접 정한 1군에서 뛸 수 있는 선수가 이보다 적으면 2군에서 임시로 올린다 (임시값) */
export const MIN_ACTIVE_HITTERS = 10;
export const MIN_ACTIVE_PITCHERS = 9;

/** 주전 배치 순서 (희소한 자리부터). assignLineup 결과의 i번째 선수가 LINEUP_SLOTS[i]를 맡는다 */
export const LINEUP_SLOTS = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'] as const;
export type Slot = (typeof LINEUP_SLOTS)[number];
const INFIELD = new Set(['1B', '2B', '3B', 'SS', 'IF']);
const OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF']);

/** 그 자리를 맡겼을 때의 적합도 (1 = 제 포지션). 수비 모델이 없으므로 기용 순위에만 쓴다 */
export function positionFit(pos: string | null, slot: Slot): number {
  if (slot === 'DH' || pos === slot) return 1;
  if (slot === 'C') return 0.5;
  if (pos === 'C') return slot === '1B' ? 0.9 : 0.8;
  if (pos === null) return 0.92;
  if (pos === 'DH') return slot === '1B' ? 0.95 : 0.82;
  const slotInfield = INFIELD.has(slot);
  if (slotInfield) {
    if (pos === 'IF') return 0.99;
    if (INFIELD.has(pos)) return slot === '1B' ? 0.98 : pos === '1B' ? 0.9 : 0.96;
    return slot === '1B' ? 0.93 : 0.85;
  }
  if (pos === 'OF') return 0.99;
  if (OUTFIELD.has(pos)) return slot === 'CF' ? 0.96 : 0.98;
  return 0.88;
}

/** 9개 자리에 야수를 배정한다. 희소한 자리부터 가장 맞는 선수를 고르는 방식 */
export function assignLineup(avail: SimPlayer[]): SimPlayer[] {
  const used = new Set<number>();
  const out: SimPlayer[] = [];
  for (const slot of LINEUP_SLOTS) {
    let best: SimPlayer | null = null;
    let bestScore = -1;
    for (const p of avail) {
      if (used.has(p.idx)) continue;
      const s = p.value * positionFit(p.pos, slot);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    if (best) {
      used.add(best.idx);
      out.push(best);
    }
  }
  return out;
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

  // 투수: 선발 5명, 나머지 구원
  const pitchers = avail.filter((p) => p.isPitcher);
  const starters = pitchers.filter((p) => p.pit!.startShare >= 0.5).sort((a, b) => a.value - b.value);
  const rotation = starters.slice(0, 5);
  if (rotation.length < 5) {
    const extra = pitchers
      .filter((p) => !rotation.includes(p))
      .sort((a, b) => b.pit!.startShare - a.pit!.startShare || a.value - b.value);
    rotation.push(...extra.slice(0, 5 - rotation.length));
  }
  const bullpen = pitchers
    .filter((p) => !rotation.includes(p))
    .sort((a, b) => a.value - b.value)
    .slice(0, Math.max(0, nPit - rotation.length));
  let closer: SimPlayer | null = null;
  for (const p of bullpen) if (p.lastSaves >= 5 && (!closer || p.lastSaves > closer.lastSaves)) closer = p;
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
  ts.rotation = rotation;
  ts.bullpen = bullpen;
  ts.closer = closer;
  ts.dirty = false;
  let next = Number.MAX_SAFE_INTEGER;
  for (const p of ts.team.org) if (st.absentUntil[p.idx] > day && st.absentUntil[p.idx] < next) next = st.absentUntil[p.idx];
  ts.nextReturnDay = next;
}

/** 오늘의 선발 라인업 (타순 포함). 주전에게 확률로 휴식을 준다 */
export function todaysLineup(ts: TeamSeason, lg: Rates, params: EngineParams, rng: Rng): SimPlayer[] {
  const regulars = assignLineup(ts.hitters);
  const resting = new Set<number>();
  // 주전 중 가치 상위 3명은 덜 쉬고 하위 3명은 더 쉰다 (하위 타선의 플래툰·교체 출전 몫)
  const byValue = [...regulars].sort((a, b) => b.value - a.value);
  byValue.forEach((p, rank) => {
    const factor = rank < 3 ? 0.4 : rank < 6 ? 1 : 1.8;
    const base = p.pos === 'C' ? params.catcherRestChance : params.restChance;
    if (rng.chance(Math.min(0.6, base * factor))) resting.add(p.idx);
  });
  if (resting.size === 0) return battingOrder(regulars, lg);
  const avail = ts.hitters.filter((p) => !resting.has(p.idx));
  const nine = assignLineup(avail.length >= 9 ? avail : ts.hitters);
  return battingOrder(nine, lg);
}

/** 오늘의 선발 투수. 가장 오래 쉰 로테이션 투수, 없으면 불펜에서 길게 던질 수 있는 투수 */
export function todaysStarter(ts: TeamSeason, st: PlayerStates, day: number, params: EngineParams): SimPlayer {
  let best: SimPlayer | null = null;
  for (const p of ts.rotation) {
    if (day - st.lastStartDay[p.idx] < params.starterRestDays) continue;
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
