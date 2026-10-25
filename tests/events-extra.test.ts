// 확장 이벤트 104종 (league/events-extra.ts, 2026-10-12): 모든 이벤트의 문구·선택지·효과를 가짜 도구로 한 번씩 돌려 본다.
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine';
import { EVENTS, type EventContext, type EventPlayer } from '../src/league/events';
import { EXTRA_EVENTS } from '../src/league/events-extra';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

function fakeContext(month: number, rank: number, streak: number) {
  const calls: string[] = [];
  const pl = (id: string, o: Partial<EventPlayer>): EventPlayer => ({
    id, name: `선수${id}`, isPitcher: false, starter: false, age: 27, foreign: false, pa: 200, ops: 0.8, outs: 0, era: 0, fatigue: 0, ...o,
  });
  const players = [
    pl('h1', {}), pl('h2', {}), pl('h3', {}), pl('h4', { age: 34 }), pl('f1', { foreign: true }),
    pl('p1', { isPitcher: true, starter: true, pa: 0, outs: 300, era: 3.5 }), pl('p2', { isPitcher: true, pa: 0, outs: 60, era: 3.0 }),
  ];
  const roster = [
    { id: 'y1', name: '유망1', foreign: false, birthYear: 2006, potential: 30, isPitcher: false },
    { id: 'y2', name: '유망2', foreign: false, birthYear: 2005, potential: 25, isPitcher: true },
  ] as unknown as LeaguePlayer[];
  const c: EventContext = {
    league: { seed: 's' } as LeagueState, team: 0, teamName: 'LG', year: 2026, day: 50, seasonDays: 140, rank, teams: 10, winPct: 0.5,
    cash: 500000, roster, seenValue: (p) => (p.id === 'y1' ? 2 : 1), players, recent: { w: 5, l: 5 }, streak, month, hasRival: true, tradeOpen: true,
    addCash: (a) => calls.push(`cash ${a}`), addTrust: (d) => calls.push(`trust ${d}`), addFill: (f) => calls.push(`fill ${f}`),
    addForm: (e) => calls.push(`form ${e}`), addCond: (v, d, r) => calls.push(`cond ${v} ${d} ${r}`), restPitchers: () => calls.push('restPitchers'), rest: (id, d) => calls.push(`rest ${id} ${d}`),
    tradeOffer: () => null, trade: () => '', addFans: (d) => calls.push(`fans ${d}`), addPotential: (id, d) => calls.push(`pot ${id} ${d}`),
  };
  return { c, calls };
}

describe('확장 이벤트', () => {
  it('104종이 더해지고 id가 겹치지 않는다', () => {
    expect(EXTRA_EVENTS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length);
    expect(EVENTS.filter((e) => e.id.startsWith('x-'))).toHaveLength(EXTRA_EVENTS.length);
  });

  it('모든 이벤트가 어떤 상황에서든 문구를 만들고, 모든 선택지가 오류 없이 효과를 낸다', () => {
    let seen = 0;
    for (const [month, rank, streak] of [[4, 9, -5], [5, 2, 4], [6, 5, 0], [7, 1, 5], [8, 10, -6], [9, 3, 0]]) {
      for (const e of EXTRA_EVENTS) {
        const { c, calls } = fakeContext(month, rank, streak);
        if (e.when && !e.when(c)) continue;
        seen++;
        const rng = new Rng(`t/${e.id}/${month}`);
        const v = e.vars ? e.vars(c, rng) : {};
        const text = e.text(c, v);
        expect(text.length, e.id).toBeGreaterThan(10);
        expect(text, e.id).not.toMatch(/undefined|NaN/);
        expect(e.choices.length, e.id).toBeGreaterThanOrEqual(1);
        for (const ch of e.choices) {
          expect(ch.note(c, v), e.id).not.toMatch(/undefined|NaN/);
          for (const seed of ['a', 'b', 'c']) {
            const r = ch.apply(c, v, new Rng(`${e.id}/${ch.label}/${seed}`));
            expect(r.length, `${e.id} ${ch.label}`).toBeGreaterThan(3);
          }
        }
        expect(calls.every((x) => !/NaN|undefined/.test(x)), `${e.id} ${calls.join(',')}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(300);
  });

  it('부정적인 이벤트가 들어 있다: 손해만 있는 선택지가 있는 이벤트가 30종 넘는다', () => {
    const { c } = fakeContext(7, 9, -5);
    let negative = 0;
    for (const e of EXTRA_EVENTS) {
      if (e.when && !e.when(c)) continue;
      const v = e.vars ? e.vars(c, new Rng(e.id)) : {};
      if (e.choices.some((ch) => /−/.test(ch.note(c, v)) && !/\+/.test(ch.note(c, v)))) negative++;
    }
    expect(negative).toBeGreaterThan(30);
  });
});
