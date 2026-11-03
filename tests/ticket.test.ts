// 재정 2 F3 좌석 등급별 입장권 가격 (docs/재정2_기획안.md 4.5·5장·7장 F3): 등급 관중률·관중 수입, 팬 만족도,
// 재무팀 추천 가격(자동)과 고정, AI, 조작 ticket-price·ticket-auto, 저장 왕복·예전 저장·replay.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import {
  basePrices, DEMAND_BINS, financePlan, gameGate, gatePredict, priceFanDelta, priceIndexOf, priceLockedOf, pricesOf, recommendPrices, SEAT, SEAT_GRADES,
  lastDemand, seatFactor, seatFill, seatPriceIndex, type SeatPrices, type TeamFinance,
} from '../src/league/finance';
import { fanLevel } from '../src/league/stadium';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

function openNext(g: GameSession): void {
  let guard = 0;
  while (g.offseason!.stage !== 'ready' && guard++ < 40) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft();
    if (st === 'comp') g.autoComp();
    if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.openNextSeason().ok).toBe(true);
}
function toOffseason(g: GameSession): void {
  g.advance(100000);
  g.advancePostseason(10_000);
  g.beginOffseason();
}
const all = (x: number): SeatPrices => ({ general: x, reserved: x, premium: x });

describe('① 등급 셈', () => {
  it('등급 가격 몫의 좌석 가중 합은 1 (기본 가격 = 예전 객단가), 기본 가격이면 예전 셈(반올림까지) 그대로', () => {
    expect(SEAT_GRADES.reduce((s, g) => s + SEAT[g].share, 0)).toBeCloseTo(1, 12);
    expect(SEAT_GRADES.reduce((s, g) => s + SEAT[g].share * seatFactor(g), 0)).toBeCloseTo(1, 12);
    expect(seatPriceIndex(basePrices())).toBeCloseTo(1, 12);
    for (const [cap, f, t] of [[23750, 0.73, 1.46], [17000, 1, 1.71], [12000, 0.33, 2.2]]) {
      const r = gameGate(cap, f, t, basePrices());
      expect(r.fans).toBe(Math.round(cap * f));
      expect(r.revenue).toBe(Math.round(Math.round(cap * f) * t));
      expect(priceIndexOf(r.seats, basePrices())).toBeCloseTo(1, 12);
    }
  });

  it('값을 올리면 관중 ↓·한 명 객단가 ↑, 만원이 아닌 구단은 수입도 ↓ (꼭대기 100~125%), 내리면 관중 ↑·수입 ↓. 일반석이 가장 민감', () => {
    const cap = 20000;
    const t = 1.46;
    const b = gameGate(cap, 0.6, t, basePrices());
    const up = gameGate(cap, 0.6, t, all(1.3));
    const dn = gameGate(cap, 0.6, t, all(0.8));
    expect(up.fans).toBeLessThan(b.fans);
    expect(up.revenue / up.fans).toBeGreaterThan(b.revenue / b.fans);
    expect(up.revenue).toBeLessThan(b.revenue);
    expect(gameGate(cap, 0.6, t, all(1.5)).revenue).toBeLessThan(b.revenue);
    expect(dn.fans).toBeGreaterThan(b.fans);
    expect(dn.revenue).toBeLessThan(b.revenue);
    expect(gameGate(cap, 0.6, t, all(0.7)).revenue).toBeLessThan(b.revenue);
    const drop = (g: 'general' | 'reserved' | 'premium') => 1 - seatFill(0.6, g, 1.3) / 0.6;
    expect(drop('general')).toBeGreaterThan(drop('reserved'));
    expect(drop('reserved')).toBeGreaterThan(drop('premium'));
    // 한 등급 수입 꼭대기 = −1/탄력성
    const peak = (g: 'general' | 'reserved' | 'premium') => -1 / SEAT[g].elastic;
    expect(peak('general')).toBeCloseTo(1, 6);
    expect(peak('premium')).toBeGreaterThan(peak('reserved'));
    expect(peak('premium')).toBeLessThanOrEqual(1.25 + 1e-9);
  });

  it('넘친 수요(좌석보다 큰 수요)는 값을 올려도 그만큼 빠지지 않아 만원 구단만 올려서 이득, 관중률은 1을 넘지 않는다', () => {
    const b = gameGate(10000, 1.2, 1.46, basePrices());
    expect(b.fans).toBe(10000);
    expect(gameGate(10000, 1.2, 1.46, all(1.1)).revenue).toBeGreaterThan(b.revenue);
    expect(gameGate(10000, 1.2, 1.46, all(1.1)).fans).toBe(10000);
    expect(gameGate(10000, 0.8, 1.46, all(1.1)).revenue).toBeLessThan(gameGate(10000, 0.8, 1.46, basePrices()).revenue * 1.01);
    expect(seatFill(0.95, 'general', 0.7)).toBe(1);
    expect(seatFill(1.3, 'general', 1)).toBe(1);
    expect(gameGate(10000, 1, 1.46, all(0.7)).fans).toBe(10000);
  });

  it('팬 만족도: −10 × (가격 지수 − 1) — 110%면 −1, 130%면 −3, 90%면 +1', () => {
    expect(priceFanDelta(1.1)).toBe(-1);
    expect(priceFanDelta(1.3)).toBe(-3);
    expect(priceFanDelta(0.9)).toBe(1);
    expect(priceFanDelta(1)).toBe(-0);
  });

  it('예상 셈(gatePredict): 분포 칸이 경기마다 셈과 같은 방향, 분포가 없으면 평균 하나로', () => {
    const d = new Array(DEMAND_BINS).fill(0);
    d[12] = 30; d[20] = 40;
    const b = gatePredict(d, 0, 20000, 1.46, basePrices());
    expect(b.fans).toBeCloseTo((30 * 0.6 + 40 * 1) / 70 * 20000, 6);
    const up = gatePredict(d, 0, 20000, 1.46, all(1.2));
    expect(up.fans).toBeLessThan(b.fans);
    expect(up.revenue).toBeGreaterThan(b.revenue);
    expect(gatePredict(undefined, 0.5, 20000, 1.46, basePrices()).fans).toBeCloseTo(10000, 6);
  });
});

