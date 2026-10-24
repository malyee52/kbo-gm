// 선수 컨디션 (경기 엔진 2 12단계, docs/컨디션_기획안.md v1): 선수마다 하루 하나씩 갖는 몸 상태 값 [−1, +1].
// 흐름(며칠 이어지는 무작위 값, AR(1)) + 사건(감기·몸살 같은 몸 상태 이벤트가 기간 동안 내리는 값)의 합이다.
// 경기 결과·출전·피로·혹사·숨은 능력(기복 포함)을 보지 않는다: 모든 선수가 같은 규칙이라 낱말로 숨은 값이 새지 않는다 (5장).
// 화면에는 낱말(좋음·보통·나쁨)과 사유만 보이고 숫자는 보이지 않는다.

import type { CondParams } from './params';
import type { Rng } from './rng';

/** 정규분포 표본 (Box-Muller, 난수 두 개) */
export function normal(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp1 = (x: number) => (x > 1 ? 1 : x < -1 ? -1 : x);

/** 오래 둔 흐름의 퍼짐 (표준편차) */
export const condSpread = (c: CondParams) => c.sd / Math.sqrt(1 - c.rho * c.rho);

/**
 * 개막 날 흐름: 오래 둔 분포(평균 0, 퍼짐 condSpread)에서 뽑는다. 선수 색인 순서대로 하나씩 (결장·2군 선수도 뽑아 순서를 지킨다).
 * out은 Float32Array: 저장하는 값과 같은 정밀도로 계산해 저장 뒤 이어 돌려도 같다
 */
export function openCondition(out: Float32Array, rng: Rng, c: CondParams): void {
  const s = condSpread(c);
  for (let i = 0; i < out.length; i++) out[i] = clamp1(s * normal(rng));
}

/** 하루 한 걸음: 흐름(내일) = rho × 흐름(오늘) + 흔들림, ±1 밖은 자른다 */
export function stepCondition(flow: Float32Array, rng: Rng, c: CondParams): void {
  for (let i = 0; i < flow.length; i++) flow[i] = clamp1(c.rho * flow[i] + c.sd * normal(rng));
}

/** 그날 컨디션 = clamp(흐름 + 사건) */
export const conditionOf = (flow: number, event = 0): number => clamp1(flow + event);

export type CondWord = '좋음' | '보통' | '나쁨';

/** 낱말 세 단계 (컨디션 값만으로 정한다) */
export function condWord(cond: number, c: CondParams): CondWord {
  return cond >= c.good ? '좋음' : cond <= c.bad ? '나쁨' : '보통';
}

/**
 * 화면 한 줄 "낱말 · 사유" (6.2). 진행 중인 사건이 있으면 사건 사유가 앞선다 (낱말이 보통이어도 보인다).
 * 사유는 실존·가상 선수가 같고, 기복·숨은 능력·경기 결과를 가리키지 않는 중립 문구다
 */
export function condLine(cond: number, c: CondParams, eventReason?: string | null): string {
  const w = condWord(cond, c);
  const why = eventReason || (w === '좋음' ? '몸 상태 좋음' : w === '나쁨' ? (cond <= c.awful ? '컨디션 난조' : '몸이 무거움') : '');
  return why ? `${w} · ${why}` : w;
}
