// 긴 진행 멈추기 (2026-11-11 편의 U1, ui/GameShell.tsx advance): 화면은 7일 묶음으로 session.advance를 부르고,
// '멈추기'를 누르면 묶음 사이에서 그만둔다. 멈춘 결과는 그날까지 한 번에 진행한 결과와 같아야 한다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('긴 진행 멈추기', () => {
  it('한 달 진행을 7일 묶음 셋 뒤에 멈춘 결과 = 21일을 한 번에 진행한 결과', () => {
    const opts = { year: 2026, teamIdx: 2, seed: 'stop-test' };
    const a = GameSession.create(store, opts, FAST);
    const b = GameSession.create(store, opts, FAST);
    // 화면 루프 흉내: 30일 진행, 셋째 묶음 뒤 멈춤
    let left = 30;
    let chunks = 0;
    while (left > 0 && !a.done) {
      const did = a.advance(Math.min(7, left));
      left -= did;
      if (a.stopped || did === 0) break;
      if (++chunks === 3) break;
    }
    const days = a.day - b.day;
    b.advance(days);
    expect(b.day).toBe(a.day);
    expect(b.toSave().season).toEqual(a.toSave().season);
    expect(b.news).toEqual(a.news);
    // 멈춘 뒤 이어 가도 끊지 않은 진행과 같다
    a.advance(20);
    b.advance(20);
    expect(b.toSave().season).toEqual(a.toSave().season);
  });
});
