// 재정 상세형 1단계 (docs/finance.md, 2026-10-11): 구단 자금 = 장부 합, 경기마다 관중 수입, 월말 지출, 결산과 적자 보전.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { activeLevel, cashOf, faSupportCap, faSupportLeft, investCost, ledgerFlow, MEDICAL_RATE, payOf, SCOUT_NOISE, signingBonus, START_CASH, WON_PER_USD } from '../src/league/finance';
import * as Off from '../src/league/offseason';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

describe('재정 기반', () => {
  it('새 게임: 모든 구단이 시작 자금으로 출발한다', () => {
    const g = GameSession.create(store, opts('fin-a'), FAST);
    for (let t = 0; t < g.league.teams.length; t++) expect(cashOf(g.league, t)).toBe(START_CASH);
    expect(g.cashNow()).toBe(START_CASH);
  });

  it('시즌 중 수입·지출은 진행 방식과 상관없이 같다 (하루씩 vs 한 번에), 홈 경기마다 관중 수입이 들어온다', () => {
    const a = GameSession.create(store, opts('fin-b'), FAST);
    const b = GameSession.create(store, opts('fin-b'), FAST);
    for (let i = 0; i < 40; i++) a.advance(1);
    b.advance(40);
    expect(a.seasonFinance()).toEqual(b.seasonFinance());
    const f = a.seasonFinance()!;
    expect(f.homeGames).toBeGreaterThan(10);
    expect(f.items.gate).toBeGreaterThan(0);
    expect(f.items.payroll).toBeLessThan(0); // 4월 말 지급
    // 장부(시작 자금 + 이벤트 수입·지출) + 시즌 중 흐름
    expect(a.cashNow()).toBe(cashOf(a.league, lg) + Object.values(f.items).reduce((s, v) => s + (v ?? 0), 0));
    expect(a.league.ledger.filter((e) => e.kind !== 'event' && (e.to === lg || e.from === lg)).reduce((s, e) => s + ledgerFlow(e, lg), 0)).toBe(START_CASH);
  });

  it('결산: 구단마다 결산이 남고, 자금은 장부 합과 같으며, 저장했다 불러와도 같다', () => {
    const g = GameSession.create(store, opts('fin-c'), FAST);
    g.advance(100000);
    g.advancePostseason(10_000); // 가을야구 홈 경기 수입까지
    const before = g.cashNow();
    const monthlySponsor = g.seasonFinance()!.items.sponsor ?? 0;
    g.beginOffseason();
    const L = g.league;
    for (let t = 0; t < L.teams.length; t++) {
      const y = L.finance![t].history.at(-1)!;
      expect(y.year).toBe(2026);
      expect(y.items.broadcast).toBeGreaterThan(0);
      expect(cashOf(L, t)).toBe(y.cash + L.ledger.filter((e) => e.year > 2026).reduce((s, e) => s + ledgerFlow(e, t), 0));
      expect(y.cash).toBeGreaterThanOrEqual(0);
    }
    // 결산 직전 자금(시즌 중 흐름 포함) + 결산 때 정산하는 것(스폰서 차액, 우승 배당) = 결산 뒤 자금 (긴급 지원 포함)
    const mine = L.finance![lg].history.at(-1)!;
    const settleOnly = (mine.items.sponsor ?? 0) - monthlySponsor + (mine.items.champion ?? 0);
    expect(mine.cash).toBe(Math.max(0, before + settleOnly) - (mine.dividend ?? 0)); // 100억 넘으면 모기업 환원
    expect(mine.items.broadcast).toBeGreaterThan(0); // 월말에 나눠 받은 중계권도 결산표에 있다
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(h.cashNow()).toBe(g.cashNow());
    expect(h.league.finance).toEqual(L.finance);
  });

  it('적자가 나면 모기업이 0까지 메우고, 구단주 신뢰도가 떨어지며 알림이 나온다', () => {
    const g = GameSession.create(store, opts('fin-d'), FAST);
    // 연봉을 크게 올려 적자를 만든다 (월말 지급은 개막 때 리그 상태의 계약을 쓴다)
    for (const p of g.league.players) if (p.team === lg && !p.foreign) p.contract.salary *= 6;
    g.advance(100000);
    const trust0 = g.owner.trust;
    g.beginOffseason();
    const y = g.league.finance![lg].history.at(-1)!;
    expect(y.rescue).toBeGreaterThan(0);
    expect(y.cash).toBe(0);
    expect(g.news.some((n) => n.text.startsWith('재정 결산: 적자'))).toBe(true);
    const h = g.owner.history.at(-1)!;
    expect(h.trustAfter).toBeLessThan(trust0 + 12); // 목표 달성(+12) 이상은 오르지 않는다
    expect(g.league.ledger.some((e) => e.kind === 'rescue' && e.to === lg)).toBe(true);
  });

  it('보상금·제재금은 실제 자금이 된다 (장부에 남는 순간 자금이 바뀐다)', () => {
    const g = GameSession.create(store, opts('fin-e'), FAST);
    const c0 = cashOf(g.league, lg);
    g.league.ledger.push({ year: 2026, from: (lg + 1) % 10, to: lg, amount: 30_000, note: '테스트 보상금' });
    expect(cashOf(g.league, lg)).toBe(c0 + 30_000);
  });
});

