// 코치 (league/coaches.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { COACH_EDGE, COACH_ROLES, coachEdge, coachGrowth, coachOf, type Coach } from '../src/league/coaches';
import { cashOf } from '../src/league/finance';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

const coach = (role: Coach['role'], level: number, style: Coach['style'] = 'balanced'): Coach =>
  ({ id: `t-${role}`, role, level, style, salary: 10_000, until: 2030, career: '' });

describe('코치 효과', () => {
  it('3등급이 기준(0): 경기력은 (등급 − 3) × COACH_EDGE, 빈자리는 0등급', () => {
    const L = { coaches: [[coach('bat', 5), coach('pit', 3), coach('def', 1)]] } as unknown as LeagueState;
    const e = coachEdge(L, 0);
    expect(e.bat).toBeCloseTo(2 * COACH_EDGE, 10);
    expect(e.pit).toBeCloseTo((0 + -2 * 0.5) * COACH_EDGE, 10);
    expect(coachEdge({ coaches: [[]] } as unknown as LeagueState, 0).bat).toBeCloseTo(-3 * COACH_EDGE, 10);
  });

  it('성장: 좋은 코치는 늘리고 나쁜 코치는 줄인다, 베테랑형 4등급 이상은 31세 이상 하락을 줄인다', () => {
    const good = { coaches: [[coach('bat', 5, 'young'), coach('dev', 5)]] } as unknown as LeagueState;
    const avg = { coaches: [[coach('bat', 3), coach('dev', 3)]] } as unknown as LeagueState;
    const bad = { coaches: [[coach('bat', 1), coach('dev', 1)]] } as unknown as LeagueState;
    expect(coachGrowth(avg, 0, false, 22, 10, 14, false)).toBeCloseTo(14, 10);
    expect(coachGrowth(good, 0, false, 22, 10, 14, true)).toBeGreaterThan(14);
    expect(coachGrowth(bad, 0, false, 22, 10, 14, true)).toBeLessThan(14);
    const vet = { coaches: [[coach('bat', 5, 'veteran')]] } as unknown as LeagueState;
    expect(coachGrowth(vet, 0, false, 33, 20, 16, false)).toBeGreaterThan(16);
    expect(coachGrowth(avg, 0, false, 33, 20, 16, false)).toBe(16);
  });
});

describe('게임에서', () => {
  it('새 게임: 모든 구단에 코치 4명, 코치 연봉이 재정에 나간다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'coach-a' }, FAST);
    for (let t = 0; t < g.league.teams.length; t++) for (const r of COACH_ROLES) expect(coachOf(g.league, t, r), `${t} ${r}`).toBeDefined();
    g.advance(70);
    expect(g.seasonFinance()!.items.coach ?? 0).toBeLessThan(0);
  });

  it('오프시즌: 후보를 고용하면 바뀌고(남은 계약이 있으면 위약금), 개막 때 모든 구단 빈자리가 채워진다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'coach-b' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const market = g.offseason!.coachMarket!;
    expect(market.length).toBe(20);
    const best = [...market].filter((c) => c.role === 'bat').sort((a, b) => b.level - a.level)[0];
    const before = cashOf(g.league, lg);
    const had = coachOf(g.league, lg, 'bat');
    expect(g.hireCoach(best.id).ok).toBe(true);
    expect(coachOf(g.league, lg, 'bat')!.id).toBe(best.id);
    if (had && had.until > 2026) expect(cashOf(g.league, lg)).toBeLessThan(before);
    expect(g.hireCoach(best.id).ok).toBe(false); // 이미 고용했다
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(coachOf(h.league, lg, 'bat')!.id).toBe(best.id);
    for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.openNextSeason().ok).toBe(true);
    for (let t = 0; t < g.league.teams.length; t++) {
      for (const r of COACH_ROLES) expect(coachOf(g.league, t, r), `${t} ${r}`).toBeDefined();
      expect(g.league.coaches![t].every((c) => c.until >= 2027)).toBe(true);
    }
  }, 300_000);
});
