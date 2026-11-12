// 시즌 중 무작위 이벤트 (2026-10-11 사용자 요청): 확률이 날마다 오르고 생기면 처음 값으로, 선택은 조작 기록으로 재현.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { EVENT_BASE, EVENT_STEP, EVENTS, isNoticeEvent, NOTICE_EVENT_IDS } from '../src/league/events';

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
      if (st.pending?.id === 'trade-offer') {
        // AI 트레이드 제안은 무작위 이벤트와 따로 굴린다 (그날은 이벤트 확률을 건드리지 않는다)
        expect(st.chance).toBeCloseTo(prev, 10);
        g.answerEvent(0);
      } else if (st.pending) {
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
    expect(log.length).toBeLessThanOrEqual(30);
    expect(log.every((l) => l.choice === 0)).toBe(true);
    // AI 트레이드 제안은 따로 굴려 마감 전까지 여러 번 온다 (2026-10-12, 예전에는 한 시즌 0.4번 꼴)
    const offers = log.filter((l) => l.id === 'trade-offer');
    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.every((l) => l.day <= g.tradeDeadlineDay)).toBe(true);
  });

  // 2026-11-12 사용자 결정 Q35: 선택지 차이가 미미한 57종은 묻지 않고 소식으로만 (첫 선택지 효과 그대로)
  it('소식 이벤트: 57종, 모두 있는 이벤트이고 트레이드 제안은 아니다. 묻는 이벤트는 선택지가 둘 이상', () => {
    expect(NOTICE_EVENT_IDS.length).toBe(57);
    expect(new Set(NOTICE_EVENT_IDS).size).toBe(57);
    for (const id of NOTICE_EVENT_IDS) {
      const def = EVENTS.find((e) => e.id === id);
      expect(def, id).toBeDefined();
      expect(def!.notice).toBe(true);
      expect(def!.manual).toBeFalsy();
    }
    expect(isNoticeEvent('trade-offer')).toBe(false);
    for (const e of EVENTS) if (!e.notice) expect(e.choices.length, e.id).toBeGreaterThanOrEqual(2);
  });

  it('소식 이벤트에서는 멈추지 않고 답할 것도 없다. 소식으로 알리고 첫 선택지 효과를 적용한다', () => {
    const g = GameSession.create(store, opts('ev-notice'), FAST);
    let notices = 0;
    for (let i = 0; i < 40 && notices < 3; i++) {
      g.advance(200, { event: true });
      const raw = g.league.events!.pending;
      if (raw && isNoticeEvent(raw.id)) throw new Error(`소식 이벤트 ${raw.id}에서 멈췄다`);
      if (g.pendingEvent) g.answerEvent(0);
      notices = g.league.events!.log.filter((l) => isNoticeEvent(l.id)).length;
      if (g.done) break;
    }
    expect(notices).toBeGreaterThanOrEqual(1);
    const logs = g.league.events!.log.filter((l) => isNoticeEvent(l.id));
    expect(logs.every((l) => l.choice === 0)).toBe(true);
    expect(g.news.some((n) => n.kind === 'event' && n.text.startsWith('소식: '))).toBe(true);
    // 소식 이벤트는 조작 기록에 남지 않는다 (화면이 답하지 않음)
    for (const a of g.actions) {
      if (a.type !== 'event') continue;
      const l = g.league.events!.log.find((x) => x.year === (a.year ?? 2026) && x.day === a.day);
      expect(l && isNoticeEvent(l.id)).toBe(false);
    }
  });

  it('예전 저장의 조작 기록이 소식 이벤트에 고른 선택(둘째 선택지)은 재현할 때 그대로 읽힌다', () => {
    // 소식 이벤트가 생긴 날을 찾는다 (진행은 자동, 생긴 날 끝에 답을 기다리는 상태가 된다)
    const g = GameSession.create(store, opts('ev-old'), FAST);
    let at: { year: number; day: number; id: string } | null = null;
    for (let d = 0; d < 190 && !at; d++) {
      g.advance(1);
      const raw = g.league.events!.pending;
      if (raw && isNoticeEvent(raw.id) && EVENTS.find((e) => e.id === raw.id)!.choices.length >= 2) at = { year: g.year, day: g.day, id: raw.id };
    }
    expect(at).not.toBeNull();
    // 예전 판에서 그날 둘째 선택지를 고른 조작 기록
    const old = [{ year: at!.year, day: at!.day, type: 'event' as const, choice: 1 }];
    const r = GameSession.replay(store, opts('ev-old'), old, { year: at!.year, day: at!.day + 3 }, FAST);
    const hit = r.league.events!.log.find((l) => l.year === at!.year && l.day === at!.day && l.id === at!.id);
    expect(hit?.choice).toBe(1);
    // 조작 기록이 없으면 같은 자리에서 첫 선택지로 자동
    const auto = GameSession.replay(store, opts('ev-old'), [], { year: at!.year, day: at!.day + 3 }, FAST);
    expect(auto.league.events!.log.find((l) => l.year === at!.year && l.day === at!.day && l.id === at!.id)?.choice).toBe(0);
    // 저장했다 불러온 판에서도 같은 자리에서 고를 수 있다 (소식이라도 기다리는 상태는 저장에 남는다)
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(h.league.events!.pending?.id).toBe(at!.id);
    expect(h.pendingEvent).toBeNull();
  });
});
