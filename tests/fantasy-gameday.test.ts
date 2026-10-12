// 경기 AI 연출: 후일담(경기 key로 한 편), 경기 전 미팅(하루 한 번, 선수단 컨디션), 재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { gameStory, gameSummary, pregameBlock, pregameTalk, storyOf } from '../src/fantasy/gameday';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('경기 AI 연출', () => {
  it('후일담과 경기 전 미팅', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'gameday-1', fantasy: {} }, FAST);
    expect(pregameBlock(g)).toBeNull();
    const talk = await pregameTalk(g, store, mock, '오늘은 즐기자');
    g.addFantasy(talk);
    expect(talk.effects![0]).toMatchObject({ type: 'teamForm', side: 'all', edge: 0.01, days: 2 });
    expect(pregameBlock(g)).toContain('이미');
    g.advance(3);
    expect(pregameBlock(g)).toBeNull();
    const game = g.ourGames().at(-1)!;
    const sum = gameSummary(g, game, ['홈런']);
    expect(sum).toContain('타자');
    expect(sum).toContain('투수');
    g.addFantasy(await gameStory(g, mock, game, []));
    expect(storyOf(g, game.key)?.who).toBe('중계석');
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 300_000);
});
