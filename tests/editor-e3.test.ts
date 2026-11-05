// 에디터 모드 E3 고치기 확장 (docs/에디터_기획안.md 3.2·7장 E3, 2026-11-03 사용자 Q4·Q5):
// 갈래별 능력·갈래 천장·성장 성향 d·시기 τ, 구단 자금·팬·신뢰·지명권, 표 일괄 고침(조작 하나).
// 갈래 고침 뒤 천장 규칙, 저장·불러오기·이어 돌리기 = 끊김 없이 돌린 판, 재현(replay) 같음, 꺼져 있으면 아무것도 안 나옴.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { editorBulkOps, editorPicks, editorPreview, editorView } from '../src/game/editor';
import { editRecords, type EditOp } from '../src/game/editOps';
import { pickOwner } from '../src/league/picks';

const P: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const OPTS = { year: 2026, teamIdx: 0, seed: 'editor-e3' } as const;

function fingerprint(g: GameSession): string {
  return JSON.stringify({ st: g.season.standings(), log: g.season.log.map((x) => [x.homeRuns, x.awayRuns]) });
}

const log = (x: number) => Math.log(x);

describe('에디터 E3 (시즌 중)', () => {
  let store: DataStore;
  beforeAll(() => { store = loadDataStore(); }, 120_000);

  it('꺼져 있으면 지명권·일괄 고침·갈래 보기가 나오지 않는다', () => {
    const g = GameSession.create(store, OPTS, P);
    const p = g.world.teams[2].org.find((x) => !x.isPitcher)!;
    expect(editorPicks(g)).toBeNull();
    expect(editorBulkOps(g, [p.id], 'pot', 5)).toEqual([]);
    expect(editorPreview(g, [{ op: 'branch', player: p.id, nowGrade: { hr: 70 } }])).toBeNull();
    expect(g.editPlayer([{ op: 'cash', team: 1, amount: 10000 }]).ok).toBe(false);
  }, 120_000);

  it('갈래 고침: 지금 갈래를 천장 위로 올리면 갈래 천장·종합 천장도 오르고, 천장만 지금 아래로는 못 내린다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    g.advance(2);
    const sp = g.world.teams[3].org.find((x) => !x.isPitcher && (x.bat?.sample ?? 0) > 600)!;
    const v0 = editorView(g, sp.id)!;
    expect(v0.branches.map((b) => b.key)).toEqual(['so', 'bb', 's1', 'd2', 't3', 'hr']);
    const hr0 = v0.branches.find((b) => b.key === 'hr')!;
    const target = Math.min(80, Math.max(hr0.ceil, hr0.value) + 8);
    const pv = editorPreview(g, [{ op: 'branch', player: sp.id, nowGrade: { hr: target } }])!;
    expect(pv.error).toBeUndefined();
    expect(pv.lines.some((l) => /파워 \d+ → \d+/.test(l))).toBe(true);
    expect(pv.lines.some((l) => /파워 천장 .*지금보다 낮을 수 없어 맞춤/.test(l))).toBe(true);
    const lp = g.leaguePlayer(sp.id)!;
    const pot0 = lp.potential;
    expect(g.editPlayer(pv.ops).ok).toBe(true);
    // 갈래 천장 ≥ 지금 갈래, 종합 천장이 그대로 맞물림 (ceil.pa = potential), 월드 선수도 같은 비율
    expect(lp.ceil!.bat!.hr).toBeCloseTo(lp.bat!.hr, 9);
    expect(lp.ceil!.pa).toBe(lp.potential);
    expect(lp.potential).toBeGreaterThan(pot0);
    expect(g.world.players.find((x) => x.id === sp.id)!.bat!.hr).toBeCloseTo(lp.bat!.hr, 9);
    const v1 = editorView(g, sp.id)!;
    expect(Math.abs(v1.branches.find((b) => b.key === 'hr')!.value - target)).toBeLessThanOrEqual(1);
    for (const b of v1.branches) expect(b.ceil).toBeGreaterThanOrEqual(b.value);
    // 천장만 지금 아래로: 오류
    const so = v1.branches.find((b) => b.key === 's1')!;
    expect(editorPreview(g, [{ op: 'branch', player: sp.id, ceilGrade: { s1: Math.max(20, so.value - 5) } }])!.error).toMatch(/낮출 수 없습니다/);
    // 천장만 올리면 지금 갈래는 그대로, 종합 천장만 오른다
    const bb = v1.branches.find((b) => b.key === 'bb')!;
    const now = { ...lp.bat! };
    const potBefore = lp.potential;
    expect(g.editPlayer([{ op: 'branch', player: sp.id, ceilGrade: { bb: Math.min(80, bb.ceil + 6) } }]).ok).toBe(bb.ceil < 80);
    if (bb.ceil < 80) {
      expect(lp.bat).toEqual(now);
      expect(lp.potential).toBeGreaterThan(potBefore);
      expect((lp.ceil!.bat!.bb)).toBeGreaterThan(bb.ceilRatio);
    }
  }, 240_000);

  it('투수 갈래: 볼넷(작을수록 좋음) 방향도 등급이 오르면 좋아진다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const sp = g.world.teams[4].org.find((x) => x.isPitcher && (x.pit?.sample ?? 0) > 300)!;
    const v0 = editorView(g, sp.id)!;
    expect(v0.branches.map((b) => b.key)).toEqual(['so', 'bb', 'hr', 'hit']);
    const bb = v0.branches.find((b) => b.key === 'bb')!;
    const lp = g.leaguePlayer(sp.id)!;
    const was = lp.pit!.bb;
    expect(g.editPlayer([{ op: 'branch', player: sp.id, nowGrade: { bb: Math.min(80, bb.value + 10) } }]).ok).toBe(true);
    expect(lp.pit!.bb).toBeLessThan(was);
    expect(log(lp.ceil!.pit!.bb)).toBeLessThanOrEqual(log(lp.pit!.bb) + 1e-9);
  }, 120_000);

  it('성장 성향·시기는 범위 안으로 맞추고 값을 그대로 넣는다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const lp = g.league.players.find((x) => x.team === 2 && x.bat && !x.isPitcher)!;
    const pv = editorPreview(g, [{ op: 'grow', player: lp.id, drive: 3, timing: -9 }])!;
    expect(pv.ops).toEqual([{ op: 'grow', player: lp.id, drive: 1, timing: -P.growth2.tauSpan }]);
    expect(pv.lines.some((l) => /맞춤/.test(l))).toBe(true);
    expect(g.editPlayer([{ op: 'grow', player: lp.id, drive: -0.4, timing: 1.25 }]).ok).toBe(true);
    expect(lp.drive).toBe(-0.4);
    expect(lp.timing).toBe(1.25);
    const v = editorView(g, lp.id)!;
    expect(v.drive).toBe(-0.4);
    expect(v.timing).toBe(1.25);
  }, 120_000);

  it('구단 고치기: 자금(장부 에디터 줄)·팬·신뢰·지명권', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    g.advance(2);
    const c0 = g.cashNow(3);
    const pk = editorPicks(g)!;
    expect(pk.drafts).toEqual([2027, 2028]);
    const ops: EditOp[] = [
      { op: 'cash', team: 3, amount: 50000 },
      { op: 'fans', team: 3, delta: -10 },
      { op: 'trust', value: 90 },
      { op: 'pick', draft: 2027, round: 1, from: 5, to: 0 },
    ];
    const pv = editorPreview(g, ops)!;
    expect(pv.error).toBeUndefined();
    expect(pv.lines.length).toBe(4);
    // 팬을 깎으면 스폰서 예상도 줄 수 있다 (인기도가 상한 1.4에 걸려 있을 때만 그대로): 그 몫을 뺀 자금이 정확히 +5억
    const sponsor = () => g.seasonFinance(3)!.items.sponsor ?? 0;
    const s0 = sponsor();
    expect(g.editPlayer(ops).ok).toBe(true);
    expect(g.cashNow(3)).toBe(c0 + 50000 + sponsor() - s0);
    expect(g.league.ledger.at(-1)).toMatchObject({ to: 3, amount: 50000, kind: 'editor' });
    expect(g.owner.trust).toBe(90);
    expect(pickOwner(g.league, { draft: 2027, round: 1, from: 5 })).toBe(0);
    expect(editorPicks(g)!.moved).toEqual([{ draft: 2027, round: 1, from: 5, owner: 0 }]);
    expect(editorPreview(g, [{ op: 'pick', draft: 2035, round: 1, from: 5, to: 0 }])!.error).toMatch(/드래프트/);
    expect(editorPreview(g, [{ op: 'trust', value: 90 }])!.error).toBe('바뀌는 값이 없습니다.');
    expect(editRecords(g)[0].lines.length).toBe(4);
  }, 240_000);

  it('표 일괄 고침은 조작 하나로 남고, 바뀌지 않는 선수는 뺀다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const ids = g.world.teams[6].org.slice(0, 8).map((x) => x.id);
    const ops = editorBulkOps(g, ids, 'pot', 5);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.length).toBeLessThanOrEqual(ids.length);
    const n = g.actions.length;
    const r = g.editPlayer(ops);
    expect(r.ok).toBe(true);
    expect(g.actions.length).toBe(n + 1);
    const a = g.actions.at(-1)!;
    expect(a.type).toBe('edit');
    expect(a.type === 'edit' && a.ops.length).toBe(ops.length);
    expect(g.league.editor?.edits).toEqual({ 2026: 1 });
    // 천장 끝(80)·지금 능력 그대로 등 바뀌지 않으면 빈 묶음
    const top = editorBulkOps(g, ids, 'now', 0);
    expect(top.every((o) => o.op === 'ability' && o.now === 20)).toBe(true);
    expect(editorBulkOps(g, ids, 'heal', 0).every((o) => o.op === 'heal')).toBe(true);
  }, 120_000);

  it('갈래·성향·구단·일괄 고침 뒤 저장·불러오기·이어 돌리기 = 끊김 없이 돌린 판, 재현도 같다', () => {
    const run = (g: GameSession) => {
      g.setEditor(true);
      g.advance(3);
      const a = g.world.teams[1].org.find((x) => !x.isPitcher && (x.bat?.sample ?? 0) > 600)!;
      const b = g.world.teams[4].org.find((x) => x.isPitcher && (x.pit?.sample ?? 0) > 300)!;
      const va = editorView(g, a.id)!;
      const vb = editorView(g, b.id)!;
      expect(g.editPlayer([{ op: 'branch', player: a.id, nowGrade: { hr: Math.min(80, va.branches[5].value + 12), so: Math.min(80, va.branches[0].value + 6) } },
        { op: 'grow', player: a.id, drive: 0.8, timing: -1 }]).ok).toBe(true);
      expect(g.editPlayer([{ op: 'branch', player: b.id, nowGrade: { so: Math.min(80, vb.branches[0].value + 10) } }]).ok).toBe(true);
      expect(g.editPlayer([{ op: 'cash', team: 2, amount: -30000 }, { op: 'fans', team: 0, delta: 15 }, { op: 'trust', value: 20 }]).ok).toBe(true);
      const bulk = editorBulkOps(g, g.world.teams[5].org.slice(0, 6).map((x) => x.id), 'now', 70);
      expect(g.editPlayer(bulk).ok).toBe(true);
      return [a.id, b.id];
    };
    const plain = GameSession.create(store, OPTS, P);
    const ids = run(plain);
    plain.advance(12);

    const g = GameSession.create(store, OPTS, P);
    run(g);
    g.advance(5);
    const back = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), P);
    back.advance(7);
    expect(fingerprint(back)).toBe(fingerprint(plain));
    expect(back.cashNow(2)).toBe(plain.cashNow(2));

    const info = plain.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, { year: info.at.year, day: info.at.day }, P);
    expect(fingerprint(r)).toBe(fingerprint(plain));
    for (const id of ids) expect(JSON.stringify(r.leaguePlayer(id))).toBe(JSON.stringify(plain.leaguePlayer(id)));
    expect(r.owner.trust).toBe(plain.owner.trust);
    expect(JSON.stringify(r.league.fans)).toBe(JSON.stringify(plain.league.fans));
    expect(r.cashNow(2)).toBe(plain.cashNow(2));
  }, 600_000);
});

