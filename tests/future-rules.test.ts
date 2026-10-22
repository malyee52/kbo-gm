// 리그 규칙 변경 1-8: 2028년 이후 미래 규칙 변경 ② (기획안 4장). 판정·쿨다운·범위·결정성, 월드·캡·외국인·알림 반영.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { createLeague } from '../src/league/create';
import { foreignRule } from '../src/league/eras';
import {
  ballD2, ballHrMul, COR_HIGH, COR_LOW, corRange, FUTURE_RULE_SPEC, FUTURE_RULES_FROM, futureValue, judgeFutureRules, seasonCor, SHIFT_COOLDOWN, type FutureRuleKey, type RuleShift, type RuleSignal,
} from '../src/league/futureRules';
import { ruleNews, ruleSnapshot } from '../src/league/ruleNews';
import { salaryCap } from '../src/league/salary';
import type { LeagueState } from '../src/league/types';
import { worldFromLeague } from '../src/league/world';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

/** 기준 안의 평범한 신호 */
const calm = (year: number, o: Partial<RuleSignal> = {}): RuleSignal => ({
  year, hr: 1, so: 1, bb: 1, draw: 0.025, absence: 1000, attendance: 12000, foreignShare: 0.08, deficit: 1, capOver: 0, capUse: 0.7, ...o,
});

const bare = (seed = 'fr', fantasy = false): LeagueState => ({ seed, ...(fantasy ? { fantasy: {} } : {}) }) as unknown as LeagueState;

