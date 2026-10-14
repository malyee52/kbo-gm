// 올스타전 (league/allstar.ts): 날짜, 양 팀 구성, 선발, 경기·MVP·홈런 더비, 시즌 기록과 분리, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { dateOf } from '../src/game/calendar';
import { allStarHistory, allStarSides } from '../src/league/allstar';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('올스타전', () => {
  it('7월 중순 휴식일, 2026년 드림·나눔은 실제 구성', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'as-1' }, FAST);
    const d = g.allStarDay;
    expect(g.season.schedule[d].length).toBe(0);
    expect(dateOf(2026, d).month).toBe(7);
    const [dream, nanum] = allStarSides(g.world).map((s) => s.map((t) => g.world.teams[t].name).sort());
    expect(dream).toEqual(['KT', 'SSG', '두산', '롯데', '삼성'].sort());
    expect(nanum).toEqual(['KIA', 'LG', 'NC', '키움', '한화'].sort());
    // 1982년(6구단, 80경기)도 시즌 안 휴식일
    const old = GameSession.create(store, { year: 1982, teamIdx: 0, seed: 'as-old' }, FAST);
    expect(old.allStarDay).toBeGreaterThan(0);
    expect(old.season.schedule[old.allStarDay].length).toBe(0);
  }, 120_000);

  it('그날 선발·경기·홈런 더비가 열리고, 정규시즌 기록은 그대로다. 저장 뒤 이어 해도 같다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 3, seed: 'as-2' }, FAST);
    const d = g.allStarDay;
    g.advance(d);
    expect(g.season.day).toBe(d);
    expect(g.allStarThisYear).toBeNull();
    const saved = roundTrip(g.toSave());
    const totals = roundTrip(g.season.totals);
    const hrBefore = g.season.bat.map((b) => b.hr);
    g.advance(1);
    const rec = g.allStarThisYear!;
    expect(rec).not.toBeNull();
    // 휴식일이라 정규시즌 경기는 없고, 올스타 경기 기록은 시즌에 섞이지 않는다
    expect(roundTrip(g.season.totals)).toEqual(totals);
    expect(g.season.bat.map((b) => b.hr)).toEqual(hrBefore);
    for (const side of [0, 1] as const) {
      const r = rec.roster.filter((x) => x.side === side);
      expect(r.filter((x) => x.starter && x.pos !== 'SP').length).toBe(9);
      expect(r.some((x) => x.starter && x.pos === 'C')).toBe(true);
      expect(r.filter((x) => x.pos === 'SP' || x.pos === 'RP').length).toBe(10);
      for (const x of r) expect(rec.teams[side]).toContain(x.team);
    }
    expect(new Set(rec.roster.map((x) => x.id)).size).toBe(rec.roster.length);
    const [a, b] = rec.game.score;
    expect(rec.game.mvp).not.toBeNull();
    if (a !== b) expect(rec.roster.find((x) => x.id === rec.game.mvp)!.side).toBe(a > b ? 0 : 1);
    expect(rec.derby.round1.length).toBe(8);
    expect(rec.derby.final.map((x) => x[0])).toContain(rec.derby.winner);
    expect(g.league.articles!.some((x) => x.kind === 'allstar' && x.year === 2026)).toBe(true);
    expect(allStarHistory(g.league, rec.game.mvp!).mvp).toEqual([2026]);
    // 저장 → 불러와 같은 날을 진행하면 같은 올스타전
    const h = GameSession.load(store, saved, FAST);
    h.advance(1);
    expect(roundTrip(h.allStarThisYear)).toEqual(roundTrip(rec));
    h.advance(10); g.advance(10);
    expect(roundTrip(h.toSave())).toEqual(roundTrip(g.toSave()));
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.allStarThisYear)).toEqual(roundTrip(rec));
  }, 300_000);
});
