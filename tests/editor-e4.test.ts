// 에디터 모드 E4 큰 손 (docs/에디터_기획안.md 7장 E4, 2026-11-03 사용자 Q4·Q5):
// 선수 만들기(오프시즌, 자유 모드 create 다시 쓰기, 늘 가상 선수), 리그 규정(자유 모드 rule), 성장 곡선 미리보기(기대값, 난수 없음).
// 재현·저장 왕복·끊김 없는 진행, 꺼져 있으면 아무것도 안 나옴, 만든 선수 가상 표시.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { editorGrowthCurve, editorPreview, editorRows, editorRules, editorView } from '../src/game/editor';
import { editRecords, editRuleChanges, type EditOp } from '../src/game/editOps';
import { expectedGrowthRuns, growthRuns } from '../src/league/growth';
import { ruleOf } from '../src/league/rules';
import { NAME_MAX } from '../src/fantasy/free';

const P: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const OPTS = { year: 2026, teamIdx: 0, seed: 'editor-e4' } as const;

function fingerprint(g: GameSession): string {
  return JSON.stringify({ st: g.season.standings(), log: g.season.log.map((x) => [x.homeRuns, x.awayRuns]) });
}

describe('성장 기대값 (expectedGrowthRuns)', () => {
  it('growthRuns를 많이 굴린 평균과 맞는다 (운 평균 0, 터지는 해는 확률만큼)', () => {
    const cases: [number, number, number, number, number, number][] = [
      // 나이, 런, 천장, 기회, 성향 d, 시기 τ
      [20, -5, 25, 1, 0.5, 0], [23, 2, 18, 0.4, -0.3, 1], [26, 10, 14, 1, 0, -1], [34, 15, 20, 1, 0, 0], [29, 20, 12, 1, 0, 0],
    ];
    for (const [age, runs, pot, share, d, t] of cases) {
      const n = 6000;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += growthRuns(age, runs, pot, share, new Rng(`e4/${age}/${i}`), false, 1, d, P.potential, t, undefined, P.growth2);
      expect(Math.abs(sum / n - expectedGrowthRuns(age, runs, pot, share, false, 1, d, P.potential, t, P.growth2))).toBeLessThan(0.25);
    }
  });
});

