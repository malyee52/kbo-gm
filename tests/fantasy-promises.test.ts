// 약속·조건 장부: 기한 풀기, 장부에 쌓이고, 기한이 되면 판정, 저장·재현이 같다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { freeContext, resolvePromises, resolveSettles, settlePromises } from '../src/fantasy/free';
import { duePromises, parseDue, type Now } from '../src/fantasy/promises';
import { dateOf } from '../src/game/calendar';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('약속 장부', () => {
  it('기한 풀기', () => {
    const now: Now = { phase: 'season', year: 2026, day: 10, seasonDays: 144 };
    expect(parseDue('30일 뒤', now)).toEqual({ dueYear: 2026, dueDay: 40 });
    expect(parseDue('시즌 끝', now)).toEqual({ dueYear: 2026, dueDay: 143 });
    expect(parseDue('오프시즌', now)).toEqual({ dueYear: 2026, dueDay: -1 });
    expect(parseDue('다음 시즌', now)).toEqual({ dueYear: 2027, dueDay: 0 });
    const d = parseDue('2026-08-15', { ...now, seasonDays: 170 });
    expect(parseDue('2026-10-30', now).dueDay).toBe(-1); // 시즌 일정 밖이면 그 해 오프시즌
    const dt = dateOf(2026, d.dueDay);
    expect(dt.month * 100 + dt.date).toBeGreaterThanOrEqual(815);
    expect(parseDue('', { phase: 'offseason', year: 2026, day: 0, seasonDays: 144 })).toEqual({ dueYear: 2027, dueDay: -1 });
  });

  it('약속이 쌓이고, 기한이 되면 판정되고, 저장·재현이 같다', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'promise-1', fantasy: { free: true } }, FAST);
    g.advance(5);
    const promises = resolvePromises(g, [{ party: '롯데 단장', text: '우리가 20일 안에 현금 5억을 더 준다', due: '20일 뒤' }, { party: '구단주', text: '가을야구에 가면 예산 증액', due: '오프시즌' }, { text: '' }]);
    expect(promises.length).toBe(2);
    g.addFantasy({ kind: 'action', title: '거래', text: 'x', promises });
    expect(g.fantasy!.promises!.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(freeContext(g, store)).toContain('[약속 장부]');
    expect(duePromises(g.fantasy, g.promiseNow).length).toBe(0);
    // 없는 id·진행 중이 아닌 약속은 판정하지 않는다
    expect(resolveSettles(g, [{ id: 'p9', status: 'kept' }, { id: 'p1', status: 'maybe' }]).length).toBe(0);
    g.advance(25);
    expect(duePromises(g.fantasy, g.promiseNow).map((p) => p.id)).toEqual(['p1']);
    const r = await settlePromises(g, store, mock);
    g.addFantasy(r!.entry);
    expect(g.fantasy!.promises!.find((p) => p.id === 'p1')!.status).toBe('kept');
    expect(g.fantasy!.promises!.find((p) => p.id === 'p2')!.status).toBe('open');
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(roundTrip(h.toSave().league)).toEqual(roundTrip(g.toSave().league));
    const info = g.reproInfo();
    const rep = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(rep.toSave().league)).toEqual(roundTrip(g.toSave().league));
    // 오프시즌 기한: 시즌이 끝나면 판정 대상
    g.advance(100000);
    g.beginOffseason();
    expect(duePromises(g.fantasy, g.promiseNow).map((p) => p.id)).toEqual(['p2']);
    const r2 = await settlePromises(g, store, mock);
    g.addFantasy(r2!.entry);
    expect(duePromises(g.fantasy, g.promiseNow).length).toBe(0);
  }, 600_000);
});
