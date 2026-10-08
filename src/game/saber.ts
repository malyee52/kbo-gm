// 세이버메트릭스 기록: 그 시즌 리그 전체 기록을 기준으로 계산한다 (시뮬레이션 기록 기준).
// 구장 효과가 없는 엔진이라 wRC+는 구장 보정을 하지 않는다. 고의4구 기록이 없어 볼넷 전체를 쓴다.

import { LINEAR_WEIGHTS, type BatLine, type PitLine } from '../engine';
import { WOBA_SCALE } from '../ai/value';

export interface LeagueBase {
  /** 리그 wOBA */
  woba: number;
  /** 타석당 득점 */
  runsPerPa: number;
  /** FIP 상수: 리그 평균자책 - 리그 (13HR + 3(BB+HBP) - 2K) / IP */
  fipConst: number;
}

const W = LINEAR_WEIGHTS;
const singles = (b: BatLine) => b.h - b.d - b.t - b.hr;

function wobaParts(b: BatLine): [number, number] {
  const num = W.bb * b.bb + W.hbp * b.hbp + W.s1 * singles(b) + W.d2 * b.d + W.t3 * b.t + W.hr * b.hr;
  const den = b.ab + b.bb + b.sf + b.hbp;
  return [num, den];
}

/** 리그 기준값. bat·pit는 그 시즌 모든 선수의 기록 */
export function leagueBase(bat: BatLine[], pit: PitLine[]): LeagueBase {
  let num = 0;
  let den = 0;
  let pa = 0;
  let r = 0;
  for (const b of bat) {
    const [n, d] = wobaParts(b);
    num += n;
    den += d;
    pa += b.pa;
    r += b.r;
  }
  let er = 0;
  let outs = 0;
  let hr = 0;
  let bbhbp = 0;
  let so = 0;
  for (const p of pit) {
    er += p.er;
    outs += p.outs;
    hr += p.hr;
    bbhbp += p.bb + p.hbp;
    so += p.so;
  }
  const ip = outs / 3;
  const lgEra = ip > 0 ? (er * 9) / ip : 0;
  return {
    woba: den > 0 ? num / den : 0,
    runsPerPa: pa > 0 ? r / pa : 0,
    fipConst: ip > 0 ? lgEra - (13 * hr + 3 * bbhbp - 2 * so) / ip : 3.1,
  };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : NaN);

// ---- 타자

export const woba = (b: BatLine) => {
  const [n, d] = wobaParts(b);
  return ratio(n, d);
};

/** wRC+: 100 = 리그 평균. (wRAA/PA + 리그 타석당 득점) ÷ 리그 타석당 득점 × 100 */
export function wrcPlus(b: BatLine, lg: LeagueBase): number {
  const w = woba(b);
  if (!Number.isFinite(w) || b.pa === 0 || lg.runsPerPa === 0) return NaN;
  const wraaPerPa = (w - lg.woba) / WOBA_SCALE;
  return ((wraaPerPa + lg.runsPerPa) / lg.runsPerPa) * 100;
}

/** wRAA: 리그 평균 타자보다 더 낸 득점 */
export const wraa = (b: BatLine, lg: LeagueBase) => {
  const w = woba(b);
  return Number.isFinite(w) ? ((w - lg.woba) / WOBA_SCALE) * b.pa : NaN;
};

export const iso = (b: BatLine) => ratio(b.d + 2 * b.t + 3 * b.hr, b.ab);
export const babip = (b: BatLine) => ratio(b.h - b.hr, b.ab - b.so - b.hr + b.sf);
export const bbPct = (b: BatLine) => ratio(b.bb, b.pa);
export const kPct = (b: BatLine) => ratio(b.so, b.pa);
export const bbPerK = (b: BatLine) => (b.so > 0 ? b.bb / b.so : b.bb > 0 ? Infinity : NaN);
export const sbPct = (b: BatLine) => ratio(b.sb, b.sb + b.cs);

// ---- 투수

const ipOf = (p: PitLine) => p.outs / 3;
export const fip = (p: PitLine, lg: LeagueBase) => (p.outs > 0 ? (13 * p.hr + 3 * (p.bb + p.hbp) - 2 * p.so) / ipOf(p) + lg.fipConst : NaN);
export const per9 = (n: number, p: PitLine) => (p.outs > 0 ? (n * 27) / p.outs : NaN);
export const pitKPct = (p: PitLine) => ratio(p.so, p.bf);
export const pitBbPct = (p: PitLine) => ratio(p.bb, p.bf);
/** 피BABIP. 투수 기록에 희생플라이·번트가 없어 상대 타자에서 삼진·볼넷·사구·홈런만 뺀 근사값 */
export const pitBabip = (p: PitLine) => ratio(p.h - p.hr, p.bf - p.so - p.bb - p.hbp - p.hr);
/** 잔루율: (H + BB + HBP - R) ÷ (H + BB + HBP - 1.4 × HR). 표본이 적으면 식이 100%를 넘을 수 있어 0~100%로 자른다 */
export const lobPct = (p: PitLine) => {
  const v = ratio(p.h + p.bb + p.hbp - p.r, p.h + p.bb + p.hbp - 1.4 * p.hr);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v;
};

// ---- 표시

/** 0.123 → "12.3%" */
export function pct1(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-';
}

export function int0(x: number): string {
  return Number.isFinite(x) ? String(Math.round(x)) : '-';
}
