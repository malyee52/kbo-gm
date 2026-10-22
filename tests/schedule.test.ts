// 연전 단위 일정 생성기 (src/engine/schedule.ts). 일정 개편 기획안 8장 3단계, 7장 검증 기준
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { addDays, daysBetween, defaultOpening, divisionsOf, fitRuleToTeams, openingOf, scheduleRule, weekdayOf, type Divisions, type YearScheduleRule } from '../src/data/schedule';
import { DEFAULT_PARAMS, Season, worldForYear } from '../src/engine';
import { Rng } from '../src/engine/rng';
import { framedRule, generatePlan, homeHeavyTeams, MAX_AWAY_RUN, pickOpeningHosts, planForWorld, planProblems, type SchedulePlan, type ScheduleInput } from '../src/engine/schedule';
import { createLeague } from '../src/league/create';
import { divisionsFor } from '../src/league/eras';
import { postseasonStartDay } from '../src/league/postseason';
import { worldFromLeague } from '../src/league/world';

const store = loadDataStore();
const SEEDS = 50;
/** 3단계에서 만드는 틀 (S33·S33F)의 해 */
const S33_YEARS = [1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012];
const S33F_YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
const FRANCHISES_2026 = store.season(2026)!.teams.map((t) => t.franchise);

function inputFor(year: number, seed: string, extra: Partial<ScheduleInput> = {}): ScheduleInput {
  const rule = scheduleRule(store.schedule!, year)!;
  const sd = store.season(year);
  const franchises = sd ? sd.teams.map((t) => t.franchise) : FRANCHISES_2026;
  const divs = divisionsOf(sd, franchises);
  return {
    rule, teams: rule.teams ?? FRANCHISES_2026.length, franchises,
    ...(divs ? { divisions: divs.teams } : {}), rng: new Rng(seed), ...extra,
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

  it('아직 만들지 않은 연전 틀, 리그 나눔이 없는 1999, 구단 수가 다른 월드는 오류', () => {
    expect(() => generatePlan(inputFor(2019, 'x'))).toThrow(/연전 틀/);
    expect(() => generatePlan(inputFor(1999, 'x', { divisions: undefined }))).toThrow(/리그 나눔/);
    expect(() => generatePlan(inputFor(2026, 'x', { teams: 8 }))).toThrow(/구단/);
  });
});

