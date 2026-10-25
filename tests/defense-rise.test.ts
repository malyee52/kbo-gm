// 능력치 v2 16-4: 결산 때 수비 등급 오름 (익숙함 u가 늘어난 자리). 등급 = 20 + 재능 T × u (13.1)라 u가 바뀐 만큼 T × Δu를 옮긴다.
import { describe, expect, it } from 'vitest';
import { defenseV2, familiarityShift, gameFieldYear, virtualDefense } from '../src/engine/fielding';

const thirdBase = [2023, 2024, 2025].map((y) => gameFieldYear(y, [0, 0, 0, 1100, 0, 0, 0, 0], undefined, 560));
const ev = (years: typeof thirdBase, startYear: number) => ({ id: 't-3b', years, startYear, age: null, speed: 0.5, listed: '3B' as const });

describe('결산 때 수비 등급 오름 (familiarityShift, 16-4)', () => {
  it('재능 T는 u < 1인 자리에만 남고, 시작 등급 = 20 + T × u', () => {
    const v = defenseV2(ev(thirdBase, 2026));
    expect(v.talent['3B']).toBeUndefined(); // 본 자리 u = 1
    expect(v.talent.SS).toBeDefined();
    expect(v.grade.SS).toBe(20); // 해 보지 않은 자리
  });

  it('3루수가 게임 안에서 유격수를 150이닝 맡으면 다음 해 SS 등급이 그 이닝으로 다시 매긴 값과 같아진다', () => {
    const before = defenseV2(ev(thirdBase, 2026));
    const more = [...thirdBase, gameFieldYear(2026, [0, 0, 0, 950, 150, 0, 0, 0], undefined, 560)];
    const after = defenseV2(ev(more, 2027));
    const shifted = familiarityShift(more, 2026, '3B', before.talent, before.def);
    expect(shifted.SS).toBeCloseTo(after.def.SS!, 5);
    expect(shifted.SS!).toBeGreaterThan(before.def.SS!);
    // 본 자리는 옮기지 않는다 (나이 몫은 ageDefense가 따로)
    expect(shifted['3B']).toBe(before.def['3B']);
  });

  it('맡지 않은 자리는 그대로 (u가 0에서 안 움직임)', () => {
    const v = defenseV2(ev(thirdBase, 2026));
    const more = [...thirdBase, gameFieldYear(2026, [0, 0, 0, 1100, 0, 0, 0, 0], undefined, 560)];
    const shifted = familiarityShift(more, 2026, '3B', v.talent, v.def);
    expect(shifted).toEqual(v.def);
  });

  it('몇 이닝만 맡으면 조금만 오르고, 몇 해 뒤 다시 안 맡으면 최근성으로 내려간다 (등급 20 아래로는 안 감)', () => {
    const v = defenseV2(ev(thirdBase, 2026));
    const y26 = [...thirdBase, gameFieldYear(2026, [0, 0, 0, 1060, 0, 0, 0, 40], undefined, 560)];
    const s26 = familiarityShift(y26, 2026, '3B', v.talent, v.def);
    expect(s26.RF!).toBeGreaterThan(v.def.RF!);
    let years = y26;
    let def = s26;
    for (let y = 2027; y <= 2031; y++) {
      years = [...years, gameFieldYear(y, [0, 0, 0, 1100, 0, 0, 0, 0], undefined, 560)];
      def = familiarityShift(years, y, '3B', v.talent, def);
    }
    expect(def.RF!).toBeLessThan(s26.RF!);
    expect(def.RF!).toBeGreaterThanOrEqual(v.def.RF!);
  });

  it('가상 선수도 본 자리·유사 포지션 밖은 재능 T를 갖는다', () => {
    const v = virtualDefense('v-ss', 'SS', 0.6, 22, [-4, 0, 4]);
    expect(v.talent.SS).toBeUndefined();
    expect(v.talent['2B']).toBeUndefined();
    expect(v.talent['3B']).toBeDefined();
    expect(v.grade['3B']).toBe(20);
  });
});
