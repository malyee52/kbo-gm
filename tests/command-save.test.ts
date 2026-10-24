// 수동 경기 저장·재현·전환 (엔진 2 18단계, docs/경기엔진2_기획안.md 3.7·3.8): 경기 중 저장 → 불러오기 → 이어 가기 = 끊지 않은 결과,
// A → B 넘기기(빠르게 끝내기)와 B → A 끼어들기(위기 멈춤)의 재현, 조작 기록 압축([물음 번호, 선택])과 재현.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type CommandChoice, type CommandRequest } from '../src/engine';
import { GameSession, isCrisis, packChoices, type CommandPreview, type GameAction } from '../src/game/session';
import { NO_STOPS } from '../src/game/stops';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

function gameDay(seed: string): GameSession {
  const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
  while (!g.hasGameToday || g.pendingEvent) {
    if (g.pendingEvent) g.answerEvent(0);
    else g.advance(1, NO_STOPS);
  }
  return g;
}

/** 시험용 지휘: 4회부터 주자 작전은 도루, 6회 수비 첫 물음에 구원 투수, 나머지는 자동 */
function pick(r: CommandRequest): CommandChoice {
  if (r.step === 'run' && r.inn >= 4) return { steal: 'go' };
  if (r.side === 'field' && r.step === 'field' && r.inn === 6 && r.bullpen.length && !r.plays.some((p) => p.kind === 'PC' && p.inn === 6)) return { pitcher: r.bullpen[0] };
  return {};
}

/** 지휘 경기를 열고 물음마다 pick으로 고르며 stop(물음)이 참일 때까지 (mode = 멈출 물음) */
function stepUntil(g: GameSession, stop: (r: CommandRequest) => boolean, mode: 'next' | 'pitch' = 'next'): CommandPreview {
  let pv = g.commandInProgress ? g.commandResume() : g.commandOpen();
  let guard = 0;
  while (pv.req && !stop(pv.req) && guard++ < 3000) pv = g.commandStep(pick(pv.req), mode);
  return pv;
}

const ourLog = (g: GameSession) => g.ourGames().at(-1)!;
const sameOnReplay = (g: GameSession) => {
  const rep = GameSession.replay(store, g.reproInfo().opts, g.actions, { year: 2026, day: g.day }, FAST);
  expect(rep.season.log).toEqual(g.season.log);
  expect(rep.ourGames().at(-1)!.plays).toEqual(ourLog(g).plays);
};

