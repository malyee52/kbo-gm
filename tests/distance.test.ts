// 구단 연고지 거리 표 (경기 엔진 2 D단계 ③): 대칭, 같은 도시 0, 연도별 연고 이전
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { cityDistanceKm, distanceTable, homeOf } from '../src/league/distance';

const store = loadDataStore();
const homes = store.homes!;
const franchises = Object.keys(store.meta.franchises);

describe('연고지 거리 표', () => {
  it('모든 해 모든 구단의 연고가 있다', () => {
    for (const y of store.meta.years) {
      for (const [fr, spans] of Object.entries(store.meta.franchises)) {
        if (spans.some((s) => s.from <= y && y <= s.to)) expect(homeOf(homes, fr, y), `${y} ${fr}`).toBeDefined();
      }
    }
  });

  it('대칭이고 같은 도시는 0, 다른 도시는 0보다 크다', () => {
    for (const y of [1982, 1991, 2000, 2008, 2015, 2026]) {
      const t = distanceTable(homes, franchises, y);
      for (const a of Object.keys(t)) {
        for (const b of Object.keys(t[a])) {
          expect(t[a][b]).toBe(t[b][a]);
          const same = homeOf(homes, a, y)!.city === homeOf(homes, b, y)!.city;
          if (same) expect(t[a][b]).toBe(0);
          else expect(t[a][b]).toBeGreaterThan(0);
        }
      }
    }
  });

  it('연고 이전과 대략의 거리', () => {
    expect(homeOf(homes, '두산', 1984)!.city).toBe('대전');
    expect(homeOf(homes, '두산', 1985)!.city).toBe('서울');
    expect(homeOf(homes, '현대계', 2000)!.city).toBe('수원');
    const t = distanceTable(homes, franchises, 2025);
    expect(t.LG['두산']).toBe(0);
    expect(t.SSG.KT).toBeGreaterThan(20);
    // 서울~부산 직선 약 325km
    expect(t.LG['롯데']).toBeGreaterThan(300);
    expect(t.LG['롯데']).toBeLessThan(350);
    expect(cityDistanceKm(homeOf(homes, '롯데', 2025)!, homeOf(homes, 'NC', 2025)!)).toBeLessThan(50);
  });
});
