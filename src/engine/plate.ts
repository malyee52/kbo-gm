// 볼카운트 사슬 능력 (docs/능력치v2_기획안.md 1.2·1.5·1.8, 16-1): 칸마다 공 하나를 "존 안인가(투수 제구) → 휘두르나(타자 적극성·선구,
// 존 밖은 투수 구위도) → 맞히나(타자 맞히기 대 투수 구위, 2스트라이크 칸은 2S 대처) → 파울이냐 인플레이냐(타자 끈질김 대 투수 투구 효율)"로
// 나눠 칸의 [볼, 스트라이크, 파울, 맞힘, 사구]를 만든다. 능력은 모두 리그 대비 로짓 차(0 = 그 해 리그 평균)이고 로짓에 더한다.
// 모든 능력이 0이면 칸 확률이 그 해 리그 사슬 모양과 같다 (영점, tests/plate.test.ts). 난수를 쓰지 않는다.

import { cellProbs, endFrom, End, expectedPitches, solveKnobs, type ChainShape, type SolvedChain } from './chain';
import type { PlateParams, PlateAbility } from './params';
import type { BatSkill, PitSkill } from './types';

/** 타자 사슬 능력 (로짓 차) */
export interface BatPlate {
  /** 적극성: 존 안·밖 스윙 로짓에 같이 더한다 (좋고 나쁨 없음) */
  agg: number;
  /** 선구: 존 안 스윙 + ½, 존 밖 − ½ */
  eye: number;
  /** 맞히기: 스윙 → 맞힘 로짓 (투수 구위와 맞선다) */
  con: number;
  /** 2스트라이크 대처: 2스트라이크 칸의 맞힘 로짓에만 더한다 */
  two: number;
  /** 끈질김: 맞힘 → 파울 로짓 (투수 투구 효율과 맞선다) */
  tough: number;
}

/** 투수 사슬 능력 (로짓 차) */
export interface PitPlate {
  /** 제구: 존 안 공 로짓 */
  ctl: number;
  /** 구위: 타자 맞힘 로짓에서 빼고, 존 밖 스윙 로짓에 alpha배 더한다 */
  stuff: number;
  /** 투구 효율: 맞힘 → 파울 로짓에서 뺀다 */
  eff: number;
}

export const ZERO_BAT: BatPlate = { agg: 0, eye: 0, con: 0, two: 0, tough: 0 };
export const ZERO_PIT: PitPlate = { ctl: 0, stuff: 0, eff: 0 };

/** 매치업 보정 (선수 능력 밖): 환경 맞춤·좌우·홈·특수능력·피로를 맞히기·선구 로짓으로 옮긴 값과 사구 배율 */
export interface PlateShift {
  con: number;
  eye: number;
  hbp: number;
}
export const NO_SHIFT: PlateShift = { con: 0, eye: 0, hbp: 1 };

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/**
 * 그 해 리그 칸 상수: 칸마다 존 비율·스윙·맞힘·파울의 로짓과 스윙 안 한 공의 스트라이크 판정률, 사구 몫.
 * 가공표(count_zone.csv, params.plate.split)의 칸 × 존 비율에서 시작해, 칸마다 존·맞힘·파울 로짓을 하나씩 옮겨
 * 모든 능력이 0일 때 그 해 리그 사슬 칸(shape × 리그 손잡이)과 정확히 같아지게 한다
 */
export interface LeaguePlate {
  lz: Float64Array;
  lsi: Float64Array;
  lso: Float64Array;
  lci: Float64Array;
  lco: Float64Array;
  lfi: Float64Array;
  lfo: Float64Array;
  csi: Float64Array;
  cso: Float64Array;
  h: Float64Array;
  alpha: number;
  /** 리그 평균 매치업의 끝 확률 [K, W, H, X]와 타석당 기대 투구 수 */
  end: [number, number, number, number];
  ppa: number;
  /** (ln K 배율, ln W 배율) → (맞히기, 선구) 로짓 차: 리그 평균 매치업에서 잰 야코비안의 역 */
  inv: [number, number, number, number];
}

/** 리그 칸 상수를 맞출 때 스윙 중 맞힘 몫의 상한 (임시값: 2023~2025 칸별 실측 최대 약 0.89 위에 여유) */
const MAX_CONTACT = 0.95;