describe('② 기본 가격 = F3 전, 가격을 올린 시즌', () => {
  let a: GameSession;
  let up: GameSession;
  beforeAll(() => {
    a = GameSession.create(store, opts('tk-a'), FAST);
    up = GameSession.create(store, opts('tk-a'), FAST);
    const f = up.league.finance![lg];
    f.prices = all(1.3);
    f.activePrices = all(1.3);
    toOffseason(a);
    toOffseason(up);
  });

  it('가격 칸이 없는 판과 기본 가격(1)을 칸으로 적은 판은 한 시즌 장부가 같다', () => {
    const b = GameSession.create(store, opts('tk-a'), FAST);
    for (const f of b.league.finance!) { f.prices = basePrices(); f.activePrices = basePrices(); }
    toOffseason(b);
    expect(b.league.ledger).toEqual(a.league.ledger);
    expect(b.league.finance!.map((f) => f.history)).toEqual(a.league.finance!.map((f) => f.history));
  });

  it('새 게임 첫 시즌은 모든 구단 기본 가격이고 결산에 가격이 적히지 않는다 (예전 저장과 같은 돈 흐름)', () => {
    for (const f of a.league.finance!) {
      const y = f.history.at(-1)!;
      expect(y.prices).toBeUndefined();
      if (y.homeGames) {
        expect(y.demand!.reduce((s, c) => s + c, 0)).toBe(y.homeGames);
        expect(Math.abs(SEAT_GRADES.reduce((s, g) => s + y.seats![g], 0) - y.attendance!)).toBeLessThanOrEqual(y.homeGames); // 경기마다 반올림
      }
    }
  });

  it('값을 30% 올리면 경기 결과는 같고 관중 ↓·관중 수입 ↑, 팬 만족도 결산에 "입장권 가격" −3', () => {
    expect(up.season.log.map((g) => [g.homeRuns, g.awayRuns])).toEqual(a.season.log.map((g) => [g.homeRuns, g.awayRuns]));
    const ya = a.league.finance![lg].history.at(-1)!;
    const yu = up.league.finance![lg].history.at(-1)!;
    expect(yu.attendance!).toBeLessThan(ya.attendance!);
    expect(yu.items.gate!).toBeGreaterThan(ya.items.gate!);
    expect(yu.prices).toEqual(all(1.3));
    const e = up.league.fans![lg].log.find((x) => x.reason === `${up.year} 입장권 가격`);
    expect(e).toBeDefined();
    expect(e!.delta).toBeLessThan(-2);
    expect(e!.delta).toBeGreaterThanOrEqual(-3);
    expect(fanLevel(up.league, lg, up.year + 1)).toBeLessThan(fanLevel(a.league, lg, a.year + 1));
    // 다른 구단은 그대로
    for (let t = 0; t < 10; t++) if (t !== lg) expect(up.league.finance![t].history.at(-1)!.items.gate).toBe(a.league.finance![t].history.at(-1)!.items.gate);
  });

  it('재무팀 추천 가격: 지난 시즌 수요 관중률 0.9 이상 → 지정·프리미엄 110%, 0.6 이하 → 일반석 90%. 결산 뒤 플레이어 구단도 추천 가격으로 채워진다', () => {
    const L = a.league;
    const fakeDemand = (team: number, bin: number) => {
      const h = L.finance![team].history.at(-1)!;
      const keep = h.demand;
      h.demand = new Array(DEMAND_BINS).fill(0);
      h.demand[bin] = 10;
      const r = recommendPrices(L, team);
      h.demand = keep;
      return r;
    };
    expect(fakeDemand(0, 19)).toEqual({ general: 1, reserved: 1.1, premium: 1.1 });
    expect(fakeDemand(0, 12)).toEqual({ general: 0.9, reserved: 1, premium: 1 });
    expect(fakeDemand(0, 15)).toEqual(basePrices());
    expect(pricesOf(L.finance![lg], true)).toEqual(recommendPrices(L, lg));
    expect(priceLockedOf(L.finance![lg])).toEqual([]);
  });
});

