// 진행 멈춤 설정 (2026-10-12 사용자 요청): 시즌 끝까지는 완전 자동, 다른 진행 버튼은 고른 조건에서만 멈춘다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { DEFAULT_STOPS, stopsOnEvent } from '../src/game/stops';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

/** 우리 팀 현재 연승(+)·연패(−) */
function streak(g: GameSession): number {
  let k = 0;
  for (let i = g.season.log.length - 1; i >= 0; i--) {
    const x = g.season.log[i];
    if (x.home !== lg && x.away !== lg) continue;
    const m = Math.sign(x.home === lg ? x.homeRuns - x.awayRuns : x.awayRuns - x.homeRuns);
    if (m === 0 || (k !== 0 && Math.sign(k) !== m)) break;
    k += m;
  }
  return k;
}

describe('진행 멈춤 설정', () => {
  it('시즌 끝까지(멈춤 없음)는 1군 선수를 직접 관리해도 한 번도 멈추지 않는다', () => {
    const g = GameSession.create(store, opts('stop-full'), FAST);
    expect(g.manualEntry).not.toBeNull();
    while (!g.done) {
      expect(g.advance(7)).toBeGreaterThan(0);
      expect(g.stopped).toBe(false);
      expect(g.attention).toEqual([]);
    }
  }, 300_000);

  it('이벤트 자동 선택 + 트레이드 제안만 멈춤: 실제 트레이드 제안에서만 멈추고, 재현해도 같다', () => {
    const o = opts('stop-offer');
    const g = GameSession.create(store, o, FAST);
    const rules = { tradeOffer: true };
    for (let i = 0; i < 400 && !g.done; i++) {
      g.advance(30, rules);
      const ev = g.pendingEvent;
      if (g.stopped) {
        expect(ev).not.toBeNull();
        expect(ev!.id).toBe('trade-offer');
        expect(ev!.vars.none).toBeUndefined();
        g.answerEvent(0);
      } else if (ev) {
        // 진행이 이벤트 날에 끝났지만 멈추지 않는 이벤트: 화면은 첫 번째 선택지로 답한다 (GameShell autoAnswer)
        expect(stopsOnEvent({ ...DEFAULT_STOPS, event: false }, ev)).toBe(false);
        g.answerEvent(0);
      }
    }
    expect(g.done).toBe(true);
    const log = g.league.events!.log;
    expect(log.some((l) => l.id !== 'trade-offer')).toBe(true);
    const r = GameSession.replay(store, o, g.actions, g.day, FAST);
    expect(r.league.events!.log).toEqual(log);
    expect(r.season.standings()).toEqual(g.season.standings());
  }, 300_000);

  it('1군 선수 이탈은 정한 날 수 이상일 때만 멈춘다', () => {
    const g = GameSession.create(store, opts('attn'), FAST);
    const days = 10;
    let stopped = 0;
    while (!g.done) {
      g.advance(30, { injury: true, injuryDays: days });
      for (const a of g.attention) {
        expect(a.kind).toBe('injury');
        const p = g.team.org.find((x) => x.name === a.text.split(':')[0])!;
        const left = g.season.states.absentUntil[p.idx] - (g.day - 1);
        expect(left).toBeGreaterThanOrEqual(days);
        stopped++;
      }
    }
    expect(stopped).toBeGreaterThan(0);
  }, 300_000);

  it('N연패에 이르면 그날 멈춘다', () => {
    const g = GameSession.create(store, opts('stop-losing'), FAST);
    let hits = 0;
    while (!g.done) {
      g.advance(30, { losing: true, losingN: 3 });
      if (g.stopped) {
        expect(g.attention.map((a) => a.kind)).toEqual(['losing']);
        expect(streak(g)).toBe(-3);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(0);
  }, 300_000);

  it('트레이드 마감일·육성선수 등록일에 멈추고, 그날은 아직 트레이드·등록을 할 수 있다', () => {
    const g = GameSession.create(store, opts('stop-dates'), FAST);
    const hasDev = g.team.org.some((p) => p.dev);
    const seen: string[] = [];
    while (!g.done) {
      g.advance(60, { deadline: true, devDay: true });
      for (const a of g.attention) {
        seen.push(a.kind);
        if (a.kind === 'deadline') {
          expect(g.day).toBe(g.tradeDeadlineDay);
          expect(g.tradeOpen).toBe(true);
        } else {
          expect(a.kind).toBe('dev');
          expect(g.day).toBe(g.devRegisterDay);
          const dev = g.team.org.find((p) => p.dev)!;
          expect(g.convertBlock(dev) ?? '').not.toMatch(/부터 정식 등록/);
        }
      }
    }
    expect(seen).toEqual(hasDev ? ['dev', 'deadline'] : ['deadline']);
  }, 300_000);

  it('멈춤 설정은 결과를 바꾸지 않는다 (멈춰서 첫 번째를 고르면 자동 진행과 같다)', () => {
    const a = GameSession.create(store, opts('stop-same'), FAST);
    while (!a.done) a.advance(7);
    if (a.pendingEvent) a.answerEvent(0);
    const b = GameSession.create(store, opts('stop-same'), FAST);
    const all = { ...DEFAULT_STOPS, losing: true, losingN: 3, deadline: true, devDay: true };
    for (let i = 0; i < 2000 && !b.done; i++) {
      b.advance(7, all);
      if (b.pendingEvent) b.answerEvent(0);
      // 위기 때 멈추기(기본 켬): 끼어들기 창에서 "AI 감독에게 맡기기"면 끼어들지 않은 진행과 같다 (UI 2단계 2.2.3)
      if (b.crisis) expect(b.crisisDecline()).toBe(true);
    }
    expect(b.done).toBe(true);
    expect(b.season.standings()).toEqual(a.season.standings());
    expect(b.league.events!.log).toEqual(a.league.events!.log);
    expect(b.cashNow()).toBe(a.cashNow());
  }, 300_000);
});
