// 개막 준비 단계의 기용 보드 (2026-10-23 사용자 결정, src/ui/openingBoard.ts): 개막 날 기용 보드를 미리 열고,
// 고친 1군·기용표는 실제로 개막할 때 옮긴다. 옮긴 결과는 미리 보기와 같고, 조작 기록으로 재현된다.
// 전력 메뉴에 들어가면 기용 보드가 먼저 (같은 날 사용자 결정).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import * as Off from '../src/league/offseason';
import { blockOf, entryOf, itemsOf } from '../src/ui/menu';
import { openingEdits, openingPreview, openWithPreview } from '../src/ui/openingBoard';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
}, 120_000);

function toReady(g: GameSession, check?: (g: GameSession) => void): void {
  for (let k = 0; k < 30 && g.offseason!.stage !== 'ready'; k++) {
    const st = g.offseason!.stage;
    if (Off.blockedReason(g.league, g.offseason!)) {
      if (st === 'comp') g.autoComp();
      else if (st === 'draft') g.autoDraft();
      else g.autoRelease();
    }
    check?.(g);
    expect(g.nextStage().ok).toBe(true);
  }
}

describe('개막 준비 단계의 기용 보드', () => {
  it('전력에 들어가면 기용 보드가 먼저 (시즌 중)', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'opening-menu' }, FAST);
    const items = itemsOf('전력');
    expect(items.map((m) => m.key).slice(0, 2)).toEqual(['lineup', 'roster']);
    expect(entryOf(g, items[0])).toBe('lineup');
    expect(blockOf(g, 'lineup')).toBeNull();
  });

  it('개막 준비에서만 열리고, 고친 것은 개막 때 옮겨져 미리 보기와 같고, 재현된다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const opts = { year: 2026, teamIdx: lg, seed: 'opening-board' };
    const g = GameSession.create(store, opts, FAST);
    g.advance(100000);
    g.beginOffseason();
    // 다른 단계에서는 닫힘 (미리 보기도 못 만든다), 선수 명단은 오프시즌 내내 닫힘
    toReady(g, (x) => {
      expect(blockOf(x, 'lineup')).toMatch(/개막 준비 단계에서 열림/);
      expect(x.previewOpening()).toBeNull();
    });
    expect(blockOf(g, 'lineup')).toBeNull();
    expect(blockOf(g, 'roster')).not.toBeNull();

    const pv = openingPreview(g)!;
    expect(pv).not.toBeNull();
    expect(pv.phase).toBe('season');
    expect(pv.day).toBe(0);
    expect(pv.canManage).toBe(true);
    expect(openingPreview(g, false)).toBe(pv); // 조작이 없으면 같은 미리 보기
    expect(openingEdits(g)).toBe(0);
    // 미리 보기에서 기용표를 고친다: 로테이션 순서를 뒤집는다
    const plan = structuredClone(pv.effectivePlan());
    plan.rotation.reverse();
    expect(pv.applyBoard({ plan }).errors).toEqual([]);
    const edits = pv.openingBoardActions();
    expect(edits.length).toBeGreaterThan(0);
    expect(openingEdits(g)).toBe(edits.length);
    expect(g.phase).toBe('offseason'); // 실제 세션은 그대로

    const r = openWithPreview(g);
    expect(r.ok).toBe(true);
    expect(r.carried).toBe(edits.length);
    expect(openingPreview(g, false)).toBeNull();
    // 실제로 개막한 모습 = 미리 보기 (같은 월드·같은 1군·같은 기용표)
    const ids = (x: GameSession) => x.world.players.map((p) => p.id);
    expect(ids(g)).toEqual(ids(pv));
    expect(g.registered().map((p) => p.id)).toEqual(pv.registered().map((p) => p.id));
    expect(g.effectivePlan()).toEqual(pv.effectivePlan());
    expect(g.actions.slice(-edits.length)).toEqual(edits);
    // 저장 뒤 이어 해도, 조작 기록으로 다시 돌려도 같다
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    const re = GameSession.replay(store, opts, g.actions, { year: 2027, day: 0 }, FAST);
    for (const x of [g, h, re]) x.advance(5);
    expect(h.season.toSave()).toEqual(g.season.toSave());
    expect(re.season.toSave()).toEqual(g.season.toSave());
    expect(re.effectivePlan()).toEqual(g.effectivePlan());
  }, 300_000);

  it('미리 보기를 만든 뒤 오프시즌 조작을 하면 미리 보기와 고친 것은 버린다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'opening-stale' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    toReady(g);
    const pv = openingPreview(g)!;
    const plan = structuredClone(pv.effectivePlan());
    plan.rotation.reverse();
    pv.applyBoard({ plan });
    expect(openingEdits(g)).toBeGreaterThan(0);
    expect(g.setInvest('scout', 1).ok).toBe(true);
    expect(openingPreview(g, false)).toBeNull();
    expect(openingEdits(g)).toBe(0);
    const r = openWithPreview(g);
    expect(r).toMatchObject({ ok: true, carried: 0 });
  }, 300_000);
});
