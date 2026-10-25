// 볼카운트 사슬 능력 (능력치 v2 16-1, docs/능력치v2_기획안.md 1.8·1.9·6장 16-1 기준)
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, worldForYear } from '../src/engine';
import { batBallOf, pitBallOf, plateContext } from '../src/engine/pa';
import { ballMix, batTarget, pitTarget } from '../src/engine/angle';
import { cellProbs, End, endFrom, solveKnobs } from '../src/engine/chain';
import { chainShapeFor } from '../src/engine/params';
import {
  addBat, leaguePlateFor, measuredBatPlate, measuredPitPlate, plateCells, plateChain, plateGrade, plateSteps, plateValue, solveBat, solvedBatPlate,
  solvedPitPlate, solvePit, ZERO_BAT, ZERO_PIT, type BatPlate, type PitPlate,
} from '../src/engine/plate';

const store = loadDataStore();
const pp = DEFAULT_PARAMS.plate;
const lpFor = (year: number) => leaguePlateFor(chainShapeFor(DEFAULT_PARAMS, year), store.season(year)!.league.rates, pp);

describe('칸 함수 영점', () => {
  it.each(store.meta.years)('%i년: 모든 능력이 0이면 칸 확률이 그 해 리그 사슬 칸과 같다 (1e-9)', (year) => {
    const lg = store.season(year)!.league.rates;
    const shape = chainShapeFor(DEFAULT_PARAMS, year);
    const target = cellProbs(shape, solveKnobs(shape, lg.so, lg.bb, lg.hbp));
    const got = plateCells(lpFor(year), ZERO_BAT, ZERO_PIT);
    for (let i = 0; i < 60; i++) expect(Math.abs(got[i] - target[i])).toBeLessThan(1e-9);
    // 리그 평균 매치업의 끝 확률 = 그 해 리그 삼진·볼넷·사구
    const e = endFrom(got);
    expect(e[End.K]).toBeCloseTo(lg.so, 9);
    expect(e[End.W]).toBeCloseTo(lg.bb, 9);
    expect(e[End.H]).toBeCloseTo(lg.hbp, 9);
  });

  it('칸마다 다섯 결과의 합은 1이고, 능력이 한쪽으로 움직이면 결과도 그쪽으로 움직인다', () => {
    const lp = lpFor(2025);
    const base = endFrom(plateCells(lp, ZERO_BAT, ZERO_PIT));
    const cells = plateCells(lp, { agg: 0.3, eye: -0.4, con: 0.5, two: 0.2, tough: 0.1 }, { ctl: -0.2, stuff: 0.4, eff: 0.1 });
    for (let c = 0; c < 12; c++) expect(cells.slice(c * 5, c * 5 + 5).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const end = (b: BatPlate, p: PitPlate) => endFrom(plateCells(lp, b, p));
    expect(end({ ...ZERO_BAT, con: 0.5 }, ZERO_PIT)[End.K]).toBeLessThan(base[End.K]);
    expect(end(ZERO_BAT, { ...ZERO_PIT, stuff: 0.5 })[End.K]).toBeGreaterThan(base[End.K]);
    expect(end({ ...ZERO_BAT, eye: 0.5 }, ZERO_PIT)[End.W]).toBeGreaterThan(base[End.W]);
    expect(end(ZERO_BAT, { ...ZERO_PIT, ctl: 0.5 })[End.W]).toBeLessThan(base[End.W]);
    expect(end({ ...ZERO_BAT, two: 0.5 }, ZERO_PIT)[End.K]).toBeLessThan(base[End.K]);
  });
});

describe('공 단위로 걸어도 같다 (A 엔진이 쓸 칸 함수)', () => {
  it('단계별 확률로 공마다 존·스윙·맞힘·파울을 뽑은 10만 타석의 끝 빈도가 접은 끝 확률과 표본 오차 안', () => {
    const lp = lpFor(2025);
    const b: BatPlate = { agg: 0.25, eye: -0.3, con: -0.4, two: 0.15, tough: 0.2 };
    const p: PitPlate = { ctl: -0.25, stuff: 0.3, eff: -0.1 };
    const e = endFrom(plateCells(lp, b, p));
    const rng = new Rng('plate-walk');
    const n = 100000;
    const cnt = [0, 0, 0, 0];
    let pitches = 0;
    for (let i = 0; i < n; i++) {
      let bl = 0;
      let st = 0;
      for (;;) {
        pitches++;
        const s = plateSteps(lp, bl * 3 + st, b, p);
        if (rng.next() < s.hbp) { cnt[End.H]++; break; }
        const inZone = rng.next() < s.zone;
        const swing = rng.next() < (inZone ? s.swingIn : s.swingOut);
        let strike: boolean;
        if (!swing) strike = rng.next() < (inZone ? s.calledIn : s.calledOut);
        else if (rng.next() >= (inZone ? s.contactIn : s.contactOut)) strike = true;
        else if (rng.next() < (inZone ? s.foulIn : s.foulOut)) { if (st < 2) st++; continue; }
        else { cnt[End.X]++; break; }
        if (strike) { if (st === 2) { cnt[End.K]++; break; } st++; }
        else { if (bl === 3) { cnt[End.W]++; break; } bl++; }
      }
    }
    for (const k of [End.K, End.W, End.H, End.X]) {
      const se = Math.sqrt(e[k] * (1 - e[k]) / n);
      expect(Math.abs(cnt[k] / n - e[k])).toBeLessThan(4 * se);
    }
    expect(pitches / n).toBeGreaterThan(3);
  });
});

describe('결과 기록으로 푸는 길과 실측', () => {
  it('푼 능력은 목표 삼진·볼넷(·투구 수)을 사슬에서 그대로 낸다', () => {
    const lp = lpFor(2019);
    const b = solveBat(lp, 0.25, 0.06, lp.ppa * 1.04, 0.2);
    const ch = plateChain(lp, b, ZERO_PIT);
    expect(ch.e[End.K]).toBeCloseTo(0.25, 9);
    expect(ch.e[End.W]).toBeCloseTo(0.06, 9);
    const p = solvePit(lp, 0.12, 0.13, undefined);
    const cp = plateChain(lp, ZERO_BAT, p);
    expect(cp.e[End.K]).toBeCloseTo(0.12, 9);
    expect(cp.e[End.W]).toBeCloseTo(0.13, 9);
    // 같은 목표면 늘 같은 답
    expect(solveBat(lp, 0.25, 0.06, lp.ppa * 1.04, 0.2)).toEqual(b);
  });

  it('2026 시작 월드: 실측이 있는 선수의 시즌 사슬 능력 = 실측(짐작 쪽 당김 포함) 그대로, 없는 선수 = 푼 값', () => {
    const world = worldForYear(store, 2026);
    // 시즌이 만드는 것과 같은 함수 (Season 생성자 → plateContext)
    const ctx = plateContext(world.players, world.league, DEFAULT_PARAMS, 2026);
    const lg = world.league;
    const lp = lpFor(2026);
    // 시작 연도 신인·새 외국인(debutEstimate)은 능력과 같이 그 해 기록에서 ("그 해 성적 미반영"의 예외)
    const rowsOf = (debut: boolean | undefined, rows: Record<string, number[]> | undefined) => (debut
      ? (rows?.[2026] ? [{ w: DEFAULT_PARAMS.debutSeasonWeight, c: rows[2026] }] : [])
      : [2025, 2024, 2023].flatMap((y, i) => (rows?.[y] ? [{ w: DEFAULT_PARAMS.seasonWeights[i], c: rows[y] }] : [])));
    let measuredBat = 0;
    let measuredPit = 0;
    for (const p of world.players) {
      if (p.bat) {
        const solved = solvedBatPlate(p.bat, lg, lp, pp);
        const rows = store.plate!.bat[p.id];
        const want = p.bat.plateRes ? measuredBatPlate(rowsOf(p.debutEstimate, rows), solved, pp) : solved;
        if (p.bat.plateRes) measuredBat++;
        for (const k of ['agg', 'eye', 'con', 'two', 'tough'] as const) expect(Math.abs(ctx.bat[p.idx][k] - want[k])).toBeLessThan(1e-9);
      }
      if (p.pit) {
        const solved = solvedPitPlate(p.pit, lg, lp);
        const rows = store.plate!.pit[p.id];
        const want = p.pit.plateRes ? measuredPitPlate(rowsOf(p.debutEstimate, rows), solved, pp) : solved;
        if (p.pit.plateRes) measuredPit++;
        for (const k of ['ctl', 'stuff', 'eff'] as const) expect(Math.abs(ctx.pit[p.idx][k] - want[k])).toBeLessThan(1e-9);
      }
    }
    expect(measuredBat).toBeGreaterThan(200);
    expect(measuredPit).toBeGreaterThan(200);
    // 실측 몫은 결과 비율이 바뀌어도 그대로 따라간다 (성장 길): 몫 + 새로 푼 값
    const one = world.players.find((p) => p.bat?.plateRes)!;
    const grown = { ...one.bat!, so: one.bat!.so * 0.8 };
    const moved = addBat(solvedBatPlate(grown, lg, lp, pp), one.bat!.plateRes);
    expect(moved.con).toBeGreaterThan(ctx.bat[one.idx].con);
  });
});

describe('사슬 실측 몫은 삼진·볼넷만 바꾼다 (2026-10-25 홈런 원인 점검)', () => {
  it('2026 시작 월드: 실측이 있는 선수도 리그 평균 상대 타석당 단타·2루타·3루타·홈런이 실측 몫 없을 때와 같다 (1e-9)', () => {
    const world = worldForYear(store, 2026);
    const ctx = plateContext(world.players, world.league, DEFAULT_PARAMS, 2026);
    const lg = world.league;
    const lp = lpFor(2026);
    let bat = 0;
    let pit = 0;
    let moved = 0;
    for (const p of world.players) {
      if (p.bat?.plateRes) {
        const side = batBallOf(ctx, p);
        const q = ballMix(ctx.ball!.lb, side.theta, side.k, side.shift, null, null).q;
        const x = plateChain(lp, ctx.bat[p.idx], ZERO_PIT).e[3];
        const x0 = plateChain(lp, solvedBatPlate(p.bat, lg, lp, pp), ZERO_PIT).e[3];
        const want = batTarget(p.bat, lg);
        for (let o = 1; o < 5; o++) expect(Math.abs(x * q[o] - x0 * want[o]), `${p.name} ${o}`).toBeLessThan(1e-9);
        if (Math.abs(x / x0 - 1) > 0.03) moved++;
        bat++;
      }
      if (p.pit?.plateRes) {
        const side = pitBallOf(ctx, p);
        const q = ballMix(ctx.ball!.lb, side.theta, 1, null, side.shift, null).q;
        const x = plateChain(lp, ZERO_BAT, ctx.pit[p.idx]).e[3];
        const x0 = plateChain(lp, ZERO_BAT, solvedPitPlate(p.pit, lg, lp)).e[3];
        const want = pitTarget(p.pit, lg);
        for (let o = 1; o < 5; o++) expect(Math.abs(x * q[o] - x0 * want[o]), `${p.name} ${o}`).toBeLessThan(1e-9);
        pit++;
      }
    }
    expect(bat).toBeGreaterThan(200);
    expect(pit).toBeGreaterThan(200);
    // 실측 몫이 맞힌 공 수를 3% 넘게 바꾸는 선수가 있어야 이 시험이 뜻이 있다 (김도영 약 +8%)
    expect(moved).toBeGreaterThan(10);
  });
});

describe('등급 눈금', () => {
  it('등급 ↔ 내부 값은 서로 거꾸로이고, 중앙 = 50, 곡선은 60 위·40 아래에서만 휜다', () => {
    for (const g of Object.values(pp.grades)) {
      expect(plateGrade(g, g.mid)).toBeCloseTo(50, 12);
      for (const x of [15, 30, 45, 55, 70, 85, 100]) expect(plateGrade(g, plateValue(g, x))).toBeCloseTo(x, 9);
      expect(plateValue(g, 60) - g.mid).toBeCloseTo(g.half, 12);
      expect(plateValue(g, 40) - g.mid).toBeCloseTo(-g.half, 12);
    }
    const c = pp.grades.con;
    // 볼록: 80의 효과는 직선(중앙 + 3 × 중간폭)보다 크다
    expect(plateValue(c, 80) - c.mid).toBeGreaterThan(3 * c.half);
    expect(pp.grades.agg.a).toBe(0);
  });
});
