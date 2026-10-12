// 명예의 전당 기준 (2026-10-12, 실제 자료로 맞춤: league/war.ts 시즌 가치, docs/temp-values.md)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { careers, hallOfFame } from '../src/league/history';

let store: DataStore;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('명예의 전당', () => {
  it('2026 시작: 실제 커리어로 40~55명, 1980~90년대 스타가 들어가고 해외에서 뛰는 선수는 아직 아니다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'hof' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    const hof = hallOfFame(g.league, careers(g.league, store));
    expect(hof.length).toBeGreaterThanOrEqual(40);
    expect(hof.length).toBeLessThanOrEqual(55);
    const names = new Set(hof.map((h) => h.c.name));
    for (const n of ['선동열', '최동원', '이종범', '장효조', '이만수', '양준혁', '이승엽']) expect(names.has(n), n).toBe(true);
    expect(names.has('이정후')).toBe(false);
    expect(hof.find((h) => h.c.name === '양준혁')!.reasons).toContain('2,000안타');
  }, 120_000);
});
