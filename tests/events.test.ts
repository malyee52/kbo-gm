// 시즌 중 무작위 이벤트 (2026-10-11 사용자 요청): 확률이 날마다 오르고 생기면 처음 값으로, 선택은 조작 기록으로 재현.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { EVENT_BASE, EVENT_STEP, EVENTS } from '../src/league/events';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

describe('무작위 이벤트', () => {
  it('이벤트가 없는 날마다 확률이 오르고, 생기면 처음 값으로 돌아간다', () => {
    const g = GameSession.create(store, opts('ev-a'), FAST);
    let prev = EVENT_BASE;
    let sawReset = false;
    let sawRise = false;
    for (let d = 0; d < 80; d++) {
      g.advance(1, { event: true });
      const st = g.league.events!;
      if (st.pending) {
        expect(st.chance).toBe(EVENT_BASE);
        sawReset = true;
        g.answerEvent(0);
      } else {
        expect(st.chance).toBeCloseTo(Math.min(0.35, prev + EVENT_STEP), 10);
        sawRise = true;
      }
      prev = st.chance;
    }
    expect(sawRise).toBe(true);
    expect(sawReset).toBe(true);
  });

  it('화면 진행(이벤트에서 멈춤)은 이벤트가 생긴 날 멈추고, 답하기 전에는 진행하지 않는다', () => {
    const g = GameSession.create(store, opts('ev-b'), FAST);
    g.advance(200, { event: true });
    expect(g.pendingEvent).not.toBeNull();
    const day = g.day;
    expect(g.advance(7, { event: true })).toBe(0);
    expect(g.day).toBe(day);
    const def = EVENTS.find((e) => e.id === g.pendingEvent!.id)!;
    expect(def.choices.length).toBeGreaterThanOrEqual(2);
    expect(g.answerEvent(1).ok).toBe(true);
    expect(g.pendingEvent).toBeNull();
    expect(g.actions.at(-1)).toMatchObject({ type: 'event', choice: 1, day });
  });

  it('답한 선택은 조작 기록으로 다시 돌려도 같다 (이벤트·자금·신뢰도), 저장했다 불러와도 같다', () => {
    const g = GameSession.create(store, opts('ev-c'), FAST);
    for (let i = 0; i < 6; i++) {
      g.advance(200, { event: true });
      if (g.pendingEvent) g.answerEvent(g.pendingEvent ? EVENTS.find((e) => e.id === g.pendingEvent!.id)!.choices.length - 1 : 0);
    }
    const r = GameSession.replay(store, opts('ev-c'), g.actions, { year: 2026, day: g.day }, FAST);
    expect(r.league.events!.log).toEqual(g.league.events!.log);
    expect(r.cashNow()).toBe(g.cashNow());
    expect(r.owner.trust).toBe(g.owner.trust);
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(h.league.events).toEqual(g.league.events);
    expect(h.cashNow()).toBe(g.cashNow());
  });

  it('화면 없이 진행하면 첫 번째 선택지로 자동 처리하고 시즌을 끝까지 간다 (한 시즌에 이벤트가 여러 번)', () => {
    const g = GameSession.create(store, opts('ev-d'), FAST);
    g.advance(100000);
    expect(g.done).toBe(true);
    const log = g.league.events!.log.filter((l) => l.year === 2026);
    expect(log.length).toBeGreaterThanOrEqual(4);
    expect(log.length).toBeLessThanOrEqual(20);
    expect(log.every((l) => l.choice === 0)).toBe(true);
  });
});
