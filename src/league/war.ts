// 시즌 가치 (WAR 비슷한 승수, 2026-10-12). 잠재력 기준표(tools/benchmark_peaks.ts)와 명예의 전당(history.ts)이 같이 쓴다.
//
//   타자: (타석 결과별 득점 가치 − 리그 평균) + 대체 선수(600타석당 20런) + 포지션 보정. 수비 기록이 없어 수비 런은 없다
//   투수: 실점률과 FIP(삼진·볼넷·사구·피홈런)를 반씩 섞은 9이닝당 실점을 대체 선수 수준(선발 리그 실점률 × 1.3, 구원 × 1.15)과 비교 × 이닝.
//         구원은 중요한 상황에 나오는 몫으로 1.3배
//   런 → 승: 리그 경기당 득점 × 2 (그 시대 득점 환경)
//   눈금: 스탯티즈 WAR 세 시즌(선동열 1986 14.89, 장명부 1983 13.63, 류현진 2010 9.34)에 맞춰 × CAL
// 리그 환경(WarEnv)은 실제 시즌이면 자료의 리그 합계, 게임 안 시즌이면 결산 때 남긴 시뮬 리그 합계(league.seasonEnv)로 만든다.

import type { DataStore, SeasonData } from '../data/types';

const LW = { bb: 0.69, hbp: 0.72, s1: 0.89, d2: 1.27, t3: 1.62, hr: 2.1 };
const POS_ADJ: Record<string, number> = { C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5, IF: 2.5, OF: -5 };
/** 스탯티즈 WAR 눈금에 맞추는 배율 */
export const WAR_CAL = 1.11;
/** 구원 가중 */
const RELIEF_LEVERAGE = 1.3;

export interface WarEnv {
  /** 리그 wOBA 비슷한 값 (선형 가중치 ÷ 타석) */
  woba: number;
  /** 리그 9이닝당 실점 */
  ra9: number;
  /** FIP 상수 */
  fipC: number;
  /** 1승당 런 (리그 경기당 득점 × 2) */
  rpw: number;
}

/** 리그 합계로 환경을 만든다 (실제 자료의 리그 합계와 시뮬 합계 모두) */
export function envFrom(t: { pa: number; h: number; d: number; t: number; hr: number; bb: number; hbp: number; so: number;
  hrAllowed?: number; runsAllowed: number; outs: number; teamGames: number; runs: number }): WarEnv {
  const s1 = t.h - t.d - t.t - t.hr;
  const woba = (LW.bb * t.bb + LW.hbp * t.hbp + LW.s1 * s1 + LW.d2 * t.d + LW.t3 * t.t + LW.hr * t.hr) / Math.max(1, t.pa);
  const ip = Math.max(1, t.outs / 3);
  const ra9 = (t.runsAllowed * 9) / ip;
  const fipC = ra9 - (13 * (t.hrAllowed ?? t.hr) + 3 * (t.bb + t.hbp) - 2 * t.so) / ip;
  return { woba, ra9, fipC, rpw: (2 * t.runs) / Math.max(1, t.teamGames) };
}

/** 실제 시즌 자료의 환경 */
export function realEnv(sd: SeasonData): WarEnv {
  const L = sd.league;
  return envFrom({ pa: L.pa, h: L.h, d: L.d, t: L.t, hr: L.hr, bb: L.bb, hbp: L.hbp, so: L.so, hrAllowed: L.hrAllowed,
    runsAllowed: L.runsAllowed, outs: L.outs, teamGames: L.teamGames, runs: L.r });
}

const realEnvCache = new WeakMap<object, Map<number, WarEnv>>();
/** 자료가 있는 해의 실제 환경 (없으면 가장 가까운 해) */
export function realEnvOf(store: Pick<DataStore, 'meta' | 'season'>, year: number): WarEnv {
  let m = realEnvCache.get(store);
  if (!m) realEnvCache.set(store, (m = new Map()));
  const years = store.meta.years;
  const y = Math.max(years[0], Math.min(years[years.length - 1], year));
  let e = m.get(y);
  if (!e) m.set(y, (e = realEnv(store.season(y)!)));
  return e;
}

export interface BatCounts { pa: number; h: number; d: number; t: number; hr: number; bb?: number | null; hbp?: number | null }
export interface PitCounts { g: number; gs?: number | null; outs: number; hr: number; bb: number; hbp: number; so: number; r: number }

/** q: 리그 수준 배율 (engine/eras.ts leagueQuality). 1이면 그 시즌 리그 그대로 */
export function batWarOf(r: BatCounts, pos: string | null | undefined, env: WarEnv, q = 1): number {
  if (r.pa <= 0) return 0;
  const s1 = r.h - r.d - r.t - r.hr;
  const woba = (LW.bb * (r.bb ?? 0) + LW.hbp * (r.hbp ?? 0) + LW.s1 * s1 + LW.d2 * r.d + LW.t3 * r.t + LW.hr * r.hr) / r.pa;
  const runs = ((woba - env.woba) / 1.2) * r.pa + (20 * r.pa) / 600 + ((POS_ADJ[pos ?? ''] ?? 0) * r.pa) / 600;
  return (runs / env.rpw) * WAR_CAL * q;
}

export function isStarterCounts(r: Pick<PitCounts, 'g' | 'gs' | 'outs'>): boolean {
  return r.gs !== null && r.gs !== undefined ? r.gs / Math.max(1, r.g) >= 0.5 : r.outs / Math.max(1, r.g) >= 12;
}

export function pitWarOf(r: PitCounts, env: WarEnv, q = 1): number {
  const ip = r.outs / 3;
  if (ip <= 0) return 0;
  const starter = isStarterCounts(r);
  const fip = (13 * r.hr + 3 * (r.bb + r.hbp) - 2 * r.so) / ip + env.fipC;
  const ra9 = (r.r * 9) / ip;
  const mix = 0.5 * fip + 0.5 * ra9;
  const repl = env.ra9 * (starter ? 1.3 : 1.15);
  const runs = ((repl - mix) / 9) * ip * (starter ? 1 : RELIEF_LEVERAGE);
  return (runs / env.rpw) * WAR_CAL * q;
}

/** 시즌별 가치 목록에서 통산과 최고 5시즌 합 */
export function warSummary(wars: number[]): { total: number; peak5: number } {
  const total = wars.reduce((a, b) => a + b, 0);
  const peak5 = [...wars].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  return { total, peak5 };
}
