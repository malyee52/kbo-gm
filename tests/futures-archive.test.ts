// 지난 시즌 퓨처스(2군) 기록 보관 (2026-10-12): 결산 때 시즌 줄에 퓨처스 성적이 남는다. 창단 퓨처스 구단 선수도.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { FUT_BAT_KEYS, futuresFromRecord, futuresRecord } from '../src/league/futures';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('퓨처스 기록 보관', () => {
  it('배열로 남기고 다시 읽으면 같은 값 (반올림)', () => {
    const line = { idx: 0, teamIdx: 0, form: 0, bat: { g: 80.4, pa: 300, ab: 260, h: 75, d: 14, t: 2, hr: 6, bb: 30, so: 55 } };
    const rec = futuresRecord(line);
    expect(rec.fbat).toHaveLength(FUT_BAT_KEYS.length);
    expect(futuresFromRecord(rec.fbat).bat).toEqual({ ...line.bat, g: 80 });
    expect(futuresRecord(undefined)).toEqual({});
  });

  it('시즌을 마치면 2군에서 뛴 선수의 그 시즌 줄에 퓨처스 성적이 있고, 창단 퓨처스 구단(2012 NC) 선수도 남는다', () => {
    const g = GameSession.create(store, { year: 2012, teamIdx: 0, seed: 'fut-archive' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const lines = g.league.players.flatMap((p) => p.history.filter((h) => h.year === 2012 && (h.fbat || h.fpit)).map((h) => ({ p, h })));
    expect(lines.length).toBeGreaterThan(100);
    const nc = g.league.teams.findIndex((t) => t.name === 'NC');
    expect(lines.some(({ h }) => h.team === g.league.teams[nc].name)).toBe(true);
    // 1군 기록과 퓨처스 기록이 함께 있는 줄도 있다 (오르내린 선수)
    expect(lines.some(({ h }) => (h.bat || h.pit) && (h.fbat || h.fpit))).toBe(true);
  }, 240_000);
});
