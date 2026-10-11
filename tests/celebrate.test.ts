// 축하 연출의 계기 (game/celebrate.ts, 2026-10-12)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { achievements } from '../src/game/celebrate';
import { NO_STOPS } from '../src/game/stops';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('축하 계기', () => {
  it('정규시즌 1위·가을야구 진출·우승은 실제 결과와 맞을 때만 생긴다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'party-a' }, FAST);
    expect(achievements(g).filter((a) => a.big)).toEqual([]);
    g.advance(100000, NO_STOPS);
    const keys = () => achievements(g).map((a) => a.key);
    const first = g.season.standings()[0] === g.teamIdx;
    expect(keys().includes('2026-first')).toBe(first);
    g.advancePostseason(10_000);
    const ps = g.postseason!;
    expect(keys().includes('2026-ps')).toBe(ps.seeds.includes(g.teamIdx));
    const final = ps.series[ps.series.length - 1];
    expect(keys().includes('2026-champ')).toBe(final.winner === g.teamIdx);
    // 같은 상태면 같은 목록 (화면이 새 key만 축하한다)
    expect(keys()).toEqual(keys());
  }, 240_000);
});
