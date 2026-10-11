// 세부 난이도 (league/difficulty.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { PRESETS, settingsLabel, settingsOf } from '../src/league/difficulty';
import { parentSupport } from '../src/league/finance';
import { ensureEvents } from '../src/league/events';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

describe('세부 난이도', () => {
  it('묶음과 사용자 설정: 묶음이면 그 값, 사용자 설정이면 그대로, 이름은 묶음과 같으면 그 이름', () => {
    expect(settingsOf({ difficulty: 'hard' })).toEqual(PRESETS.hard);
    const custom = { ...PRESETS.normal, injury: 0.5 };
    expect(settingsOf({ difficulty: 'normal', settings: custom })).toEqual(custom);
    expect(settingsLabel({ difficulty: 'normal', settings: custom })).toBe('사용자 설정');
    expect(settingsLabel({ settings: { ...PRESETS.easy } })).toBe('쉬움');
  });

  it('트레이드: 같은 제안에 AI가 요구하는 이득이 배율만큼 커진다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'diff-t' }, FAST);
    const give = [g.team.org.find((p) => !p.foreign)!];
    const get = [g.world.teams[0].org.find((p) => !p.foreign)!];
    const base = g.evaluateTrade(0, give, get).detail.need;
    expect(g.setDifficulty({ ...PRESETS.normal, tradeStrict: 1.5 }).ok).toBe(true);
    expect(g.evaluateTrade(0, give, get).detail.need).toBeCloseTo(base * 1.5, 6);
  });

  it('수입: 우리 구단 모기업 지원금에 배율', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'diff-i', settings: { ...PRESETS.normal, income: 1.3 } }, FAST);
    const mine = parentSupport(g.league, lg, 50, 0);
    g.league.settings = { ...PRESETS.normal };
    expect(mine).toBeGreaterThan(parentSupport(g.league, lg, 50, 0));
  });

  it('부상 빈도: 우리 구단만 배율 (같은 시드에서 0.5배와 1.5배의 결장 비교), 게임 중 바꾼 것도 재현된다', () => {
    const count = (s: number) => {
      const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'diff-inj', settings: { ...PRESETS.normal, injury: s } }, FAST);
      for (let i = 0; i < 90; i++) { ensureEvents(g.league).chance = 0; g.advance(1); }
      return g.season.absences.filter((a) => g.world.players[a.idx].teamIdx === lg && a.kind !== 'event').length;
    };
    expect(count(1.5)).toBeGreaterThan(count(0.5));
    const o = { year: 2026, teamIdx: lg, seed: 'diff-rep' };
    const g = GameSession.create(store, o, FAST);
    g.advance(10);
    g.setDifficulty({ ...PRESETS.hard });
    g.advance(20);
    const r = GameSession.replay(store, o, g.actions, g.day, FAST);
    expect(r.league.settings).toEqual(PRESETS.hard);
    expect(r.season.standings()).toEqual(g.season.standings());
  }, 300_000);
});