describe('에디터 E4 (시즌 중)', () => {
  let store: DataStore;
  beforeAll(() => { store = loadDataStore(); }, 120_000);

  it('꺼져 있으면 성장 곡선·규정 표·만들기 미리보기가 나오지 않는다', () => {
    const g = GameSession.create(store, OPTS, P);
    const p = g.world.teams[2].org[0];
    expect(editorGrowthCurve(g, p.id)).toBeNull();
    expect(editorRules(g)).toBeNull();
    expect(editorPreview(g, [{ op: 'rule', key: 'orgLimit', value: 80 }])).toBeNull();
    expect(g.editPlayer([{ op: 'rule', key: 'orgLimit', value: 80 }]).ok).toBe(false);
  }, 120_000);

  it('성장 곡선: 결정적이고 상태를 바꾸지 않으며, 천장을 넘지 않고 성향이 빠르면 더 빨리 큰다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    const before = JSON.stringify(g.league);
    const young = g.league.players.find((x) => x.team >= 0 && x.birthYear && 2026 - x.birthYear <= 21 && x.potential - 8 > (editorView(g, x.id)?.nowRuns ?? 99))!;
    expect(young).toBeTruthy();
    const c1 = editorGrowthCurve(g, young.id)!;
    expect(JSON.stringify(editorGrowthCurve(g, young.id))).toBe(JSON.stringify(c1));
    expect(JSON.stringify(g.league)).toBe(before);
    expect(c1.points).toHaveLength(7);
    expect(c1.points[0].year).toBe(2026);
    for (const p of c1.points) expect(p.runs).toBeLessThanOrEqual(c1.potRuns + 1e-9);
    expect(c1.points[6].runs).toBeGreaterThan(c1.points[0].runs);
    // 출전 기회가 적으면 덜 큰다 (한 해 상한에 걸린 해는 같을 수 있어 곡선 합으로 본다)
    const sum = (c: NonNullable<ReturnType<typeof editorGrowthCurve>>) => c.points.reduce((a, p) => a + p.runs, 0);
    const low = editorGrowthCurve(g, young.id, 0.1)!;
    for (let i = 0; i < 7; i++) expect(low.points[i].runs).toBeLessThanOrEqual(c1.points[i].runs + 1e-9);
    expect(sum(low)).toBeLessThan(sum(c1));
    // 성향 d: 빠름이면 느림보다 먼저 큰다 (같은 선수, 고친 뒤)
    expect(g.editPlayer([{ op: 'grow', player: young.id, drive: 1 }]).ok).toBe(true);
    const fast = editorGrowthCurve(g, young.id)!;
    expect(g.editPlayer([{ op: 'grow', player: young.id, drive: -1 }]).ok).toBe(true);
    const slow = editorGrowthCurve(g, young.id)!;
    expect(sum(fast)).toBeGreaterThan(sum(slow));
    // 노장은 내려간다
    const old = g.league.players.find((x) => x.team >= 0 && x.birthYear && 2026 - x.birthYear >= 35 && x.bat && !x.isPitcher)!;
    const oc = editorGrowthCurve(g, old.id)!;
    expect(oc.points[3].runs).toBeLessThan(oc.points[0].runs);
  }, 240_000);

  it('시즌 중 선수 만들기는 막고, 규정 고침은 league.rules·고친 기록·소식에 남는다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.setEditor(true);
    expect(editorPreview(g, [{ op: 'create', name: '가상 투수', team: 0, pos: 'P', age: 22, now: 50, potential: 60 }])!.error).toMatch(/오프시즌/);
    const pv = editorPreview(g, [{ op: 'rule', key: 'orgLimit', value: 200 }])!;
    expect(pv.error).toBeUndefined();
    expect(pv.lines[0]).toMatch(/소속 선수 정원 68명 → 90명 \(50~90 범위로 맞춤\)/);
    expect(editorPreview(g, [{ op: 'rule', key: 'orgLimit', value: null }])!.error).toBeTruthy();
    expect(g.editPlayer([{ op: 'rule', key: 'orgLimit', value: 75 }, { op: 'rule', key: 'foreignRegular', value: 4 }]).ok).toBe(true);
    expect(ruleOf(g.league, 'orgLimit')).toBe(75);
    expect(ruleOf(g.league, 'foreignRegular')).toBe(4);
    expect(editorRules(g)!.find((r) => r.key === 'orgLimit')!.changed).toBe(true);
    expect(editRecords(g)[0].lines.some((l) => l.startsWith('규정 소속 선수 정원'))).toBe(true);
    expect(editRuleChanges(g).get(2026)!.length).toBe(2);
    // 실제 규정으로 돌리기 (외국인 한도는 null = 시대별 실제)
    expect(g.editPlayer([{ op: 'rule', key: 'foreignRegular', value: null }]).ok).toBe(true);
    expect(g.league.rules?.foreignRegular).toBeUndefined();
    // 외국인 포스팅은 자유 모드에서만 작동한다는 경고
    expect(editorPreview(g, [{ op: 'rule', key: 'foreignPosting', value: 1 }])!.warnings.some((w) => /자유 모드/.test(w))).toBe(true);
  }, 240_000);

  it('규정 고침 뒤 저장·불러오기·이어 돌리기 = 끊김 없이 돌린 판, 재현도 같다', () => {
    const run = (g: GameSession) => {
      g.setEditor(true);
      g.advance(3);
      expect(g.editPlayer([{ op: 'rule', key: 'maxPerSide', value: 8 }, { op: 'rule', key: 'postseasonMaxInnings', value: 12 }]).ok).toBe(true);
    };
    const plain = GameSession.create(store, OPTS, P);
    run(plain);
    plain.advance(10);
    const g = GameSession.create(store, OPTS, P);
    run(g);
    g.advance(4);
    const back = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), P);
    back.advance(6);
    expect(fingerprint(back)).toBe(fingerprint(plain));
    expect(JSON.stringify(back.league.rules)).toBe(JSON.stringify(plain.league.rules));
    const info = plain.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, { year: info.at.year, day: info.at.day }, P);
    expect(fingerprint(r)).toBe(fingerprint(plain));
    expect(JSON.stringify(r.league.rules)).toBe(JSON.stringify(plain.league.rules));
  }, 600_000);
});