describe('투자 4종', () => {
  it('시즌 중에는 투자를 바꿀 수 없고, 오프시즌 계획은 개막 때 확정된다 (AI 구단도 이때 정한다)', () => {
    const g = GameSession.create(store, opts('inv-a'), FAST);
    expect(g.setInvest('medical', 3).ok).toBe(false); // 시즌 중
    g.advance(100000);
    g.beginOffseason();
    expect(g.setInvest('medical', 3).ok).toBe(true);
    expect(g.setInvest('scout', 4).ok).toBe(false);
    expect(activeLevel(g.league, lg, 'medical')).toBe(1); // 아직 지난 시즌 단계
    let guard = 0;
    while (g.offseason!.stage !== 'ready' && guard++ < 40) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    expect(g.openNextSeason().ok).toBe(true);
    expect(activeLevel(g.league, lg, 'medical')).toBe(3);
    const ai = g.league.finance!.filter((_, t) => t !== lg);
    expect(ai.every((f) => f.active && Object.values(f.active).every((v) => v >= 0 && v <= 3))).toBe(true);
    // 월말 투자비는 확정한 단계로 나간다
    g.advance(60);
    const f = g.seasonFinance()!;
    const paid = -(f.items.invest ?? 0);
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(investCost(g.league.finance![lg]));
  });

  it('의료 투자: 같은 시드에서 부상 확률·결장 기간이 줄어 부상 결장 일수가 줄어든다', () => {
    const run = (level: number) => {
      const g = GameSession.create(store, opts('inv-med'), FAST);
      for (const f of g.league.finance!) f.active = { scout: 1, develop: 1, medical: level, marketing: 1 };
      const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST); // 월드를 투자 단계로 다시 만든다
      h.advance(100000);
      return h.season.absences.filter((a) => a.kind !== 'event').reduce((s, a) => s + (a.until - a.day), 0);
    };
    expect(MEDICAL_RATE[3]).toBeLessThan(1);
    expect(run(3)).toBeLessThan(run(0));
  });

  it('스카우트: 우리 구단 단계가 높을수록 드래프트 후보 잠재력 평가 오차가 작다', () => {
    const err = (level: number) => {
      const g = GameSession.create(store, opts('inv-scout'), FAST);
      g.league.finance![lg].active!.scout = level;
      g.advance(100000);
      g.beginOffseason();
      let guard = 0;
      while (g.offseason!.stage !== 'draft' && guard++ < 30) { if (g.offseason!.stage === 'comp') g.autoComp(); g.nextStage(); }
      const d = g.offseason!.draft!;
      const ps = [...d.pool, ...d.picks.map((x) => x.id)].map((id) => g.leaguePlayer(id)!);
      return Math.max(...ps.map((p) => Math.abs((p.scoutPotential ?? p.potential) - p.potential)));
    };
    expect(err(3)).toBeLessThanOrEqual(SCOUT_NOISE[3] + 0.5);
    expect(err(0)).toBeGreaterThan(SCOUT_NOISE[3] + 0.5);
  });
});

