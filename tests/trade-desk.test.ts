// UI 2단계 U2-5 트레이드 작업대 (src/ui/tradeDesk.ts): 합의 → 확정, 바뀌는 것 미리보기, 비교 칸 공유 상태.
import { beforeAll, describe, expect, it } from 'vitest';
import { currentRuns } from '../src/ai/value';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type SimPlayer } from '../src/engine';
import { GameSession } from '../src/game/session';
import {
  addToCompare, addToDraft, agreementStatus, COMPARE_MAX, confirmAgreement, deskOf, draftKey, emptyDraft, sendDraft, slotOf, tradeImpact, weakSlots,
  type TradeDraft,
} from '../src/ui/tradeDesk';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

function newGame(seed: string) {
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  return GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
}
const teamIdx = (g: GameSession, name: string) => g.world.teams.findIndex((t) => t.name === name);
const byNow = (g: GameSession, ps: SimPlayer[]) => ps.filter((p) => !p.foreign).sort((a, b) => currentRuns(b, g.values) - currentRuns(a, g.values) || a.idx - b.idx);

/** 상대가 받아들이는 안: 상대 선수 하나를 고르고 요구안(askPackage)을 내줄 칸에 */
function acceptedDraft(g: GameSession, team: number): TradeDraft {
  for (const want of byNow(g, g.world.teams[team].org).slice(4, 30)) {
    const pkg = g.askPackage(team, [want]);
    if (pkg) return { ...emptyDraft(team), give: pkg.map((p) => p.idx), get: [want.idx] };
  }
  throw new Error('받아들이는 안을 찾지 못함');
}

beforeAll(() => {
  store = loadDataStore();
});

describe('합의 → 확정 (7장 결정 4)', () => {
  it('합의는 아무것도 바꾸지 않고, 확정은 바로 제안한 것과 같은 결과·조작 기록을 남긴다', () => {
    const a = newGame('desk');
    const b = newGame('desk');
    a.advance(8);
    b.advance(8);
    const kt = teamIdx(a, 'KT');
    const d = acceptedDraft(a, kt);
    const before = { actions: a.actions.length, org: a.team.org.map((p) => p.idx).sort(), trades: a.trades.length };
    const { ev, agreement } = sendDraft(a, d);
    expect(ev.verdict).toBe('accept');
    expect(agreement).not.toBeNull();
    // 합의만으로는 성사되지 않는다
    expect(a.actions.length).toBe(before.actions);
    expect(a.team.org.map((p) => p.idx).sort()).toEqual(before.org);
    expect(a.trades.length).toBe(before.trades);
    expect(agreementStatus(a, agreement!, d)).toBe('ok');

    expect(confirmAgreement(a, agreement!).verdict).toBe('accept');
    const P = b.world.players;
    expect(b.proposeTrade(kt, d.give.map((i) => P[i]), d.get.map((i) => P[i])).verdict).toBe('accept');
    expect(a.actions).toEqual(b.actions);
    expect(a.trades).toEqual(b.trades);
    a.advance(5);
    b.advance(5);
    expect(a.toSave().season).toEqual(b.toSave().season);
  }, 120_000);

  it('합의 뒤 판을 고치면 "edited", 날짜가 바뀌면 다시 평가한다 (그대로면 "later", 달라지면 "changed")', () => {
    const g = newGame('desk-later');
    g.advance(8);
    const ssg = teamIdx(g, 'SSG');
    const d = acceptedDraft(g, ssg);
    const { agreement } = sendDraft(g, d);
    expect(agreement).not.toBeNull();
    expect(agreementStatus(g, agreement!, { ...d, cash: 10_000 })).toBe('edited');
    g.advance(1);
    const st = agreementStatus(g, agreement!, d);
    expect(['later', 'changed']).toContain(st);
    // "changed"면 확정해도 성사되지 않는다 (proposeTrade가 다시 평가)
    if (st === 'changed') expect(confirmAgreement(g, agreement!).verdict).not.toBe('accept');
    // 마감 뒤에는 늘 "changed"
    g.advance(200);
    expect(agreementStatus(g, agreement!, d)).toBe('changed');
    expect(confirmAgreement(g, agreement!).verdict).toBe('reject-invalid');
  }, 120_000);

  it('같은 안은 순서와 상관없이 같은 열쇠', () => {
    const d: TradeDraft = { team: 1, give: [3, 1], get: [9], cash: 0, gp: ['b', 'a'], rp: [] };
    expect(draftKey(d)).toBe(draftKey({ ...d, give: [1, 3], gp: ['a', 'b'] }));
    expect(draftKey(d)).not.toBe(draftKey({ ...d, cash: 1 }));
  });
});

