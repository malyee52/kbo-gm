// 기자회견: 질문 → 답 → 기사와 효과, 7일 한 번, 오프시즌 한 번
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { pressBlock, pressJudge, pressQuestions } from '../src/fantasy/press';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('기자회견', () => {
  it('질문·답·효과, 시즌 중 7일 한 번', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'press', fantasy: {} }, FAST);
    expect(pressBlock(g)).toBeNull();
    const q = await pressQuestions(g, store, mock);
    expect(q.questions.length).toBeGreaterThan(0);
    const fans0 = g.league.fans![0].level;
    const e = await pressJudge(g, store, mock, q.reporter, q.questions, '끝까지 간다');
    g.addFantasy(e);
    expect(e.effects!.map((x) => x.type)).toEqual(['fans', 'trust', 'teamForm']);
    expect(pressBlock(g)).toContain('일 뒤');
    g.advance(7);
    expect(pressBlock(g)).toBeNull();
    expect(fans0).toBeDefined();
  }, 120_000);
});