describe('판정 (임시값: 2시즌 연속, 한 해 최대 1개, 쿨다운 3시즌, 누적 범위)', () => {
  it('2027 시즌 신호부터 남기고, 같은 쪽으로 2시즌 이어서 벗어나야 바뀐다', () => {
    const L = bare();
    expect(judgeFutureRules(L, calm(2026, { hr: 1.3 }))).toBeNull();
    expect(L.ruleSignals ?? []).toHaveLength(0);
    expect(judgeFutureRules(L, calm(2027, { hr: 1.2 }))).toBeNull(); // 한 시즌만
    const s = judgeFutureRules(L, calm(2028, { hr: 1.15 }))!;
    expect(s).toMatchObject({ year: 2029, key: 'ball', before: 1, after: 0.94 });
    expect(s.reason).toContain('게임 속 가상 결정');
    expect(s.reason).toContain('낮춘다');
    expect(futureValue(L, 'ball', 2028)).toBe(1);
    expect(futureValue(L, 'ball', 2029)).toBe(0.94);
  });

  it('바뀐 항목은 3시즌 동안 다시 후보가 되지 않고, 누적 범위를 넘지 않는다', () => {
    const L = bare();
    const years: number[] = [];
    for (let y = 2027; y < 2080; y++) {
      const s = judgeFutureRules(L, calm(y, { hr: 1.3 }));
      if (s) years.push(s.year);
    }
    for (let i = 1; i < years.length; i++) expect(years[i] - years[i - 1]).toBeGreaterThan(SHIFT_COOLDOWN);
    expect(futureValue(L, 'ball', 2080)).toBeCloseTo(FUTURE_RULE_SPEC.ball.min + 0.01, 5); // 1 - 0.06 × 4 = 0.76 (0.70은 범위 밖)
    expect(L.ruleShifts!.every((s) => s.after >= FUTURE_RULE_SPEC.ball.min && s.after <= FUTURE_RULE_SPEC.ball.max)).toBe(true);
  });

  it('후보가 여럿이어도 한 해에 하나, 같은 시드 → 같은 선택', () => {
    const run = (seed: string) => {
      const L = bare(seed);
      for (let y = 2027; y < 2040; y++) judgeFutureRules(L, calm(y, { hr: 1.3, draw: 0.06, absence: y > 2027 ? 1500 : 1000, attendance: 12000 - 300 * (y - 2027), capOver: 5 }));
      return L.ruleShifts!;
    };
    const a = run('same');
    expect(run('same')).toEqual(a);
    const perYear = new Map<number, number>();
    for (const s of a) perYear.set(s.year, (perYear.get(s.year) ?? 0) + 1);
    expect(Math.max(...perYear.values())).toBe(1);
    expect(new Set(a.map((s) => s.key)).size).toBeGreaterThan(2);
  });

  it('외국인 한도는 흥행·재정으로: 관중이 3년 이어 줄면 +1, 외국인 연봉 부담·적자가 3년 이어 크면 −1, 엇갈리거나 작은 흔들림은 그대로', () => {
    const run = (o: (y: number) => Partial<RuleSignal>) => {
      const L = bare();
      const got: RuleShift[] = [];
      for (let y = 2027; y < 2036; y++) { const s = judgeFutureRules(L, calm(y, o(y))); if (s) got.push(s); }
      return got.filter((s) => s.key === 'foreign');
    };
    // 2027 → 2030 시즌 세 해 이어 줄어 (−9%) 2031년 +1. 까닭에 관중 수가 보인다
    const up = run((y) => ({ attendance: 12000 - 360 * (y - 2027) }));
    expect(up[0]).toMatchObject({ year: 2031, before: 3, after: 4 });
    expect(up[0].reason).toContain('관중이 3년 이어 줄어');
    expect(up[0].reason).toContain('12,000명');
    expect(up[0].reason).toContain('외국인 보유 한도 확대에 합의');
    // 줄다가 한 해 늘면 이어지지 않는다, 줄어든 폭이 3% 밑이면 그대로
    expect(run((y) => ({ attendance: y === 2029 ? 12500 : 12000 - 300 * (y - 2027) }))[0]?.year ?? Infinity).toBeGreaterThan(2031);
    expect(run((y) => ({ attendance: 12000 - 50 * (y - 2027) }))).toEqual([]);
    // 부담: 2027~2029 시즌 이어서 → 2030년 −1
    const down = run(() => ({ foreignShare: 0.15, deficit: 5 }));
    expect(down[0]).toMatchObject({ year: 2030, before: 3, after: 2 });
    expect(down[0].reason).toContain('적자 구단이 3년 이어 5곳 이상');
    expect(run(() => ({ foreignShare: 0.15, deficit: 2 }))).toEqual([]);
    // 엇갈리면 판정하지 않는다 (2030 시즌에 둘 다 처음 채워진다)
    expect(run((y) => ({ attendance: 12000 - 360 * (y - 2027), ...(y >= 2028 ? { foreignShare: 0.15, deficit: 5 } : {}) }))[0]?.year ?? Infinity).toBeGreaterThan(2031);
    // 예전 저장의 신호(흥행·재정 값 없음)는 판정하지 않는다
    expect(run(() => ({ attendance: undefined, foreignShare: undefined, deficit: undefined }))).toEqual([]);
  });

  it('판타지·자유 모드에서는 바뀌지 않는다', () => {
    const L = bare('fr', true);
    for (let y = 2027; y < 2035; y++) expect(judgeFutureRules(L, calm(y, { hr: 1.3 }))).toBeNull();
  });

  it('항목별 방향: 무승부 많음 → 연장 +1, 결장 증가 → 엔트리 +1, 관중 감소 → 외국인 +1, 캡 초과 많음 → 상향률 +2%p', () => {
    const one = (o: (y: number) => Partial<RuleSignal>, key: FutureRuleKey) => {
      const L = bare();
      let s: RuleShift | null = null;
      for (let y = 2027; y < 2040 && !s; y++) s = judgeFutureRules(L, calm(y, o(y)));
      expect(s?.key).toBe(key);
      return s!;
    };
    expect(one(() => ({ draw: 0.05 }), 'extra')).toMatchObject({ before: 11, after: 12 });
    expect(one((y) => ({ absence: y === 2027 ? 1000 : 1300 }), 'roster')).toMatchObject({ before: 29, after: 30 });
    expect(one((y) => ({ attendance: 12000 - 400 * (y - 2027) }), 'foreign')).toMatchObject({ year: 2031, before: 3, after: 4 });
    expect(one(() => ({ capOver: 4 }), 'capGrowth')).toMatchObject({ before: 0.05, after: 0.07 });
    expect(one(() => ({ so: 1.15 }), 'zone')).toMatchObject({ before: 1, after: 0.97 });
  });
});

