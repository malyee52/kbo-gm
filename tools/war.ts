// 실제 기록의 시즌 가치 (잠재력 기준표·측정 도구용). 계산식은 src/league/war.ts (게임의 명예의 전당과 같은 식).
// 기준표: 등급 = 40 + 5 × 승 (2승 평균 주전 = 50, 4승 = 60, 6승 = 70, 8승 이상 = 80).
//   2026-10-12 사용자가 "10승 = 80"으로 벌리려다 취소하고 대신 리그 수준 보정을 두기로 했다: 승수에 engine/eras.ts leagueQuality를 곱한다
import type { BatRow, DataStore, PitRow, SeasonData } from '../src/data/types';
import { batWarOf, isStarterCounts, pitWarOf, realEnv, WAR_CAL, type WarEnv } from '../src/league/war';

export const CAL = WAR_CAL;
export const tableGrade = (war: number) => Math.max(20, Math.min(80, Math.round(40 + 5 * war)));

export function leagueRefs(store: Pick<DataStore, 'meta' | 'season'>): Map<number, WarEnv> {
  return new Map(store.meta.years.map((y) => [y, realEnv(store.season(y) as SeasonData)]));
}

/** q: 리그 수준 배율 (engine/eras.ts leagueQuality). 1이면 그 시즌 리그 그대로 */
export function batWar(r: BatRow, lg: WarEnv, q = 1): number {
  return batWarOf(r, r.pos, lg, q);
}

export function isStarterRow(r: PitRow): boolean {
  return isStarterCounts(r);
}

export function pitWar(r: PitRow, lg: WarEnv, q = 1): number {
  return pitWarOf(r, lg, q);
}
