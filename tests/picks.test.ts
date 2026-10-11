// 지명권 트레이드 (league/picks.ts, docs/roadmap.md 4장).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type SimPlayer } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { applyPickOwners, expectedPotential, ownedPicks, pickId, pickOwner, transferPick, type DraftPick } from '../src/league/picks';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('지명권 기록', () => {
  it('넘어간 지명권만 남고, 드래프트 슬롯은 주인이 쓴다', () => {
    const L = { pickOwners: [] } as unknown as LeagueState;
    const p: DraftPick = { draft: 2027, round: 1, from: 3 };
    expect(pickOwner(L, p)).toBe(3);
    transferPick(L, p, 5);
    expect(pickOwner(L, p)).toBe(5);
    expect(ownedPicks(L, 5, 2026, [3, 5]).map(pickId)).toContain('2027:1:3');
    expect(ownedPicks(L, 3, 2026, [3, 5]).map(pickId)).not.toContain('2027:1:3');
    transferPick(L, p, 3); // 되돌아오면 기록이 사라진다
    expect(L.pickOwners).toEqual([]);
    transferPick(L, p, 5);
    // 우선(0)·특별(-1) 지명은 그대로, 라운드 지명만 주인으로
    const r = applyPickOwners(L, 2027, [3, 3, 5, 3], [0, 1, 1, 2]);
    expect(r.slots).toEqual([3, 5, 5, 3]);
    expect(r.orig).toEqual([3, 3, 5, 3]);
  });

  it('기대 잠재력은 앞 순번일수록 크고 40번째 근처에서 0에 가깝다', () => {
    const v = [1, 10, 20, 40, 60].map((k) => expectedPotential(k, 8.5));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);
    expect(v[3]).toBeLessThan(3);
  });
});

describe('트레이드에 지명권 넣기', () => {
  it('규정: 2020년 전에는 안 되고, 선수 없이는 안 되며, 2장까지, 가진 지명권만', () => {
    const old = GameSession.create(store, { year: 2019, teamIdx: 0, seed: 'pk-old' }, FAST);
    const oa = old.world.teams[1].org.find((p) => !p.foreign)!;
    expect(old.evaluateTrade(1, [], [oa], 0, { give: [{ draft: 2020, round: 1, from: 0 }], get: [] }).message).toContain('2020년부터');

    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'pk-rules' }, FAST);
    const a = g.world.teams[1].org.find((p) => !p.foreign)!;
    const mine = g.ownedPicks(0);
    expect(mine).toHaveLength(2 * 5); // 다음 두 드래프트 × 5라운드
    expect(g.evaluateTrade(1, [], [], 0, { give: [mine[0]], get: [] }).message).toContain('선수와 함께');
    expect(g.evaluateTrade(1, [], [a], 0, { give: mine.slice(0, 3), get: [] }).message).toContain('2장까지');
    expect(g.evaluateTrade(1, [], [a], 0, { give: [{ draft: 2027, round: 1, from: 1 }], get: [] }).message).toContain('가진 지명권만');
    expect(g.evaluateTrade(1, [], [a], 0, { give: [{ draft: 2029, round: 1, from: 0 }], get: [] }).verdict).toBe('reject-invalid');
  });

  it('지명권을 얹으면 거절하던 제안을 받고, 드래프트에서 상대가 그 순번을 쓰며, 뽑힌 선수는 입단 첫해 트레이드 금지', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'pk-deal' }, FAST);
    g.advance(40);
    const first: DraftPick = { draft: 2027, round: 1, from: lg };
    const second: DraftPick = { draft: 2027, round: 2, from: lg };
    const junk = [...g.team.org].filter((p) => !p.foreign).sort((a, b) => a.value - b.value)[0];
    let deal: { team: number; want: SimPlayer } | null = null;
    for (const t of g.world.teams) {
      if (t.idx === lg) continue;
      for (const w of [...t.org].filter((p) => !p.foreign).sort((a, b) => a.value - b.value)) {
        const without = g.evaluateTrade(t.idx, [junk], [w]);
        const withPick = g.evaluateTrade(t.idx, [junk], [w], 0, { give: [first, second], get: [] });
        if (without.verdict === 'reject-value' && withPick.verdict === 'accept') { deal = { team: t.idx, want: w }; break; }
      }
      if (deal) break;
    }
    expect(deal).not.toBeNull();
    const mid = roundTrip(g.toSave()) as GameSaveV2;
    expect(g.proposeTrade(deal!.team, [junk], [deal!.want], 0, { give: [first, second], get: [] }).verdict).toBe('accept');
    expect(pickOwner(g.league, first)).toBe(deal!.team);
    expect(g.ownedPicks(lg).map(pickId)).not.toContain(pickId(first));
    expect(g.trades.at(-1)!.pg).toEqual([pickId(first), pickId(second)]);

    // 저장·불러오기와 재현이 같다
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(h.league.pickOwners).toEqual(g.league.pickOwners);
    const r = GameSession.replay(store, { year: 2026, teamIdx: lg, seed: 'pk-deal' }, g.actions, undefined, FAST);
    expect(r.league.pickOwners).toEqual(g.league.pickOwners);
    expect(GameSession.load(store, mid, FAST).league.pickOwners ?? []).toEqual([]);

    // 드래프트: 우리 1라운드 순번을 상대가 쓴다
    g.advance(100000);
    g.beginOffseason();
    let guard = 0;
    while (g.offseason!.stage !== 'draft' && guard++ < 20) {
      const st = g.offseason!.stage;
      if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    const d = g.offseason!.draft!;
    const at = d.orig!.findIndex((o, i) => o === lg && d.kinds![i] === 1);
    expect(d.slots![at]).toBe(deal!.team);
    g.autoDraft();
    const drafted = g.league.players.find((p) => p.id === d.picks[at].id)!;
    expect(drafted.team).toBe(deal!.team);
    expect(drafted.noTradeYear).toBe(2027);

    // 2027 시즌: 그 선수는 트레이드할 수 없다
    guard = 0;
    while (g.offseason!.stage !== 'ready' && guard++ < 40) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.openNextSeason().ok).toBe(true);
    const sim = g.world.players.find((p) => p.id === drafted.id);
    if (sim) expect(g.evaluateTrade(sim.teamIdx, [], [sim]).message).toContain('입단 첫해');
  }, 300_000);
});