describe('에디터 E3 (오프시즌)', () => {
  it('edit-off로 갈래·성향·구단을 고치고 재현이 같다, 다음 개막까지 이어도 같다', () => {
    const store = loadDataStore();
    const g = GameSession.create(store, OPTS, P);
    g.advance(100000);
    g.beginOffseason();
    g.setEditor(true);
    const lp = g.league.players.find((x) => x.team === 6 && !x.foreign && x.bat && !x.isPitcher && x.birthYear && 2027 - x.birthYear <= 24)!;
    const v = editorView(g, lp.id)!;
    const pk = editorPicks(g)!;
    const ops: EditOp[] = [
      { op: 'branch', player: lp.id, ceilGrade: { hr: Math.min(80, v.branches[5].ceil + 10) } },
      { op: 'grow', player: lp.id, drive: 1, timing: -2 },
      { op: 'cash', team: 6, amount: 20000 },
      { op: 'pick', draft: pk.drafts[0], round: 2, from: 1, to: 6 },
    ];
    const r = g.editPlayer(ops);
    expect(r.ok).toBe(true);
    expect(g.actions.at(-1)!.type).toBe('edit-off');
    expect(lp.drive).toBe(1);
    const info = g.reproInfo();
    const rr = GameSession.replay(store, info.opts, info.actions, undefined, P);
    expect(JSON.stringify(rr.leaguePlayer(lp.id))).toBe(JSON.stringify(lp));
    expect(rr.cashNow(6)).toBe(g.cashNow(6));
    expect(pickOwner(rr.league, { draft: pk.drafts[0], round: 2, from: 1 })).toBe(6);
    // 저장 왕복 뒤 다음 개막까지 이어 돌린 판 = 끊김 없이 이어 돌린 판 (고친 성향·시기가 결산 성장에 쓰인다)
    const back = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), P);
    const toOpening = (x: GameSession) => {
      for (let i = 0; i < 50 && x.offseason && x.offseason.stage !== 'ready'; i++) {
        if (x.offseason.stage === 'draft') x.autoDraft();
        if (x.offseason.stage === 'comp') x.autoComp();
        if (x.offseason.stage === 'release') x.autoRelease();
        x.nextStage();
      }
      expect(x.openNextSeason().ok).toBe(true);
      x.advance(4);
    };
    toOpening(g);
    toOpening(back);
    expect(fingerprint(back)).toBe(fingerprint(g));
    expect(JSON.stringify(back.leaguePlayer(lp.id))).toBe(JSON.stringify(g.leaguePlayer(lp.id)));
  }, 600_000);
});
