// 감독·코치 교체 (2026-10-14 사용자 "실제로 감독을 교체하고 코치를 데려올 방법이 없어"):
// 시즌 중 감독 교체·감독 대행, 시즌 중 코치 고용, 오프시즌 한 번에 교체, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { candidates, INTERIM_NAME, managerOf } from '../src/league/managers';
import { coachOf } from '../src/league/coaches';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('감독·코치 교체', () => {
  it('시즌 중: 감독을 후보로 바로 바꾸고, 코치를 데려오며, 저장·재현이 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 5, seed: 'staff-1' }, FAST);
    g.advance(20);
    const before = managerOf(g.league, 5)!;
    const name = candidates(g.league, store, 2026)[0];
    const ledger0 = g.league.ledger.length;
    const r = g.changeManager(name);
    expect(r.ok).toBe(true);
    expect(managerOf(g.league, 5)!.name).toBe(name);
    expect(managerOf(g.league, 5)!.since).toBe(2026);
    expect(g.league.ledger.slice(ledger0).some((e) => e.note.includes(`${before.name} 감독 시즌 중 경질 위약금`))).toBe(true);
    expect(g.changeManager('없는 사람').ok).toBe(false);
    // 코치: 시즌 중 시장에서 데려오면 그 역할 코치가 바뀐다
    const market = g.coachCandidates();
    expect(market.length).toBeGreaterThan(0);
    const c = market.find((x) => x.role === 'bat')!;
    expect(g.hireCoachInSeason(c.id).ok).toBe(true);
    expect(coachOf(g.league, 5, 'bat')!.id).toBe(c.id);
    expect(g.coachCandidates().some((x) => x.id === c.id)).toBe(false);
    g.advance(10);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    h.advance(5); g.advance(5);
    expect(roundTrip(h.toSave())).toEqual(roundTrip(g.toSave()));
    const info = g.reproInfo();
    const rp = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(rp.toSave().league)).toEqual(roundTrip(g.toSave().league));
  }, 300_000);

  it('감독 대행은 시즌 끝까지, 오프시즌에 정식 감독을 고르고, 오프시즌에는 해임 없이 한 번에 교체', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 6, seed: 'staff-2' }, FAST);
    g.advance(30);
    expect(g.changeManager(null).ok).toBe(true);
    expect(managerOf(g.league, 6)).toMatchObject({ name: INTERIM_NAME, interim: true });
    expect(g.changeManager(null).ok).toBe(false);
    g.advance(100000);
    g.beginOffseason();
    // 대행은 빈자리로 본다: 바로 선임할 수 있다
    const name = candidates(g.league, store, 2027)[0];
    expect(g.hireManager(name).ok).toBe(true);
    expect(managerOf(g.league, 6)!.name).toBe(name);
    // 정식 감독이 있어도 교체 한 번이면 된다 (위약금)
    const other = candidates(g.league, store, 2027)[0];
    const r = g.replaceManager(other);
    expect(r.ok).toBe(true);
    expect(managerOf(g.league, 6)!.name).toBe(other);
    expect(g.changeManager(name).ok).toBe(false); // 오프시즌에는 시즌 중 교체를 쓰지 않는다
  }, 300_000);
});
