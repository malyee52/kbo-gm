// 구장 효과 계산 (docs/구장효과_기획안.md 4·5장). 엔진(game.ts)·화면이 같은 함수로 구장 배율을 읽는다.
//
// SimTeam.park = { hr, run?, ev? }: run = 실제 구장 득점 계수 f, ev = 사건별 배율(좌타 L·우타 R 포함), hr = 게임 안 신구장 홈런 배율.
// ev가 있으면 ev를 쓰고, 없으면 f를 지수(params.park hitExp·hrExp)로 나눈다. 신구장 hr은 홈런에 곱한다.

import type { ParkRates, Rates } from '../data/types';
import { NEUTRAL_PARK, type GamePark } from './pa';
import type { EngineParams } from './params';
import type { SimTeam } from './types';

type ParkParams = EngineParams['park'];

/** 경기에 쓰는 홈 구장 사건별 배율 (game.ts) */
export function gameParkOf(tp: SimTeam['park'] | undefined, p: ParkParams): GamePark {
  if (!tp) return NEUTRAL_PARK;
  const run = tp.run ?? 1;
  const withHr = (x: ParkRates | undefined): ParkRates | undefined => x && { s1: x.s1, d2: x.d2, t3: x.t3, hr: tp.hr * x.hr };
  if (tp.ev) return { ...withHr(tp.ev)!, L: withHr(tp.ev.L), R: withHr(tp.ev.R) };
  const hit = run ** p.hitExp;
  return { s1: hit, d2: hit, t3: hit, hr: tp.hr * run ** p.hrExp };
}

/**
 * 사건별 배율이 내는 득점 계수: 1 + Σ 득점 가치 × 리그 비율 × (배율 − 1) ÷ 타석당 득점 (build_data.py park_events와 같은 식).
 * rates는 그 해 리그 타석 결과 비율, rpa는 타석당 득점
 */
export function runFactorOf(m: ParkRates, rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>, rpa: number, p: ParkParams): number {
  if (!(rpa > 0)) return 1;
  const v = p.runValue;
  return 1 + (v.s1 * rates.s1 * (m.s1 - 1) + v.d2 * rates.d2 * (m.d2 - 1) + v.t3 * rates.t3 * (m.t3 - 1) + v.hr * rates.hr * (m.hr - 1)) / rpa;
}

/** 화면용 구장 지수 (배율, 1 = 리그 평균): 득점 계수와 사건별 배율, 좌타·우타 홈런 */
export interface ParkIndex {
  run: number;
  s1: number;
  d2: number;
  t3: number;
  hr: number;
  hrL: number;
  hrR: number;
}

export function parkIndexOf(tp: SimTeam['park'] | undefined, p: ParkParams, rates: Pick<Rates, 's1' | 'd2' | 't3' | 'hr'>, rpa: number): ParkIndex {
  const g = gameParkOf(tp, p);
  // 실제 구장 득점 계수가 있고 신구장 배율이 없으면 그 값 그대로 (사건별 배율의 수준을 그 값에 맞춰 두었다)
  const run = tp?.run !== undefined && tp.hr === 1 ? tp.run : runFactorOf(g, rates, rpa, p);
  return { run, s1: g.s1, d2: g.d2, t3: g.t3, hr: g.hr, hrL: g.L?.hr ?? g.hr, hrR: g.R?.hr ?? g.hr };
}
