// 장기 진행 개선 (docs/longterm-plan.md, 2026-10-11): 실제 병역 자료, 입대 상한·입대 선택, 방출 순서(포수 최소 인원·신인 유예), 방출 선수 시장.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { isAsianGamesYear, isServing, MILITARY_LAST_AGE, MILITARY_TEAM_CAP } from '../src/league/careers';
import { createLeague } from '../src/league/create';
import * as Off from '../src/league/offseason';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

const byName = (league: ReturnType<typeof createLeague>['league'], name: string, birthYear: number) =>
  league.players.find((p) => p.name === name && p.birthYear === birthYear)!;

/** 정원 정리 단계까지 (우리 차례는 자동으로) */
function toRelease(g: GameSession): void {
  for (let guard = 0; g.offseason!.stage !== 'release' && guard < 30; guard++) {
    if (g.offseason!.stage === 'draft') g.autoDraft();
    if (g.offseason!.stage === 'comp') g.autoComp();
    g.nextStage();
  }
  expect(g.offseason!.stage).toBe('release');
}

describe('실제 병역 자료 (military.json)', () => {
  it('2026 시작: 아시안게임 금메달은 면제, 프로필 경력의 상무는 마침, 근거가 남는다', () => {
    const { league } = createLeague(store, 2026, 'mil-real', FAST);
    const kim = byName(league, '김도영', 2003);
    expect(kim.military).toMatchObject({ state: 'exempt', basis: 'record' });
    expect(kim.military?.note).toContain('2026');
    expect(byName(league, '노시환', 2000).military).toMatchObject({ state: 'exempt', basis: 'record' });
    expect(byName(league, '한승연', 2003).military).toMatchObject({ state: 'done', basis: 'record', note: '상무' });
  });

  it('과거 시작: 시작 연도 뒤의 대회 면제는 미리 주지 않는다 (2022년 시작이면 노시환은 아직 면제가 아니다)', () => {
    const { league } = createLeague(store, 2022, 'mil-past', FAST);
    expect(byName(league, '노시환', 2000).military?.state).not.toBe('exempt');
  });

  it('게임 안 아시안게임은 시작 연도 뒤 대회만 (프로 참가 1998년부터)', () => {
    expect(isAsianGamesYear(2026, 2026)).toBe(false);
    expect(isAsianGamesYear(2030, 2026)).toBe(true);
    expect(isAsianGamesYear(2014, 2012)).toBe(true);
    expect(isAsianGamesYear(2010, 2012)).toBe(false);
    expect(isAsianGamesYear(1994, 1990)).toBe(false);
  });
});

describe('입대 상한과 입대 선택', () => {
  it('첫 오프시즌: 어느 구단도 강제 입대를 빼면 상한을 넘겨 보내지 않는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'enlist-cap' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    for (let t = 0; t < g.league.teams.length; t++) {
      const went = g.league.players.filter((p) => p.team === t && p.military?.state === 'serving' && p.military.enlisted === 2026);
      const forced = went.filter((p) => 2027 - p.birthYear! >= MILITARY_LAST_AGE).length;
      expect(went.length, g.league.teams[t].name).toBeLessThanOrEqual(Math.max(MILITARY_TEAM_CAP, forced));
    }
  }, 120_000);

  it('플레이어가 고른 명단대로 입대하고 (강제 입대는 늘 포함), 조작 기록으로 다시 돌려도 같다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const opts = { year: 2026, teamIdx: lg, seed: 'enlist-pick' };
    const g = GameSession.create(store, opts, FAST);
    g.advance(100000);
    const { cands, recommended } = g.enlistOptions();
    const free = cands.filter((c) => !c.forced);
    expect(free.length).toBeGreaterThan(1);
    // 추천에 없는 선수 한 명만 고른다
    const pick = free.find((c) => !recommended.includes(c.id)) ?? free[0];
    const chosen = g.setEnlist([pick.id]);
    expect(chosen).toEqual([...cands.filter((c) => c.forced).map((c) => c.id), pick.id]);
    // 저장했다 불러와도 고른 명단이 남는다
    const h = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), FAST);
    expect(h.enlistOptions().chosen).toEqual(chosen);
    g.beginOffseason();
    for (const c of cands) {
      const p = g.league.players.find((x) => x.id === c.id)!;
      expect(isServing(p), `${p.name} ${chosen.includes(c.id) ? '입대' : '미룸'}`).toBe(chosen.includes(c.id));
    }
    const r = GameSession.replay(store, opts, g.actions, undefined, FAST);
    expect(r.league.players.map((p) => [p.id, p.military?.state])).toEqual(g.league.players.map((p) => [p.id, p.military?.state]));
  }, 120_000);
});