// 4단계: 월드에 붙는 일정 규칙, 개막 홈 구단, Season이 쓰는 일정 (planForWorld)
describe('생성기 연결 (월드와 시즌)', () => {
  const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
  const w2026 = worldForYear(store, 2026, FAST);
  const w2019 = worldForYear(store, 2019, FAST);

  it('월드에 그 해 일정 규칙이 붙는다 (1999·2026, 자료 없는 해는 리그 상태 월드에서 2027~ 규칙)', () => {
    expect(worldForYear(store, 1999, FAST).schedule?.frame).toBe('S33-99');
    expect(w2026.schedule?.opening).toBe('2026-03-28');
    const { league } = createLeague(store, 2026, 'sched-world', FAST);
    const w2030 = worldFromLeague({ ...structuredClone(league), year: 2030 }, store, FAST);
    expect(w2030.schedule?.projected).toBe(true);
    expect(w2030.schedule?.opening).toBe(openingOf(2030));
    expect(weekdayOf(openingOf(2030))).toBe(6);
  });

  it('개막 홈 구단: 2015년부터 지난 시즌 상위 5팀, 잠실 두 팀이 겹치면 아래 순위 대신 6위', () => {
    const f = ['LG', '두산', '삼성', 'KIA', '롯데', '한화', 'SSG', 'NC', 'KT', '히어로즈'];
    expect(pickOpeningHosts(2014, [0, 1, 2, 3, 4, 5], f)).toBeUndefined();
    expect(pickOpeningHosts(2016, [2, 3, 4, 5, 6, 7], f)).toEqual([2, 3, 4, 5, 6]);
    expect(pickOpeningHosts(2016, [2, 0, 3, 1, 4, 5, 6], f)).toEqual([2, 0, 3, 4, 5]); // 두산(4위) 대신 6위 한화
    // 2026 시작: 2025 순위 LG·한화·SSG·삼성·NC
    const names = w2026.openingHosts!.map((i) => w2026.teams[i].franchise).sort();
    expect(names).toEqual(['LG', 'NC', 'SSG', '삼성', '한화'].sort());
    expect(worldForYear(store, 2012, FAST).openingHosts).toBeUndefined();
  });

  it('리그 상태 월드도 시작 연도에는 worldForYear와 같은 개막 홈 구단, 다음 해부터는 게임 순위로', () => {
    const { league, world } = createLeague(store, 2026, 'sched-hosts', FAST);
    expect(world.openingHosts).toEqual(w2026.openingHosts);
    const next = structuredClone(league);
    next.year = 2027;
    next.lastSeason = { year: 2026, teams: [], standings: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] };
    const w = worldFromLeague(next, store, FAST);
    expect(w.openingHosts).toEqual(pickOpeningHosts(2027, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], w.teams.map((t) => t.franchise)));
  });

  it('Season은 월드의 일정 규칙으로 만든 일정을 쓴다: 개막 연전은 개막 홈 구단 홈', () => {
    const s = Season.start(w2026, FAST, 'sched-season', { cal: { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 } });
    expect(s.plan).toMatchObject({ opening: '2026-03-28' });
    expect(s.schedule).toBe(s.plan.days);
    expect(s.schedule[0].map((g) => g.home).sort()).toEqual([...w2026.openingHosts!].sort());
    const games = new Array(10).fill(0);
    for (const d of s.schedule) for (const g of d) { games[g.home]++; games[g.away]++; }
    expect(games).toEqual(new Array(10).fill(144));
  });

  it('연전 틀이 아직 없는 해(2019 S33L2)는 같은 달력에 하루 한 경기씩: 개막일, 발표 일정의 월요일·쉬는 기간 경기 없음, 팀당 144경기', () => {
    expect(framedRule(w2019)).toBeUndefined();
    const p = planForWorld(w2019, new Rng('sched-2019'));
    expect(p.opening).toBe(w2019.schedule!.opening);
    const games = new Array(10).fill(0);
    // 월요일 경기는 우천 순연뿐 (발표 일정 planned에는 없다), 쉬는 기간에는 실제 일정에도 없다
    p.planned.forEach((d, i) => { if (weekdayOf(addDays(p.opening, i)) === 1) expect(d).toEqual([]); });
    p.days.forEach((d, i) => {
      const date = addDays(p.opening, i);
      if (w2019.schedule!.breaks.some((b) => b.from <= date && date <= b.to)) expect(d).toEqual([]);
      for (const g of d) { games[g.home]++; games[g.away]++; }
    });
    expect(games).toEqual(new Array(10).fill(144));
  });

  it('일정 규칙이 없는 월드는 기본 개막일(3월 넷째 토요일)에 하루 한 경기씩', () => {
    const p = planForWorld({ ...w2026, schedule: undefined, openingHosts: undefined }, new Rng('no-rule'));
    expect(p.opening).toBe(defaultOpening(2026));
    expect(p.days[0].length).toBe(5);
  });
});