describe('바뀌는 것 미리보기', () => {
  it('1군·정원·자리 등급·양쪽 인원을 전 → 후로 계산하고, 상대 포수가 모자라게 되면 미리 경고한다 (엔진도 선수단 규칙으로 거절)', () => {
    const g = newGame('desk-impact');
    g.advance(3);
    const t = g.world.teams.find((x) => x.idx !== g.teamIdx)!;
    const reg = new Set(g.registered().map((p) => p.idx));
    const give = byNow(g, g.team.org).find((p) => reg.has(p.idx) && !p.isPitcher)!;
    const get = byNow(g, t.org).find((p) => p.isPitcher)!;
    const im = tradeImpact(g, { ...emptyDraft(t.idx), give: [give.idx], get: [get.idx] });
    expect(im.active[1]).toBe(im.active[0] - 1); // 받은 선수는 2군으로
    expect(im.org[1]).toBe(im.org[0]);
    expect(im.mine.hit[1]).toBe(im.mine.hit[0] - 1);
    expect(im.mine.pit[1]).toBe(im.mine.pit[0] + 1);
    expect(im.other.pit[1]).toBe(im.other.pit[0] - 1);
    expect(im.depth.map((r) => r.slot).sort()).toEqual([slotOf(give), slotOf(get)].sort());
    const gr = im.depth.find((r) => r.slot === slotOf(get))!;
    expect(gr.after ?? 0).toBeGreaterThanOrEqual(gr.before ?? 0);

    // 상대 포수를 모두 달라고 하면 경고, 엔진도 reject-roster (한쪽 인원 상한 안에서)
    const cs = t.org.filter((p) => !p.isPitcher && p.pos === 'C' && !p.foreign);
    const d = { ...emptyDraft(t.idx), get: cs.slice(0, Math.min(cs.length, 4)).map((p) => p.idx) };
    if (cs.length <= 4) {
      const w = tradeImpact(g, d).warn.join(' ');
      expect(w).toContain('포수');
      expect(sendDraft(g, d).ev.verdict).toBe('reject-roster');
    }
  }, 120_000);

  it('약한 자리는 우리 자리 등급이 낮은 셋', () => {
    const g = newGame('desk-weak');
    const w = weakSlots(g);
    expect(w.length).toBe(3);
    expect(new Set(w).size).toBe(3);
  }, 60_000);
});

describe('비교 칸·제안판 공유 상태', () => {
  it('비교 칸은 셋까지, 외국인은 제안판에 넣지 못하고, 다른 구단 선수를 넣으면 상대가 바뀐다', () => {
    const g = newGame('desk-state');
    const others = g.world.teams.filter((t) => t.idx !== g.teamIdx);
    const ps = byNow(g, others[0].org).slice(0, COMPARE_MAX + 1);
    for (let i = 0; i < COMPARE_MAX; i++) expect(addToCompare(g, ps[i].idx)).toBeNull();
    expect(addToCompare(g, ps[COMPARE_MAX].idx)).toMatch(/칸/);
    expect(addToCompare(g, ps[0].idx)).toMatch(/이미/);
    expect(deskOf(g).compare.length).toBe(COMPARE_MAX);

    const foreign = others.flatMap((t) => t.org).find((p) => p.foreign);
    if (foreign) expect(addToDraft(g, foreign)).toMatch(/외국인/);
    expect(addToDraft(g, ps[0])).toBeNull();
    expect(deskOf(g).draft).toMatchObject({ team: others[0].idx, get: [ps[0].idx] });
    const q = byNow(g, others[1].org)[0];
    expect(addToDraft(g, q)).toBeNull();
    expect(deskOf(g).draft).toMatchObject({ team: others[1].idx, get: [q.idx] });
    // 다른 세션(새 게임)은 따로
    expect(deskOf(newGame('desk-state-2')).compare).toEqual([]);
  }, 60_000);
});
