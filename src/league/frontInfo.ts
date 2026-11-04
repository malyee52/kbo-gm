// 프런트 "선수 요구 정보" (재정 2 기획안 4.4, 2026-11-03 사용자 결정 "최저선 정보 더하기").
// 요구액 표시는 그대로 두고, 프런트 예산이 클수록 선수가 '받아들일 최저선'을 좁은 범위로 알려 준다.
// 범위 = 진짜 최저선을 반드시 담는 구간. 구간 안에서 진짜 값이 놓이는 자리는 시드로 고정한다
// (같은 화면을 다시 열어도, 프런트 예산을 바꿔도 같은 자리 → 예산을 올리면 같은 중심 쪽으로 좁아진다).
// 화면 정보일 뿐: AI 판단·계약 결과·저장에는 쓰지 않는다. 수치는 모두 임시값.
import { Rng } from '../engine/rng';
import { activeBudgetOf, OPS_BUDGET_RANGE } from './finance';
import type { LeagueState } from './types';

/** 프런트 예산 끝값에서 범위 반폭 (진짜 최저선 대비): 45억 ±15% · 80억 ±3%, 그 사이는 선형 (임시값) */
export const FRONT_INFO_WIDTH: [number, number] = [0.15, 0.03];
/** 범위 끝을 맞추는 단위 (만 원, 100만 원) */
export const FRONT_INFO_UNIT = 100;

/** 프런트 예산(만 원, 2026년 돈)의 범위 반폭 (비율) */
export function frontInfoWidth(front: number): number {
  const [lo, hi] = OPS_BUDGET_RANGE.front;
  const a = Math.max(lo, Math.min(hi, front));
  return FRONT_INFO_WIDTH[0] + ((FRONT_INFO_WIDTH[1] - FRONT_INFO_WIDTH[0]) * (a - lo)) / (hi - lo);
}

export interface LineRange {
  lo: number;
  hi: number;
  /** 반폭 (비율) */
  width: number;
}

/**
 * 진짜 최저선 truth를 담는 범위. key: 같은 선수·같은 협상이면 같은 자리 (예: `fa/2026/<선수 id>`).
 * 진짜 값의 자리 u ∈ [0, 1)는 리그 시드와 key로 고정 (Rng), 구간 [truth × (1 − 2w·u), truth × (1 + 2w·(1 − u))]
 */
export function lineRange(seed: string, key: string, truth: number, front: number): LineRange {
  const width = frontInfoWidth(front);
  const u = new Rng(`${seed}/front-info/${key}`).next();
  const lo = Math.floor((truth * (1 - 2 * width * u)) / FRONT_INFO_UNIT) * FRONT_INFO_UNIT;
  const hi = Math.ceil((truth * (1 + 2 * width * (1 - u))) / FRONT_INFO_UNIT) * FRONT_INFO_UNIT;
  return { lo: Math.max(0, lo), hi, width };
}

/** 그 구단의 지금(이번 시즌 확정) 프런트 예산으로 범위. 오프시즌에도 지난 시즌 확정 예산 (계획을 올려 바로 얻지 못하게) */
export function teamLineRange(league: Pick<LeagueState, 'seed' | 'finance'>, team: number, key: string, truth: number): LineRange {
  return lineRange(String(league.seed), key, truth, activeBudgetOf(league, team, 'front'));
}