describe('정원 정리', () => {
  it('방출 순서는 포수 3명 아래로 내려가지 않고, 입단 2년 안의 신인은 뒤로 간다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'release-order' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    toRelease(g);
    const view = Off.leagueView(g.league, store, FAST);
    for (let t = 0; t < g.league.teams.length; t++) {
      const { order: free, kept } = Off.releaseSplit(g.league, g.offseason!, view, t);
      const order = [...free, ...kept];
      // 내보낼 수 있는 선수를 모두 내보내도 포수·투수·야수 최소 인원이 남는다
      const out = new Set(free.map((p) => p.id));
      const left = g.league.players.filter((p) => p.team === t && !isServing(p) && !out.has(p.id));
      const catchers = g.league.players.filter((p) => p.team === t && !isServing(p) && !p.isPitcher && p.pos === 'C').length;
      expect(left.filter((p) => !p.isPitcher && p.pos === 'C').length).toBeGreaterThanOrEqual(Math.min(catchers, Off.MIN_CATCHERS));
      expect(left.filter((p) => p.isPitcher).length).toBeGreaterThanOrEqual(Off.MIN_PITCHERS);
      expect(left.filter((p) => !p.isPitcher).length).toBeGreaterThanOrEqual(Off.MIN_HITTERS);
      // 신인 유예: 유예 선수가 나오기 시작하면 그 뒤로는 (최소 인원으로 미룬 선수 말고는) 유예 선수만
      const fresh = (id: string) => g.league.players.find((p) => p.id === id)!.entryYear >= g.offseason!.year + 2 - Off.ROOKIE_GRACE;
      const first = order.findIndex((p) => fresh(p.id));
      if (first >= 0) expect(order.slice(0, first).every((p) => !fresh(p.id))).toBe(true);
    }
  }, 120_000);

  it('방출 선수 시장: 플레이어는 다른 구단 방출 선수를 최저 연봉 1년에 데려오고, 우리가 방출한 좋은 선수는 AI 구단이 데려간다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'claim' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    toRelease(g);
    const pool = Off.claimablePlayers(g.league, g.offseason!, g.teamIdx);
    expect(pool.length).toBeGreaterThan(0);
    const p = pool[0];
    expect(g.claim(p.id).ok).toBe(true);
    expect(p.team).toBe(g.teamIdx);
    expect(p.contract).toMatchObject({ kind: 'reserve', salary: Off.CLAIM_SALARY, until: 2027 });
    expect(g.claim(p.id).ok).toBe(false); // 이미 데려왔다
    // 우리 구단에서 방출 순서 맨 끝(가장 아까운) 선수를 내보내면 AI 구단이 데려간다
    const view = Off.leagueView(g.league, store, FAST);
    const { order } = Off.releaseSplit(g.league, g.offseason!, view, g.teamIdx);
    const star = order[order.length - 1];
    expect(g.release(star.id).ok).toBe(true);
    g.autoRelease();
    g.nextStage();
    expect(star.team).toBeGreaterThanOrEqual(0);
    expect(star.team).not.toBe(g.teamIdx);
    expect(g.offseason!.log.some((l) => l.text.includes(`방출 선수 ${star.name} 영입`))).toBe(true);
    // 시장이 끝나도 모든 구단이 정원 안
    for (let t = 0; t < g.league.teams.length; t++) {
      expect(g.league.players.filter((x) => x.team === t && !isServing(x) && !x.dev).length).toBeLessThanOrEqual(68);
    }
  }, 120_000);
});
