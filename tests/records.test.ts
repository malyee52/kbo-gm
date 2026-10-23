// 기록 규정 연표 (경기 엔진 2 14단계, engine/records.ts, docs/경기엔진2_기획안.md 3.10.1): 연장 이닝·무승부·승률, 세이브 조건
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, rankTeams, Season, winPctBy, worldForYear } from '../src/engine';
import { dateOfDay, postseasonMaxInnings, regularMaxInnings, winPctRuleOf } from '../src/engine/records';
import { earnsSave } from '../src/engine/state';
import { emptyTeamRecord, type TeamRecord } from '../src/engine/types';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const store = loadDataStore();
const rules = (y: number) => store.meta.rules[String(y)];
const rec = (w: number, l: number, t: number): TeamRecord => ({ ...emptyTeamRecord(), g: w + l + t, w, l, t });

describe('연장·무승부·승률 연표 (meta.json rules)', () => {
  it('정규시즌 최대 이닝: 15회(~2002) → 12회(2003~2007) → 무제한(2008) → 12회(2009~2024) → 11회(2025~)', () => {
    const want = (y: number) => (y <= 2002 ? 15 : y === 2008 ? 0 : y <= 2024 ? 12 : 11);
    for (const y of store.meta.years) expect(rules(y).maxInnings, String(y)).toBe(want(y));
  });

  it('포스트시즌 최대 이닝: 15회, 2003·2004 12회, 2008 무제한', () => {
    for (const y of store.meta.years) {
      expect(postseasonMaxInnings(rules(y)), String(y)).toBe(y === 2008 ? 0 : y === 2003 || y === 2004 ? 12 : 15);
    }
    expect(postseasonMaxInnings(undefined)).toBe(15);
  });

  it('승률 방식: 1987~1997 무승부 0.5승, 2003~2004 다승제, 2009~2010 무승부 = 패, 나머지 승 ÷ (승+패)', () => {
    const want = (y: number) => (y >= 1987 && y <= 1997 ? 'half' : y === 2003 || y === 2004 ? 'wins' : y === 2009 || y === 2010 ? 'tieLoss' : 'wl');
    for (const y of store.meta.years) expect(winPctRuleOf(rules(y)), String(y)).toBe(want(y));
  });

  it('출처가 갈리는 해는 표시가 남는다 (2003 정규·포스트시즌, 2008 포스트시즌)', () => {
    expect(rules(2003).maxInningsSource).toBe('disputed');
    expect(rules(2003).postseasonMaxInningsSource).toBe('disputed');
    expect(rules(2008).postseasonMaxInningsSource).toBe('disputed');
    expect(rules(2008).maxInningsSource).toBe('confirmed');
  });

  it('9회 규정: 2020 월요일·더블헤더, 2021 8월 10일부터 모든 경기', () => {
    const r20 = rules(2020);
    expect(regularMaxInnings(r20, { md: 512, weekday: 1 })).toBe(9);
    expect(regularMaxInnings(r20, { md: 512, weekday: 2, doubleheader: true })).toBe(9);
    expect(regularMaxInnings(r20, { md: 512, weekday: 2 })).toBe(12);
    const r21 = rules(2021);
    expect(regularMaxInnings(r21, { md: 809, weekday: 1 })).toBe(12);
    expect(regularMaxInnings(r21, { md: 810, weekday: 2 })).toBe(9);
    expect(regularMaxInnings(r21, { md: 1001, weekday: 5 })).toBe(9);
    expect(regularMaxInnings(rules(2025), { md: 810, weekday: 1, doubleheader: true })).toBe(11);
  });

  it('일정 색인 0은 3월 24일 이후 첫 화요일', () => {
    expect(dateOfDay(2026, 0)).toEqual({ year: 2026, month: 3, date: 24, weekday: 2 });
    expect(dateOfDay(2021, 0)).toEqual({ year: 2021, month: 3, date: 30, weekday: 2 });
    expect(dateOfDay(2021, 6).weekday).toBe(1);
  });
});

