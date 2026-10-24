// 타구각 갈래 (능력치 v2 16-2, docs/능력치v2_기획안.md 10.2·11.3·9.1·9.3): 맞힌 공(인플레이 + 홈런)의 각도 구간과 구간별 결과.
// 구간: 땅볼(10° 아래) · 라인드라이브(10~25°) · 홈런 각(25~35°) · 높은 뜬공(35~50°) · 내야 뜬공(50° 위).
// 각도 분포는 땅볼 덩어리 + 공중 덩어리 두 정규분포 섞기 (결정 14). 덩어리 몫·공중 덩어리 가운데·퍼짐을 그 해 유형 비율에 맞춰 풀고,
// 구간별 결과표는 엔진 6단계의 결과별 유형 표(params.ball.type·airOut, 그 해 땅볼 몫)를 베이즈로 뒤집어 만든다.
// 그래서 모든 손잡이가 0이면 맞힌 공당 결과와 유형 비율이 지금 표와 같다 (영점).
// 선수 손잡이는 구간별 결과 로짓(아웃 대비)에 더한다: 정타(컨택 대 타구 억제), 거리(파워 대 장타 억제: 홈런 각의 홈런, 장타 몫),
// 주력(땅볼 단타 = 내야안타), 나머지 몫(2루타·3루타 중 컨택·파워로 못 맞춘 몫, 화면에 없음). 각도 성향 θ(타자 + 투수, 뜬공 쪽 +)는
// 땅볼 덩어리 몫을, 컨택은 두 덩어리의 퍼짐을 움직인다. 난수를 쓰지 않는다.

import type { Rates } from '../data/types';
import type { AngleParams, EngineParams } from './params';
import type { BatSkill, PitSkill } from './types';

/** 타구각 구간 */
export enum Band { GB, LD, HA, HF, PU }
/** 구간 → 타구 유형 (battedball.ts Ball: 땅볼 0, 라인드라이브 1, 뜬공 2, 내야 뜬공 3) */
export const BAND_TYPE = [0, 1, 2, 2, 3] as const;
/** 결과 칸 순서: 아웃, 단타, 2루타, 3루타, 홈런 */
export const O_OUT = 0, O_S1 = 1, O_D2 = 2, O_T3 = 3, O_HR = 4;
const NB = 5;
const NO = 5;

/** 각도 분포: 땅볼 덩어리 몫 w, 땅볼 덩어리 N(gm, gs), 공중 덩어리 N(am, as) (도) */
export interface AngleMix {
  w: number;
  gm: number;
  gs: number;
  am: number;
  as: number;
}

/** 여오차 함수 (Numerical Recipes erfcc, 상대 오차 1.2e-7 안). 모든 구간 확률이 같은 함수를 써서 영점은 정확하다 */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807
    + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const phi = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

/** 구간 확률 [땅볼, 라인, 홈런 각, 높은 뜬공, 내야 뜬공]. θ: 각도 성향 (뜬공 쪽 +, 땅볼 덩어리 몫 = σ(logit w − θ)), k: 두 덩어리 퍼짐 배율 */
export function bandProbs(mix: AngleMix, cuts: readonly number[], theta = 0, k = 1): number[] {
  const w = theta === 0 ? mix.w : 1 / (1 + ((1 - mix.w) / mix.w) * Math.exp(theta));
  const out = new Array<number>(NB);
  let g0 = 0;
  let a0 = 0;
  for (let i = 0; i < 4; i++) {
    const g = phi((cuts[i] - mix.gm) / (mix.gs * k));
    const a = phi((cuts[i] - mix.am) / (mix.as * k));
    out[i] = w * (g - g0) + (1 - w) * (a - a0);
    g0 = g;
    a0 = a;
  }
  out[4] = w * (1 - g0) + (1 - w) * (1 - a0);
  return out;
}

/** 아웃 타구의 유형 분포: 라인드라이브 airOut.ld, 나머지를 땅볼 groundBallShare : 뜬공(내야 뜬공 airOut.pu 포함)으로 */
export function outTypes(p: EngineParams): number[] {
  const { ld, pu } = p.ball.airOut;
  const g = p.groundBallShare * (1 - ld);
  const air = (1 - p.groundBallShare) * (1 - ld);
  return [g, ld, air * (1 - pu), air * pu];
}

