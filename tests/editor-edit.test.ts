// 에디터 모드 E2 선수 하나 고치기 (docs/에디터_기획안.md 3.2·4장, 2026-11-03 사용자 Q4·Q5):
// 고친 뒤 저장·불러오기·이어 돌리기 = 끊김 없이 돌린 판, 재현(replay) 같음, 규정 넘김 경고, 실존 선수 부상 넣기 없음, AI가 고친 천장을 본다.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { editorPreview, editorView } from '../src/game/editor';
import { editRecords, editWarnings, type EditOp } from '../src/game/editOps';
import { aiPotential } from '../src/league/owner';
import { gradeOfRuns } from '../src/fantasy/free';

const P: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const OPTS = { year: 2026, teamIdx: 0, seed: 'editor-e2' } as const;

/** 경기 결과 지문: 순위·경기 점수 */
function fingerprint(g: GameSession): string {
  return JSON.stringify({ st: g.season.standings(), log: g.season.log.map((x) => [x.homeRuns, x.awayRuns]) });
}

describe('에디터 고치기 (시즌 중)', () => {
  let store: DataStore;
  beforeAll(() => { store = loadDataStore(); }, 120_000);

  it('꺼져 있으면 고칠 수 없고, 켜면 고친 값이 들어가며 사용 표시가 "고침"이 된다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.advance(2);
    const p = g.world.teams[3].org.find((x) => !x.isPitcher && (x.bat?.sample ?? 0) > 600)!;
    expect(g.editPlayer([{ op: 'ability', player: p.id, potential: 70 }]).ok).toBe(false);
    expect(editorPreview(g, [{ op: 'ability', player: p.id, potential: 70 }])).toBeNull();
    g.setEditor(true);
    const before = editorView(g, p.id)!;
    const target = Math.min(75, before.now + 5);
    const pot = Math.min(80, Math.max(before.pot, target + 3));
    const r = g.editPlayer([{ op: 'ability', player: p.id, now: target, potential: pot }]);
    expect(r.ok).toBe(true);
    const after = editorView(g, p.id)!;
    expect(Math.abs(after.now - target)).toBeLessThanOrEqual(1);
    expect(after.pot).toBe(pot);
    expect(g.editorMark).toBe('고침');
    expect(g.league.editor?.firstEdit).toEqual({ year: 2026, day: g.day });
    expect(g.league.editor?.edits).toEqual({ 2026: 1 });
    // 고친 기록: 전 → 후
    const rec = editRecords(g);
    expect(rec.length).toBe(1);
    expect(rec[0].names).toEqual([p.name]);
    expect(rec[0].lines.some((l) => /천장 \d+ → \d+/.test(l))).toBe(true);
  }, 240_000);

  it('지금 능력을 천장보다 높이면 천장도 같이 오르고, AI는 고친 천장 + 같은 오차로 본다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const lp = g.league.players.find((x) => x.team === 5 && !x.isPitcher && x.potential < 15)!;
    const gap = aiPotential(g.league, lp) - lp.potential;
    const pv = editorPreview(g, [{ op: 'ability', player: lp.id, now: 75 }])!;
    expect(pv.ops).toEqual([{ op: 'ability', player: lp.id, now: 75, potential: 75 }]);
    expect(g.editPlayer(pv.ops).ok).toBe(true);
    expect(gradeOfRuns(lp.potential, 2026)).toBe(75);
    expect(aiPotential(g.league, lp) - lp.potential).toBeCloseTo(gap, 9);
    // 천장은 지금 능력 아래로 내릴 수 없다 (오류, 저장하지 않음)
    expect(editorPreview(g, [{ op: 'ability', player: lp.id, potential: 60 }])!.error).toMatch(/낮출 수 없습니다/);
    expect(g.editPlayer([{ op: 'ability', player: lp.id, potential: 60 }]).ok).toBe(false);
  }, 120_000);

  it('규정을 넘는 고침은 막지 않고 경고만 (외국인 이동·한도, 최저 연봉, 입단 나이)', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const f = g.world.players.find((x) => x.foreign && x.teamIdx === 1)!;
    const ops: EditOp[] = [{ op: 'move', player: f.id, to: 2 }];
    const w = editWarnings(g, ops);
    expect(w.some((x) => /외국인 선수는 구단 사이에/.test(x))).toBe(true);
    expect(w.some((x) => /보유 한도/.test(x))).toBe(true);
    const d = g.world.players.find((x) => !x.foreign && x.teamIdx === 2)!;
    expect(editWarnings(g, [{ op: 'contract', player: d.id, salary: 100, years: 2 }]).some((x) => /최저 연봉/.test(x))).toBe(true);
    expect(editWarnings(g, [{ op: 'birth', player: d.id, birthYear: 2015 }]).some((x) => /어립니다/.test(x))).toBe(true);
    const r = g.editPlayer(ops);
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(g.world.players.find((x) => x.id === f.id)!.teamIdx).toBe(2);
  }, 120_000);

  it('부상은 낫게 하기만 있다 (부상 중이 아니면 고칠 수 없고, 부상을 넣는 조작은 없다)', () => {
    const src = readFileSync('src/game/editOps.ts', 'utf8');
    expect(src).not.toMatch(/op: 'injur|op: 'injure|op: 'hurt/);
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const p = g.world.teams[0].org[0];
    const pv = editorPreview(g, [{ op: 'heal', player: p.id }])!;
    expect(pv.error).toMatch(/부상 중이 아닙니다/);
    expect(g.editPlayer([{ op: 'heal', player: p.id }]).ok).toBe(false);
    // 부상 선수가 생길 때까지 진행하고 낫게 한다
    let hurt: { id: string; idx: number } | null = null;
    for (let i = 0; i < 40 && !hurt; i++) {
      g.advance(1);
      const x = g.world.players.find((q) => q.teamIdx >= 0 && g.injuryNow(q.id) && g.injuryNow(q.id)!.days > 3);
      if (x) hurt = { id: x.id, idx: x.idx };
    }
    expect(hurt).not.toBeNull();
    expect(g.editPlayer([{ op: 'heal', player: hurt!.id }]).ok).toBe(true);
    expect(g.injuryNow(hurt!.id)).toBeNull();
    expect(g.season.states.absentUntil[hurt!.idx]).toBeLessThanOrEqual(g.day);

    // 낫게 한 판: 저장·불러오기 뒤 이어 돌린 결과 = 끊김 없이 돌린 결과, 재현도 같다
    const healDay = g.day;
    const back = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), P);
    g.advance(6);
    back.advance(6);
    expect(fingerprint(back)).toBe(fingerprint(g));
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, { year: info.at.year, day: info.at.day }, P);
    expect(fingerprint(r)).toBe(fingerprint(g));
    expect(healDay).toBeGreaterThan(0);
  }, 240_000);

  it('고친 뒤 저장·불러오기·이어 돌리기 = 끊김 없이 돌린 판, 재현(replay)도 같다', () => {
    const run = (g: GameSession) => {
      g.setEditor(true);
      g.advance(3);
      const a = g.world.teams[1].org.find((x) => !x.isPitcher && (x.bat?.sample ?? 0) > 600)!;
      const b = g.world.teams[4].org.find((x) => x.isPitcher && (x.pit?.sample ?? 0) > 300)!;
      const c = g.world.teams[0].org.find((x) => !x.foreign && !x.isPitcher && g.leaguePlayer(x.id)?.military?.state === 'pending')!;
      const va = editorView(g, a.id)!;
      expect(g.editPlayer([{ op: 'ability', player: a.id, now: Math.min(80, va.now + 10) }, { op: 'birth', player: a.id, birthYear: 2000 }]).ok).toBe(true);
      expect(g.editPlayer([{ op: 'move', player: b.id, to: 0 }, { op: 'contract', player: b.id, salary: 50000, years: 3 }]).ok).toBe(true);
      expect(g.editPlayer([{ op: 'military', player: c.id, state: 'exempt' }]).ok).toBe(true);
      return [a.id, b.id, c.id];
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

    const info = plain.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, { year: info.at.year, day: info.at.day }, P);
    expect(fingerprint(r)).toBe(fingerprint(plain));
    expect(r.league.editor).toEqual(plain.league.editor);
    for (const id of ids) expect(JSON.stringify(r.leaguePlayer(id))).toBe(JSON.stringify(plain.leaguePlayer(id)));
    const lb = plain.leaguePlayer(ids[1])!;
    expect(lb.team === 0 || plain.world.players.find((x) => x.id === ids[1])!.teamIdx === 0).toBe(true);
    expect(lb.contract.salary).toBe(50000);
    expect(lb.contract.until).toBe(2028);
    expect(plain.leaguePlayer(ids[2])!.military?.state).toBe('exempt');
    expect(plain.leaguePlayer(ids[0])!.birthYear).toBe(2000);
  }, 600_000);
});

describe('에디터 고치기 (오프시즌)', () => {
  it('edit-off 조작으로 남고 재현이 같다', () => {
    const store = loadDataStore();
    const g = GameSession.create(store, OPTS, P);
    g.advance(100000);
    g.beginOffseason();
    g.setEditor(true);
    const lp = g.league.players.find((x) => x.team === 6 && !x.foreign && x.bat)!;
    const r = g.editPlayer([{ op: 'ability', player: lp.id, potential: 72 }, { op: 'move', player: lp.id, to: 0 }, { op: 'birth', player: lp.id, birthYear: 2001 }]);
    expect(r.ok).toBe(true);
    const last = g.actions[g.actions.length - 1];
    expect(last.type).toBe('edit-off');
    expect(g.league.editor?.firstEdit).toEqual({ year: 2026, day: -1 });
    expect(lp.team).toBe(0);
    const info = g.reproInfo();
    const rr = GameSession.replay(store, info.opts, info.actions, undefined, P);
    expect(rr.phase).toBe('offseason');
    expect(JSON.stringify(rr.leaguePlayer(lp.id))).toBe(JSON.stringify(lp));
    expect(rr.league.editor).toEqual(g.league.editor);
  }, 600_000);
});
