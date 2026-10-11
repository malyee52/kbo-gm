// 퓨처스리그(2군) 간단 모델 (league/futures.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { ensureEvents } from '../src/league/events';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
let full: GameSession;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  full = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fut-test' }, FAST);
  full.advance(100000);
}, 300_000);

describe('퓨처스리그', () => {
  it('리그 전체 수준: 타율 .25~.29, 평균자책 4.2~5.4. 순위는 승+패 = 경기, 1군 경기의 약 80%', () => {
    const f = full.futures();
    const bats = [...f.lines.values()].filter((l) => l.bat).map((l) => l.bat!);
    const pits = [...f.lines.values()].filter((l) => l.pit).map((l) => l.pit!);
    const avg = bats.reduce((s, b) => s + b.h, 0) / bats.reduce((s, b) => s + b.ab, 0);
    const era = (pits.reduce((s, p) => s + p.er, 0) * 27) / pits.reduce((s, p) => s + p.outs, 0);
    expect(avg).toBeGreaterThan(0.25);
    expect(avg).toBeLessThan(0.29);
    expect(era).toBeGreaterThan(4.2);
    expect(era).toBeLessThan(5.4);
    expect(f.teams).toHaveLength(full.world.teams.length);
    for (const t of f.teams) {
      expect(t.w + t.l).toBe(t.g);
      expect(t.g).toBe(Math.round(full.season.teams[t.team].g * 0.8));
    }
  });

  it('시즌 내내 1군에 있던 주전은 퓨처스 기록이 거의 없고, 2군 선수는 있다', () => {
    const f = full.futures();
    const regulars = full.world.players.filter((p) => !p.isPitcher && full.season.bat[p.idx].pa >= 450);
    expect(regulars.length).toBeGreaterThan(20);
    for (const p of regulars) expect(f.lines.get(p.idx)?.bat?.pa ?? 0).toBeLessThan(60);
    const minors = full.world.players.filter((p) => !p.isPitcher && full.season.bat[p.idx].pa === 0 && !p.foreign && (p.startAbsent ?? 0) === 0);
    expect(minors.filter((p) => (f.lines.get(p.idx)?.bat?.pa ?? 0) > 100).length).toBeGreaterThan(30);
  });

  it('나눠 진행해도(하루씩) 한 번에 진행한 것과 같다', () => {
    const a = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fut-chunk' }, FAST);
    const b = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fut-chunk' }, FAST);
    for (const g of [a, b]) ensureEvents(g.league).chance = 0;
    a.advance(40);
    for (let i = 0; i < 40; i++) { ensureEvents(b.league).chance = 0; b.advance(1); b.futures(); }
    expect([...b.futures().lines.entries()]).toEqual([...a.futures().lines.entries()]);
    expect(b.futures().teams).toEqual(a.futures().teams);
  }, 300_000);
});
