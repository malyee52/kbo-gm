// 날씨·우천 취소·순연 (src/engine/weather.ts). 일정 개편 기획안 4장, 8장 7단계 확인 칸
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { addDays, daysBetween, divisionsOf, scheduleRule, weekdayOf } from '../src/data/schedule';
import { DEFAULT_PARAMS, Season } from '../src/engine';
import { Rng } from '../src/engine/rng';
import { generatePlan, planForWorld, type SchedulePlan } from '../src/engine/schedule';
import { isNoGame, MAX_STREAK, parkWeather } from '../src/engine/weather';
import { createLeague } from '../src/league/create';
import { homeIsDome } from '../src/league/stadium';

const store = loadDataStore();
const FRANCHISES_2026 = store.season(2026)!.teams.map((t) => t.franchise);
const SEEDS = 10;

type W = Parameters<typeof planForWorld>[0];
const worlds = new Map<number, W>();
/** 그 해 시작 판 모양의 일정 월드 (구단 계보·그 해 실제 구장 돔·리그 나눔) */
function worldOf(y: number): W {
  if (!worlds.has(y)) {
    const rule = scheduleRule(store.schedule!, y)!;
    const franchises = store.season(y)?.teams.map((t) => t.franchise) ?? FRANCHISES_2026;
    const divisions = divisionsOf(store.season(y), franchises) ?? undefined;
    const teams = franchises.map((franchise) => ({ franchise, ...(homeIsDome(undefined, franchise, y) ? { dome: true } : {}) }));
    worlds.set(y, { year: y, teams, gamesPerTeam: rule.games, schedule: rule, divisions } as unknown as W);
  }
  return worlds.get(y)!;
}
const plans = new Map<string, SchedulePlan>();
function planOf(y: number, s: number): SchedulePlan {
  const k = `${y}/${s}`;
  if (!plans.has(k)) plans.set(k, planForWorld(worldOf(y), new Rng(`rain-${y}-${s}`)));
  return plans.get(k)!;
}
const YEARS = Array.from({ length: 2027 - 1982 + 1 }, (_, i) => 1982 + i);
const each = (fn: (y: number, s: number, p: SchedulePlan) => void) => {
  for (const y of YEARS) for (let s = 0; s < SEEDS; s++) fn(y, s, planOf(y, s));
};
const teamGames = (d: { home: number; away: number }[], t: number) => d.filter((g) => g.home === t || g.away === t).length;

