// 해마다 연봉이 다른 실제 다년 계약 (data-src/계약_연도별.csv → contracts.json yearly → Contract.steps, 2026-10-26).
// 2022 SSG는 김광현·한유섬·박종훈·문승원의 연봉을 캡 도입 전 첫해에 몰아줬다. 고르게 나누면 2023년 SSG가 캡을 넘었다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { contractYearPay, createLeague } from '../src/league/create';
import { stepContract } from '../src/league/offseason';
import { salaryCap, teamCapPayroll } from '../src/league/salary';
import type { LeaguePlayer } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('계약 연도별 연봉', () => {
  it('적은 해는 그 값, 나머지 해는 남은 보장액을 고르게 나눈다', () => {
    expect(contractYearPay({ first: 2022, years: 5, guaranteed: 56, yearly: { 2022: 24 } })).toEqual([24, 8, 8, 8, 8]);
    expect(contractYearPay({ first: 2020, years: 4, guaranteed: 40 })).toEqual([10, 10, 10, 10]);
  });

  it('2022 시작: 김광현은 첫해 81억, 다음 시즌들 값이 남고 결산 때 차례로 옮겨진다', () => {
    const { league } = createLeague(store, 2022, 'yearly-a', FAST);
    const kim = league.players.find((p) => p.name === '김광현' && p.team >= 0 && !p.foreign)!;
    expect(kim.contract.salary).toBe(810000);
    expect(kim.contract.steps).toEqual([[2023, 100000], [2024, 100000], [2025, 300000]]);
    const p: LeaguePlayer = structuredClone(kim);
    stepContract(p, 2023);
    expect(p.contract.salary).toBe(100000);
    stepContract(p, 2024);
    stepContract(p, 2025);
    expect(p.contract.salary).toBe(300000);
    expect(p.contract.steps).toBeUndefined();
  });

  it('2023 시작: 그 해 값으로 시작하고 SSG가 캡을 넘지 않는다 (실제 2023 SSG 108억 4,647만, 캡 114억 2,638만)', () => {
    const { league } = createLeague(store, 2023, 'yearly-a', FAST);
    const kim = league.players.find((p) => p.name === '김광현' && p.team >= 0 && !p.foreign)!;
    expect(kim.contract.salary).toBe(100000);
    const ssg = league.teams.findIndex((t) => t.name === 'SSG');
    expect(teamCapPayroll(league, ssg, 2023)).toBeLessThan(salaryCap(2023)!);
  });

  it('계약이 이미 끝난 선수(방출 등)는 남은 값을 버린다', () => {
    const p = { contract: { kind: 'nonFA', salary: 810000, until: 2022, steps: [[2023, 100000]] } } as unknown as LeaguePlayer;
    stepContract(p, 2023);
    expect(p.contract).toEqual({ kind: 'nonFA', salary: 810000, until: 2022 });
  });
});
