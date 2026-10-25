// 볼카운트 사슬 (docs/경기엔진2_기획안.md 3.6): 카운트 12칸(볼 0~3 × 스트라이크 0~2)에서 공 하나마다
// 볼·스트라이크(루킹·헛스윙)·파울·맞힘·사구로 옮겨 가는 확률표. 칸마다 리그 모양에 손잡이 세 개(볼 몫, 스트라이크 몫, 사구 몫)를 곱하고,
// 매치업마다 사슬의 끝 확률(삼진 K, 볼넷 W, 사구 H)이 타석 결과 함수의 목표와 같아지게 손잡이를 푼다. 난수를 쓰지 않는다 (경로 뽑기 제외).

import type { Rng } from './rng';

/** 칸 하나의 공 결과 비율: 볼, 스트라이크(루킹·헛스윙·번트 헛스윙, 2스트라이크 번트 파울 포함), 파울, 맞힘, 사구 (합 1) */
export type CellShape = readonly [b: number, s: number, f: number, x: number, h: number];
/** 12칸 모양. 색인 = 볼 × 3 + 스트라이크 */
export type ChainShape = readonly CellShape[];

/** 끝: 삼진, 볼넷, 사구, 맞힘 */
export enum End { K, W, H, X }

/** 사슬 끝 확률 [K, W, H, X] */
export type EndProbs = [number, number, number, number];

/** 손잡이 [볼 몫, 스트라이크 몫, 사구 몫] (리그 모양 그대로면 1, 1, 1) */
export type Knobs = [number, number, number];

const cell = (b: number, s: number) => b * 3 + s;

/**
 * 손잡이를 곱한 칸별 옮겨 갈 확률 (2스트라이크 파울은 칸을 바꾸지 않으므로 그대로 둔다). 반환: 칸 × [b, s, f, x, h].
 * len = 길이 손잡이 (파울 배율, 1 = 리그 모양): 선수별 타석당 투구 수(D단계 가공값)를 맞추는 데 쓴다. 끝 확률은 나머지 손잡이를 다시 풀어 지킨다
 */
export function cellProbs(shape: ChainShape, k: Knobs, len = 1): Float64Array {
  const out = new Float64Array(60);
  for (let c = 0; c < 12; c++) {
    const [b, s, f, x, h] = shape[c];
    const wb = b * k[0];
    const ws = s * k[1];
    const wh = h * k[2];
    const wf = f * len;
    const t = wb + ws + wf + x + wh;
    const o = c * 5;
    out[o] = wb / t;
    out[o + 1] = ws / t;
    out[o + 2] = wf / t;
    out[o + 3] = x / t;
    out[o + 4] = wh / t;
  }
  return out;
}

/**
 * 칸마다 "여기서 시작하면 끝이 무엇일 확률" (뒤에서부터). 2스트라이크 파울은 제자리라 나머지로 나눈다.
 * 반환: 칸 × [K, W, H, X]
 */
export function endFrom(p: Float64Array): Float64Array {
  const e = new Float64Array(48);
  for (let bl = 3; bl >= 0; bl--) {
    for (let st = 2; st >= 0; st--) {
      const c = cell(bl, st);
      const o = c * 5;
      const stay = st === 2 ? p[o + 2] : 0;
      const z = 1 - stay;
      const pb = p[o] / z;
      const ps = p[o + 1] / z;
      const pf = st === 2 ? 0 : p[o + 2] / z;
      const px = p[o + 3] / z;
      const ph = p[o + 4] / z;
      const r = c * 4;
      e[r + End.X] += px;
      e[r + End.H] += ph;
      // 볼
      if (bl === 3) e[r + End.W] += pb;
      else for (let j = 0; j < 4; j++) e[r + j] += pb * e[cell(bl + 1, st) * 4 + j];
      // 스트라이크와 2스트라이크 전 파울
      const up = ps + pf;
      if (st === 2) e[r + End.K] += ps;
      else for (let j = 0; j < 4; j++) e[r + j] += up * e[cell(bl, st + 1) * 4 + j];
    }
  }
  return e;
}

/** 0-0에서 시작한 타석의 끝 확률 */
export function endProbs(shape: ChainShape, k: Knobs, len = 1): EndProbs {
  const e = endFrom(cellProbs(shape, k, len));
  return [e[0], e[1], e[2], e[3]];
}

/**
 * 끝 확률이 목표 (K, W, H)가 되는 손잡이 (로그 공간 뉴턴법, 처음은 늘 1, 1, 1: 같은 목표면 늘 같은 답).
 * 목표를 정확히 맞추지 못하면(극단값) 가장 가까운 값에서 멈춘다
 */
export function solveKnobs(shape: ChainShape, K: number, W: number, H: number, len = 1, tol = 1e-12): Knobs {
  let lk = [0, 0, 0];
  const target = [K, W, H];
  const f = (l: number[]) => {
    const e = endProbs(shape, [Math.exp(l[0]), Math.exp(l[1]), Math.exp(l[2])], len);
    return [e[End.K] - target[0], e[End.W] - target[1], e[End.H] - target[2]];
  };
  let r = f(lk);
  for (let it = 0; it < 40; it++) {
    if (Math.abs(r[0]) < tol && Math.abs(r[1]) < tol && Math.abs(r[2]) < tol) break;
    // 야코비안 (유한 차분)
    const d = 1e-6;
    const J: number[][] = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const l2 = [...lk];
      l2[j] += d;
      const r2 = f(l2);
      for (let i = 0; i < 3; i++) J[i][j] = (r2[i] - r[i]) / d;
    }
    const step = solve3(J, r);
    if (!step) break;
    // 한 번에 너무 멀리 가지 않게
    const m = Math.max(Math.abs(step[0]), Math.abs(step[1]), Math.abs(step[2]));
    const s = m > 2 ? 2 / m : 1;
    lk = [lk[0] - s * step[0], lk[1] - s * step[1], lk[2] - s * step[2]];
    r = f(lk);
  }
  return [Math.exp(lk[0]), Math.exp(lk[1]), Math.exp(lk[2])];
}

