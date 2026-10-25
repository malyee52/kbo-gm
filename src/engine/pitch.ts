// A 해결기 (투구 단위, docs/경기엔진2_기획안.md 3.4·3.6.1, 엔진 2 17단계): B와 같은 볼카운트 사슬을 공 하나씩 그대로 돌린다.
// 한 공 = 칸의 [볼, 스트라이크, 파울, 맞힘, 사구] 확률에서 난수 한 번. 스트라이크는 칸 함수(plate.ts)의 루킹·헛스윙 몫으로 나눠 보여 주지만
// 다섯 결과의 확률은 사슬 그대로라, 한 매치업 안에서 (끝 결과, 투구 수)의 분포가 B(사슬을 계산으로 접은 것)와 식으로 같다.
// 맞힘 뒤 결과(홈런·안타·아웃)는 B와 같은 확률표의 조건부 몫(resolver.ts drawInPlay)이다.
// 구종·코스(20단계)는 arsenal.ts: 공 결과는 이 사슬 그대로 뽑고, 구종·코스는 결과에 맞춰 따로 붙이거나(지시 없음) 지시한 구종·코스의 결과 비율로 뽑는다.

import { End, type SolvedChain } from './chain';
import { plateSteps, type BatPlate, type LeaguePlate, type PitPlate, type PlateShift } from './plate';
import type { PitchZone } from './arsenal';
import type { Rng } from './rng';

/**
 * 공 하나의 결과 기호: B 볼, C 루킹 스트라이크, S 헛스윙(번트 헛스윙 포함), T 스트라이크(루킹·헛스윙을 가를 수 없는 사슬), F 파울,
 * X 맞힘(인플레이), H 사구, I 고의4구 공 (수동 고의4구, 사슬 밖)
 */
export type PitchCode = 'B' | 'C' | 'S' | 'T' | 'F' | 'X' | 'H' | 'I';

/** 공 하나 (기획안 3.4.1) */
export interface Pitch {
  /** 던지기 전 카운트 [볼, 스트라이크] */
  count: [number, number];
  /** 구종 (arsenal.ts PITCH_TYPES, 20단계) */
  type?: string;
  /** 코스 (arsenal.ts PitchZone, 20단계) */
  zone?: PitchZone;
  result: PitchCode;
  /** 이 투수의 경기 투구 수 (던진 뒤) */
  pitches: number;
}

const cellOf = (b: number, s: number) => b * 3 + s;

/**
 * 칸마다 스트라이크 가운데 루킹 몫 (화면용: 루킹 ↔ 헛스윙만 가른다, 다섯 결과의 확률은 그대로).
 * 칸 함수의 단계 확률(plate.ts plateSteps)로: 루킹 = 존 안 안 휘두름 × 존 안 판정 + 존 밖 안 휘두름 × 존 밖 판정, 헛스윙 = 휘둘러 못 맞힘
 */
export function calledShare(lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift): Float64Array {
  const out = new Float64Array(12);
  for (let c = 0; c < 12; c++) {
    const t = plateSteps(lp, c, b, p, sh);
    const called = (t.zone * (1 - t.swingIn)) * t.calledIn + ((1 - t.zone) * (1 - t.swingOut)) * t.calledOut;
    const swung = t.zone * t.swingIn * (1 - t.contactIn) + (1 - t.zone) * t.swingOut * (1 - t.contactOut);
    out[c] = called + swung > 0 ? called / (called + swung) : 0;
  }
  return out;
}

/**
 * 공 하나를 뽑는다 (난수 한 번): 칸 (b, s)의 [볼, 스트라이크, 파울, 맞힘, 사구] 그대로. called(칸별 루킹 몫)가 있으면 스트라이크를 C·S로 나눈다
 */
export function drawPitch(ch: SolvedChain, b: number, s: number, rng: Rng, called?: Float64Array): PitchCode {
  const c = cellOf(b, s);
  const o = c * 5;
  const p = ch.p;
  let u = rng.next() * (p[o] + p[o + 1] + p[o + 2] + p[o + 3] + p[o + 4]);
  if ((u -= p[o]) < 0) return 'B';
  if ((u -= p[o + 1]) < 0) {
    if (!called) return 'T';
    return u + p[o + 1] < p[o + 1] * called[c] ? 'C' : 'S';
  }
  if ((u -= p[o + 2]) < 0) return 'F';
  if ((u -= p[o + 3]) < 0 || p[o + 4] <= 0) return 'X';
  return 'H';
}

/** 진행 중인 타석의 카운트 */
export interface Count {
  b: number;
  s: number;
  /** 이 타석에 던진 공 (기호) */
  seq: string;
  /** 공마다 구종·코스 (A 해결기가 채운다, 엔진 2 20단계) */
  pt?: string[];
  pz?: string[];
}

export const newCount = (): Count => ({ b: 0, s: 0, seq: '' });

/** 공 하나를 카운트에 넣는다. 타석이 끝나면 끝(삼진·볼넷·사구·맞힘), 아니면 null */
export function applyPitch(cnt: Count, code: PitchCode): End | null {
  cnt.seq += code;
  switch (code) {
    case 'B':
    case 'I':
      if (++cnt.b === 4) return End.W;
      return null;
    case 'C':
    case 'S':
    case 'T':
      if (++cnt.s === 3) return End.K;
      return null;
    case 'F':
      if (cnt.s < 2) cnt.s++;
      return null;
    case 'X':
      return End.X;
    default:
      return End.H;
  }
}

/** 타석 하나를 지시 없이 공 단위로 끝까지 (검증·시험용): 끝과 공 수, 공 기호 */
export function playOut(ch: SolvedChain, rng: Rng, called?: Float64Array): { end: End; pitches: number; seq: string } {
  const cnt = newCount();
  for (;;) {
    const end = applyPitch(cnt, drawPitch(ch, cnt.b, cnt.s, rng, called));
    if (end !== null) return { end, pitches: cnt.seq.length, seq: cnt.seq };
    if (cnt.seq.length > 60) return { end: End.X, pitches: cnt.seq.length, seq: cnt.seq }; // 안전장치 (파울이 끝없이 이어지는 일은 없다)
  }
}

/** 공 기호 → 화면 낱말 */
export const PITCH_TEXT: Record<PitchCode, string> = {
  B: '볼', C: '루킹 스트라이크', S: '헛스윙', T: '스트라이크', F: '파울', X: '타격', H: '몸에 맞는 공', I: '고의4구 볼',
};
