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
  it('모두 자동이면 미리보기와 확정 결과가 같고, 그날 다른 경기는 지휘하지 않은 날과 같다. 미리보기는 실제 게임을 바꾸지 않는다', () => {
    // 지휘하는 경기는 A 해결기(공 단위, 엔진 2 17단계)라 지휘하지 않은 경기(B)와 결과는 다르고 분포만 같다 (tools/engine_ab.ts).
    // 경기마다 난수 줄기가 따로라 그날 다른 경기는 그대로다
    const a = create('cmd-a');
    const b = create('cmd-a');
    toGameDay(a); toGameDay(b);
    const before = JSON.stringify(a.season.toSave());
    const pv = a.commandPreview([], 'auto');
    expect(JSON.stringify(a.season.toSave())).toBe(before);
    expect(pv.req).toBeNull();
    expect(pv.choices.length).toBeGreaterThan(100); // 공마다 물음 (공 사이 지휘)
    const n = a.season.log.length;
    a.commitCommand(pv.choices);
    b.advance(1, NO_STOPS);
    const ours = (x: { home: number; away: number }) => x.home === lg || x.away === lg;
    expect(a.season.log.slice(n).filter((x) => !ours(x))).toEqual(b.season.log.slice(n).filter((x) => !ours(x)));
    const g = a.season.log.find((x, i) => i >= n && ours(x))!;
    expect({ away: g.awayRuns, home: g.homeRuns }).toEqual(pv.final);
    // 중계에 공 단위 카운트가 남는다
    const last = a.ourGames().at(-1)!;
    expect(last.plays!.filter((p) => p.seq).length).toBeGreaterThan(40);
  }, 120_000);

  it('대타·작전을 고르면 미리보기와 확정 결과가 같고, 조작 기록으로 다시 돌려도 같다', () => {
    const g = create('cmd-b');
    toGameDay(g);
    const choices: CommandChoice[] = [];
    let pv = g.commandPreview(choices, 'next');
    let usedPh = false;
    const steals: { inn: number; runner: number }[] = [];
    let guard = 0;
    while (pv.req && guard++ < 200) {
      const r = pv.req;
      const c: CommandChoice = {};
      // 주자 작전은 1루 주자·2루 빔이면 2루 도루, 2루 주자·3루 빔이면 3루 도루(1·2루면 이중 도루)로 앞 주자가 뛴다 (엔진 2 17단계)
      if (r.step === 'run') { c.steal = 'go'; steals.push({ inn: r.inn, runner: r.bases[0] >= 0 && r.bases[1] < 0 ? r.bases[0] : r.bases[1] }); }
      if (r.step === 'bat' && !usedPh && r.bench.length && r.inn >= 5) { c.ph = r.bench[0]; usedPh = true; }
      if (r.step === 'bat' && r.bases[0] >= 0 && r.bases[1] < 0 && r.outs < 2) c.tactic = 'bunt';
      if (r.side === 'field' && r.inn === 6 && r.bullpen.length && !r.plays.some((p) => p.kind === 'PC' && p.inn === 6)) c.pitcher = r.bullpen[0];
      pv = g.commandPreview([...pv.choices, c], 'next');
    }
    expect(pv.req).toBeNull();
    expect(pv.plays.some((p) => p.kind === 'PH')).toBe(usedPh);
    // 주자 작전은 도루할 수 있을 때만 묻고, 도루 시도를 고르면 그 주자의 도루 기록이 남는다. 도루 뒤에도 같은 타석의 타격 작전을 묻는다.
    // 2루 주자의 3루 도루는 묻지 않고 AI가 정하므로 도루 기록이 고른 수보다 많을 수 있다.
    // 주자 작전을 물은 뒤 견제사(PO)면 도루 없이 끝난다 (견제는 주자 작전과 같은 1루 주자·2루 빈 때만)
    expect(steals.length).toBeGreaterThan(0);
    const ours = pv.plays.filter((p) => (p.kind === 'SB' || p.kind === 'CS' || p.kind === 'PO') && !p.top === (pv.home === lg));
    expect(ours.length).toBeGreaterThanOrEqual(steals.length);
    let at = 0;
    for (const st of steals) {
      const k = ours.findIndex((p, i) => i >= at && p.inn === st.inn && p.bat === st.runner);
      expect(k, `${st.inn}회 ${st.runner}`).toBeGreaterThanOrEqual(0);
      at = k + 1;
    }
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
