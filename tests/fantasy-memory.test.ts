// 회귀자 모드 (판타지 2단계): 원래 역사(실제 기록), 터질 선수, 드래프트 대어, 역사 분기
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { breakouts, divergences, draftGems, memoryContext, seasonMemory } from '../src/fantasy/history';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('원래 역사', () => {
  it('2010: SK 우승, 이대호 타격 타이틀, 류현진 평균자책', () => {
    const m = seasonMemory(store, 2010)!;
    expect(m.champion).toBe('SK');
    expect(m.leaders.find((l) => l.label === '홈런')).toMatchObject({ name: '이대호', value: '44개' });
    expect(m.leaders.find((l) => l.label === '평균자책')!.name).toBe('류현진');
    expect(m.stars[0].name).toBe('이대호');
  });
  it('2015: 정규시즌 3위 두산이 우승 (최종 순위 1위)', () => {
    expect(seasonMemory(store, 2015)!.champion).toBe('두산');
  });
  it('진행 중인 2026은 우승을 말하지 않는다', () => {
    const m = seasonMemory(store, 2026)!;
    expect(m.inProgress).toBe(true);
    expect(m.champion).toBeNull();
  });
  it('2005 시작: 앞으로 터질 선수 (이미 정상급은 빼고), 2007 드래프트 대어', () => {
    const { league } = createLeague(store, 2005, 'mem', FAST);
    const b = breakouts(store, league, 2005);
    expect(b.length).toBeGreaterThan(5);
    expect(b.some((x) => x.name === '이대호' && x.year === 2010)).toBe(true);
    const g = draftGems(store, 2007).map((x) => x.name);
    expect(g).toEqual(expect.arrayContaining(['양현종', '김광현']));
  }, 120_000);
});

describe('회귀자 게임', () => {
  it('옵션이 리그 상태·재현 정보에 남고, 시즌을 치르면 원래 역사와 비교된다', () => {
    const g = GameSession.create(store, { year: 2010, teamIdx: 0, seed: 'reg-1', fantasy: { regressor: true } }, FAST);
    expect(g.fantasy!.regressor).toBe(true);
    expect(g.reproInfo().opts.fantasy).toEqual({ regressor: true });
    const ctx0 = memoryContext(store, g.league, 2010);
    expect(ctx0).toContain('2010: 우승 SK');
    g.advance(100000);
    g.beginOffseason();
    const d = divergences(store, g.league);
    expect(d.length).toBe(1);
    expect(d[0]).toMatchObject({ year: 2010, realChampion: 'SK' });
    expect(d[0].gameChampion).not.toBeNull();
    if (!d[0].same) expect(memoryContext(store, g.league, 2011)).toContain('역사가 바뀐 시즌');
  }, 300_000);
});