/** 결과(아웃·단타·2루타·3루타)별 유형 표 [땅볼, 라인, 뜬공, 내야 뜬공] (엔진 6단계, 합이 1이 아닐 수 있다) */
export function resultTypes(o: number, p: EngineParams): readonly number[] {
  const t = p.ball.type;
  return o === O_OUT ? outTypes(p) : o === O_S1 ? t.S1 : o === O_D2 ? t.D2 : t.T3;
}

/** 그 해 리그의 각도 분포와 구간별 결과표 */
export interface LeagueBall {
  mix: AngleMix;
  cuts: readonly number[];
  /** 맞힌 공당 결과 [아웃, 단타, 2루타, 3루타, 홈런] */
  p: number[];
  /** 구간 확률 */
  pz: number[];
  /** 구간별 결과 로짓 (아웃 대비, 아웃 칸 0, 없는 결과 −∞) [구간][결과] */
  base: number[][];
}

const solve3 = (a: number[][], b: number[]): number[] => solveLinear(a, b);

/** 가우스 소거 (작은 정방 행렬) */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || m[c][c] === 0) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r, i) => (r[i] === 0 ? 0 : r[n] / r[i]));
}

/**
 * 유형 비율 t [땅볼, 라인, 뜬공(홈런 포함), 내야 뜬공]에 맞는 각도 분포: 땅볼 덩어리(가운데·퍼짐 고정)는 두고 땅볼 덩어리 몫·공중 덩어리 가운데·퍼짐을
 * 뉴턴법으로 푼다 (땅볼·라인·내야 뜬공 세 구간이 맞으면 뜬공은 저절로 맞는다). 시작점은 params.ball.angle (2025년 맞춤값, 임시값)
 */
export function fitMix(t: readonly number[], ap: AngleParams): AngleMix {
  const at = (u: number[]): AngleMix => ({ w: 1 / (1 + Math.exp(-u[0])), gm: ap.ground[0], gs: ap.ground[1], am: u[1], as: Math.exp(u[2]) });
  const f = (u: number[]) => {
    const pz = bandProbs(at(u), ap.cuts);
    return [pz[Band.GB] - t[0], pz[Band.LD] - t[1], pz[Band.PU] - t[3]];
  };
  let u = [Math.log(ap.groundShare / (1 - ap.groundShare)), ap.air[0], Math.log(ap.air[1])];
  for (let it = 0; it < 60; it++) {
    const r = f(u);
    if (Math.max(...r.map(Math.abs)) < 1e-14) break;
    const h = 1e-7;
    const J = [0, 1, 2].map(() => [0, 0, 0]);
    for (let j = 0; j < 3; j++) {
      const v = [...u];
      v[j] += h;
      const rj = f(v);
      for (let i = 0; i < 3; i++) J[i][j] = (rj[i] - r[i]) / h;
    }
    const d = solve3(J, r.map((x) => -x));
    const big = Math.max(...d.map(Math.abs));
    const s = big > 1 ? 1 / big : 1;
    u = u.map((x, i) => x + s * d[i]);
  }
  return at(u);
}

/** 맞힌 공당 결과 [아웃, 단타, 2루타, 3루타, 홈런]: 타석 확률에서 삼진·볼넷·사구를 뺀 몫으로 나눈다 */
export function perContact(r: Pick<Rates, 'so' | 'bb' | 'hbp' | 'hr' | 's1' | 'd2' | 't3'>): number[] {
  const x = 1 - r.so - r.bb - r.hbp;
  const q = [0, r.s1 / x, r.d2 / x, r.t3 / x, r.hr / x];
  q[0] = 1 - q[1] - q[2] - q[3] - q[4];
  return q;
}

const LEAGUE = new WeakMap<Rates, { p: EngineParams; odds: number; lb: LeagueBall }[]>();

