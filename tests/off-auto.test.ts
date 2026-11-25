// 오프시즌 '남은 단계 추천대로 자동 진행' (2026-11-25 사용자 Q63, session.autoOffseason).
// 개막 준비 단계까지 가고, 우리가 골라야 하는 일은 추천 길로 처리하며, 모두 조작 기록으로 남아 재현이 같아야 한다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';
import * as Off from '../src/league/offseason';
import { ruleOf } from '../src/league/rules';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const OPTS = { year: 2026, teamIdx: 4, seed: 'off-auto' };

beforeAll(() => {
  store = loadDataStore();
}, 120_000);

describe('오프시즌 자동 진행', () => {
  it('개막 준비 단계에서 멈추고, 한 일을 소식으로 남기며, 조작 기록으로 같은 결과가 재현된다', () => {
    const g = GameSession.create(store, OPTS, FAST);
    g.advance(100000, NO_STOPS);
    if (g.postseasonRunning) g.advancePostseason(10_000);
    g.beginOffseason();
    expect(g.offseason?.stage).toBe('fa');
    const r = g.autoOffseason();
    expect(r.ok).toBe(true);
    expect(g.offseason?.stage).toBe('ready');
    // 정원 안, 드래프트 끝
    expect(Off.userOrgSize(g.league, g.offseason!)).toBeLessThanOrEqual(ruleOf(g.league, 'orgLimit'));
    const note = g.offseason!.log.at(-1)!;
    expect(note.mine).toBe(true);
    expect(note.text).toContain('남은 오프시즌 단계를 추천대로 진행했습니다');
    expect(g.actions.at(-1)?.type).toBe('auto-note');

    const again = GameSession.replay(store, OPTS, [...g.actions], undefined, FAST);
    expect(again.offseason?.stage).toBe('ready');
    const sig = (s: GameSession) => JSON.stringify({
      players: s.league.players.map((p) => [p.id, p.team, p.contract?.salary ?? null, p.contract?.until ?? null]),
      log: s.offseason!.log,
    });
    expect(sig(again)).toBe(sig(g));
  }, 300_000);
});
