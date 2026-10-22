// 타구 모형 1 (엔진 2 5단계, docs/경기엔진2_기획안.md 3.3 5번·6장 5단계): 인플레이 타구(홈런 제외)의 유형·방향·구역·담당 수비수.
// 공통 규칙 계층이라 해결기(B0·B1)와 관계없이 같은 코드를 쓴다.
//
// 순서: 타석 결과 함수가 낸 결과(단타·2루타·3루타·아웃)를 먼저 받고, 그 결과에 맞는 타구 유형·방향을 뽑아 구역과 담당 수비수를 정한다.
// 그다음 담당 수비수의 수비 런으로 안타 ↔ 아웃을 바꾼다 (수비 0이면 바꾸지 않아 결과가 타석 결과 함수 그대로).
// 크기는 예전 팀 수비 합(T5)과 같게 맞춘다: 수비수 한 명의 +1런이 팀 인플레이 안타의 defenseHitPerRun만큼을 아웃으로 바꾼다
// (그 수비수에게 가는 안타 몫으로 나눠 확률을 정한다). 그래서 외야수의 수비는 내야 땅볼에 영향이 없다.
// 땅볼 성향(엔진 2 6단계): 그 해 리그 값 × 타자 × 투수의 땅볼 승산 배율(gb)을 타구 유형 표의 땅볼 가중치에 곱한다. 당겨치기 성향은 아직 리그 평균.

import type { Rates } from '../data/types';
import { Ev, type PaRates } from './pa';
import type { BallParams, EngineParams } from './params';
import type { Rng } from './rng';

/** 타구 유형: 땅볼, 라인드라이브, 뜬공, 내야 뜬공 */
export enum Ball { GB, LD, FB, PU }

/** 타구를 맡는 자리 (투수 포함) */
export const BALL_SLOTS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
export type BallSlot = (typeof BALL_SLOTS)[number];

/** 구역 깊이: 내야 땅볼길, 내야 공중(내야 뜬공·내야수 머리 위 라이너), 외야 */
export const DEPTHS = ['ground', 'air', 'outfield'] as const;

export interface BattedBall {
  /** 수비를 거친 뒤의 결과 (S1·D2·T3·OUT) */
  ev: Ev;
  type: Ball;
  /** 치는 손 기준 방향: 0 당겨, 1 가운데, 2 밀어 */
  dir: number;
  /** 구역 = 깊이 × 3 + 구장 쪽 (0 좌익선 쪽, 1 가운데, 2 우익선 쪽). 9개 */
  zone: number;
  slot: BallSlot;
  /** 수비 때문에 안타 ↔ 아웃이 바뀌었나 */
  converted: boolean;
}

/** 인플레이 타구 집계 (검증 도구용): 유형·방향·자리별 수, 수비로 바뀐 수 */
export interface BallTally {
  type: number[];
  /** 수비를 거친 뒤 아웃이 된 타구의 유형 (실책 출루 포함) */
  outType: number[];
  dir: number[];
  slot: Partial<Record<BallSlot, number>>;
  toOut: number;
  toHit: number;
}
export const emptyBallTally = (): BallTally => ({ type: [0, 0, 0, 0], outType: [0, 0, 0, 0], dir: [0, 0, 0], slot: {}, toOut: 0, toHit: 0 });

const HIT_EVS = [Ev.S1, Ev.D2, Ev.T3] as const;
const HIT_KEY = { [Ev.S1]: 'S1', [Ev.D2]: 'D2', [Ev.T3]: 'T3' } as const;

/** 아웃 타구의 유형 분포: 라인드라이브 airOut.ld, 나머지를 땅볼 groundBallShare : 뜬공(내야 뜬공 airOut.pu 포함)으로 */
function outTypes(p: EngineParams): number[] {
  const { ld, pu } = p.ball.airOut;
  const g = p.groundBallShare * (1 - ld);
  const air = (1 - p.groundBallShare) * (1 - ld);
  return [g, ld, air * (1 - pu), air * pu];
}

