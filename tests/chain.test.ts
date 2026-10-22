// 경기 엔진 2 3단계: 볼카운트 사슬 (src/engine/chain.ts)과 B1 해결기
import { describe, expect, it } from 'vitest';
import { End, endProbs, samplePitches, solveKnobs, solvedChain } from '../src/engine/chain';
import { DEFAULT_PARAMS } from '../src/engine/params';
import { Ev, type PaRates } from '../src/engine/pa';
import { B0, chainResolver } from '../src/engine/resolver';
import { Rng } from '../src/engine/rng';

const shape = DEFAULT_PARAMS.chainShape;

describe('볼카운트 사슬', () => {
  it('리그 모양 칸마다 확률 합이 1이다', () => {
    expect(shape).toHaveLength(12);
    for (const c of shape) expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
  });

  it('끝 확률 합이 1이다', () => {
    const e = endProbs(shape, [1.3, 0.8, 2]);
    expect(e.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('손잡이를 풀면 사슬 끝 확률이 목표와 같다 (1e-9)', () => {
    // 리그 평균, 삼진형, 제구형, 볼넷 많은 타자, 극단값
    for (const [K, W, H] of [[0.197, 0.0915, 0.012], [0.32, 0.06, 0.008], [0.12, 0.04, 0.01], [0.14, 0.17, 0.02], [0.6, 0.0005, 0.0005], [0.0005, 0.3, 0.05]]) {
      const e = endProbs(shape, solveKnobs(shape, K, W, H));
      expect(Math.abs(e[End.K] - K)).toBeLessThan(1e-9);
      expect(Math.abs(e[End.W] - W)).toBeLessThan(1e-9);
      expect(Math.abs(e[End.H] - H)).toBeLessThan(1e-9);
    }
  });

  it('뽑은 공 경로는 끝에 맞는 공 수를 낸다: 삼진 3구 이상, 볼넷 4구 이상', () => {
    const ch = solvedChain(shape, [1, 1, 1]);
    const rng = new Rng('chain-path');
    for (let i = 0; i < 2000; i++) {
      expect(samplePitches(ch, End.K, rng)).toBeGreaterThanOrEqual(3);
      expect(samplePitches(ch, End.W, rng)).toBeGreaterThanOrEqual(4);
      expect(samplePitches(ch, End.X, rng)).toBeGreaterThanOrEqual(1);
    }
  });

  it('리그 평균 매치업의 결과별 투구 수가 2025 실제(삼진 4.85·볼넷 5.62·인플레이 3.42)와 3% 안이다', () => {
    const ch = solvedChain(shape, solveKnobs(shape, 0.1969, 0.0915, 0.0125));
    const rng = new Rng('chain-mean');
    const mean = (end: End) => { let s = 0; for (let i = 0; i < 20000; i++) s += samplePitches(ch, end, rng); return s / 20000; };
    expect(Math.abs(mean(End.K) / 4.85 - 1)).toBeLessThan(0.03);
    expect(Math.abs(mean(End.W) / 5.62 - 1)).toBeLessThan(0.03);
    expect(Math.abs(mean(End.X) / 3.42 - 1)).toBeLessThan(0.03);
  });
});

describe('B1 해결기', () => {
  const rates: PaRates = { so: 0.21, bb: 0.09, hbp: 0.012, hr: 0.025, s1: 0.16, d2: 0.04, t3: 0.004, scale: 1 };

  it('결과는 B0와 같은 확률표로 뽑는다 (같은 난수면 같은 결과)', () => {
    const b1 = chainResolver(shape);
    for (let i = 0; i < 500; i++) {
      const seed = `b1-${i}`;
      expect(b1.resolve(rates, new Rng(seed)).ev).toBe(B0.resolve(rates, new Rng(seed)).ev);
    }
  });

  it('삼진·볼넷·사구 비율이 확률표와 같고 결과마다 공 수가 맞다', () => {
    const b1 = chainResolver(shape);
    const rng = new Rng('b1-rates');
    const n = 100000;
    const cnt = new Map<Ev, number>();
    for (let i = 0; i < n; i++) {
      const o = b1.resolve(rates, rng);
      cnt.set(o.ev, (cnt.get(o.ev) ?? 0) + 1);
      if (o.ev === Ev.SO) expect(o.pitches).toBeGreaterThanOrEqual(3);
      if (o.ev === Ev.BB) expect(o.pitches).toBeGreaterThanOrEqual(4);
    }
    for (const [ev, p] of [[Ev.SO, rates.so], [Ev.BB, rates.bb], [Ev.HBP, rates.hbp]] as const) {
      const se = Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs((cnt.get(ev) ?? 0) / n - p)).toBeLessThan(4 * se);
    }
  });

  it('같은 목표는 담아 둔 사슬을 다시 쓰고, 처음 푼 사슬과 같다', () => {
    const a = chainResolver(shape);
    const b = chainResolver(shape);
    expect(a.chainFor(rates).knobs).toEqual(b.chainFor(rates).knobs);
    expect(a.chainFor(rates)).toBe(a.chainFor(rates));
  });
});
