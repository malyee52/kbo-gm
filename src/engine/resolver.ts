// 타석을 끝내는 해결기. 경기 상태·규칙(주루·타구·교체·기록)은 공통이고, "타석 결과 함수가 낸 확률로 타석을 어떻게 끝내는가"만 해결기마다 다르다
// (docs/경기엔진2_기획안.md 3.2). B는 타석 한 번에 결과를 뽑고, A(나중 단계)는 공 하나씩 진행한다.

import { End, expectedPitches, samplePitches, solveKnobs, solvedChain, type ChainShape, type PitchObserver, type SolvedChain } from './chain';
import { Ev, type PaRates } from './pa';
import type { Rng } from './rng';

/** 타석 하나의 끝: 결과와 그 타석에 던진 공 수 (투구 수를 모르는 해결기는 0) */
export interface PaOutcome {
  ev: Ev;
  pitches: number;
}

export interface PaResolver {
  readonly name: string;
  resolve(rates: PaRates, rng: Rng): PaOutcome;
  /** 해결기를 거치지 않는 번트 타석의 공 수. 없으면 0 (투구 수를 세지 않는 해결기) */
  inPlayPitches?(rng: Rng): number;
  /** 삼진·볼넷·사구 확률이 K·W·H이고 길이 손잡이가 len인 타석의 기대 투구 수 (난수 없음). 없으면 params.pitchesPerPaDefault */
  pitchesPerPa?(K: number, W: number, H: number, len?: number): number;
  /** 리그 평균 상대로 K·W·H인 선수의 기대 투구 수가 target이 되는 길이 손잡이 (난수 없음, D단계 선수별 P/PA). 없으면 1 */
  lengthFor?(K: number, W: number, H: number, target: number): number;
  /** 확률표의 삼진·볼넷·사구를 끝 확률로 하는 사슬 (A 해결기가 공 하나씩 돌린다, 칸 함수 사슬이 없을 때). 없으면 A를 못 쓴다 */
  chainFor?(r: PaRates): SolvedChain;
}

/** 확률표에서 결과 하나를 뽑는다 (난수 한 번). 예전 엔진의 타석 뽑기와 같은 순서·같은 산술 */
export function drawEvent(r: PaRates, rng: Rng): Ev {
  let u = rng.next() / r.scale;
  if ((u -= r.so) < 0) return Ev.SO;
  if ((u -= r.bb) < 0) return Ev.BB;
  if ((u -= r.hbp) < 0) return Ev.HBP;
  if ((u -= r.hr) < 0) return Ev.HR;
  if ((u -= r.s1) < 0) return Ev.S1;
  if ((u -= r.d2) < 0) return Ev.D2;
  if ((u -= r.t3) < 0) return Ev.T3;
  return Ev.OUT;
}

/** 인플레이로 끝난 타석의 결과 (홈런·단타·2루타·3루타·아웃 몫으로, 히트앤드런 첫 공 인플레이, 엔진 2 8단계) */
export function drawInPlay(r: PaRates, rng: Rng): Ev {
  let u = rng.next() * (1 / r.scale - r.so - r.bb - r.hbp);
  if ((u -= r.hr) < 0) return Ev.HR;
  if ((u -= r.s1) < 0) return Ev.S1;
  if ((u -= r.d2) < 0) return Ev.D2;
  if ((u -= r.t3) < 0) return Ev.T3;
  return Ev.OUT;
}

/** B0: 엔진 1의 타석 뽑기 그대로. 투구 수는 세지 않는다 (시험용: 투구 수가 늘지 않아 투수가 지치지 않는다) */
export const B0: PaResolver = {
  name: 'B0',
  resolve: (r, rng) => ({ ev: drawEvent(r, rng), pitches: 0 }),
};

/** 사슬 해결기를 만들 때 고르는 것 */
export interface ChainResolverOptions {
  /** 지나간 칸과 공 결과를 받는다 (검증 도구용, 결과는 바뀌지 않는다) */
  observe?: PitchObserver;
}

