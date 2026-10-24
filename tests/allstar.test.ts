// 올스타전 (league/allstar.ts): 날짜, 양 팀 구성, 선발, 경기·MVP·홈런 더비, 시즌 기록과 분리, 저장·재현
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { dateOf } from '../src/game/calendar';
import { allStarHistory, allStarSideNames, allStarSides, SIDE_NAMES } from '../src/league/allstar';
import { NO_STOPS } from '../src/game/stops';

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

  it('1999·2000 양대 리그 해는 드림 올스타 대 매직 올스타, 편 나눔이 그 해 리그 소속과 같다 (일정 개편 기획안 10.6, 결정 3)', () => {
    const name = (g: GameSession, ts: number[]) => ts.map((t) => g.world.teams[t].name).sort();
    // 2000: 삼성이 드림, 롯데가 매직으로 바뀐 해
    const g00 = GameSession.create(store, { year: 2000, teamIdx: 0, seed: 'as-2000' }, FAST);
    const d00 = g00.world.divisions!;
    expect(allStarSides(g00.world)).toEqual(d00.teams);
    expect(allStarSideNames(g00.world)).toEqual(['드림 올스타', '매직 올스타']);
    expect(name(g00, allStarSides(g00.world)[0])).toContain('삼성');
    expect(name(g00, allStarSides(g00.world)[1])).toContain('롯데');
    // 단일 리그 해는 예전 드림·나눔
    const g26 = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'as-2026' }, FAST);
    expect(allStarSideNames(g26.world)).toEqual(SIDE_NAMES);

    // 1999: 그날 경기를 치르면 기록에 편 이름이 남고, 명단은 리그 소속 구단에서만
    const g = GameSession.create(store, { year: 1999, teamIdx: 0, seed: 'as-1999' }, FAST);
    const d = g.world.divisions!;
    expect(allStarSides(g.world)).toEqual(d.teams);
    expect(name(g, d.teams[0])).toEqual(['두산', '롯데', '해태', '현대'].sort());
    expect(name(g, d.teams[1])).toEqual(['LG', '삼성', '쌍방울', '한화'].sort());
    const day = g.allStarDay;
    expect(day).toBeGreaterThan(0);
    while (g.season.day < day) g.advance(day - g.season.day, NO_STOPS);
    g.advance(1, NO_STOPS);
    const rec = g.allStarThisYear!;
    expect(rec).not.toBeNull();
    expect(rec.names).toEqual(['드림 올스타', '매직 올스타']);
    expect(rec.teams).toEqual(d.teams);
    for (const x of rec.roster) expect(d.teams[x.side]).toContain(x.team);
    const [a, b] = rec.game.score;
    const news = g.news.find((n) => n.text.startsWith('올스타전: '))!;
    expect(news.text.startsWith(a === b ? `올스타전: ${a}-${b} 무승부` : `올스타전: ${a > b ? '드림' : '매직'} 올스타 ${Math.max(a, b)}-${Math.min(a, b)} 승리`)).toBe(true);
    expect(g.league.articles!.find((x) => x.kind === 'allstar' && x.year === 1999)!.body.startsWith('드림 올스타와 매직 올스타가 맞붙은 1999 올스타전')).toBe(true);
  }, 300_000);
});
