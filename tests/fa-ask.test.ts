// FA 시장 연봉식의 꼬리 (2026-10-29 사용자 "FA 금액이 너무 뻥튀기 된다"): 꺾이는 점 위는 완만하게, 역함수는 그대로 맞아야 한다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { currentRuns } from '../src/ai/value';
import { GameSession } from '../src/game/session';
import { faAskParts, leagueView, TWO_WAY_ASK_SHARE } from '../src/league/offseason';
import { MARKET_KNEE, marketSalary, runsForSalary } from '../src/league/salary';
import { runsForGradeAt } from '../src/league/twoway';

describe('시장 연봉식 꺾임 (salary.ts MARKET_KNEE)', () => {
  it('꺾이는 점 아래는 예전 식(1200 × 런^1.31) 그대로', () => {
    for (const r of [8, 20, 35, MARKET_KNEE]) expect(marketSalary(r)).toBe(Math.max(3000, Math.round(1200 * r ** 1.31)));
  });

  it('꺾이는 점에서 이어지고, 위로는 계속 오르되 예전 식보다 덜 오른다', () => {
    expect(Math.abs(marketSalary(MARKET_KNEE + 0.01) - marketSalary(MARKET_KNEE))).toBeLessThan(100);
    let prev = marketSalary(MARKET_KNEE);
    for (const r of [60, 70, 80, 90, 100, 120]) {
      const v = marketSalary(r);
      expect(v).toBeGreaterThan(prev);
      expect(v).toBeLessThan(1200 * r ** 1.31);
      prev = v;
    }
  });

  it('2026년 물가로 90런 약 28억, 100런 약 31억 (실제 최고 FA 연평균 20억대 중반, 미확인)', () => {
    expect(marketSalary(90) / 10000).toBeCloseTo(28.8, 0);
    expect(marketSalary(100) / 10000).toBeCloseTo(30.6, 0);
  });

  it('역함수가 꺾임 위아래 모두 맞고 연봉 상승 지수를 나눈다', () => {
    for (const wage of [1, 1.5, 2.53]) {
      for (const r of [5, 20, 49, 50, 51, 75, 110]) expect(runsForSalary(marketSalary(r, wage, 0), wage)).toBeCloseTo(r, 2);
    }
  });
});

describe('이도류 FA 요구액 (offseason.ts faAskParts, 2026-10-29 사용자 "성적·잠재력은 그대로 두고 FA 요구액만")', () => {
  let store: DataStore;
  const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
  beforeAll(() => { store = loadDataStore(); }, 120_000);

  it('본업 시장가 + 반대쪽 시장가 × TWO_WAY_ASK_SHARE: 합친 런 하나로 매긴 값보다 낮고 본업만보다는 높다. 기여(런)는 그대로', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fa-ask-1' }, FAST);
    const ace = g.team.org.filter((p) => p.isPitcher && !p.foreign && (p.pit?.startShare ?? 0) > 0.8).sort((a, b) => a.value - b.value)[0];
    const lp = g.leaguePlayer(ace.id)!;
    const before = leagueView(g.league, store, FAST);
    const solo = faAskParts(before.sim.get(ace.id)!, 4, before);
    expect(solo.share).toBe(0);
    lp.alt = { runs: runsForGradeAt(65, 2026), potential: runsForGradeAt(70, 2026) }; // 시험용: 타격이 좋은 투수
    expect(g.setTwoWay(ace.id, true).ok).toBe(true);
    const view = leagueView(g.league, store, FAST);
    const sp = view.sim.get(ace.id)!;
    const parts = faAskParts(sp, 4, view);
    expect(parts.share).toBeGreaterThan(0.1);
    expect(currentRuns(sp, view.ctx)).toBeGreaterThan(currentRuns(before.sim.get(ace.id)!, before.ctx));
    expect(parts.ask).toBeLessThan(marketSalary(parts.avg, view.wage, view.minPay));
    expect(parts.ask).toBeGreaterThan(marketSalary(parts.avg * (1 - parts.share), view.wage, view.minPay));
    expect(parts.ask).toBe(marketSalary(parts.avg * (1 - parts.share), view.wage, view.minPay) + Math.round(marketSalary(parts.avg * parts.share, view.wage, 0) * TWO_WAY_ASK_SHARE));
  }, 300_000);
});