/** 단조 함수 f가 target이 되는 x (이분법, [−30, 30]) */
function bisect(f: (x: number) => number, target: number, increasing: boolean): number {
  let lo = -30;
  let hi = 30;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) < target) === increasing) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-14) break;
  }
  return (lo + hi) / 2;
}

/**
 * 리그 칸 상수. target = 그 해 리그 사슬 칸 (cellProbs 결과), split = 칸마다 [존 비율, 존 안 스윙, 존 밖 스윙, 존 안 맞힘(스윙 중), 존 밖 맞힘,
 * 존 안 파울(맞힘 중), 존 밖 파울, 존 안 루킹 스트라이크(스윙 안 한 공 중), 존 밖 루킹 스트라이크]
 */
export function leaguePlate(target: Float64Array, split: readonly (readonly number[])[], alpha: number): LeaguePlate {
  const arr = () => new Float64Array(12);
  const lp: LeaguePlate = {
    lz: arr(), lsi: arr(), lso: arr(), lci: arr(), lco: arr(), lfi: arr(), lfo: arr(), csi: arr(), cso: arr(), h: arr(), alpha,
    end: [0, 0, 0, 0], ppa: 0, inv: [0, 0, 0, 0],
  };
  for (let c = 0; c < 12; c++) {
    const o = c * 5;
    const [zr, swi, swo, cti, cto, fi, fo, csi, cso] = split[c];
    const h = target[o + 4];
    const nb = 1 - h;
    const bT = target[o] / nb;
    const fT = target[o + 2] / nb;
    const xT = target[o + 3] / nb;
    // 존 로짓을 옮겨 볼 몫을 맞춘다 (존 안 공이 늘면 볼이 준다). os = 스윙 로짓 옮김 (아래)
    const zoneFor = (os: number) => {
      const wi = sig(logit(swi) + os);
      const wo = sig(logit(swo) + os);
      const ball = (oz: number) => { const p = sig(logit(zr) + oz); return p * (1 - wi) * (1 - csi) + (1 - p) * (1 - wo) * (1 - cso); };
      const oz = bisect(ball, bT, false);
      const pin = sig(logit(zr) + oz);
      return { oz, si: pin * wi, so: (1 - pin) * wo };
    };
    // 맞힘(파울 + 인플레이)이 스윙의 MAX_CONTACT를 넘어야 하는 칸(투구 단위 자료가 없는 옛 해에 리그 손잡이가 스트라이크를 크게 줄인 칸)은
    // 스윙 로짓을 함께 올려 맞힘 몫이 MAX_CONTACT가 되게 한다. 2023~2025는 해당 칸이 없어 os = 0
    const need = (os: number) => { const z = zoneFor(os); return (fT + xT) / (z.si + z.so); };
    const os = need(0) > MAX_CONTACT ? bisect(need, MAX_CONTACT, false) : 0;
    const { oz, si, so } = zoneFor(os);
    // 맞힘 로짓을 옮겨 (파울 + 인플레이)를 맞춘다
    const oc = bisect((x) => si * sig(logit(cti) + x) + so * sig(logit(cto) + x), fT + xT, true);
    const ci = si * sig(logit(cti) + oc);
    const co = so * sig(logit(cto) + oc);
    // 파울 로짓을 옮겨 파울을 맞춘다
    const of = bisect((x) => ci * sig(logit(fi) + x) + co * sig(logit(fo) + x), fT, true);
    lp.lz[c] = logit(zr) + oz;
    lp.lsi[c] = logit(swi) + os;
    lp.lso[c] = logit(swo) + os;
    lp.lci[c] = logit(cti) + oc;
    lp.lco[c] = logit(cto) + oc;
    lp.lfi[c] = logit(fi) + of;
    lp.lfo[c] = logit(fo) + of;
    lp.csi[c] = csi;
    lp.cso[c] = cso;
    lp.h[c] = h;
  }
  const base = plateChain(lp, ZERO_BAT, ZERO_PIT, NO_SHIFT);
  lp.end = endOf(base);
  lp.ppa = expectedPitches(base);
  // 맞히기·선구를 조금 옮겼을 때 ln K·ln W가 움직이는 크기 (중앙 차분)
  const d = 1e-4;
  const at = (con: number, eye: number) => {
    const e = endOf(plateChain(lp, ZERO_BAT, ZERO_PIT, { con, eye, hbp: 1 }));
    return [Math.log(e[End.K]), Math.log(e[End.W])];
  };
  const [kc1, wc1] = at(d, 0);
  const [kc0, wc0] = at(-d, 0);
  const [ke1, we1] = at(0, d);
  const [ke0, we0] = at(0, -d);
  const a = (kc1 - kc0) / (2 * d);
  const b = (ke1 - ke0) / (2 * d);
  const c = (wc1 - wc0) / (2 * d);
  const e = (we1 - we0) / (2 * d);
  const det = a * e - b * c;
  lp.inv = [e / det, -b / det, -c / det, a / det];
  return lp;
}

