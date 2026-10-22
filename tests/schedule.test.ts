// 연전 단위 일정 생성기 (src/engine/schedule.ts). 일정 개편 기획안 8장 3단계, 7장 검증 기준
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { addDays, daysBetween, scheduleRule, weekdayOf, type YearScheduleRule } from '../src/data/schedule';
import { Rng } from '../src/engine/rng';
import { generatePlan, MAX_AWAY_RUN, planProblems, type SchedulePlan, type ScheduleInput } from '../src/engine/schedule';

const store = loadDataStore();
const SEEDS = 50;
/** 3단계에서 만드는 틀 (S33·S33F)의 해 */
const S33_YEARS = [1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012];
const S33F_YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
const FRANCHISES_2026 = store.season(2026)!.teams.map((t) => t.franchise);

function inputFor(year: number, seed: string, extra: Partial<ScheduleInput> = {}): ScheduleInput {
  const rule = scheduleRule(store.schedule!, year)!;
  const sd = store.season(year);
  return {
    rule, teams: rule.teams ?? FRANCHISES_2026.length,
    franchises: sd ? sd.teams.map((t) => t.franchise) : FRANCHISES_2026,
    rng: new Rng(seed), ...extra,
  };
}

const cache = new Map<string, SchedulePlan>();
function plan(year: number, s: number): SchedulePlan {
  const k = `${year}/${s}`;
  if (!cache.has(k)) cache.set(k, generatePlan(inputFor(year, `sched-${s}`)));
  return cache.get(k)!;
}

/** 상대별 홈 경기 수 meet[홈][원정] */
function meetings(p: SchedulePlan, n: number): number[][] {
  const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const d of p.days) for (const g of d) m[g.home][g.away]++;
  return m;
}

const dateOf = (rule: YearScheduleRule, i: number) => addDays(rule.opening, i);

