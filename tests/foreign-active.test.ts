// 리그 규칙 1-6 (docs/리그규칙변경_기획안.md D16·D17): 외국인 출전 한도와 2014~2019 구성 제한.
// 2001~2002·2014~2019는 3명 보유·2명 출전 (창단 특례 구단은 4명 보유·3명 출전), 그 밖의 해는 보유한 외국인이 모두 나올 수 있다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, teamRules, type World } from '../src/engine';
import { createLeague } from '../src/league/create';
import { FOREIGN_MIX_YEARS, foreignMixOk } from '../src/league/eras';
import { canSignForeign, type OffseasonState } from '../src/league/offseason';
import { ruleSnapshot, keyValueText } from '../src/league/ruleNews';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let store: DataStore;

beforeAll(() => {
  store = loadDataStore();
});

/** 한 시즌을 돌리며 날마다 구단별로 경기에 나온 외국인 수(타석 또는 상대 타자가 늘어난 선수)와 1군 외국인 수를 모은다 */
function foreignPerGame(world: World, seed: string): { team: number; played: number; active: number; limit: number }[] {
  const season = Season.start(world, FAST, seed);
  const foreign = world.players.filter((p) => p.foreign);
  const out: { team: number; played: number; active: number; limit: number }[] = [];
  while (!season.done) {
    const before = new Map(foreign.map((p) => [p.idx, season.bat[p.idx].pa + season.pit[p.idx].bf]));
    season.simulateDay();
    for (const ts of season.teamSeasons) {
      const mine = foreign.filter((p) => p.teamIdx === ts.team.idx);
      const played = mine.filter((p) => season.bat[p.idx].pa + season.pit[p.idx].bf > before.get(p.idx)!).length;
      if (played === 0) continue;
      const active = new Set([...ts.hitters, ...ts.rotation, ...ts.bullpen].filter((p) => p.foreign).map((p) => p.idx)).size;
      out.push({ team: ts.team.idx, played, active, limit: teamRules(world, ts.team).foreignActive });
    }
  }
  return out;
}

describe('외국인 출전 한도 (리그 규칙 1-6)', () => {
  it('연도별 값: 2001~2002·2014~2019는 보유 3·출전 2, 2000·2003·2020·2026은 보유와 같다', () => {
    const r = (y: number) => store.meta.rules[String(y)];
    for (const y of [2001, 2002, 2014, 2015, 2019]) expect([y, r(y).foreignLimit, r(y).foreignActive]).toEqual([y, 3, 2]);
    for (const y of [2000, 2003, 2013, 2020, 2025, 2026]) expect([y, r(y).foreignActive]).toEqual([y, r(y).foreignLimit]);
  });

  it('2015 시즌: 모든 경기에서 구단당 출전 외국인이 한도 이하 (kt 특례 3명, 나머지 2명), 1군에 3명이어도 한도만큼만 나온다', () => {
    const { league, world } = createLeague(store, 2015, 'fa-2015', FAST);
    const kt = league.teams.findIndex((t) => t.franchise === 'KT');
    const games = foreignPerGame(world, 'fa-2015');
    for (const g of games) {
      expect(g.limit).toBe(g.team === kt ? 3 : 2);
      expect(g.played, `${world.teams[g.team].name}`).toBeLessThanOrEqual(g.limit);
    }
    // 1군 외국인이 한도를 넘은 경기가 있어야 이 검사가 뜻이 있다
    expect(games.filter((g) => g.active > g.limit).length).toBeGreaterThan(100);
    expect(games.some((g) => g.played === g.limit)).toBe(true);
  }, 120_000);

  it('2020 시즌: 3명이 함께 나온 경기가 있다 (3명 보유·3명 출전)', () => {
    const { world } = createLeague(store, 2020, 'fa-2020', FAST);
    const games = foreignPerGame(world, 'fa-2020');
    for (const g of games) expect(g.played).toBeLessThanOrEqual(g.limit);
    expect(games.some((g) => g.played === 3)).toBe(true);
  }, 120_000);

  it('개막 규칙 요약: 2015는 "3명 보유·2명 출전", 2020은 "3명"', () => {
    expect(keyValueText('foreignLimit', ruleSnapshot(store.meta, 2015))).toBe('3명 보유·2명 출전');
    expect(keyValueText('foreignLimit', ruleSnapshot(store.meta, 2020))).toBe('3명');
  });
});

describe('외국인 구성 제한 (2014~2019, D17)', () => {
  it('보유 자리를 모두 투수 또는 모두 타자로 채울 수 없다. 특례 구단(4명)은 같은 쪽 3명까지, 다른 해는 제한 없음', () => {
    expect(FOREIGN_MIX_YEARS).toEqual([2014, 2019]);
    expect(foreignMixOk(2014, 3, 1)).toBe(true);
    expect(foreignMixOk(2014, 3, 2)).toBe(false);
    expect(foreignMixOk(2019, 3, 2)).toBe(false);
    expect(foreignMixOk(2014, 4, 2)).toBe(true);
    expect(foreignMixOk(2014, 4, 3)).toBe(false);
    expect(foreignMixOk(2013, 2, 1)).toBe(true);
    expect(foreignMixOk(2020, 3, 2)).toBe(true);
  });

  it('2014 외국인 계약: 투수 2명이 있는 구단은 세 번째 외국인 투수를 영입할 수 없다', () => {
    const { league } = createLeague(store, 2013, 'mix-2014', FAST);
    const foreign = league.players.filter((p) => p.foreign && p.team >= 0);
    const team = league.teams.findIndex((_, t) => {
      const mine = foreign.filter((p) => p.team === t);
      return mine.length === 2 && mine.every((p) => p.isPitcher);
    });
    expect(team).toBeGreaterThanOrEqual(0);
    const cand = foreign.find((p) => p.team !== team && p.isPitcher)!;
    cand.team = -1;
    cand.contract = { kind: 'foreign', salary: 300_000, until: 2014 };
    const off = { year: 2013, stage: 'foreign', userTeam: team, foreign: { order: [], pointer: 0, pool: [cand.id], keep: {}, regular: 3, asia: 0 } } as unknown as OffseasonState;
    const check = canSignForeign(league, off, team, cand);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('모두 투수로 채울 수 없습니다');
    // 2020년(다음 시즌)이면 같은 구성도 된다
    const off20 = { ...off, year: 2019 } as OffseasonState;
    expect(canSignForeign(league, off20, team, cand).message).not.toContain('채울 수 없습니다');
  });
});