/** 그 해 리그 칸 상수를 엔진 조정값에서: 리그 사슬 모양에 그 해 리그 K·W·H가 나오는 손잡이를 한 번 풀어 곱한 칸이 영점 */
export function leaguePlateFor(shape: ChainShape, league: { so: number; bb: number; hbp: number }, pp: PlateParams): LeaguePlate {
  const knobs = solveKnobs(shape, league.so, league.bb, league.hbp);
  return leaguePlate(cellProbs(shape, knobs), pp.split, pp.alpha);
}

/** 칸 하나의 공 결과 [볼, 스트라이크, 파울, 맞힘(인플레이), 사구]를 out[o..o+4]에 */
function cellInto(out: Float64Array, c: number, lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift): void {
  const eye = b.eye + sh.eye;
  const pin = sig(lp.lz[c] + p.ctl);
  const si = pin * sig(lp.lsi[c] + b.agg + eye / 2);
  const so = (1 - pin) * sig(lp.lso[c] + b.agg - eye / 2 + lp.alpha * p.stuff);
  const cadj = b.con - p.stuff + sh.con + (c % 3 === 2 ? b.two : 0);
  const ci = si * sig(lp.lci[c] + cadj);
  const co = so * sig(lp.lco[c] + cadj);
  const fadj = b.tough - p.eff;
  const fi = ci * sig(lp.lfi[c] + fadj);
  const fo = co * sig(lp.lfo[c] + fadj);
  const ti = pin - si;
  const to = 1 - pin - so;
  const h = Math.min(0.5, lp.h[c] * sh.hbp);
  const nb = 1 - h;
  const o = c * 5;
  out[o] = (ti * (1 - lp.csi[c]) + to * (1 - lp.cso[c])) * nb;
  out[o + 1] = (ti * lp.csi[c] + to * lp.cso[c] + si - ci + so - co) * nb;
  out[o + 2] = (fi + fo) * nb;
  out[o + 3] = (ci - fi + co - fo) * nb;
  out[o + 4] = h;
}

/** 칸 함수: 12칸 × [볼, 스트라이크, 파울, 맞힘, 사구] (chain.ts cellProbs와 같은 꼴) */
export function plateCells(lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift = NO_SHIFT): Float64Array {
  const out = new Float64Array(60);
  for (let c = 0; c < 12; c++) cellInto(out, c, lp, b, p, sh);
  return out;
}

/** 칸 하나의 단계별 확률 (A 엔진·검증용): 존 안, 존 안·밖 스윙, 맞힘(스윙 중), 파울(맞힘 중), 루킹 스트라이크(스윙 안 한 공 중), 사구 */
export function plateSteps(lp: LeaguePlate, c: number, b: BatPlate, p: PitPlate, sh: PlateShift = NO_SHIFT) {
  const eye = b.eye + sh.eye;
  const cadj = b.con - p.stuff + sh.con + (c % 3 === 2 ? b.two : 0);
  const fadj = b.tough - p.eff;
  return {
    zone: sig(lp.lz[c] + p.ctl),
    swingIn: sig(lp.lsi[c] + b.agg + eye / 2),
    swingOut: sig(lp.lso[c] + b.agg - eye / 2 + lp.alpha * p.stuff),
    contactIn: sig(lp.lci[c] + cadj),
    contactOut: sig(lp.lco[c] + cadj),
    foulIn: sig(lp.lfi[c] + fadj),
    foulOut: sig(lp.lfo[c] + fadj),
    calledIn: lp.csi[c],
    calledOut: lp.cso[c],
    hbp: Math.min(0.5, lp.h[c] * sh.hbp),
  };
}

