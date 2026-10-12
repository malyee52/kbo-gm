// 기여(런)를 20~80 등급으로 (잠재력·종합 능력 표시용).
// 2026-10-12 기준표(tools/war.ts·tools/benchmark_peaks.ts)와 같은 눈금으로 바꿨다: 등급 = 40 + 5 × 승, 승 = 런 → 실제 시즌 WAR 직선 맞춤
// (타자 2,334시즌, tools/calibrate_value.ts: 승 = −0.49 + 0.108 × 런), 그리고 그 해 리그 수준(engine/eras.ts leagueQuality)을 곱한다.
// 2승(평균 주전, 약 23런) = 50, 4승(약 41런) = 60, 6승(약 60런) = 70, 8승(약 79런) 이상 = 80.
// 예전: 15런 = 50, 1런마다 0.45 (같은 날 등급 폭을 한 번 넓힌 값).
import { leagueQuality } from '../engine';

const WAR_PER_RUN = 0.108;
const WAR_AT_ZERO = -0.49;

/** 런을 승수(WAR 눈금)로. year를 주면 그 해 리그 수준을 곱한다 */
export function runsWar(runs: number, year?: number): number {
  return (WAR_AT_ZERO + WAR_PER_RUN * runs) * (year === undefined ? 1 : leagueQuality(year));
}

export function runsGrade(runs: number, year?: number): number {
  return Math.max(20, Math.min(80, Math.round(40 + 5 * runsWar(runs, year))));
}
