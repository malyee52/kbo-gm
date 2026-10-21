// 퀄리티 스타트·블론 세이브 기록 (2026-10-22, docs/하드힛_현실감_기획안.md 2.3)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, simulateSeason, worldForYear, type SeasonResult, type World } from '../src/engine';

let world: World;
let result: SeasonResult;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  world = worldForYear(loadDataStore(), 2025, FAST);
  result = simulateSeason(world, FAST, 'qs-blown');
});

describe('퀄리티 스타트·블론 세이브', () => {
  it('QS는 선발 등판 수를 넘지 않고, 6이닝을 못 던진 투수에게는 없다', () => {
    for (const l of result.pit) {
      expect(l.qs).toBeLessThanOrEqual(l.gs);
      if (l.qs > 0) expect(l.outs).toBeGreaterThanOrEqual(18 * l.qs);
    }
  });

  it('리그 QS 비율과 블론 수가 그럴듯한 범위에 있다', () => {
    const sum = (k: 'qs' | 'gs' | 'bsv' | 'sv') => result.pit.reduce((a, l) => a + l[k], 0);
    const qsPct = sum('qs') / sum('gs');
    expect(qsPct).toBeGreaterThan(0.25);
    expect(qsPct).toBeLessThan(0.6);
    const games = result.teams.reduce((a, t) => a + t.g, 0) / 2;
    expect(sum('bsv')).toBeGreaterThan(games * 0.05);
    expect(sum('bsv')).toBeLessThan(sum('sv'));
  });

  it('블론 세이브는 구원 투수만 (선발 전용 투수는 없다)', () => {
    for (const l of result.pit) if (l.g > 0 && l.g === l.gs) expect(l.bsv).toBe(0);
  });
});
