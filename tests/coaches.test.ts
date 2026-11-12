// 코치 (league/coaches.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import {
  aiCoachBudget, COACH_BASE_SALARY, COACH_EDGE, COACH_ROLES, COACH_WIN_PER_LEVEL, coachEdge, coachGrowth, coachMarket, coachOf, coachSalaryAt, coachSurplus,
  FA_WIN_WON, fillUserCoaches, recommendCoach, type Coach,
} from '../src/league/coaches';
import { wageIndex, WON_PER_RUN } from '../src/league/salary';
import { cashOf } from '../src/league/finance';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

const coach = (role: Coach['role'], level: number, style: Coach['style'] = 'balanced'): Coach =>
  ({ id: `t-${role}`, role, level, style, salary: 10_000, until: 2030, career: '' });

describe('코치 효과', () => {
  it('3등급이 기준(0): 경기력은 (등급 − 3) × COACH_EDGE, 빈자리는 0등급', () => {
    const L = { coaches: [[coach('bat', 5), coach('pit', 3), coach('def', 1)]] } as unknown as LeagueState;
    const e = coachEdge(L, 0);
    expect(e.bat).toBeCloseTo(2 * COACH_EDGE, 10);
    expect(e.pit).toBeCloseTo((0 + -2 * 0.5) * COACH_EDGE, 10);
    expect(coachEdge({ coaches: [[]] } as unknown as LeagueState, 0).bat).toBeCloseTo(-3 * COACH_EDGE, 10);
  });

  it('성장: 좋은 코치는 늘리고 나쁜 코치는 줄인다, 베테랑형 4등급 이상은 31세 이상 하락을 줄인다', () => {
    const good = { coaches: [[coach('bat', 5, 'young'), coach('dev', 5)]] } as unknown as LeagueState;
    const avg = { coaches: [[coach('bat', 3), coach('dev', 3)]] } as unknown as LeagueState;
    const bad = { coaches: [[coach('bat', 1), coach('dev', 1)]] } as unknown as LeagueState;
    expect(coachGrowth(avg, 0, false, 22, 10, 14, false)).toBeCloseTo(14, 10);
    expect(coachGrowth(good, 0, false, 22, 10, 14, true)).toBeGreaterThan(14);
    expect(coachGrowth(bad, 0, false, 22, 10, 14, true)).toBeLessThan(14);
    const vet = { coaches: [[coach('bat', 5, 'veteran')]] } as unknown as LeagueState;
    expect(coachGrowth(vet, 0, false, 33, 20, 16, false)).toBeGreaterThan(16);
    expect(coachGrowth(avg, 0, false, 33, 20, 16, false)).toBe(16);
  });
});

