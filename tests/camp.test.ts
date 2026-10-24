// 스프링캠프 (league/camp.ts): 오프시즌에 고르고 개막 때 비용·경기력·부상·유망주 성장. 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { CAMP_DAYS, campInjury, FOCUS, PLACE } from '../src/league/camp';
import { runsOf } from '../src/league/growth';
import { valueContext } from '../src/ai/value';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

function toReady(g: GameSession) {
  g.advance(100000);
  g.beginOffseason();
  for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    g.nextStage();
  }
}

describe('스프링캠프', () => {
  it('고른 캠프는 개막 때 비용·개막 뒤 경기력으로, AI 구단도 저마다 캠프를 차린다. 저장·재현이 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'camp-1' }, FAST);
    toReady(g);
    expect(g.campPlan).toEqual({ place: 'japan', focus: 'balanced' });
    expect(g.setCamp({ place: 'usa', focus: 'bat' }).ok).toBe(true);
    expect(g.setCamp({ place: 'mars', focus: 'bat' } as never).ok).toBe(false);
    const saved = roundTrip(g.toSave());
    expect(g.openNextSeason().ok).toBe(true);
    const L = g.league;
    expect(L.ledger.some((e) => e.year === 2027 && e.from === 2 && e.amount === PLACE.usa.cost && e.note.includes('스프링캠프'))).toBe(true);
    const mine = L.events!.forms!.filter((f) => f.team === 2 && f.year === 2027 && f.note.startsWith('스프링캠프'));
    expect(mine).toEqual([expect.objectContaining({ side: 'bat', from: 0, until: CAMP_DAYS, edge: Math.round(FOCUS.bat.bat * PLACE.usa.factor * 10000) / 10000 })]);
    expect(L.camps!.filter((c) => c.year === 2027).length).toBe(g.world.teams.length);
    expect(L.campPlan).toBeUndefined();
    expect(g.news.some((n) => n.text.includes('스프링캠프: 미국 애리조나'))).toBe(true);
    // 개막 직후 경기력: 우리 타자에게 + (formToday)
    // 저장 → 불러와 개막해도 같다, 처음부터 재현해도 같다
    const h = GameSession.load(store, saved, FAST);
    h.openNextSeason();
    h.advance(5); g.advance(5);
    expect(roundTrip(h.toSave())).toEqual(roundTrip(g.toSave()));
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league.camps)).toEqual(roundTrip(L.camps));
  }, 900_000);

  it('체력 훈련은 시즌 부상 빈도를 줄이고, 유망주 집중은 24세 이하를 잠재력 안에서 끌어올린다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 4, seed: 'camp-2' }, FAST);
    toReady(g);
    g.setCamp({ place: 'japan', focus: 'youth' });
    const L = g.league;
    const young = L.players.filter((p) => p.team === 4 && p.birthYear !== null && 2027 - p.birthYear <= 24 && p.reserve === undefined);
    expect(young.length).toBeGreaterThan(5);
    const before = new Map(young.map((p) => [p.id, { ...p }]));
    g.openNextSeason();
    const ctx = valueContext(g.world);
    let up = 0;
    for (const p of young) {
      const lp = g.leaguePlayer(p.id);
      if (!lp || lp.team !== 4) continue;
      const a = runsOf(before.get(p.id)!, ctx, 2027);
      const b = runsOf(lp, ctx, 2027);
      expect(b).toBeLessThanOrEqual(Math.max(a, lp.potential) + 0.2);
      if (b > a + 0.5) up++;
    }
    expect(up).toBeGreaterThan(3);
    // 체력: 부상 배율
    expect(campInjury({ camps: [{ year: 2027, team: 1, place: 'japan', focus: 'fitness', cost: 0 }] }, 1, 2027)).toBeCloseTo(0.85);
    expect(campInjury({ camps: [{ year: 2027, team: 1, place: 'home', focus: 'balanced', cost: 0 }] }, 1, 2027)).toBeCloseTo(1.05);
    expect(campInjury({ camps: [] }, 1, 2027)).toBe(1);
    const fit = g.world.teams.find((t) => g.league.camps!.find((c) => c.team === t.idx && c.year === 2027)?.focus === 'fitness');
    if (fit) expect(fit.injuryRate ?? 1).toBeLessThan(1);
  }, 900_000);
});
