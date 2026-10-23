// 시대별 주루·병살·희생플라이·도루 배율 (엔진 2 13단계, engine/eras.ts withEraRunning)
import { describe, expect, it } from 'vitest';
import { batSkillFrom, DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import type { BatRow, Rates } from '../src/data/types';
import { eraEnv, eraRunningOf, withEraRunning } from '../src/engine/eras';

const TABLE: EngineParams = {
  ...DEFAULT_PARAMS,
  eraRunning: [
    { year: 1990, dp: 0.8, sf: 0.9, steal: 1.1, adv: 0.9, err: 0.7 },
    { year: 2000, dp: 1, sf: 1, steal: 1, adv: 1, err: 1 },
  ],
};

describe('시대별 주루 배율 (엔진 2 13단계)', () => {
  it('기준 해 사이는 선으로 잇고, 처음보다 앞·끝보다 뒤는 끝 값', () => {
    expect(eraRunningOf(TABLE, 1985).dp).toBe(0.8);
    expect(eraRunningOf(TABLE, 1990).dp).toBe(0.8);
    expect(eraRunningOf(TABLE, 1995).dp).toBeCloseTo(0.9, 10);
    expect(eraRunningOf(TABLE, 1995).steal).toBeCloseTo(1.05, 10);
    expect(eraRunningOf(TABLE, 2025).dp).toBe(1);
    expect(eraRunningOf(TABLE, 1995).err).toBeCloseTo(0.85, 10);
  });

  it('실책 배율은 리그 환경의 실책 출루 값(roe)에만 곱한다', () => {
    const env = { roe: 0.02, sac: 0.01, unearnedRun: 0.03, wildPitch: 0.005, gbOdds: 1 };
    const e = eraEnv({ year: 1990, env }, TABLE);
    expect(e.roe).toBeCloseTo(0.014, 10);
    expect({ ...e, roe: env.roe }).toEqual(env);
    expect(eraEnv({ year: 2025, env }, TABLE)).toBe(env);
  });

  it('경기 안 비자책 몫(ue)이 있으면 비자책 채우기는 그 해 비율에서 그 몫을 뺀 만큼 (엔진 2 14단계)', () => {
    const env = { roe: 0.02, sac: 0.01, unearnedRun: 0.03, wildPitch: 0.005, gbOdds: 1, unearnedShare: 0.15 };
    const P: EngineParams = { ...TABLE, eraRunning: [{ year: 1990, dp: 1, sf: 1, steal: 1, adv: 1, err: 1, ue: 0.08 }, { year: 2000, dp: 1, sf: 1, steal: 1, adv: 1, err: 1, ue: 0.06 }] };
    expect(eraEnv({ year: 1990, env }, P).unearnedRun).toBeCloseTo((0.15 - 0.08) / (1 - 0.08), 10);
    expect(eraEnv({ year: 1995, env }, P).unearnedRun).toBeCloseTo((0.15 - 0.07) / (1 - 0.07), 10);
    // 경기 안 몫이 비율보다 크면 채우지 않는다
    expect(eraEnv({ year: 1990, env: { ...env, unearnedShare: 0.05 } }, P).unearnedRun).toBe(0);
    // 리그 비율이 없는 환경은 그대로
    const { unearnedShare: _, ...bare } = env;
    expect(eraEnv({ year: 1990, env: bare }, P)).toBe(bare);
  });

  it('곱한 값: 병살·희생플라이·도루, 추가 진루는 1을 넘지 않는다', () => {
    const p = withEraRunning(TABLE, 1990);
    expect(p.doublePlay).toBeCloseTo(DEFAULT_PARAMS.doublePlay * 0.8, 10);
    expect(p.sacFly).toBeCloseTo(DEFAULT_PARAMS.sacFly * 0.9, 10);
    expect(p.stealScale).toBeCloseTo(DEFAULT_PARAMS.stealScale * 1.1, 10);
    expect(p.firstToThirdOnSingle).toBeCloseTo(DEFAULT_PARAMS.firstToThirdOnSingle * 0.9, 10);
    const big = withEraRunning({ ...TABLE, eraRunning: [{ year: 1990, dp: 1, sf: 1, steal: 1, adv: 3, err: 1 }] }, 1990);
    expect(big.secondToHomeOnSingle).toBe(1);
  });

  it('배율이 모두 1인 해(표가 비었거나 현대)는 받은 조정값 그대로', () => {
    const empty = { ...DEFAULT_PARAMS, eraRunning: [] };
    expect(withEraRunning(empty, 1985)).toBe(empty);
    expect(withEraRunning(TABLE, 2025)).toBe(TABLE);
  });
});

describe('도루 실패 기록이 없는 해의 리그 성공률 (엔진 2 13단계, params.sbPctByYear)', () => {
  const lg: Rates = { s1: 0.16, d2: 0.04, t3: 0.005, hr: 0.02, bb: 0.09, hbp: 0.01, so: 0.15 };
  const row = (cs: number | null): BatRow => ({
    id: 'x', team: 'A', pos: '2B', g: 120, pa: 500, ab: 440, r: 60, h: 120, d: 20, t: 3, hr: 7, rbi: 50,
    sb: 30, cs, bb: 50, hbp: 5, so: 70, gdp: 8, sf: 4, sac: 3,
  });
  it('도루 실패가 비면 시도 수 = 도루 ÷ 그 해 성공률 (없으면 0.7)', () => {
    const plain = batSkillFrom([{ row: row(null), w: 1, lg }], lg, DEFAULT_PARAMS);
    const era = batSkillFrom([{ row: row(null), w: 1, lg, sbPct: 0.6 }], lg, DEFAULT_PARAMS);
    // 1루 출루 = 단타 90 + 볼넷 50 + 사구 5, 사전 시도율 0.05 × 40
    expect(plain.sbAtt).toBeCloseTo((30 / 0.7 + 2) / (145 + 40), 10);
    expect(era.sbAtt).toBeCloseTo((30 / 0.6 + 2) / (145 + 40), 10);
  });
  it('도루 실패가 있으면 표 값을 쓰지 않는다', () => {
    const a = batSkillFrom([{ row: row(12), w: 1, lg }], lg, DEFAULT_PARAMS);
    const b = batSkillFrom([{ row: row(12), w: 1, lg, sbPct: 0.6 }], lg, DEFAULT_PARAMS);
    expect(b).toEqual(a);
  });
  it('표는 1982~2002년만 (그 뒤는 선수 기록에서 낸다)', () => {
    const years = Object.keys(DEFAULT_PARAMS.sbPctByYear).map(Number);
    expect(Math.min(...years)).toBe(1982);
    expect(Math.max(...years)).toBe(2002);
  });
});
