// AI 감독 2 (엔진 2 10단계): 감독 성향 '투수 밀어붙이기'·'불펜 연투 허용', 고의4구(자동·공 4개), 전진 수비, 좌우 원포인트, 블론 기록 회
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyPenTally, Season, worldForYear, type EngineParams, type PenTally } from '../src/engine';
import { AUTO_IBB_YEAR } from '../src/engine/eras';
import { BULLPEN_AVAILABLE_BELOW, BULLPEN_RECOVERY_PER_DAY } from '../src/engine/params';
import { BLOWN_FROM_INNING } from '../src/engine/state';
import { availableBelow } from '../src/engine/team';
import { infoOf, NEUTRAL_TACTICS, TACTIC_SHARE, tacticsOf, VIRTUAL_RANGE, virtualTactic } from '../src/league/managers';

const store = loadDataStore();
const w2025 = worldForYear(store, 2025);
const w2012 = worldForYear(store, 2012);

function play(world: typeof w2025, params: EngineParams, seed: string, days = 30, tactics?: (t: number) => Season['teamSeasons'][number]['tactics']) {
  const pen = emptyPenTally();
  const s = Season.start(world, params, seed, { pen });
  if (tactics) s.teamSeasons.forEach((ts, t) => { ts.tactics = tactics(t); });
  for (let d = 0; d < days; d++) s.simulateDay();
  return { s, pen };
}

describe('감독 성향 (엔진 2 10단계)', () => {
  it('모두 보통(1)으로 두면 성향이 없는 시즌과 결과가 같다', () => {
    const a = play(w2025, DEFAULT_PARAMS, 'mgr2-neutral', 15);
    const b = play(w2025, DEFAULT_PARAMS, 'mgr2-neutral', 15, () => ({ ...NEUTRAL_TACTICS }));
    expect(b.s.totals).toEqual(a.s.totals);
    expect(b.s.pit).toEqual(a.s.pit);
  });

  it('불펜 연투 허용 1은 기준 그대로, 클수록 전날 더 많이 던진 투수도 나온다', () => {
    expect(availableBelow(1)).toBe(BULLPEN_AVAILABLE_BELOW);
    expect(availableBelow(1.2) + BULLPEN_RECOVERY_PER_DAY).toBeCloseTo((BULLPEN_AVAILABLE_BELOW + BULLPEN_RECOVERY_PER_DAY) * 1.2);
    expect(availableBelow(0.8)).toBeLessThan(BULLPEN_AVAILABLE_BELOW);
  });

  it('실존 감독: 투구 단위 자료가 있는 해는 그 해 팀 값, 없으면 시즌 평균 (기록 사실만)', () => {
    const info = infoOf(store, '김태형')!;
    expect(info.byYear?.['2024']).toBeTruthy();
    const y = tacticsOf(info, '김태형', 2024);
    expect(y.hook).toBeCloseTo(info.byYear!['2024'].push, 3);
    expect(y.pen).toBeCloseTo(info.byYear!['2024'].pen, 3);
    expect(tacticsOf(info, '김태형').hook).toBeCloseTo(info.push!, 3);
    // 자료 없는 옛 감독은 구원 등판 배율로 정한 예전 hook, 연투는 보통
    const old = Object.entries(store.managers!.people).find(([, i]) => i.push === undefined && !i.byYear)!;
    expect(tacticsOf(old[1], old[0]).pen).toBe(1);
  });

  it('가상 감독: 이름으로 정한 값 (같은 이름은 늘 같다)', () => {
    for (const name of ['가상감독가', '가상감독나']) {
      for (const k of ['hook', 'pen', 'cond', 'ibb'] as const) {
        const v = virtualTactic(name, k);
        expect(v).toBeGreaterThanOrEqual(VIRTUAL_RANGE[k][0]);
        expect(v).toBeLessThanOrEqual(VIRTUAL_RANGE[k][1]);
        expect(tacticsOf(undefined, name)[k]).toBe(v);
      }
    }
  });
});

/** 고의4구가 잦은 조정값 (검사용) */
const IBB_HEAVY: EngineParams = { ...DEFAULT_PARAMS, mgr: { ...DEFAULT_PARAMS.mgr, ibb: { ...DEFAULT_PARAMS.mgr.ibb, rate: 1, gap: 0, early: 1, minInning: 1, wildShare: 5 } } };