describe('반영 (자료 없는 해만)', () => {
  const shift = (key: FutureRuleKey, year: number, after: number): RuleShift => ({ year, key, before: FUTURE_RULE_SPEC[key].base, after, reason: '시험 (게임 속 가상 결정)', signal: 0 });

  it('변경이 없으면 2027~ 월드·캡·외국인이 지금과 같다', () => {
    const { league } = createLeague(store, 2026, 'fr-w', FAST);
    league.year = 2030;
    const a = worldFromLeague(structuredClone(league), store, FAST);
    league.ruleShifts = [];
    const b = worldFromLeague(structuredClone(league), store, FAST);
    expect(b.league).toEqual(a.league);
    expect(b.rules).toEqual(a.rules);
    expect(a.rules).toMatchObject({ rosterSize: 29, foreignLimit: 4, maxInnings: 11 });
    expect(salaryCap(2030, league)).toBe(Math.round(Math.round(salaryCap(2028)! * 1.05) * 1.05));
  });

  it('목표 배율·엔트리·연장·외국인·캡 상향률이 그 해부터 들어가고, 과거·자료 있는 해는 그대로', () => {
    const { league } = createLeague(store, 2026, 'fr-w2', FAST);
    league.year = 2031;
    const base = worldFromLeague(structuredClone(league), store, FAST);
    league.ruleShifts = [shift('ball', 2031, 0.94), shift('zone', 2031, 0.97), shift('roster', 2031, 30), shift('extra', 2031, 12), shift('foreign', 2031, 4), shift('capGrowth', 2031, 0.07)];
    const w = worldFromLeague(structuredClone(league), store, FAST);
    expect(w.league.hr).toBeCloseTo(base.league.hr * 0.94, 10);
    // 2027년부터는 시즌 반발계수가 홈런 배율에 곱해진다 (ballHrMul). 2루타는 그 배율 변화의 1/3
    const m = ballHrMul(league, 2031);
    expect(w.league.d2).toBeCloseTo((base.league.d2 * ballD2(m)) / ballD2(m / 0.94), 10);
    expect(w.league.so).toBeCloseTo(base.league.so * 0.97, 10);
    expect(w.league.bb).toBeCloseTo(base.league.bb * 1.05, 10);
    expect(w.league.s1).toBe(base.league.s1);
    expect(w.rules).toMatchObject({ rosterSize: 30, maxInnings: 12, foreignLimit: 5 });
    expect(foreignRule(store.meta, 2031, league)).toEqual({ total: 5, asia: 1, regular: 4 });
    expect(foreignRule(store.meta, 2030, league).regular).toBe(3);
    expect(foreignRule(store.meta, 2026, league).regular).toBe(3);
    expect(salaryCap(2031, league)).toBe(Math.round(salaryCap(2030, league)! * 1.07));
    expect(salaryCap(2030, league)).toBe(salaryCap(2030));
    // 자료 있는 해에는 들어가지 않는다
    league.year = 2025;
    league.ruleShifts = [shift('ball', 2025, 0.94)];
    expect(worldFromLeague(structuredClone(league), store, FAST).league.hr).toBe(store.season(2025)!.league.rates.hr);
  });

  it('알림: 바뀐 해에 "게임 속 가상 결정" 줄이 위 칸에, 게임 규칙 키의 자동 줄과 겹치지 않는다', () => {
    const L = { rules: {}, ruleShifts: [shift('roster', 2031, 30), shift('ball', 2035, 0.94)] } as unknown as LeagueState;
    const n = ruleNews({ year: 2031, data: store.ruleChanges, now: ruleSnapshot(store.meta, 2031, L), prev: ruleSnapshot(store.meta, 2030, L), shifts: L.ruleShifts!.filter((s) => s.year === 2031) });
    const roster = n.main.filter((l) => l.key === 'rosterSize');
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ status: 'virtual', before: '29명', after: '30명' });
    expect(roster[0].title).toContain('게임 속 가상 결정');
    expect(ruleSnapshot(store.meta, 2031, L).rosterSize).toBe(30);
    expect(ruleSnapshot(store.meta, 2031, L).sources.rosterSize).toBe('virtual');
    const b = ruleNews({ year: 2035, data: store.ruleChanges, now: ruleSnapshot(store.meta, 2035, L), prev: ruleSnapshot(store.meta, 2034, L), shifts: L.ruleShifts!.filter((s) => s.year === 2035) });
    expect(b.main[0]).toMatchObject({ cat: 'ball', status: 'virtual', after: '홈런 기준 ×0.94' });
  });

  it(`시작 연도는 ${FUTURE_RULES_FROM}년 (2027년은 발표된 제도)`, () => {
    expect(FUTURE_RULES_FROM).toBe(2028);
  });
});

