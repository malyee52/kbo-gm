// 재정 2 (docs/재정2_기획안.md 7장 F1): 운영비 네 줄 나눠 보기(F1a)와 예산안 계획·예상.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { cashOf, ledgerItems, OPS_COST, OPS_KINDS, OPS_SPLIT, splitOps, type FinanceKind } from '../src/league/finance';

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
