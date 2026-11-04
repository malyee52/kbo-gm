// 재정 2 (docs/재정2_기획안.md 7장 F1): 운영비 네 줄 나눠 보기(F1a)와 예산안 계획·예상, 지급 달력 2~11월 10번(F1b).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import {
  BROADCAST, cashOf, investCost, ledgerItems, OPS_COST, OPS_KINDS, OPS_SPLIT, opsCost, PAY_COUNT, PAY_MONTHS, paydays, payOf, payPlan, seasonFlows, splitOps, gateShares, type FinanceKind,
} from '../src/league/finance';
import { dateOf } from '../src/game/calendar';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });
const sumOps = (items: Partial<Record<FinanceKind, number>>) => OPS_KINDS.reduce((s, k) => s + (items[k] ?? 0), 0);

/** 한 시즌을 끝까지 (가을야구 포함) 돌려 결산까지 */
function settled(seed: string): GameSession {
  const g = GameSession.create(store, opts(seed), FAST);
  g.advance(100000);
  g.advancePostseason(10_000);
  g.beginOffseason();
  return g;
}

let base: GameSession;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  base = settled('fin2-a');
});

describe('재정 2 F1a 운영비 네 줄', () => {
  it('나눈 몫의 합은 OPS_COST, 한 번 지급액을 나눠도 합이 그대로다 (반올림 나머지는 원정·경기 운영)', () => {
    expect(OPS_KINDS.reduce((s, k) => s + OPS_SPLIT[k], 0)).toBe(OPS_COST);
    for (const total of [-336_667, -101_000, 0, 7, -1]) {
      const p = splitOps(total);
      expect(OPS_KINDS.reduce((s, k) => s + p[k], 0)).toBe(total);
    }
  });

  it('① 결산: 운영비 네 줄 합 = 예전 운영비 한 줄, 수지 = 항목 합, 결산 자금 = 장부 합 (돈 흐름은 바뀌지 않음)', () => {
    const L = base.league;
    for (let t = 0; t < L.teams.length; t++) {
      const y = L.finance![t].history.at(-1)!;
      expect(y.items.ops).toBeUndefined();
      const ops = sumOps(y.items);
      // 예전 셈: 지급마다 −round(운영비 ÷ 지급 횟수)를 지급 횟수만큼 — 반올림 차이 말고는 연간 운영비 그대로
      expect(Math.abs(ops + OPS_COST)).toBeLessThanOrEqual(10);
      // 네 줄이 나눈 몫대로
      for (const k of OPS_KINDS) expect(Math.abs((y.items[k] ?? 0) + OPS_SPLIT[k])).toBeLessThanOrEqual(10);
      expect(y.net).toBe(Object.values(y.items).reduce((s, v) => s + (v ?? 0), 0));
      expect(y.cash).toBeGreaterThanOrEqual(0);
    }
    expect(cashOf(L, lg)).toBe(L.finance![lg].history.at(-1)!.cash + L.ledger.filter((e) => e.year > 2026).reduce((s, e) => s + (e.to === lg ? e.amount : 0) - (e.from === lg ? e.amount : 0), 0));
  });

  it('② 예전 장부(운영비 한 줄)를 불러와도 자금·결산 합이 같다', () => {
    const save = roundTrip(base.toSave()) as GameSaveV2;
    const L = save.league;
    // 예전 꼴로 되돌린다: 네 줄 장부 항목 → 'ops' 한 줄, 결산 기록도
    for (const e of L.ledger) if (OPS_KINDS.includes(e.kind as never)) e.kind = 'ops';
    for (const f of L.finance!) for (const h of f.history) {
      const ops = sumOps(h.items);
      for (const k of OPS_KINDS) delete h.items[k];
      if (ops) h.items.ops = ops;
    }
    const old = GameSession.load(store, save, FAST);
    for (let t = 0; t < base.league.teams.length; t++) {
      expect(cashOf(old.league, t)).toBe(cashOf(base.league, t));
      const a = base.league.finance![t].history.at(-1)!;
      const b = old.league.finance![t].history.at(-1)!;
      expect(b.items.ops).toBe(sumOps(a.items));
      const sum = (it: typeof a.items) => Object.values(it).reduce((s, v) => s + (v ?? 0), 0);
      expect(sum(b.items)).toBe(sum(a.items));
      const la = ledgerItems(base.league, t, 2026);
      const lb = ledgerItems(old.league, t, 2026);
      expect(lb.ops).toBe(sumOps(la) + (la.ops ?? 0));
    }
    // 화면(재정 표)도 그대로 열린다
    expect(old.budgetView().plan.year).toBe(2027);
  });

  it('③ 예산안: 정규시즌 끝 "시즌 끝 예상"은 결산 항목과 같고(스폰서·가을야구 빼고), 개막 계획 수지는 실제와 수입의 10% 안 (구단 평균)', () => {
    const g = GameSession.create(store, opts('fin2-a'), FAST);
    const plans = g.league.teams.map((_, t) => g.budgetView(t).plan);
    const p0 = plans[lg];
    expect(p0.year).toBe(2026);
    expect(p0.homeGames).toBeGreaterThan(60);
    expect(sumOps(p0.items)).toBe(-OPS_COST);
    g.advance(100000);
    const rows = g.league.teams.map((_, t) => g.budgetView(t).rows!);
    g.advancePostseason(10_000);
    g.beginOffseason();
    let err = 0;
    for (let t = 0; t < g.league.teams.length; t++) {
      const h = g.league.finance![t].history.at(-1)!;
      for (const k of ['gate', 'payroll', 'foreign', 'coach', 'broadcast', 'parent', 'invest', ...OPS_KINDS] as FinanceKind[]) {
        expect(rows[t].find((r) => r.kind === k)?.end ?? 0, `${t} ${k}`).toBe(h.items[k] ?? 0);
      }
      const plan = Object.values(plans[t].items).reduce((s, v) => s + (v ?? 0), 0);
      // 가을야구 수입·우승 배당은 계획에 없다
      const regular = h.net - (h.items.postseason ?? 0) - (h.items.champion ?? 0);
      const income = Object.values(h.items).filter((v) => (v ?? 0) > 0).reduce((s, v) => s + (v ?? 0), 0);
      err += Math.abs(plan - regular) / income;
    }
    expect(err / g.league.teams.length).toBeLessThan(0.1);
  });
});

