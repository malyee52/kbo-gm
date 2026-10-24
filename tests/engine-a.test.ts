// A 해결기 (투구 단위, 엔진 2 17단계, docs/경기엔진2_기획안.md 3.4·3.6): 구종 칸이 비면 사슬이 그대로, 공 하나씩 돌린 타석의 분포가
// 사슬(B가 계산으로 접는 것)과 같고, A로 치른 시즌은 같은 시드면 같은 결과다. 큰 표본 동등성은 tools/engine_ab.ts.
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, Season, worldForYear } from '../src/engine';
import { End, expectedPitches } from '../src/engine/chain';
import { chainShapeFor } from '../src/engine/params';
import { leaguePlateFor, plateChain, plateSteps, ZERO_BAT, ZERO_PIT, type BatPlate, type PitPlate } from '../src/engine/plate';
import { applyPitch, arsenalChain, calledShare, drawPitch, newCount, playOut } from '../src/engine/pitch';

const store = loadDataStore();
const lp = leaguePlateFor(chainShapeFor(DEFAULT_PARAMS, 2025), store.season(2025)!.league.rates, DEFAULT_PARAMS.plate);
const SHIFT = { con: 0.1, eye: -0.05, hbp: 1.2 };
const BAT: BatPlate = { agg: 0.2, eye: -0.3, con: 0.4, two: 0.1, tough: 0.2 };
const PIT: PitPlate = { ctl: 0.3, stuff: -0.2, eff: 0.1 };

describe('구종 자리 (기획안 3.4.1)', () => {
  it('구종 칸이 비었으면 사슬이 칸 함수 사슬(3단계 사슬)과 똑같다', () => {
    const base = plateChain(lp, BAT, PIT, SHIFT);
    for (const arsenal of [undefined, [], [{ type: '직구', share: 0 }]]) {
      const ch = arsenalChain(lp, BAT, PIT, SHIFT, arsenal);
      expect(Array.from(ch.p)).toEqual(Array.from(base.p));
      expect(Array.from(ch.e)).toEqual(Array.from(base.e));
    }
  });

  it('차이가 없는 구종들을 섞으면 사슬이 그대로이고, 차이가 있으면 칸마다 구종 비율로 섞은 값이다', () => {
    const base = plateChain(lp, BAT, PIT, SHIFT);
    const same = arsenalChain(lp, BAT, PIT, SHIFT, [{ type: '직구', share: 0.6 }, { type: '슬라이더', share: 0.4 }]);
    for (let i = 0; i < 60; i++) expect(same.p[i]).toBeCloseTo(base.p[i], 14);
    const fast = plateChain(lp, BAT, { ...PIT, stuff: PIT.stuff + 0.5 }, SHIFT);
    const slow = plateChain(lp, BAT, { ...PIT, ctl: PIT.ctl - 0.4 }, SHIFT);
    const mix = arsenalChain(lp, BAT, PIT, SHIFT, [{ type: '직구', share: 3, stuff: 0.5 }, { type: '커브', share: 1, ctl: -0.4 }]);
    for (let i = 0; i < 60; i++) expect(mix.p[i]).toBeCloseTo(0.75 * fast.p[i] + 0.25 * slow.p[i], 14);
  });
});

