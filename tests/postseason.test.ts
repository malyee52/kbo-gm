// 가을야구 직접 진행 (2026-10-08 사용자 요청): 한 경기씩 진행, 저장·재현, 결산 연결.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { currentSeries, resultOf, stillAlive } from '../src/league/postseason';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let lg: number;
const opts = () => ({ year: 2026, teamIdx: lg, seed: 'ps-play' });
let full: ReturnType<typeof resultOf>;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  // 기준: 정규시즌 뒤 가을야구를 끝까지 한 번에
  const g = GameSession.create(store, opts(), FAST);
  g.advance(100000);
  g.advancePostseason(10_000);
  full = resultOf(g.postseason!);
}, 120_000);

describe('가을야구 직접 진행', () => {
  it('정규시즌이 끝나면 대진이 정해지고, 한 경기씩 진행할 수 있다', () => {
    const g = GameSession.create(store, opts(), FAST);
    g.advance(100000);
    expect(g.postseasonRunning).toBe(true);
    expect(g.postseason!.seeds).toEqual(g.season.standings().slice(0, 5));
    expect(currentSeries(g.postseason!)!.round).toBe('wc');
    expect(g.advancePostseason(1)).toBe(1);
    expect(g.postseason!.series[0].games).toHaveLength(1);
    expect(g.postseason!.series[0].games[0].box!.home.batters).toHaveLength(9);
    expect(g.currentDay).toBeGreaterThan(g.season.schedule.length);
  });

  it('한 경기씩·시리즈 단위로 진행해도, 중간에 저장했다 불러와도 한 번에 치른 결과와 같다', () => {
    const g = GameSession.create(store, opts(), FAST);
    g.advance(100000);
    g.advancePostseason(2);
    g.advanceSeries();
    const save = roundTrip(g.toSave()) as GameSaveV2;
    const h = GameSession.load(store, save, FAST);
    while (h.postseasonRunning) h.advancePostseason(1);
    expect(resultOf(h.postseason!)).toEqual(full);
  });

  it('결산은 남은 경기를 끝내고 그 결과를 쓴다', () => {
    const g = GameSession.create(store, opts(), FAST);
    g.advance(100000);
    g.advancePostseason(3);
    g.beginOffseason();
    const ps = g.league.lastSeason!.postseason!;
    expect(ps.champion).toBe(full.champion);
    expect(ps.series.map((x) => [x.winsHigh, x.winsLow])).toEqual(full.series.map((x) => [x.winsHigh, x.winsLow]));
  });

  it('가을야구 중 엔트리 변경은 조작 기록으로 재현되고, 탈락하거나 진출하지 못한 구단은 바꿀 수 없다', () => {
    const g = GameSession.create(store, opts(), FAST);
    g.advance(100000);
    g.advancePostseason(1);
    const alive = stillAlive(g.postseason!, g.teamIdx);
    const reg = g.registered();
    const res = g.move(reg.find((p) => !p.isPitcher)!, false);
    if (alive) {
      expect(res.errors).toEqual([]);
      g.advancePostseason(10_000);
      const r = GameSession.replay(store, opts(), g.actions, undefined, FAST);
      r.advancePostseason(10_000);
      expect(resultOf(r.postseason!)).toEqual(resultOf(g.postseason!));
    } else {
      expect(res.errors.length).toBeGreaterThan(0);
    }
  });
});
