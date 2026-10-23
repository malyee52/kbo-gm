// 저장 → 불러오기를 끼운 진행이 끊김 없이 돌린 진행과 같은지 (결산·가을야구·오프시즌 경계).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const reload = (g: GameSession) => GameSession.load(store, roundTrip(g.toSave()), FAST);

beforeAll(() => {
  store = loadDataStore();
});

/** 두 세션의 저장 전체를 칸별로 비교한다 (어느 칸이 다른지 바로 보이게) */
function expectSame(b: GameSession, a: GameSession): void {
  const sa = roundTrip(a.toSave()) as unknown as Record<string, unknown>;
  const sb = roundTrip(b.toSave()) as unknown as Record<string, unknown>;
  const la = sa.league as Record<string, unknown>;
  const lb = sb.league as Record<string, unknown>;
  for (const k of new Set([...Object.keys(la), ...Object.keys(lb)])) expect(lb[k], `league.${k}`).toEqual(la[k]);
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) if (k !== 'league') expect(sb[k], k).toEqual(sa[k]);
}

describe('저장을 끼운 결산은 끊김 없이 한 결산과 같다', () => {
  it('정규시즌 끝에서 저장 → 불러온 뒤 결산 (2026, 시드 vote, 3번 구단)', () => {
    const opts = { year: 2026, teamIdx: 3, seed: 'vote' };
    const a = GameSession.create(store, opts, FAST);
    const b = GameSession.create(store, opts, FAST);
    a.advance(1000);
    b.advance(1000);
    expect(a.done).toBe(true);
    const c = reload(b);
    a.beginOffseason();
    c.beginOffseason();
    expectSame(c, a);
  });

  it('시즌 중 아무 날 저장 → 불러와 시즌 끝까지 → 결산', () => {
    const opts = { year: 2026, teamIdx: 1, seed: 'mid-save' };
    const a = GameSession.create(store, opts, FAST);
    let b = GameSession.create(store, opts, FAST);
    a.advance(57);
    b.advance(57);
    b = reload(b);
    a.advance(1000);
    b.advance(1000);
    a.beginOffseason();
    b.beginOffseason();
    expectSame(b, a);
  });

  it('가을야구 중 저장 → 불러와 결산', () => {
    const opts = { year: 2026, teamIdx: 5, seed: 'ps-save' };
    const a = GameSession.create(store, opts, FAST);
    let b = GameSession.create(store, opts, FAST);
    for (const g of [a, b]) {
      g.advance(1000);
      g.advancePostseason(4);
    }
    expect(b.postseasonRunning).toBe(true);
    b = reload(b);
    a.beginOffseason();
    b.beginOffseason();
    expectSame(b, a);
  });

  it('시즌이 끝난 뒤 화면 조회(1군·예상 선발)를 끼워도 결산이 같다', () => {
    const opts = { year: 2026, teamIdx: 7, seed: 'view-save' };
    const a = GameSession.create(store, opts, FAST);
    const b = GameSession.create(store, opts, FAST);
    a.advance(1000);
    b.advance(1000);
    b.setEntry(null); // AI 엔트리 구단은 조회가 명단을 다시 짠다
    a.setEntry(null);
    for (let t = 0; t < 10; t++) b.probableStarter(t);
    b.activeTeam();
    b.futures();
    a.beginOffseason();
    b.beginOffseason();
    expectSame(b, a);
  });

  it('임시 승격 중 저장 → 불러와도 같은 승격 소식이 다시 나오지 않는다', () => {
    const opts = { year: 2026, teamIdx: 1, seed: 'short-save' };
    const a = GameSession.create(store, opts, FAST);
    let b = GameSession.create(store, opts, FAST);
    for (const g of [a, b]) {
      const pitchers = g.registered().filter((p) => p.isPitcher).map((p) => p.idx);
      const five = g.registered().filter((p) => !p.isPitcher).slice(0, 5).map((p) => p.idx);
      g.setEntry([...pitchers, ...five]);
      g.advance(3);
    }
    expect(b.news.some((n) => n.kind === 'callup')).toBe(true);
    b = reload(b);
    a.advance(3);
    b.advance(3);
    expect(b.news).toEqual(a.news);
  });

  it('오프시즌 단계 중 저장 → 불러와 다음 개막 뒤까지', () => {
    const run = (save: boolean) => {
      let g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'off-full' }, FAST);
      g.advance(1000);
      g.beginOffseason();
      if (save) g = reload(g);
      let guard = 0;
      while (g.offseason && g.offseason.stage !== 'ready' && guard++ < 50) {
        const offers = g.league.owner?.offers;
        if (offers?.length) g.acceptOffer(offers[0]);
        if (g.offseason.stage === 'draft') g.autoDraft();
        if (g.offseason.stage === 'comp') g.autoComp();
        if (g.offseason.stage === 'release') g.autoRelease();
        g.nextStage();
        if (save) g = reload(g);
      }
      expect(g.openNextSeason().ok).toBe(true);
      g.advance(15);
      return g;
    };
    expectSame(run(true), run(false));
  });
});