// 5단계: 전 시대 틀 (W82·W83·T3W2·S2·S33-9), 1988 가을야구 시작, 2027~ 규칙과 구단 수가 10이 아닌 월드
describe('전 시대 연전 틀 (5단계)', () => {
  const OLD_YEARS = [1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989, 1990, 2013, 2014];
  const ruleOf = (y: number) => scheduleRule(store.schedule!, y)!;
  const wd = (y: number, i: number) => weekdayOf(dateOf(ruleOf(y), i));
  /** 상대별 연전 길이 목록 (짧은 것부터) */
  const pairLens = (p: SchedulePlan, a: number, b: number) =>
    p.series.filter((x) => (x.home === a && x.away === b) || (x.home === b && x.away === a)).map((x) => x.len).sort((x, y) => x - y);

  it('1982~2027 모든 해 × 50시드: 실패 없이 만들어지고 팀당 경기 수가 규칙 표와 같다 (하루씩 해 포함)', () => {
    for (let y = 1982; y <= 2027; y++) {
      const rule = ruleOf(y);
      const franchises = store.season(y)?.teams.map((t) => t.franchise) ?? FRANCHISES_2026;
      const divisions = divisionsOf(store.season(y), franchises) ?? undefined;
      const world = { year: y, teams: franchises.map((franchise) => ({ franchise })), gamesPerTeam: rule.games, schedule: rule, divisions } as unknown as Parameters<typeof planForWorld>[0];
      for (let s = 0; s < SEEDS; s++) {
        const p = planForWorld(world, new Rng(`all-${y}-${s}`));
        const games = new Array(franchises.length).fill(0);
        for (const d of p.days) for (const g of d) { games[g.home]++; games[g.away]++; }
        expect(games, `${y}/${s}`).toEqual(new Array(franchises.length).fill(rule.games));
      }
    }
  });

  it('새 틀 해 × 50시드: 검사 통과, 상대별 경기 수 정확, 팀당 홈 수가 시즌 자료와 ±2 안', () => {
    for (const y of OLD_YEARS) {
      const input = inputFor(y, 'x');
      const n = input.teams;
      const sd = store.season(y)!;
      expect(framedRule({ teams: sd.teams as never, gamesPerTeam: input.rule.games, schedule: input.rule }), `${y}`).toBeDefined();
      for (let s = 0; s < SEEDS; s++) {
        const p = plan(y, s);
        expect(planProblems(p, inputFor(y, `sched-${s}`)), `${y}/${s}`).toEqual([]);
        const m = meetings(p, n);
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) expect(m[a][b] + m[b][a], `${y}/${s} ${a}-${b}`).toBe(input.rule.vs);
        sd.teams.forEach((t, i) => {
          const real = t.home.split('-').map(Number).reduce((x, z) => x + z, 0);
          expect(Math.abs(m[i].reduce((x, z) => x + z, 0) - real), `${y}/${s} ${t.name}`).toBeLessThanOrEqual(2);
        });
      }
    }
  });

  it('연전 구성: T3W2 3×4 + 2×4(1985 2×5), S33-9 3×4 + 2×2, S2는 모두 2연전 (상대별 홈 10·8 또는 10·10)', () => {
    for (const y of OLD_YEARS.filter((x) => x >= 1984)) {
      const input = inputFor(y, 'x');
      const n = input.teams;
      const s2 = input.rule.frame === 'S2';
      const want = s2 ? new Array(input.rule.vs / 2).fill(2) : [...new Array((input.rule.vs - 12) / 2).fill(2), 3, 3, 3, 3];
      for (let s = 0; s < SEEDS; s += 5) {
        const p = plan(y, s);
        const m = meetings(p, n);
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            expect(pairLens(p, a, b), `${y}/${s} ${a}-${b}`).toEqual(want);
            if (s2) expect([m[a][b], m[b][a]].sort((x, z) => x - z), `${y} ${a}-${b}`).toEqual(input.rule.vs === 18 ? [8, 10] : [10, 10]);
          }
        }
        if (s2) expect(p.series.every((x) => x.len === 2)).toBe(true);
      }
    }
  });

  it('홀수 구단(S2 7구단, S33-9 9구단)은 연전 칸마다 한 팀이 쉰다', () => {
    for (const y of [1986, 1990, 2013]) {
      const p = plan(y, 0);
      const n = inputFor(y, 'x').teams;
      for (const day of new Set(p.series.map((x) => x.day))) expect(p.series.filter((x) => x.day === day).length, `${y} ${day}`).toBe((n - 1) / 2);
    }
  });

  it('요일: W82는 수·(목)·토·일, W83·T3W2는 화·수·(목)·토·일 (금요일 쉼). W82·W83의 목요일은 앞에서부터 연다', () => {
    const allowed: Record<number, number[]> = { 1982: [3, 4, 6, 0], 1983: [2, 3, 4, 6, 0], 1984: [2, 3, 4, 6, 0], 1985: [2, 3, 4, 6, 0] };
    for (const y of [1982, 1983, 1984, 1985]) {
      for (let s = 0; s < SEEDS; s += 5) plan(y, s).days.forEach((g, i) => { if (g.length) expect(allowed[y], `${y}/${s} ${dateOf(ruleOf(y), i)}`).toContain(wd(y, i)); });
    }
    for (const y of [1982, 1983]) {
      const rule = ruleOf(y);
      const p = plan(y, 0);
      const thu = p.days.map((g, i) => (g.length && wd(y, i) === 4 ? i : -1)).filter((i) => i >= 0);
      expect(thu.length, `${y}`).toBeGreaterThan(0);
      // 마지막으로 연 목요일 앞의 경기 있는 수요일은, 다음 날이 쉬는 기간이 아니면 모두 목요일도 경기
      for (let i = 0; i < thu[thu.length - 1]; i++) {
        const next = dateOf(rule, i + 1);
        if (wd(y, i) === 3 && p.days[i].length && !rule.breaks.some((b) => b.from <= next && next <= b.to)) expect(p.days[i + 1].length, `${y} ${next}`).toBeGreaterThan(0);
      }
    }
  });

  it('S33-9: 2연전 주(화·수 / 목·금 / 토·일)는 올스타 휴식 뒤에 온다', () => {
    for (const y of [2013, 2014]) {
      const rule = ruleOf(y);
      const b = rule.breaks.find((x) => x.reason === '올스타')!;
      const thuTwo = plan(y, 0).series.filter((x) => x.len === 2 && wd(y, x.day) === 4).map((x) => dateOf(rule, x.day));
      expect(thuTwo.length, `${y}`).toBeGreaterThan(0);
      expect(thuTwo.every((d) => d > b.to), `${y}`).toBe(true);
    }
  });

  it('마지막 경기: 1982~1990·2013~2014는 참고 종료일 전, 6주 안 (우천 없음)', () => {
    for (const y of OLD_YEARS) {
      const rule = ruleOf(y);
      for (let s = 0; s < SEEDS; s += 5) {
        const end = dateOf(rule, plan(y, s).days.length - 1);
        expect(end <= rule.endRef!, `${y}/${s} ${end}`).toBe(true);
        expect(end >= addDays(rule.endRef!, -42), `${y}/${s} ${end}`).toBe(true);
      }
    }
  });

  it('1988 가을야구는 규칙 표의 시작일(10월 8일), 다른 해는 정규시즌 끝 + 3일', () => {
    for (const y of [1988, 1989]) {
      const p = plan(y, 0);
      const day = postseasonStartDay({ schedule: p.days, plan: p, world: { schedule: ruleOf(y) } } as never);
      if (y === 1988) expect(addDays(p.opening, day)).toBe('1988-10-08');
      else expect(day).toBe(p.days.length + 3);
    }
  });

  it('2027~ 규칙: 10구단은 그대로, 구단 수가 다르면 상대별 경기를 144경기에 가장 가깝게 다시 나눈다', () => {
    const r = ruleOf(2030);
    expect(fitRuleToTeams(r, 10)).toBe(r);
    expect(fitRuleToTeams(r, 11)).toMatchObject({ vs: 14, games: 140, unscheduled: 10 });
    expect(fitRuleToTeams(r, 9)).toMatchObject({ vs: 18, games: 144, unscheduled: 8 });
    expect(fitRuleToTeams(r, 12)).toMatchObject({ vs: 13, games: 143, unscheduled: 11 });
    // 자료가 있는 해는 구단 수가 정해져 있어 그대로
    const r2026 = ruleOf(2026);
    expect(fitRuleToTeams(r2026, 11)).toBe(r2026);
  });

  it('11구단 가상 월드 (2030): 팀당 140경기, 연전 생성기로 상대별 14경기·검사 통과', () => {
    const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
    const { league } = createLeague(store, 2026, 'sched-11', FAST);
    const next = structuredClone(league);
    next.year = 2030;
    next.lastSeason = null;
    next.teams.push({ name: '가상', franchise: '가상' } as never);
    // 기존 구단마다 투수 2명·야수 2명을 새 구단으로
    for (let t = 0; t < 10; t++) {
      for (const pit of [true, false]) next.players.filter((p) => p.team === t && p.isPitcher === pit).slice(0, 2).forEach((p) => { p.team = 10; });
    }
    const w = worldFromLeague(next, store, FAST);
    expect(w.teams.length).toBe(11);
    expect(w.gamesPerTeam).toBe(140);
    expect(w.schedule).toMatchObject({ vs: 14, games: 140, frame: 'S33F' });
    expect(framedRule(w)).toBeDefined();
    for (let s = 0; s < 10; s++) {
      const p = planForWorld(w, new Rng(`eleven-${s}`));
      expect(planProblems(p, { rule: w.schedule!, teams: 11, franchises: w.teams.map((t) => t.franchise), rng: new Rng('x') }, { rain: true }), `${s}`).toEqual([]);
      const m = meetings(p, 11);
      for (let a = 0; a < 11; a++) {
        for (let b = a + 1; b < 11; b++) expect(m[a][b] + m[b][a]).toBe(14);
        expect(m[a].reduce((x, z) => x + z, 0) + m.reduce((x, row) => x + row[a], 0)).toBe(140);
      }
    }
  });
});

