// 재정 2 F2 예산 배분 (docs/재정2_기획안.md 4.2~4.4·5장·7장 F2): 투자 금액 예산과 체감 곡선, 프런트·2군 운영 예산,
// 추천안과 자동/고정, AI 추천안, 조작 budget·budget-preset·budget-auto, 예전 invest 조작·예전 저장 변환.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import {
  activeStep, BUDGET_KINDS, budgetOf, budgetRange, CEIL_SIGMA, DEVELOP_BONUS, DEVELOP_SHARE, frontScale, futuresScale, INVEST_COST, INVEST_KINDS,
  investCurve, investStep, lockedOf, MARKETING_FILL, MARKETING_SPONSOR, MEDICAL_DAYS, MEDICAL_FLOOR, MEDICAL_RATE, medicalScale, OPS_SPLIT, PRESET_BUDGET,
  SCOUT_FLOOR, SCOUT_SCALE, stepAt, type BudgetKind, type TeamFinance,
} from '../src/league/finance';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
});

/** 오프시즌을 ready까지 넘기고 다음 시즌을 연다 */
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

describe('① 체감 곡선', () => {
  it('s(0) = 0, s(1단계 눈금) = 1, s(3단계 눈금) = 3 (정확히), k는 곡선 그대로도 1단계에서 1, 오목하고 늘 오른다', () => {
    for (const k of INVEST_KINDS) {
      const [, a1, , a3] = INVEST_COST[k];
      expect(a1 / a3).toBeLessThan(1 / 3); // 곡선이 있을 조건
      expect(investStep(k, 0)).toBe(0);
      expect(investStep(k, a1)).toBe(1);
      expect(investStep(k, a3)).toBe(3);
      expect(investCurve(k, a1)).toBeCloseTo(1, 6);
      expect(investCurve(k, a3)).toBeCloseTo(3, 9);
      const [, cap] = budgetRange(k);
      let prev = 0;
      let slope = Infinity;
      for (let a = 1_000; a <= cap; a += 1_000) {
        const s = investCurve(k, a);
        expect(s).toBeGreaterThan(prev);
        expect(s - prev).toBeLessThanOrEqual(slope + 1e-12);
        slope = s - prev;
        prev = s;
      }
    }
  });

  it('효과 표: 정수 단계에서는 예전 표 값 그대로, 3단계 위는 마지막 구간 기울기의 절반이고 상한에서도 하한(의료 0.7·스카우트 0.4)을 지킨다', () => {
    for (const t of [SCOUT_SCALE, CEIL_SIGMA, DEVELOP_BONUS, DEVELOP_SHARE, MEDICAL_RATE, MEDICAL_DAYS, MARKETING_FILL, MARKETING_SPONSOR]) {
      for (let i = 0; i < 4; i++) expect(stepAt(t, i)).toBe(t[i]);
      expect(stepAt(t, 3.5)).toBeCloseTo(t[3] + (t[3] - t[2]) / 4, 12);
    }
    const capMed = investStep('medical', budgetRange('medical')[1]);
    expect(capMed).toBeGreaterThan(3);
    expect(medicalScale(capMed).rate).toBeGreaterThanOrEqual(MEDICAL_FLOOR);
    expect(medicalScale(capMed).rate).toBeLessThan(MEDICAL_RATE[3]);
    expect(medicalScale(1)).toEqual({ rate: MEDICAL_RATE[1], days: MEDICAL_DAYS[1] });
    const capScout = investStep('scout', budgetRange('scout')[1]);
    expect(stepAt(SCOUT_SCALE, capScout, SCOUT_FLOOR)).toBeGreaterThanOrEqual(SCOUT_FLOOR);
    expect(stepAt(SCOUT_SCALE, 99, SCOUT_FLOOR)).toBe(SCOUT_FLOOR);
    expect(stepAt(MEDICAL_RATE, 99, MEDICAL_FLOOR)).toBe(MEDICAL_FLOOR);
  });

  it('프런트·2군 운영: 기본값(운영비 기본 몫)은 배율 1, 범위 끝은 0.95·1.05와 0.8·1.2', () => {
    expect(frontScale(OPS_SPLIT.opsFront)).toBe(1);
    expect(futuresScale(OPS_SPLIT.opsFutures)).toBe(1);
    expect(frontScale(budgetRange('front')[0])).toBeCloseTo(0.95, 12);
    expect(frontScale(budgetRange('front')[1])).toBeCloseTo(1.05, 12);
    expect(futuresScale(budgetRange('futures')[0])).toBeCloseTo(0.8, 12);
    expect(futuresScale(budgetRange('futures')[1])).toBeCloseTo(1.2, 12);
    // 균형 추천안 = 예전 1단계 + 운영비 기본 몫 (기본값 = 예전 돈)
    for (const k of INVEST_KINDS) expect(PRESET_BUDGET.balance[k]).toBe(INVEST_COST[k][1]);
    expect(PRESET_BUDGET.balance.front).toBe(OPS_SPLIT.opsFront);
    expect(PRESET_BUDGET.balance.futures).toBe(OPS_SPLIT.opsFutures);
    // 추천안은 모두 범위 안, 1천만 원 단위
    for (const p of Object.values(PRESET_BUDGET)) for (const k of BUDGET_KINDS) {
      const [lo, hi] = budgetRange(k);
      expect(p[k]).toBeGreaterThanOrEqual(lo);
      expect(p[k]).toBeLessThanOrEqual(hi);
      expect(p[k] % 1_000).toBe(0);
    }
  });
});

