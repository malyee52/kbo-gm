// AI 단장 성향과 AI 구단끼리 트레이드 (league/gm.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { tendencyOf } from '../src/ai/trade';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { GM_STYLES } from '../src/league/gm';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

describe('단장 성향', () => {
  it('새 게임: 모든 구단에 성향이 시드로 정해진다', () => {
    const a = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'gm-a' }, FAST);
    const b = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'gm-a' }, FAST);
    expect(a.league.gm).toHaveLength(a.league.teams.length);
    expect(a.league.gm!.every((s) => GM_STYLES.includes(s))).toBe(true);
    expect(b.league.gm).toEqual(a.league.gm);
  });

  it('윈나우형은 진출권 3계단 밖까지 우승 도전, 육성형은 2위 밖이면 리빌딩', () => {
    const base = { teamIdx: 0, nTeams: 10, cut: 5, coreAge: 27, remaining: 0.5 };
    expect(tendencyOf({ ...base, rank: 8 })).toBe('rebuild');
    expect(tendencyOf({ ...base, rank: 8, style: 'winnow' })).toBe('contend');
    expect(tendencyOf({ ...base, rank: 3 })).toBe('contend');
    expect(tendencyOf({ ...base, rank: 3, style: 'develop' })).toBe('rebuild');
  });
});

describe('AI 구단끼리 트레이드', () => {
  it('시즌 중 AI 구단끼리 트레이드가 성사되고(28~33세 ↔ 25세 이하), 저장·불러오기와 재현이 같다', () => {
    const o = { year: 2026, teamIdx: lg, seed: 'ait-1' };
    const g = GameSession.create(store, o, FAST);
    g.advance(60);
    const mid = roundTrip(g.toSave()) as GameSaveV2;
    g.advance(100000);
    const tr = g.league.aiTrades ?? [];
    expect(tr.length).toBeGreaterThan(0);
    for (const t of tr) {
      expect(t.buyer).not.toBe(lg);
      expect(t.seller).not.toBe(lg);
      const x = g.world.players.find((p) => p.id === t.got[0])!;
      const y = g.world.players.find((p) => p.id === t.gave[0])!;
      expect(x.age!).toBeGreaterThanOrEqual(28);
      expect(x.age!).toBeLessThanOrEqual(33);
      expect(y.age!).toBeLessThanOrEqual(25);
      expect(t.day).toBeLessThanOrEqual(g.tradeDeadlineDay);
    }
    const h = GameSession.load(store, mid, FAST);
    h.advance(100000);
    expect(h.league.aiTrades).toEqual(tr);
    expect(h.season.standings()).toEqual(g.season.standings());
    const r = GameSession.replay(store, o, g.actions, g.day, FAST);
    expect(r.league.aiTrades).toEqual(tr);
    expect(g.league.articles!.some((a) => a.kind === 'trade')).toBe(true);
  }, 300_000);
});
