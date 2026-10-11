// 1군 말소 뒤 10일 재등록 제한 (KBO 규정, game/session.ts REREGISTER_DAYS).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, REREGISTER_DAYS, type GameSaveV2 } from '../src/game/session';
import { ensureEvents } from '../src/league/events';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('말소 뒤 10일', () => {
  it('직접 관리 1군에서 내린 선수는 10일 동안 다시 올릴 수 없고, 저장·불러오기 뒤에도 같다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'rereg' }, FAST);
    ensureEvents(g.league).chance = 0;
    g.advance(5);
    expect(g.setEntry(g.registered().map((p) => p.idx)).errors).toEqual([]); // 직접 관리로
    const p = g.registered().find((x) => !x.isPitcher && !g.isAbsent(x))!;
    expect(g.move(p, false).errors).toEqual([]);
    const down = g.day;
    expect(g.reregisterDay(p)).toBe(down + REREGISTER_DAYS);
    const again = g.move(p, true);
    expect(again.errors.join()).toContain('10일');

    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    const hp = h.world.players[p.idx];
    expect(h.reregisterDay(hp)).toBe(down + REREGISTER_DAYS);

    while (g.day < down + REREGISTER_DAYS) { ensureEvents(g.league).chance = 0; g.advance(1); }
    expect(g.reregisterDay(p)).toBeNull();
    expect(g.move(p, true).errors).toEqual([]);
  });

  it('AI에게 맡겼다가 다시 직접 관리로 바꿔도, 1군 밖에 있는 말소 선수는 10일 동안 못 올린다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'rereg-ai' }, FAST);
    const p = g.registered().find((x) => !x.isPitcher)!;
    expect(g.move(p, false).errors).toEqual([]); // 직접 관리 중 말소
    expect(g.setEntry(null).errors).toEqual([]); // AI에게 맡기는 것은 막지 않는다
    // AI 명단 그대로 직접 관리로 바꾸는 것은 된다
    expect(g.setEntry(g.registered().map((x) => x.idx)).errors).toEqual([]);
    if (!g.registered().some((x) => x.idx === p.idx)) expect(g.move(p, true).errors.join()).toContain('10일');
  });
});