describe('새 지출: FA 계약금, 외국인 이적료, 현금 트레이드', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, opts('spend'), FAST);
    g.advance(100000);
    g.beginOffseason();
  }, 120_000);

  it('FA: 계약하면 계약금(총액의 30%)이 장부에 남고 그만큼 월말 연봉에서 빠진다. 자금이 모자라면 모기업이 한 해 한도 안에서 모자란 몫을 대 준다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    // 자금으로 계약금을 낼 수 있는 FA (시즌 결과에 따라 첫 FA가 너무 비쌀 수 있다)
    const cash = cashOf(h.league, lg);
    // 모기업 지원 한도(2026-10-21) 안의 계약금
    const cap = faSupportCap(h.league, lg);
    const e = h.offseason!.fa.entries.find((x) => x.from !== lg && x.status === 'open' && signingBonus(Math.round(x.ask * 1.3), x.years) < Math.min(cash * 0.8, cap))!;
    expect(e).toBeDefined();
    // 자금을 바닥내도 제시할 수 있고, 계약하면 모자란 계약금을 모기업이 대 준다 (2026-10-21 사용자 결정. 그 전에는 제시가 막혔다)
    h.league.ledger.push({ year: 2027, from: lg, to: -1, amount: cash, note: '테스트 지출' });
    const salary = Math.round(e.ask * 1.3);
    const r = h.offerFa(e.id, salary, e.years);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('모기업');
    h.nextStage();
    const p = h.leaguePlayer(e.id)!;
    expect(p.team).toBe(lg);
    const fee = h.league.ledger.find((x) => x.kind === 'signing' && x.note.startsWith(p.name))!;
    expect(fee.amount).toBe(signingBonus(salary, e.years));
    expect(fee.from).toBe(lg);
    expect(payOf(p)).toBe(salary - Math.round(fee.amount / e.years));
    const help = h.league.ledger.find((x) => x.kind === 'faSupport' && x.note.startsWith(p.name))!;
    expect(help).toMatchObject({ from: -1, to: lg, amount: fee.amount });
    expect(cashOf(h.league, lg)).toBe(0);
    expect(h.offseason!.log.some((l) => l.mine && l.text.includes('모기업이 지원'))).toBe(true);
    // 그해 남은 한도를 넘는 계약금은 예전처럼 제시할 수 없다
    const left = faSupportLeft(h.league, lg, 2027);
    expect(left).toBe(cap - help.amount);
    const big = h.offseason!.fa.entries.find((x) => x.from !== lg && x.status === 'open');
    if (big) {
      const years = 4;
      const salary = Math.ceil(((left + 10_000) / 0.3) / years);
      const r2 = h.offerFa(big.id, salary, years);
      expect(r2.ok).toBe(false);
      expect(r2.message).toContain('제시할 수 없');
    }
  });

  it('외국인: 새 후보에는 이적료가 붙고, 계약하면 자금에서 나간다. 자금이 모자라면 계약할 수 없다', () => {
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    let guard = 0;
    while (h.offseason!.stage !== 'foreign' && guard++ < 10) { if (h.offseason!.stage === 'comp') h.autoComp(); h.nextStage(); }
    const off = h.offseason!;
    const cand = off.foreign!.pool.map((id) => h.leaguePlayer(id)!).find((p) => p.transferFee && Off.canSignForeign(h.league, off, lg, p).ok);
    if (!cand) return; // 우리 차례가 아니거나 자리가 없으면 넘어간다
    const before = cashOf(h.league, lg);
    const fee = Math.round(cand.transferFee! * WON_PER_USD);
    // 자금이 모자라면 막힌다
    h.league.ledger.push({ year: 2027, from: lg, to: -1, amount: before - fee + 1, note: '테스트 지출' });
    expect(Off.canSignForeign(h.league, off, lg, cand).ok).toBe(false);
    h.league.ledger.pop();
    expect(h.signForeign(cand.id).ok).toBe(true);
    expect(cashOf(h.league, lg)).toBe(before - fee);
    expect(h.leaguePlayer(cand.id)!.transferFee).toBeUndefined();
  });

  it('현금 트레이드: 현금만으로 선수를 사면 자금이 옮겨 가고, 조작 기록으로 다시 돌려도 같다', () => {
    const a = GameSession.create(store, opts('cash-trade'), FAST);
    a.advance(20);
    const ai = (lg + 3) % a.world.teams.length;
    // 상대 구단의 덜 중요한 국내 선수 한 명을 현금으로 산다
    const target = [...a.world.teams[ai].org].filter((p) => !p.foreign).sort((x, y) => x.value - y.value).at(-1)!;
    const tooMuch = a.proposeTrade(ai, [], [target], a.cashNow() + 10_000);
    expect(tooMuch.verdict).toBe('reject-invalid'); // 자금보다 많이 줄 수 없다
    const before = a.cashNow();
    const beforeAi = a.cashNow(ai);
    const pay = 50_000; // 5억 원
    expect(pay).toBeLessThan(before);
    const ev = a.proposeTrade(ai, [], [target], pay);
    expect(ev.verdict, ev.message).toBe('accept');
    expect(a.cashNow()).toBe(before - pay);
    expect(a.cashNow(ai)).toBe(beforeAi + pay);
    expect(a.actions.at(-1)).toMatchObject({ type: 'trade', cash: pay });
    const r = GameSession.replay(store, opts('cash-trade'), a.actions, { year: 2026, day: a.day }, FAST);
    expect(r.cashNow()).toBe(a.cashNow());
    expect(r.world.players.find((p) => p.id === target.id)!.teamIdx).toBe(lg);
  });
});

describe('자금이 끝없이 쌓이지 않는다 (2026-10-11 사용자: 돈이 너무 넉넉하다)', () => {
  it('세 시즌 동안 결산 뒤 자금이 100억 원을 넘으면 넘는 몫의 절반을 모기업에 돌려주고, 어느 구단도 200억 원을 넘지 않는다', () => {
    const g = GameSession.create(store, opts('fin-cap'), FAST);
    for (let y = 0; y < 3; y++) {
      g.advance(100000);
      g.beginOffseason();
      for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
        const st = g.offseason!.stage;
        if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
        g.nextStage();
      }
      expect(g.openNextSeason().ok).toBe(true);
    }
    const L = g.league;
    let paid = 0;
    for (let t = 0; t < L.teams.length; t++) {
      for (const y of L.finance![t].history) {
        expect(y.cash, `${L.teams[t].name} ${y.year}`).toBeLessThan(2_000_000);
        if (y.dividend) {
          paid++;
          expect(y.cash).toBeGreaterThanOrEqual(1_000_000);
          expect(y.cash + y.dividend - 1_000_000).toBeCloseTo(y.dividend * 2, -1);
        }
      }
    }
    expect(paid).toBeGreaterThan(0);
  }, 400_000);
});
