// 재정 2 F8 (2026-11-04 사용자 결정): 자금이 많은 AI 구단의 공사 문턱(AI_RICH), AI 여유 자금 투자 0.5·150억,
// 긴급 지원 신뢰도 감점(기본 + 금액 + 연속, 구단주 압박 배율).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { AI_SURPLUS_FROM, AI_SURPLUS_RATE, RESCUE_TRUST, rescueStreak, trustFromFinance, type FinanceYear } from '../src/league/finance';
import { AI_RICH, REMODEL, NEW_PARK, stadiumYearEnd } from '../src/league/stadium';
import { wageIndex } from '../src/league/salary';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
let base: LeagueState;
beforeAll(() => {
  store = loadDataStore();
  const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'f8' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  g.advance(100000);
  g.beginOffseason();
  base = g.league;
}, 300_000);
const copy = () => JSON.parse(JSON.stringify(base)) as LeagueState;
const yr = (year: number, rescue: number, net = -rescue) => ({ year, rescue, net }) as FinanceYear;

describe('긴급 지원 신뢰도 감점', () => {
  it('받은 해마다 기본 감점이 있고(10억 아래도), 금액·연속 해 수만큼 커지며 구단주 압박 배율을 곱한다', () => {
    const r = RESCUE_TRUST;
    expect(trustFromFinance(yr(2030, 50_000))).toBe(-r.base);
    expect(trustFromFinance(yr(2030, 600_000))).toBe(-(r.base + 3));
    expect(trustFromFinance(yr(2030, 100_000_000))).toBe(-(r.base + r.cap));
    expect(trustFromFinance(yr(2030, 50_000), 2)).toBe(-(r.base + 2 * r.streak));
    expect(trustFromFinance(yr(2030, 50_000), 9)).toBe(-(r.base + r.streakMax * r.streak));
    // 금액은 2026년 돈으로 (연봉 지수 2면 같은 명목 금액이 절반)
    expect(trustFromFinance(yr(2030, 1_200_000), 0, 2)).toBe(-(r.base + 3));
    // 난이도: 쉬움 0.7·어려움 1.35
    expect(trustFromFinance(yr(2030, 600_000), 1, 1, 1.35)).toBe(-Math.round((r.base + 3 + r.streak) * 1.35));
    expect(trustFromFinance(yr(2030, 0, 10_000))).toBe(2);
    expect(trustFromFinance(yr(2030, 0, -10_000))).toBe(0);
  });
  it('연속 해 수: 이 해 바로 앞에 끊김 없이 긴급 지원을 받은 해만 센다', () => {
    const h = [yr(2026, 0, 5), yr(2027, 10), yr(2028, 10), yr(2029, 10), yr(2030, 10)];
    expect(rescueStreak(h, 2030)).toBe(3);
    expect(rescueStreak(h, 2028)).toBe(1);
    expect(rescueStreak([yr(2027, 10), yr(2029, 10)], 2029)).toBe(0);
    expect(rescueStreak([], 2030)).toBe(0);
  });
});

describe('AI 여유 자금 투자 손잡이', () => {
  it('문턱 150억, 비율 0.5 (2026년 돈)', () => {
    expect(AI_SURPLUS_FROM).toBe(1_500_000);
    expect(AI_SURPLUS_RATE).toBe(0.5);
  });
});

describe('자금이 많은 AI 구단의 공사', () => {
  const wage = wageIndex(2027);
  const remodel = Math.round(REMODEL.cost * wage);
  const keep = AI_RICH.keep * wage;
  const find = (L: LeagueState, name: string) => L.teams.findIndex((t) => t.name === name);
  it('시설이 remodelBelow 아래이고 자금이 공사비 + 남길 돈이면 리모델링, 모자라면 하지 않는다', () => {
    const L = copy();
    const t = find(L, 'KIA');
    L.stadiums![t].quality = AI_RICH.remodelBelow - 5;
    L.stadiums![t].opened = 2020;
    delete L.stadiums![t].project;
    const M = copy();
    M.stadiums![t] = JSON.parse(JSON.stringify(L.stadiums![t]));
    stadiumYearEnd(L, 2026, (x) => (x === t ? remodel + keep + 10 : 0), 0);
    expect(L.stadiums![t].project?.kind).toBe('remodel');
    stadiumYearEnd(M, 2026, (x) => (x === t ? remodel + keep - 10_000 : 0), 0);
    expect(M.stadiums![t].project).toBeUndefined();
  });
  it('구장이 newAge년 넘고 시설이 newBelow 아래면 신구장 (중립 펜스)', () => {
    const L = copy();
    const t = find(L, 'KIA');
    L.stadiums![t].quality = AI_RICH.newBelow - 5;
    L.stadiums![t].opened = 2026 - AI_RICH.newAge;
    delete L.stadiums![t].project;
    const cost = Math.round(Math.max(...NEW_PARK.options.map((o) => o.cost)) * wage);
    stadiumYearEnd(L, 2026, (x) => (x === t ? cost + keep + 10 : 0), 0);
    expect(L.stadiums![t].project?.kind).toBe('new');
  });
  it('실제 구장 이동이 가까우면(잠실 2032 돔) 돈이 많아도 넓힌 문턱으로 짓지 않는다', () => {
    const L = copy();
    const t = find(L, 'LG');
    L.stadiums![t].quality = AI_RICH.remodelBelow - 5;
    delete L.stadiums![t].project;
    stadiumYearEnd(L, 2026, (x) => (x === t ? 100_000_000 : 0), 0);
    expect(L.stadiums![t].project).toBeUndefined();
  });
});
