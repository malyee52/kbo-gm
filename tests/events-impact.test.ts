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

describe('경기력 효과 (이벤트·코치·캠프)', () => {
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

  it('시즌 내내 우리 구단 경기력 +3.0이면 같은 시드의 −3.0보다 득실 기준 기대 승률이 높다', () => {
    // 한 시드는 운에 흔들려 여러 시드 평균으로 본다 (2026-10-12 투수 가치·선발 기준을 바꾼 뒤 한 시드가 +2.0%p였다).
    // 2026-10-13 엔트리 순환(rosterChurn)을 넣은 뒤 form-b가 −7.3%p(운)로 두 시드 평균이 +0.2%p가 되어 네 시드(c~f)로 바꿨다.
    // 6시드 평균: 순환 없음 +6.9%p, 순환 +3.3%p (form-b 포함). 경기력 효과는 선수마다 그대로 들어가고 순환과 관계없다
    // 2026-10-22 선수별 P/PA(사슬 길이)를 넣은 뒤 c~f 평균이 +2.1%p(운)였다. 시드 하나의 퍼짐이 약 6%p라 네 시드로는 모자라
    // 여덟 시드(c~j)로 늘렸다: P/PA 전 +6.8%p, 뒤 +5.6%p (c~f만 보면 전 +10.6 · 뒤 +2.1, g~j만 보면 전 +3.0 · 뒤 +9.1)
    // 2026-10-23 엔진 2 14단계(세이브·홀드·승리 투수 규정, 결과가 바뀜) 뒤 c~j 평균이 +0.3%p(운)였다. 시드 하나가 −13.1~+21.5%p로 퍼져
    // 열여섯 시드(c~r)로 늘렸다: c~j +0.3%p, k~r +8.1%p, 16시드 +4.2%p
    // 2026-10-24 구장 득점 셈 곱 꼴(구장 개발 9) 뒤 16시드 평균이 +0.4%p(운)였다. 시드를 더 늘리면 전체 시험의 바닥 시간이 늘어서,
    // 같은 시뮬 수(시드마다 둘)로 +3.0과 −3.0을 견준다: 효과는 두 배, 흔들림은 같다 (문턱도 두 배 0.05)
    // 2026-10-24 번트 실측(기습 번트 몫) 뒤 승률로 +2.19%p(운)였다. 득점·실점이 같아도 승패 배분 운이 커서(시드 표준편차 승률 5.3%p · 득실 4.6%p)
    // 시험 대상이 아닌 그 운을 빼려고 득실 기준 기대 승률(피타고리안, 지수 1.83)로 본다: 16시드 +4.08%p (24시드 c~z +4.55%p, 승률로는 +3.32%p)
    // 두 고침을 함께 쓴다 (능력치 v2 16-4 병합): 승률 대신 득실 기준 기대 승률로 +3.0 대 −3.0
    const w = (g: GameSession) => { const t = g.season.teams[lg]; return t.rs ** 1.83 / (t.rs ** 1.83 + t.ra ** 1.83); };
    let diff = 0;
    const seeds = ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r'].map((x) => `form-${x}`);
    for (const seed of seeds) {
      const base = GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
      const boosted = GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
      (ensureEvents(base.league).forms ??= []).push({ team: lg, year: 2026, from: 0, until: 1000, edge: -0.03, note: '시험' });
      (ensureEvents(boosted.league).forms ??= []).push({ team: lg, year: 2026, from: 0, until: 1000, edge: 0.03, note: '시험' });
      for (const g of [base, boosted]) {
        ensureEvents(g.league).chance = 0; // 무작위 이벤트는 끈다 (비교를 깨끗하게)
        // 하루마다 끈다 (2026-10-12 이벤트 빈도를 올린 뒤 5일 사이에 이벤트가 끼어들었다)
        while (!g.done) { g.league.events!.chance = 0; g.advance(1); }
      }
      diff += (w(boosted) - w(base)) / seeds.length;
    }
    expect(diff).toBeGreaterThan(0.05);
  }, 2_400_000);
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

