// 2차 드래프트·창단 특별 지명 (2026-10-12, offseason.ts ProtectDraft)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import * as Off from '../src/league/offseason';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

function toSecond(year: number, seed: string): GameSession {
  const lg = store.season(year)!.teams.findIndex((t) => t.name === 'LG');
  const g = GameSession.create(store, { year, teamIdx: lg, seed }, FAST);
  g.advance(100000);
  g.beginOffseason();
  for (let guard = 0; g.offseason!.stage !== 'second' && g.offseason!.stage !== 'foreign' && guard < 20; guard++) {
    if (g.offseason!.stage === 'comp') g.autoComp();
    g.nextStage();
  }
  return g;
}

describe('2차 드래프트', () => {
  it('열리는 해: 2011~2019·2023년부터 홀수 해', () => {
    expect([2011, 2013, 2019, 2023, 2025, 2027].every(Off.isSecondDraftYear)).toBe(true);
    expect([2010, 2012, 2020, 2021, 2022, 2024, 2026].some(Off.isSecondDraftYear)).toBe(false);
  });

  it('2025: 보호 35명, 우리 명단을 고치고 지명 희망대로 데려온다. 자동 제외 대상은 지명되지 않고, 양도금이 장부에 남는다', () => {
    const g = toSecond(2025, 'sd-1');
    const off = g.offseason!;
    expect(off.stage).toBe('second');
    const d = off.second!;
    expect(d.limit).toBe(35);
    const me = g.teamIdx;
    // 보호 인원 넘기면 안 된다
    const pool = Off.protectDraftPool(g.league, off, d, me);
    expect(g.setDraftProtect('second', pool.slice(0, 36).map((p) => p.id)).ok).toBe(false);
    // 우리 보호 명단에서 한 명 빼면 그 선수는 다른 구단 후보가 된다
    const out = d.protect[String(me)][0];
    expect(g.setDraftProtect('second', d.protect[String(me)].slice(1)).ok).toBe(true);
    expect(Off.protectDraftCandidates(g.league, off, d, (me + 1) % 10).some((p) => p.id === out)).toBe(true);
    // 다른 구단 후보 가운데 하나를 지명 희망으로
    const cands = Off.protectDraftCandidates(g.league, off, d, me);
    const want = cands[0];
    expect(g.setDraftWish('second', [want.id]).ok).toBe(true);
    const ledger = g.league.ledger.length;
    g.nextStage();
    expect(off.stage).not.toBe('second');
    const picks = d.picks!;
    expect(picks.length).toBeGreaterThan(5);
    expect(g.leaguePlayer(want.id)!.team).toBe(me);
    expect(g.league.ledger.length).toBeGreaterThan(ledger);
    const fa = new Set(off.fa.entries.map((e) => e.id));
    const lost = new Map<number, number>();
    for (const k of picks) {
      const p = g.leaguePlayer(k.id!)!;
      expect(p.foreign).toBe(false);
      expect(fa.has(p.id)).toBe(false);
      expect(p.entryYear).toBeLessThan(2023);
      expect(d.protect[String(k.from)]).not.toContain(p.id);
      lost.set(k.from!, (lost.get(k.from!) ?? 0) + 1);
    }
    for (const n of lost.values()) expect(n).toBeLessThanOrEqual(Off.SECOND_MAX_LOSS);
  }, 600_000);

  it('2026 시즌 뒤에는 열리지 않는다 (짝수 해)', () => {
    const g = toSecond(2026, 'sd-2');
    expect(g.offseason!.second).toBeUndefined();
  }, 600_000);
});

describe('창단 특별 지명', () => {
  it('2012 시즌 뒤 NC 1군 진입: 우리 보호 명단 밖에서만 1명, 기존 구단마다 1명', () => {
    const g = toSecond(2012, 'sd-exp');
    const off = g.offseason!;
    expect(off.stage).toBe('second');
    const d = off.expansion!;
    expect(d.limit).toBe(20);
    const me = g.teamIdx;
    const prot = d.protect[String(me)];
    g.nextStage();
    const nc = d.team!;
    const picks = d.picks!;
    expect(picks.length).toBe(8);
    for (const k of picks) expect(g.leaguePlayer(k.id!)!.team).toBe(nc);
    const mine = picks.find((k) => k.from === me)!;
    expect(prot).not.toContain(mine.id);
    expect(g.league.players.filter((p) => p.team === nc).length).toBeGreaterThanOrEqual(Off.EXPANSION_MIN);
  }, 600_000);
});
