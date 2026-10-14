// 구장 명명권 (league/naming.ts): 오프시즌 제안 → 계약 → 개막마다 수입, AI 구단도 판다, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { namingAt, namingOffers, stadiumName } from '../src/league/naming';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('구장 명명권', () => {
  it('제안을 받아 계약하면 다음 시즌부터 이름이 바뀌고 개막마다 수입이 들어온다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'naming-1' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const offers = namingOffers(g.league, 2, 2026);
    expect(offers.map((o) => o.years)).toEqual([3, 5, 10]);
    expect(new Set(offers.map((o) => o.sponsor)).size).toBe(3);
    for (const o of offers) expect(o.yearly).toBeGreaterThan(50_000);
    const pick = offers[1];
    expect(g.signNaming(pick.id).ok).toBe(true);
    expect(g.signNaming(offers[0].id).ok).toBe(false); // 이미 계약
    expect(namingOffers(g.league, 2, 2026)).toEqual([]);
    expect(stadiumName(g.league, 2, 2027)).toBe(`${pick.sponsor} 파크`);
    expect(namingAt(g.league, 2, 2026)).toBeUndefined();
    for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    const saved = roundTrip(g.toSave());
    g.openNextSeason();
    expect(g.league.ledger.some((e) => e.year === 2027 && e.to === 2 && e.amount === pick.yearly && e.kind === 'sponsor')).toBe(true);
    // AI 구단도 일부는 명명권을 판다
    const sold = g.league.teams.filter((_, t) => t !== 2 && namingAt(g.league, t, 2027)).length;
    expect(sold).toBeGreaterThan(0);
    expect(sold).toBeLessThan(g.league.teams.length - 1);
    const h = GameSession.load(store, saved, FAST);
    h.openNextSeason();
    expect(roundTrip(h.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 600_000);
});
