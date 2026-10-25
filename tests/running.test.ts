// 경기 엔진 2 8단계: 주루 확장 (3루·이중 도루, 견제사, 피치아웃, 히트앤드런, 번트 결과·스퀴즈, 번트 타석 투구 수)
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyRunTally, Rng, Season, worldForYear, type EngineParams } from '../src/engine';
import { Ev, type PaRates } from '../src/engine/pa';
import { drawInPlay } from '../src/engine/resolver';

const store = loadDataStore();
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

function run(params: EngineParams, seed: string) {
  const running = emptyRunTally();
  const s = Season.start(worldForYear(store, 2025, params), params, seed, { running });
  s.runToEnd();
  return { running, totals: s.totals };
}

describe('주루·작전 (엔진 2 8단계)', () => {
  it('히트앤드런 첫 공 인플레이는 인플레이 결과만, 몫은 확률표의 인플레이 몫대로', () => {
    const r: PaRates = { so: 0.2, bb: 0.1, hbp: 0.01, hr: 0.03, s1: 0.16, d2: 0.04, t3: 0.005, scale: 1 };
    const rng = new Rng('hnr-draw');
    const n = 200_000;
    const c = new Map<Ev, number>();
    for (let i = 0; i < n; i++) { const ev = drawInPlay(r, rng); c.set(ev, (c.get(ev) ?? 0) + 1); }
    expect(c.has(Ev.SO) || c.has(Ev.BB) || c.has(Ev.HBP)).toBe(false);
    const inPlay = 1 - r.so - r.bb - r.hbp;
    expect((c.get(Ev.S1) ?? 0) / n).toBeCloseTo(r.s1 / inPlay, 2);
    expect((c.get(Ev.HR) ?? 0) / n).toBeCloseTo(r.hr / inPlay, 2);
  });

  it('번트 타석 투구 수는 HF 희생번트 타석 분포 (평균 1.74구 ±3%), 작전이 실제로 일어난다', () => {
    // 한 시즌 번트 약 420번이면 평균의 표준오차가 약 2.8%라 ±3%가 운에 걸린다 (16-3d 어깨에서 한 시즌 −3.8%). 다섯 시즌을 합쳐 표준오차 약 1.3%로 본다
    const runs = ['run-a', 'run-b2', 'run-c', 'run-d', 'run-e'].map((seed) => run(FAST, seed));
    const { running, totals } = runs[0];
    const pitches = runs.reduce((a, r) => a + r.running.buntPitches, 0) / runs.reduce((a, r) => a + r.running.bunt, 0);
    expect(pitches).toBeGreaterThan(1.74 * 0.97);
    expect(pitches).toBeLessThan(1.74 * 1.03);
    for (const k of ['sb3', 'double', 'pickoff', 'pitchout', 'hnr', 'squeeze', 'buntHit', 'buntLeadOut'] as const) expect(running[k]).toBeGreaterThan(0);
    expect(totals.sb).toBe(running.sb2 + running.sb3);
    expect(totals.cs).toBe(running.cs2 + running.cs3);
  }, 120_000);

  it('번트 실패 몫을 모두 0으로 두면 희생번트는 모두 성공, 작전을 끄면 그 횟수가 0', () => {
    const p: EngineParams = {
      ...FAST,
      bunt: { ...FAST.bunt, hit: 0, leadOut: 0, popOut: 0, dp: 0, squeeze: 0 },
      run: { ...FAST.run, hnr: 0, pitchout: 0, pickoff: 0, thirdShare: 0 },
    };
    const { running, totals } = run(p, 'run-b');
    expect(running.buntSac).toBe(running.bunt);
    expect(totals.sac).toBe(running.bunt);
    expect(running.hnr + running.pitchout + running.pickoff + running.sb3 + running.cs3 + running.squeeze).toBe(0);
  }, 120_000);
});
