// 구단 연고지 사이 거리 (경기 엔진 2 12단계에서 만듦, docs/경기엔진2_기획안.md 3.10·5장). 원정 거리 컨디션은
// 2026-10-22 사용자 결정으로 없앴고(docs/컨디션_기획안.md 0장), 지금은 측정 도구(tools/condition_check.ts)만 쓴다.
// 자료: data-src/연고지.csv → public/data/homes.json (tools/build_data.py build_homes). 위·경도로 계산한 직선 거리라
// 실제 이동 경로·제2구장·연전 이동은 반영하지 않는다 (임시값).

import type { HomeCity } from '../data/types';

const EARTH_KM = 6371;

/** 그 해 그 계보의 연고 도시. 표에 없으면 undefined */
export function homeOf(homes: readonly HomeCity[], franchise: string, year: number): HomeCity | undefined {
  return homes.find((h) => h.franchise === franchise && h.from <= year && (h.to === undefined || year <= h.to));
}

/** 두 도시 사이 직선 거리 (km, 대원 거리, 소수 첫째 자리에서 반올림). 같은 도시는 0 */
export function cityDistanceKm(a: HomeCity, b: HomeCity): number {
  if (a.city === b.city) return 0;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

/** 그 해 계보 사이 거리 표: 계보 → 계보 → km. 연고를 모르는 계보는 빠진다 */
export function distanceTable(homes: readonly HomeCity[], franchises: readonly string[], year: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const a of franchises) {
    const ha = homeOf(homes, a, year);
    if (!ha) continue;
    out[a] = {};
    for (const b of franchises) {
      const hb = homeOf(homes, b, year);
      if (hb) out[a][b] = cityDistanceKm(ha, hb);
    }
  }
  return out;
}
