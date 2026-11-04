// 시즌 중 교체 외국인 금액 상한 (2019~, league/market.ts swapCap·swapContract, 2026-11-04 사용자 "실제대로 상한"):
// 이번 시즌 계약 총액 ≤ 한 달 10만 달러(아시아쿼터 2만) × 11월 말까지 남은 달. 2019 전은 상한 없음. 부상 대체도 같은 셈
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { dateOf } from '../src/game/calendar';
import { GameSession } from '../src/game/session';
import { monthsLeft, remainingShare, swapCap, swapContract, swapMonthCap } from '../src/league/market';
import type { LeaguePlayer } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

const SEASON_DAYS = 200;
/** 그 해 그 날짜의 일정 색인 */
const dayOf = (year: number, month: number, date: number) => {
  for (let d = 0; d < SEASON_DAYS; d++) { const x = dateOf(year, d); if (x.month === month && x.date === date) return d; }
  throw new Error('날짜 없음');
};
const cand = (salary: number, asia = false, bonus?: number) =>
  ({ id: 'x', asia, contract: { kind: 'foreign', salary, until: 2026, ...(bonus ? { bonus } : {}) } }) as unknown as LeaguePlayer;
const noRules = { ruleShifts: undefined, rules: undefined };

describe('교체 외국인 금액 상한', () => {
  it('남은 달은 11월 말까지, 영입한 달은 날짜 비율', () => {
    expect(monthsLeft(2026, dayOf(2026, 6, 15))).toBeCloseTo(16 / 30 + 5, 6);
    expect(monthsLeft(2026, dayOf(2026, 8, 1))).toBeCloseTo(4, 6);
  });

  it('한 달 상한: 일반 10만·아시아쿼터 2만 달러, 2019 전은 상한 없음', () => {
    expect(swapMonthCap(noRules, 2026, false)).toBe(100_000);
    expect(swapMonthCap(noRules, 2026, true)).toBe(20_000);
    const jun15 = dayOf(2019, 6, 15);
    expect(swapCap(noRules, 2019, false, jun15)).toBe(Math.round(100_000 * monthsLeft(2019, jun15)));
    expect(swapCap(noRules, 2018, false, dayOf(2018, 6, 15))).toBeNull();
    expect(swapCap(noRules, 2010, false, dayOf(2010, 6, 15))).toBeNull();
    // 보도 예시: 6월 중순 55만 달러
    expect(swapCap(noRules, 2026, false, dayOf(2026, 6, 15))! / 10_000).toBeCloseTo(55, 0);
  });

  it('요구액이 상한을 넘으면 연간 금액을 깎아 이번 시즌 총액이 상한에 맞고, 넘지 않으면 그대로', () => {
    const d = dayOf(2026, 6, 15);
    const share = remainingShare(2026, SEASON_DAYS, d);
    const cap = swapCap(noRules, 2026, false, d)!;
    const hi = swapContract(cand(1_000_000), noRules, 2026, SEASON_DAYS, d);
    expect(hi.capped).toBe(true);
    expect(hi.ask).toBe(Math.round(1_000_000 * share));
    expect(hi.total).toBeLessThanOrEqual(cap);
    expect(hi.total).toBeGreaterThan(cap - 10);
    expect(hi.salary * share).toBeLessThanOrEqual(cap);
    const lo = swapContract(cand(300_000), noRules, 2026, SEASON_DAYS, d);
    expect(lo).toMatchObject({ capped: false, salary: 300_000, total: Math.round(300_000 * share) });
    // 연봉·계약금은 같은 비율로
    const b = swapContract(cand(800_000, false, 200_000), noRules, 2026, SEASON_DAYS, d);
    expect(b.capped).toBe(true);
    expect(b.bonus! / b.salary).toBeCloseTo(0.25, 3);
    // 부상 대체는 계약금 없이
    const r = swapContract(cand(800_000, false, 200_000), noRules, 2026, SEASON_DAYS, d, true);
    expect(r.bonus).toBeUndefined();
    expect(r.total).toBeLessThanOrEqual(cap);
    // 아시아쿼터는 한 달 2만
    const a = swapContract(cand(200_000, true), noRules, 2026, SEASON_DAYS, d);
    expect(a.total).toBeLessThanOrEqual(swapCap(noRules, 2026, true, d)!);
    expect(a.capped).toBe(true);
    // 2014~2018은 상한 없음
    const old = swapContract(cand(1_000_000), noRules, 2017, SEASON_DAYS, dayOf(2017, 6, 15));
    expect(old).toMatchObject({ capped: false, salary: 1_000_000, cap: null });
  });

  it('게임에서 6월 중순에 들여온 요구액 높은 외국인은 이번 시즌 총액이 상한 안이다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'swap-cap' }, FAST);
    while (dateOf(2026, g.day).month < 6 || dateOf(2026, g.day).date < 15) g.advance(1);
    // 파견 후보를 관찰 명단에 모두 올리고(조작 기록 밖) 일반 외국인 한 명을 방출해 자리를 낸다
    const t = g.league.scoutFx!.teams[g.teamIdx];
    for (const p of g.league.players) if (p.fx && !t.list.some((e) => e.id === p.id)) t.list.push({ id: p.id, at: 0, weeks: 0 });
    const out = g.team.org.find((p) => p.foreign && !g.leaguePlayer(p.id)!.asia)!;
    expect(g.releaseInSeason(out).ok).toBe(true);
    const pick = g.marketPlayers().find((p) => p.foreign && g.leaguePlayer(p.id)!.market === 2026 && !g.leaguePlayer(p.id)!.asia && g.signBlock(p) === null)!;
    expect(pick).toBeTruthy();
    g.leaguePlayer(pick.id)!.contract.salary = 1_000_000;
    const day = g.day;
    expect(g.signInSeason(pick).ok).toBe(true);
    const c = g.leaguePlayer(pick.id)!.contract;
    const total = c.salary * remainingShare(2026, g.season.schedule.length, day);
    expect(total).toBeLessThanOrEqual(swapCap(g.league, 2026, false, day)!);
    expect(c.salary).toBeLessThan(1_000_000);
  });
});
