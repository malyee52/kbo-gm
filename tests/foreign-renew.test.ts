// 외국인 재계약 판단과 시장 후보 분포 (2026-11-04 사용자 결정): 재계약은 절대 기준이 아니라 시장에서 새로 데려올 후보와 견준다
// (offseason.ts foreignKeepBar), 일반 외국인 후보는 실제 KBO 신규 외국인 첫해 능력에 가깝게 (scoutfx.ts FX_RUNS_LIFT·FX_MARKET_RUNS).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng } from '../src/engine';
import { currentRuns } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { FOREIGN_KEEP_FORM, foreignFormParts, foreignJudgeRuns, foreignKeepBar, foreignKeepShift, FOREIGN_KEEP_PIT_SHIFT, leagueView } from '../src/league/offseason';
import { foreignSalary } from '../src/league/salary';
import { FX_MARKET_RUNS, FX_RUNS_LIFT, fxMarketRuns, fxSpec } from '../src/league/scoutfx';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
let league: LeagueState;
beforeAll(() => {
  store = loadDataStore();
  league = createLeague(store, 2026, 'foreign-renew', { ...DEFAULT_PARAMS, pilotSeasons: 1 }).league;
}, 120_000);

describe('시장 후보 분포', () => {
  it('일반 후보(오프시즌)는 FX_RUNS_LIFT만큼 올라 평균이 예전(약 31런)보다 높고, 아시아쿼터는 그대로', () => {
    const rng = new Rng('fx-spec-mean');
    const avg = (region: 'na' | 'latam' | 'japan' | 'pacific', asia: boolean, season = false) => {
      let s = 0;
      for (let i = 0; i < 4000; i++) s += fxSpec(rng, region, asia, season).runs;
      return s / 4000;
    };
    // 북미: 30 + LIFT + 고른 -10~16 (평균 +3)
    expect(avg('na', false)).toBeCloseTo(33 + FX_RUNS_LIFT, 0);
    // 시즌 중 후보는 한 단계(4런) 아래
    expect(avg('na', false) - avg('na', false, true)).toBeCloseTo(4, 0);
    // 아시아쿼터: 4 + 고른 -4~12 (평균 8, 올림 없음)
    expect(avg('japan', true)).toBeCloseTo(8, 0);
    expect(fxMarketRuns(true, false)).toBe(FX_MARKET_RUNS.pit);
    expect(fxMarketRuns(false, false)).toBe(FX_MARKET_RUNS.bat);
    expect(fxMarketRuns(true, true)).toBe(FX_MARKET_RUNS.asia);
  });
});

describe('재계약 문턱 (foreignKeepBar)', () => {
  it('문턱 = 시장 기대 능력 + 몸값 차이 ÷ 런당 금액 − 덤: 요구액이 클수록 높다', () => {
    const view = leagueView(league, store, DEFAULT_PARAMS);
    const regular = league.players.filter((p) => p.team >= 0 && p.foreign && !p.asia);
    expect(regular.length).toBeGreaterThan(20);
    const rows = regular.map((p) => ({ p, runs: currentRuns(view.sim.get(p.id)!, view.ctx), bar: foreignKeepBar(league, view, p) }));
    for (const r of rows) {
      const ref = fxMarketRuns(r.p.isPitcher, false);
      // 몸값 차이 몫은 재계약 연봉식(25만 + 2만/런)과 신규 연봉식(15만 + 1.8만/런, 100만 상한)의 차이라 몇 런 안쪽
      expect(r.bar, r.p.name).toBeGreaterThan(ref - 15);
      expect(r.bar, r.p.name).toBeLessThan(ref + 25);
    }
    // 같은 쓰임 안에서 문턱 차이 = 재계약 요구액 차이 ÷ 런당 6만 달러 (요구액이 큰 선수가 문턱도 높다)
    const pit = rows.filter((r) => r.p.isPitcher).sort((a, b) => a.bar - b.bar);
    expect(pit[0].bar).toBeLessThan(pit.at(-1)!.bar);
    const gap = pit.at(-1)!.bar - pit[0].bar;
    expect(gap).toBeLessThan((foreignSalary(90, false, false) - foreignSalary(0, false, false)) / 60_000 + 1e-9);
    // 아시아쿼터 문턱은 아시아쿼터 시장 기대(약 6런) 근처
    for (const p of league.players.filter((x) => x.team >= 0 && x.foreign && x.asia)) {
      const bar = foreignKeepBar(league, view, p);
      expect(bar, p.name).toBeGreaterThan(FX_MARKET_RUNS.asia - 10);
      expect(bar, p.name).toBeLessThan(FX_MARKET_RUNS.asia + 15);
    }
  });
});