describe('날씨와 우천 순연 (7단계)', () => {
  it('취소된 경기는 다시 편성되어 상대별·팀당 경기 수와 홈 수가 우천 없는 일정과 같다', () => {
    each((y, s, p) => {
      const n = worldOf(y).teams.length;
      const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      for (const d of p.days) for (const g of d) if (!isNoGame(g.rainInning)) m[g.home][g.away]++; // 노게임은 다시 치르는 경기가 따로 있다
      const rule = scheduleRule(store.schedule!, y)!;
      const games = m.map((row, a) => row.reduce((x, z) => x + z, 0) + m.reduce((x, r) => x + r[a], 0));
      expect(games, `${y}/${s}`).toEqual(new Array(n).fill(rule.games));
    });
    // 연전 틀 해는 생성기(우천 없음)와 대진·홈이 그대로
    const w = worldOf(2025);
    const p = planOf(2025, 0);
    const base = generatePlan({ rule: w.schedule!, teams: 10, franchises: w.teams.map((t) => t.franchise), openingHosts: w.openingHosts, rng: new Rng('rain-2025-0') });
    const key = (pl: SchedulePlan) => pl.days.flat().filter((g) => !isNoGame(g.rainInning)).map((g) => `${g.home}-${g.away}`).sort().join(',');
    expect(key(p)).toBe(key(base));
    expect(p.cancels.length).toBeGreaterThan(0);
    expect(p.planned).toEqual(base.planned);
  });

  it('취소 기록: 옮긴 날(뒤쪽)에 같은 홈·원정 경기가 있거나, 그날 또 취소됐다', () => {
    each((y, s, p) => {
      for (const [day, h, a, to] of p.cancels) {
        expect(to, `${y}/${s} ${day}`).toBeGreaterThan(day);
        const there = p.days[to]?.some((g) => g.home === h && g.away === a);
        const again = p.cancels.some((c) => c[0] === to && c[1] === h && c[2] === a);
        expect(there || again, `${y}/${s} ${day}→${to}`).toBe(true);
      }
    });
  });

  it('돔 구장(2016~ 고척) 홈 경기는 취소·경기 중 비가 없다', () => {
    let domeGames = 0;
    for (const y of [2016, 2020, 2025, 2026]) {
      const w = worldOf(y);
      const dome = w.teams.findIndex((t) => t.franchise === '히어로즈');
      expect(w.teams[dome].dome, `${y}`).toBe(true);
      for (let s = 0; s < SEEDS; s++) {
        const p = planOf(y, s);
        expect(p.cancels.filter((c) => c[1] === dome), `${y}/${s}`).toEqual([]);
        for (const d of p.days) for (const g of d) if (g.home === dome) { domeGames++; expect(g.rainInning).toBeUndefined(); }
      }
    }
    expect(domeGames).toBeGreaterThan(1000);
    // 리그 상태 월드도 시작 연도 실제 구장의 돔을 붙인다 (2015 목동은 돔 아님)
    const { world } = createLeague(store, 2025, 'dome', { ...DEFAULT_PARAMS, pilotSeasons: 0 });
    expect(world.teams.filter((t) => t.dome).map((t) => t.franchise)).toEqual(['히어로즈']);
    expect(homeIsDome(undefined, '히어로즈', 2015)).toBe(false);
  });

  it('쉬는 기간에는 경기가 없고, 한 팀 하루 두 경기는 같은 대진 더블헤더(1·2차전)뿐', () => {
    each((y, s, p) => {
      const rule = scheduleRule(store.schedule!, y)!;
      const n = worldOf(y).teams.length;
      p.days.forEach((d, i) => {
        const date = addDays(p.opening, i);
        if (rule.breaks.some((b) => b.from <= date && date <= b.to)) expect(d, `${y}/${s} ${date}`).toEqual([]);
        for (let t = 0; t < n; t++) {
          const mine = d.filter((g) => g.home === t || g.away === t);
          expect(mine.length, `${y}/${s} ${date}`).toBeLessThanOrEqual(2);
          if (mine.length === 2) {
            expect(mine.map((g) => g.dh).sort(), `${y}/${s} ${date}`).toEqual([1, 2]);
            expect(mine[0].home === mine[1].home && mine[0].away === mine[1].away).toBe(true);
          } else if (mine.length === 1) expect(mine[0].dh, `${y}/${s} ${date}`).toBeUndefined();
        }
        // 1차전 묶음 뒤에 2차전 묶음
        const firstTwo = d.findIndex((g) => g.dh === 2);
        if (firstTwo >= 0) expect(d.slice(firstTwo).every((g) => g.dh === 2)).toBe(true);
      });
    });
  });

  it('더블헤더: 금지 기간·월요일(2024~)·2주 연속(2025~)에 없고, 평일 더블헤더는 R1 해(1982~2005)와 2020(수·목)뿐. 2006~2007은 없음', () => {
    const weekday = new Set<number>();
    each((y, s, p) => {
      const rule = scheduleRule(store.schedule!, y)!;
      const n = worldOf(y).teams.length;
      const weeks = Array.from({ length: n }, () => new Set<number>());
      p.days.forEach((d, i) => {
        const date = addDays(p.opening, i);
        const w = weekdayOf(date);
        for (const g of d) {
          if (g.dh !== 2) continue;
          expect(rule.dhBan.some((b) => b.from <= date && date <= b.to), `${y}/${s} ${date}`).toBe(false);
          if (y >= 2006 && y <= 2007) throw new Error(`${y} 더블헤더 ${date}`);
          if (y >= 2024) expect(w, `${y}/${s} ${date}`).not.toBe(1);
          if (w >= 1 && w <= 5) {
            weekday.add(y);
            if (y === 2020) expect([3, 4]).toContain(w);
            else expect(rule.postpone, `${y}/${s} ${date}`).toBe('R1');
          }
          const wk = Math.floor(daysBetween('1970-01-05', date) / 7);
          for (const t of [g.home, g.away]) {
            if (y >= 2025) expect(weeks[t].has(wk - 1) || weeks[t].has(wk + 1), `${y}/${s} ${t} ${date}`).toBe(false);
            weeks[t].add(wk);
          }
        }
      });
    });
    expect(weekday.has(1995)).toBe(true);
  });

  it('2015~ 한 팀 9연전까지 (어린이날 월요일이 낀 주 빼고), 월요일 경기는 R2 2주·R3~R5 3주 연속 금지', () => {
    each((y, s, p) => {
      const rule = scheduleRule(store.schedule!, y)!;
      const n = worldOf(y).teams.length;
      for (let t = 0; t < n; t++) {
        const on = (i: number) => i >= 0 && i < p.days.length && teamGames(p.days[i], t) > 0;
        if (y >= 2015) {
          let run = 0;
          let kids = false;
          for (let i = 0; i <= p.days.length; i++) {
            if (on(i)) {
              run++;
              const date = addDays(p.opening, i);
              if (date.slice(5) === '05-05' && weekdayOf(date) === 1) kids = true;
            } else {
              if (!kids) expect(run, `${y}/${s} 팀 ${t} ${addDays(p.opening, i)}`).toBeLessThanOrEqual(MAX_STREAK);
              run = 0;
              kids = false;
            }
          }
        }
        const limit = rule.postpone === 'R2' ? 2 : ['R3', 'R4', 'R5'].includes(rule.postpone) ? 3 : 0;
        if (!limit) continue;
        p.days.forEach((_, i) => {
          if (weekdayOf(addDays(p.opening, i)) !== 1) return;
          let k = 0;
          while (on(i + 7 * k)) k++;
          expect(k, `${y}/${s} 팀 ${t} ${addDays(p.opening, i)}`).toBeLessThan(limit);
        });
      }
    });
  });

  it('경기 중 비: rainInning은 1~8회, 해마다 몇 경기씩 생긴다', () => {
    let mid = 0;
    each((_y, _s, p) => {
      for (const d of p.days) for (const g of d) {
        if (g.rainInning === undefined) continue;
        mid++;
        expect(g.rainInning).toBeGreaterThanOrEqual(1);
        expect(g.rainInning).toBeLessThanOrEqual(8);
      }
    });
    expect(mid).toBeGreaterThan(YEARS.length * SEEDS);
  });

  it('잔여 경기 발표가 있는 해(2015~): 발표일 색인이 있고, 발표 일정(planned)에는 순연·잔여 경기가 없다', () => {
    for (const y of [2015, 2019, 2023, 2025, 2027]) {
      const p = planOf(y, 0);
      const rule = scheduleRule(store.schedule!, y)!;
      expect(p.remainingFrom, `${y}`).toBeGreaterThanOrEqual(daysBetween(p.opening, rule.remainingFrom!));
      const planned = p.planned.flat().length;
      expect(planned).toBeLessThanOrEqual(p.days.flat().length);
      for (const [day, , , to] of p.cancels) if (day < p.remainingFrom && to >= p.planned.length) expect(to).toBeGreaterThan(p.remainingFrom);
    }
    // 발표일이 없는 해(R1·R2)는 본 일정 마지막 3주 전 (그때까지 시즌 끝 잔여 경기로 간 순연이 있을 때만, 8단계)
    for (let s = 0; s < SEEDS; s++) {
      const q = planOf(1995, s);
      expect(q.remainingFrom).toBe(q.held.length ? q.mainEnd - 21 : -1);
    }
  });

  it('같은 시드 = 같은 취소·순연, 다른 시드 = 다름. 날씨는 그 날 그 구장마다 정해진다', () => {
    const w = worldOf(2025);
    const a = planForWorld(w, new Rng('same-rain'));
    const b = planForWorld(w, new Rng('same-rain'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.cancels)).not.toBe(JSON.stringify(planForWorld(w, new Rng('other-rain')).cancels));
    const root = new Rng('x').fork('weather');
    expect(parkWeather(root, 100, '2025-07-01', 'LG')).toBe(parkWeather(root, 100, '2025-07-01', 'LG'));
  });

  it('더블헤더 1차전이 경기 전 취소면 2차전도 함께 취소 (같은 구장 비), 1차전을 치른 뒤 2차전만 취소는 그대로', () => {
    let both = 0;
    let secondOnly = 0;
    each((y, s, p) => {
      const root = new Rng(`rain-${y}-${s}`).fork('weather');
      const parks = worldOf(y).teams.map((t) => t.franchise);
      const seen = new Map<string, number>();
      for (const [d, h, a, , nogame] of p.cancels) {
        if (nogame) continue;
        const k = `${d}/${h}/${a}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      for (const [k, n] of seen) {
        const [d, h, a] = k.split('/').map(Number);
        const left = (p.days[d] ?? []).filter((g) => g.home === h && g.away === a);
        expect(n + left.length, `${y}/${s} ${k}`).toBeLessThanOrEqual(2);
        if (n === 2) both++;
        if (n === 1 && left.length) {
          // 남은 경기는 1차전이고 1차전은 경기 전 취소가 아니었다 (2차전 줄기에서만 취소)
          secondOnly++;
          expect(left[0].dh, `${y}/${s} ${k}`).toBeUndefined();
          expect(parkWeather(root, d, addDays(p.opening, d), parks[h], false), `${y}/${s} ${k}`).not.toBe(-1);
        }
      }
    });
    expect(both).toBeGreaterThan(0);
    expect(secondOnly).toBeGreaterThan(0);
  });

  it('일정 규칙이 없는 월드는 비가 없다', () => {
    const w = { ...worldOf(2025), schedule: undefined } as W;
    expect(planForWorld(w, new Rng('no-rule')).cancels).toEqual([]);
  });

  it('시즌: 더블헤더가 있는 해(1995)도 팀마다 규칙 표 경기 수를 치르고, 더블헤더 날 1군 연차는 하루', () => {
    const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
    const { world } = createLeague(store, 1995, 'dh-season', FAST);
    const season = Season.start(world, FAST, 'dh-season', { cal: { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 } });
    expect(season.plan.days.flat().some((g) => g.dh === 2)).toBe(true);
    while (!season.done) season.simulateDay();
    const r = season.result();
    for (const t of r.teams) expect(t.g).toBe(world.gamesPerTeam);
    const days = season.plan.days.filter((d) => d.length).length;
    const maxActive = Math.max(...season.activeDays);
    expect(maxActive).toBeLessThanOrEqual(days);
  });
});