/** 같은 목표를 다시 풀지 않게 담아 두는 사슬 수 (넘으면 비운다. 답은 목표만으로 정해져서 비워도 결과가 같다) */
const CHAIN_CACHE = 50000;

/**
 * B1: 볼카운트 사슬을 계산으로 접은 타석 해결기 (docs/경기엔진2_기획안.md 3.6.1).
 * 결과는 B0와 같은 확률표에서 뽑고(난수 한 번), 손잡이를 풀어 끝 확률이 그 확률표의 삼진·볼넷·사구와 같은 사슬에서
 * "그 결과로 끝나는 공 경로"를 뽑아 투구 수를 낸다 (칸마다 난수 한 번). 그래서 (결과, 투구 수)의 결합 분포가 사슬과 같다
 */
export function chainResolver(shape: ChainShape, opts: ChainResolverOptions = {}): PaResolver & { chainFor(r: PaRates): SolvedChain; inPlayPitches(rng: Rng): number; pitchesPerPa(K: number, W: number, H: number, len?: number): number; lengthFor(K: number, W: number, H: number, target: number): number } {
  const cache = new Map<string, SolvedChain>();
  const league = solvedChain(shape, [1, 1, 1]);
  const solved = (K: number, W: number, H: number, len = 1): SolvedChain => {
    const key = `${K},${W},${H},${len}`;
    let ch = cache.get(key);
    if (!ch) {
      if (cache.size >= CHAIN_CACHE) cache.clear();
      ch = solvedChain(shape, solveKnobs(shape, K, W, H, len), len);
      cache.set(key, ch);
    }
    return ch;
  };
  const chainFor = (r: PaRates): SolvedChain => solved(r.so * r.scale, r.bb * r.scale, r.hbp * r.scale, r.len ?? 1);
  const ppa = new Map<string, number>();
  const pitchesPerPa = (K: number, W: number, H: number, len = 1): number => {
    const key = `${K},${W},${H},${len}`;
    let v = ppa.get(key);
    if (v === undefined) {
      v = expectedPitches(solved(K, W, H, len));
      ppa.set(key, v);
    }
    return v;
  };
  const lens = new Map<string, number>();
  // 로그 공간 이분법 (손잡이 e^-2.5 ~ e^2.5, 40번). 기대 투구 수는 파울 배율에 대해 늘 는다
  const lengthFor = (K: number, W: number, H: number, target: number): number => {
    const key = `${K},${W},${H},${target}`;
    let v = lens.get(key);
    if (v === undefined) {
      let lo = -2.5;
      let hi = 2.5;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (expectedPitches(solvedChain(shape, solveKnobs(shape, K, W, H, Math.exp(mid), 1e-10), Math.exp(mid))) < target) lo = mid;
        else hi = mid;
      }
      v = Math.exp((lo + hi) / 2);
      if (lens.size >= CHAIN_CACHE) lens.clear();
      lens.set(key, v);
    }
    return v;
  };
  const END_OF: Record<Ev, End> = { [Ev.SO]: End.K, [Ev.BB]: End.W, [Ev.HBP]: End.H, [Ev.HR]: End.X, [Ev.S1]: End.X, [Ev.D2]: End.X, [Ev.T3]: End.X, [Ev.OUT]: End.X };
  return {
    name: 'B1',
    chainFor,
    pitchesPerPa,
    lengthFor,
    resolve(r, rng) {
      const ev = drawEvent(r, rng);
      return { ev, pitches: samplePitches(r.chain ?? chainFor(r), END_OF[ev], rng, opts.observe) };
    },
    // 번트 타석(희생번트·번트 실패)의 공 수: 리그 모양 사슬에서 맞힘으로 끝나는 경로 (임시값, 번트 타석 투구 수 자료 없음)
    inPlayPitches: (rng) => samplePitches(league, End.X, rng, opts.observe),
  };
}