/** 그 해 리그의 각도 분포와 구간별 결과표 (gbOdds: 그 해 땅볼 승산 배율, LeagueEnv.gbOdds). 같은 리그 비율·조정값·배율이면 담아 둔 값 */
export function leagueBall(league: Rates, p: EngineParams, gbOdds = 1): LeagueBall {
  let list = LEAGUE.get(league);
  const hit = list?.find((c) => c.p === p && c.odds === gbOdds);
  if (hit) return hit.lb;
  const ap = p.ball.angle;
  const pr = perContact(league);
  // 결과별 유형 (땅볼 가중치 × 그 해 배율, 합 1)
  const tw = [O_OUT, O_S1, O_D2, O_T3].map((o) => {
    const w = [...resultTypes(o, p)];
    w[0] *= gbOdds;
    const s = w.reduce((a, x) => a + x, 0);
    return w.map((x) => x / s);
  });
  const t = [0, 0, pr[O_HR], 0];
  for (let o = 0; o < 4; o++) for (let y = 0; y < 4; y++) t[y] += pr[o] * tw[o][y];
  const mix = fitMix(t, ap);
  const pzMix = bandProbs(mix, ap.cuts);
  // 뜬공(홈런 뺌)을 홈런 각 : 높은 뜬공으로 나눈다. 홈런은 모두 홈런 각
  const fb = t[2] - pr[O_HR];
  const a = fb > 0 ? Math.min(1, Math.max(0, (pzMix[Band.HA] - pr[O_HR]) / fb)) : 0;
  const J = Array.from({ length: NB }, () => new Array<number>(NO).fill(0));
  for (let o = 0; o < 4; o++) {
    J[Band.GB][o] = pr[o] * tw[o][0];
    J[Band.LD][o] = pr[o] * tw[o][1];
    J[Band.HA][o] = pr[o] * tw[o][2] * a;
    J[Band.HF][o] = pr[o] * tw[o][2] * (1 - a);
    J[Band.PU][o] = pr[o] * tw[o][3];
  }
  J[Band.HA][O_HR] = pr[O_HR];
  const pz = J.map((r) => r.reduce((s, x) => s + x, 0));
  const base = J.map((r) => r.map((x, o) => (o === O_OUT ? 0 : x > 0 ? Math.log(x / r[O_OUT]) : -Infinity)));
  const lb: LeagueBall = { mix, cuts: ap.cuts, p: pr, pz, base };
  if (!list) LEAGUE.set(league, (list = []));
  list.push({ p, odds: gbOdds, lb });
  return lb;
}

/** 한쪽(타자 또는 투수)의 구간별 결과 로짓 더하기 [구간][결과] (아웃 칸 0). 투수는 "허용" 쪽 부호 (+면 더 맞는다) */
export type BallShift = number[][];

/** 매치업의 구간 확률과 구간별 결과 확률, 맞힌 공당 결과 */
export interface BallMix {
  pz: number[];
  /** [구간][결과] 확률 */
  pi: number[][];
  /** 맞힌 공당 결과 [아웃, 단타, 2루타, 3루타, 홈런] */
  q: number[];
  /** 당겨치기 성향 (로짓, 0 = 리그, BatSkill.pull) */
  pull?: number;
}

/** 구간 확률 pz에서 양쪽 손잡이와 보정(mod[결과], 모든 구간에 같게)을 더한 결과 확률 */
export function mixWith(lb: LeagueBall, pz: number[], a: BallShift | null, b: BallShift | null, mod: readonly number[] | null): BallMix {
  const pi: number[][] = [];
  const q = [0, 0, 0, 0, 0];
  for (let z = 0; z < NB; z++) {
    const row = [1, 0, 0, 0, 0];
    let sum = 1;
    for (let o = 1; o < NO; o++) {
      const L = lb.base[z][o];
      if (L === -Infinity) continue;
      const e = Math.exp(L + (a ? a[z][o] : 0) + (b ? b[z][o] : 0) + (mod ? mod[o] : 0));
      row[o] = e;
      sum += e;
    }
    for (let o = 0; o < NO; o++) {
      row[o] /= sum;
      q[o] += pz[z] * row[o];
    }
    pi.push(row);
  }
  return { pz, pi, q };
}

