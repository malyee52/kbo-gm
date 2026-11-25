// 감독 후보 화면 연봉 = 실제 계약 연봉 (2026-11-25 틀린 안내문 카드, 반증 #10 ③).
// 예전 화면은 managerSalary(기본 연봉)만 보여 2027년부터 연봉 지수만큼 실제 계약과 어긋났다.
// 화면(Manager.tsx)과 계약(makeManager)이 같이 쓰는 managerSalaryAt을 2030년 판에서 견준다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { candidates, changeManagerInSeason, hireManager, infoOf, managerSalary, managerSalaryAt } from '../src/league/managers';
import { wageIndex } from '../src/league/salary';
import type { LeagueState } from '../src/league/types';

let store: DataStore;

beforeAll(() => {
  store = loadDataStore();
}, 120_000);

// 감독 고용에 필요한 칸만 있는 작은 리그 (감독 자리 비어 있음, 미래 규칙 변경 없음)
const tinyLeague = (year: number) => ({ year, managers: [null], managerLog: [], ledger: [] } as unknown as LeagueState);

describe('감독 후보 연봉', () => {
  it('2030년(오프시즌 2029)에 화면 연봉 = 실제 계약 연봉, 연봉 지수가 곱해진다', () => {
    const L = tinyLeague(2029);
    const name = candidates(L, store, 2030)[0];
    expect(name).toBeTruthy();
    const info = infoOf(store, name);
    // 화면: 오프시즌 후보는 다음 시즌 계약 (Manager.tsx off ? year + 1 : year)
    const shown = managerSalaryAt(L, info, 2029 + 1);
    expect(hireManager(L, store, 0, 2029, name).ok).toBe(true);
    expect(L.managers![0]!.salary).toBe(shown);
    expect(wageIndex(2030, L)).toBeGreaterThan(1);
    expect(shown).toBeGreaterThan(managerSalary(info));
  });

  it('시즌 중 선임도 그 시즌 해 지수로 화면과 같다 (2030 시즌)', () => {
    const L = tinyLeague(2030);
    const name = candidates(L, store, 2030)[0];
    const shown = managerSalaryAt(L, infoOf(store, name), 2030);
    expect(changeManagerInSeason(L, store, 0, 2030, name).ok).toBe(true);
    expect(L.managers![0]!.salary).toBe(shown);
  });

  it('2026년까지는 지수 1이라 기본 연봉과 같다', () => {
    const L = tinyLeague(2026);
    const info = infoOf(store, candidates(L, store, 2026)[0]);
    expect(managerSalaryAt(L, info, 2026)).toBe(Math.round(managerSalary(info) / 1000) * 1000);
  });
});