// 6단계: 1999·2000 드림·매직 양대 리그 (기획안 10장 A1·A2)
describe('양대 리그 나눔 (A1)', () => {
  const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
  /** 리그별 계보 이름 (리그 이름 순) */
  const byName = (w: { teams: { franchise: string }[]; divisions?: Divisions }) =>
    w.divisions ? w.divisions.teams.map((ts) => ts.map((i) => w.teams[i].franchise).sort()) : null;

  it('1999·2000은 기획안 10.2 표대로, 1998·2001은 단일 리그', () => {
    const w1999 = worldForYear(store, 1999, FAST);
    expect(w1999.divisions?.names).toEqual(['드림', '매직']);
    expect(byName(w1999)).toEqual([['KIA', '두산', '롯데', '현대계'].sort(), ['LG', '삼성', '쌍방울', '한화'].sort()]);
    expect(byName(worldForYear(store, 2000, FAST))).toEqual([['KIA', '두산', '삼성', '현대계'].sort(), ['LG', 'SSG', '롯데', '한화'].sort()]);
    expect(worldForYear(store, 1998, FAST).divisions).toBeUndefined();
    expect(worldForYear(store, 2001, FAST).divisions).toBeUndefined();
  });

  it('리그 상태 월드: 1999 바로 시작과 1998 시작 → 1999가 같은 나눔, 2000은 쌍방울 → SK 승계 뒤 새 해 자료로', () => {
    const direct = worldFromLeague(createLeague(store, 1999, 'div', FAST).league, store, FAST);
    expect(byName(direct)).toEqual(byName(worldForYear(store, 1999, FAST)));
    const from1998 = structuredClone(createLeague(store, 1998, 'div', FAST).league);
    from1998.year = 1999;
    from1998.lastSeason = null;
    expect(byName(worldFromLeague(from1998, store, FAST))).toEqual(byName(direct));
    // 1999 리그를 2000으로: 승계 전(쌍방울 계보)은 자료와 맞지 않아 단일 리그, 승계 뒤에는 2000 나눔
    const to2000 = structuredClone(createLeague(store, 1999, 'div', FAST).league);
    to2000.year = 2000;
    to2000.lastSeason = null;
    const ssang = to2000.teams.findIndex((t) => t.franchise === '쌍방울');
    expect(divisionsFor(store, 2000, to2000.teams)).toBeNull();
    to2000.teams[ssang] = { ...to2000.teams[ssang], name: 'SK', franchise: 'SSG' };
    expect(byName(worldFromLeague(to2000, store, FAST))).toEqual(byName(worldForYear(store, 2000, FAST)));
  });

  it('계보가 하나라도 안 맞거나 구단 수가 다르면 단일 리그 (null)', () => {
    const f = store.season(1999)!.teams.map((t) => t.franchise);
    expect(divisionsOf(store.season(1999), f)).not.toBeNull();
    expect(divisionsOf(store.season(1999), [...f.slice(0, 7), '가상'])).toBeNull();
    expect(divisionsOf(store.season(1999), [...f, '가상'])).toBeNull();
    expect(divisionsOf(store.season(2026), FRANCHISES_2026)).toBeNull();
  });
});

