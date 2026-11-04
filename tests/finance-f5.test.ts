// 재정 2 F5 (docs/재정2_기획안.md 4.8·4.9·7장 F5): 시즌 중 모기업 단기 대여 이자, 결산 긴급 지원 절반 = 3년 부채, 조작 repay-debt,
// 계약금 2번 (계약 때 절반 + 다음 개막일 절반).
// ① 이자 셈 (자금을 더 낮추면 늘어나는 이자 = 낮춘 금액 × 4% × 첫 지급일~마지막 지급일 일수 ÷ 365) ② 하루씩·저장 뒤 이어도 같은 결산
// ③ 부채 3년 ⅓, 합 = 예전 "전년 긴급 지원 절반" ④ repay-debt (앞 해 몫부터, 수지 밖)·replay·저장 왕복 ⑤ 계약금 절반 + 개막일 절반 = 계약금
// ⑥ 늦은 개막 해(2020)의 개막일 지급
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import {
  bonusNow, cashOf, DEBT_YEARS, debtOf, dueOf, ledgerItems, LOAN_RATE, parentParts, payPlan, seasonFlows,
} from '../src/league/finance';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

function toStage(g: GameSession, stage: string): void {
  let guard = 0;
  while (g.offseason!.stage !== stage && guard++ < 40) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft();
    if (st === 'comp') g.autoComp();
    if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.offseason!.stage).toBe(stage);
}
function toOffseason(g: GameSession): void {
  g.advance(100000);
  g.advancePostseason(10_000);
  g.beginOffseason();
}
const input = (g: GameSession, settle = false) => ({
  league: g.league, world: g.world, season: g.season, trades: g.tradeMoves(), postseason: g.postseason?.series.flatMap((x) => x.games), settle,
});
/** 에디터 자금 고치기로 자금을 바꾼다 (조작 기록에 남아 replay도 같다) */
function money(g: GameSession, team: number, amount: number): void {
  expect(g.setEditor(true).ok).toBe(true);
  expect(g.editPlayer([{ op: 'cash', team, amount }]).ok).toBe(true);
}
const drain = (g: GameSession, team: number, amount: number) => money(g, team, -amount);

describe('① 단기 대여 이자', () => {
  it('자금이 내내 0 아래면, 더 낮춘 금액 × 4% × 지급 기간만큼 이자가 는다. 흑자 구단은 이자 0', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'f5-int' }, FAST);
    g.advance(100000);
    expect(seasonFlows(input(g, true), lg, Number.MAX_SAFE_INTEGER).interest).toBe(0);
    // 500억: 시즌 내내 대여 (장부에 바로, 시험용)
    g.league.ledger.push({ year: g.year, from: lg, to: -1, amount: 5_000_000, note: '시험', kind: 'other' });
    const a = seasonFlows(input(g, true), lg, Number.MAX_SAFE_INTEGER);
    g.league.ledger.push({ year: g.year, from: lg, to: -1, amount: 1_000_000, note: '시험', kind: 'other' });
    const b = seasonFlows(input(g, true), lg, Number.MAX_SAFE_INTEGER);
    const pays = payPlan(g.world.year, g.season.schedule.length);
    const span = pays[pays.length - 1].day - pays[0].day;
    expect(a.interest).toBeGreaterThan(0);
    expect(b.interest - a.interest).toBeCloseTo((1_000_000 * LOAN_RATE * span) / 365, -1);
    expect(b.items.interest).toBe(-b.interest);
    // 결산 셈이 아니면 장부 줄은 없고 쌓인 이자만 보인다
    const mid = seasonFlows(input(g), lg, 100);
    expect(mid.items.interest).toBeUndefined();
    expect(mid.interest).toBeGreaterThan(0);
    expect(mid.interest).toBeLessThan(b.interest);
    expect(mid.loan).toBeGreaterThan(0);
  }, 300_000);

  it('② 하루씩·저장 뒤 이어도 결산 이자·자금이 같다', () => {
    const a = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'f5-day' }, FAST);
    drain(a, lg, 1_500_000);
    const b = GameSession.load(store, roundTrip(a.toSave()) as GameSaveV2, FAST);
    a.advance(100000);
    for (let i = 0; i < 400 && !b.done; i++) {
      b.advance(1);
      if (i % 40 === 0) { b.seasonFinance(); } // 화면 조회를 끼워도
      if (i === 90) {
        const c = GameSession.load(store, roundTrip(b.toSave()) as GameSaveV2, FAST);
        c.advance(100000);
        c.advancePostseason(10_000);
        c.beginOffseason();
        a.advancePostseason(10_000);
        a.beginOffseason();
        const ya = a.league.finance![lg].history.at(-1)!;
        const yc = c.league.finance![lg].history.at(-1)!;
        expect(yc.items.interest).toBe(ya.items.interest);
        expect(yc.cash).toBe(ya.cash);
        expect(ya.items.interest).toBeLessThan(0);
        return;
      }
    }
    throw new Error('시즌이 너무 짧다');
  }, 600_000);
});

