// 직접 지휘를 A 해결기로 (엔진 2 17단계): 공 사이 지휘(투수 교체·도루), 항목을 고르면 그 일은 감독이 하지 않는다 (지시 정리).
// 미리보기 = 확정, 조작 기록으로 다시 돌려도 같다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type CommandChoice, type CommandRequest } from '../src/engine';
import { pitchCounts, pitchList, pitchNote } from '../src/game/highlights';
import { GameSession, type PreviewMode } from '../src/game/session';
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

/** 물음마다 pick으로 고르며 경기 끝까지 (mode = 멈출 물음) */
function play(g: GameSession, mode: PreviewMode, pick: (r: CommandRequest) => CommandChoice) {
  let pv = g.commandPreview([], mode);
  let guard = 0;
  while (pv.req && guard++ < 2000) pv = g.commandPreview([...pv.choices, pick(pv.req)], mode);
  expect(pv.req).toBeNull();
  return pv;
}

function sameOnReplay(g: GameSession) {
  const rep = GameSession.replay(store, g.reproInfo().opts, g.actions, { year: 2026, day: g.day }, FAST);
  expect(rep.season.log).toEqual(g.season.log);
}

describe('공 사이 지휘 (A 해결기)', () => {
  it('공 사이에 투수를 바꾸면 그 타석은 새 투수가 끝내고, 공 사이 도루를 하면 그 주자의 도루가 남는다', () => {
    const g = gameDay('cmd-pitch');
    let changed: { pit: number; count: [number, number] } | null = null;
    let stole: number | null = null;
    let counted = 0;
    const pv = play(g, 'pitch', (r) => {
      // 수비 타석 물음에는 라인업 순서대로 수비 자리 (대수비 화면)
      if (r.step === 'field') expect(r.fieldSlots?.length).toBe(r.lineup.length);
      if (r.step !== 'pitch') return {};
      expect(r.count).toBeDefined();
      // 화면의 공 목록 카운트(game/highlights.ts)가 엔진 카운트와 같다
      if (r.seq) {
        expect(pitchCounts(r.seq).at(-1)!.after).toEqual(r.count);
        expect(pitchList(r.seq)).toHaveLength(r.seq.length);
        counted++;
      }
      if (r.side === 'field' && !changed && r.inn >= 4 && r.count![1] >= 1 && r.bullpen.length) {
        changed = { pit: r.bullpen[0], count: r.count! };
        return { pitcher: r.bullpen[0] };
      }
      if (r.side === 'bat' && stole === null && r.bases[0] >= 0 && r.bases[1] < 0 && r.count![0] + r.count![1] >= 1) {
        stole = r.bases[0];
        return { steal: 'go' };
      }
      return {};
    });
    expect(changed).not.toBeNull();
    expect(counted).toBeGreaterThan(50);
    // 최근 장면 문구: A로 끝낸 타석마다 "N구, B-S에서 …"
    const paPlays = pv.plays.filter((p) => p.seq);
    expect(paPlays.length).toBeGreaterThan(50);
    for (const p of paPlays) expect(pitchNote(p)).toMatch(new RegExp(`^${p.seq!.length}구, [0-3]-[0-2]에서 `));
    const c = changed!;
    const at = pv.plays.findIndex((p) => p.kind === 'PC' && p.pit === c.pit);
    expect(at).toBeGreaterThanOrEqual(0);
    // 교체 뒤 첫 타석: 새 투수가 끝냈고, 공 기호는 교체 전 공부터 이어진다 (교체 때 카운트만큼 공이 앞에 있다)
    const pa = pv.plays.slice(at + 1).find((p) => p.seq !== undefined)!;
    expect(pa.pit).toBe(c.pit);
    expect(pa.seq!.length).toBeGreaterThan(c.count[0] + c.count[1]);
    if (stole !== null) expect(pv.plays.some((p) => (p.kind === 'SB' || p.kind === 'CS') && p.bat === stole)).toBe(true);
    g.commitCommand(pv.choices);
    expect(g.ourGames().at(-1)!.plays).toEqual(pv.plays);
    sameOnReplay(g);
  }, 300_000);

  it('항목을 고르면 그 일은 감독이 하지 않는다: 대타 없음·투수 계속이면 우리 쪽 대타·투수 교체가 없다', () => {
    const g = gameDay('cmd-own');
    const pv = play(g, 'next', (r) => {
      if (r.side === 'field') return { keep: true, walk: false, def: null, pitchout: false, infield: 'back' };
      if (r.step === 'run') return { steal: 'hold', pr: null };
      return { ph: -1, pr: null, tactic: 'swing' };
    });
    const ourTop = pv.away === lg;
    const ours = pv.plays.filter((p) => p.top === ourTop);
    const theirs = pv.plays.filter((p) => p.top !== ourTop);
    expect(ours.some((p) => p.kind === 'PH')).toBe(false);
    expect(ours.some((p) => p.kind === 'SB' || p.kind === 'CS' || p.kind === 'SAC')).toBe(false);
    // 우리 수비 반 이닝의 투수 교체는 다친 투수 때만 (경기 중 부상): 많아야 한 번
    expect(theirs.filter((p) => p.kind === 'PC').length).toBeLessThanOrEqual(1);
    expect(theirs.some((p) => p.kind === 'IBB')).toBe(false);
    g.commitCommand(pv.choices);
    sameOnReplay(g);
  }, 300_000);
});
