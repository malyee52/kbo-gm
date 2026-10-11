// 직접 지휘 (경기 개입, 2026-10-12): 미리보기는 실제 게임을 바꾸지 않고, 확정하면 미리보기와 같은 결과, 조작 기록으로 다시 돌려도 같다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type CommandChoice } from '../src/engine';
import { GameSession, isCrisis } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
const create = (seed: string) => GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

/** 오늘 우리 경기가 있는 날까지 */
function toGameDay(g: GameSession): void {
  while (!g.hasGameToday) g.advance(1, NO_STOPS);
}

describe('직접 지휘', () => {
  it('모두 자동이면 지휘하지 않은 경기와 결과가 같고, 미리보기는 실제 게임을 바꾸지 않는다', () => {
    const a = create('cmd-a');
    const b = create('cmd-a');
    toGameDay(a); toGameDay(b);
    const before = JSON.stringify(a.season.toSave());
    const pv = a.commandPreview([], 'auto');
    expect(JSON.stringify(a.season.toSave())).toBe(before);
    expect(pv.req).toBeNull();
    expect(pv.choices.length).toBeGreaterThan(30);
    a.commitCommand(pv.choices);
    b.advance(1, NO_STOPS);
    expect(a.season.log).toEqual(b.season.log);
    const g = a.season.log.find((x, i) => i >= a.season.log.length - 6 && (x.home === lg || x.away === lg))!;
    expect({ away: g.awayRuns, home: g.homeRuns }).toEqual(pv.final);
  }, 120_000);

  it('대타·작전을 고르면 미리보기와 확정 결과가 같고, 조작 기록으로 다시 돌려도 같다', () => {
    const g = create('cmd-b');
    toGameDay(g);
    const choices: CommandChoice[] = [];
    let pv = g.commandPreview(choices, 'next');
    let usedPh = false;
    let steals = 0;
    let guard = 0;
    while (pv.req && guard++ < 200) {
      const r = pv.req;
      const c: CommandChoice = {};
      if (r.step === 'run') { c.steal = 'go'; steals++; }
      if (r.step === 'bat' && !usedPh && r.bench.length && r.inn >= 5) { c.ph = r.bench[0]; usedPh = true; }
      if (r.step === 'bat' && r.bases[0] >= 0 && r.bases[1] < 0 && r.outs < 2) c.tactic = 'bunt';
      if (r.side === 'field' && r.inn === 6 && r.bullpen.length && !r.plays.some((p) => p.kind === 'PC' && p.inn === 6)) c.pitcher = r.bullpen[0];
      pv = g.commandPreview([...pv.choices, c], 'next');
    }
    expect(pv.req).toBeNull();
    expect(pv.plays.some((p) => p.kind === 'PH')).toBe(usedPh);
    // 주자 작전은 1루 주자·2루 빈 때만 묻고, 도루 시도를 고르면 도루 기록이 남는다. 도루 뒤에도 같은 타석의 타격 작전을 묻는다
    expect(steals).toBeGreaterThan(0);
    expect(pv.plays.filter((p) => (p.kind === 'SB' || p.kind === 'CS') && !p.top === (pv.home === lg)).length).toBe(steals);
    g.commitCommand(pv.choices);
    const last = g.ourGames().at(-1)!;
    expect({ away: last.awayRuns, home: last.homeRuns }).toEqual(pv.final);
    expect(last.plays).toEqual(pv.plays);
    const rep = GameSession.replay(store, g.reproInfo().opts, g.actions, { year: 2026, day: g.day }, FAST);
    expect(rep.season.log).toEqual(g.season.log);
  }, 240_000);

  it('위기 멈춤: 자동 진행이 우리 경기의 위기·승부처에서 그날을 진행하지 않고 멈춘다', () => {
    const g = create('cmd-c');
    let stopped = false;
    for (let k = 0; k < 40 && !stopped; k++) {
      g.advance(1, { ...NO_STOPS, crisis: true });
      stopped = g.attention.some((a) => a.kind === 'crisis');
    }
    expect(stopped).toBe(true);
    const day = g.day;
    expect(isCrisis(g.crisis!.req!)).toBe(true);
    const pv = g.commandPreview(g.crisis!.choices, 'auto');
    g.commitCommand(pv.choices);
    expect(g.day).toBe(day + 1);
    expect(g.crisis).toBeNull();
  }, 240_000);
});