describe('③ 부채 3년 ⅓ · ④ repay-debt · ⑤ 계약금 2번', () => {
  let g: GameSession;
  let rescue: number;
  beforeAll(() => {
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'f5-debt' }, FAST);
    drain(g, lg, 3_000_000);
    toOffseason(g);
    rescue = g.league.finance![lg].history.at(-1)!.rescue;
  }, 600_000);

  it('③ 긴급 지원의 절반이 부채로 남고 3년에 나뉜다 (합 = 예전 규칙의 한 해 감액)', () => {
    expect(rescue).toBeGreaterThan(0);
    const f = g.league.finance![lg];
    expect(f.debt!.left.length).toBe(DEBT_YEARS);
    expect(f.debt!.amount).toBe(Math.round(rescue / 2));
    expect(f.debt!.left.reduce((s, v) => s + v, 0)).toBe(Math.round(rescue / 2));
    expect(Math.max(...f.debt!.left) - Math.min(...f.debt!.left)).toBeLessThanOrEqual(DEBT_YEARS);
    expect(f.history.at(-1)!.debt).toBe(f.debt!.amount);
    // 다음 시즌 모기업 지원금에서 첫 몫만 빠진다 (예전에는 절반이 한 해에)
    const trust = g.league.owner!.trust;
    const p = parentParts(g.league, lg, trust, cashOf(g.league, lg), 2027);
    expect(p.debt).toBe(f.debt!.left[0]);
    // 부채 칸이 없는 예전 저장이면 예전 규칙 (전년 긴급 지원 절반)
    const old = roundTrip(g.league);
    delete old.finance![lg].debt;
    const q = parentParts(old, lg, trust, cashOf(old, lg), 2027);
    // 예전 규칙은 지원금이 0 아래로 내려가지 않는다 (긴급 지원이 지원금의 두 배를 넘는 판: 특기 모양 2026-11-04 뒤 이 시드)
    const gross = p.support + p.debt;
    expect(q.support).toBeCloseTo(Math.max(0, gross - rescue / 2), -1);
  });

  it('부채가 3년 동안 지원금(모자라면 결산 자금)에서 빠지고 끝나면 없어진다', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    const left0 = [...r.league.finance![lg].debt!.left];
    const amounts: number[] = [];
    for (let y = 0; y < DEBT_YEARS; y++) {
      money(r, lg, 1_500_000); // 새 긴급 지원이 생기지 않게 (자금 150억, 환원 문턱 위로는 안 감)
      toStage(r, 'ready');
      expect(r.openNextSeason().ok).toBe(true);
      toOffseason(r);
      amounts.push(debtOf(r.league.finance![lg]));
      expect(r.league.finance![lg].history.at(-1)!.rescue).toBe(0);
    }
    expect(amounts[0]).toBe(left0[1] + left0[2]);
    expect(amounts[1]).toBe(left0[2]);
    expect(amounts[2]).toBe(0);
  }, 900_000);

  it('④ repay-debt: 앞 해 몫부터 줄고 수지에 넣지 않으며, 부채·자금 밖은 거절. replay·저장 왕복이 같다', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    const f = r.league.finance![lg];
    const left0 = [...f.debt!.left];
    expect(r.repayDebt(0).ok).toBe(false);
    money(r, lg, 5_000_000);
    const cash0 = cashOf(r.league, lg);
    expect(r.repayDebt(cash0 + 1).ok).toBe(debtOf(f) < cash0 + 1 ? true : false);
    const r2 = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    money(r2, lg, 5_000_000);
    const f2 = r2.league.finance![lg];
    const pay = left0[0] + 1000;
    expect(r2.repayDebt(pay).ok).toBe(true);
    expect(f2.debt!.left[0]).toBe(0);
    expect(f2.debt!.left[1]).toBe(left0[1] - 1000);
    expect(cashOf(r2.league, lg)).toBe(cash0 - pay);
    expect(r2.budgetView().plan.items.debt).toBeUndefined();
    const info = r2.reproInfo();
    const back = GameSession.replay(store, roundTrip(info.opts), roundTrip(info.actions), info.at, FAST);
    expect(back.league.finance![lg].debt).toEqual(f2.debt);
    expect(cashOf(back.league, lg)).toBe(cashOf(r2.league, lg));
    const saved = GameSession.load(store, roundTrip(r2.toSave()) as GameSaveV2, FAST);
    expect(saved.league.finance![lg].debt).toEqual(f2.debt);
    expect(r2.repayDebt(10 ** 9).ok).toBe(true); // 남은 것 모두 (부채만큼만)
    expect(debtOf(f2)).toBe(0);
    expect(r2.repayDebt(1000).ok).toBe(false);
    expect(cashOf(r2.league, lg)).toBe(cash0 - Math.round(rescue / 2));
  });

  it('⑤ 다년 계약 계약금: 계약 때 절반은 장부, 남은 절반은 개막일에 나가 결산 계약금 = 전체', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    money(r, lg, 5_000_000);
    toStage(r, 'salary');
    const offer = r.extensionOffers()[0];
    expect(offer).toBeTruthy();
    const before = ledgerItems(r.league, lg, r.year + 1).signing ?? 0;
    const cash0 = cashOf(r.league, lg);
    expect(r.extend(offer.p.id, 4).ok).toBe(true);
    const nowPaid = before - (ledgerItems(r.league, lg, r.year + 1).signing ?? 0);
    const due = dueOf(r.league.finance![lg], r.year + 1);
    const bonus = nowPaid + due;
    expect(nowPaid).toBe(bonusNow(bonus));
    expect(due).toBe(bonus - bonusNow(bonus));
    expect(cashOf(r.league, lg)).toBe(cash0 - nowPaid);
    // 예산안 계획에 남은 절반까지 들어 있다
    expect(r.budgetView().plan.items.signing).toBe(before - nowPaid - due);
    // 저장 왕복
    const saved = GameSession.load(store, roundTrip(r.toSave()) as GameSaveV2, FAST);
    expect(saved.league.finance![lg].due).toEqual(r.league.finance![lg].due);
    // 개막일에 나간다
    toStage(r, 'ready');
    expect(r.openNextSeason().ok).toBe(true);
    const flows0 = r.seasonFinance()!;
    expect(flows0.items.signing).toBe(-due);
    toOffseason(r);
    const y = r.league.finance![lg].history.at(-1)!;
    expect(y.items.signing).toBe(-(bonus - before));
    expect(r.league.finance![lg].due ?? []).toEqual([]);
  }, 900_000);
});