describe('② 기본값(균형, 조작 없음) = F2 전', () => {
  it('예산 칸이 없는 예전 모습과 균형 예산을 칸으로 적은 모습이 한 시즌 장부·부상·성장까지 같다', () => {
    const a = GameSession.create(store, opts('bud-b'), FAST);
    const b = GameSession.create(store, opts('bud-b'), FAST);
    for (const f of b.league.finance!) { f.budget = { ...PRESET_BUDGET.balance }; f.activeBudget = { ...PRESET_BUDGET.balance }; }
    for (const g of [a, b]) for (let t = 0; t < 10; t++) {
      for (const k of INVEST_KINDS) expect(activeStep(g.league, t, k)).toBe(1);
    }
    toOffseason(a);
    toOffseason(b);
    expect(b.league.finance!.map((f) => f.history)).toEqual(a.league.finance!.map((f) => f.history));
    expect(b.season.absences).toEqual(a.season.absences);
    const runs = (g: GameSession) => g.league.players.map((p) => [p.id, p.bat, p.pit, p.potential]);
    expect(runs(b)).toEqual(runs(a));
    // 플레이어 구단 장부: 투자(육성·의료·마케팅) 8억·스카우트비 2억·운영비 넷은 기본 몫 그대로
    // (결산 기록의 스카우트비는 시즌 중 지급분만: 해외 파견은 장부에 따로 남는다, scoutfx.ts)
    const y = a.league.finance![lg].history.at(-1)!;
    expect(Math.abs((y.items.invest ?? 0) + 80_000)).toBeLessThanOrEqual(10);
    expect(Math.abs((y.items.scouting ?? 0) + 20_000)).toBeLessThanOrEqual(10);
    expect(Math.abs((y.items.opsFront ?? 0) + OPS_SPLIT.opsFront)).toBeLessThanOrEqual(10);
    expect(Math.abs((y.items.opsFutures ?? 0) + OPS_SPLIT.opsFutures)).toBeLessThanOrEqual(10);
  });
});

