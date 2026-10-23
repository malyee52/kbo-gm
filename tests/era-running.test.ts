// 시대별 주루·병살·희생플라이·도루 배율 (엔진 2 13단계, engine/eras.ts withEraRunning)
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { eraRunningOf, withEraRunning } from '../src/engine/eras';

const TABLE: EngineParams = {
  ...DEFAULT_PARAMS,
  eraRunning: [
    { year: 1990, dp: 0.8, sf: 0.9, steal: 1.1, adv: 0.9 },
    { year: 2000, dp: 1, sf: 1, steal: 1, adv: 1 },
  ],
};

describe('시대별 주루 배율 (엔진 2 13단계)', () => {
  it('기준 해 사이는 선으로 잇고, 처음보다 앞·끝보다 뒤는 끝 값', () => {
    expect(eraRunningOf(TABLE, 1985).dp).toBe(0.8);
    expect(eraRunningOf(TABLE, 1990).dp).toBe(0.8);
    expect(eraRunningOf(TABLE, 1995).dp).toBeCloseTo(0.9, 10);
    expect(eraRunningOf(TABLE, 1995).steal).toBeCloseTo(1.05, 10);
    expect(eraRunningOf(TABLE, 2025).dp).toBe(1);
  });

  it('곱한 값: 병살·희생플라이·도루, 추가 진루는 1을 넘지 않는다', () => {
    const p = withEraRunning(TABLE, 1990);
    expect(p.doublePlay).toBeCloseTo(DEFAULT_PARAMS.doublePlay * 0.8, 10);
    expect(p.sacFly).toBeCloseTo(DEFAULT_PARAMS.sacFly * 0.9, 10);
    expect(p.stealScale).toBeCloseTo(DEFAULT_PARAMS.stealScale * 1.1, 10);
    expect(p.firstToThirdOnSingle).toBeCloseTo(DEFAULT_PARAMS.firstToThirdOnSingle * 0.9, 10);
    const big = withEraRunning({ ...TABLE, eraRunning: [{ year: 1990, dp: 1, sf: 1, steal: 1, adv: 3 }] }, 1990);
    expect(big.secondToHomeOnSingle).toBe(1);
  });

  it('배율이 모두 1인 해(표가 비었거나 현대)는 받은 조정값 그대로', () => {
    const empty = { ...DEFAULT_PARAMS, eraRunning: [] };
    expect(withEraRunning(empty, 1985)).toBe(empty);
    expect(withEraRunning(TABLE, 2025)).toBe(TABLE);
  });
});
