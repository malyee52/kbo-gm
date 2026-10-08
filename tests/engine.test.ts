import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { computeGrades, DEFAULT_PARAMS, generateSchedule, Rng, simulateSeason, worldForYear, type SeasonResult, type World } from '../src/engine';
import { assignLineup, newPlayerStates, refreshActive, type TeamSeason } from '../src/engine/team';

let store: DataStore;
let world: World;
let result: SeasonResult;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
  world = worldForYear(store, 2025, FAST);
  result = simulateSeason(world, FAST, 'test-seed');
});

describe('난수', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it('다른 시드는 다른 수열을 만든다', () => {
    expect(new Rng('abc').next()).not.toBe(new Rng('abd').next());
  });

  it('값은 0 이상 1 미만이고 평균이 0.5 근처다', () => {
    const r = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });
});

describe('일정', () => {
  // 시대별 구단 수와 팀당 경기 수 (자료집 시즌구조 시트)
  const cases: [number, number][] = [[6, 80], [6, 100], [6, 110], [7, 108], [7, 120], [8, 126], [8, 132], [8, 133], [9, 128], [10, 144]];
  it.each(cases)('%i구단 %i경기: 모든 팀이 정확히 그만큼 치른다', (n, g) => {
    const days = generateSchedule(n, g, new Rng(`s${n}-${g}`));
    const played = new Array(n).fill(0);
    const home = new Array(n).fill(0);
    for (const day of days) {
      const seen = new Set<number>();
      for (const { home: h, away: a } of day) {
        expect(h).not.toBe(a);
        expect(seen.has(h) || seen.has(a)).toBe(false); // 하루에 한 경기
        seen.add(h);
        seen.add(a);
        played[h]++;
        played[a]++;
        home[h]++;
      }
    }
    expect(played).toEqual(new Array(n).fill(g));
    for (const h of home) expect(Math.abs(h - g / 2)).toBeLessThanOrEqual(n); // 홈·원정이 크게 치우치지 않는다
  });

  it('상대별 경기 수가 같다 (10구단 144경기 = 상대당 16경기)', () => {
    const days = generateSchedule(10, 144, new Rng('pairs'));
    const m = new Map<string, number>();
    for (const day of days) for (const g of day) {
      const k = [g.home, g.away].sort((a, b) => a - b).join('-');
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    expect(m.size).toBe(45);
    for (const v of m.values()) expect(v).toBe(16);
  });
});

describe('월드 구성 (2025년)', () => {
  it('10개 구단이고 구단마다 야수와 투수가 충분하다', () => {
    expect(world.teams).toHaveLength(10);
    for (const t of world.teams) {
      expect(t.org.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(15);
      expect(t.org.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(14);
    }
  });

  it('능력치에 비정상 값이 없다', () => {
    for (const p of world.players) {
      const skill = (p.bat ?? p.pit) as unknown as Record<string, number>;
      for (const [k, v] of Object.entries(skill)) {
        expect(Number.isFinite(v), `${p.name} ${k}`).toBe(true);
        expect(v, `${p.name} ${k}`).toBeGreaterThanOrEqual(0);
      }
      expect(p.value).toBeGreaterThan(0);
    }
  });

  it('직전 3시즌 성적이 능력에 반영된다: 2024년 홈런 상위 타자의 홈런 능력은 리그 평균보다 높다', () => {
    const s2024 = store.season(2024)!;
    const top = [...s2024.bat].sort((a, b) => b.hr - a.hr).slice(0, 5).map((r) => r.id);
    const found = world.players.filter((p) => top.includes(p.id));
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) expect(p.bat!.hr, p.name).toBeGreaterThan(1.3);
  });

  it('그 해 성적은 미리 반영되지 않는다: 직전 기록이 있는 선수의 능력은 2025년 기록을 지워도 같다', () => {
    const cur = store.season(2025)!;
    const blank = { ...cur, bat: cur.bat.map((r) => ({ ...r, h: 0, hr: 0, d: 0, t: 0, bb: 0, so: 0 })) };
    const alt = worldForYear({ ...store, season: (y: number) => (y === 2025 ? blank : store.season(y)) }, 2025, FAST);
    const veterans = world.players.filter((p) => !p.isPitcher && !p.debutEstimate);
    expect(veterans.length).toBeGreaterThan(100);
    for (const p of veterans) {
      const q = alt.players.find((x) => x.id === p.id)!;
      expect(q.bat).toEqual(p.bat);
    }
  });

  it('등급은 20~80 범위이고 주전 평균이 50 근처다', () => {
    const g = computeGrades(world);
    const regular = world.players.filter((p) => !p.isPitcher && p.bat!.sample >= 300);
    const mean = (f: (x: { contact: number; power: number; eye: number; speed: number }) => number) =>
      regular.reduce((s, p) => s + f(g.batters.get(p.id)!), 0) / regular.length;
    for (const v of g.batters.values()) for (const x of Object.values(v)) {
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThanOrEqual(80);
    }
    expect(mean((x) => x.contact)).toBeGreaterThan(47);
    expect(mean((x) => x.contact)).toBeLessThan(53);
    expect(mean((x) => x.power)).toBeGreaterThan(47);
    expect(mean((x) => x.power)).toBeLessThan(53);
  });
});

describe('시즌 시뮬레이션 (2025년)', () => {
  it('모든 팀이 144경기를 치르고 승패 합이 맞는다', () => {
    for (const t of result.teams) {
      expect(t.g).toBe(144);
      expect(t.w + t.l + t.t).toBe(144);
    }
    const sum = (f: (t: (typeof result.teams)[number]) => number) => result.teams.reduce((s, t) => s + f(t), 0);
    expect(sum((t) => t.w)).toBe(sum((t) => t.l));
    expect(sum((t) => t.rs)).toBe(sum((t) => t.ra));
    expect(sum((t) => t.t) % 2).toBe(0);
    expect(result.totals.games).toBe(720);
  });

  it('타자 기록의 합이 맞는다: 타석 = 타수 + 볼넷 + 사구 + 희생플라이 + 희생번트', () => {
    for (const p of world.players) {
      const b = result.bat[p.idx];
      expect(b.pa, p.name).toBe(b.ab + b.bb + b.hbp + b.sf + b.sac);
      expect(b.h).toBeLessThanOrEqual(b.ab);
      expect(b.d + b.t + b.hr).toBeLessThanOrEqual(b.h);
    }
  });

  it('타자 쪽 합계와 투수 쪽 합계가 같다', () => {
    const B = result.bat.reduce((s, b) => ({ pa: s.pa + b.pa, h: s.h + b.h, hr: s.hr + b.hr, bb: s.bb + b.bb, so: s.so + b.so, r: s.r + b.r }),
      { pa: 0, h: 0, hr: 0, bb: 0, so: 0, r: 0 });
    const P = result.pit.reduce((s, p) => ({ pa: s.pa + p.bf, h: s.h + p.h, hr: s.hr + p.hr, bb: s.bb + p.bb, so: s.so + p.so, r: s.r + p.r }),
      { pa: 0, h: 0, hr: 0, bb: 0, so: 0, r: 0 });
    expect(B).toEqual(P);
    expect(B.pa).toBe(result.totals.pa);
    expect(B.r).toBe(result.totals.r);
  });

  it('투수 기록이 말이 된다: 승패 합, 자책 ≤ 실점, 선발 등판 합', () => {
    const w = result.pit.reduce((s, p) => s + p.w, 0);
    const l = result.pit.reduce((s, p) => s + p.l, 0);
    const decided = result.totals.games - result.totals.ties;
    expect(w).toBe(decided);
    expect(l).toBe(decided);
    expect(result.pit.reduce((s, p) => s + p.gs, 0)).toBe(result.totals.games * 2);
    for (const p of result.pit) expect(p.er).toBeLessThanOrEqual(p.r);
    expect(result.pit.reduce((s, p) => s + p.outs, 0)).toBe(result.totals.outs);
  });

  it('투수는 타석에 서지 않고 야수는 마운드에 서지 않는다', () => {
    for (const p of world.players) {
      if (p.isPitcher) expect(result.bat[p.idx].pa).toBe(0);
      else expect(result.pit[p.idx].bf).toBe(0);
    }
  });

  it('1군 엔트리가 규정을 지킨다: 인원, 외국인 보유 한도(2025년 3명), 선발 5명, 라인업 9명', () => {
    const st = newPlayerStates(world.players.length);
    for (const team of world.teams) {
      const ts: TeamSeason = { team, hitters: [], rotation: [], bullpen: [], closer: null, nextReturnDay: 0, dirty: true };
      refreshActive(ts, world, st, 0);
      const active = [...ts.hitters, ...ts.rotation, ...ts.bullpen];
      expect(new Set(active.map((p) => p.idx)).size, team.name).toBe(active.length);
      expect(active.length, team.name).toBeLessThanOrEqual(world.rules.rosterSize);
      expect(active.filter((p) => p.foreign).length, team.name).toBeLessThanOrEqual(world.rules.foreignLimit);
      expect(ts.rotation, team.name).toHaveLength(5);
      expect(ts.closer && ts.bullpen.includes(ts.closer), team.name).toBe(true);
      const lineup = assignLineup(ts.hitters);
      expect(new Set(lineup.map((p) => p.idx)).size, team.name).toBe(9);
      expect(lineup.every((p) => !p.isPitcher)).toBe(true);
    }
  });

  it('야수가 거의 다 결장해도 라인업 9명을 채운다', () => {
    const st = newPlayerStates(world.players.length);
    const team = world.teams[0];
    for (const p of team.org) if (!p.isPitcher) st.absentUntil[p.idx] = 50;
    const ts: TeamSeason = { team, hitters: [], rotation: [], bullpen: [], closer: null, nextReturnDay: 0, dirty: true };
    refreshActive(ts, world, st, 0);
    expect(assignLineup(ts.hitters)).toHaveLength(9);
  });

  it('같은 시드는 같은 결과를 낸다', () => {
    const again = simulateSeason(world, FAST, 'test-seed');
    expect(again.teams).toEqual(result.teams);
    expect(again.totals).toEqual(result.totals);
    expect(again.bat).toEqual(result.bat);
    expect(again.pit).toEqual(result.pit);
  });

  it('다른 시드는 다른 결과를 낸다', () => {
    const other = simulateSeason(world, FAST, 'test-seed-2');
    expect(other.teams).not.toEqual(result.teams);
  });

  it('리그 평균이 그 해 실제 값 근처다 (한 시즌이라 넉넉한 범위)', () => {
    const T = result.totals;
    const L = store.season(2025)!.league;
    expect(T.h / T.ab).toBeGreaterThan(L.avg * 0.93);
    expect(T.h / T.ab).toBeLessThan(L.avg * 1.07);
    const runs = T.r / (T.games * 2);
    expect(runs).toBeGreaterThan(L.runsPerTeamGame * 0.85);
    expect(runs).toBeLessThan(L.runsPerTeamGame * 1.15);
  });
});

describe('다른 시대', () => {
  it.each([1985, 1999, 2008, 2013, 2026])('%i년 시즌이 오류 없이 끝난다', (year) => {
    const w = worldForYear(store, year, FAST);
    const r = simulateSeason(w, FAST, `era-${year}`);
    for (const t of r.teams) expect(t.g).toBe(w.gamesPerTeam);
    expect(r.teams).toHaveLength(store.season(year)!.teams.length);
  });
});
