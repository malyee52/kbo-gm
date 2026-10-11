// 잠재력과 성장 (기획서 6.3).
//
// - 능력의 크기는 "한 시즌 기여 (대체 선수 대비 런)"로 잰다 (ai/value.ts의 currentRuns와 같은 단위).
// - 성장은 능력 비율 전체를 한 방향으로 조금씩 옮기는 것(shiftSkill)으로 표현하고, 목표 런에 맞게 이동량을 찾는다.
// - 잠재력 = 실제 커리어 전성기에 게임이 매겼을 능력(세 시즌 가중, 가장 높은 시점). 젊은 선수는 나이에 따른 여유분을 운으로 더한다.

import type { DataStore, Meta, Rates } from '../data/types';
import {
  batSkillFrom, batValue, DECLINE_START_AGE, DEFAULT_PARAMS, pitSkillFrom, pitValue, Rng,
  type BatSkill, type EngineParams, type PitSkill, type SimPlayer,
} from '../engine';
import { currentRuns, expectedGrowth, growthCap, type ValueContext } from '../ai/value';

/** 성장 방향: 각 사건 비율이 이동량 1당 얼마나 바뀌는지 (지수). 장타·볼넷이 더 많이 는다 (임시값) */
const BAT_SHIFT = { hr: 1.2, d2: 0.7, t3: 0.3, s1: 0.4, bb: 0.7, hbp: 0, so: -0.6 } as const;
const PIT_SHIFT = { so: 0.6, bb: -0.6, hr: -0.8, hit: -0.3, hbp: 0 } as const;

export function shiftBat(s: BatSkill, d: number): BatSkill {
  const out = { ...s };
  for (const [k, c] of Object.entries(BAT_SHIFT)) out[k as keyof typeof BAT_SHIFT] = s[k as keyof typeof BAT_SHIFT] * Math.exp(c * d);
  return out;
}

export function shiftPit(s: PitSkill, d: number): PitSkill {
  const out = { ...s };
  for (const [k, c] of Object.entries(PIT_SHIFT)) out[k as keyof typeof PIT_SHIFT] = s[k as keyof typeof PIT_SHIFT] * Math.exp(c * d);
  return out;
}

/** 능력 정보만으로 런을 계산하기 위한 최소한의 SimPlayer */
export interface SkillHolder {
  id: string;
  isPitcher: boolean;
  pos: string | null;
  bat: BatSkill | null;
  pit: PitSkill | null;
  birthYear: number | null;
}

export function asSim(p: SkillHolder, lg: Rates, year: number): SimPlayer {
  return {
    idx: -1, id: p.id, name: '', teamIdx: -1, isPitcher: p.isPitcher, pos: p.pos, bats: null, throws: null, foreign: false,
    age: p.birthYear ? year - p.birthYear : null, bat: p.bat, pit: p.pit, lastSaves: 0,
    value: p.isPitcher ? pitValue(p.pit!, lg) : batValue(p.bat!, lg), debutEstimate: false,
  };
}

export function runsOf(p: SkillHolder, ctx: ValueContext, year: number): number {
  return currentRuns(asSim(p, ctx.world.league, year), ctx);
}