/** 칸 함수로 만든 사슬 (해결기가 공 수를 뽑는 데 쓴다) */
export function plateChain(lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift = NO_SHIFT): SolvedChain {
  const pr = plateCells(lp, b, p, sh);
  return { knobs: [1, 1, 1], p: pr, e: endFrom(pr) };
}

export function endOf(ch: SolvedChain): [number, number, number, number] {
  return [ch.e[0], ch.e[1], ch.e[2], ch.e[3]];
}

/** 삼진·볼넷 배율(리그 평균 매치업 기준)을 맞히기·선구 로짓 차로 옮긴다 (환경 맞춤·좌우·홈·특수능력·피로, 기획안 1.9 4·5) */
export function shiftFor(lp: LeaguePlate, mK: number, mW: number, mH: number): PlateShift {
  const lk = Math.log(mK);
  const lw = Math.log(mW);
  return { con: lp.inv[0] * lk + lp.inv[1] * lw, eye: lp.inv[2] * lk + lp.inv[3] * lw, hbp: mH };
}

/** 작은 연립방정식 (가우스 소거, 부분 피벗) */
function solveLinear(A: number[][], r: number[]): number[] | null {
  const n = r.length;
  const M = A.map((row, i) => [...row, r[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    if (Math.abs(M[piv][i]) < 1e-300) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

const LIMIT = 4;

/**
 * 결과 목표(리그 평균 상대 K·W, 있으면 타석당 투구 수)가 나오는 능력 (뉴턴법, 처음은 0: 같은 목표면 늘 같은 답).
 * 극단 목표는 ±4에서 멈춘다
 */
function newton(n: number, f: (u: number[]) => number[]): number[] {
  let u = new Array(n).fill(0);
  let r = f(u);
  for (let it = 0; it < 40; it++) {
    if (r.every((v) => Math.abs(v) < 1e-11)) break;
    const d = 1e-6;
    const J: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const u2 = [...u];
      u2[j] += d;
      const r2 = f(u2);
      for (let i = 0; i < n; i++) J[i][j] = (r2[i] - r[i]) / d;
    }
    const step = solveLinear(J, r);
    if (!step) break;
    const m = Math.max(...step.map(Math.abs));
    const s = m > 1 ? 1 / m : 1;
    u = u.map((v, i) => Math.max(-LIMIT, Math.min(LIMIT, v - s * step[i])));
    r = f(u);
  }
  return u;
}

/** 결과 기록만 있는 타자 (2022년 이전 해, 가상 선수): 적극성·2S 대처는 주어진 값, 선구·맞히기(·끈질김)를 K·W(·투구 수)에 맞춘다 */
export function solveBat(lp: LeaguePlate, K: number, W: number, ppa: number | undefined, agg: number, two = 0): BatPlate {
  const lK = Math.log(K);
  const lW = Math.log(W);
  const withPpa = ppa !== undefined;
  const u = newton(withPpa ? 3 : 2, (v) => {
    const ch = plateChain(lp, { agg, eye: v[0], con: v[1], two, tough: withPpa ? v[2] : 0 }, ZERO_PIT);
    const r = [Math.log(ch.e[End.K]) - lK, Math.log(ch.e[End.W]) - lW];
    if (withPpa) r.push(Math.log(expectedPitches(ch)) - Math.log(ppa));
    return r;
  });
  return { agg, eye: u[0], con: u[1], two, tough: withPpa ? u[2] : 0 };
}

/** 결과 기록만 있는 투수: 제구·구위(·투구 효율)를 리그 평균 타자 상대 K·W(·투구 수)에 맞춘다 */
export function solvePit(lp: LeaguePlate, K: number, W: number, ppa: number | undefined): PitPlate {
  const lK = Math.log(K);
  const lW = Math.log(W);
  const withPpa = ppa !== undefined;
  const u = newton(withPpa ? 3 : 2, (v) => {
    const ch = plateChain(lp, ZERO_BAT, { ctl: v[0], stuff: v[1], eff: withPpa ? v[2] : 0 });
    const r = [Math.log(ch.e[End.K]) - lK, Math.log(ch.e[End.W]) - lW];
    if (withPpa) r.push(Math.log(expectedPitches(ch)) - Math.log(ppa));
    return r;
  });
  return { ctl: u[0], stuff: u[1], eff: withPpa ? u[2] : 0 };
}

/**
 * 결과 기록으로 짐작한 적극성 (2022년 이전 짐작 식, tools/fit_plate_estimate.ts가 2023~2025 실측으로 맞춤, 기획안 1.12·9.6).
 * 입력은 모두 리그 대비: 삼진·볼넷 로짓 차, 안타당 추가 루 차(파워), 인플레이(홈런 포함)당 안타 차(컨택)
 */
export function aggEstimate(coef: readonly number[], K: number, W: number, H: number, hits: { hr: number; s1: number; d2: number; t3: number },
  lg: { so: number; bb: number; hbp: number; hr: number; s1: number; d2: number; t3: number }): number {
  const x = plateInputs(K, W, H, hits, lg);
  return coef[0] + coef[1] * x[0] + coef[2] * x[1] + coef[3] * x[2] + coef[4] * x[3];
}

/** 짐작 식 입력 [삼진 로짓 차, 볼넷 로짓 차, 파워 차, 컨택 차] */
export function plateInputs(K: number, W: number, H: number, s: { hr: number; s1: number; d2: number; t3: number },
  lg: { so: number; bb: number; hbp: number; hr: number; s1: number; d2: number; t3: number }): [number, number, number, number] {
  const hits = s.hr + s.s1 + s.d2 + s.t3;
  const lgHits = lg.hr + lg.s1 + lg.d2 + lg.t3;
  const pow = hits > 0 ? (s.d2 + 2 * s.t3 + 3 * s.hr) / hits : 0;
  const lgPow = (lg.d2 + 2 * lg.t3 + 3 * lg.hr) / lgHits;
  const bip = 1 - K - W - H;
  const lgBip = 1 - lg.so - lg.bb - lg.hbp;
  return [logit(K) - logit(lg.so), logit(W) - logit(lg.bb), pow - lgPow, (bip > 0 ? hits / bip : 0) - lgHits / lgBip];
}

// ---- 등급 눈금 (기획안 1.7, 11.2): 등급 = 50 + 10 × e⁻¹((값 − 중앙) ÷ 중간폭), e(z) = z + a·max(0, z − 1)² − b·max(0, −z − 1)² ----

/** 볼록 곡선 e(z) */
export function convex(z: number, a: number, b: number): number {
  return z + a * Math.max(0, z - 1) ** 2 - b * Math.max(0, -z - 1) ** 2;
}

/** e⁻¹(y): 단조라 하나로 정해진다 (가운데 직선, 바깥은 이차식 근) */
export function convexInv(y: number, a: number, b: number): number {
  if (y > 1 && a > 0) return 1 + (-1 + Math.sqrt(1 + 4 * a * (y - 1))) / (2 * a);
  if (y < -1 && b > 0) return -1 - (-1 + Math.sqrt(1 + 4 * b * (-y - 1))) / (2 * b);
  return y;
}

/** 내부 값(로짓 차) → 등급. 자르지 않는다 (화면은 20~80으로 자른다) */
export function plateGrade(g: PlateAbility, v: number): number {
  return 50 + 10 * convexInv((v - g.mid) / g.half, g.a, g.b);
}

/** 등급 → 내부 값 (성장·가상 선수가 등급으로 정할 때) */
export function plateValue(g: PlateAbility, grade: number): number {
  return g.mid + g.half * convex((grade - 50) / 10, g.a, g.b);
}

// ---- 선수 능력: 결과 기록으로 푼 값(짐작) + 실측 몫 ----

type LeagueRates = { so: number; bb: number; hbp: number; hr: number; s1: number; d2: number; t3: number };

/** 결과 기록(BatSkill, 리그 대비 비율)으로 푼 타자 사슬 능력: 적극성은 짐작 식, 선구·맞히기(·P/PA가 있으면 끈질김)는 리그 평균 투수 상대 K·W(·투구 수)에 맞춤 */
export function solvedBatPlate(bs: Pick<BatSkill, 'so' | 'bb' | 'hbp' | 'hr' | 's1' | 'd2' | 't3' | 'ppaRel'>, lg: LeagueRates, lp: LeaguePlate, pp: PlateParams): BatPlate {
  const K = bs.so * lg.so;
  const W = bs.bb * lg.bb;
  const H = bs.hbp * lg.hbp;
  const agg = aggEstimate(pp.aggFormula, K, W, H, { hr: bs.hr * lg.hr, s1: bs.s1 * lg.s1, d2: bs.d2 * lg.d2, t3: bs.t3 * lg.t3 }, lg);
  return solveBat(lp, K, W, bs.ppaRel !== undefined ? bs.ppaRel * lp.ppa : undefined, agg);
}

/** 결과 기록(PitSkill)으로 푼 투수 사슬 능력: 리그 평균 타자 상대 K·W(·투구 수)에 맞춘 제구·구위(·투구 효율) */
export function solvedPitPlate(ps: Pick<PitSkill, 'so' | 'bb' | 'ppaRel'>, lg: LeagueRates, lp: LeaguePlate): PitPlate {
  return solvePit(lp, ps.so * lg.so, ps.bb * lg.bb, ps.ppaRel !== undefined ? ps.ppaRel * lp.ppa : undefined);
}

/** 실측 로짓 차: logit(실제) − logit(리그 평균 기대), 반 개씩 더해 0·1을 피한다 (tools/fit_plate_estimate.ts와 같은 식) */
export function plateDiff(obs: number, exp: number, n: number): number {
  return logit((obs + 0.5) / (n + 1)) - logit((exp + 0.5) / (n + 1));
}

/** 시즌 가중치와 그 시즌 실측 건수 (plate.json 한 줄) */
export interface PlateSeason {
  w: number;
  c: readonly number[];
}

/** 당김: (Σ 가중 × n × 실측 + k × 짐작) ÷ (Σ 가중 × n + k) */
function pool(rows: readonly PlateSeason[], val: (c: readonly number[]) => number, n: (c: readonly number[]) => number, prior: number, k: number): number {
  let num = k * prior;
  let den = k;
  for (const r of rows) {
    const m = r.w * n(r.c);
    if (!(m > 0)) continue;
    num += m * val(r.c);
    den += m;
  }
  return num / den;
}

/** 타자 실측 시즌들 → 사슬 능력. 짐작(solved) 쪽으로 능력별 당김 공 수만큼 당긴다 (2S 대처는 0 쪽) */
export function measuredBatPlate(rows: readonly PlateSeason[], solved: BatPlate, pp: PlateParams): BatPlate {
  const k = pp.regress;
  const din = pool(rows, (c) => plateDiff(c[1], c[2], c[0]), (c) => c[0], solved.agg + solved.eye / 2, k.swIn);
  const dout = pool(rows, (c) => plateDiff(c[4], c[5], c[3]), (c) => c[3], solved.agg - solved.eye / 2, k.swOut);
  const con = pool(rows, (c) => plateDiff(c[7], c[8], c[6]), (c) => c[6], solved.con, k.con);
  const two = pool(rows, (c) => plateDiff(c[10], c[11], c[9]) - plateDiff(c[7], c[8], c[6]), (c) => c[9], solved.two, k.two);
  const tough = pool(rows, (c) => plateDiff(c[13], c[14], c[12]), (c) => c[12], solved.tough, k.tough);
  return { agg: (din + dout) / 2, eye: din - dout, con, two, tough };
}

/** 투수 실측 시즌들 → 사슬 능력 (짐작 쪽으로 당김) */
export function measuredPitPlate(rows: readonly PlateSeason[], solved: PitPlate, pp: PlateParams): PitPlate {
  const k = pp.regress;
  return {
    ctl: pool(rows, (c) => plateDiff(c[1], c[2], c[0]), (c) => c[0], solved.ctl, k.ctl),
    stuff: pool(rows, (c) => -plateDiff(c[4], c[5], c[3]), (c) => c[3], solved.stuff, k.stuff),
    eff: pool(rows, (c) => -plateDiff(c[7], c[8], c[6]), (c) => c[6], solved.eff, k.eff),
  };
}

export function addBat(a: BatPlate, b: BatPlate | undefined, sign = 1): BatPlate {
  if (!b) return a;
  return { agg: a.agg + sign * b.agg, eye: a.eye + sign * b.eye, con: a.con + sign * b.con, two: a.two + sign * b.two, tough: a.tough + sign * b.tough };
}

export function addPit(a: PitPlate, b: PitPlate | undefined, sign = 1): PitPlate {
  if (!b) return a;
  return { ctl: a.ctl + sign * b.ctl, stuff: a.stuff + sign * b.stuff, eff: a.eff + sign * b.eff };
}
