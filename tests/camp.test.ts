// 스프링캠프 (league/camp.ts): 오프시즌에 고르고 개막 때 비용·부상·유망주 성장. 저장·재현
// 2026-11-12 개편 (Q36): 개막 뒤 30일 경기력을 빼고 유망주 성장·시즌 부상 위험으로 옮겼다. 첫 시험의 경기력 확인을 '경기력 효과 없음'으로,
// 둘째 시험의 부상 배율 값을 새 값표로 고쳤다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { aiCamp, campInjury, campInjuryOf, CAMP_FOCUSES, CAMP_PLACES, FOCUS, PLACE } from '../src/league/camp';
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
  it('고른 캠프는 개막 때 비용으로 (개막 뒤 경기력 효과는 없다), AI 구단도 저마다 캠프를 차린다. 저장·재현이 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'camp-1' }, FAST);
    toReady(g);
    expect(g.campPlan).toEqual({ place: 'japan', focus: 'balanced' });
    expect(g.setCamp({ place: 'usa', focus: 'bat' }).ok).toBe(true);
    expect(g.setCamp({ place: 'mars', focus: 'bat' } as never).ok).toBe(false);
    const saved = roundTrip(g.toSave());
    expect(g.openNextSeason().ok).toBe(true);
    const L = g.league;
    expect(L.ledger.some((e) => e.year === 2027 && e.from === 2 && e.amount === PLACE.usa.cost && e.note.includes('스프링캠프'))).toBe(true);
    expect((L.events?.forms ?? []).filter((f) => f.year === 2027 && f.note.startsWith('스프링캠프'))).toEqual([]);
    expect(L.camps!.filter((c) => c.year === 2027).length).toBe(g.world.teams.length);
    expect(L.campPlan).toBeUndefined();
    expect(g.news.some((n) => n.text.includes('스프링캠프: 미국 애리조나'))).toBe(true);
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
    expect(campInjury({ camps: [{ year: 2027, team: 1, place: 'japan', focus: 'fitness', cost: 0 }] }, 1, 2027)).toBeCloseTo(PLACE.japan.injury * FOCUS.fitness.injury);
    expect(campInjury({ camps: [{ year: 2027, team: 1, place: 'home', focus: 'balanced', cost: 0 }] }, 1, 2027)).toBeCloseTo(PLACE.home.injury);
    expect(campInjury({ camps: [] }, 1, 2027)).toBe(1);
    const fit = g.world.teams.find((t) => g.league.camps!.find((c) => c.team === t.idx && c.year === 2027)?.focus === 'fitness');
    if (fit) expect(fit.injuryRate ?? 1).toBeLessThan(1);
  }, 900_000);

  it('값표: 비싼 장소일수록 성장·부상이 낫고, 방향마다 성장과 부상을 맞바꿔 한 가지가 모든 면에서 앞서지 않는다', () => {
    // 장소: 비용이 오르면 성장 배율이 오르고 부상 배율이 내려간다 (같거나)
    for (let i = 1; i < CAMP_PLACES.length; i++) {
      const a = PLACE[CAMP_PLACES[i - 1]];
      const b = PLACE[CAMP_PLACES[i]];
      expect(b.cost).toBeGreaterThan(a.cost);
      expect(b.factor).toBeGreaterThan(a.factor);
      expect(b.injury).toBeLessThanOrEqual(a.injury);
    }
    // 방향: 성장이 가장 큰 쪽(유망주 집중)은 부상이 가장 크고, 부상이 가장 작은 쪽(체력)은 성장이 없다. 어느 방향도 다른 방향보다 성장·부상 둘 다 낫지 않다 (대상이 같을 때)
    expect(FOCUS.youth.youth).toBe(Math.max(...CAMP_FOCUSES.map((f) => FOCUS[f].youth)));
    expect(FOCUS.youth.injury).toBe(Math.max(...CAMP_FOCUSES.map((f) => FOCUS[f].injury)));
    expect(FOCUS.fitness.injury).toBe(Math.min(...CAMP_FOCUSES.map((f) => FOCUS[f].injury)));
    expect(FOCUS.fitness.youth).toBe(0);
    for (const a of CAMP_FOCUSES) for (const b of CAMP_FOCUSES) {
      if (a === b || FOCUS[a].scope !== FOCUS[b].scope) continue;
      const better = FOCUS[a].youth >= FOCUS[b].youth && FOCUS[a].injury <= FOCUS[b].injury && (FOCUS[a].youth > FOCUS[b].youth || FOCUS[a].injury < FOCUS[b].injury);
      expect(better, `${a}가 ${b}보다 모든 면에서 낫다`).toBe(false);
    }
    expect(campInjuryOf({ place: 'usa', focus: 'fitness' })).toBeLessThan(campInjuryOf({ place: 'home', focus: 'youth' }));
  });

  it('AI 캠프: 성향·젊은 선수 수에 따라 방향이 갈린다 (진짜 잠재는 보지 않는다)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'camp-ai' }, FAST);
    const L = g.league;
    const T = L.teams.length;
    const picks = new Set<string>();
    for (const style of ['winnow', 'develop', 'frugal', 'balanced'] as const) {
      L.gm = Array.from({ length: T }, () => style);
      for (let t = 0; t < T; t++) {
        const p = aiCamp(L, t, 700_000, { bat: 1, pit: 1.1 }, 2027);
        picks.add(p.focus);
        if (style === 'develop') expect(p.focus).toBe('youth');
        if (style === 'frugal') expect(p).toEqual({ place: 'taiwan', focus: 'balanced' });
      }
    }
    expect(picks.size).toBeGreaterThanOrEqual(3);
    // 자금으로 장소
    L.gm = Array.from({ length: T }, () => 'balanced');
    expect(aiCamp(L, 0, 2_000_000, { bat: 1, pit: 1 }, 2027).place).toBe('usa');
    expect(aiCamp(L, 0, 10_000, { bat: 1, pit: 1 }, 2027).place).toBe('home');
  }, 300_000);
});