/** 목표 런이 되는 이동량 (shiftBat·shiftPit의 d). 이분법으로 찾는다 */
export function shiftForRuns(p: SkillHolder, target: number, ctx: ValueContext, year: number): number {
  const at = (d: number) => runsOf({ ...p, bat: p.bat && shiftBat(p.bat, d), pit: p.pit && shiftPit(p.pit, d) }, ctx, year);
  let lo = -2;
  let hi = 2;
  if (at(hi) <= target) lo = hi;
  else if (at(lo) >= target) hi = lo;
  else {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < target) lo = mid;
      else hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** 목표 런이 되도록 능력을 옮긴 새 능력 */
export function skillForRuns<T extends SkillHolder>(p: T, target: number, ctx: ValueContext, year: number): Pick<T, 'bat' | 'pit'> {
  const d = shiftForRuns(p, target, ctx, year);
  return { bat: p.bat && shiftBat(p.bat, d), pit: p.pit && shiftPit(p.pit, d) };
}

/** 잠재력 산출에 쓰는 시즌 최소 출전 (임시값) */
const PEAK_MIN_PA = 250;
const PEAK_MIN_BF_SP = 250;
const PEAK_MIN_BF_RP = 150;

export interface CareerIndex {
  /** 선수 id → 시즌별 행 */
  bat: Map<string, { year: number; row: import('../data/types').BatRow }[]>;
  pit: Map<string, { year: number; row: import('../data/types').PitRow }[]>;
}

/** 모든 시즌 기록을 선수별로 묶는다 (잠재력·연차 산출용) */
export function careerIndex(store: Pick<DataStore, 'meta' | 'season'>): CareerIndex {
  const bat: CareerIndex['bat'] = new Map();
  const pit: CareerIndex['pit'] = new Map();
  for (const y of store.meta.years) {
    const s = store.season(y);
    if (!s) continue;
    for (const row of s.bat) (bat.get(row.id) ?? bat.set(row.id, []).get(row.id)!).push({ year: y, row });
    for (const row of s.pit) (pit.get(row.id) ?? pit.set(row.id, []).get(row.id)!).push({ year: y, row });
  }
  return { bat, pit };
}

/**
 * 실제 커리어의 전성기 기여: 출전이 충분했던 시즌마다 그 시즌까지 세 시즌 기록으로(게임 능력 산출과 같은 가중치) 능력을 뽑아
 * 런으로 바꾸고 가장 높은 값을 쓴다. 기록이 없으면 null.
 */
export function realPeakRuns(p: SimPlayer, idx: CareerIndex, store: Pick<DataStore, 'meta' | 'season'>, ctx: ValueContext,
                             params: EngineParams = DEFAULT_PARAMS): number | null {
  // 2026-10-12 사용자 "실제로 높았던 선수들의 잠재력이 실제보다 낮다": 예전에는 한 시즌씩 따로 능력을 뽑아(한 시즌 표본이라
  // 평균 쪽으로 크게 당겨진다) 좋은 두 시즌을 평균했다. 이제는 게임이 능력을 매기는 방식 그대로(그 시즌과 앞 두 시즌을
  // seasonWeights로 가중) 출전이 충분했던 시즌마다 능력을 뽑아 가장 높은 값을 쓴다. "그 선수의 전성기에 게임이 매겼을 능력"
  const meta: Meta = store.meta;
  let best: number | null = null;
  const take = (r: number) => { if (best === null || r > best) best = r; };
  if (p.isPitcher) {
    const list = idx.pit.get(p.id) ?? [];
    const at = new Map(list.map((x) => [x.year, x.row]));
    for (const { year, row } of list) {
      const starter = row.gs !== null ? row.gs / Math.max(1, row.g) >= 0.5 : row.outs / Math.max(1, row.g) >= 12;
      if (row.tbf < (starter ? PEAK_MIN_BF_SP : PEAK_MIN_BF_RP)) continue;
      const rows = [0, 1, 2].flatMap((k) => {
        const r = at.get(year - k);
        const s = store.season(year - k);
        return r && s && r.tbf > 0 ? [{ row: r, w: params.seasonWeights[k] ?? 0, lg: s.league.rates }] : [];
      });
      const skill = pitSkillFrom(rows, meta.priors.pitcher, params);
      take(runsOf({ ...p, bat: null, pit: skill, birthYear: null }, ctx, 0));
    }
  } else {
    const list = idx.bat.get(p.id) ?? [];
    const at = new Map(list.map((x) => [x.year, x.row]));
    for (const { year, row } of list) {
      if (row.pa < PEAK_MIN_PA) continue;
      const rows = [0, 1, 2].flatMap((k) => {
        const r = at.get(year - k);
        const s = store.season(year - k);
        return r && s && r.pa > 0 ? [{ row: r, w: params.seasonWeights[k] ?? 0, lg: s.league.rates }] : [];
      });
      const skill = batSkillFrom(rows, meta.priors.batter, params);
      take(runsOf({ ...p, bat: skill, pit: null, birthYear: null }, ctx, 0));
    }
  }
  return best;
}

/** 젊은 선수의 성장 여유분 (런, 임시값). 실제로 얼마나 클지는 0.5~1.5배의 운 */
export function growthRoom(age: number): number {
  if (age <= 20) return 30;
  if (age <= 22) return 24;
  if (age <= 24) return 16;
  if (age <= 26) return 8;
  return 0;
}

/** 잠재력: max(지금 능력, 실제 전성기, 지금 + 나이 여유분 × 운). 같은 시드·선수면 같은 값 */
export function potentialOf(now: number, realPeak: number | null, age: number | null, seed: string, id: string): number {
  const u = new Rng(`${seed}/potential/${id}`).range(0.5, 1.5);
  const room = growthRoom(age ?? 28) * u;
  return Math.max(now, realPeak ?? -Infinity, now + room);
}

/** 터지는 해 확률 (27세 이하, 임시값) */
export const BREAKOUT_CHANCE = 0.07;

/** 성장 판정의 운 크기 (런, 표준편차에 가까운 값. 임시값) */
const GROWTH_NOISE = 3;

/**
 * 한 오프시즌의 성장 판정 (기획서 6.3): 잠재력과의 격차, 나이, 출전 기회, 소폭의 운.
 * share: 지난 시즌 출전 기회 (0~1, 주전 출전량 대비). 27세 이하는 기회가 적으면 덜 자란다.
 * aging: 하락 나이(DECLINE_START_AGE) 이후 노화 하락에 곱하는 배율 (숨겨진 특수능력 '늦게 지는 꽃'. 보통 1)
 * 반환값: 새 능력 기여 (런)
 */
export function growthRuns(age: number, runs: number, potential: number, share: number, rng: Rng, isPitcher = false, aging = 1): number {
  // 출전 기회가 적으면 덜 자라지만(27세 이하), 격차가 크면 그래도 한 해 상한 가까이는 큰다: 기회를 곱한 뒤 상한을 씌운다
  let d = expectedGrowth(age, runs, potential, isPitcher, false);
  if (age <= 27 && d > 0) d *= 0.6 + 0.4 * Math.max(0, Math.min(1, share));
  if (d > 0) d = Math.min(d, growthCap(age));
  // 터지는 해: 27세 이하가 잠재력과 격차가 크면 가끔 상한을 넘어 격차의 40%까지 한 번에 큰다 (난수는 늘 같은 수만큼 쓴다)
  const breakout = rng.chance(BREAKOUT_CHANCE);
  if (breakout && age <= 27 && potential - runs > 0) d = Math.max(d, (potential - runs) * 0.4);
  if (age >= DECLINE_START_AGE && d < 0) d *= aging;
  // 균등 분포 둘의 합으로 가운데가 두꺼운 운을 만든다
  const noise = (rng.next() + rng.next() - 1) * GROWTH_NOISE * 1.7;
  return runs + d + noise;
}