const typesOf = (ev: Ev, p: EngineParams): readonly number[] => (ev === Ev.OUT ? outTypes(p) : p.ball.type[HIT_KEY[ev as Ev.S1 | Ev.D2 | Ev.T3]]);

/** 유형 → 깊이 분포 [내야 땅볼, 내야 공중, 외야] */
function depthsOf(t: Ball, b: BallParams): [number, number, number] {
  if (t === Ball.GB) return [1, 0, 0];
  if (t === Ball.PU) return [0, 1, 0];
  const air = t === Ball.LD ? b.infieldAir.LD : b.infieldAir.FB;
  return [0, air, 1 - air];
}

/** 가중치 표에서 하나 고르기 (난수 u 하나) */
function pick<T>(items: readonly T[], w: readonly number[], u: number): T {
  let sum = 0;
  for (const x of w) sum += x;
  let v = u * sum;
  for (let i = 0; i < items.length; i++) {
    v -= w[i];
    if (v < 0) return items[i];
  }
  return items[items.length - 1];
}

interface Shares {
  /** 자리별 리그 안타 몫·아웃 몫 (합 1) */
  hit: Record<BallSlot, number>;
  out: Record<BallSlot, number>;
  /** 자리별 그 자리로 간 안타의 종류 비율 [단타, 2루타, 3루타] */
  mix: Record<BallSlot, [number, number, number]>;
}

const zero = () => Object.fromEntries(BALL_SLOTS.map((s) => [s, 0])) as Record<BallSlot, number>;

/**
 * 리그 비율에서 자리별 안타·아웃 몫. 구장 쪽은 좌타·우타 반반으로 본 근사 (임시값): 좌·우 = (당겨 + 밀어) ÷ 2
 */
export function fielderShares(league: Rates, p: EngineParams): Shares {
  const b = p.ball;
  const side = [(b.dir[0] + b.dir[2]) / 2, b.dir[1], (b.dir[0] + b.dir[2]) / 2];
  const sideSum = side[0] + side[1] + side[2];
  const spread = (types: readonly number[], weight: number, into: Record<BallSlot, number>) => {
    const tSum = types.reduce((a, x) => a + x, 0);
    types.forEach((tw, t) => {
      const dep = depthsOf(t as Ball, b);
      for (let d = 0; d < 3; d++) {
        if (!dep[d]) continue;
        for (let s = 0; s < 3; s++) {
          const z = b.zones[DEPTHS[d]][s];
          const zSum = Object.values(z).reduce((a, x) => a + (x ?? 0), 0);
          for (const [slot, w] of Object.entries(z)) into[slot as BallSlot] += weight * (tw / tSum) * dep[d] * (side[s] / sideSum) * ((w ?? 0) / zSum);
        }
      }
    });
  };
  const hits = league.s1 + league.d2 + league.t3;
  const hit = zero();
  const byKind = HIT_EVS.map((ev) => {
    const one = zero();
    spread(typesOf(ev, p), (ev === Ev.S1 ? league.s1 : ev === Ev.D2 ? league.d2 : league.t3) / hits, one);
    for (const s of BALL_SLOTS) hit[s] += one[s];
    return one;
  });
  const out = zero();
  spread(outTypes(p), 1, out);
  const mix = Object.fromEntries(BALL_SLOTS.map((s) => [s, byKind.map((k) => (hit[s] > 0 ? k[s] / hit[s] : 0)) as [number, number, number]])) as Shares['mix'];
  return { hit, out, mix };
}

const SHARES = new WeakMap<Rates, { p: EngineParams; s: Shares }>();
function sharesFor(league: Rates, p: EngineParams): Shares {
  const c = SHARES.get(league);
  if (c && c.p === p) return c.s;
  const s = fielderShares(league, p);
  SHARES.set(league, { p, s });
  return s;
}

const ERR = new WeakMap<Rates, { p: EngineParams; e: Record<BallSlot, number> }>();
/**
 * 아웃이 될 타구 하나가 그 자리에서 실책이 될 확률 배율 (아웃 타구 평균 1, 엔진 2 7단계): 실책 몫(params.error.share) ÷ 그 자리 아웃 타구 몫.
 * 그래서 리그 실책 출루 수는 자리 표와 관계없이 env.roe × norm 안팎이고, 실책은 타구를 맡은 수비수에게 간다
 */
