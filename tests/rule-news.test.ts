// 리그 규칙 변경과 개막 "올해 달라지는 규칙" 알림 (docs/리그규칙변경_기획안.md 2장, 5.1 1-1·1-2).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, rosterFingerprint, type EngineParams } from '../src/engine';
import { createLeague } from '../src/league/create';

let store: DataStore;
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('규칙 변경 데이터 (1-1)', () => {
  it('rule_changes.json이 있고 공인구 표는 연도 순이다', () => {
    const rc = store.ruleChanges!;
    expect(rc.items.length).toBeGreaterThan(50);
    expect(rc.ball.map((b) => b.year)).toEqual([...rc.ball.map((b) => b.year)].sort((a, b) => a - b));
    expect(rc.ball.find((b) => b.year === 2019)?.range).toEqual([0.4034, 0.4234]);
  });

  it('규칙 자료는 선수 월드 지문에 들어가지 않는다 (자료를 고쳐도 예전 저장을 쓴다)', () => {
    const noRules: DataStore = { ...store, ruleChanges: undefined };
    for (const year of [2025, 1982]) {
      const a = createLeague(store, year, 'fp', FAST).world;
      const b = createLeague(noRules, year, 'fp', FAST).world;
      expect(rosterFingerprint(b)).toBe(rosterFingerprint(a));
    }
  });
});
