// A 해결기 (투구 단위, docs/경기엔진2_기획안.md 3.4·3.6.1, 엔진 2 17단계): B와 같은 볼카운트 사슬을 공 하나씩 그대로 돌린다.
// 한 공 = 칸의 [볼, 스트라이크, 파울, 맞힘, 사구] 확률에서 난수 한 번. 스트라이크는 칸 함수(plate.ts)의 루킹·헛스윙 몫으로 나눠 보여 주지만
// 다섯 결과의 확률은 사슬 그대로라, 한 매치업 안에서 (끝 결과, 투구 수)의 분포가 B(사슬을 계산으로 접은 것)와 식으로 같다.
// 맞힘 뒤 결과(홈런·안타·아웃)는 B와 같은 확률표의 조건부 몫(resolver.ts drawInPlay)이다.
// 구종·코스는 칸만 열어 둔다 (3.4.1): 공 모양의 type·zone은 비우고, 투수 능력의 arsenal이 있으면 칸마다 구종 비율로 섞는다.

import { End, endFrom, type SolvedChain } from './chain';
import { plateCells, plateSteps, type BatPlate, type LeaguePlate, type PitPlate, type PlateShift } from './plate';
import type { Rng } from './rng';

/**
 * 공 하나의 결과 기호: B 볼, C 루킹 스트라이크, S 헛스윙(번트 헛스윙 포함), T 스트라이크(루킹·헛스윙을 가를 수 없는 사슬), F 파울,
 * X 맞힘(인플레이), H 사구, I 고의4구 공 (수동 고의4구, 사슬 밖)
 */
export type PitchCode = 'B' | 'C' | 'S' | 'T' | 'F' | 'X' | 'H' | 'I';

/** 공 하나 (기획안 3.4.1). 구종·코스는 1단계에서 비운다 */
export interface Pitch {
  /** 던지기 전 카운트 [볼, 스트라이크] */
  count: [number, number];
  /** 구종 (비움 = "평균 구종" 하나, 20단계) */
  type?: string;
  /** 코스 (비움, 20단계) */
  zone?: number;
  result: PitchCode;
  /** 이 투수의 경기 투구 수 (던진 뒤) */
  pitches: number;
}

/**
 * 투수 구종 하나 (자리만, 20-1단계에서 채운다): 비율과 구종별 사슬 능력 차(로짓, 투수 능력에 더한다).
 * hr·gb(장타 억제·땅볼 성향 배율)는 타구 갈래에 넣을 자리로, 아직 쓰지 않는다.
 * 넣을 때는 구종을 섞은 평균이 그 투수의 지금 능력과 같아지게 정한다 (기획안 3.4.1)
 */
export interface ArsenalPitch {
  type: string;
  share: number;
  ctl?: number;
  stuff?: number;
  eff?: number;
  hr?: number;
  gb?: number;
}

const cellOf = (b: number, s: number) => b * 3 + s;

/** 구종 하나의 투수 사슬 능력 (투수 능력 + 구종 차) */
function withPitch(p: PitPlate, a: ArsenalPitch): PitPlate {
  return { ctl: p.ctl + (a.ctl ?? 0), stuff: p.stuff + (a.stuff ?? 0), eff: p.eff + (a.eff ?? 0) };
}

/**
 * 칸 함수 사슬 (구종 비율로 섞은 칸). 구종이 없으면 plate.ts plateChain과 같은 계산 그대로 (기획안 3.4.1: 구종 칸이 비었을 때 사슬이 3단계 사슬과 같음).
 * 섞은 칸도 칸마다 확률표 하나라 B는 같은 사슬을 접는다
 */
export function arsenalChain(lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift, arsenal?: readonly ArsenalPitch[]): SolvedChain {
  const pr = mixedCells(lp, b, p, sh, arsenal);
  return { knobs: [1, 1, 1], p: pr, e: endFrom(pr) };
}

function mixedCells(lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift, arsenal?: readonly ArsenalPitch[]): Float64Array {
  const list = arsenal?.filter((a) => a.share > 0) ?? [];
  if (!list.length) return plateCells(lp, b, p, sh);
  const total = list.reduce((s, a) => s + a.share, 0);
  const out = new Float64Array(60);
  for (const a of list) {
    const c = plateCells(lp, b, withPitch(p, a), sh);
    const w = a.share / total;
    for (let i = 0; i < 60; i++) out[i] += w * c[i];
  }
  return out;
}

/**
 * 칸마다 스트라이크 가운데 루킹 몫 (화면용: 루킹 ↔ 헛스윙만 가른다, 다섯 결과의 확률은 그대로).
 * 칸 함수의 단계 확률(plate.ts plateSteps)로: 루킹 = 존 안 안 휘두름 × 존 안 판정 + 존 밖 안 휘두름 × 존 밖 판정, 헛스윙 = 휘둘러 못 맞힘
 */
export function calledShare(lp: LeaguePlate, b: BatPlate, p: PitPlate, sh: PlateShift, arsenal?: readonly ArsenalPitch[]): Float64Array {
  const list = arsenal?.filter((a) => a.share > 0) ?? [];
  const types = list.length ? list : [{ type: '', share: 1 }];
  const total = types.reduce((s, a) => s + a.share, 0);
  const out = new Float64Array(12);
  for (let c = 0; c < 12; c++) {
    let called = 0;
    let swung = 0;
    for (const a of types) {
      const w = a.share / total;
      const t = plateSteps(lp, c, b, withPitch(p, a), sh);
      called += w * ((t.zone * (1 - t.swingIn)) * t.calledIn + ((1 - t.zone) * (1 - t.swingOut)) * t.calledOut);
      swung += w * (t.zone * t.swingIn * (1 - t.contactIn) + (1 - t.zone) * t.swingOut * (1 - t.contactOut));
    }
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
