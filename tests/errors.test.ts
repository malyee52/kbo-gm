// 수비수별 실책 (2026-10-13 사용자 "수비 능력치에 따른 실책 비율"): 수비가 나쁠수록 실책률이 높고, 실책은 수비수에게 남고, 저장·불러오기에 남는다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, simulateSeason, worldForYear } from '../src/engine';
import { BALL_SLOTS, errorPerBall, fielderShares } from '../src/engine/battedball';
import { errorRateOf } from '../src/engine/game';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('수비수별 실책', () => {
  it('수비가 좋을수록 실책률이 낮다', () => {
    expect(errorRateOf(10)).toBeLessThan(errorRateOf(0));
    expect(errorRateOf(-10)).toBeGreaterThan(errorRateOf(0));
    expect(errorRateOf(-100)).toBe(2.5);
    expect(errorRateOf(100)).toBe(0.4);
  });

  it('한 시즌: 실책은 수비수에게 남고 합이 실책 출루 수 이상이다 (외야 안타 실책 포함), 저장·불러오기에도', () => {
    const g = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'err-t' }, FAST);
    g.advance(40);
    const s = g.season;
    const sum = s.errors.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(s.totals.roe);
    expect(s.totals.roe).toBeGreaterThan(0);
    // 엔진 2 7단계: 투수도 자기에게 온 타구에서 실책한다. 다만 몫은 작다
    const pitErr = g.world.players.filter((p) => p.isPitcher).reduce((a, p) => a + (s.errors[p.idx] ?? 0), 0);
    expect(pitErr).toBeLessThan(sum * 0.15);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.season.errors).toEqual(s.errors);
  }, 300_000);

  it('자리별 실책 배율: 아웃 타구 평균이 1이고, 실책 몫이 큰 유격수가 1루수보다 타구당 실책이 많다 (엔진 2 7단계)', () => {
    const lg = store.season(2025)!.league.rates;
    const out = fielderShares(lg, DEFAULT_PARAMS).out;
    const e = errorPerBall(lg, DEFAULT_PARAMS);
    expect(BALL_SLOTS.reduce((a, s) => a + out[s] * e[s], 0)).toBeCloseTo(1, 9);
    expect(e.SS).toBeGreaterThan(e['1B']);
  });

  it('실책·포일·나머지 비자책 몫이 모두 0이면 모든 실점이 자책이다 (경기 안 자책 판정)', () => {
    const P = { ...FAST, pilotSeasons: 0, roePerUnearnedShare: 0, unearnedRunScale: 0, error: { ...DEFAULT_PARAMS.error, passedBall: 0, onHit: 0 } };
    const r = simulateSeason(worldForYear(store, 2025, P), P, 'er-all');
    expect(r.totals.roe).toBe(0);
    expect(r.totals.r).toBeGreaterThan(0);
    expect(r.totals.er).toBe(r.totals.r);
  }, 120_000);
});
