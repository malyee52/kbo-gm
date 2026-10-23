// 규칙 알림 5차 (2026-10-22 사용자 결정): 최저 연봉·외국인 금액 상한의 계단식 규정 인상, 감독·코치 연봉과 구장 공사비의 연봉 지수,
// 2027년 반발계수 줄의 "전"(2026 실제 1차 검사값).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { ruleNews, ruleSnapshot } from '../src/league/ruleNews';
import {
  foreignCap, foreignSalary, MIN_SALARY, MIN_SALARY_STEP_YEARS, minSalary, rookieSalary, ruleStepYear, wageIndex,
} from '../src/league/salary';
import { RULE_DEFAULTS } from '../src/league/rules';
import { REMODEL, stadiumOptions } from '../src/league/stadium';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
beforeAll(() => {
  store = loadDataStore();
});

const L = { rules: {}, ruleShifts: [] } as unknown as LeagueState;

describe('계단식 규정 인상 (임시값: 4년마다)', () => {
  it('최저 연봉은 2030년에 처음 오르고 다음 인상(2034년)까지 그대로, 100만 원 단위', () => {
    expect(MIN_SALARY_STEP_YEARS).toBe(4);
    for (const y of [1990, 2026, 2027, 2029]) expect(minSalary(y, L)).toBe(MIN_SALARY);
    expect(ruleStepYear(2029)).toBeNull();
    expect(ruleStepYear(2030)).toBe(2030);
    expect(ruleStepYear(2033)).toBe(2030);
    expect(ruleStepYear(2034)).toBe(2034);
    const m30 = minSalary(2030, L);
    expect(m30).toBe(Math.round((MIN_SALARY * wageIndex(2030, L)) / 100) * 100);
    expect(m30).toBe(3600);
    expect(minSalary(2033, L)).toBe(m30);
    expect(minSalary(2034, L)).toBeGreaterThan(m30);
    // 신인 계약은 해마다 오르는 지수라 그 해 최저 연봉보다 낮지 않다
    for (let y = 2026; y <= 2060; y++) expect(rookieSalary(y, L)).toBeGreaterThanOrEqual(minSalary(y, L));
  });

  it('외국인 금액 상한도 같은 주기로 1만 달러 단위로 오르고, 자유 모드에서 바꾼 값은 그대로다', () => {
    for (const k of ['foreignNewCap', 'asiaNewCap', 'foreignTotalCap'] as const) {
      expect(foreignCap(L, k, 2029)).toBe(RULE_DEFAULTS[k]);
      const v = foreignCap(L, k, 2030);
      expect(v % 10_000).toBe(0);
      expect(v).toBe(Math.round((RULE_DEFAULTS[k] * wageIndex(2030, L)) / 10_000) * 10_000);
      expect(foreignCap(L, k, 2033)).toBe(v);
    }
    const free = { rules: { foreignNewCap: 3_000_000 }, ruleShifts: [] } as unknown as LeagueState;
    expect(foreignCap(free, 'foreignNewCap', 2040)).toBe(3_000_000);
    // 시장 금액도 상한과 같은 배율로 오르고 상한을 넘지 않는다
    for (const r of [10, 30, 46, 60]) {
      expect(foreignSalary(r, true, false, L, 2030)).toBeGreaterThanOrEqual(foreignSalary(r, true, false, L));
      expect(foreignSalary(r, true, false, L, 2030)).toBeLessThanOrEqual(foreignCap(L, 'foreignNewCap', 2030));
      expect(foreignSalary(r, true, true, L, 2030)).toBeLessThanOrEqual(foreignCap(L, 'asiaNewCap', 2030));
    }
    expect(foreignSalary(30, true, false, L, 2029)).toBe(foreignSalary(30, true, false, L));
  });

  it('개막 알림: 인상 해에만 "최저 연봉 인상"·"외국인 금액 상한 인상" 줄 (전 → 후)', () => {
    const news = (y: number) => ruleNews({ year: y, data: store.ruleChanges, now: ruleSnapshot(store.meta, y, L), prev: ruleSnapshot(store.meta, y - 1, L) });
    const n = news(2030);
    const min = [...n.main, ...n.other].find((l) => l.title === '최저 연봉 인상');
    expect(min).toMatchObject({ before: '3,000만 원', after: '3,600만 원', status: 'virtual' });
    const fc = n.main.find((l) => l.title === '외국인 금액 상한 인상');
    expect(fc?.before).toContain('신규 100만 달러');
    expect(fc?.after).toContain(`신규 ${Math.round(foreignCap(L, 'foreignNewCap', 2030) / 10_000)}만 달러`);
    for (const y of [2025, 2027, 2031]) {
      const o = news(y);
      expect([...o.main, ...o.other].some((l) => l.title.includes('최저 연봉') || l.title.includes('외국인 금액'))).toBe(false);
    }
  });
});

describe('해마다 연봉 지수만큼 (감독·코치 연봉, 구장 공사비)', () => {
  it('구장 공사비는 착공하는 해의 지수만큼', () => {
    expect(stadiumOptions()[0].cost).toBe(REMODEL.cost);
    expect(stadiumOptions(1.2)[0].cost).toBe(Math.round(REMODEL.cost * 1.2));
  });
});

describe('2027년 반발계수 줄 (2026-10-22 사용자 결정 "전 → 후")', () => {
  it('지난해 게임 값이 없으면 자료의 2026 실제 1차 검사값을 "전"으로', () => {
    const real = store.ruleChanges!.ball.find((b) => b.year === 2026)!.tests!.find((t) => t.round === 1)!.avg!;
    const n = ruleNews({
      year: 2027, data: store.ruleChanges, now: ruleSnapshot(store.meta, 2027, L), prev: ruleSnapshot(store.meta, 2026, L),
      cor: { value: 0.4155, prev: null, range: [0.4034, 0.4234], hrMul: 1 },
    });
    expect(n.main[0].title).toContain('반발계수 변경 (상승)');
    expect(n.main[0].before).toBe(real.toFixed(4));
    expect(n.main[0].after).toBe('0.4155');
    expect(n.main[0].detail!.join(' ')).toContain(`2026 실제 1차 ${real.toFixed(4)}`);
  });
});
