// 실제 기록으로 시즌 가치(WAR 비슷한 승수)를 계산한다 (2026-10-12 잠재력 기준표, tools/benchmark_peaks.ts·tools/calibrate_value.ts).
//
//   타자: (타석 결과별 득점 가치 − 리그 평균) + 대체 선수(600타석당 20런) + 포지션 보정(ai/value.ts POS_ADJ). 수비 기록이 없어 수비 런은 없다
//   투수: 실점률과 FIP(삼진·볼넷·사구·피홈런)를 반씩 섞은 9이닝당 실점을 대체 선수 수준(선발 리그 실점률 × 1.3, 구원 × 1.15)과 비교 × 이닝.
//         구원은 중요한 상황에 나오는 몫으로 1.3배 (게임 ai/value.ts RELIEF_LEVERAGE와 같게)
//   런 → 승: 리그 경기당 득점 × 2 (그 시대 득점 환경). 경기 수로 늘리지 않는다 (144경기로 늘리면 80~110경기 시대 에이스가 부풀었다)
//   눈금: 스탯티즈 WAR 세 시즌(선동열 1986 14.89, 장명부 1983 13.63, 류현진 2010 9.34)에 맞춰 × CAL
// 기준표: 등급 = 40 + 5 × 승 (2승 평균 주전 = 50, 4승 = 60, 6승 = 70, 8승 이상 = 80).
//   2026-10-12 사용자가 "10승 = 80"으로 벌리려다 취소하고 대신 리그 수준 보정을 두기로 했다: 승수에 engine/eras.ts leagueQuality를 곱한다
import type { BatRow, DataStore, PitRow, SeasonData } from '../src/data/types';

const LW = { bb: 0.69, hbp: 0.72, s1: 0.89, d2: 1.27, t3: 1.62, hr: 2.1 };
const POS_ADJ: Record<string, number> = { C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5, IF: 2.5, OF: -5 };
/** 스탯티즈 WAR 눈금에 맞추는 배율 (위 세 시즌의 비율 평균) */
export const CAL = 1.11;
/** 구원 가중 (ai/value.ts RELIEF_LEVERAGE와 같은 값) */
const RELIEF_LEVERAGE = 1.3;

export const tableGrade = (war: number) => Math.max(20, Math.min(80, Math.round(40 + 5 * war)));

interface Lg { woba: number; ra9: number; fipC: number; rpw: number }

export function leagueRefs(store: Pick<DataStore, 'meta' | 'season'>): Map<number, Lg> {
  const out = new Map<number, Lg>();
  for (const y of store.meta.years) {
    const s = store.season(y) as SeasonData;
    const L = s.league;
    const s1 = L.h - L.d - L.t - L.hr;
    const woba = (LW.bb * L.bb + LW.hbp * L.hbp + LW.s1 * s1 + LW.d2 * L.d + LW.t3 * L.t + LW.hr * L.hr) / L.pa;
    const ip = L.outs / 3;
    const ra9 = (L.runsAllowed * 9) / ip;
    const fipC = ra9 - (13 * L.hrAllowed + 3 * (L.bb + L.hbp) - 2 * L.so) / ip;
    out.set(y, { woba, ra9, fipC, rpw: 2 * L.runsPerTeamGame });
  }
  return out;
}

/** q: 리그 수준 배율 (engine/eras.ts leagueQuality). 1이면 그 시즌 리그 그대로 */
export function batWar(r: BatRow, lg: Lg, q = 1): number {
  if (r.pa <= 0) return 0;
  const s1 = r.h - r.d - r.t - r.hr;
  const woba = (LW.bb * (r.bb ?? 0) + LW.hbp * (r.hbp ?? 0) + LW.s1 * s1 + LW.d2 * r.d + LW.t3 * r.t + LW.hr * r.hr) / r.pa;
  const runs = ((woba - lg.woba) / 1.2) * r.pa + (20 * r.pa) / 600 + ((POS_ADJ[r.pos ?? ''] ?? 0) * r.pa) / 600;
  return (runs / lg.rpw) * CAL * q;
}

export function isStarterRow(r: PitRow): boolean {
  return r.gs !== null ? r.gs / Math.max(1, r.g) >= 0.5 : r.outs / Math.max(1, r.g) >= 12;
}

export function pitWar(r: PitRow, lg: Lg, q = 1): number {
  const ip = r.outs / 3;
  if (ip <= 0) return 0;
  const starter = isStarterRow(r);
  const fip = (13 * r.hr + 3 * (r.bb + r.hbp) - 2 * r.so) / ip + lg.fipC;
  const ra9 = (r.r * 9) / ip;
  const mix = 0.5 * fip + 0.5 * ra9;
  const repl = lg.ra9 * (starter ? 1.3 : 1.15);
  const runs = ((repl - mix) / 9) * ip * (starter ? 1 : RELIEF_LEVERAGE);
  return (runs / lg.rpw) * CAL * q;
}
