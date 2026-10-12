// 2026-10-12 버그: 직접 정한 1군에 야수가 모자라 2군에서 임시로 올린 선수가 외국인(한도 초과)이라 다시 빠지고,
// 라인업이 8명이 되어 "라인업은 9명이어야 합니다" 오류로 경기가 멈췄다. 사용자 저장(2000 SK, 트레이드로 야수 정리) 그대로 재현한다.
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameAction } from '../src/game/session';

const store = loadDataStore();
const actions = [
  { year: 2000, day: 0, type: 'trade', team: 3, give: ['90313', '91206'], get: [], pr: ['2001:1:3', '2002:1:3'] },
  { year: 2000, day: 0, type: 'trade', team: 6, give: ['93812'], get: [], pr: ['2001:1:6', '2002:1:6'] },
  { year: 2000, day: 0, type: 'trade', team: 4, give: [], get: [], cash: 133333, pr: ['2002:1:4', '2001:1:4'] },
  { year: 2000, day: 0, type: 'trade', team: 2, give: [], get: [], cash: 133333, pr: ['2002:1:2', '2001:1:2'] },
  { year: 2000, day: 0, type: 'trade', team: 0, give: [], get: [], cash: 166667, pr: ['2001:1:0', '2002:1:0'] },
  { year: 2000, day: 0, type: 'trade', team: 5, give: ['84410', '91734', '93807', '91833'], get: [], cash: 66667, pr: ['2001:1:5', '2002:1:5'] },
] as unknown as GameAction[];

describe('외국인 한도와 1군 인원', () => {
  it('야수를 정리한 직접 1군이라도 한 시즌을 끝까지 치른다', () => {
    const g = GameSession.replay(store, { year: 2000, teamIdx: 7, seed: '1n5pm4', difficulty: 'normal' }, actions, { year: 2000, day: 93 },
      { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    expect(() => g.advance(100000)).not.toThrow();
    expect(g.done).toBe(true);
  }, 300_000);
});
