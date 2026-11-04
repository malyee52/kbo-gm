// 재정 2 F7 (2026-11-04 사용자 결정): 모기업 환원 없앰, 관중 수입 리그 배분, 쌓인 현금을 쓸 곳(투자 상한·AI 여유 자금 투자),
// 목표 높이기 약속(이미 우승 목표면 우승 못 할 때 감점), 구단주 난이도(보통부터 목표 달성 신뢰 증가 절반).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import {
  AI_SURPLUS_FROM, AI_SURPLUS_RATE, aiSurplusBudget, BUDGET_KINDS, budgetRange, financePlan, GATE_SHARE, gateShares, INVEST_CAP_SCALE, INVEST_CAP_SCALE_SINK,
  INVEST_COST, PRESET_BUDGET, seasonFlows,
} from '../src/league/finance';
import { ownerGainOf, PRESETS } from '../src/league/difficulty';
import { raiseCapped, TRUST_RAISE_CAPPED } from '../src/league/meeting';
import { trustDelta } from '../src/league/owner';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

describe('관중 수입 리그 배분', () => {
  it('합은 0 (반올림만), 관중 수입이 평균보다 적은 구단은 받고 많은 구단은 내며, 크기는 GATE_SHARE × (평균 − 자기 몫)', () => {
    const g = GameSession.create(store, opts('f7-gate'), FAST);
    g.advance(100000);
    const input = { league: g.league, world: g.world, season: g.season, trades: g.tradeMoves() };
    const sh = gateShares(input);
    const gates = g.world.teams.map((_, t) => seasonFlows(input, t, Number.MAX_SAFE_INTEGER).items.gate ?? 0);
    const avg = gates.reduce((a, b) => a + b, 0) / gates.length;
    expect(Math.abs(sh.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(sh.length);
    gates.forEach((gt, t) => expect(Math.abs(sh[t] - GATE_SHARE * (avg - gt))).toBeLessThanOrEqual(1));
    const lo = gates.indexOf(Math.min(...gates));
    const hi = gates.indexOf(Math.max(...gates));
    expect(sh[lo]).toBeGreaterThan(0);
    expect(sh[hi]).toBeLessThan(0);
    // 결산 셈에만 '중계권·리그 배분' 줄로 들어간다
    const full = seasonFlows({ ...input, settle: true }, lo, Number.MAX_SAFE_INTEGER).items.broadcast ?? 0;
    const part = seasonFlows(input, lo, Number.MAX_SAFE_INTEGER).items.broadcast ?? 0;
    expect(full - part).toBeGreaterThan(sh[lo]);
    // 결산 뒤 장부에도 같은 몫 (흑자는 환원 없이 남는다)
    g.beginOffseason();
    expect(g.league.ledger.some((e) => e.kind === 'dividend')).toBe(false);
    // 다음 시즌 계획도 배분을 짐작해 넣는다: 관중이 적은 구단의 계획 중계권 줄이 기본액보다 크다
    const plan = financePlan({ league: g.league, world: g.world }, lo, 2027);
    expect(plan.items.broadcast ?? 0).toBeGreaterThan(1_000_000 * 1.04);
  });
});

describe('쌓인 현금을 쓸 곳', () => {
  it('돈으로 돌아오지 않는 투자 넷의 상한은 3단계 × 2.5, 마케팅은 × 1.5 그대로', () => {
    for (const k of ['scout', 'scoutPro', 'develop', 'medical'] as const) expect(budgetRange(k)[1]).toBe(Math.floor((INVEST_COST[k][3] * INVEST_CAP_SCALE_SINK) / 1000) * 1000);
    expect(budgetRange('marketing')[1]).toBe(Math.floor((INVEST_COST.marketing[3] * INVEST_CAP_SCALE) / 1000) * 1000);
  });

  it('AI 여유 자금 투자: 문턱 아래면 그대로, 위면 넘는 몫 × 비율만큼 더 쓰고(상한에서 멈춤) 마케팅은 건드리지 않는다', () => {
    const base = { ...PRESET_BUDGET.balance };
    expect(aiSurplusBudget(base, AI_SURPLUS_FROM, 1)).toEqual(base);
    const cash = AI_SURPLUS_FROM + 1_000_000;
    const up = aiSurplusBudget(base, cash, 1);
    const extra = BUDGET_KINDS.reduce((s, k) => s + up[k] - base[k], 0);
    expect(extra).toBeLessThanOrEqual(1_000_000 * AI_SURPLUS_RATE);
    expect(extra).toBeGreaterThan(1_000_000 * AI_SURPLUS_RATE - 7_000); // 1천만 원 단위 내림만
    expect(up.marketing).toBe(base.marketing);
    for (const k of BUDGET_KINDS) { expect(up[k]).toBeGreaterThanOrEqual(base[k]); expect(up[k]).toBeLessThanOrEqual(budgetRange(k)[1]); }
    const huge = aiSurplusBudget(base, 1e9, 1);
    for (const k of ['develop', 'medical', 'scout', 'scoutPro', 'front', 'futures'] as const) expect(huge[k]).toBe(budgetRange(k)[1]);
  });
});

describe('구단주 난이도와 목표 높이기 약속', () => {
  it('목표 달성 때 신뢰도 증가 배율: 쉬움 1, 보통·어려움 0.5, 칸 없는 예전 사용자 설정은 0.5', () => {
    expect(ownerGainOf({ difficulty: 'easy' })).toBe(1);
    expect(ownerGainOf({ difficulty: 'normal' })).toBe(0.5);
    expect(ownerGainOf({ difficulty: 'hard' })).toBe(0.5);
    const { ownerGain: _, ...old } = PRESETS.easy;
    expect(ownerGainOf({ difficulty: 'normal', settings: old })).toBe(0.5);
  });

  it('약속이 걸리는 때: 목표를 올렸고(goalShift +1) 회의 전 목표가 이미 우승일 때만', () => {
    expect(raiseCapped({ goalShift: 1 }, 'champion')).toBe(true);
    expect(raiseCapped({ goalShift: 1 }, 'postseason')).toBe(false);
    expect(raiseCapped({ goalShift: 0 }, 'champion')).toBe(false);
    expect(raiseCapped(undefined, 'champion')).toBe(false);
    expect(TRUST_RAISE_CAPPED).toBeLessThan(0);
  });

  it('세션: 보통 난이도 목표 달성은 절반만 오르고, 우승 목표에서 약속한 판은 우승을 못 하면 감점이 더해진다', () => {
    const run = (promise: boolean) => {
      const g = GameSession.create(store, opts('f7-owner'), FAST);
      g.advance(100000);
      const o = g.owner;
      // 전력 1위 예상(회의 전 목표 우승)으로 고정, 약속 판은 회의 기록을 넣는다
      o.goal = { year: 2026, kind: 'champion', projectedRank: 1 };
      if (promise) g.league.finance![lg].meetings = [{ year: 2026, ask: 'raiseGoal', result: 'promised', goalShift: 1, trust: 0, reason: '' }];
      const before = o.trust;
      g.advancePostseason(10_000);
      g.beginOffseason();
      const h = o.history.at(-1)!;
      return { g, h, before };
    };
    const a = run(false);
    const b = run(true);
    // 결과는 같은 판 (약속은 돈만 바꾸지 않게 기록만 넣었다)
    expect(b.h.result).toBe(a.h.result);
    const evalNews = (g: GameSession) => g.news.find((n) => n.year === 2026 && n.text.startsWith('구단주 평가'))!.text;
    if (a.h.champion) {
      expect(evalNews(b.g)).not.toContain('약속을 못 지킴');
    } else {
      expect(evalNews(b.g)).toContain(`약속을 못 지킴 ${TRUST_RAISE_CAPPED}`);
      expect(evalNews(a.g)).not.toContain('약속을 못 지킴');
    }
    // 보통 난이도 달성 몫: trustDelta의 양수 몫 × 0.5
    const td = trustDelta('postseason', { rank: 3, nTeams: 10, postseasonTeams: 5, champion: false, finalist: false, capOver: false });
    expect(Math.round(td.delta * ownerGainOf(a.g.league))).toBe(6);
  });
});