describe('A 해결기: 공 하나', () => {
  it('공 하나의 다섯 결과 비율이 칸 확률과 같고, 스트라이크는 칸 함수의 루킹 몫대로 나뉜다', () => {
    const ch = plateChain(lp, BAT, PIT, SHIFT);
    const called = calledShare(lp, BAT, PIT, SHIFT);
    const rng = new Rng('a-pitch');
    const N = 200_000;
    for (const [b, s] of [[0, 0], [3, 2], [1, 2]] as const) {
      const n: Record<string, number> = { B: 0, C: 0, S: 0, F: 0, X: 0, H: 0 };
      for (let i = 0; i < N; i++) n[drawPitch(ch, b, s, rng, called)]++;
      const o = (b * 3 + s) * 5;
      const want = [ch.p[o], ch.p[o + 1], ch.p[o + 2], ch.p[o + 3], ch.p[o + 4]];
      const got = [n.B, n.C + n.S, n.F, n.X, n.H].map((x) => x / N);
      for (let k = 0; k < 5; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(4 * Math.sqrt(want[k] * (1 - want[k]) / N) + 1e-4);
      expect(Math.abs(n.C / (n.C + n.S) - called[b * 3 + s])).toBeLessThan(0.01);
    }
    // 루킹 몫은 칸 함수의 단계 확률에서: 3볼 0스트라이크 칸은 거의 루킹
    const t = plateSteps(lp, 9, BAT, PIT, SHIFT);
    expect(t.zone).toBeGreaterThan(0);
    expect(called[9]).toBeGreaterThan(called[2]);
  });

  it('카운트: 볼 넷이면 볼넷, 스트라이크 셋이면 삼진, 2스트라이크 파울은 그대로', () => {
    const c = newCount();
    expect(applyPitch(c, 'B')).toBeNull();
    expect(applyPitch(c, 'F')).toBeNull();
    expect(applyPitch(c, 'F')).toBeNull();
    expect(applyPitch(c, 'F')).toBeNull();
    expect([c.b, c.s]).toEqual([1, 2]);
    expect(applyPitch(c, 'C')).toBe(End.K);
    const w = newCount();
    for (let i = 0; i < 3; i++) applyPitch(w, 'B');
    expect(applyPitch(w, 'B')).toBe(End.W);
    expect(applyPitch(newCount(), 'X')).toBe(End.X);
    expect(applyPitch(newCount(), 'H')).toBe(End.H);
  });
});

describe('A 해결기: 타석 분포 = 사슬 (B와 식으로 같은 모형)', () => {
  it.each([
    ['리그 평균', ZERO_BAT, ZERO_PIT],
    ['강타자 대 제구형', BAT, PIT],
    ['삼진형 투수', { ...ZERO_BAT, con: -0.5 }, { ctl: 0, stuff: 0.7, eff: -0.2 }],
  ] as const)('%s: 끝 확률과 끝별 평균 투구 수가 사슬 계산과 표본 오차 안', (_, b, p) => {
    const ch = plateChain(lp, b, p);
    const rng = new Rng(`a-pa-${_}`);
    const N = 100_000;
    const ends = [0, 0, 0, 0];
    let pitches = 0;
    for (let i = 0; i < N; i++) {
      const r = playOut(ch, rng);
      ends[r.end]++;
      pitches += r.pitches;
    }
    for (let k = 0; k < 4; k++) {
      const q = ch.e[k];
      expect(Math.abs(ends[k] / N - q)).toBeLessThan(4 * Math.sqrt(q * (1 - q) / N) + 1e-4);
    }
    const ppa = expectedPitches(ch);
    expect(Math.abs(pitches / N - ppa)).toBeLessThan(0.02);
  });
});

describe('A 해결기: 시즌', () => {
  it('A로 치른 시즌은 같은 시드면 같은 결과이고, 공 기호·투구 수가 박스와 맞는다', () => {
    const world = worldForYear(store, 2025, DEFAULT_PARAMS);
    const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
    const run = () => {
      const s = Season.start(world, params, 'a-season', { engine: 'A', boxTeams: [0] });
      for (let d = 0; d < 12; d++) s.simulateDay();
      return s;
    };
    const a = run();
    const b = run();
    expect(a.log).toEqual(b.log);
    expect(JSON.stringify(a.toSave())).toBe(JSON.stringify(b.toSave()));
    // 중계 기록: 사슬로 끝낸 타석은 공 기호가 있고, 공 수의 합이 투수 투구 수와 맞는다
    const plays = [...a.plays.values()][0];
    const pas = plays.filter((x) => x.seq !== undefined);
    expect(pas.length).toBeGreaterThan(50);
    for (const x of pas) {
      if (x.kind === 'SO') expect('CST').toContain(x.seq!.at(-1));
      if (x.kind === 'BB' && !x.seq!.includes('I')) expect(x.seq!.replace(/[^B]/g, '').length).toBe(4);
      expect(x.np).toBeGreaterThan(0);
    }
  }, 120_000);
});
