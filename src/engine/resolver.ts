// 타석을 끝내는 해결기. 경기 상태·규칙(주루·타구·교체·기록)은 공통이고, "타석 결과 함수가 낸 확률로 타석을 어떻게 끝내는가"만 해결기마다 다르다
// (docs/경기엔진2_기획안.md 3.2). B는 타석 한 번에 결과를 뽑고, A(나중 단계)는 공 하나씩 진행한다.

import { Ev, type PaRates } from './pa';
import type { Rng } from './rng';

/** 타석 하나의 끝: 결과와 그 타석에 던진 공 수 (투구 수를 모르는 해결기는 0) */
export interface PaOutcome {
  ev: Ev;
  pitches: number;
}

export interface PaResolver {
  readonly name: string;
  resolve(rates: PaRates, rng: Rng): PaOutcome;
}

/** 확률표에서 결과 하나를 뽑는다 (난수 한 번). 예전 엔진의 타석 뽑기와 같은 순서·같은 산술 */
export function drawEvent(r: PaRates, rng: Rng): Ev {
  let u = rng.next() / r.scale;
  if ((u -= r.so) < 0) return Ev.SO;
  if ((u -= r.bb) < 0) return Ev.BB;
  if ((u -= r.hbp) < 0) return Ev.HBP;
  if ((u -= r.hr) < 0) return Ev.HR;
  if ((u -= r.s1) < 0) return Ev.S1;
  if ((u -= r.d2) < 0) return Ev.D2;
  if ((u -= r.t3) < 0) return Ev.T3;
  return Ev.OUT;
}

/** B0: 엔진 1의 타석 뽑기 그대로. 투구 수는 세지 않는다 */
export const B0: PaResolver = {
  name: 'B0',
  resolve: (r, rng) => ({ ev: drawEvent(r, rng), pitches: 0 }),
};