describe('승률·순위의 무승부 처리', () => {
  it('승률 계산', () => {
    const t = rec(60, 50, 10);
    expect(winPctBy(t, 'wl')).toBeCloseTo(60 / 110, 12);
    expect(winPctBy(t, 'wins')).toBeCloseTo(60 / 110, 12);
    expect(winPctBy(t, 'half')).toBeCloseTo(65 / 120, 12);
    expect(winPctBy(t, 'tieLoss')).toBeCloseTo(60 / 120, 12);
    expect(winPctBy(rec(0, 0, 0), 'half')).toBe(0);
  });

  it('다승제는 승수가 먼저, 무승부 = 패는 무승부가 많은 쪽이 밀린다', () => {
    // A 70승 60패 14무 (승률 0.538), B 72승 66패 6무 (승률 0.522)
    const teams = [rec(70, 60, 14), rec(72, 66, 6)];
    expect(rankTeams(teams, 'wl')).toEqual([0, 1]);
    expect(rankTeams(teams, 'wins')).toEqual([1, 0]);
    // 무승부 = 패: A 70/144 = 0.486, B 72/144 = 0.5
    expect(rankTeams(teams, 'tieLoss')).toEqual([1, 0]);
    // 0.5승: A 77/144, B 75/144
    expect(rankTeams(teams, 'half')).toEqual([0, 1]);
  });
});

describe('세이브 조건 (기록 규정 ①②③)', () => {
  const pg = (enteredLead: number, runners: number, outs: number) => ({
    isStarter: false, enteredLead, outs,
    saveSit: enteredLead >= 1 && (enteredLead <= 3 || enteredLead <= runners + 2),
    tyingNear: enteredLead >= 1 && enteredLead <= runners + 2,
  });

  it('① 3점 이하 리드는 1이닝 이상', () => {
    expect(earnsSave(pg(3, 0, 3))).toBe(true);
    expect(earnsSave(pg(3, 0, 2))).toBe(false);
  });

  it('② 동점 주자가 누상·타석·대기 타석이면 아웃 하나로도', () => {
    expect(earnsSave(pg(1, 0, 1))).toBe(true); // 동점 주자가 타석
    expect(earnsSave(pg(2, 0, 1))).toBe(true); // 대기 타석
    expect(earnsSave(pg(3, 1, 1))).toBe(true);
    expect(earnsSave(pg(5, 3, 1))).toBe(true);
    expect(earnsSave(pg(1, 0, 0))).toBe(false);
  });

  it('③ 3이닝 이상이면 리드 크기와 관계없이, 선발은 세이브 없음', () => {
    expect(earnsSave(pg(7, 0, 9))).toBe(true);
    expect(earnsSave(pg(7, 0, 8))).toBe(false);
    expect(earnsSave({ ...pg(2, 0, 9), isStarter: true })).toBe(false);
  });
});

describe('시즌에서 (연표가 경기에 걸린다)', () => {
  it('2021: 8월 10일부터 9회를 넘긴 경기가 없고, 그 전에는 연장이 있다', () => {
    const world = worldForYear(store, 2021, FAST);
    const s = Season.start(world, FAST, 'records-2021');
    s.runToEnd();
    const md = (day: number) => { const d = dateOfDay(2021, day); return d.month * 100 + d.date; };
    const late = s.log.filter((g) => md(g.day) >= 810);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((g) => g.innings <= 9)).toBe(true);
    expect(s.log.some((g) => md(g.day) < 810 && g.innings > 9)).toBe(true);
    // 승리는 결판난 경기마다 하나, 세이브는 승리보다 적다
    const decided = s.log.filter((g) => g.homeRuns !== g.awayRuns);
    expect(decided.every((g) => g.win !== null)).toBe(true);
    expect(s.log.filter((g) => g.save !== null).length).toBeLessThan(decided.length);
  }, 120_000);

  it('1985: 15회까지 (12회를 넘긴 경기가 있다)', () => {
    const world = worldForYear(store, 1985, FAST);
    // 12회를 넘는 경기는 한 시즌에 몇 번뿐이라 시드에 걸린다 (능력치 v2 16-1 사슬 능력 뒤 'records-1985'는 0번 → 3번 나오는 시드로)
    const s = Season.start(world, FAST, 'records-1985-3');
    s.runToEnd();
    expect(s.log.every((g) => g.innings <= 15)).toBe(true);
    expect(s.log.some((g) => g.innings > 12)).toBe(true);
  }, 120_000);
});