describe('재계약 판단값 (foreignJudgeRuns): 진짜 능력에 지난 시즌 성적의 어긋남을 섞는다', () => {
  it('그 해 기록이 없으면 진짜 능력 그대로, 있으면 성적 쪽으로 일부만 움직인다', () => {
    const view = leagueView(league, store, DEFAULT_PARAMS);
    const fs = league.players.filter((p) => p.team >= 0 && p.foreign && !p.asia);
    for (const p of fs) {
      // 기록이 없는 해
      expect(foreignJudgeRuns(league, store, view, p, 2099)).toBeCloseTo(currentRuns(view.sim.get(p.id)!, view.ctx), 9);
    }
    // 시작 판의 이력에는 실제 기록이 없다: 가짜 시즌 줄(600타석 · 165이닝 선발)로 잘한 해와 못한 해를 만든다
    const bat = fs.find((p) => !p.isPitcher)!;
    const pit = fs.find((p) => p.isPitcher)!;
    const batLine = (h: number, hr: number) => [140, 600, 530, 80, h, 30, 2, hr, 80, 60, 10, 110, 5, 2];
    const pitLine = (r: number) => [28, 28, 12, 8, 0, 495, 690, 150, 15, 45, 6, 150, r, r - 5, 0, 15, 0];
    let moved = 0;
    for (const [p, good, bad] of [[bat, batLine(190, 35), batLine(120, 8)], [pit, pitLine(55), pitLine(110)]] as const) {
      const judge = (line: number[]) => {
        const q = { ...p, history: [...p.history, { year: 2026, team: league.teams[p.team].name, ...(p.isPitcher ? { pit: line } : { bat: line }) }] };
        const { truth, runs, share } = foreignFormParts(league, store, view, q, 2026);
        expect(share).toBeCloseTo(1, 6);
        const gap = runs - share * truth;
        // 영점 차이 몫(출전 몫만큼)을 뺀 움직임
        const d = foreignJudgeRuns(league, store, view, q, 2026) - truth - foreignKeepShift(p) * share;
        expect(d).toBeCloseTo(FOREIGN_KEEP_FORM * gap, 9);
        // 같은 쪽으로, 어긋남보다 작게 (섞는 몫 0~1)
        expect(Math.abs(d), p.name).toBeLessThanOrEqual(Math.abs(gap) + 1e-9);
        if (Math.abs(gap) > 1) { expect(Math.sign(d), p.name).toBe(Math.sign(gap)); moved++; }
        return d + truth + foreignKeepShift(p) * share;
      };
      expect(judge(good as number[]), p.name).toBeGreaterThan(judge(bad as number[]));
    }
    expect(moved).toBeGreaterThan(1);
    // 일반 외국인 투수만 영점을 더 얹는다 (2026-11-10 사용자 결정, 아시아쿼터·타자는 그대로)
    expect(foreignKeepShift(pit) - foreignKeepShift(bat)).toBe(FOREIGN_KEEP_PIT_SHIFT);
    expect(foreignKeepShift({ ...pit, asia: true })).toBe(foreignKeepShift(bat));
  });
});
