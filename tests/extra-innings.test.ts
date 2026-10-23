// 연장 규정: 2008 정규시즌은 무제한 연장(끝장승부)이라 무승부가 없다 (meta.json rules.maxInnings 0, 사용자 확인 2026-10-22)
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };

describe('연장 규정', () => {
  it('2008은 무제한 연장: 무승부 0, 12회를 넘긴 경기가 있다', () => {
    const store = loadDataStore();
    const world = worldForYear(store, 2008, FAST);
    expect(world.rules.maxInnings).toBe(0);
    const s = Season.start(world, FAST, 'extra-2008');
    s.runToEnd();
    expect(s.totals.ties).toBe(0);
    expect(s.log.some((g) => g.innings > 12)).toBe(true);
  }, 120_000);

  it('2025는 11회까지: 무승부가 나오고 11회를 넘긴 경기가 없다', () => {
    const world = worldForYear(loadDataStore(), 2025, FAST);
    const s = Season.start(world, FAST, 'extra-2025');
    s.runToEnd();
    expect(s.totals.ties).toBeGreaterThan(0);
    expect(s.log.every((g) => g.innings <= 11)).toBe(true);
  }, 120_000);

  it('시간 제한 흉내: 끝 확률 1이면 from회 끝 동점에서 무승부로 끝난다 (1995, from 12)', () => {
    const params = { ...FAST, timeLimit: { 1995: { from: 12, end: 1 } } };
    const world = worldForYear(loadDataStore(), 1995, params);
    expect(world.rules.maxInnings).toBe(15);
    const s = Season.start(world, params, 'time-1995');
    s.runToEnd();
    expect(s.log.every((g) => g.innings <= 12)).toBe(true);
    expect(s.log.some((g) => g.innings === 12 && g.homeRuns === g.awayRuns)).toBe(true);
  }, 120_000);
});
