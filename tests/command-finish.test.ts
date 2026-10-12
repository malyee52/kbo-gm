// 직접 지휘 마무리 (2026-10-12): 대타·대주자는 바꾼 선수의 수비 자리를 맡고 박스스코어에 남는다. 가을야구 경기도 지휘하고, 다시 돌려도 같다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type CommandChoice } from '../src/engine';
import { GameSession } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

/** 미리보기에서 처음 대타를 쓸 수 있는 물음까지 자동, 거기서 벤치 첫 선수를 대타로, 나머지는 자동 */
function pinchHitChoices(g: GameSession): { choices: CommandChoice[]; ph: number } | null {
  let pv = g.commandPreview([], 'next');
  const choices: CommandChoice[] = [];
  while (pv.req) {
    if (pv.req.side === 'bat' && pv.req.step === 'bat' && pv.req.bench.length && pv.req.inn >= 5) {
      const ph = pv.req.bench[0];
      choices.push({ ph });
      return { choices: g.commandPreview(choices, 'auto').choices, ph };
    }
    choices.push({});
    pv = g.commandPreview(choices, 'next');
  }
  return null;
}

describe('직접 지휘 마무리', () => {
  it('대타는 박스스코어에 바꾼 타자 바로 아래, 같은 타순으로 남는다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'cmd-sub' }, FAST);
    while (!g.hasGameToday) g.advance(1, NO_STOPS);
    const pick = pinchHitChoices(g)!;
    expect(pick).not.toBeNull();
    const n = g.season.log.length;
    g.commitCommand(pick.choices);
    const k = g.season.log.findIndex((x, i) => i >= n && (x.home === lg || x.away === lg));
    const box = g.season.boxes.get(k)!;
    const side = g.season.log[k].home === lg ? box.home : box.away;
    const i = side.batters.findIndex((b) => b.idx === pick.ph);
    expect(i).toBeGreaterThan(0);
    expect(side.batters[i].sub).toBe('PH');
    expect(side.batters[i].order).toBe(side.batters[i - 1].order);
    expect(side.batters.filter((b) => !b.sub)).toHaveLength(9);
  }, 120_000);

  it('가을야구 경기도 직접 지휘할 수 있고, 조작 기록으로 다시 돌리면 같은 가을야구가 된다', () => {
    // 가을야구에 나가는 구단을 찾는다 (같은 시드면 정규시즌 결과는 구단 선택과 상관없이 같다)
    const probe = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'cmd-ps' }, FAST);
    probe.advance(100000, NO_STOPS);
    const team = probe.postseason!.seeds[0];
    const g = GameSession.create(store, { year: 2026, teamIdx: team, seed: 'cmd-ps' }, FAST);
    g.advance(100000, NO_STOPS);
    expect(g.postseason!.seeds).toContain(team);
    while (g.postseasonRunning && !g.ourPostseasonGameNext) g.advancePostseason(1);
    expect(g.canCommand).toBe(true);
    const pv = g.commandPreview([], 'next');
    expect(pv.req).not.toBeNull();
    // 첫 물음에서 작전을 하나 고르고 나머지 자동 (투수 유지 또는 강공)
    const first: CommandChoice = pv.req!.side === 'field' ? { keep: true } : { tactic: 'swing' };
    const all = g.commandPreview([first], 'auto');
    const games = g.ourGames().length;
    expect(g.commitCommand(all.choices).ok).toBe(true);
    expect(g.ourGames().length).toBe(games + 1);
    const last = g.ourGames().at(-1)!;
    expect({ away: last.awayRuns, home: last.homeRuns }).toEqual(all.final);
    const rep = GameSession.replay(store, g.reproInfo().opts, g.actions, g.reproInfo().at, FAST);
    expect(JSON.stringify(rep.postseason!.series.map((x) => x.games.map((y) => [y.home, y.away, y.homeRuns, y.awayRuns]))))
      .toBe(JSON.stringify(g.postseason!.series.map((x) => x.games.map((y) => [y.home, y.away, y.homeRuns, y.awayRuns]))));
  }, 300_000);
});