describe('③ 조작·저장·replay·AI', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, opts('tk-c'), FAST);
    toOffseason(g);
  });

  it('조작 검사: 70~150% 5% 칸만, 시즌 중에는 바꿀 수 없다', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(r.setTicketPrice('premium', 1.5).ok).toBe(true);
    expect(r.setTicketPrice('premium', 1.55).ok).toBe(false);
    expect(r.setTicketPrice('general', 0.65).ok).toBe(false);
    expect(r.setTicketPrice('general', 1.03).ok).toBe(false);
    expect(r.setTicketPrice('nope' as 'general', 1).ok).toBe(false);
    const s = GameSession.create(store, opts('tk-d'), FAST);
    expect(s.setTicketPrice('general', 1.1).ok).toBe(false);
    expect(s.setTicketAuto().ok).toBe(false);
  });

  it('고친 등급은 고정, 다음 결산 뒤 자동 등급만 추천 가격으로. 예산안 예상은 값을 올리면 관중 ↓', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    const before = r.budgetView().plan;
    expect(r.setTicketPrice('premium', 1.5).ok).toBe(true);
    expect(r.setTicketPrice('general', 1.2).ok).toBe(true);
    const f = r.league.finance![lg];
    expect(priceLockedOf(f)).toEqual(['general', 'premium']);
    const after = r.budgetView().plan;
    expect(after.seats.general.fans).toBeLessThan(before.seats.general.fans);
    expect(after.seats.premium.fans).toBeLessThan(before.seats.premium.fans);
    expect(after.seats.reserved.fans).toBeCloseTo(before.seats.reserved.fans, 6);
    expect(after.items.gate).not.toBe(before.items.gate);
    openNext(r);
    expect(pricesOf(f, false)).toEqual({ ...recommendPrices(r.league, lg), general: 1.2, premium: 1.5 });
    // AI 구단은 추천 가격
    for (let t = 0; t < 10; t++) if (t !== lg) expect(pricesOf(r.league.finance![t], false)).toEqual(recommendPrices(r.league, t));
    toOffseason(r);
    const rec = recommendPrices(r.league, lg);
    expect(pricesOf(f, true)).toEqual({ ...rec, general: 1.2, premium: 1.5 });
    expect(r.league.finance![lg].history.at(-1)!.prices).toEqual({ ...pricesOf(f, false) });
    expect(r.setTicketAuto('general').ok).toBe(true);
    expect(priceLockedOf(f)).toEqual(['premium']);
    expect(pricesOf(f, true).general).toBe(rec.general);
    expect(r.setTicketAuto().ok).toBe(true);
    expect(pricesOf(f, true)).toEqual(rec);
    expect(priceLockedOf(f)).toEqual([]);
  });

  it('조작 기록 replay·저장 왕복이 같은 가격·같은 다음 시즌 장부를 낸다', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(r.setTicketPrice('reserved', 0.85).ok).toBe(true);
    expect(r.setBudget('medical', 30_000).ok).toBe(true);
    expect(r.setTicketPrice('premium', 1.25).ok).toBe(true);
    const info = r.reproInfo();
    const back = GameSession.replay(store, roundTrip(info.opts), roundTrip(info.actions), info.at, FAST);
    const fb = back.league.finance![lg];
    expect(pricesOf(fb, true)).toEqual(pricesOf(r.league.finance![lg], true));
    expect(priceLockedOf(fb)).toEqual(['reserved', 'premium']);
    const saved = GameSession.load(store, roundTrip(r.toSave()) as GameSaveV2, FAST);
    openNext(r);
    openNext(saved);
    r.advance(40);
    saved.advance(40);
    expect(saved.budgetView().plan.items.gate).toBe(r.budgetView().plan.items.gate);
    expect(saved.cashNow()).toBe(r.cashNow());
    expect(pricesOf(saved.league.finance![lg], false)).toEqual({ ...recommendPrices(r.league, lg), reserved: 0.85, premium: 1.25 });
  });

  it('예전 저장(가격 칸 없음)은 모두 기본 가격·자동으로 읽히고, 계획 관중 수입은 가격 칸을 1로 적은 것과 같다', () => {
    const save = roundTrip(g.toSave()) as GameSaveV2;
    const strip = (f: TeamFinance) => { delete f.prices; delete f.activePrices; delete f.priceLocked; };
    for (const f of save.league.finance!) strip(f);
    for (const f of save.league.finance!) for (const h of f.history) { delete h.seats; delete h.demand; delete h.prices; }
    const h = GameSession.load(store, save, FAST);
    const f = h.league.finance![lg];
    expect(pricesOf(f, true)).toEqual(basePrices());
    expect(pricesOf(f, false)).toEqual(basePrices());
    expect(priceLockedOf(f)).toEqual([]);
    const plan = financePlan({ league: h.league, world: h.world }, lg, h.year + 1);
    const plan1 = financePlan({ league: h.league, world: h.world }, lg, h.year + 1, undefined, basePrices());
    expect(plan.items.gate).toBe(plan1.items.gate);
    // 분포가 없어도 평균 관중률(관중 ÷ 홈 경기 × 좌석)로 추천 가격을 낸다
    expect(lastDemand(h.league, lg)).toBeCloseTo(lastDemand(g.league, lg)!, 1);
  });
});