describe('에디터 E4 (오프시즌 선수 만들기)', () => {
  it('만든 선수는 가상 선수이고, 국적·아시아쿼터·병역·계약이 맞으며, 재현·저장 왕복 뒤 다음 개막까지 같다', () => {
    const store = loadDataStore();
    const g = GameSession.create(store, OPTS, P);
    g.advance(100000);
    g.beginOffseason();
    expect(editorPreview(g, [{ op: 'create', name: 'x', team: 0, pos: 'P', age: 22, now: 50, potential: 60 }])).toBeNull();
    g.setEditor(true);
    // 이름 길이
    expect(editorPreview(g, [{ op: 'create', name: '가'.repeat(NAME_MAX + 1), team: 0, pos: 'P', age: 22, now: 50, potential: 60 }])!.error).toMatch(/자까지/);
    expect(editorPreview(g, [{ op: 'create', name: '  ', team: 0, pos: 'P', age: 22, now: 50, potential: 60 }])!.error).toBeTruthy();
    const ops: EditOp[] = [
      { op: 'create', name: '에디터 유망주', team: 3, pos: 'SS', age: 19, now: 35, potential: 30 },
      { op: 'create', name: '사토 하루키', team: 3, pos: 'P', role: 'RP', age: 27, now: 60, potential: 66, foreign: true, nation: '일본' },
      { op: 'create', name: '김노장', team: 5, pos: '1B', age: 31, now: 55, potential: 55, salary: 30000, years: 2 },
    ];
    const pv = editorPreview(g, ops)!;
    expect(pv.error).toBeUndefined();
    expect(pv.lines[0]).toMatch(/천장은 지금 능력보다 낮을 수 없어 맞춤/);
    expect(pv.lines[1]).toMatch(/아시아쿼터 대상/);
    const n0 = g.league.players.length;
    const res = g.editPlayer(ops);
    expect(res.ok).toBe(true);
    expect(g.actions.at(-1)!.type).toBe('edit-off');
    const made = g.league.players.slice(n0);
    expect(made.map((p) => p.name)).toEqual(['에디터 유망주', '사토 하루키', '김노장']);
    for (const p of made) { expect(p.real).toBe(false); expect(p.outsider).toBeUndefined(); }
    const [a, b, c] = made;
    expect(a.team).toBe(3);
    expect(a.pos).toBe('SS');
    expect(a.military?.state).toBe('pending');
    expect(2027 - a.birthYear!).toBe(19);
    expect(b.foreign).toBe(true);
    expect(b.isPitcher).toBe(true);
    expect(b.military).toBeUndefined();
    // 2027년은 아시아쿼터가 있다: 자리가 비었으면 아시아쿼터 (applyNationality 판정 그대로)
    const heldAsia = g.league.players.filter((p) => p !== b && p.team === 3 && p.foreign && p.asia).length;
    expect(b.asia).toBe(heldAsia === 0);
    expect(c.military?.state).toBe('done');
    expect(c.contract.salary).toBe(30000);
    expect(c.contract.until).toBe(2028);
    // 에디터 표·보기에 가상 선수로 나온다
    const row = editorRows(g)!.find((r) => r.id === a.id)!;
    expect(row.real).toBe(false);
    expect(editorView(g, b.id)!.place).toBe(g.teamInfo(3).name);

    const info = g.reproInfo();
    const rr = GameSession.replay(store, info.opts, info.actions, undefined, P);
    for (const p of made) expect(JSON.stringify(rr.leaguePlayer(p.id))).toBe(JSON.stringify(p));

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
    for (const p of made) expect(JSON.stringify(back.leaguePlayer(p.id))).toBe(JSON.stringify(g.leaguePlayer(p.id)));
    // 개막 뒤 월드에도 가상 선수로
    const sp = g.world.players.find((p) => p.id === a.id);
    if (sp) expect(sp.real).toBe(false);
  }, 600_000);
});
