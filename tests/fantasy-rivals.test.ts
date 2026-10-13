// 다른 구단 단장: 주기, 우리에게 온 제안(선택지 조작·만료), 다른 구단끼리의 움직임(우리 것은 건드리지 않음), 재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { offerExpired, rivalDue, rivalMove, rivalPick, RIVAL_OFFER_DAYS } from '../src/fantasy/rivals';
import { cashOf } from '../src/league/finance';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('다른 구단 단장', () => {
  it('제안은 선택지 조작으로, 만료가 있고, 다른 구단끼리 움직임은 바로 반영된다. 저장·재현 동일', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'rival-1', fantasy: { free: true } }, FAST);
    expect(rivalDue(g)).toBe(false);
    g.advance(3);
    expect(rivalDue(g)).toBe(true);
    let offers = 0;
    let moves = 0;
    for (let k = 0; k < 12 && (offers === 0 || moves === 0); k++) {
      const pick = rivalPick(g);
      const { entry } = await rivalMove(g, store, mock);
      g.addFantasy(entry);
      const e = g.fantasy!.log.at(-1)!;
      expect(e.rival).toBe(pick.team);
      if (pick.kind === 'offer') {
        offers++;
        expect(e.choices!.length).toBe(2);
        const cash0 = cashOf(g.league, g.teamIdx);
        if (offers === 1) {
          expect(g.chooseFantasy(e.id!, 0).ok).toBe(true);
          expect(cashOf(g.league, g.teamIdx)).toBe(cash0 + 10000);
        }
      } else {
        moves++;
        expect(e.ops![0]).toMatchObject({ op: 'teamCash', team: pick.team });
      }
      g.advance(7);
    }
    expect(offers).toBeGreaterThan(0);
    expect(moves).toBeGreaterThan(0);
    // 답하지 않은 제안은 만료
    const open = g.fantasy!.log.find((e) => e.rival !== undefined && e.choices && e.chosen === undefined);
    if (open) {
      expect(offerExpired(g, open)).toBe(g.currentDay - open.day > RIVAL_OFFER_DAYS);
      if (offerExpired(g, open)) expect(g.chooseFantasy(open.id!, 0).ok).toBe(false);
    }
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 600_000);

  it('오프시즌: FA·외국인 단계마다 한 번 움직이고, 오프시즌 제안은 개막 전까지 유효', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'rival-off', fantasy: { free: true } }, FAST);
    g.advance(100000);
    g.beginOffseason();
    expect(g.offseason!.stage).toBe('fa');
    expect(rivalDue(g)).toBe(true);
    const r = await rivalMove(g, store, mock);
    g.addFantasy(r.entry);
    const e = g.fantasy!.log.at(-1)!;
    expect(e.offStage).toBe('fa');
    expect(rivalDue(g)).toBe(false);
    if (e.choices) expect(offerExpired(g, e)).toBe(false);
    for (let guard = 0; g.offseason!.stage !== 'foreign' && guard < 10; guard++) { if (g.offseason!.stage === 'comp') g.autoComp(); g.nextStage(); }
    expect(rivalDue(g)).toBe(true);
  }, 600_000);
});
