// 구단주 정기 면담: 한 해 세 번(시즌 전·중반·결산), 차례마다 한 번, 신뢰·자금 변화
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { meetingAgenda, meetingJudge, meetingSlot } from '../src/fantasy/ownerMeeting';
import { cashOf } from '../src/league/finance';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('구단주 정기 면담', () => {
  it('시즌 전·중반·결산에 한 번씩', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'owner-m', fantasy: {} }, FAST);
    expect(meetingSlot(g)).toBe('pre');
    const a = await meetingAgenda(g, store, mock, 'pre');
    const trust0 = g.owner.trust;
    const cash0 = cashOf(g.league, 0);
    g.addFantasy(await meetingJudge(g, store, mock, 'pre', a.speaker, a.agenda, '우승에 도전하겠습니다. 예산 증액을 부탁드립니다.'));
    expect(g.owner.trust).toBe(trust0 + 2);
    expect(cashOf(g.league, 0)).toBe(cash0 + 50000);
    expect(meetingSlot(g)).toBeNull();
    g.advance(Math.floor(g.season.schedule.length / 2) - 5);
    expect(meetingSlot(g)).toBe('mid');
    g.advance(100000);
    g.beginOffseason();
    expect(meetingSlot(g)).toBe('end');
  }, 600_000);
});