describe('연전 단위 일정 생성기 (S33·S33F)', () => {
  it('모든 해 × 50시드: 검사를 통과하고 상대별·팀당 경기 수가 규칙 표와 같다', () => {
    for (const y of [...S33_YEARS, ...S33F_YEARS]) {
      const input = inputFor(y, 'x');
      const n = input.teams;
      for (let s = 0; s < SEEDS; s++) {
        const p = plan(y, s);
        expect(planProblems(p, inputFor(y, `sched-${s}`)), `${y} 시드 ${s}`).toEqual([]);
        const m = meetings(p, n);
        for (let a = 0; a < n; a++) {
          let games = 0;
          for (let b = 0; b < n; b++) {
            if (a === b) continue;
            expect(m[a][b] + m[b][a], `${y}/${s} ${a}-${b}`).toBe(input.rule.vs);
            games += m[a][b] + m[b][a];
          }
          expect(games, `${y}/${s} ${a}`).toBe(input.rule.games);
        }
      }
    }
  });

  it('홈·원정: 18차전 해는 63·63, 19차전 해는 67·66이 네 팀씩이고 해마다 바뀐다', () => {
    for (const y of S33_YEARS) {
      const input = inputFor(y, 'x');
      const p = plan(y, 0);
      const m = meetings(p, input.teams);
      const homes = m.map((row) => row.reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
      if (input.rule.vs === 18) expect(homes, `${y}`).toEqual(new Array(8).fill(63));
      else expect(homes, `${y}`).toEqual([66, 66, 66, 66, 67, 67, 67, 67]);
    }
    const heavy = (y: number) => meetings(plan(y, 0), 8).map((row) => row.reduce((a, b) => a + b, 0) === 67);
    expect(heavy(2001)).not.toEqual(heavy(2002));
  });

  it('홈·원정: 2023~는 상대별 9·7, 팀당 73·71이 시즌 자료(구단별 홈 성적)와 같다', () => {
    for (const y of [2023, 2024, 2025]) {
      const sd = store.season(y)!;
      const m = meetings(plan(y, 0), 10);
      sd.teams.forEach((t, i) => {
        const [w, d, l] = t.home.split('-').map(Number);
        expect(m[i].reduce((a, b) => a + b, 0), `${y} ${t.name}`).toBe(w + d + l);
      });
      for (let a = 0; a < 10; a++) for (let b = a + 1; b < 10; b++) expect([7, 9]).toContain(m[a][b]);
    }
  });

  it('홈·원정: 18·19차전 해의 팀당 홈 수가 시즌 자료와 ±2 안', () => {
    for (const y of S33_YEARS) {
      const sd = store.season(y)!;
      const m = meetings(plan(y, 0), sd.teams.length);
      sd.teams.forEach((t, i) => {
        const [w, d, l] = t.home.split('-').map(Number);
        expect(Math.abs(m[i].reduce((a, b) => a + b, 0) - (w + d + l)), `${y} ${t.name}`).toBeLessThanOrEqual(2);
      });
    }
  });

  it('연전 단위: 연전은 1~4일 한 구장, 3연전이 본 일정 연전의 90% 이상, 원정 연전은 3번 연속까지', () => {
    for (const y of [...S33_YEARS, ...S33F_YEARS]) {
      for (let s = 0; s < SEEDS; s += 5) {
        const p = plan(y, s);
        const n = inputFor(y, 'x').teams;
        for (const x of p.series) {
          expect(x.len >= 1 && x.len <= 4).toBe(true);
          for (let d = 0; d < x.len; d++) expect(p.days[x.day + d]).toContainEqual({ home: x.home, away: x.away });
        }
        const three = p.series.filter((x) => x.len === 3).length / p.series.length;
        expect(three, `${y}/${s}`).toBeGreaterThanOrEqual(0.9);
        for (let t = 0; t < n; t++) {
          let run = 0;
          for (const x of p.series) {
            if (x.away === t) run++;
            else if (x.home === t) run = 0;
            expect(run, `${y}/${s} 구단 ${t}`).toBeLessThanOrEqual(MAX_AWAY_RUN);
          }
        }
        // 본 일정 날짜의 경기는 모두 연전에서 나온다
        const fromSeries = p.series.reduce((a, x) => a + x.len, 0);
        const mainGames = p.days.slice(0, p.mainEnd + 1).reduce((a, d) => a + d.length, 0);
        expect(mainGames, `${y}/${s}`).toBe(fromSeries);
      }
    }
  });

  it('월요일(어린이날 빼고)·쉬는 기간(올스타 휴식·국제대회)에는 경기가 없고, 하루에 한 팀 한 경기', () => {
    for (const y of [...S33_YEARS, ...S33F_YEARS]) {
      const rule = scheduleRule(store.schedule!, y)!;
      for (let s = 0; s < SEEDS; s += 5) {
        plan(y, s).days.forEach((games, i) => {
          if (!games.length) return;
          const d = dateOf(rule, i);
          if (weekdayOf(d) === 1) expect(d.slice(5), `${y}/${s} ${d}`).toBe('05-05');
          for (const b of rule.breaks) expect(d >= b.from && d <= b.to, `${y}/${s} ${d} ${b.reason}`).toBe(false);
          const teams = games.flatMap((g) => [g.home, g.away]);
          expect(new Set(teams).size, `${y}/${s} ${d}`).toBe(teams.length);
        });
      }
    }
  });

  it('어린이날이 월요일인 해(2008·2025)는 그날 경기가 있다', () => {
    for (const y of [2008, 2025]) {
      const rule = scheduleRule(store.schedule!, y)!;
      expect(plan(y, 0).days[daysBetween(rule.opening, `${y}-05-05`)].length, `${y}`).toBeGreaterThan(0);
    }
  });

  it('올스타 휴식: 올스타 휴식 기간에 경기가 없고, 휴식 앞뒤로는 경기가 있다', () => {
    for (const y of [...S33_YEARS, ...S33F_YEARS]) {
      const rule = scheduleRule(store.schedule!, y)!;
      const b = rule.breaks.find((x) => x.reason === '올스타')!;
      const p = plan(y, 0);
      const from = daysBetween(rule.opening, b.from);
      // 바로 이어지는 쉬는 기간(2008 올림픽)까지
      let to = daysBetween(rule.opening, b.to);
      for (const x of rule.breaks) if (daysBetween(rule.opening, x.from) === to + 1) to = daysBetween(rule.opening, x.to);
      for (let i = from; i <= to; i++) expect(p.days[i], `${y} ${dateOf(rule, i)}`).toEqual([]);
      expect(p.days.slice(Math.max(0, from - 4), from).some((d) => d.length), `${y} 휴식 앞`).toBe(true);
      expect(p.days.slice(to + 1, to + 5).some((d) => d.length), `${y} 휴식 뒤`).toBe(true);
    }
  });

  it('개막: 토요일 개막은 토·일 2연전, 금요일 개막은 금~일 3연전', () => {
    for (const y of [...S33_YEARS, ...S33F_YEARS]) {
      const rule = scheduleRule(store.schedule!, y)!;
      const p = plan(y, 0);
      const first = p.series.filter((x) => x.day === 0);
      expect(first.length, `${y}`).toBe(Math.floor(inputFor(y, 'x').teams / 2));
      const w = weekdayOf(rule.opening);
      if (w === 6) expect(first.every((x) => x.len === 2), `${y}`).toBe(true);
      if (w === 5) expect(first.every((x) => x.len === 3), `${y}`).toBe(true);
    }
  });

  it('S33F: 올스타 휴식이 수요일에 끝나는 해는 목~일 4연전이고, 개막 2연전과 같은 상대 (둘이 3연전 두 개 몫)', () => {
    for (const y of [2025, 2026, 2027, 2028]) {
      const rule = scheduleRule(store.schedule!, y)!;
      const b = rule.breaks.find((x) => x.reason === '올스타')!;
      expect(weekdayOf(b.to), `${y}`).toBe(3);
      for (let s = 0; s < SEEDS; s += 5) {
        const p = plan(y, s);
        const after = daysBetween(rule.opening, b.to) + 1;
        const four = p.series.filter((x) => x.day === after);
        expect(four.length).toBe(5);
        expect(four.every((x) => x.len === 4), `${y}/${s}`).toBe(true);
        const pair = (x: { home: number; away: number }) => [x.home, x.away].sort((a, c) => a - c).join('-');
        const opening = p.series.filter((x) => x.day === 0).map(pair).sort();
        expect(four.map(pair).sort(), `${y}/${s}`).toEqual(opening);
        // 개막 2연전 상대와는 잔여 경기 1경기 말고 모두 본 일정 (2 + 4 + 3×3 = 15)
        const m = meetings({ ...p, days: p.days.slice(0, p.mainEnd + 1) }, 10);
        for (const x of four) expect(m[x.home][x.away] + m[x.away][x.home]).toBe(15);
      }
    }
  });

  it('잔여 경기: S33F는 상대별 1경기(팀당 9경기)가 본 일정 뒤, 발표일 전 발표 일정에는 없다', () => {
    for (const y of S33F_YEARS) {
      const rule = scheduleRule(store.schedule!, y)!;
      const p = plan(y, 0);
      const tail = p.days.slice(p.mainEnd + 1).flat();
      expect(tail.length, `${y}`).toBeGreaterThanOrEqual(45);
      expect(p.remainingFrom).toBeGreaterThanOrEqual(daysBetween(rule.opening, rule.remainingFrom!));
      expect(p.remainingFrom).toBeLessThan(p.mainEnd);
      expect(p.planned.length).toBe(p.mainEnd + 1);
      expect(p.planned).toEqual(p.days.slice(0, p.mainEnd + 1));
    }
    // 잔여 발표가 없는 해(2014년 이전)는 개막 때 발표한 일정이 전부다
    const p = plan(2010, 0);
    expect(p.remainingFrom).toBe(-1);
    expect(p.planned).toEqual(p.days);
    expect(p.days.slice(p.mainEnd + 1).flat().length).toBeGreaterThanOrEqual(28); // 19차전의 남는 1경기 × 28쌍
  });

  it('종료일: 본 일정이 9월 안에 끝나고 잔여까지 10월 안 (우천 없음)', () => {
    for (const y of [...S33_YEARS, ...S33F_YEARS]) {
      const rule = scheduleRule(store.schedule!, y)!;
      const p = plan(y, 0);
      const end = dateOf(rule, p.days.length - 1);
      expect(end < `${y}-10-31`, `${y} ${end}`).toBe(true);
      expect(dateOf(rule, p.mainEnd) > `${y}-08-15`, `${y}`).toBe(true);
    }
  });

  it('개막 홈 구단을 주면 개막 연전은 그 구단 홈이다', () => {
    const hosts = [1, 3, 4, 7, 9];
    for (let s = 0; s < 10; s++) {
      const p = generatePlan(inputFor(2026, `host-${s}`, { openingHosts: hosts }));
      const first = p.series.filter((x) => x.day === 0);
      expect(first.map((x) => x.home).sort((a, b) => a - b)).toEqual(hosts);
    }
  });

  it('같은 시드 = 같은 일정, 다른 시드 = 다른 일정', () => {
    const a = generatePlan(inputFor(2026, 'same'));
    const b = generatePlan(inputFor(2026, 'same'));
    const c = generatePlan(inputFor(2026, 'other'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.days)).not.toBe(JSON.stringify(c.days));
  });

  it('아직 만들지 않은 연전 틀과 구단 수가 다른 월드는 오류', () => {
    expect(() => generatePlan(inputFor(1986, 'x'))).toThrow(/연전 틀/);
    expect(() => generatePlan(inputFor(2026, 'x', { teams: 8 }))).toThrow(/구단/);
  });
});