describe('⑥ 늦은 개막 해 (2020)', () => {
  it('개막일 지급(2~4월분)과 계약금 남은 절반이 개막일 칸에 함께 나가고, 개막 날 자금에 보인다', () => {
    const g = GameSession.create(store, { year: 2019, teamIdx: 0, seed: 'f5-2020' }, FAST);
    toOffseason(g);
    money(g, 0, 5_000_000);
    toStage(g, 'salary');
    const offer = g.extensionOffers()[0];
    expect(g.extend(offer.p.id, 4).ok).toBe(true);
    const due = dueOf(g.league.finance![0], 2020);
    expect(due).toBeGreaterThan(0);
    toStage(g, 'ready');
    expect(g.openNextSeason().ok).toBe(true);
    expect(g.world.year).toBe(2020);
    const pays = payPlan(2020, g.season.schedule.length);
    expect(pays.reduce((s, p) => s + p.months.length, 0)).toBe(10);
    expect(pays[0].when).toBe('open');
    expect(pays[0].months).toEqual([2, 3, 4]);
    const f = g.seasonFinance()!;
    expect(f.items.signing).toBe(-due);
    expect(f.months[0].net).toBeLessThan(-due + 1); // 개막일 칸에 계약금 남은 절반이 함께
  }, 900_000);
});
