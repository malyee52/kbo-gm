// 에디터 모드 E1 보기 (docs/에디터_기획안.md, 2026-11-03 사용자 Q1~Q4): 켜기·끄기 조작, 사용 표시, 숨긴 값 보기의 경계.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { driveWord, editorRows, editorTeams, editorView, timingText } from '../src/game/editor';

const P: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const OPTS = { year: 2026, teamIdx: 0, seed: 'editor' } as const;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(tsx?|css)$/.test(p) ? [p] : [];
  });
}

/** 경기 결과 지문: 순위·경기 기록 (에디터 켜기·끄기로 바뀌면 안 된다) */
function fingerprint(g: GameSession): string {
  return JSON.stringify({ st: g.season.standings(), log: g.season.log.map((x) => [x.homeRuns, x.awayRuns]) });
}

describe('소스 경계', () => {
  const EDITOR_DIR = join('src', 'ui', 'editor') + sep;
  it('에디터 값(editorView·editorRows·editorTeams)은 src/ui/editor/ 폴더만 부른다', () => {
    const bad = filesUnder('src')
      .filter((f) => !f.startsWith(EDITOR_DIR) && !f.endsWith(join('game', 'editor.ts')))
      .filter((f) => /editorView|editorRows|editorTeams|game\/editor['"]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('에디터 폴더가 있고, 숨겨진 특수능력 이름은 src/ui 안에서 에디터 폴더에만 나온다', () => {
    const ui = filesUnder(join('src', 'ui'));
    const inEditor = ui.filter((f) => f.startsWith(EDITOR_DIR));
    expect(inEditor.length).toBeGreaterThan(0);
    expect(inEditor.some((f) => /traits/.test(readFileSync(f, 'utf8')))).toBe(true);
    const outside = ui.filter((f) => !f.startsWith(EDITOR_DIR) && /traits?\b|TRAIT_/i.test(readFileSync(f, 'utf8')));
    expect(outside).toEqual([]);
  });

  it('에디터 폴더는 숨긴 값을 game/editor.ts로만 얻는다 (엔진 특수능력 모듈·AI 판단을 직접 가져오지 않는다)', () => {
    for (const f of filesUnder(join('src', 'ui', 'editor'))) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/engine\/traits|aiPotential\(|scoutZ\(|currentRuns\(|teamStrength\(|TRAIT_INFO/);
    }
  });
});

describe('켜기·끄기와 보기', () => {
  let store: DataStore;
  let g: GameSession;
  beforeAll(() => {
    store = loadDataStore();
    g = GameSession.create(store, OPTS, P);
    g.advance(5);
  }, 120_000);

  it('켜기 전에는 모든 보기가 null이고 사용 표시가 없다', () => {
    expect(g.editorOn).toBe(false);
    expect(g.editorMark).toBeNull();
    const id = g.world.teams[1].org[0].id;
    expect(editorView(g, id)).toBeNull();
    expect(editorRows(g)).toBeNull();
    expect(editorTeams(g)).toBeNull();
    expect(g.reproInfo().editor).toBeUndefined();
  });

  it('켜면 모든 선수의 진짜 값과 우리 추측이 보이고, 끄면 다시 null (사용 표시는 남는다)', () => {
    expect(g.setEditor(true).ok).toBe(true);
    expect(g.editorMark).toBe('보기');
    expect(g.league.editor).toEqual({ on: true, firstOn: { year: 2026, day: g.day } });
    const rows = editorRows(g)!;
    // 다른 구단·시장 선수 포함 (Q3)
    expect(rows.length).toBeGreaterThan(500);
    expect(new Set(rows.map((r) => r.team)).size).toBeGreaterThanOrEqual(10);
    for (const r of rows) {
      expect(r.pot).toBeGreaterThanOrEqual(20);
      expect(r.pot).toBeLessThanOrEqual(80);
      expect(r.drive).toBeGreaterThanOrEqual(-1);
      expect(r.drive).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.timing)).toBe(true);
    }
    // 우리 선수는 추측 = 진짜, 다른 구단 선수는 어긋나는 선수가 있다
    const mine = rows.filter((r) => r.team === g.teamIdx);
    expect(mine.every((r) => Math.abs(r.guessRuns - r.nowRuns) < 1e-6)).toBe(true);
    expect(rows.filter((r) => r.team >= 0 && r.team !== g.teamIdx).some((r) => Math.abs(r.guessRuns - r.nowRuns) > 0.5)).toBe(true);

    // 선수 하나: 갈래 등급·갈래 천장(지금 이상)·컨디션
    const hitter = g.world.teams[2].org.find((p) => !p.isPitcher && (p.bat?.sample ?? 0) > 600)!;
    const v = editorView(g, hitter.id)!;
    expect(v.grades.map((x) => x.key)).toEqual(['contact', 'power', 'eye', 'speed']);
    for (const x of v.grades) if (x.ceil !== undefined) expect(x.ceil).toBeGreaterThanOrEqual(x.value);
    expect(v.grades.some((x) => x.ceil !== undefined)).toBe(true);
    expect(v.condition?.text).toBeTruthy();
    expect(v.guessSet?.items.length).toBe(3);
    const pitcher = g.world.teams[2].org.find((p) => p.isPitcher && (p.pit?.sample ?? 0) > 300)!;
    expect(editorView(g, pitcher.id)!.grades.map((x) => x.key)).toEqual(['stuff', 'control', 'hrSuppression', 'stamina']);

    // 숨겨진 특수능력은 에디터에서만 이름·효과로 (Q4)
    const traited = g.world.players.find((p) => p.traits?.length)!;
    const tv = editorView(g, traited.id)!;
    expect(tv.traits.length).toBe(traited.traits!.length);
    expect(tv.traits[0].label.length).toBeGreaterThan(0);

    const teams = editorTeams(g)!;
    expect(teams.length).toBe(g.world.teams.length);
    expect([...teams.map((t) => t.rank)].sort((a, b) => a - b)).toEqual(teams.map((_, i) => i + 1));
    expect(teams.every((t) => t.outlook)).toBe(true);

    expect(g.setEditor(false).ok).toBe(true);
    expect(g.editorOn).toBe(false);
    expect(editorView(g, hitter.id)).toBeNull();
    expect(editorRows(g)).toBeNull();
    expect(g.editorMark).toBe('보기');
    expect(g.reproInfo().editor).toBe('보기');
    expect(g.league.editor?.firstOn.day).toBeGreaterThanOrEqual(0);
  });

  it('보기 낱말', () => {
    expect(driveWord(0.7)).toBe('매우 빠름');
    expect(driveWord(-0.3)).toBe('느림');
    expect(driveWord(0)).toBe('보통');
    expect(timingText(1.3)).toBe('또래보다 1.3년 늦게 큼');
    expect(timingText(-0.6)).toBe('또래보다 0.6년 일찍 큼');
    expect(timingText(0.1)).toBe('또래와 비슷한 때 큼');
  });

  it('같은 판에서 몇 번 불러도 같은 값 (난수·상태 변경 없음)', () => {
    g.setEditor(true);
    const id = g.world.teams[4].org[3].id;
    expect(JSON.stringify(editorView(g, id))).toBe(JSON.stringify(editorView(g, id)));
    expect(JSON.stringify(editorRows(g))).toBe(JSON.stringify(editorRows(g)));
  });
});

describe('조작 기록·저장·결정성', () => {
  let store: DataStore;
  beforeAll(() => {
    store = loadDataStore();
  });

  it('켜기·끄기는 조작 기록에 남고 재현·저장 왕복에서 그대로, 경기 결과는 켜지 않은 판과 같다', () => {
    const plain = GameSession.create(store, OPTS, P);
    plain.advance(12);

    const g = GameSession.create(store, OPTS, P);
    g.advance(3);
    g.setEditor(true);
    // 보기 조회를 끼워도 진행 결과가 같아야 한다
    editorRows(g);
    editorTeams(g);
    editorView(g, g.world.teams[0].org[0].id);
    g.advance(4);
    g.setEditor(false);
    g.advance(5);
    expect(fingerprint(g)).toBe(fingerprint(plain));
    expect(g.actions.filter((a) => a.type === 'editor').map((a) => (a as { on: boolean }).on)).toEqual([true, false]);

    // 재현
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, { year: info.at.year, day: info.at.day }, P);
    expect(r.league.editor).toEqual(g.league.editor);
    expect(fingerprint(r)).toBe(fingerprint(g));

    // 저장 왕복: 표시가 남고, 켜 둔 채 저장하면 켜진 채로 불러온다
    g.setEditor(true);
    const back = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), P);
    expect(back.league.editor).toEqual(g.league.editor);
    expect(back.editorOn).toBe(true);
    expect(back.editorMark).toBe('보기');
    back.advance(3);
    g.advance(3);
    expect(fingerprint(back)).toBe(fingerprint(g));
  }, 240_000);

  it('오프시즌 켜기는 editor-off 조작으로 남고, 다음 시즌 기준 보기·재현이 같다', () => {
    const g = GameSession.create(store, OPTS, P);
    g.advance(100000);
    g.beginOffseason();
    expect(g.phase).toBe('offseason');
    g.setEditor(true);
    expect(g.actions[g.actions.length - 1]).toEqual({ year: 2026, type: 'editor-off', on: true });
    expect(g.league.editor?.firstOn).toEqual({ year: 2026, day: -1 });
    const rows = editorRows(g)!;
    expect(rows.length).toBeGreaterThan(500);
    // 드래프트 풀·시장 같은 소속 없는 선수도 들어 있다 (Q3)
    expect(rows.some((r) => r.team < 0)).toBe(true);
    expect(editorTeams(g)!.every((t) => t.outlook === null)).toBe(true);
    const id = rows.find((r) => r.team === 3)!.id;
    expect(editorView(g, id)!.condition).toBeNull();
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, undefined, P);
    expect(r.phase).toBe('offseason');
    expect(r.league.editor).toEqual(g.league.editor);
    expect(JSON.stringify(editorRows(r))).toBe(JSON.stringify(rows));
  }, 600_000);
});
