// 선수 찾기 화면의 거르기·정렬 (src/ui/screens/Search.tsx)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { computeGrades, DEFAULT_PARAMS, isStarterSkill } from '../src/engine';
import { GameSession } from '../src/game/session';
import { EMPTY_FILTER, filterPlayers, sortRows, type SearchRow } from '../src/ui/screens/Search';

let store: DataStore;
let g: GameSession;
let rows: SearchRow[];
beforeAll(() => {
  store = loadDataStore();
  g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'search' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  const lp = new Map(g.league.players.map((p) => [p.id, p]));
  const grades = computeGrades(g.world);
  rows = g.world.players.filter((p) => p.teamIdx >= 0).map((p) => ({ p, lp: lp.get(p.id), guess: g.guessSet(p.id, grades), war: null }));
}, 120_000);

describe('선수 찾기', () => {
  it('기본은 우리 구단을 뺀 리그 전체', () => {
    const r = filterPlayers(rows, EMPTY_FILTER, 0, 2026);
    expect(r.length).toBeGreaterThan(400);
    expect(r.some((x) => x.p.teamIdx === 0)).toBe(false);
    expect(filterPlayers(rows, { ...EMPTY_FILTER, team: 'all' }, 0, 2026).length).toBe(rows.length);
  });

  it('조건을 겹치면 모두 만족하는 선수만', () => {
    const f = { ...EMPTY_FILTER, kind: 'hit' as const, pos: 'SS', ageMax: 27, guessMin: 45, foreign: 'domestic' as const };
    const r = filterPlayers(rows, f, 0, 2026);
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) {
      expect(x.p.isPitcher).toBe(false);
      expect(x.p.pos).toBe('SS');
      expect(x.p.age!).toBeLessThanOrEqual(27);
      expect(x.guess!.sort).toBeGreaterThanOrEqual(45);
      expect(x.p.foreign).toBeFalsy();
    }
    for (const x of filterPlayers(rows, { ...EMPTY_FILTER, kind: 'sp' }, 0, 2026)) expect(x.p.isPitcher && isStarterSkill(x.p.pit)).toBe(true);
    for (const x of filterPlayers(rows, { ...EMPTY_FILTER, contract: 'fa' }, 0, 2026)) expect(x.lp!.contract.until).toBeLessThanOrEqual(2026);
  });

  it('이름 일부와 구단으로 찾고, 등급·나이로 정렬', () => {
    const one = rows.find((x) => x.p.teamIdx === 3)!;
    const r = filterPlayers(rows, { ...EMPTY_FILTER, team: 3, text: one.p.name.slice(0, 2) }, 0, 2026);
    expect(r.map((x) => x.p.idx)).toContain(one.p.idx);
    expect(r.every((x) => x.p.teamIdx === 3)).toBe(true);
    const byGuess = sortRows(rows, 'guess');
    for (let i = 1; i < byGuess.length; i++) expect(byGuess[i - 1].guess?.sort ?? -1).toBeGreaterThanOrEqual(byGuess[i].guess?.sort ?? -1);
    const byAge = sortRows(rows.filter((x) => x.p.age !== null), 'age');
    expect(byAge[0].p.age!).toBeLessThanOrEqual(byAge.at(-1)!.p.age!);
  });
});
