// 타구 모형 1 (엔진 2 5단계): 방향 비율, 담당 수비수, 수비 크기, 외야 수비가 내야 땅볼 안타에 영향 없음
import { describe, expect, it } from 'vitest';
import type { Rates } from '../src/data/types';
import { DEFAULT_PARAMS, Rng } from '../src/engine';
import { Ball, BALL_SLOTS, battedBall, fielderShares, type BallSlot } from '../src/engine/battedball';
import { Ev, type PaRates } from '../src/engine/pa';

const LG: Rates = { so: 0.2, bb: 0.09, hbp: 0.012, hr: 0.025, s1: 0.155, d2: 0.045, t3: 0.004 };
const RATES: PaRates = { ...LG, scale: 1 };
const P = DEFAULT_PARAMS;

/** 타석 결과 함수가 낸 인플레이 결과 (S1·D2·T3·OUT)를 리그 비율대로 뽑는다 */
function inPlayEv(rng: Rng): Ev {
  const hits = LG.s1 + LG.d2 + LG.t3;
  const out = 1 - (LG.so + LG.bb + LG.hbp + LG.hr + hits);
  let u = rng.next() * (hits + out);
  if ((u -= LG.s1) < 0) return Ev.S1;
  if ((u -= LG.d2) < 0) return Ev.D2;
  if ((u -= LG.t3) < 0) return Ev.T3;
  return Ev.OUT;
}

/** n개 타구를 같은 시드로 뽑는다 (수비 런만 바꿔 비교) */
function balls(n: number, def: Partial<Record<BallSlot, number>>, pullLeft = true, seed = 'bb') {
  const evRng = new Rng(`${seed}/ev`);
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => {
    const ev = inPlayEv(evRng);
    return { from: ev, ...battedBall(ev, RATES, LG, pullLeft, (s) => def[s] ?? 0, P, rng) };
  });
}
const isHit = (ev: Ev) => ev === Ev.S1 || ev === Ev.D2 || ev === Ev.T3;
const allDef = (r: number) => Object.fromEntries(BALL_SLOTS.filter((s) => s !== 'P').map((s) => [s, r])) as Partial<Record<BallSlot, number>>;

describe('타구 모형 1', () => {
  const N = 200_000;

  it('인플레이 방향 당겨:가운데:밀어가 49:20:31 (±2%p, 임시값 출처 미확인)', () => {
    const bs = balls(N, {});
    const dir = [0, 0, 0];
    for (const b of bs) dir[b.dir]++;
    const share = dir.map((x) => x / N);
    [0.49, 0.2, 0.31].forEach((t, i) => expect(Math.abs(share[i] - t)).toBeLessThan(0.02));
  });

  it('평균 수비(모두 0)면 결과를 바꾸지 않는다', () => {
    for (const b of balls(50_000, {})) {
      expect(b.ev).toBe(b.from);
      expect(b.converted).toBe(false);
    }
  });

  it('외야 수비는 내야 땅볼 안타에 영향이 없다', () => {
    const base = balls(N, {});
    for (const r of [30, -30]) {
      const of = balls(N, { LF: r, CF: r, RF: r });
      let ground = 0;
      for (let i = 0; i < N; i++) {
        if (base[i].type !== Ball.GB) continue;
        ground++;
        expect(of[i].ev).toBe(base[i].ev);
        expect(of[i].slot).toBe(base[i].slot);
      }
      expect(ground).toBeGreaterThan(N * 0.3);
    }
  });

  it('땅볼은 내야수(투수 포함)가, 외야 구역 타구는 외야수가 맡는다. 당겨친 우타 땅볼은 3루·유격수 쪽', () => {
    const outfield = new Set(['LF', 'CF', 'RF']);
    for (const b of balls(50_000, {})) {
      if (b.type === Ball.GB) {
        expect(outfield.has(b.slot)).toBe(false);
        if (b.dir === 0) expect(['3B', 'SS']).toContain(b.slot);
      }
      if (b.zone >= 6) expect(outfield.has(b.slot)).toBe(true);
    }
    // 좌타는 거울: 당겨친 땅볼이 1·2루 쪽
    for (const b of balls(20_000, {}, false)) if (b.type === Ball.GB && b.dir === 0) expect(['1B', '2B']).toContain(b.slot);
  });

  it('수비 크기: 8명이 모두 +5런이면 인플레이 안타가 8 × 5 × defenseHitPerRun만큼 줄고, −5런이면 그만큼 는다 (예전 팀 수비 합과 같은 크기)', () => {
    const base = balls(N, {}).filter((b) => isHit(b.ev)).length;
    const expected = 8 * 5 * P.defenseHitPerRun;
    const good = balls(N, allDef(5)).filter((b) => isHit(b.ev)).length;
    const bad = balls(N, allDef(-5)).filter((b) => isHit(b.ev)).length;
    expect(Math.abs((base - good) / base - expected)).toBeLessThan(0.006);
    expect(Math.abs((bad - base) / base - expected)).toBeLessThan(0.006);
  });

  it('좋은 유격수는 유격수에게 간 타구에서만 안타를 줄인다', () => {
    const base = balls(N, {});
    const ss = balls(N, { SS: 10 });
    let fewer = 0;
    for (let i = 0; i < N; i++) {
      if (base[i].slot !== 'SS') expect(ss[i].ev).toBe(base[i].ev);
      else if (isHit(base[i].ev) && !isHit(ss[i].ev)) fewer++;
    }
    expect(fewer).toBeGreaterThan(0);
  });

  it('자리별 몫은 합이 1이고 같은 입력이면 같다', () => {
    const s = fielderShares(LG, P);
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, x) => a + x, 0);
    expect(sum(s.hit)).toBeCloseTo(1, 9);
    expect(sum(s.out)).toBeCloseTo(1, 9);
    expect(fielderShares(LG, P)).toEqual(s);
  });
});