describe('1999·2000 일정 (A2)', () => {
  const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
  const rule1999 = scheduleRule(store.schedule!, 1999)!;
  const divs1999 = divisionsOf(store.season(1999), store.season(1999)!.teams.map((t) => t.franchise))!.teams;
  const leagueOf = (divs: [number[], number[]]) => {
    const lg = new Array<number>(8);
    divs.forEach((d, k) => d.forEach((t) => { lg[t] = k; }));
    return lg;
  };
  const lg1999 = leagueOf(divs1999);

  it('1999 × 50시드: 검사 통과, 같은 리그 상대별 20(홈 10)·다른 리그 18(홈 9), 팀당 132·홈 66 (시즌 자료와 같다)', () => {
    const sd = store.season(1999)!;
    for (let s = 0; s < SEEDS; s++) {
      const p = plan(1999, s);
      expect(planProblems(p, inputFor(1999, `sched-${s}`)), `${s}`).toEqual([]);
      const m = meetings(p, 8);
      for (let a = 0; a < 8; a++) {
        for (let b = 0; b < 8; b++) if (a !== b) expect(m[a][b], `${s} ${a}-${b}`).toBe(lg1999[a] === lg1999[b] ? 10 : 9);
        expect(m[a].reduce((x, z) => x + z, 0) + m.reduce((x, row) => x + row[a], 0), `${s} ${a}`).toBe(132);
        const real = sd.teams[a].home.split('-').map(Number).reduce((x, z) => x + z, 0);
        expect(m[a].reduce((x, z) => x + z, 0), `${s} ${a}`).toBe(real);
      }
    }
  });

  it('1999 연전 구성: 같은 리그 3연전 4번 + 2연전 4번, 다른 리그 3연전 6번', () => {
    for (let s = 0; s < SEEDS; s += 5) {
      const p = plan(1999, s);
      for (let a = 0; a < 8; a++) {
        for (let b = a + 1; b < 8; b++) {
          const lens = p.series.filter((x) => (x.home === a && x.away === b) || (x.home === b && x.away === a)).map((x) => x.len).sort();
          expect(lens, `${s} ${a}-${b}`).toEqual(lg1999[a] === lg1999[b] ? [2, 2, 2, 2, 3, 3, 3, 3] : [3, 3, 3, 3, 3, 3]);
        }
      }
    }
  });

  it('1999: 마지막 2주(본 일정 끝 14일)에 다른 리그 경기 0, 전반기 2연전은 개막 주말뿐, 2연전 주는 올스타 뒤', () => {
    const allStar = rule1999.breaks.find((b) => b.reason === '올스타')!;
    for (let s = 0; s < SEEDS; s++) {
      const p = plan(1999, s);
      for (let i = p.mainEnd - 13; i <= p.mainEnd; i++) {
        for (const g of p.days[i]) expect(lg1999[g.home], `${s} ${dateOf(rule1999, i)}`).toBe(lg1999[g.away]);
      }
      const firstHalfTwo = p.series.filter((x) => x.len === 2 && dateOf(rule1999, x.day) < allStar.from);
      expect(firstHalfTwo.every((x) => x.day === 0), `${s}`).toBe(true);
      expect(firstHalfTwo.length, `${s}`).toBe(4); // 개막 토·일: 두 리그 같은 리그 2연전
      for (const x of firstHalfTwo) expect(lg1999[x.home], `${s}`).toBe(lg1999[x.away]);
      // 2연전 주(목·금 2연전)는 올스타 휴식 뒤
      const thuTwo = p.series.filter((x) => x.len === 2 && weekdayOf(dateOf(rule1999, x.day)) === 4);
      expect(thuTwo.length, `${s}`).toBeGreaterThan(0);
      expect(thuTwo.every((x) => dateOf(rule1999, x.day) > allStar.to), `${s}`).toBe(true);
    }
  });

  it('1999: 마지막 경기가 참고 종료일(9월 19일) 전, 6주 안 (우천 없음)', () => {
    for (let s = 0; s < SEEDS; s += 5) {
      const end = dateOf(rule1999, plan(1999, s).days.length - 1);
      expect(end <= rule1999.endRef!, `${s} ${end}`).toBe(true);
      expect(end >= addDays(rule1999.endRef!, -42), `${s} ${end}`).toBe(true);
    }
  });

  it('2000 × 50시드: 상대별 19, 홈 67이 리그마다 두 팀 (남는 1경기는 잔여 경기)', () => {
    const sd = store.season(2000)!;
    const lg = leagueOf(divisionsOf(sd, sd.teams.map((t) => t.franchise))!.teams);
    for (let s = 0; s < SEEDS; s++) {
      const p = plan(2000, s);
      expect(planProblems(p, inputFor(2000, `sched-${s}`)), `${s}`).toEqual([]);
      const m = meetings(p, 8);
      for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) expect(m[a][b] + m[b][a], `${s} ${a}-${b}`).toBe(19);
      const heavy = m.map((row, i) => (row.reduce((x, z) => x + z, 0) === 67 ? i : -1)).filter((i) => i >= 0);
      expect(heavy.length, `${s}`).toBe(4);
      expect(heavy.filter((i) => lg[i] === 0).length, `${s}`).toBe(2);
    }
  });

  it('2000 홈 배분: 홀짝 규칙이 한 리그로 몰리는 구단 순서(1982 시작 리그 등)면 리그 안에서 다시 골라 리그마다 두 팀', () => {
    const r2000 = scheduleRule(store.schedule!, 2000)!;
    // 자료 순서(리그가 0~3·4~7)는 홀짝 규칙 그대로
    expect(homeHeavyTeams(r2000, 8, undefined, [[0, 1, 2, 3], [4, 5, 6, 7]])).toEqual(homeHeavyTeams(r2000, 8));
    // 짝수 색인이 모두 한 리그면 리그마다 둘
    const divs: [number[], number[]] = [[0, 2, 4, 6], [1, 3, 5, 7]];
    expect(homeHeavyTeams(r2000, 8)).toEqual([0, 2, 4, 6]);
    const heavy = homeHeavyTeams(r2000, 8, undefined, divs);
    expect(heavy.filter((t) => divs[0].includes(t)).length).toBe(2);
    expect(heavy.filter((t) => divs[1].includes(t)).length).toBe(2);
    for (let s = 0; s < 10; s++) {
      const input = { ...inputFor(2000, `mix-${s}`), divisions: divs };
      const p = generatePlan(input);
      expect(planProblems(p, input), `${s}`).toEqual([]);
      const m = meetings(p, 8);
      const h67 = m.map((row, i) => (row.reduce((x, z) => x + z, 0) === 67 ? i : -1)).filter((i) => i >= 0);
      expect(h67.filter((t) => divs[0].includes(t)).length, `${s}`).toBe(2);
    }
  });

  it('월드와 시즌: 1999 월드는 연전 생성기(S33-99), 리그 나눔이 없는 1999 월드는 하루 한 경기씩', () => {
    const w = worldForYear(store, 1999, FAST);
    expect(framedRule(w)?.frame).toBe('S33-99');
    // 시즌 일정: 개막 토·일은 두 리그 같은 리그 2연전 (하루씩 일정이면 둘째 날 대진이 다르다)
    const season = Season.start(w, FAST, 'div-1999', { cal: { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 } });
    const lg = leagueOf(w.divisions!.teams);
    expect(season.schedule[0].length).toBe(4);
    expect(season.schedule[1]).toEqual(season.schedule[0]);
    for (const g of season.schedule[0]) expect(lg[g.home]).toBe(lg[g.away]);
    const { divisions: _, ...single } = w;
    expect(framedRule(single)).toBeUndefined();
    const p = planForWorld(single, new Rng('single'));
    expect(p.series).toEqual([]);
    const games = new Array(8).fill(0);
    for (const d of p.days) for (const g of d) { games[g.home]++; games[g.away]++; }
    expect(games).toEqual(new Array(8).fill(132));
  });

  it('같은 시드 = 같은 1999 일정', () => {
    const a = generatePlan(inputFor(1999, 'same'));
    const b = generatePlan(inputFor(1999, 'same'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.days)).not.toBe(JSON.stringify(generatePlan(inputFor(1999, 'other')).days));
  });
});