/** 매치업 (θ = 타자 + 투수 각도 성향, k = 타자 퍼짐 배율) */
export function ballMix(lb: LeagueBall, theta: number, k: number, a: BallShift | null, b: BallShift | null, mod: readonly number[] | null): BallMix {
  return mixWith(lb, theta === 0 && k === 1 ? lb.pz : bandProbs(lb.mix, lb.cuts, theta, k), a, b, mod);
}

/**
 * 한쪽 손잡이 [정타, 거리, 2루타 나머지, 3루타 나머지]로 구간별 로짓 더하기를 만든다.
 * 정타: 단타·2루타·3루타 (gbContact가 false면 땅볼 구간 제외 — 투수의 타구 억제는 라인·뜬공 안타만, 9.1·10.2). 거리: 홈런 각의 홈런,
 * 땅볼 밖 2루타·3루타에 xbh배. 주력: 땅볼 단타에 spd (내야안타, 결정 15)
 */
export function buildShift(x: readonly number[], gbContact: boolean, spd: number, xbh: number): BallShift {
  const [c, w, d2, t3] = x;
  const s: BallShift = [];
  for (let z = 0; z < NB; z++) {
    const gb = z === Band.GB;
    const cz = gb && !gbContact ? 0 : c;
    const xb = gb ? 0 : xbh * w;
    s.push([0, cz + (gb ? spd : 0), cz + xb + d2, cz + xb + t3, w]);
  }
  return s;
}

/** 한쪽 손잡이를 풀어 낸 값 */
export interface BallSide {
  shift: BallShift;
  /** 각도 성향 (뜬공 쪽 +) */
  theta: number;
  /** 퍼짐 배율 (타자만, 투수는 1) */
  k: number;
  /** [정타, 거리, 2루타 나머지, 3루타 나머지] (로짓) */
  x: number[];
}

/** 리그 평균 상대(손잡이 0, 보정 없음)로 맞힌 공당 단타·2루타·3루타·홈런이 target이 되는 손잡이 (뉴턴법, 4×4) */
export function solveSide(lb: LeagueBall, pz: number[], target: readonly number[], build: (x: readonly number[]) => BallShift, start: readonly number[] = [0, 0, 0, 0]): number[] {
  const F = (x: readonly number[]) => {
    const q = mixWith(lb, pz, build(x), null, null).q;
    return [q[O_S1] - target[O_S1], q[O_HR] - target[O_HR], q[O_D2] - target[O_D2], q[O_T3] - target[O_T3]];
  };
  let x = [...start];
  for (let it = 0; it < 80; it++) {
    const r = F(x);
    if (Math.max(...r.map(Math.abs)) < 1e-14) break;
    const h = 1e-7;
    const J = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    for (let j = 0; j < 4; j++) {
      const v = [...x];
      v[j] += h;
      const rj = F(v);
      for (let i = 0; i < 4; i++) J[i][j] = (rj[i] - r[i]) / h;
    }
    const d = solveLinear(J, r.map((v) => -v));
    const big = Math.max(...d.map(Math.abs));
    const s = big > 2 ? 2 / big : 1;
    x = x.map((v, i) => v + s * d[i]);
  }
  return x;
}

export const clampRate = (x: number) => (x < 0.0005 ? 0.0005 : x > 0.6 ? 0.6 : x);

/** 타석 확률 → 맞힌 공당 결과. 일곱 사건 합이 0.93을 넘으면 줄여 쓰는 pa.ts paRates와 같은 산술 */
export function perContactScaled(r: Pick<Rates, 'so' | 'bb' | 'hbp' | 'hr' | 's1' | 'd2' | 't3'>): number[] {
  const sum = r.so + r.bb + r.hbp + r.hr + r.s1 + r.d2 + r.t3;
  const scale = sum > 0.93 ? 0.93 / sum : 1;
  const inPlay = (1 - scale * (r.so + r.bb + r.hbp)) / scale;
  const q = [0, r.s1 / inPlay, r.d2 / inPlay, r.t3 / inPlay, r.hr / inPlay];
  q[0] = 1 - q[1] - q[2] - q[3] - q[4];
  return q;
}

