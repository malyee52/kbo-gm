// 경기 중계 기록 (engine/game.ts Play, game/highlights.ts, 2026-10-12): 결과와 맞고, 결과를 바꾸지 않는다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { PLAYS_KEEP } from '../src/engine/season';
import { GameSession } from '../src/game/session';
import { highlights, lineScoreUpTo, playText } from '../src/game/highlights';
import { NO_STOPS } from '../src/game/stops';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

describe('중계 기록', () => {
  it('우리 경기마다 남고, 마지막 점수·이닝별 점수·아웃이 경기 결과와 맞는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'cast-a' }, FAST);
    g.advance(20, NO_STOPS);
    const games = g.ourGames();
    expect(games.length).toBeGreaterThan(10);
    for (const x of games) {
      expect(x.plays, x.key).toBeDefined();
      const plays = x.plays!;
      const last = plays[plays.length - 1];
      expect([last.away, last.home]).toEqual([x.awayRuns, x.homeRuns]);
      const ls = lineScoreUpTo(plays, plays.length);
      const box = x.box!.lineScore;
      expect(ls.away).toEqual(box.away);
      expect(ls.home).toEqual(box.home.map((v) => (v < 0 ? 0 : v)).slice(0, ls.home.length));
      // 반 이닝은 3아웃으로 끝난다 (끝내기·말 공격 없음 제외)
      const halves = new Map<string, number>();
      for (const p of plays) halves.set(`${p.inn}${p.top}`, p.outs);
      const lastKey = `${last.inn}${last.top}`;
      for (const [k, outs] of halves) if (k !== lastKey) expect(outs, `${x.key} ${k}`).toBe(3);
      for (const p of plays) expect(playText(p, (i) => g.world.players[i].name)).not.toContain('undefined');
    }
  }, 120_000);

  it('중계 기록을 남겨도 결과는 같다 (같은 시드에서 기록을 끈 시즌과 비교)', () => {
    const a = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'cast-b' }, FAST);
    const b = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'cast-b' }, FAST);
    b.season.boxTeams.clear();
    a.advance(10, NO_STOPS);
    b.advance(10, NO_STOPS);
    expect(a.season.plays.size).toBeGreaterThan(0);
    expect(b.season.plays.size).toBe(0);
    expect(a.season.log).toEqual(b.season.log);
  }, 120_000);

  it(`메모리에는 최근 ${PLAYS_KEEP}경기만 남는다`, () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'cast-c' }, FAST);
    g.advance(45, NO_STOPS);
    expect(g.season.plays.size).toBe(PLAYS_KEEP);
    const games = g.ourGames();
    expect(games.at(-1)!.plays).toBeDefined();
    expect(games[0].plays).toBeUndefined();
  }, 120_000);
});

describe('하이라이트', () => {
  const name = (i: number) => `선수${i}`;
  const P = (o: Partial<import('../src/engine').Play>) => ({ inn: 1, top: true, kind: 'GO', bat: 1, pit: 2, outs: 1, bases: [-1, -1, -1], away: 0, home: 0, runs: 0, ...o }) as import('../src/engine').Play;

  it('끝내기 > 역전 > 동점 > 홈런, 문구에 이닝과 점수', () => {
    const plays = [
      P({ inn: 2, top: true, kind: 'HR', runs: 1, away: 1 }),
      P({ inn: 5, top: false, kind: '2B', runs: 1, away: 1, home: 1 }),
      P({ inn: 9, top: false, kind: '1B', runs: 1, away: 1, home: 2, bat: 7 }),
    ];
    const hs = highlights(plays, name, 'home');
    expect(hs.map((m) => m.tag)).toEqual(['lead', 'tie', 'walkoff']);
    expect(hs[2].text).toBe('끝내기! 9회말 선수7 안타 (1점) 1:2');
    expect(playText(P({ kind: 'HR', runs: 4 }), name)).toBe('선수1 만루 홈런!');
  });
});
