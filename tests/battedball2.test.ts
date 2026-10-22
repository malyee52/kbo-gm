// 타구 모형 2 (엔진 2 6단계): 땅볼 성향 추정, 땅볼 투수의 병살 유도, 아웃 타구 땅볼 몫
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import type { Rates } from '../src/data/types';
import { DEFAULT_PARAMS, Season, simulateSeason, worldForYear, type World } from '../src/engine';
import { emptyBallTally } from '../src/engine/battedball';
import { pitGbOf } from '../src/engine/ratings';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
let world: World;
let cal: Rates;

beforeAll(() => {
  world = worldForYear(loadDataStore(), 2025, FAST);
  cal = simulateSeason(world, FAST, 'gb-cal').cal;
});

/** 모든 투수의 땅볼 성향을 gb로 바꾼 월드 (다른 능력은 그대로). 구단 명단(org)도 새 선수 객체를 가리키게 한다 */
const withPitGb = (gb: number): World => {
  const players = world.players.map((p) => (p.pit ? { ...p, pit: { ...p.pit, gb } } : p));
  return { ...world, players, teams: world.teams.map((t) => ({ ...t, org: t.org.map((p) => players[p.idx]) })) };
};

describe('타구 모형 2', () => {
  it('투수 땅볼 성향: 홈런을 덜 맞는 투수가 땅볼형, 리그 평균 투수는 1', () => {
    expect(pitGbOf(1, DEFAULT_PARAMS)).toBeCloseTo(1, 9);
    expect(pitGbOf(0.7, DEFAULT_PARAMS)).toBeGreaterThan(1);
    expect(pitGbOf(1.4, DEFAULT_PARAMS)).toBeLessThan(1);
  });

  it('2025 월드의 선수별 땅볼 성향은 리그 평균 1 안팎이고 범위가 넓지 않다', () => {
    const logMean = (xs: number[]) => xs.reduce((s, x) => s + Math.log(x), 0) / xs.length;
    const pit = world.players.flatMap((p) => (p.pit?.gb !== undefined ? [p.pit.gb] : []));
    const bat = world.players.flatMap((p) => (p.bat?.gb !== undefined ? [p.bat.gb] : []));
    expect(pit.length).toBeGreaterThan(100);
    expect(bat.length).toBeGreaterThan(100);
    for (const xs of [pit, bat]) {
      expect(Math.abs(logMean(xs))).toBeLessThan(0.15);
      expect(Math.min(...xs)).toBeGreaterThan(0.3);
      expect(Math.max(...xs)).toBeLessThan(3.5);
    }
  });

  it('땅볼 투수는 병살을 평균보다 많이, 뜬공 투수는 적게 유도한다 (같은 시드)', () => {
    const run = (w: World) => {
      const balls = emptyBallTally();
      const s = Season.start(w, FAST, 'gb-dp', { cal, balls });
      s.runToEnd();
      const r = s.result();
      const t = balls.outType;
      return { dp: r.totals.gdp / r.totals.pa, gbOut: t[0] / (t[0] + t[2] + t[3]) };
    };
    const avg = run(withPitGb(1));
    const ground = run(withPitGb(1.8));
    const fly = run(withPitGb(0.55));
    expect(ground.gbOut).toBeGreaterThan(avg.gbOut + 0.05);
    expect(fly.gbOut).toBeLessThan(avg.gbOut - 0.05);
    expect(ground.dp).toBeGreaterThan(avg.dp * 1.08);
    expect(fly.dp).toBeLessThan(avg.dp * 0.92);
  }, 120_000);
});
