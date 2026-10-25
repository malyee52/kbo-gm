// 역사와 서사 1단계: 규칙으로 만드는 기사 (league/articles.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { ARTICLE_KEEP, addArticle, crossed, josa } from '../src/league/articles';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('기사 규칙', () => {
  it('crossed: 지난 값과 지금 값 사이에 넘은 기준값', () => {
    expect(crossed(98, 101, 100, 100)).toEqual([100]);
    expect(crossed(100, 150, 100, 100)).toEqual([]);
    expect(crossed(480, 1010, 500, 1000)).toEqual([1000]);
    expect(crossed(0, 99, 100, 100)).toEqual([]);
    expect(crossed(199, 301, 100, 100)).toEqual([200, 300]);
  });

  it('조사: 받침에 따라 (한글·숫자·영문 구단 이름)', () => {
    expect(josa('LG', '이', '가')).toBe('LG가');
    expect(josa('두산', '이', '가')).toBe('두산이');
    expect(josa('SSG', '이', '가')).toBe('SSG가');
    expect(josa('1,000안타', '을', '를')).toBe('1,000안타를');
    expect(josa('300홈런', '을', '를')).toBe('300홈런을');
    expect(josa('8연승', '을', '를')).toBe('8연승을');
    expect(josa('10연패', '을', '를')).toBe('10연패를');
    expect(josa('57홈런', '으로', '로')).toBe('57홈런으로');
  });

  it('기사는 최근 ARTICLE_KEEP건까지만 남는다', () => {
    const L = { articles: [] } as unknown as Parameters<typeof addArticle>[0];
    for (let i = 0; i < ARTICLE_KEEP + 5; i++) addArticle(L, { year: 2026, day: i, kind: 'streak', title: String(i), body: '' });
    expect(L.articles).toHaveLength(ARTICLE_KEEP);
    expect(L.articles![0].title).toBe('5');
  });
});

describe('시즌을 진행하면 기사가 나온다', () => {
  it('통산 마일스톤·연승 기사, 결산 때 우승 기사. 저장했다 불러와 이어가도 같은 기사가 같은 수로 나온다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'articles' }, FAST);
    g.advance(60);
    const mid = roundTrip(g.toSave()) as GameSaveV2;
    g.advance(100000);
    g.beginOffseason();
    const arts = g.league.articles ?? [];
    expect(arts.some((a) => a.kind === 'milestone')).toBe(true);
    expect(arts.some((a) => a.kind === 'streak')).toBe(true);
    expect(arts.filter((a) => a.kind === 'title')).toHaveLength(1);
    expect(arts.find((a) => a.kind === 'title')!.title).toContain('한국시리즈 우승');
    // 마일스톤은 한 사람·한 기준에 한 번
    const ms = arts.filter((a) => a.kind === 'milestone').map((a) => a.title);
    expect(new Set(ms).size).toBe(ms.length);
    // 실존 선수 기사는 기록 사실만: 본문에 숫자가 있다
    for (const a of arts.filter((x) => x.kind === 'milestone')) expect(a.body).toMatch(/\d/);
    expect(arts.some((a) => /\(가\)|\(를\)/.test(a.body))).toBe(false);
    // 잡다한 기사 (2026-10-12): 경기·순위·월간 MVP·인터뷰가 한 시즌에 나오고, 인터뷰 말은 이름 없는 관계자·팬·단장뿐
    // 순위 기사(선두 교체·우리 구단 가을야구권 드나듦)는 시즌 흐름에 달려 시드에 따라 한 번도 안 날 수 있어 따로 본다 (아래 따로)
    for (const k of ['game', 'monthly', 'interview', 'injury'] as const) expect(arts.some((x) => x.kind === k), k).toBe(true);
    expect(arts.some((a) => /은\(는\)|이\(가\)/.test(a.body))).toBe(false);
    for (const a of arts.filter((x) => /라고 말했다/.test(x.body))) expect(a.body).toMatch(/(구단 관계자|현장을 찾은 팬|단장)[은는] "/);

    const h = GameSession.load(store, mid, FAST);
    h.advance(100000);
    h.beginOffseason();
    expect((h.league.articles ?? []).map((a) => a.title)).toEqual(arts.map((a) => a.title));
  }, 300_000);

  it('순위 기사: 선두 교체나 우리 구단 가을야구권 드나듦이 있는 시즌이면 나온다', () => {
    // 중위권 구단으로 한 시즌. 순위 기사가 하나도 없다면 선두가 20경기 뒤로 한 번도 안 바뀌고 우리 구단도 줄곧 같은 쪽이었다는 뜻이라 드물다
    // 시드: 엔진 2 13단계 희생번트 배율 16 → 17.6 때 articles-rank → articles-rank-2 (그 판은 선두 교체·가을야구권 드나듦이 한 번도 없었다)
    const ssg = store.season(2026)!.teams.findIndex((t) => t.name === 'SSG');
    const g = GameSession.create(store, { year: 2026, teamIdx: ssg, seed: 'articles-rank-2' }, FAST);
    g.advance(100000);
    expect((g.league.articles ?? []).some((a) => a.kind === 'rank')).toBe(true);
  }, 300_000);
});