/** 3×3 일차방정식 J·x = r (크라메르) */
function solve3(J: number[][], r: number[]): number[] | null {
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(J);
  if (!Number.isFinite(D) || Math.abs(D) < 1e-300) return null;
  const col = (j: number) => J.map((row, i) => row.map((v, k) => (k === j ? r[i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

/** 사슬 하나 (손잡이를 푼 매치업): 칸별 옮겨 갈 확률과 칸별 끝 확률 */
export interface SolvedChain {
  knobs: Knobs;
  p: Float64Array;
  e: Float64Array;
}

export function solvedChain(shape: ChainShape, knobs: Knobs, len = 1): SolvedChain {
  const p = cellProbs(shape, knobs, len);
  return { knobs, p, e: endFrom(p) };
}

/** 0-0에서 시작한 타석의 기대 투구 수 (뒤에서부터: 칸마다 1 + 다음 칸들의 기대값, 2스트라이크 파울은 제자리라 나머지로 나눈다) */
export function expectedPitches(ch: SolvedChain): number {
  const { p } = ch;
  const n = new Float64Array(12);
  for (let bl = 3; bl >= 0; bl--) {
    for (let st = 2; st >= 0; st--) {
      const c = cell(bl, st);
      const o = c * 5;
      const stay = st === 2 ? p[o + 2] : 0;
      const afterBall = bl === 3 ? 0 : p[o] * n[cell(bl + 1, st)];
      const afterStrike = st === 2 ? 0 : (p[o + 1] + p[o + 2]) * n[cell(bl, st + 1)];
      n[c] = (1 + afterBall + afterStrike) / (1 - stay);
    }
  }
  return n[0];
}

/** 지나간 칸과 공 결과를 받는 함수 (검증 도구용): 칸 색인, 결과 0 볼·1 스트라이크·2 파울·3 맞힘·4 사구 */
export type PitchObserver = (c: number, kind: number) => void;

/**
 * 끝이 end로 정해진 타석의 공 경로를 뽑아 공 수를 돌려준다 (조건부 사슬: 다음 칸으로 갈 확률 × 그 칸에서 end로 끝날 확률).
 * 칸마다 난수 한 번. b0·s0: 시작 카운트 (A → B 넘기기에서 타석 중간부터 접을 때, 엔진 2 18단계). 돌려주는 공 수는 그 뒤 공만
 */
export function samplePitches(ch: SolvedChain, end: End, rng: Rng, observe?: PitchObserver, b0 = 0, s0 = 0): number {
  const { p, e } = ch;
  let bl = b0;
  let st = s0;
  let n = 0;
  for (;;) {
    const c = cell(bl, st);
    const o = c * 5;
    n++;
    // 각 공 결과의 무게 = 확률 × (그 뒤 end로 끝날 확률)
    const toBall = bl === 3 ? (end === End.W ? 1 : 0) : e[cell(bl + 1, st) * 4 + end];
    const toStrike = st === 2 ? (end === End.K ? 1 : 0) : e[cell(bl, st + 1) * 4 + end];
    const toFoul = st === 2 ? e[c * 4 + end] : toStrike;
    const wb = p[o] * toBall;
    const ws = p[o + 1] * toStrike;
    const wf = p[o + 2] * toFoul;
    const wx = end === End.X ? p[o + 3] : 0;
    const wh = end === End.H ? p[o + 4] : 0;
    let u = rng.next() * (wb + ws + wf + wx + wh);
    if ((u -= wb) < 0) {
      observe?.(c, 0);
      if (bl === 3) return n;
      bl++;
    } else if ((u -= ws) < 0) {
      observe?.(c, 1);
      if (st === 2) return n;
      st++;
    } else if ((u -= wf) < 0) {
      observe?.(c, 2);
      if (st < 2) st++;
    } else if ((u -= wx) < 0 || end === End.X) {
      observe?.(c, 3);
      return n;
    } else {
      observe?.(c, 4);
      return n;
    }
    if (n > 60) return n; // 파울이 끝없이 이어지는 일은 없지만 안전장치
  }
}

/**
 * 카운트 (b, s)에서 시작한 남은 타석을 계산으로 접는다 (A → B 넘기기, 엔진 2 18단계, 기획안 3.8): 그 칸의 끝 확률로 끝을 뽑고
 * (난수 한 번) 끝이 정해진 공 경로로 남은 공 수를 뽑는다. 0-0이면 B 해결기와 같은 분포다
 */
export function foldFrom(ch: SolvedChain, b: number, s: number, rng: Rng): { end: End; pitches: number } {
  const r = cell(b, s) * 4;
  const e = ch.e;
  let u = rng.next() * (e[r] + e[r + 1] + e[r + 2] + e[r + 3]);
  let end = End.X;
  for (const k of [End.K, End.W, End.H]) {
    if ((u -= e[r + k]) < 0) { end = k; break; }
  }
  return { end, pitches: samplePitches(ch, end, rng, undefined, b, s) };
}
