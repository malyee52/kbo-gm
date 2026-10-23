// 엔진 2 12단계: 선수 컨디션 (docs/컨디션_기획안.md v1): 흐름·낱말·효과 0 = 지금 엔진·기복과 무관·저장 뒤 이어 돌리기
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { condLine, condSpread, condWord, DEFAULT_PARAMS, Rng, Season, worldForYear, type EngineParams } from '../src/engine';
import { openCondition, stepCondition } from '../src/engine/condition';

const store = loadDataStore();
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const C = DEFAULT_PARAMS.cond;
const withCond = (cond: Partial<EngineParams['cond']>): EngineParams => ({ ...NO_PILOT, cond: { ...C, ...cond } });

function run(params: EngineParams, seed: string, days: number, init: { hiddenSeed?: string } = {}) {
  const s = Season.start(worldForYear(store, 2025, params), params, seed, { cal: UNIT, ...init });
  for (let d = 0; d < days && !s.done; d++) s.simulateDay();
  return s;
}
const results = (s: Season) => {
  const { cond: _c, condDay: _d, ...rest } = s.toSave();
  return JSON.stringify(rest);
};

describe('컨디션 흐름 (condition.ts)', () => {
  it('오래 둔 퍼짐 약 0.35, 낱말 비율 약 12.7 / 74.7 / 12.7%, 평균 0', () => {
    expect(condSpread(C)).toBeCloseTo(0.351, 2);
    const flow = new Float32Array(2000);
    const rng = new Rng('cond-dist');
    openCondition(flow, rng, C);
    let n = 0, sum = 0, sq = 0;
    const words = { 좋음: 0, 보통: 0, 나쁨: 0 };
    for (let d = 0; d < 60; d++) {
      stepCondition(flow, rng, C);
      for (const v of flow) { n++; sum += v; sq += v * v; words[condWord(v, C)]++; }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(Math.sqrt(sq / n)).toBeGreaterThan(0.33);
    expect(Math.sqrt(sq / n)).toBeLessThan(0.37);
    expect(words.좋음 / n).toBeGreaterThan(0.11);
    expect(words.좋음 / n).toBeLessThan(0.145);
    expect(words.나쁨 / n).toBeGreaterThan(0.11);
    expect(words.나쁨 / n).toBeLessThan(0.145);
  });

  it('며칠 이어진다: 하루 뒤 상관 약 0.9', () => {
    const flow = new Float32Array(3000);
    const rng = new Rng('cond-ar');
    openCondition(flow, rng, C);
    const before = Float32Array.from(flow);
    stepCondition(flow, rng, C);
    let xy = 0, xx = 0;
    for (let i = 0; i < flow.length; i++) { xy += before[i] * flow[i]; xx += before[i] * before[i]; }
    expect(xy / xx).toBeGreaterThan(0.85);
    expect(xy / xx).toBeLessThan(0.95);
  });

  it('낱말 · 사유 문구 (숫자 없음, 사건 사유가 앞선다)', () => {
    expect(condLine(0.5, C)).toBe('좋음 · 몸 상태 좋음');
    expect(condLine(0.1, C)).toBe('보통');
    expect(condLine(-0.5, C)).toBe('나쁨 · 몸이 무거움');
    expect(condLine(-0.8, C)).toBe('나쁨 · 컨디션 난조');
    expect(condLine(0.1, C, '감기')).toBe('보통 · 감기');
    expect(condLine(-0.6, C, '감기')).toBe('나쁨 · 감기');
    for (const v of [-1, -0.4, 0, 0.4, 1]) expect(condLine(v, C)).not.toMatch(/\d/);
  });
});

describe('시즌의 컨디션 (엔진 2 12단계)', () => {
  it('효과 0이면 흐름의 크기와 상관없이 경기 결과가 같다 (컨디션 줄기가 다른 난수를 건드리지 않는다)', () => {
    const a = run(withCond({ edge: 0 }), 'cond-zero', 50);
    const b = run(withCond({ edge: 0, sd: 0 }), 'cond-zero', 50);
    expect(results(a)).toBe(results(b));
    // 효과를 켜면 달라진다
    const c = run(withCond({ edge: 0.04 }), 'cond-zero', 50);
    expect(results(c)).not.toBe(results(a));
  });

  it('숨은 능력 시드(기복·실제 한계 자리)를 바꿔도 모든 선수의 컨디션이 날마다 같다', () => {
    const a = run(NO_PILOT, 'cond-hidden', 30, { hiddenSeed: 'h1' });
    const b = run(NO_PILOT, 'cond-hidden', 30, { hiddenSeed: 'h2' });
    for (const p of a.world.players) expect(a.condition(p.idx)).toBe(b.condition(p.idx));
  });

  it('경기가 없는 날도 한 걸음 가고, 언제 물어도 그날 값은 같다', () => {
    const a = run(NO_PILOT, 'cond-day', 20);
    const b = run(NO_PILOT, 'cond-day', 10);
    // b는 10일까지 진행했지만 20일 값을 미리 물어볼 수 있다
    const ahead = b.world.players.map((p) => b.condition(p.idx, 20));
    expect(a.world.players.map((p) => a.condition(p.idx))).toEqual(ahead);
  });

  it('저장 뒤 이어 돌려도 같다 (컨디션 저장 있음·없음 모두)', () => {
    const params = NO_PILOT;
    const full = run(params, 'cond-save', 80);
    const half = run(params, 'cond-save', 35);
    const save = half.toSave();
    expect(save.cond).toBeDefined();
    const r1 = Season.restore(worldForYear(store, 2025, params), params, JSON.parse(JSON.stringify(save)));
    const { cond: _c, condDay: _d, ...old } = save;
    const r2 = Season.restore(worldForYear(store, 2025, params), params, JSON.parse(JSON.stringify(old)));
    for (let d = 35; d < 80; d++) { r1.simulateDay(); r2.simulateDay(); }
    expect(results(r1)).toBe(results(full));
    expect(results(r2)).toBe(results(full));
    expect(JSON.stringify(r1.toSave().cond)).toBe(JSON.stringify(full.toSave().cond));
  });
});
