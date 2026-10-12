// AI 판정 7단계: 난이도 묶음 기본값, 명분이 있을 때만 올려 주는 보정, 지시문, 협상 효과 크기
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { adjustStance, leniencyOf, leniencyRule } from '../src/fantasy/leniency';
import { freeSystem } from '../src/fantasy/free';
import { tradeTalk } from '../src/fantasy/negotiate';
import { PRESETS } from '../src/league/difficulty';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const mock = { provider: 'mock' as const, model: 'mock', key: '' };
beforeAll(() => { store = loadDataStore(); }, 120_000);
const lgOf = () => store.season(2026)!.teams.findIndex((t) => t.name === 'LG');

describe('AI 판정 7단계', () => {
  it('난이도 묶음 기본값, 예전 저장은 보통', () => {
    expect(leniencyOf({ difficulty: 'easy' })).toBe(4);
    expect(leniencyOf({ difficulty: 'normal' })).toBe(3);
    expect(leniencyOf({ difficulty: 'hard' })).toBe(2);
    const { aiLeniency: _, ...old } = PRESETS.easy;
    expect(leniencyOf({ difficulty: 'easy', settings: old })).toBe(3);
    expect(leniencyOf({ settings: { ...old, aiLeniency: 6 } })).toBe(6);
  });

  it('올려 주는 보정은 명분이 인정될 때(태도 1 이상)만, 깎는 보정은 늘', () => {
    expect(adjustStance(-3, 6)).toBe(-3);
    expect(adjustStance(0, 6)).toBe(0);
    expect(adjustStance(1, 6)).toBe(3);
    expect(adjustStance(2, 4)).toBe(3);
    expect(adjustStance(2, 0)).toBe(0);
    expect(adjustStance(0, 1)).toBe(-1);
  });

  it('가장 쉬운 단계 지시문도 명분을 요구한다', () => {
    for (const l of [0, 3, 6] as const) expect(leniencyRule(l)).toContain('명분이 없는 요구');
    expect(freeSystem(false, 6)).toContain('판타지 리그');
    expect(freeSystem(false, 0)).toContain('아주 엄격');
  });

  it('판타지 리그 단계는 같은 설득에 호감이 더 크다 (게임 중 설정 변경)', async () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lgOf(), seed: 'len-1', fantasy: { free: true } }, FAST);
    const ai = (g.teamIdx + 1) % g.world.teams.length;
    const input = { team: ai, proposal: 'x', verdict: 'short' as const, gap: 3, tendency: 't', argument: '좋은 제안입니다' };
    const base = await tradeTalk(g, mock, input);
    expect(base.effects![0]).toMatchObject({ type: 'tradeGoodwill', runs: 4 });
    expect(g.setDifficulty({ ...PRESETS.normal, aiLeniency: 6 }).ok).toBe(true);
    const fun = await tradeTalk(g, mock, input);
    expect(fun.effects![0]).toMatchObject({ type: 'tradeGoodwill', runs: 12 });
  }, 120_000);
});
