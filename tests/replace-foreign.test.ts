// 대체 외국인 영입이 안 되는 버그 재현 (2026-10-29 사용자 "대체외국인 왜 영입이 안됨", league/market.ts signBlock)
//
// 개막 외국인 명단 자료(외국인_개막명단.csv)가 2026년에만 있어, 다른 해에 시작하면 그 해 기록에 있는 외국인
// (시즌 중에 교체돼 들어온 선수 포함)이 모두 개막 명단에 들어온다. 2010 LG는 외국인 3명(한도 2명)으로 시작해서
// 한 명을 방출해도 한도가 차 있어 새 외국인을 데려올 수 없다. 첫 오프시즌에는 offseason.ts가 한도 안으로 줄인다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { foreignHeld } from '../src/league/market';
import { foreignRule, teamForeignRule } from '../src/league/eras';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

const teamOf = (year: number, name: string) => store.season(year)!.teams.findIndex((t) => t.name === name);
const overLimit = (g: GameSession) => {
  const lp = new Map(g.league.players.map((p) => [p.id, p]));
  return g.world.teams.filter((_, i) => {
    const h = foreignHeld(g.world, i, lp);
    const r = teamForeignRule(foreignRule(store.meta, g.world.year, g.league), g.league, i, g.world.year);
    return h.regular > r.regular || h.asia > r.asia;
  }).map((t) => t.name);
};

describe('대체 외국인 영입', () => {
  it('2010 LG 시작(외국인 3명, 한도 2명): 한 명 방출 뒤에도 막히면 지금 수·한도·더 방출할 수를 알려 준다', () => {
    const g = GameSession.create(store, { year: 2010, teamIdx: teamOf(2010, 'LG'), seed: 'rf-2010' }, FAST);
    g.advance(40);
    const out = g.team.org.find((p) => p.foreign)!;
    expect(g.releaseInSeason(out).ok).toBe(true);
    const cand = g.marketPlayers().find((p) => p.foreign)!;
    expect(cand).toBeTruthy();
    // 예전 문구 "보유 한도(2명)가 차 있습니다. 먼저 외국인 선수를 방출하세요"는 방출한 뒤에도 똑같아 왜 안 되는지 알 수 없었다
    expect(g.signBlock(cand)).toBe('외국인 보유 한도가 차 있습니다 (지금 2명 / 한도 2명). 외국인 선수를 1명 더 방출해야 자리가 납니다.');
  }, 300_000);

  it('2026 시작: 외국인을 방출하면 바로 시장 후보를 영입할 수 있다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: teamOf(2026, 'LG'), seed: 'rf-2026' }, FAST);
    g.advance(40);
    expect(overLimit(g)).toEqual([]);
    const lp = (id: string) => g.leaguePlayer(id)!;
    const cands = () => g.marketPlayers().filter((p) => p.foreign && !lp(p.id).asia);
    expect(cands().some((p) => g.signBlock(p) === null)).toBe(false); // 보유 한도가 차 있다
    expect(cands().map((p) => g.signBlock(p)).find((w) => w!.includes('보유 한도')))
      .toBe('외국인 보유 한도가 차 있습니다 (지금 3명 / 한도 3명). 외국인 선수를 1명 더 방출해야 자리가 납니다.');
    expect(g.releaseInSeason(g.team.org.find((p) => p.foreign && !lp(p.id).asia)!).ok).toBe(true);
    const pick = cands().find((p) => g.signBlock(p) === null)!;
    expect(pick).toBeTruthy();
    expect(g.signInSeason(pick).ok).toBe(true);
    expect(pick.teamIdx).toBe(g.teamIdx);
  }, 300_000);

  // 사용자 결정 대기 (보고_대체외국인.md 물음 1): 개막 명단 자료가 없는 해의 시작 외국인을 한도 안으로 줄일지.
  // 고치면 it.fails를 it으로 바꾼다
  it.fails('개막 명단 자료가 없는 해(2010·2019·2025)에 시작해도 모든 구단이 외국인 보유 한도 안에서 시작한다', () => {
    for (const year of [2010, 2019, 2025]) {
      const g = GameSession.create(store, { year, teamIdx: 0, seed: 'rf-limit' }, FAST);
      expect(overLimit(g), String(year)).toEqual([]);
    }
  }, 300_000);
});
