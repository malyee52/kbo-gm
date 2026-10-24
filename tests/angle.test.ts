// 타구각 갈래 (능력치 v2 16-2, docs/능력치v2_기획안.md 10.2·11.3·6장 16-2 기준)
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, worldForYear } from '../src/engine';
import {
  Band, bandProbs, ballMix, batBallSide, batTarget, buildShift, leagueBall, O_HR, O_OUT, perContact, pitBallSide, pitTarget, resultTypes,
} from '../src/engine/angle';
import { leagueEnvFor } from '../src/engine/ratings';

const store = loadDataStore();
const P = DEFAULT_PARAMS;
const years = [...Object.keys(P.groundBallShareByYear).map(Number), 2005];

/** 지금 엔진(6단계)의 결과별 유형 비율 [땅볼, 라인, 뜬공, 내야 뜬공] (땅볼 가중치 × 그 해 배율) */
const typesNow = (o: number, odds: number) => {
  const w = [...resultTypes(o, P)];
  w[0] *= odds;
  const s = w.reduce((a, x) => a + x, 0);
  return w.map((x) => x / s);
};

describe('타구각 영점', () => {
  it.each(years)('%i년: 모든 손잡이가 0이면 맞힌 공당 결과와 결과별 유형 비율이 지금 엔진과 같다 (1e-9)', (year) => {
    const s = store.season(year)!;
    const lg = s.league.rates;
    const odds = leagueEnvFor(s.league, P, year).gbOdds ?? 1;
    const lb = leagueBall(lg, P, odds);
    const m = ballMix(lb, 0, 1, null, null, null);
    const want = perContact(lg);
    for (let o = 0; o < 5; o++) expect(Math.abs(m.q[o] - want[o])).toBeLessThan(1e-9);
    // 각도 분포의 구간 확률 = 결과표에서 나온 구간 몫
    const pz = bandProbs(lb.mix, lb.cuts);
    for (let z = 0; z < 5; z++) expect(Math.abs(pz[z] - lb.pz[z])).toBeLessThan(1e-9);
    // 결과 → 유형: P(구간 | 결과)를 유형으로 모으면 지금 표
    for (let o = 0; o < 4; o++) {
      const byBand = m.pz.map((z, i) => z * m.pi[i][o]);
      const tot = byBand.reduce((a, x) => a + x, 0);
      const types = [byBand[Band.GB], byBand[Band.LD], byBand[Band.HA] + byBand[Band.HF], byBand[Band.PU]].map((x) => x / tot);
      const now = typesNow(o, odds);
      for (let t = 0; t < 4; t++) expect(Math.abs(types[t] - now[t])).toBeLessThan(1e-9);
    }
    // 홈런은 모두 홈런 각, 내야 뜬공은 모두 아웃
    expect(m.pi[Band.HA][O_HR]).toBeGreaterThan(0);
    for (const z of [Band.GB, Band.LD, Band.HF, Band.PU]) expect(m.pi[z][O_HR]).toBe(0);
    expect(m.pi[Band.PU][O_OUT]).toBe(1);
  });

  it('2025년 각도 분포는 기획안 두 덩어리(38% N(−12°, 10°) + 62% N(29°, 12°)) 근처로 풀린다', () => {
    const s = store.season(2025)!;
    const lb = leagueBall(s.league.rates, P, leagueEnvFor(s.league, P, 2025).gbOdds ?? 1);
    expect(lb.mix.w).toBeGreaterThan(0.33);
    expect(lb.mix.w).toBeLessThan(0.43);
    expect(Math.abs(lb.mix.am - 29)).toBeLessThan(3);
    expect(Math.abs(lb.mix.as - 12)).toBeLessThan(3);
  });
});

