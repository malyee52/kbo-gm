// UI 2단계 공통 기능 (2026-10-23): 관심 명단 (game/watch.ts, 결정 9), 다른 구단 보기 (ui/teamView.ts), 전체 검색 (ui/find.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { shortDate } from '../src/game/calendar';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { pruneUndrafted, watchStatus, type WatchCtx } from '../src/game/watch';
import { findAll, parseQuery } from '../src/ui/find';
import { teamDeals, teamDepth, teamMoney, teamRows } from '../src/ui/teamView';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function newGame(seed: string) {
  const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  return GameSession.create(store, { year: 2026, teamIdx: lg, seed }, FAST);
}
const teamIdx = (g: GameSession, name: string) => g.world.teams.findIndex((t) => t.name === name);

beforeAll(() => {
  store = loadDataStore();
});

describe('관심 명단: 저장 파일에 담고 조작 기록에는 넣지 않는다', () => {
  it('담기·빼기, 저장·불러오기, 예전 저장(칸 없음)은 빈 목록', () => {
    const g = newGame('watch');
    g.advance(5);
    const kt = g.world.teams[teamIdx(g, 'KT')].org;
    const [a, b] = [kt[0], kt[1]];
    const actions = g.actions.length;
    expect(g.toggleWatch(a.id, a.name)).toBe(true);
    expect(g.toggleWatch(b.id, b.name)).toBe(true);
    expect(g.toggleWatch(b.id, b.name)).toBe(false);
    expect(g.isWatched(a.id)).toBe(true);
    expect(g.actions.length).toBe(actions); // 재현과 상관없음
    const save = roundTrip(g.toSave());
    expect(save.watch).toEqual([{ id: a.id, name: a.name, year: 2026 }]);
    const h = GameSession.load(store, save, FAST);
    expect(h.watch.map((w) => w.id)).toEqual([a.id]);
    expect(h.watchStatus(a.id)).toMatchObject({ kind: 'team', team: teamIdx(g, 'KT'), gray: false });
    // 예전 저장: 칸이 없으면 빈 목록. 빈 목록이면 저장에도 칸을 쓰지 않는다
    const old: GameSaveV2 = roundTrip(g.toSave());
    delete old.watch;
    const o = GameSession.load(store, old, FAST);
    expect(o.watch).toEqual([]);
    expect('watch' in o.toSave()).toBe(false);
    // 불러온 게임을 이어 돌려도 끊김 없이 돌린 것과 같다 (관심 명단은 진행에 끼지 않는다)
    const c = newGame('watch');
    c.advance(5);
    h.advance(3);
    c.advance(3);
    expect(h.season.toSave()).toEqual(c.season.toSave());
  });

  it('상태: 은퇴는 회색, 방출·해외는 상태로 남는다', () => {
    const g = newGame('watch-st');
    const base: WatchCtx = { phase: 'offseason', league: roundTrip(g.league), worldPlayers: [], offseason: null };
    const lp = base.league.players[0];
    base.league.retired = [{ id: 'gone-1', name: '은퇴 선수', real: true, year: 2026, age: 40, team: 0, reason: 'age' }];
    expect(watchStatus(base, 'gone-1')).toMatchObject({ kind: 'retired', text: '은퇴', gray: true });
    expect(watchStatus(base, 'nobody')).toMatchObject({ kind: 'gone', gray: true });
    lp.team = -1;
    expect(watchStatus(base, lp.id)).toMatchObject({ kind: 'released', text: '방출 · 미계약', gray: false });
    lp.freeAgent = { since: 2026, from: 0 };
    expect(watchStatus(base, lp.id).kind).toBe('unsigned');
    lp.abroad = { since: 2026 } as never;
    expect(watchStatus(base, lp.id)).toMatchObject({ kind: 'abroad', gray: false });
  });

  it('지명 후보 → 지명 안 됨 → 다음 개막 때 저절로 빠진다 (지명된 선수는 남는다)', () => {
    const g = newGame('watch-draft');
    g.advance(100000);
    g.beginOffseason();
    let guard = 0;
    while (g.offseason!.stage !== 'draft' && guard++ < 30) {
      if (g.offseason!.stage === 'comp') g.autoComp();
      g.nextStage();
    }
    const d = g.offseason!.draft!;
    const players = new Map(g.league.players.map((p) => [p.id, p]));
    const top = d.pool[0];
    g.toggleWatch(top, players.get(top)!.name);
    expect(g.watchStatus(top).kind).toBe('prospect');
    // 2027 입단은 실제 지명 선수만 풀에 있어(105명 < 110순번) 모두 지명된다. 가상 풀이 남는 해를 흉내 내려고
    // 지명 뒤 소속 없는 후보 하나를 풀에 남겨 둔다 (리그 상태에 소속 없는 선수로)
    g.autoDraft();
    expect(g.watchStatus(top).kind).toBe('team');
    const left0 = structuredClone(players.get(top)!);
    const ghost = { ...left0, id: 'ghost-prospect', name: '미지명 후보', team: -1 };
    g.league.players.push(ghost);
    g.offseason!.draft!.pool.push(ghost.id);
    g.toggleWatch(ghost.id, ghost.name);
    expect(g.watchStatus(ghost.id)).toMatchObject({ kind: 'undrafted', text: '지명 안 됨', gray: false });
    // 저장·불러오기 뒤에도 같은 상태
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    expect(h.watchStatus(ghost.id).kind).toBe('undrafted');
    while (g.offseason!.stage !== 'ready' && guard++ < 90) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft();
      if (st === 'comp') g.autoComp();
      g.nextStage();
    }
    // 정원 정리에서 육성선수로 데려갔으면 남고, 아니면 개막 때 빠진다
    const signed = (g.league.players.find((p) => p.id === ghost.id)?.team ?? -1) >= 0;
    expect(g.openNextSeason().ok).toBe(true);
    const left = new Set(g.watch.map((w) => w.id));
    expect(left.has(top)).toBe(true);
    expect(left.has(ghost.id)).toBe(signed);
  });

  it('pruneUndrafted: 지명 안 됨 + 소속 없음만 뺀다', () => {
    const w = [{ id: 'a', name: 'A', year: 1 }, { id: 'b', name: 'B', year: 1 }, { id: 'c', name: 'C', year: 1 }];
    const league = { players: [{ id: 'b', team: 3 }, { id: 'c', team: -1 }] } as never;
    expect(pruneUndrafted(w, new Set(['a', 'b']), league).map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('다른 구단 보기 (읽기 전용)', () => {
  it('명단·예상 기용·돈·거래를 읽어도 진행 결과가 같다', () => {
    const a = newGame('team-view');
    const b = newGame('team-view');
    a.advance(10);
    b.advance(10);
    const kt = teamIdx(a, 'KT');
    const rows = teamRows(a, kt);
    expect(rows.length).toBe(a.world.teams[kt].org.length);
    expect(rows.filter((r) => r.where === '1군').length).toBeGreaterThan(20);
    // 외국인은 트레이드 불가 표시
    for (const r of rows.filter((x) => x.lp?.foreign)) expect(r.block).toMatch(/외국인/);
    const depth = teamDepth(a, kt)!;
    expect(depth.starters).toHaveLength(9);
    expect(depth.starters.every((x) => x.p && x.p.teamIdx === kt)).toBe(true);
    expect(depth.rotation.length).toBeGreaterThanOrEqual(4);
    expect(teamMoney(a, kt).payroll).toBeGreaterThan(0);
    expect(Array.isArray(teamDeals(a, kt))).toBe(true);
    for (let t = 0; t < a.world.teams.length; t++) { teamRows(a, t); teamDepth(a, t); }
    a.advance(10);
    b.advance(10);
    expect(a.season.toSave()).toEqual(b.season.toSave());
  });
});

describe('전체 검색', () => {
  it('날짜·구단 낱말 나누기', () => {
    expect(parseQuery('6/14 LG')).toEqual({ date: { month: 6, date: 14 }, words: ['LG'] });
    expect(parseQuery('6월 14일')).toEqual({ date: { month: 6, date: 14 }, words: [] });
    expect(parseQuery('김현수')).toEqual({ date: null, words: ['김현수'] });
  });

  it('선수·구단·경기를 찾고, 구단 낱말은 이름 조건에서 빠진다', () => {
    const g = newGame('find');
    g.advance(20);
    const p = g.world.teams[teamIdx(g, 'KT')].org[0];
    const r = findAll(g, p.name);
    expect(r.hits.player.some((h) => h.idx === p.idx)).toBe(true);
    const t = findAll(g, 'KT');
    expect(t.hits.team.map((h) => h.team)).toEqual([teamIdx(g, 'KT')]);
    expect(t.hits.player).toHaveLength(0);
    expect(t.hits.game.length).toBeGreaterThan(0);
    const kt = teamIdx(g, 'KT');
    expect(t.hits.game.every((h) => { const x = g.season.log[h.game!]; return x.home === kt || x.away === kt; })).toBe(true);
    // 날짜 + 구단 = 그날 그 구단 경기
    const first = g.season.log.find((x) => x.home === kt || x.away === kt)!;
    const day = findAll(g, `${shortDate(g.world.year, first.day)} KT`);
    expect(day.hits.game.map((h) => g.season.log[h.game!].day)).toEqual([first.day]);
    // 이름 + 구단 = 그 구단 선수만
    const k = findAll(g, `${p.name.slice(0, 1)} KT`);
    expect(k.hits.player.every((h) => h.team === kt)).toBe(true);
  });
});