describe('수동 경기 저장·재현·전환 (엔진 2 18단계)', () => {
  it('경기 중 저장 → 불러오기 → 이어 가기 = 끊지 않은 결과. 조작 기록은 고른 물음만 남고 다시 돌려도 같다', () => {
    const a = gameDay('cmd-save');
    const b = gameDay('cmd-save');
    // a: 5회 공 사이 물음에서 저장하고 불러와 이어 간다
    const mid = stepUntil(a, (r) => r.inn >= 5 && r.step === 'pitch' && (r.count?.[0] ?? 0) + (r.count?.[1] ?? 0) > 0, 'pitch');
    expect(mid.req).not.toBeNull();
    const save = JSON.parse(JSON.stringify(a.toSave()));
    expect(save.pendingGame).toMatchObject({ day: a.day, at: mid.req!.n });
    const t0 = performance.now();
    const loaded = GameSession.load(store, save, FAST);
    const resumed = loaded.commandResume();
    const ms = performance.now() - t0;
    console.log(`불러와 이어 가기 (경기 처음부터 다시 돌림): ${ms.toFixed(0)}ms, 물음 ${mid.req!.n}개`);
    expect(resumed.req).toEqual(mid.req);
    expect(resumed.plays).toEqual(mid.plays);
    const end1 = stepUntil(loaded, () => false);
    expect(end1.req).toBeNull();
    expect(loaded.commandFinish('A').ok).toBe(true);
    // b: 같은 선택을 끊지 않고 (공 사이 물음은 자동, 같은 물음 번호에서 같은 선택)
    const end2 = stepUntil(b, () => false, 'pitch');
    expect(b.commandFinish('A').ok).toBe(true);
    expect(end2.final).toEqual(end1.final);
    expect(loaded.season.log).toEqual(b.season.log);
    expect(ourLog(loaded).plays).toEqual(ourLog(b).plays);
    // 압축: 빈 선택(자동)은 적지 않는다
    const act = loaded.actions.at(-1) as Extract<GameAction, { type: 'command' }>;
    expect(act.choices).toBeUndefined();
    expect(act.picks!.length).toBe(packChoices(end2.choices).length);
    expect(act.picks!.every(([, c]) => Object.keys(c).length > 0)).toBe(true);
    const before = JSON.stringify({ ...act, picks: undefined, choices: end2.choices }).length;
    const after = JSON.stringify(act).length;
    console.log(`지휘 기록 크기: ${before} → ${after}바이트 (물음 ${end2.choices.length}개, 고른 것 ${act.picks!.length}개)`);
    expect(after).toBeLessThan(before / 3);
    sameOnReplay(loaded);
  }, 300_000);

  it('한 번 진행한 경기는 창을 닫아도 남고(되돌리지 않음), 하루를 진행하면 감독에게 맡긴 결과(A 계속)와 같다', () => {
    const a = gameDay('cmd-close');
    const b = gameDay('cmd-close');
    const opened = a.commandOpen();
    expect(opened.req!.n).toBe(0);
    // 아무것도 진행하지 않았으면 닫을 때 버린다
    expect(a.commandClose()).toBe(true);
    expect(a.pendingGame).toBeNull();
    stepUntil(a, (r) => r.inn >= 3);
    stepUntil(b, (r) => r.inn >= 3);
    expect(a.commandClose()).toBe(false);
    expect(a.pendingGame).not.toBeNull();
    const day = a.day;
    a.advance(1, NO_STOPS);
    expect(a.day).toBe(day + 1);
    expect(a.pendingGame).toBeNull();
    expect(b.commandFinish('A').ok).toBe(true);
    expect(a.season.log).toEqual(b.season.log);
    sameOnReplay(a);
  }, 300_000);

  it('A → B 넘기기 (빠르게 끝내기): 공 사이 물음에서 넘기면 그때까지는 같고, 남은 경기는 B로. 재현해도 같다', () => {
    const g = gameDay('cmd-handoff');
    const mid = stepUntil(g, (r) => r.inn >= 4 && r.step === 'pitch' && (r.count?.[0] ?? 0) + (r.count?.[1] ?? 0) > 0, 'pitch');
    const at = mid.req!.n;
    const shown = mid.plays;
    // 같은 지점에서 끝까지 미리보기 (B로 넘긴 뒤는 묻지 않는다)
    const p = g.pendingGame!;
    const pre = g.commandPreview(mid.choices, 'next', undefined, { handoff: at });
    expect(pre.req).toBeNull();
    expect(pre.choices.length).toBe(at);
    expect(g.commandFinish('B').ok).toBe(true);
    const act = g.actions.at(-1) as Extract<GameAction, { type: 'command' }>;
    expect(act.handoff).toBe(at);
    expect(act.picks).toEqual(p.picks);
    const log = ourLog(g);
    expect({ away: log.awayRuns, home: log.homeRuns }).toEqual(pre.final);
    // 넘기기 전 중계는 그대로, 넘긴 타석부터는 공 기호가 없다 (계산으로 접음)
    expect(log.plays!.slice(0, shown.length)).toEqual(shown);
    expect(log.plays!.slice(shown.length).some((x) => x.seq)).toBe(false);
    sameOnReplay(g);
  }, 300_000);

  it('B → A 끼어들기 (위기 멈춤): 끼어들기 전 중계는 지휘하지 않은 경기와 같고, 고른 대로 확정한 결과를 재현해도 같다', () => {
    const seeds = ['cmd-crisis-a', 'cmd-crisis-b', 'cmd-crisis-c'];
    let done = false;
    for (const seed of seeds) {
      const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
      const plain = GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
      let stopped = false;
      for (let k = 0; k < 40 && !stopped; k++) {
        if (g.pendingEvent) { g.answerEvent(0); plain.answerEvent(0); }
        g.advance(1, { ...NO_STOPS, crisis: true });
        stopped = !!g.crisis;
        if (!stopped) {
          plain.advance(1, NO_STOPS);
          // 위기가 없던 날은 지휘하지 않은 날과 똑같다
          expect(g.season.log).toEqual(plain.season.log);
        }
      }
      if (!stopped) continue;
      const cr = g.crisis!;
      expect(isCrisis(cr.req!)).toBe(true);
      expect(cr.from).toBeGreaterThanOrEqual(0);
      // 끼어들기 전은 지휘하지 않은 경기(B)와 같다
      if (plain.pendingEvent) plain.answerEvent(0);
      plain.advance(1, NO_STOPS);
      const b = plain.ourGames().at(-1)!;
      expect(b.plays!.slice(0, cr.plays.length)).toEqual(cr.plays);
      // 저장 → 불러오기 → 이어 가기
      const loaded = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), FAST);
      expect(loaded.commandResume().req).toEqual(cr.req);
      let pv: CommandPreview = cr;
      let guard = 0;
      while (pv.req && guard++ < 300) pv = g.commandStep(pick(pv.req), 'next');
      expect(g.commandFinish('A').ok).toBe(true);
      const act = g.actions.at(-1) as Extract<GameAction, { type: 'command' }>;
      expect(act.from).toBe(cr.from);
      expect({ away: ourLog(g).awayRuns, home: ourLog(g).homeRuns }).toEqual(pv.final);
      // 끼어든 뒤 A 타석은 공 기호가 있다
      expect(ourLog(g).plays!.slice(cr.plays.length).some((x) => x.seq)).toBe(true);
      sameOnReplay(g);
      done = true;
      break;
    }
    expect(done).toBe(true);
  }, 600_000);
});
