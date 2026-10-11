// 역사 시나리오: 구단별 아픈 손가락 (2026-10-11 사용자 요청).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { SCENARIOS } from '../src/league/scenarios';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('역사 시나리오', () => {
  it('목록의 시나리오는 모두 그 해 자료에 구단이 있고, 실제로 그 해 우승하지 못한 구단이다 (자료의 최종 순위)', () => {
    for (const sc of SCENARIOS) {
      const t = store.season(sc.year)!.teams.find((x) => x.name === sc.team);
      expect(t, sc.id).toBeDefined();
      // 1999년은 양대 리그라 리그별 1위가 둘이다 (롯데 드림 1위, 우승은 한화)
      if (sc.year !== 1999) expect(t!.rank, sc.id).toBeGreaterThan(1);
    }
  });

  it('시나리오로 시작하면 그 해 그 구단의 단장이 되고, 구단주 목표가 한국시리즈 우승이다', () => {
    for (const sc of SCENARIOS.slice(0, 3)) {
      const t = store.season(sc.year)!.teams.findIndex((x) => x.name === sc.team);
      const g = GameSession.create(store, { year: sc.year, teamIdx: t, seed: `sc-${sc.id}`, scenario: sc.id }, FAST);
      expect(g.year).toBe(sc.year);
      expect(g.team.name).toBe(sc.team);
      expect(g.league.scenario).toMatchObject({ id: sc.id, year: sc.year, team: t });
      expect(g.owner.goal?.kind).toBe('champion');
      expect(g.news.some((n) => n.text.startsWith(`역사 시나리오 「${sc.title}」`))).toBe(true);
      expect(g.reproInfo().opts.scenario).toBe(sc.id);
    }
  });

  it('시즌을 끝내면 우승 여부로 성공·실패를 판정하고 알린다', () => {
    const sc = SCENARIOS.find((s) => s.id === 'doosan-2018')!;
    const t = store.season(sc.year)!.teams.findIndex((x) => x.name === sc.team);
    const g = GameSession.create(store, { year: sc.year, teamIdx: t, seed: 'sc-judge', scenario: sc.id }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const champ = g.league.lastSeason!.postseason!.champion;
    expect(g.league.scenario!.result).toBe(champ === t ? 'success' : 'fail');
    expect(g.news.some((n) => n.text.includes(`「${sc.title}」 ${champ === t ? '성공' : '실패'}`))).toBe(true);
  });
});
