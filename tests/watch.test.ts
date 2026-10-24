// UI 2단계 공통 기능 (2026-10-23): 관심 명단 (game/watch.ts, 결정 9), 다른 구단 보기 (ui/teamView.ts), 전체 검색 (ui/find.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { shortDate } from '../src/game/calendar';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { markTold, pruneUndrafted, watchNews, watchSignals, watchStatus, type WatchCtx, type WatchEntry, type WatchNewsCtx } from '../src/game/watch';
import * as Off from '../src/league/offseason';
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
    expect(save.watch).toMatchObject([{ id: a.id, name: a.name, year: 2026 }]);
    expect(save.watch![0].told).toContain(`trade:2026:${teamIdx(g, 'KT')}`); // 담을 때 이미 트레이드 가능 = 알리지 않음
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
      if (st === 'release') g.autoRelease();
      g.nextStage();
    }
    // 정원 정리에서 육성선수로 데려갔으면 남고, 아니면 개막 때 빠진다
    const signed = (g.league.players.find((p) => p.id === ghost.id)?.team ?? -1) >= 0;
    const open = g.openNextSeason();
    expect(open.ok, open.message).toBe(true);
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

// 관심 선수 소식 (2026-10-23 사용자 결정 "관심 명단 알림"): 소식함에 한 줄, 같은 일은 한 번, 그날 상태에서 계산 (난수·조작 기록 밖)
describe('관심 선수 소식', () => {
  const ctxOf = (g: GameSession, over: Partial<WatchNewsCtx> = {}): WatchNewsCtx => ({
    phase: 'season', league: roundTrip(g.league), worldPlayers: g.world.players.map((p) => ({ ...p })), offseason: null,
    year: 2026, userTeam: g.teamIdx, tradeOpen: true, deadline: { month: 7, date: 31 }, ...over,
  });

  it('신호: 트레이드 가능·시즌 중 방출·FA 신청과 계약·포스팅·방출 시장·지명·해외·은퇴', () => {
    const g = newGame('watch-sig');
    const kt = teamIdx(g, 'KT');
    const p = g.world.teams[kt].org.find((x) => !x.foreign)!;
    const f = g.world.teams[kt].org.find((x) => x.foreign)!;
    const keys = (c: WatchNewsCtx, id: string) => watchSignals(c, id, 'x').map((s) => s.key);
    // 시즌 중: 다른 구단 국내 선수만 트레이드 가능 (외국인·우리 선수·마감 뒤는 없음)
    expect(keys(ctxOf(g), p.id)).toEqual([`trade:2026:${kt}`]);
    expect(keys(ctxOf(g), f.id)).toEqual([]);
    expect(keys(ctxOf(g, { tradeOpen: false }), p.id)).toEqual([]);
    expect(keys(ctxOf(g, { userTeam: kt }), p.id)).toEqual([]);
    // 입단 첫해 트레이드 금지 선수
    const nt = ctxOf(g);
    nt.league.players.find((x) => x.id === p.id)!.noTradeYear = 2026;
    expect(keys(nt, p.id)).toEqual([]);
    // 시즌 중 방출 → 오프시즌 방출 선수 시장: 같은 열쇠라 한 번만 알린다
    const rel = ctxOf(g);
    const wp = rel.worldPlayers.find((x) => x.id === p.id)!;
    wp.teamIdx = -1;
    wp.formerTeam = kt;
    const relSig = watchSignals(rel, p.id, '김관심');
    expect(relSig.map((s) => s.key)).toEqual([`release:2026:${kt}`]);
    expect(relSig[0].text).toBe('관심 선수 김관심이 KT에서 방출돼 시장에 나왔습니다.');
    // 오프시즌: FA 신청·계약, 포스팅 요청, 방출 시장, 지명
    const off = ctxOf(g, { phase: 'offseason', tradeOpen: false });
    const lp = off.league.players.find((x) => x.id === p.id)!;
    off.offseason = {
      year: 2026, stage: 'fa', fa: { entries: [{ id: p.id, from: kt, grade: 'A', prevSalary: 1, ask: 1, years: 4, status: 'open' }] },
      postings: [{ id: p.id, fee: 1 }], released: [{ id: p.id, from: kt }], draft: { pool: [], picks: [{ team: 0, id: p.id, round: 1 }], pick: 1, order: [] },
    } as unknown as NonNullable<WatchNewsCtx['offseason']>;
    lp.team = -1;
    const offSig = watchSignals(off, p.id, '김관심');
    expect(offSig.map((s) => s.key).sort()).toEqual(['draft:2026', 'fa:2026', 'posting:2026', `release:2026:${kt}`].sort());
    expect(offSig.find((s) => s.kind === 'fa')!.text).toBe('관심 선수 김관심이 FA를 신청했습니다 (원 소속 KT).');
    lp.team = teamIdx(g, 'LG');
    off.offseason!.fa.entries[0].status = 'signed';
    expect(watchSignals(off, p.id, '김관심').find((s) => s.kind === 'fa-sign')!.text).toBe('관심 선수 김관심이 LG와 FA 계약했습니다.');
    // 해외 (포스팅)·은퇴
    lp.abroad = { since: 2027, origin: kt, mode: 'posting' };
    expect(watchSignals(off, p.id, '김관심').find((s) => s.kind === 'abroad')).toMatchObject({ key: 'abroad:2027', text: '관심 선수 김관심이 포스팅으로 해외 구단에 입단했습니다.' });
    off.league.players = off.league.players.filter((x) => x.id !== p.id);
    off.league.retired = [{ id: p.id, name: '김관심', real: true, year: 2026, age: 40, team: kt, reason: 'age' }];
    expect(watchSignals(off, p.id, '김관심')).toEqual([{ key: 'retired', kind: 'retired', text: '관심 선수 김관심이 은퇴했습니다.' }]);
  });

  it('담을 때의 상태는 알리지 않고, 새로 생긴 일만 한 번, 트레이드 가능 여럿은 한 줄로', () => {
    const g = newGame('watch-once');
    const kt = teamIdx(g, 'KT');
    const [a, b] = g.world.teams[kt].org.filter((x) => !x.foreign);
    const closed = ctxOf(g, { tradeOpen: false });
    // 마감 뒤에 담음 → 알린 것 없음. 트레이드가 열리면(다음 해 개막처럼) 두 사람을 한 줄로
    let watch: WatchEntry[] = [a, b].map((p) => markTold(closed, { id: p.id, name: p.name, year: 2026 }));
    expect(watch.every((w) => w.told!.length === 0)).toBe(true);
    const open = ctxOf(g);
    const r = watchNews(open, watch);
    expect(r.lines).toEqual([`관심 선수 2명을 트레이드로 데려올 수 있습니다 (마감 7월 31일): ${a.name}(KT), ${b.name}(KT).`]);
    watch = r.watch;
    expect(watchNews(open, watch).lines).toEqual([]); // 같은 일은 두 번 알리지 않는다
    // 열려 있을 때 담으면 알리지 않는다
    expect(watchNews(open, [markTold(open, { id: a.id, name: a.name, year: 2026 })]).lines).toEqual([]);
    // 지난해보다 오래된 열쇠는 지운다 (은퇴처럼 해가 없는 열쇠는 남김)
    const pruned = markTold(ctxOf(g, { year: 2028, tradeOpen: false }), { id: a.id, name: a.name, year: 2026, told: ['trade:2026:1', 'trade:2027:1', 'retired'] });
    expect(pruned.told).toEqual(['trade:2027:1', 'retired']);
  });

  it('2026 시즌 → 오프시즌 → 2027 개막: FA 신청·방출·개막 트레이드 가능을 한 번씩, 저장 뒤 이어 해도 같은 소식, 진행은 그대로', () => {
    const SEED = 'watch-news';
    let offReleased: { id: string; from: number }[] = [];
    const toOpening = (start: GameSession, mid?: (g: GameSession) => GameSession): GameSession => {
      let g = start;
      for (let k = 0; k < 30 && g.offseason!.stage !== 'ready'; k++) {
        const st = g.offseason!.stage;
        if (Off.blockedReason(g.league, g.offseason!)) {
          if (st === 'comp') g.autoComp();
          else if (st === 'draft') g.autoDraft();
          else g.autoRelease();
        }
        if (mid && st === 'comp') g = mid(g);
        expect(g.nextStage().ok).toBe(true);
      }
      offReleased = g.offseason!.released ?? [];
      expect(g.openNextSeason().ok).toBe(true);
      return g;
    };
    // 관심 명단 없이 한 번 돌려 FA 신청 선수·시즌 중 방출 선수를 찾는다 (같은 시드 = 같은 진행)
    const probe = newGame(SEED);
    probe.advance(100000);
    const released = probe.world.players.filter((p) => p.teamIdx < 0 && p.formerTeam !== undefined && p.formerTeam !== probe.teamIdx && !p.foreign);
    probe.beginOffseason();
    const fa = probe.offseason!.fa.entries.filter((e) => e.from !== probe.teamIdx && !e.returnee).slice(0, 3).map((e) => e.id);
    const probeEnd = toOpening(probe);
    expect(fa.length).toBe(3);
    // 오프시즌 정원 정리에서 AI 구단이 방출한 선수 (방출 선수 시장)
    const marketId = offReleased.find((r) => r.from !== probe.teamIdx && !fa.includes(r.id))?.id;
    expect(marketId).toBeDefined();

    const play = (withSaves: boolean) => {
      let g = newGame(SEED);
      g.advance(10);
      // 10일째 다른 구단에 있는 선수만 (그 뒤 방출될 선수 하나 포함)
      const rel = released.find((p) => g.world.players[p.idx].teamIdx >= 0);
      const ids = [...fa, marketId!, ...(rel ? [rel.id] : [])];
      for (const id of ids) g.toggleWatch(id, g.world.players.find((p) => p.id === id)!.name);
      expect(g.news.some((n) => n.kind === 'watch')).toBe(false); // 담을 때는 알리지 않음 (이미 트레이드 가능)
      g.advance(40);
      if (withSaves) g = GameSession.load(store, roundTrip(g.toSave()), FAST);
      g.advance(100000);
      g.beginOffseason();
      g = toOpening(g, withSaves ? (x) => GameSession.load(store, roundTrip(x.toSave()), FAST) : undefined);
      g.advance(3);
      return { g, rel };
    };
    const { g, rel } = play(true);
    const { g: h } = play(false);
    const watchLines = (x: GameSession) => x.news.filter((n) => n.kind === 'watch');
    // 저장 뒤 이어 해도, 같은 시드로 끊김 없이 해도 같은 소식·같은 관심 명단
    expect(watchLines(g)).toEqual(watchLines(h));
    expect(g.watch).toEqual(h.watch);
    // 관심 명단은 진행에 끼지 않는다: 소식(관심 선수 줄 빼고)·시즌·조작 기록이 관심 명단 없이 돌린 것과 같다
    probeEnd.advance(3);
    expect(g.news.filter((n) => n.kind !== 'watch')).toEqual(probeEnd.news);
    expect(g.season.toSave()).toEqual(probeEnd.season.toSave());
    expect(g.actions).toEqual(probeEnd.actions);

    const lines = watchLines(g);
    const nameOf = (id: string) => g.watch.find((w) => w.id === id)!.name;
    for (const id of fa) {
      const n = nameOf(id);
      const filed = lines.filter((l) => l.text.startsWith(`관심 선수 ${n}`) && l.text.includes('FA를 신청했습니다'));
      expect(filed, n).toHaveLength(1);
      expect(filed[0]).toMatchObject({ year: 2026, day: -1 });
    }
    const mName = nameOf(marketId!);
    // 시즌 중에 방출됐으면 그때, 아니면 오프시즌 방출 선수 시장에서 한 번만 (이 시드는 시즌 중 외국인 교체로 방출)
    expect(lines.filter((l) => l.text.startsWith(`관심 선수 ${mName}`) && l.text.includes('방출돼'))).toHaveLength(1);
    if (rel) {
      // 시즌 중 방출 + 오프시즌 방출 선수 시장 = 한 번만
      expect(lines.filter((l) => l.text.includes(rel.name) && l.text.includes('방출'))).toHaveLength(1);
    }
    // 2027 개막 날 트레이드 가능 한 줄 (다른 구단 국내 선수로 남은 관심 선수가 있으면)
    const tradable = g.watch.filter((w) => { const p = g.world.players.find((x) => x.id === w.id); return p && p.teamIdx >= 0 && p.teamIdx !== g.teamIdx && !p.foreign; });
    const opening = lines.filter((l) => l.year === 2027 && l.text.includes('트레이드로 데려올 수 있습니다'));
    expect(opening).toHaveLength(tradable.length ? 1 : 0);
    if (tradable.length) expect(opening[0].day).toBe(0);
    // 같은 줄이 두 번 나오지 않는다
    expect(new Set(lines.map((l) => `${l.year}/${l.text}`)).size).toBe(lines.length);
  }, 300_000);
});