describe('③④⑤ 저장·조작 기록·자동 배분', () => {
  let g: GameSession;
  beforeAll(() => {
    g = GameSession.create(store, opts('bud-c'), FAST);
    toOffseason(g);
  });

  it('③ 예전 저장(투자 단계만)을 불러오면 그 단계 눈금 금액, 1단계가 아닌 갈래는 고정, 개막 뒤 효과도 같은 금액으로 직접 정한 것과 같다', () => {
    const save = roundTrip(g.toSave()) as GameSaveV2;
    const strip = (f: TeamFinance) => { delete f.budget; delete f.activeBudget; delete f.locked; };
    const old = roundTrip(save);
    for (const f of old.league.finance!) strip(f);
    const of = old.league.finance![lg];
    of.invest = { scout: 2, scoutPro: 1, develop: 1, medical: 3, marketing: 0 };
    const h = GameSession.load(store, old, FAST);
    const hf = h.league.finance![lg];
    expect(budgetOf(hf, true)).toEqual({ ...PRESET_BUDGET.balance, scout: 15_000, medical: 40_000, marketing: 0 });
    expect(lockedOf(hf)).toEqual(['scout', 'medical', 'marketing']);
    // 같은 금액을 새 조작으로 정한 판
    const n = GameSession.load(store, roundTrip(save), FAST);
    expect(n.setBudget('scout', 15_000).ok).toBe(true);
    expect(n.setBudget('medical', 40_000).ok).toBe(true);
    expect(n.setBudget('marketing', 0).ok).toBe(true);
    expect(budgetOf(n.league.finance![lg], true)).toEqual(budgetOf(hf, true));
    openNext(h);
    openNext(n);
    expect(h.league.finance![lg].activeBudget).toEqual(n.league.finance![lg].activeBudget);
    expect(activeStep(h.league, lg, 'medical')).toBe(3);
    expect(h.world.teams[lg].injuryRate).toBe(n.world.teams[lg].injuryRate);
    expect(h.league.finance![lg].mk).toBe(n.league.finance![lg].mk);
  });

  it('④ 예전 invest 조작 기록을 다시 돌리면 그 단계 눈금 금액의 예산이 되고 그 줄이 고정된다', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(r.setInvest('develop', 3).ok).toBe(true);
    expect(r.setBudget('front', 700_000).ok).toBe(true);
    expect(r.actions.some((a) => a.type === 'invest')).toBe(true);
    const info = r.reproInfo();
    const back = GameSession.replay(store, roundTrip(info.opts), roundTrip(info.actions), info.at, FAST);
    const f = back.league.finance![lg];
    expect(budgetOf(f, true).develop).toBe(70_000);
    expect(budgetOf(f, true).front).toBe(700_000);
    expect(lockedOf(f)).toEqual(['develop', 'front']);
    expect(f.invest.develop).toBe(3);
    expect(budgetOf(f, true)).toEqual(budgetOf(r.league.finance![lg], true));
  });

  it('조작 검사: 범위 밖·1천만 원 단위가 아니면 거절, 시즌 중에는 바꿀 수 없다', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(r.setBudget('medical', budgetRange('medical')[1] + 1_000).ok).toBe(false);
    expect(r.setBudget('medical', 12_345).ok).toBe(false);
    expect(r.setBudget('front', 400_000).ok).toBe(false);
    expect(r.setBudget('futures', 650_000).ok).toBe(true);
    const s = GameSession.create(store, opts('bud-d'), FAST);
    expect(s.setBudget('medical', 20_000).ok).toBe(false);
    expect(s.setBudgetPreset('winnow').ok).toBe(false);
  });

  it('⑤ 추천안 → 고친 줄 고정 → 다음 오프시즌에는 자동 줄만 균형으로 돌아가고 고정한 줄은 남는다. AI 구단은 추천안 가운데 하나', () => {
    const r = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(r.setBudgetPreset('winnow').ok).toBe(true);
    expect(lockedOf(r.league.finance![lg])).toEqual([]);
    expect(r.setBudget('medical', 50_000).ok).toBe(true);
    expect(lockedOf(r.league.finance![lg])).toEqual(['medical']);
    expect(budgetOf(r.league.finance![lg], true)).toEqual({ ...PRESET_BUDGET.winnow, medical: 50_000 });
    openNext(r);
    expect(budgetOf(r.league.finance![lg], false)).toEqual({ ...PRESET_BUDGET.winnow, medical: 50_000 });
    // AI 구단: 확정 예산은 추천안 넷 중 하나
    const presets = Object.values(PRESET_BUDGET).map((p) => JSON.stringify(p));
    for (let t = 0; t < 10; t++) if (t !== lg) expect(presets).toContain(JSON.stringify(budgetOf(r.league.finance![t], false)));
    toOffseason(r);
    const f = r.league.finance![lg];
    expect(budgetOf(f, true)).toEqual({ ...PRESET_BUDGET.balance, medical: 50_000 });
    expect(lockedOf(f)).toEqual(['medical']);
    // 지난 시즌 확정 예산은 그대로 (효과·비용은 확정 예산으로)
    expect(budgetOf(f, false)).toEqual({ ...PRESET_BUDGET.winnow, medical: 50_000 });
    expect(r.setBudgetAuto('medical').ok).toBe(true);
    expect(budgetOf(f, true)).toEqual(PRESET_BUDGET.balance);
    expect(lockedOf(f)).toEqual([] as BudgetKind[]);
  });
});
