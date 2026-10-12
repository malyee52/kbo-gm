// 판정 미리보기: 다시 판정 한도(판정 단계별, 하루 단위), 거둬들인 행동은 조작 없이 기록만
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { REROLLS, rerollBudget } from '../src/ui/screens/GmPreview';
import { freeContext } from '../src/fantasy/free';
import { PRESETS } from '../src/league/difficulty';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('판정 미리보기', () => {
  it('다시 판정 한도와 거둬들인 행동', () => {
    expect(REROLLS[0]).toBe(0);
    expect(REROLLS[6]).toBeGreaterThan(REROLLS[3]);
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'preview-1', fantasy: { free: true } }, FAST);
    expect(rerollBudget(g)).toEqual({ limit: REROLLS[3], used: 0 });
    const fans0 = g.league.fantasy!.log.length;
    g.addFantasy({ kind: 'action', title: '(철회) 무리한 요구', ask: '오타니를 공짜로', text: 'x', withdrawn: true, rerolls: 1 });
    expect(rerollBudget(g).used).toBe(1);
    expect(g.league.fantasy!.log.length).toBe(fans0 + 1);
    expect(freeContext(g, store)).toContain('거둬들임');
    // 다음 날이면 다시 채워진다
    g.advance(1);
    expect(rerollBudget(g).used).toBe(0);
    g.setDifficulty({ ...PRESETS.normal, aiLeniency: 6 });
    expect(rerollBudget(g).limit).toBe(REROLLS[6]);
  }, 120_000);
});