describe('각도 성향과 손잡이', () => {
  const lg = store.season(2025)!.league.rates;
  const lb = leagueBall(lg, P, 1);

  it('뜬공 타자(θ +0.8) 대 땅볼 투수(θ −0.8)는 리그 구간 모양, 한쪽만이면 그쪽으로 기운다 (9.3)', () => {
    const zero = ballMix(lb, 0, 1, null, null, null);
    const fly = ballMix(lb, 0.8, 1, null, null, null);
    const ground = ballMix(lb, -0.8, 1, null, null, null);
    const both = ballMix(lb, 0.8 - 0.8, 1, null, null, null);
    for (let z = 0; z < 5; z++) expect(both.pz[z]).toBeCloseTo(zero.pz[z], 12);
    expect(fly.q[O_HR]).toBeGreaterThan(zero.q[O_HR] * 1.2);
    expect(ground.q[O_HR]).toBeLessThan(zero.q[O_HR] * 0.8);
    expect(fly.pz[Band.GB]).toBeLessThan(zero.pz[Band.GB]);
    expect(ground.pz[Band.GB]).toBeGreaterThan(zero.pz[Band.GB]);
  });

  it('퍼짐이 좁으면(정타형) 내야 뜬공이 줄고 넓으면 는다', () => {
    const tight = bandProbs(lb.mix, lb.cuts, 0, 0.8);
    const wide = bandProbs(lb.mix, lb.cuts, 0, 1.2);
    expect(tight[Band.PU]).toBeLessThan(lb.pz[Band.PU]);
    expect(wide[Band.PU]).toBeGreaterThan(lb.pz[Band.PU]);
  });

  it('정타·거리·주력이 한쪽으로 움직이면 결과도 그쪽으로', () => {
    const base = ballMix(lb, 0, 1, null, null, null).q;
    const hits = (q: number[]) => q[1] + q[2] + q[3] + q[4];
    expect(hits(ballMix(lb, 0, 1, buildShift([0.3, 0, 0, 0], true, 0, 0.5), null, null).q)).toBeGreaterThan(hits(base));
    expect(ballMix(lb, 0, 1, buildShift([0, 0.3, 0, 0], true, 0, 0.5), null, null).q[O_HR]).toBeGreaterThan(base[O_HR]);
    // 주력은 땅볼 단타에만
    const fast = ballMix(lb, 0, 1, buildShift([0, 0, 0, 0], true, 0.4, 0.5), null, null);
    expect(fast.pi[Band.GB][1]).toBeGreaterThan(ballMix(lb, 0, 1, null, null, null).pi[Band.GB][1]);
    expect(fast.pi[Band.LD][1]).toBeCloseTo(ballMix(lb, 0, 1, null, null, null).pi[Band.LD][1], 12);
  });
});

describe('실존 선수 시작값 = 지금 안타 종류 비율', () => {
  const world = worldForYear(store, 2026, { ...P, pilotSeasons: 0 });
  const lg = world.league;
  const lb = leagueBall(lg, P, 1);

  it('타자: 리그 평균 투수 상대로 맞힌 공당 단타·2루타·3루타·홈런이 지금 결과 비율과 같다 (1e-9)', () => {
    let n = 0;
    for (const p of world.players) {
      if (!p.bat || p.isPitcher) continue;
      const side = batBallSide(p.bat, lg, lb, P);
      const q = ballMix(lb, side.theta, side.k, side.shift, null, null).q;
      const want = batTarget(p.bat, lg);
      for (let o = 0; o < 5; o++) expect(Math.abs(q[o] - want[o]), `${p.name} ${o}`).toBeLessThan(1e-9);
      n++;
    }
    expect(n).toBeGreaterThan(200);
  });

  it('투수: 리그 평균 타자 상대로 맞힌 공당 결과가 지금 결과 비율과 같다 (1e-9)', () => {
    let n = 0;
    for (const p of world.players) {
      if (!p.pit) continue;
      const side = pitBallSide(p.pit, lg, lb, P);
      const q = ballMix(lb, side.theta, 1, null, side.shift, null).q;
      const want = pitTarget(p.pit, lg);
      for (let o = 0; o < 5; o++) expect(Math.abs(q[o] - want[o]), `${p.name} ${o}`).toBeLessThan(1e-9);
      n++;
    }
    expect(n).toBeGreaterThan(200);
  });
});