describe('시즌 반발계수 (2026-10-22 사용자 결정)', () => {
  const shift = (key: FutureRuleKey, year: number, after: number): RuleShift => ({ year, key, before: FUTURE_RULE_SPEC[key].base, after, reason: '시험 (게임 속 가상 결정)', signal: 0 });
  it('2027년부터 기본 모드만, 시드로 재현되고 실제 퍼짐 안에서 정해지며 홈런 배율이 따라 움직인다', () => {
    const L = bare('cor');
    expect(seasonCor(L, 2026)).toBeNull();
    expect(seasonCor(bare('cor', true), 2030)).toBeNull();
    expect(ballHrMul(bare('cor', true), 2030)).toBe(1);
    const vals = Array.from({ length: 40 }, (_, i) => seasonCor(L, 2027 + i)!);
    expect(vals.every((v) => v >= COR_LOW - 1e-4 && v <= COR_HIGH + 1e-4)).toBe(true);
    expect(seasonCor(bare('cor'), 2031)).toBe(vals[4]);
    const muls = vals.map((_, i) => ballHrMul(L, 2027 + i));
    expect(Math.min(...muls)).toBeLessThan(0.8);
    expect(Math.max(...muls)).toBeGreaterThan(1.25);
    // 검사값이 높은 해일수록 홈런 배율이 크다
    const order = vals.map((v, i) => [v, muls[i]]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < order.length; i++) expect(order[i][1]).toBeGreaterThanOrEqual(order[i - 1][1] - 0.005);
  });

  it('기준 하향(ball 항목)은 검사값과 기준 범위를 함께 내리고 알림에 "반발계수 변경" 줄과 시즌 중 검사 소식이 나온다', () => {
    const L = { ...bare('cor'), ruleShifts: [shift('ball', 2031, 0.94)] } as unknown as LeagueState;
    expect(seasonCor(L, 2031)!).toBeLessThan(seasonCor(bare('cor'), 2031)!);
    expect(corRange(L, 2031)[1]).toBeLessThan(corRange(bare('cor'), 2031)[1]);
    const value = seasonCor(L, 2031)!;
    const n = ruleNews({ year: 2031, data: store.ruleChanges, now: ruleSnapshot(store.meta, 2031, L), prev: ruleSnapshot(store.meta, 2030, L),
      seasonDays: 180, cor: { value, prev: seasonCor(L, 2030), range: corRange(L, 2031), hrMul: ballHrMul(L, 2031) } });
    expect(n.main[0].title).toContain('반발계수 변경');
    expect(n.main[0].after).toBe(value.toFixed(4));
    expect(n.dated.some((d) => d.text.includes('2차 수시검사') && d.text.includes(value.toFixed(4)))).toBe(true);
  });
});
