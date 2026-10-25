// 퓨처스리그(2군) 간단 모델 (league/futures.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { ensureEvents } from '../src/league/events';
import { FUT_FULL, futuresForm, futuresOpportunity } from '../src/league/futures';

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
    // 외국인은 뺀다: 외국인 1군 등록 한도 때문에 주전 외국인 타자도 외국인 투수가 올라온 날은 2군에 머문다 (2026-10-23 fut-test 두산 톰프슨 468타석·퓨처스 114타석)
    const regulars = full.world.players.filter((p) => !p.isPitcher && !p.foreign && full.season.bat[p.idx].pa >= 450);
    expect(regulars.length).toBeGreaterThan(20);
    for (const p of regulars) expect(f.lines.get(p.idx)?.bat?.pa ?? 0).toBeLessThan(60);
    const minors = full.world.players.filter((p) => !p.isPitcher && full.season.bat[p.idx].pa === 0 && !p.foreign && (p.startAbsent ?? 0) === 0);
    expect(minors.filter((p) => (f.lines.get(p.idx)?.bat?.pa ?? 0) > 100).length).toBeGreaterThan(30);
  });

  it('나눠 진행해도(하루씩) 한 번에 진행한 것과 같다', () => {
    const a = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fut-chunk' }, FAST);
    const b = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fut-chunk' }, FAST);
    // 무작위 이벤트는 양쪽 다 끈다: 확률은 날마다 오르므로 0에서 시작하면 한 번에 진행한 쪽에서 중간에 이벤트가 날 수 있다
    // (2026-10-13 수비수별 실책을 넣은 뒤 24일째 대표팀 이벤트가 끼어들어 갈라졌다). 아주 낮게 두어 40일 안에 오르지 않게
    for (const g of [a, b]) ensureEvents(g.league).chance = -100;
    a.advance(40);
    for (let i = 0; i < 40; i++) { b.advance(1); b.futures(); }
    expect([...b.futures().lines.entries()]).toEqual([...a.futures().lines.entries()]);
    expect(b.futures().teams).toEqual(a.futures().teams);
  }, 300_000);
});

describe('퓨처스 기록을 성장 판정에 쓰기, 창단 퓨처스 구단 성적 (2026-10-12)', () => {
  it('출전 기회는 타석·상대 타자 수에 비례하고, 활약도는 운 × 표본 신뢰도다', () => {
    const lines = [...full.futures().lines.values()];
    for (const l of lines) {
      const o = futuresOpportunity(l);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
      expect(Math.abs(futuresForm(l))).toBeLessThanOrEqual(o + 1e-9);
    }
    const regular = lines.filter((l) => l.bat && l.bat.pa >= FUT_FULL.bat);
    expect(regular.length).toBeGreaterThan(0);
    expect(regular.every((l) => futuresOpportunity(l) === 1)).toBe(true);
  });

  it('결산 때 퓨처스 활약·부진이 성장 판정에 태그로 남고, 지난 시즌 퓨처스 순위가 보관된다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fut-grow' }, FAST);
    g.advance(100000);
    g.advancePostseason(10_000);
    const before = g.futures().teams;
    g.beginOffseason();
    expect(g.league.lastFutures?.year).toBe(2026);
    expect(g.league.lastFutures!.teams).toEqual(before);
    expect(g.futures().teams).toEqual(before);
    const tags = [...g.offseason!.growth!.values()].flatMap((e) => e.tags ?? []);
    expect(tags).toContain('퓨처스 활약');
    expect(tags).toContain('퓨처스 부진');
  }, 300_000);

  it('2012 시작: 1군 진입 전 NC도 퓨처스리그 순위에 있고, 선수들이 퓨처스 성적을 낸다', () => {
    const sk = store.season(2012)!.teams.findIndex((t) => t.name === 'SK');
    const g = GameSession.create(store, { year: 2012, teamIdx: sk, seed: 'nc-fut' }, FAST);
    ensureEvents(g.league).chance = 0;
    g.advance(60);
    const nc = g.league.teams.findIndex((t) => t.name === 'NC');
    const f = g.futures();
    expect(f.teams).toHaveLength(9);
    const row = f.teams.find((t) => t.team === nc)!;
    expect(row.g).toBeGreaterThan(0);
    expect(row.w + row.l).toBe(row.g);
    expect(row.rs).toBeGreaterThan(0);
    expect([...f.lines.values()].filter((l) => l.teamIdx === nc).length).toBeGreaterThan(10);
    // 1군 구단 선수의 기록 색인과 겹치지 않는다
    for (const [idx, l] of f.lines) if (l.teamIdx !== nc) expect(g.world.players[idx].teamIdx).toBe(l.teamIdx);
  }, 300_000);
});