describe('재정 2 F1b 지급 달력 10번', () => {
  it('⑤ 1982·1999·2020(늦은 개막)·2026 모두 2~11월 10번: 개막 전 달은 개막일, 경기 달은 그 달 마지막 날, 시즌 뒤 달은 결산', () => {
    for (const year of [1982, 1999, 2020, 2026]) {
      const g = GameSession.create(store, { year, teamIdx: 0, seed: `fin2-pay-${year}` }, FAST);
      const days = g.season.schedule.length;
      const plan = payPlan(year, days);
      expect(plan.flatMap((p) => p.months), `${year}`).toEqual(PAY_MONTHS);
      const ends = paydays(year, days);
      const open = dateOf(year, 0).month;
      for (const p of plan) {
        if (p.when === 'open') { expect(p.day).toBe(0); expect(Math.max(...p.months)).toBeLessThan(open); }
        if (p.when === 'day') expect(ends.some((e) => e.day === p.day && e.month === Math.max(...p.months))).toBe(true);
        if (p.when === 'settle') { expect(p.day).toBe(days - 1); expect(Math.min(...p.months)).toBeGreaterThan(ends.at(-1)!.month); }
      }
      // 2020은 5월 개막: 2·3·4월분이 개막일에
      if (year === 2020) expect(plan[0]).toMatchObject({ when: 'open', months: [2, 3, 4] });
    }
  });

  it('① 소속이 바뀌지 않으면 항목별 연 합계는 연간액 그대로 (반올림만), 결산 셈에만 결산 지급이 들어간다', () => {
    const g = GameSession.create(store, opts('fin2-b'), FAST);
    g.advance(100000);
    const input = { league: g.league, world: g.world, season: g.season, trades: [] };
    const plan = payPlan(2026, g.season.schedule.length);
    const tol = 10 * plan.length; // 10만 원 × 지급 횟수
    const full = seasonFlows({ ...input, settle: true }, lg, Number.MAX_SAFE_INTEGER).items;
    const before = seasonFlows(input, lg, Number.MAX_SAFE_INTEGER).items;
    const roster = g.league.players.filter((p) => p.team === lg && p.military?.state !== 'serving');
    const dom = roster.filter((p) => !p.foreign).reduce((s, p) => s + payOf(p), 0);
    const fgn = roster.filter((p) => p.foreign).reduce((s, p) => s + payOf(p), 0);
    expect(Math.abs((full.payroll ?? 0) + dom)).toBeLessThanOrEqual(tol);
    expect(Math.abs((full.foreign ?? 0) + fgn)).toBeLessThanOrEqual(tol);
    expect(Math.abs(sumOps(full) + opsCost(g.league, lg, 2026))).toBeLessThanOrEqual(tol);
    // 결산 지급에는 관중 수입 리그 배분이 더해진다 (재정 2 F7, gateShares)
    expect(Math.abs((full.broadcast ?? 0) - BROADCAST - gateShares(input)[lg])).toBeLessThanOrEqual(tol);
    expect(Math.abs((full.invest ?? 0) + (full.scouting ?? 0) + investCost(g.league.finance![lg], false, 1))).toBeLessThanOrEqual(2 * tol);
    // 결산 몫(시즌 뒤 달)은 결산 셈에만
    const settleMonths = plan.find((p) => p.when === 'settle')?.months.length ?? 0;
    expect(settleMonths).toBeGreaterThan(0);
    expect(Math.abs((before.payroll ?? 0) - Math.round(((full.payroll ?? 0) * (PAY_COUNT - settleMonths)) / PAY_COUNT))).toBeLessThanOrEqual(tol);
  });

  it('② 개막일 지급은 개막 날(경기 전) 지금 자금에 보인다', () => {
    const g = GameSession.create(store, opts('fin2-c'), FAST);
    const open = payPlan(2026, g.season.schedule.length).find((p) => p.when === 'open')!;
    expect(open.months.length).toBeGreaterThan(0);
    const f = g.seasonFinance()!;
    expect(g.currentDay).toBe(0);
    expect(f.items.payroll).toBeLessThan(0);
    expect(f.months.find((m) => m.when === 'open')!.net).toBeLessThan(0);
    expect(g.cashNow()).toBe(cashOf(g.league, lg) + Object.values(f.items).reduce((s, v) => s + (v ?? 0), 0));
    expect(g.cashNow()).toBeLessThan(cashOf(g.league, lg));
  });

  it('③ 결산: 결산 지급까지 넣은 항목이 결산 기록에 들어가고, 결산 자금 = 장부 합, 시즌 끝 예상 = 결산 항목', () => {
    const L = base.league;
    const g = base;
    for (let t = 0; t < L.teams.length; t++) {
      const y = L.finance![t].history.at(-1)!;
      expect(y.net).toBe(Object.values(y.items).reduce((s, v) => s + (v ?? 0), 0));
    }
    expect(g.league.finance![lg].history.at(-1)!.cash).toBeGreaterThanOrEqual(0);
    // 결산 직전 지금 자금 + 결산 몫(시즌 뒤 달 지급·스폰서 정산 등) = 결산 자금 (긴급 지원·환원 앞) — 다른 판으로 확인
    const h = GameSession.create(store, opts('fin2-d'), FAST);
    h.advance(100000);
    h.advancePostseason(10_000);
    const before = h.cashNow();
    const rows = h.budgetView().rows!;
    const rest = rows.reduce((s, r) => s + r.end - r.sofar, 0);
    h.beginOffseason();
    const y = h.league.finance![lg].history.at(-1)!;
    const after = y.cash - y.rescue + (y.dividend ?? 0);
    // 스폰서는 가을야구 깊이까지 매기므로 그 몫만 다르다
    const sponsorRow = rows.find((r) => r.kind === 'sponsor')!;
    expect(after - before - (rest - (sponsorRow.end - sponsorRow.sofar)) - ((y.items.sponsor ?? 0) - sponsorRow.sofar) - (y.items.champion ?? 0)).toBe(0);
  });
});
