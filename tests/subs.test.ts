// AI 감독 경기 중 교체 (엔진 2 9단계): 대타·대주자·대수비, 감독 성향 '대타·대주자 빈도'
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyRunTally, Season, worldForYear, type EngineParams } from '../src/engine';
import { NEUTRAL_TACTICS, tacticsOf, virtualSub } from '../src/league/managers';

const store = loadDataStore();
const world = worldForYear(store, 2025);

function play(params: EngineParams, seed: string, days = 30) {
  const run = emptyRunTally();
  const s = Season.start(world, params, seed, { running: run });
  for (let d = 0; d < days; d++) s.simulateDay();
  return { s, run };
}

describe('AI 감독 1 (엔진 2 9단계)', () => {
  it('대타·대주자·대수비가 일어나고, 회 기준을 끝 너머로 두면 하나도 없다', () => {
    const on = play(DEFAULT_PARAMS, 'subs-a').run;
    expect(on.ph).toBeGreaterThan(0);
    expect(on.def).toBeGreaterThan(0);
    const off = play({ ...DEFAULT_PARAMS, sub: { ...DEFAULT_PARAMS.sub, phInning: 99, prInning: 99, defInning: 99 } }, 'subs-a').run;
    expect(off.ph + off.pr + off.def).toBe(0);
  });

  it('같은 시드는 같은 교체', () => {
    expect(play(DEFAULT_PARAMS, 'subs-b', 10).run).toEqual(play(DEFAULT_PARAMS, 'subs-b', 10).run);
  });

  it('감독 성향: 실존 감독은 대타·대주자 빈도 1, 가상 감독은 이름으로 정한 0.7~1.3', () => {
    expect(NEUTRAL_TACTICS.sub).toBe(1);
    const info = store.managers ? Object.values(store.managers.people)[0] : undefined;
    if (info) expect(tacticsOf(info, '아무개').sub).toBe(1);
    for (const name of ['가상감독가', '가상감독나', '가상감독다']) {
      const v = virtualSub(name);
      expect(v).toBeGreaterThanOrEqual(0.7);
      expect(v).toBeLessThanOrEqual(1.3);
      expect(tacticsOf(undefined, name).sub).toBe(v);
    }
  });
});