/** 타자가 리그 평균 투수를 상대할 때 지금 결과 비율(BatSkill)의 맞힌 공당 결과 (16-1까지의 paRates와 같은 값) */
export function batTarget(bs: BatSkill, lg: Rates): number[] {
  const f = (k: 'so' | 'bb' | 'hbp' | 'hr' | 's1' | 'd2' | 't3') => clampRate(bs[k] * lg[k]);
  return perContactScaled({ so: f('so'), bb: f('bb'), hbp: f('hbp'), hr: f('hr'), s1: f('s1'), d2: f('d2'), t3: f('t3') });
}

/** 투수가 리그 평균 타자를 상대할 때 지금 결과 비율(PitSkill)의 맞힌 공당 결과 */
export function pitTarget(ps: PitSkill, lg: Rates): number[] {
  return perContactScaled({
    so: clampRate(ps.so * lg.so), bb: clampRate(ps.bb * lg.bb), hbp: clampRate(ps.hbp * lg.hbp), hr: clampRate(ps.hr * lg.hr),
    s1: clampRate(ps.hit * lg.s1), d2: clampRate(ps.hit * lg.d2), t3: clampRate(ps.hit * lg.t3),
  });
}

/** 각도 성향: 땅볼 승산 배율 gb(BatSkill.gb·PitSkill.gb)의 로그를 뒤집은 값 (뜬공 쪽 +) */
export const thetaOf = (gb: number | undefined) => (gb && gb !== 1 ? -Math.log(gb) : 0);

/** 타자 퍼짐 배율: 컨택(정타 로짓 ÷ contactSd = z)이 높을수록 좁고, 각도 성향이 뚜렷할수록 좁다 (10.2, 임시값) */
export function spreadOf(contact: number, theta: number, ap: AngleParams): number {
  const k = Math.min(ap.spreadMax, Math.max(ap.spreadMin, 1 - (ap.contactSpread * contact) / ap.contactSd));
  return k * (1 - ap.tendencyTighten * Math.min(1, Math.abs(theta) / ap.tendencyFull));
}

/**
 * 타자 손잡이: 리그 평균 투수 상대로 맞힌 공당 결과가 지금 결과 비율과 같게 푼다. 퍼짐은 컨택에 달려 있어,
 * 퍼짐 1로 한 번 풀고 그 정타로 퍼짐을 정한 뒤 다시 푼다 (난수 없음)
 */
export function batBallSide(bs: BatSkill, lg: Rates, lb: LeagueBall, p: EngineParams): BallSide {
  const ap = p.ball.angle;
  const theta = thetaOf(bs.gb);
  const target = batTarget(bs, lg);
  const build = (x: readonly number[]) => buildShift(x, true, ap.speedGb * (bs.speed - 0.5) * 2, ap.powerXbh);
  const x1 = solveSide(lb, theta === 0 ? lb.pz : bandProbs(lb.mix, lb.cuts, theta, 1), target, build);
  const k = spreadOf(x1[0], theta, ap);
  const x = k === 1 ? x1 : solveSide(lb, bandProbs(lb.mix, lb.cuts, theta, k), target, build, x1);
  return { shift: build(x), theta, k, x };
}

/** 투수 손잡이: 리그 평균 타자 상대로 맞힌 공당 결과가 지금 결과 비율과 같게 푼다 (타구 억제 = −정타, 장타 억제 = −거리) */
export function pitBallSide(ps: PitSkill, lg: Rates, lb: LeagueBall, p: EngineParams): BallSide {
  const ap = p.ball.angle;
  const theta = thetaOf(ps.gb);
  const build = (x: readonly number[]) => buildShift(x, false, 0, ap.powerXbh);
  const x = solveSide(lb, theta === 0 ? lb.pz : bandProbs(lb.mix, lb.cuts, theta, 1), pitTarget(ps, lg), build);
  return { shift: build(x), theta, k: 1, x };
}

/** 손잡이 0인 쪽 */
export const ZERO_SIDE: BallSide = { shift: buildShift([0, 0, 0, 0], true, 0, 0), theta: 0, k: 1, x: [0, 0, 0, 0] };
