// 박스스코어로 만드는 경기 결과 정보 (2026-10-23 UI 2단계 U2-3): 투구 수·실책·장타·도루 합이 시즌 기록과 맞는지,
// 오늘의 선수·차전·지난 등판(휴식일·연투) 계산.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type BoxScore, type GameLog } from '../src/engine';
import { GameSession } from '../src/game/session';
import { lastOutings, meetingNumber, outingText, pitchDecision, playerOfGame, sideTotals } from '../src/game/boxscore';

let store: DataStore;
let g: GameSession;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'box-sum' }, FAST);
  g.advance(30, { event: false, tradeOffer: false, injury: false, cast: false });
}, 120_000);

describe('박스스코어 합 = 시즌 기록 (우리 구단)', () => {
  it('투수별 투구 수·홀드·블론 합이 PitLine과 같다', () => {
    const s = g.season;
    const me = g.teamIdx;
    const sum = new Map<number, { np: number; hld: number; bsv: number }>();
    let games = 0;
    s.log.forEach((x, i) => {
      if (x.home !== me && x.away !== me) return;
      games++;
      const side = x.home === me ? s.boxes.get(i)!.home : s.boxes.get(i)!.away;
      for (const p of side.pitchers) {
        const t = sum.get(p.idx) ?? { np: 0, hld: 0, bsv: 0 };
        t.np += p.np; t.hld += p.hld ?? 0; t.bsv += p.bsv ?? 0;
        sum.set(p.idx, t);
      }
    });
    expect(games).toBeGreaterThan(15);
    expect(sum.size).toBeGreaterThan(5);
    for (const [idx, t] of sum) {
      expect(t.np).toBe(s.pit[idx].np);
      expect(t.hld).toBe(s.pit[idx].hld);
      expect(t.bsv).toBe(s.pit[idx].bsv);
    }
  });
  it('우리 쪽 실책(E) 합 = 우리 선수 실책 합, 타자 2루타·3루타·도루 합 = BatLine', () => {
    const s = g.season;
    const me = g.teamIdx;
    let e = 0;
    const bat = new Map<number, { d: number; t: number; sb: number }>();
    s.log.forEach((x, i) => {
      if (x.home !== me && x.away !== me) return;
      const box = s.boxes.get(i)!;
      const side = x.home === me ? box.home : box.away;
      expect(side.e).toBeTypeOf('number');
      e += side.e!;
      for (const b of side.batters) {
        const t = bat.get(b.idx) ?? { d: 0, t: 0, sb: 0 };
        t.d += b.d!; t.t += b.t!; t.sb += b.sb!;
        bat.set(b.idx, t);
      }
    });
    const ours = g.team.org.map((p) => p.idx);
    expect(e).toBe(ours.reduce((a, i) => a + s.errors[i], 0));
    for (const [idx, t] of bat) {
      expect(t.d).toBe(s.bat[idx].d);
      expect(t.t).toBe(s.bat[idx].t);
      expect(t.sb).toBe(s.bat[idx].sb);
    }
  });
  it('선발 타자에는 그날 수비 자리가 있다 (C 1B … DH)', () => {
    const s = g.season;
    const i = s.log.findIndex((x) => x.home === g.teamIdx || x.away === g.teamIdx);
    const box = s.boxes.get(i)!;
    const starters = box.home.batters.filter((b) => !b.sub);
    expect(starters.every((b) => typeof b.pos === 'string')).toBe(true);
    expect(new Set(starters.map((b) => b.pos)).size).toBe(9);
  });
});

const side = (over: Partial<BoxScore['home']> = {}) => ({ batters: [], pitchers: [], ...over });
const pit = (idx: number, o: Partial<BoxScore['home']['pitchers'][number]> = {}) => ({ idx, outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, np: 0, ...o });
const bat = (idx: number, o: Partial<BoxScore['home']['batters'][number]> = {}) => ({ idx, ab: 4, r: 0, h: 0, rbi: 0, hr: 0, bb: 0, so: 0, ...o });
const log = (o: Partial<GameLog>): GameLog => ({ day: 0, home: 0, away: 1, homeRuns: 0, awayRuns: 0, innings: 9, win: null, loss: null, save: null, ...o });

describe('경기 결과 계산', () => {
  it('라인스코어 합계: 안타·볼넷은 타자 합, 실책이 없는 예전 박스스코어는 null', () => {
    expect(sideTotals(side({ batters: [bat(1, { h: 2, bb: 1 }), bat(2, { h: 1 })], e: 1 }))).toEqual({ h: 3, e: 1, b: 1 });
    expect(sideTotals(side()).e).toBeNull();
  });
  it('투수 결과: 승·패·세·홀·블', () => {
    const l = log({ win: 5, loss: 6, save: 7 });
    expect(pitchDecision(pit(5), l)).toBe('승');
    expect(pitchDecision(pit(7), l)).toBe('세');
    expect(pitchDecision(pit(8, { hld: 1 }), l)).toBe('홀');
    expect(pitchDecision(pit(5, { bsv: 1 }), l)).toBe('블승');
  });
  it('오늘의 선수는 이긴 팀에서 고른다', () => {
    const box: BoxScore = {
      lineScore: { away: [], home: [] },
      away: side({ batters: [bat(10, { h: 4, hr: 2, rbi: 5, r: 2 })], pitchers: [pit(11, { outs: 27, so: 10 })] }),
      home: side({ batters: [bat(20, { h: 1 })], pitchers: [pit(21, { outs: 18, so: 3, er: 1, h: 4 }), pit(22, { outs: 3, so: 2 })] }),
    };
    const pog = playerOfGame(log({ homeRuns: 3, awayRuns: 2, win: 21, save: 22 }), box)!;
    expect(pog.team).toBe(0);
    expect([20, 21, 22]).toContain(pog.idx);
    expect(playerOfGame(log({ homeRuns: 1, awayRuns: 5, win: 11 }), box)!.team).toBe(1);
  });
  it('차전: 두 팀이 만난 횟수 (홈·원정 상관없이)', () => {
    const l = [log({ home: 0, away: 1 }), log({ home: 2, away: 3 }), log({ home: 1, away: 0 }), log({ home: 0, away: 1 })];
    expect(meetingNumber(l, 0)).toBe(1);
    expect(meetingNumber(l, 2)).toBe(2);
    expect(meetingNumber(l, 3)).toBe(3);
    expect(meetingNumber(l, 1)).toBe(1);
  });
  it('지난 등판: 휴식일과 연투', () => {
    const box = (p: number[]): BoxScore => ({ lineScore: { away: [], home: [] }, home: side({ pitchers: p.map((i) => pit(i, { np: 20 + i, outs: 3 })) }), away: side() });
    const season = {
      log: [log({ day: 3 }), log({ day: 4 }), log({ day: 5 }), log({ day: 6, home: 2, away: 3 })],
      boxes: new Map([[0, box([1, 2])], [1, box([2])], [2, box([2, 3])]]),
    };
    const o = lastOutings(season, 0, 6);
    expect(o.get(1)).toMatchObject({ day: 3, rest: 2, streak: 1, start: true });
    expect(o.get(2)).toMatchObject({ day: 5, rest: 0, streak: 3, np: 22 });
    expect(o.get(3)).toMatchObject({ day: 5, rest: 0, streak: 1, start: false });
    expect(outingText(o.get(2)!, 2026)).toMatch(/22구 · 휴식 0일 · 3연투$/);
    expect(outingText(o.get(1)!, 2026)).toMatch(/21구 · 휴식 2일$/);
  });
});
