// 구단 연대기: 오프시즌에 그 해 한 장, 이야기 기록과 따로 남고 판정 맥락에 들어간다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { chronicleDue, chronicleSummary, writeChronicle } from '../src/fantasy/chronicle';
import { freeContext } from '../src/fantasy/free';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('구단 연대기', () => {
  it('시즌 끝 오프시즌에 한 장, 두 번 쓰지 않고, 판정 맥락에 들어간다', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'chron', fantasy: { free: true } }, FAST);
    expect(chronicleDue(g)).toBeNull();
    g.advance(100000);
    g.beginOffseason();
    expect(chronicleDue(g)).toBe(2026);
    const sum = chronicleSummary(g, 2026);
    expect(sum).toContain('정규시즌');
    expect(sum).toContain(g.league.teams[0].name);
    g.addFantasy(await writeChronicle(g, mock, 2026));
    expect(g.fantasy!.chronicles).toHaveLength(1);
    expect(chronicleDue(g)).toBeNull();
    expect(freeContext(g, store)).toContain('[구단 연대기');
  }, 600_000);
});