export function errorPerBall(league: Rates, p: EngineParams): Record<BallSlot, number> {
  const c = ERR.get(league);
  if (c && c.p === p) return c.e;
  const out = sharesFor(league, p).out;
  const sh = p.error.share;
  const sum = BALL_SLOTS.reduce((a, s) => a + (sh[s] ?? 0), 0);
  const e = Object.fromEntries(BALL_SLOTS.map((s) => [s, out[s] > 0 ? (sh[s] ?? 0) / sum / out[s] : 0])) as Record<BallSlot, number>;
  ERR.set(league, { p, e });
  return e;
}

/**
 * 인플레이 타구 하나 (ev는 S1·D2·T3·OUT). 난수: 유형·방향·(깊이)·자리·수비 판정을 차례로 하나씩. 수비 판정 난수는 수비 런과 관계없이 늘 쓴다
 * (수비 능력을 바꿔도 다른 타구의 난수가 밀리지 않는다).
 * pullLeft: 당겨친 타구가 좌익선 쪽으로 가나 (우타, 또는 좌투를 상대한 양타). defAt: 그 자리 수비수의 수비 런 (투수는 0).
 * gb: 땅볼 승산 배율 (그 해 × 타자 × 투수, 1이면 리그 기본 표 그대로)
 */
export function battedBall(ev: Ev, rates: PaRates | null, league: Rates, pullLeft: boolean, defAt: (slot: BallSlot) => number, p: EngineParams, rng: Rng, gb = 1): BattedBall {
  const b = p.ball;
  const tw = typesOf(ev, p);
  const type = pick([Ball.GB, Ball.LD, Ball.FB, Ball.PU], gb === 1 ? tw : [tw[0] * gb, tw[1], tw[2], tw[3]], rng.next());
  const dir = pick([0, 1, 2], b.dir, rng.next());
  const side = pullLeft ? dir : 2 - dir;
  const dep = depthsOf(type, b);
  const depth = dep[0] === 1 ? 0 : dep[1] === 1 ? 1 : rng.next() < dep[1] ? 1 : 2;
  const z = b.zones[DEPTHS[depth]][side];
  const slots = Object.keys(z) as BallSlot[];
  const slot = pick(slots, slots.map((s) => z[s] ?? 0), rng.next());
  const u = rng.next();
  const r = slot === 'P' ? 0 : defAt(slot);
  const sh = sharesFor(league, p);
  let out = ev;
  if (ev !== Ev.OUT && r > 0 && sh.hit[slot] > 0) {
    // 좋은 수비: 이 자리로 간 안타의 일부가 아웃
    if (u < Math.min(0.5, (r * p.defenseHitPerRun) / sh.hit[slot])) out = Ev.OUT;
  } else if (ev === Ev.OUT && r < 0 && sh.out[slot] > 0 && sh.hit[slot] > 0) {
    // 나쁜 수비: 같은 수의 안타가 늘도록 아웃을 안타로 (이 타석의 인플레이 안타 몫 h로 안타 ÷ 아웃 비를 맞춘다)
    const R = rates ?? { ...league, scale: 1 };
    const hits = (R.s1 + R.d2 + R.t3) * R.scale;
    const outs = Math.max(1e-6, 1 - (R.so + R.bb + R.hbp + R.hr + R.s1 + R.d2 + R.t3) * R.scale);
    const q = Math.min(0.5, ((hits / outs) * -r * p.defenseHitPerRun) / sh.out[slot]);
    // 바뀐 안타의 종류는 그 자리로 가는 안타의 종류 비율 (같은 난수를 다시 늘려 쓴다)
    if (u < q) out = pick(HIT_EVS, sh.mix[slot], u / q);
  }
  return { ev: out, type, dir, zone: depth * 3 + side, slot, converted: out !== ev };
}
