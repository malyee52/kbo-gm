// 외국인 연봉 바로잡기 (2026-10-22 사용자 조사): 실제 계약 금액(연봉 + 계약금), 신규만 개인 상한, 재계약은 개인 제한 없음,
// 구단 총액 상한은 재계약 외국인마다 같은 구단 재계약 연차 × 10만 달러 늘어난다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { createLeague, openingContracts } from '../src/league/create';
import { payOf, WON_PER_USD } from '../src/league/finance';
import {
  FOREIGN_NEW_CAP, FOREIGN_RESIGN_CAP_STEP, FOREIGN_TOTAL_CAP, foreignContractTotal, foreignResignRoom, foreignSalary, foreignTeamCap, isNewForeign,
} from '../src/league/salary';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
let league: LeagueState;
beforeAll(() => {
  store = loadDataStore();
  league = createLeague(store, 2026, 'foreign-pay', { ...DEFAULT_PARAMS, pilotSeasons: 1 }).league;
}, 120_000);

const byName = (name: string) => league.players.find((p) => p.name === name && p.foreign)!;

describe('실제 계약 (외국인_개막명단.csv, 사용자 조사 2026-10-22)', () => {
  it('LG 오스틴·톨허스트·웰스는 연봉·계약금 그대로 시작한다', () => {
    expect(openingContracts(store, 2026).size).toBe(3);
    expect(byName('오스틴').contract).toMatchObject({ kind: 'foreign', salary: 1_100_000, bonus: 500_000 });
    expect(byName('톨허스트').contract).toMatchObject({ salary: 800_000, bonus: 400_000 });
    expect(byName('웰스').contract.salary).toBe(200_000);
    expect(byName('웰스').asia).toBe(true);
    expect(foreignContractTotal(byName('오스틴').contract)).toBe(1_600_000);
    // 재정에는 계약금까지 나간다
    expect(payOf(byName('오스틴'))).toBe(Math.round(1_600_000 * WON_PER_USD));
  });

  it('시작 판 모든 구단의 일반 외국인 합(연봉 + 계약금)이 구단 총액 상한 안이다', () => {
    league.teams.forEach((t, i) => {
      const reg = league.players.filter((p) => p.team === i && p.foreign && !p.asia);
      expect(reg.reduce((s, p) => s + foreignContractTotal(p.contract), 0), t.name).toBeLessThanOrEqual(foreignTeamCap(league, i, 2026, reg));
    });
  });
});

describe('외국인 금액 규정', () => {
  it('신규만 개인 상한, 재계약은 개인 제한 없음 (예전 200만 달러 자르기 없앰)', () => {
    expect(foreignSalary(80, true, false)).toBeLessThanOrEqual(FOREIGN_NEW_CAP);
    expect(foreignSalary(100, false, false)).toBeGreaterThan(2_000_000);
    expect(foreignSalary(60, true, true)).toBeLessThanOrEqual(200_000);
    expect(foreignSalary(60, false, true)).toBeGreaterThan(200_000);
    // 재계약 생성식은 2026 LG 실제(오스틴 160만·톨허스트 120만 달러) 근처
    expect(foreignSalary(69, false, false)).toBeGreaterThanOrEqual(1_500_000);
    expect(foreignSalary(69, false, false)).toBeLessThanOrEqual(1_700_000);
    expect(foreignSalary(49, false, false)).toBeGreaterThanOrEqual(1_100_000);
    expect(foreignSalary(49, false, false)).toBeLessThanOrEqual(1_300_000);
  });

  it('구단 총액 상한은 재계약 외국인마다 같은 구단 시즌 수 × 10만 달러 늘어난다 (신규·아시아쿼터는 0)', () => {
    const lg = league.teams.findIndex((t) => t.name === 'LG');
    const austin = byName('오스틴'); // LG 2023~2025
    expect(isNewForeign(austin)).toBe(false);
    expect(foreignResignRoom(league, austin, lg, 2026)).toBe(3 * FOREIGN_RESIGN_CAP_STEP);
    expect(foreignResignRoom(league, byName('웰스'), lg, 2026)).toBe(0);
    const reg = league.players.filter((p) => p.team === lg && p.foreign && !p.asia);
    const room = reg.reduce((s, p) => s + foreignResignRoom(league, p, lg, 2026), 0);
    expect(foreignTeamCap(league, lg, 2026, reg)).toBe(FOREIGN_TOTAL_CAP + room);
    expect(foreignTeamCap(league, lg, 2026, [])).toBe(FOREIGN_TOTAL_CAP);
  });
});