describe('코치 연봉 (2026-11-12 사용자 그릴 Q37: FA 1승당 값 수준)', () => {
  it('FA 1승당 값은 시장 단가 × 득실 1승 11점 (약 5억)', () => {
    expect(Math.abs(FA_WIN_WON - WON_PER_RUN * 11)).toBeLessThan(1000);
  });

  it('등급이 하나 오를 때 늘어나는 연봉 = 그 역할 한 등급 승수 × FA 1승당 값, 1등급은 1억', () => {
    for (const r of COACH_ROLES) {
      expect(coachSalaryAt(r, 1)).toBe(COACH_BASE_SALARY);
      for (let lv = 2; lv <= 5; lv++) expect(Math.abs(coachSalaryAt(r, lv) - coachSalaryAt(r, lv - 1) - COACH_WIN_PER_LEVEL[r] * FA_WIN_WON)).toBeLessThanOrEqual(1000);
    }
    // 타격·투수 코치 5등급은 예전 7억보다 비싸고, 효과가 작은 수비 코치는 싸다
    expect(coachSalaryAt('bat', 5)).toBeGreaterThan(70_000);
    expect(coachSalaryAt('pit', 5)).toBeGreaterThan(70_000);
    expect(coachSalaryAt('def', 5)).toBeLessThan(70_000);
  });

  it('직원 추천은 가성비(1등급 대비 효과를 FA 값으로 친 돈 − 더 내는 연봉)가 가장 큰 후보: 늘 최고 등급도, 늘 가장 싼 후보도 아니다', () => {
    const c = (id: string, level: number, mult: number): Coach => ({ id, role: 'bat', level, style: 'balanced', salary: Math.round(coachSalaryAt('bat', level) * mult), until: 2028, career: '' });
    const cands = [c('top-dear', 5, 1.15), c('mid-cheap', 3, 0.85), c('low', 1, 1)];
    expect(recommendCoach(cands, 1)!.id).toBe('mid-cheap');
    expect(coachSurplus(cands[0], 1)).toBeLessThan(0);
    // 같은 값이면 높은 등급
    expect(recommendCoach([c('a', 2, 1), c('b', 4, 1)], 1)!.level).toBe(4);
    // 연봉 한도 밖은 고르지 않는다
    expect(recommendCoach(cands, 1, 20_000)!.id).toBe('low');
  });

  it('시장 후보 연봉은 새 표를 따르고, 시장 전체에서 추천이 늘 5등급은 아니다', () => {
    const lv = new Map<number, number>();
    for (let y = 2026; y < 2046; y++) {
      const m = coachMarket({ seed: 'coach-pay', ruleShifts: undefined } as unknown as LeagueState, y);
      const w = wageIndex(y + 1);
      for (const x of m) {
        const base = coachSalaryAt(x.role, x.level) * w;
        expect(x.salary).toBeGreaterThanOrEqual(base * 0.85 - 1000);
        expect(x.salary).toBeLessThanOrEqual(base * 1.15 + 1000);
      }
      for (const r of COACH_ROLES) { const p = recommendCoach(m.filter((x) => x.role === r), w)!; lv.set(p.level, (lv.get(p.level) ?? 0) + 1); }
    }
    // 80번 고른 가운데 5등급이 절반을 넘지 않는다 (예전 규칙이면 시장 최고 등급)
    expect(lv.get(5) ?? 0).toBeLessThan(40);
    expect([...lv.keys()].length).toBeGreaterThanOrEqual(3);
  });

  it('플레이어 빈자리 채우기: 직원 추천 (예전에는 가장 싼 후보)', () => {
    const L = { seed: 'fill', teams: [{}, {}], coaches: [[], []], ledger: [] } as unknown as LeagueState;
    const c = (id: string, role: Coach['role'], level: number, mult: number): Coach => ({ id, role, level, style: 'balanced', salary: Math.round(coachSalaryAt(role, level) * mult), until: 2028, career: '' });
    const left = [c('cheap', 'bat', 1, 0.85), c('good', 'bat', 4, 0.86), c('p1', 'pit', 2, 1)];
    const picks = fillUserCoaches(L, left, 2026, 1, 1);
    expect(picks.find((x) => x.role === 'bat')!.id).toBe('good');
    for (const r of COACH_ROLES) expect(coachOf(L, 1, r)).toBeDefined();
  });

  it('AI 연봉 한도: 자금 80억(× 지수) 이상은 제한 없음, 30억 이상은 4등급 몫, 그 밑은 3등급 몫', () => {
    expect(aiCoachBudget('bat', 900_000, 1)).toBe(Infinity);
    expect(aiCoachBudget('bat', 400_000, 1)).toBeCloseTo(coachSalaryAt('bat', 4) * 1.15, 0);
    expect(aiCoachBudget('bat', 100_000, 1)).toBeCloseTo(coachSalaryAt('bat', 3) * 1.15, 0);
  });
});

describe('게임에서', () => {
  it('새 게임: 모든 구단에 코치 4명, 코치 연봉이 재정에 나간다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'coach-a' }, FAST);
    for (let t = 0; t < g.league.teams.length; t++) for (const r of COACH_ROLES) expect(coachOf(g.league, t, r), `${t} ${r}`).toBeDefined();
    g.advance(70);
    expect(g.seasonFinance()!.items.coach ?? 0).toBeLessThan(0);
  });

  it('오프시즌: 후보를 고용하면 바뀌고(남은 계약이 있으면 위약금), 개막 때 모든 구단 빈자리가 채워진다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'coach-b' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const market = g.offseason!.coachMarket!;
    expect(market.length).toBe(20);
    const best = [...market].filter((c) => c.role === 'bat').sort((a, b) => b.level - a.level)[0];
    const before = cashOf(g.league, lg);
    const had = coachOf(g.league, lg, 'bat');
    expect(g.hireCoach(best.id).ok).toBe(true);
    expect(coachOf(g.league, lg, 'bat')!.id).toBe(best.id);
    if (had && had.until > 2026) expect(cashOf(g.league, lg)).toBeLessThan(before);
    expect(g.hireCoach(best.id).ok).toBe(false); // 이미 고용했다
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(coachOf(h.league, lg, 'bat')!.id).toBe(best.id);
    for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.openNextSeason().ok).toBe(true);
    for (let t = 0; t < g.league.teams.length; t++) {
      for (const r of COACH_ROLES) expect(coachOf(g.league, t, r), `${t} ${r}`).toBeDefined();
      expect(g.league.coaches![t].every((c) => c.until >= 2027)).toBe(true);
    }
  }, 300_000);
});