describe('고의4구 (엔진 2 10단계)', () => {
  it(`${AUTO_IBB_YEAR}년부터는 공 없이, 그 전은 공 4개를 실제로 던진다`, () => {
    const auto = play(w2025, IBB_HEAVY, 'ibb-auto', 10).pen;
    expect(auto.ibb).toBeGreaterThan(0);
    expect(auto.ibbManual).toBe(0);
    const manual = play(w2012, IBB_HEAVY, 'ibb-manual', 10).pen;
    expect(manual.ibbManual).toBe(manual.ibb);
    // 끝까지 던진 수동 고의4구는 공이 정확히 4개 (폭투 끝내기로 끊긴 것만 빠진다)
    expect(manual.ibbPitches).toBe(4 * (manual.ibbManual - manual.ibbCut));
  });

  it('수동 고의4구 공마다 폭투·포일: 공 하나 확률 = 보통 공 하나 × wildShare (A·B가 같은 rules.ts ibbWildPitchChance를 쓴다)', () => {
    const t: PenTally = play(w2012, IBB_HEAVY, 'ibb-wp', 60).pen;
    const pitches = t.ibbPitches + t.ibbCut * 2; // 끊긴 것은 평균 2구 안팎
    const p = t.ibbWp / pitches;
    // 2012 리그 폭투 확률(타석당) ÷ 3.9구 × 5 ≈ 공당 2~5% (포수·투수 제구로 흔들린다)
    const base = (w2012.env.wildPitch / DEFAULT_PARAMS.pitchesPerPaDefault) * 5;
    expect(t.ibbManual).toBeGreaterThan(300);
    expect(p).toBeGreaterThan(base * 0.5);
    expect(p).toBeLessThan(base * 2);
    // wildShare 0이면 수동 고의4구 사이 폭투가 없다
    const none = play(w2012, { ...IBB_HEAVY, mgr: { ...IBB_HEAVY.mgr, ibb: { ...IBB_HEAVY.mgr.ibb, wildShare: 0 } } }, 'ibb-wp', 20).pen;
    expect(none.ibbWp).toBe(0);
  });

  it('같은 시드는 같은 고의4구·전진 수비·원포인트', () => {
    expect(play(w2025, DEFAULT_PARAMS, 'mgr2-same', 10).pen).toEqual(play(w2025, DEFAULT_PARAMS, 'mgr2-same', 10).pen);
  });
  it('감독 성향 고의4구 빈도 (엔진 2 13단계): 0이면 고의4구가 없고, 클수록 잦다. 실존 감독은 그 해 구단 값', () => {
    const t = (ibb: number) => () => ({ ...NEUTRAL_TACTICS, ibb });
    expect(play(w2025, IBB_HEAVY, 'ibb-tend', 8, t(0)).pen.ibb).toBe(0);
    const lo = play(w2025, DEFAULT_PARAMS, 'ibb-tend', 20, t(0.5)).pen.ibb;
    const hi = play(w2025, DEFAULT_PARAMS, 'ibb-tend', 20, t(2)).pen.ibb;
    expect(hi).toBeGreaterThan(lo * 2);
    const info = infoOf(store, '이강철')!;
    expect(tacticsOf(info, '이강철', 2025).ibb).toBeCloseTo(info.byYear!['2025'].ibb!, 3);
    expect(tacticsOf(info, '이강철').ibb).toBeCloseTo(info.ibb!, 3);
    // 2023~2025 구단 값을 합친 기준이라 리그 고의4구가 적었던 2024는 평균이 1보다 작다
    const mean = (y: string) => {
      const vs = Object.values(store.managers!.people).map((i) => i.byYear?.[y]?.ibb).filter((v): v is number => v !== undefined);
      return vs.reduce((a, b) => a + b, 0) / vs.length;
    };
    expect(mean('2024')).toBeLessThan(0.95);
    expect(mean('2025')).toBeGreaterThan(1.05);
  });

  it('실존 감독 컨디션 반영 = 선발 라인업 변동 대리값 (그 해 구단 값 → 평균, 몫 0.6, 0.5~1.5), 자료 없으면 1 (13-0-5)', () => {
    const info = infoOf(store, '염경엽')!;
    const by = info.byYear!['2024'].cond!;
    expect(by).toBeLessThan(1);
    expect(tacticsOf(info, '염경엽', 2024).cond).toBeCloseTo(1 + (by - 1) * TACTIC_SHARE.cond, 3);
    expect(tacticsOf(info, '염경엽').cond).toBeCloseTo(1 + (info.cond! - 1) * TACTIC_SHARE.cond, 3);
    expect(tacticsOf({ ...info, cond: undefined, byYear: undefined }, '염경엽').cond).toBe(1);
    for (const i of Object.values(store.managers!.people)) {
      const c = tacticsOf(i).cond;
      expect(c).toBeGreaterThanOrEqual(VIRTUAL_RANGE.cond[0]);
      expect(c).toBeLessThanOrEqual(VIRTUAL_RANGE.cond[1]);
    }
  });
});

describe('전진 수비·좌우 원포인트 (엔진 2 10단계)', () => {
  it('일어나고, 확률 0이면 하나도 없다', () => {
    const on = play(w2025, DEFAULT_PARAMS, 'ifin', 40).pen;
    expect(on.ifIn).toBeGreaterThan(0);
    expect(on.loogy).toBeGreaterThan(0);
    const off = play(w2025, { ...DEFAULT_PARAMS, mgr: { ...DEFAULT_PARAMS.mgr, infieldIn: { ...DEFAULT_PARAMS.mgr.infieldIn, rate: 0 }, onePoint: { ...DEFAULT_PARAMS.mgr.onePoint, rate: 0 } } }, 'ifin', 40).pen;
    expect(off.ifIn + off.loogy + off.ifInGb).toBe(0);
  });
});

describe('블론 기록 회 (엔진 2 10단계)', () => {
  it(`${BLOWN_FROM_INNING}회 전에 세이브 상황으로 나와 리드를 잃은 등판은 블론으로 기록하지 않는다`, () => {
    const { s, pen } = play(w2025, DEFAULT_PARAMS, 'blown-inning', 60);
    const recorded = s.pit.reduce((a, l) => a + l.bsv, 0);
    const lost = Object.values(pen.blown).reduce((a, b) => a + b, 0);
    const early = Object.entries(pen.blown).filter(([k]) => k.startsWith('~6/')).reduce((a, [, v]) => a + v, 0);
    expect(early).toBeGreaterThan(0);
    expect(recorded).toBe(lost - early);
  });
});
