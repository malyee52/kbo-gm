// 플레이어 통제 (2026-10-11 사용자 요청): 직접 정한 주전은 AI가 쉬게 하지 않는다, 1군 선수 이탈 때 진행을 멈춘다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, LINEUP_SLOTS } from '../src/engine';
import { ATTENTION_DAYS, GameSession } from '../src/game/session';
import { ensureEvents } from '../src/league/events';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

describe('직접 정한 기용표', () => {
  it('기용표를 직접 정하면, 결장하지 않은 주전은 한 경기도 쉬지 않는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'no-rest' }, FAST);
    ensureEvents(g.league).chance = 0;
    const plan = g.effectivePlan();
    expect(g.setPlan(plan).errors).toEqual([]);
    const starters = LINEUP_SLOTS.map((s) => plan.starters[s]).filter((i): i is number => i !== undefined);
    const g0 = g.season.teams[lg].g;
    for (let i = 0; i < 40; i++) { ensureEvents(g.league).chance = 0; g.advance(1); }
    const games = g.season.teams[lg].g - g0;
    expect(games).toBeGreaterThan(25);
    const healthy = starters.filter((i) => !g.season.absences.some((a) => a.idx === i) && (g.world.players[i].startAbsent ?? 0) === 0);
    expect(healthy.length).toBeGreaterThan(4);
    for (const i of healthy) expect(g.season.bat[i].g, g.world.players[i].name).toBe(games);
  });

  it('AI에게 기용을 맡기면 주전도 가끔 쉰다 (지금까지와 같다)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'no-rest' }, FAST);
    ensureEvents(g.league).chance = 0;
    for (let i = 0; i < 40; i++) { ensureEvents(g.league).chance = 0; g.advance(1); }
    const games = g.season.teams[lg].g;
    const regulars = g.team.org.filter((p) => !p.isPitcher && g.season.bat[p.idx].pa > 100 && !g.season.absences.some((a) => a.idx === p.idx));
    expect(regulars.some((p) => g.season.bat[p.idx].g < games)).toBe(true);
  });
});

describe('손볼 일이 생기면 멈춘다', () => {
  it('직접 관리하는 1군 선수가 며칠 이상 빠지면 진행이 그날 멈추고 attention에 남는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'attn' }, FAST);
    expect(g.manualEntry).not.toBeNull();
    let stopped = false;
    for (let k = 0; k < 30 && !g.done; k++) {
      const did = g.advance(30, { injury: true, injuryDays: ATTENTION_DAYS });
      if (g.attention.length) {
        stopped = true;
        expect(did).toBeLessThanOrEqual(30);
        const name = g.attention[0].text.split(':')[0];
        const p = g.team.org.find((x) => x.name === name)!;
        expect(g.manualEntry!.has(p.idx)).toBe(true);
        expect(g.season.states.absentUntil[p.idx] - (g.day - 1)).toBeGreaterThanOrEqual(ATTENTION_DAYS);
        break;
      }
    }
    expect(stopped).toBe(true);
  }, 300_000);
});

describe('타순 직접 정하기', () => {
  it('정한 타순(자리 순서)대로 경기에 나가고, 저장·재현해도 그대로다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'order' }, FAST);
    ensureEvents(g.league).chance = 0;
    const ai = g.battingOrderSlots();
    expect(ai.manual).toBe(false);
    const mine = [...ai.order].reverse();
    expect(g.setBattingOrder(mine).errors).toEqual([]);
    expect(g.battingOrderSlots()).toEqual({ order: mine, manual: true });
    expect(g.setBattingOrder(['C', 'C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B']).errors.join()).toContain('아홉 자리');
    const plan = g.effectivePlan();
    const n0 = g.season.log.length;
    for (let i = 0; i < 12; i++) { ensureEvents(g.league).chance = 0; g.advance(1); }
    let checked = 0;
    for (let k = n0; k < g.season.log.length; k++) {
      const box = g.season.boxes.get(k);
      if (!box) continue;
      const side = g.season.log[k].home === lg ? box.home : box.away;
      const expected = mine.map((s) => plan.starters[s]);
      // 그 경기 날에 결장 중인 선수가 있으면 건너뛴다 (그날 다친 선수도: 다친 경기에는 나왔고 더블헤더 2차전부터 빠진다).
      // 전에는 시즌 중 한 번이라도 빠진 선수가 있으면 모든 경기를 건너뛰어 엔진 2 14단계에서 검사한 경기가 0이 됐다
      const day = g.season.log[k].day;
      if (expected.some((i) => i === undefined || g.season.absences.some((a) => a.idx === i && a.day <= day && day < a.until))) continue;
      // 박스스코어는 교체로 들어온 타자를 그 타순 아래에 끼워 넣으므로 선발 타자만 본다 (2026-10-27: 경기 중 대타·대수비가 있던 경기에서 앞 9명에 교체 타자가 섞였다)
      expect(side.batters.filter((b) => !b.sub).map((b) => b.idx)).toEqual(expected);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
    const r = GameSession.replay(store, { year: 2026, teamIdx: lg, seed: 'order' }, g.actions, g.day, FAST);
    expect(r.battingOrderSlots().order).toEqual(mine);
    expect(g.setBattingOrder(null).errors).toEqual([]);
    expect(g.battingOrderSlots().manual).toBe(false);
  });
});
