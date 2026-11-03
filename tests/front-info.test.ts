// 재정 2 프런트 "선수 요구 정보" (기획안 4.4, 2026-11-03 사용자 결정 "최저선 정보 더하기"):
// ① 범위가 진짜 최저선을 늘 담는다 ② 프런트 예산이 클수록 폭이 줄어든다 ③ 같은 시드·같은 선수면 같은 범위 (결정성)
// ④ 실제 FA 시장: 화면 범위가 판정의 진짜 수락선을 담고, 범위를 봐도 계약 결과(장부)는 그대로
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { OPS_BUDGET_RANGE } from '../src/league/finance';
import { FRONT_INFO_WIDTH, frontInfoWidth, lineRange } from '../src/league/frontInfo';
import { faAcceptLine } from '../src/league/offseason';

describe('프런트 최저선 범위 (순수 함수)', () => {
  const [lo, hi] = OPS_BUDGET_RANGE.front;

  it('① 범위는 진짜 최저선을 담는다 (여러 선수·금액·예산)', () => {
    for (let i = 0; i < 400; i++) {
      const truth = 3_000 + i * 977;
      const front = lo + ((hi - lo) * (i % 8)) / 7;
      const r = lineRange('seed-a', `fa/2026/1/p${i}`, truth, front);
      expect(r.lo).toBeLessThanOrEqual(truth);
      expect(r.hi).toBeGreaterThanOrEqual(truth);
    }
  });

  it('② 프런트 예산이 클수록 폭이 줄어든다 (45억 ±15% → 80억 ±3%)', () => {
    expect(frontInfoWidth(lo)).toBeCloseTo(FRONT_INFO_WIDTH[0]);
    expect(frontInfoWidth(hi)).toBeCloseTo(FRONT_INFO_WIDTH[1]);
    let prev = Infinity;
    for (let a = lo; a <= hi; a += 50_000) {
      const r = lineRange('seed-a', 'fa/2026/1/x', 100_000, a);
      expect(r.hi - r.lo).toBeLessThan(prev);
      prev = r.hi - r.lo;
    }
    // 같은 자리(u)라 좁아질수록 진짜 값 쪽으로 모인다
    const wide = lineRange('seed-a', 'k', 100_000, lo);
    const narrow = lineRange('seed-a', 'k', 100_000, hi);
    expect(narrow.lo).toBeGreaterThanOrEqual(wide.lo);
    expect(narrow.hi).toBeLessThanOrEqual(wide.hi);
  });

  it('③ 같은 시드·같은 열쇠면 같은 범위, 열쇠가 다르면 자리가 다르다', () => {
    expect(lineRange('s', 'fa/2026/1/a', 50_000, 600_000)).toEqual(lineRange('s', 'fa/2026/1/a', 50_000, 600_000));
    const spots = new Set(Array.from({ length: 20 }, (_, i) => lineRange('s', `fa/2026/1/p${i}`, 50_000, 600_000).lo));
    expect(spots.size).toBeGreaterThan(5);
  });
});

describe('④ FA 시장에서', () => {
  let store: DataStore;
  let g: GameSession;
  beforeAll(() => {
    store = loadDataStore();
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'fi-1' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    g.advance(100000);
    g.advancePostseason(10_000);
    g.beginOffseason();
    let guard = 0;
    while (g.offseason!.stage !== 'fa' && guard++ < 10) g.nextStage();
  }, 600_000);

  it('열린 FA마다 범위가 진짜 수락선을 담고, 다시 불러도 같다', () => {
    const off = g.offseason!;
    expect(off.stage).toBe('fa');
    const open = off.fa.entries.filter((e) => e.status === 'open');
    expect(open.length).toBeGreaterThan(0);
    for (const e of open) {
      const r = g.faAcceptRange(e.id)!;
      const truth = faAcceptLine(g.league, off, e);
      expect(r.lo).toBeLessThanOrEqual(truth);
      expect(r.hi).toBeGreaterThanOrEqual(truth);
      expect(g.faAcceptRange(e.id)).toEqual(r);
    }
    expect(g.faAcceptRange('없는 선수')).toBeNull();
  });

  it('범위를 보는 것은 상태를 바꾸지 않는다 (저장 그대로)', () => {
    const before = JSON.stringify(g.toSave());
    for (const e of g.offseason!.fa.entries) g.faAcceptRange(e.id);
    expect(JSON.stringify(g.toSave())).toBe(before);
  });
});
