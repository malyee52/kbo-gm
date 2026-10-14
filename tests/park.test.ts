// 구장 특성 (league/stadium.ts, 2026-10-14): 신구장 크기·돔을 골라 짓고, 완공 뒤 홈 경기 홈런에 곱해진다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { DOME, NEW_PARK, PARK_SIZES, parkFactor, stadiumFill, stadiumYearEnd } from '../src/league/stadium';
import { worldFromLeague } from '../src/league/world';

let store: DataStore;
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('구장 특성', () => {
  it('신구장: 크기·돔을 골라 주문하면 돔은 공사비가 늘고, 완공 뒤 홈런 배율·돔 관중 가산이 생긴다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'park-1' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    g.advance(100000);
    g.beginOffseason();
    const L = g.league;
    L.ledger.push({ year: 2027, from: -1, to: 0, amount: 5_000_000, note: '시험 자금', kind: 'other' });
    const r = g.orderStadium('new-0', { size: 'hitter', dome: true });
    expect(r.ok).toBe(true);
    const p = L.stadiums![0].project!;
    expect(p).toMatchObject({ kind: 'new', hr: PARK_SIZES.hitter.hr, dome: true, cost: Math.round(NEW_PARK.options[0].cost * DOME.cost) });
    // 원래 구장은 ×1 (실제 기록에 구장 효과가 이미 들어 있다)
    expect(parkFactor(L.stadiums![1])).toEqual({ hr: 1, dome: false });
    expect(worldFromLeague(L, store, DEFAULT_PARAMS).teams[0].park).toBeUndefined();
    // 완공 (결산 정리)
    stadiumYearEnd(L, p.open - 1, () => 0, 0);
    expect(L.stadiums![0]).toMatchObject({ hr: PARK_SIZES.hitter.hr, dome: true, opened: p.open });
    expect(stadiumFill(L.stadiums![0], p.open + 5)).toBeCloseTo(((L.stadiums![0].quality - 50) / 50) * 0.06 + DOME.fill, 5);
    expect(worldFromLeague(L, store, DEFAULT_PARAMS).teams[0].park).toEqual({ hr: PARK_SIZES.hitter.hr });
    expect(g.orderStadium('new-1', { size: 'huge' as never }).ok).toBe(false);
  }, 300_000);

  it('엔진: 홈 구장 홈런 배율이 크면 그 구장 경기에서 홈런이 늘어난다 (구장 효과 없는 월드와 비교)', () => {
    const hr = (park: number) => {
      let n = 0;
      for (const seed of ['pk-a', 'pk-b']) {
        const w = worldForYear(store, 2025);
        if (park !== 1) for (const t of w.teams.slice(0, 3)) t.park = { hr: park };
        const s = Season.start(w, NO_PILOT, seed);
        s.runToEnd();
        n += s.totals.hr;
      }
      return n;
    };
    const base = hr(1);
    const big = hr(2);
    // 세 구단 홈 경기(약 30%)에서 홈런 확률 두 배 → 리그 홈런 약 +25%
    expect(big / base).toBeGreaterThan(1.12);
  }, 300_000);
});
