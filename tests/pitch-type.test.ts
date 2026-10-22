// 언더·사이드 투수 (2026-10-22, docs/하드힛_현실감_기획안.md 2.5): 실존 투수는 자료 그대로, 가상 투수는 실제 비율로
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { addFantasyProspect, UNDERHAND_SHARE } from '../src/league/offseason';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let store: DataStore;
let g: GameSession;

beforeAll(() => {
  store = loadDataStore();
  g = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'pitch-type' }, FAST);
});

describe('투구 유형', () => {
  it('실존 언더·사이드 투수는 리그 선수와 월드 선수 모두에 표시된다', () => {
    const real = g.league.players.filter((p) => p.real && p.isPitcher && store.players.get(p.id)?.underhand);
    expect(real.length).toBeGreaterThan(10);
    for (const p of real) {
      expect(p.underhand).toBe(true);
      const sp = g.world.players.find((x) => x.id === p.id);
      if (sp) expect(sp.underhand).toBe(true);
    }
    expect(g.league.players.filter((p) => !p.isPitcher && p.underhand)).toEqual([]);
  });

  it('가상 국내 투수는 실제 비율 근처로 언더·사이드가 되고, 삼진·볼넷이 함께 낮다', () => {
    const made = Array.from({ length: 240 }, (_, i) => addFantasyProspect(g.league, store, FAST, 0, { name: `시험투수${i}`, pos: 'P', age: 20, potential: 10 }));
    const right = made.filter((p) => p.throws === 'R');
    const share = right.filter((p) => p.underhand).length / right.length;
    expect(share).toBeGreaterThan(UNDERHAND_SHARE.R / 2);
    expect(share).toBeLessThan(UNDERHAND_SHARE.R * 2);
    const avg = (ps: typeof made, k: 'so' | 'bb') => ps.reduce((a, p) => a + p.pit![k], 0) / ps.length;
    const u = made.filter((p) => p.underhand);
    const o = made.filter((p) => !p.underhand);
    expect(avg(u, 'so') / avg(u, 'bb')).toBeGreaterThan(avg(o, 'so') / avg(o, 'bb')); // 볼넷이 삼진보다 더 줄었다
    expect(avg(u, 'bb')).toBeLessThan(avg(o, 'bb'));
    // 같은 리그 시드·선수 id면 같은 유형 (재현)
    const again = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'pitch-type' }, FAST);
    const p2 = addFantasyProspect(again.league, store, FAST, 0, { name: '시험투수0', pos: 'P', age: 20, potential: 10 });
    expect(p2.underhand === true).toBe(made[0].underhand === true);
  });
});
