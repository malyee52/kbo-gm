// 연장 규정: 2008 정규시즌은 무제한 연장(끝장승부)이라 무승부가 없다 (meta.json rules.maxInnings 0, 사용자 확인 2026-10-22)
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear, type EngineParams } from '../src/engine';
import { finishPostseason, RULES, startPostseason, type SeriesGame } from '../src/league/postseason';

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

  // 포스트시즌 시간 제한 (2026-10-24 사용자 결정): 원문으로 확인된 2004만. 끝 확률 1로 키워, 2004는 10회 끝 동점에서 무승부로 끝나고
  // 무승부는 승수에 들지 않은 채 시리즈가 더 치러진다. 같은 값을 2005에 줘도 2005 포스트시즌은 시간 제한 없이 10회를 넘긴다
  it('포스트시즌 시간 제한 흉내는 timeLimitPostseason의 해(2004)만: 무승부가 나도 시리즈가 끝까지 간다', () => {
    expect(DEFAULT_PARAMS.timeLimitPostseason).toEqual([2004]);
    expect(DEFAULT_PARAMS.timeLimit?.[2004]).toBeDefined();
    const params: EngineParams = { ...FAST, timeLimit: { 2004: { from: 10, end: 1 }, 2005: { from: 10, end: 1 } } };
    const store = loadDataStore();
    const games = (year: number): SeriesGame[] => {
      const s = Season.start(worldForYear(store, year, params), params, `ps-time-${year}`);
      s.runToEnd();
      const out: SeriesGame[] = [];
      for (let i = 0; i < 20; i++) {
        const st = startPostseason(s, s.standings(), 4, `ps-time-${year}-${i}`);
        finishPostseason(st, s);
        for (const x of st.series) {
          // 무승부는 승수에 들지 않고, 시리즈는 이긴 팀이 정해진 채 끝난다
          const ties = x.games.filter((g) => g.homeRuns === g.awayRuns).length;
          expect(x.winsHigh - RULES[x.round].highHeadStart + x.winsLow + ties).toBe(x.games.length);
          expect([x.high, x.low]).toContain(x.winner);
          out.push(...x.games);
        }
      }
      return out;
    };
    const g2004 = games(2004);
    expect(g2004.every((g) => g.innings <= 10)).toBe(true);
    expect(g2004.some((g) => g.innings === 10 && g.homeRuns === g.awayRuns)).toBe(true);
    const g2005 = games(2005);
    expect(g2005.some((g) => g.innings > 10)).toBe(true);
    expect(g2005.filter((g) => g.homeRuns === g.awayRuns).every((g) => g.innings === 15)).toBe(true);
  }, 120_000);
});
