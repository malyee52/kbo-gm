// 가을야구 개인 기록·시리즈 MVP (2026-10-12, league/postseason.ts)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { MVP_ROUNDS, postseasonLines, PS_BAT_KEYS } from '../src/league/postseason';

let store: DataStore;
let g: GameSession;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => {
  store = loadDataStore();
  g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'ps-stats' }, FAST);
  g.advance(100000);
  while (g.postseasonRunning) g.advancePostseason(1);
}, 300_000);

describe('가을야구 개인 기록·시리즈 MVP', () => {
  it('준플레이오프·플레이오프·한국시리즈에 MVP, 이긴 팀 선수 (와일드카드는 없다)', () => {
    for (const x of g.postseason!.series) {
      if (MVP_ROUNDS.includes(x.round)) {
        expect(x.mvp, x.round).toBeDefined();
        expect(x.mvp!.team).toBe(x.winner);
        expect(x.mvp!.line.length).toBeGreaterThan(5);
      } else expect(x.mvp).toBeUndefined();
    }
  });

  it('박스스코어 합계: 타자 안타 합 = 경기 박스스코어의 안타 합', () => {
    const games = g.postseason!.series.flatMap((x) => x.games);
    const lines = postseasonLines(games);
    const fromLines = [...lines.values()].reduce((s, l) => s + (l.bat?.h ?? 0), 0);
    const fromBox = games.reduce((s, x) => s + x.box!.home.batters.reduce((a, b) => a + b.h, 0) + x.box!.away.batters.reduce((a, b) => a + b.h, 0), 0);
    expect(fromLines).toBe(fromBox);
  });

  it('결산하면 선수의 그 시즌 줄에 가을야구 기록이, 시상 기록에 시리즈 MVP가 남는다', () => {
    const lines = postseasonLines(g.postseason!.series.flatMap((x) => x.games));
    const top = [...lines.values()].filter((l) => l.bat && !g.world.players[l.idx].isPitcher).sort((a, b) => b.bat!.h - a.bat!.h)[0];
    const id = g.world.players[top.idx].id;
    const ks = g.postseason!.series.find((x) => x.round === 'ks')!.mvp!;
    g.beginOffseason();
    const h = g.leaguePlayer(id)!.history.at(-1)!;
    expect(h.year).toBe(2026);
    expect(h.pbat![PS_BAT_KEYS.indexOf('h')]).toBe(top.bat!.h);
    const aw = g.league.awards!.find((a) => a.year === 2026)!;
    expect(aw.postseasonMvps!.find((m) => m.round === 'ks')!.id).toBe(ks.id);
    expect(g.league.lastSeason!.postseason!.series.find((x) => x.round === 'ks')!.mvp!.id).toBe(ks.id);
    expect((g.league.articles ?? []).some((a) => a.title.includes('한국시리즈 MVP'))).toBe(true);
  });
});
