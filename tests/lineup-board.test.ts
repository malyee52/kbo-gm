// 기용 보드 (2026-10-22 UI 대개편 2차): 엔트리·기용표 변경 묶음을 함께 검사하고 한 번에 적용한다 (session.checkBoard·applyBoard).
// 결정함 '엔트리' 기준 (src/ui/decisions.ts entryDecisions)도 여기서 본다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type DepthPlan } from '../src/engine';
import { GameSession, type GameSave } from '../src/game/session';
import { decisions, entryDecisions } from '../src/ui/decisions';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

const game = (seed: string) => GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);

/** 주전 야수 하나를 2군으로 내리고, 2군 야수를 그 자리에 세우고, 불펜 투수를 마무리로 하는 묶음 */
function bundle(g: GameSession): { entry: number[]; plan: DepthPlan; down: number; up: number; closer: number } {
  const reg = g.registered().map((p) => p.idx);
  const plan = structuredClone(g.effectivePlan());
  const down = plan.starters.LF!;
  const up = g.team.org.find((p) => !p.isPitcher && !p.dev && !reg.includes(p.idx) && !g.isAbsent(p) && g.reregisterDay(p) === null)!;
  plan.starters.LF = up.idx;
  const closer = g.registered().find((p) => p.isPitcher && p.idx !== plan.closer && !plan.rotation.includes(p.idx))!.idx;
  plan.closer = closer;
  return { entry: [...reg.filter((i) => i !== down), up.idx], plan, down, up: up.idx, closer };
}

describe('기용 보드 묶음 적용', () => {
  it('엔트리 이동과 기용표를 한 번에 적용하고, 조작 기록은 기존 entry·plan 두 개로 남는다', () => {
    const g = game('board-1');
    const b = bundle(g);
    // 기용표만 따로 보면 2군 선수가 들어 있어 틀리지만, 새 1군 명단 기준으로는 맞다
    expect(g.checkPlan(b.plan).errors.length).toBeGreaterThan(0);
    expect(g.checkBoard({ entry: b.entry, plan: b.plan }).errors).toEqual([]);
    const n = g.actions.length;
    expect(g.applyBoard({ entry: b.entry, plan: b.plan }).errors).toEqual([]);
    expect(g.actions.slice(n).map((a) => a.type)).toEqual(['entry', 'plan']);
    expect(g.slotOf(g.world.players[b.up])).toBe('LF');
    expect(g.pitcherRole(g.world.players[b.closer])).toBe('CL');
    expect(g.registered().some((p) => p.idx === b.down)).toBe(false);
    expect(g.news.some((x) => x.text === `${g.world.players[b.up].name} 1군 등록`)).toBe(true);
  });

  it('하나라도 규정을 어기면 아무것도 바꾸지 않는다 (정원 초과)', () => {
    const g = game('board-2');
    const reg = g.registered().map((p) => p.idx);
    const extra = g.team.org.filter((p) => !p.dev && !reg.includes(p.idx)).slice(0, 3).map((p) => p.idx);
    const plan = structuredClone(g.effectivePlan());
    plan.closer = null;
    const n = g.actions.length;
    const before = g.effectivePlan();
    const r = g.applyBoard({ entry: [...reg, ...extra], plan });
    expect(r.errors.some((e) => e.includes('최대'))).toBe(true);
    expect(g.actions.length).toBe(n);
    expect(g.effectivePlan()).toEqual(before);
    expect(g.registered().map((p) => p.idx)).toEqual(reg);
  });

  it('묶음으로 바꾼 게임을 저장했다 불러와 끝까지 돌리면 끊지 않은 게임과 같고, 조작 기록으로 다시 돌려도 같다', () => {
    const play = (g: GameSession) => {
      g.advance(5);
      const b = bundle(g);
      expect(g.applyBoard({ entry: b.entry, plan: b.plan }).errors).toEqual([]);
      g.advance(20);
    };
    const a = game('board-save');
    play(a);
    const saved = JSON.parse(JSON.stringify(a.toSave())) as GameSave;
    a.advance(100000);
    const b = GameSession.load(store, saved, FAST);
    b.advance(100000);
    expect(b.season.teams).toEqual(a.season.teams);
    expect(b.season.bat).toEqual(a.season.bat);
    const c = GameSession.replay(store, { year: 2026, teamIdx: lg, seed: 'board-save' }, a.actions, undefined, FAST);
    c.advance(100000);
    expect(c.season.teams).toEqual(a.season.teams);
  }, 120_000);
});

describe('결정함 엔트리 기준', () => {
  it('개막일에는 엔트리 항목이 없다', () => {
    const g = game('board-inbox');
    expect(entryDecisions(g)).toEqual([]);
  });

  it('1군을 비우면 빈자리, 기용표의 주전을 2군으로 내리면 빈 주전 자리, 마무리를 비우면 역할 빈 칸이 나온다', () => {
    const g = game('board-inbox');
    const plan = structuredClone(g.effectivePlan());
    const lf = plan.starters.LF!;
    plan.closer = null;
    expect(g.setPlan(plan).errors).toEqual([]);
    // 기용표에 LF를 남긴 채 1군에서만 뺀다 (예전 방식의 이동)
    expect(g.move(g.world.players[lf], false).errors).toEqual([]);
    const keys = entryDecisions(g).map((d) => d.key);
    expect(keys).toContain('entry-size');
    expect(keys).toContain('entry-starter');
    expect(keys).toContain('entry-role');
    expect(decisions(g).find((d) => d.key === 'entry-role')!.title).toContain('마무리 없음');
    expect(decisions(g).every((d) => d.kind !== '엔트리' || (d.go === 'lineup' && !d.when && !d.blocking))).toBe(true);
  });

  it('엔트리를 AI에게 맡기면 엔트리 항목을 세지 않는다', () => {
    const g = game('board-inbox');
    g.move(g.registered()[0], false);
    expect(entryDecisions(g).length).toBeGreaterThan(0);
    g.setEntry(null);
    expect(decisions(g).some((d) => d.kind === '엔트리')).toBe(false);
  });
});
