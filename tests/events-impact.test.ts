// 무작위 이벤트의 경기 영향 (2026-10-11 사용자 요청: 재정 이벤트만 있던 문제).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng } from '../src/engine';
import { GameSession } from '../src/game/session';
import { ensureEvents, EVENTS, formToday } from '../src/league/events';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

const GAME_EVENTS = ['team-meeting', 'momentum', 'bullpen-rest', 'slump-hitter', 'ace-manage', 'hitting-coach', 'pitching-coach', 'summer-heat', 'rival-week', 'trade-offer', 'veteran-mentor'];

describe('경기력 효과 (컨디션)', () => {
  it('formToday: 구단 전체·타자만·한 선수, 기간 밖은 0', () => {
    const players = [
      { idx: 0, id: 'a', teamIdx: 0, isPitcher: false },
      { idx: 1, id: 'b', teamIdx: 0, isPitcher: true },
      { idx: 2, id: 'c', teamIdx: 1, isPitcher: false },
    ];
    const L = { events: { chance: 0, pending: null, log: [], buffs: [], forms: [
      { team: 0, year: 2026, from: 5, until: 10, edge: 0.02, note: '' },
      { team: 0, year: 2026, from: 5, until: 10, edge: 0.01, side: 'bat' as const, note: '' },
      { team: 1, year: 2026, from: 0, until: 20, edge: 0.05, player: 'c', note: '' },
    ] } };
    expect(formToday(L, 2026, 4, players)![0]).toBeCloseTo(0, 10);
    const f = formToday(L, 2026, 5, players)!;
    expect([...f].map((x) => +x.toFixed(3))).toEqual([0.03, 0.02, 0.05]);
    expect(formToday(L, 2027, 5, players)).toBeNull();
  });

  it('시즌 내내 우리 구단 경기력 +3.0이면 같은 시드보다 많이 이긴다', () => {
    const base = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'form-a' }, FAST);
    const boosted = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'form-a' }, FAST);
    (ensureEvents(boosted.league).forms ??= []).push({ team: lg, year: 2026, from: 0, until: 1000, edge: 0.03, note: '시험' });
    for (const g of [base, boosted]) {
      ensureEvents(g.league).chance = 0; // 무작위 이벤트는 끈다 (비교를 깨끗하게)
      // 하루마다 끈다 (2026-10-12 이벤트 빈도를 올린 뒤 5일 사이에 이벤트가 끼어들었다)
      while (!g.done) { g.league.events!.chance = 0; g.advance(1); }
    }
    const w = (g: GameSession) => g.season.teams[lg].w / (g.season.teams[lg].w + g.season.teams[lg].l);
    expect(w(boosted) - w(base)).toBeGreaterThan(0.03);
  }, 300_000);
});

describe('경기에 영향을 주는 이벤트', () => {
  it('새 이벤트 11종이 있고, 여러 시즌을 돌리면 그중 여러 종류가 실제로 나온다', () => {
    const ids = new Set(EVENTS.map((e) => e.id));
    for (const id of GAME_EVENTS) expect(ids.has(id), id).toBe(true);
    const seen = new Set<string>();
    for (const seed of ['imp-1', 'imp-2']) {
      const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
      g.advance(100000);
      for (const l of g.league.events!.log) seen.add(l.id);
    }
    // 2026-10-12 이벤트가 127종으로 늘어 이 11종은 드물어졌다: 두 시즌에 여러 종류가 나오고 그중 이 11종도 섞여 있으면 된다
    expect(seen.size).toBeGreaterThanOrEqual(10);
    expect(GAME_EVENTS.filter((id) => seen.has(id)).length).toBeGreaterThanOrEqual(1);
  }, 300_000);

  it('AI 트레이드 제안은 AI가 받아들일 조건이고, 받아들이면 선수가 바뀐다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'offer' }, FAST);
    g.advance(30);
    const c = g.eventContext();
    let offer = null;
    for (let i = 0; i < 10 && !offer; i++) offer = c.tradeOffer(new Rng(`offer-${i}`));
    expect(offer).not.toBeNull();
    const msg = c.trade(offer!.team, offer!.give, offer!.get);
    expect(msg).toContain('성사');
    expect(g.world.players.find((p) => p.id === offer!.give)!.teamIdx).toBe(offer!.team);
    expect(g.world.players.find((p) => p.id === offer!.get)!.teamIdx).toBe(lg);
  });

  it('휴식 처방: 쉬게 한 선수는 그 기간 결장하고, 불펜 휴식은 피로를 없앤다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'rest' }, FAST);
    g.advance(20);
    const c = g.eventContext();
    const sp = c.players.find((p) => p.isPitcher && p.starter)!;
    c.rest(sp.id, 7);
    const idx = g.world.players.find((p) => p.id === sp.id)!.idx;
    expect(g.season.states.absentUntil[idx]).toBeGreaterThanOrEqual(g.day + 7);
    c.restPitchers();
    expect(g.eventContext().players.filter((p) => p.isPitcher && !p.starter).every((p) => p.fatigue === 0)).toBe(true);
  });

  it('이벤트에 모두 두 번째 선택지로 답해도 재현하면 같은 결과', () => {
    const o = { year: 2026, teamIdx: lg, seed: 'imp-replay' };
    const g = GameSession.create(store, o, FAST);
    for (let i = 0; i < 400 && !g.done; i++) {
      g.advance(3, { event: true });
      if (g.league.events?.pending) g.answerEvent(1);
    }
    const r = GameSession.replay(store, o, g.actions, g.day, FAST);
    expect(r.season.standings()).toEqual(g.season.standings());
    expect(r.league.events!.log).toEqual(g.league.events!.log);
    expect(r.league.events!.forms ?? []).toEqual(g.league.events!.forms ?? []);
  }, 300_000);

  it('시즌 끝까지(자동 선택): 멈추지 않고 첫 번째 선택지로 처리하고, 재현해도 같다', () => {
    const o = { year: 2026, teamIdx: lg, seed: 'auto-season' };
    const g = GameSession.create(store, o, FAST);
    // 화면의 "시즌 끝까지"와 같은 흐름: 일주일씩, 이벤트에서 멈추지 않는다
    while (!g.done) expect(g.advance(7)).toBeGreaterThan(0);
    if (g.pendingEvent) g.answerEvent(0);
    expect(g.pendingEvent).toBeFalsy();
    const log = g.league.events!.log;
    expect(log.length).toBeGreaterThan(3);
    expect(log.every((l) => l.choice === 0)).toBe(true);
    const r = GameSession.replay(store, o, g.actions, g.day, FAST);
    expect(r.league.events!.log).toEqual(log);
    expect(r.season.standings()).toEqual(g.season.standings());
    expect(r.cashNow()).toBe(g.cashNow());
  }, 300_000);
});

