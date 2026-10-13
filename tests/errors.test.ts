// 수비수별 실책 (2026-10-13 사용자 "수비 능력치에 따른 실책 비율"): 수비가 나쁠수록 실책률이 높고, 실책은 수비수에게 남고, 저장·불러오기에 남는다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
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

  it('한 시즌: 실책은 수비수에게 남고 합이 실책 출루 수와 같다, 저장·불러오기에도', () => {
    const g = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'err-t' }, FAST);
    g.advance(40);
    const s = g.season;
    const sum = s.errors.reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totals.roe);
    expect(sum).toBeGreaterThan(0);
    // 투수는 실책을 하지 않는다 (수비 8명만)
    expect(g.world.players.filter((p) => p.isPitcher).every((p) => (s.errors[p.idx] ?? 0) === 0)).toBe(true);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.season.errors).toEqual(s.errors);
  }, 300_000);
});
