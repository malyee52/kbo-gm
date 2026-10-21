// 장기 진행 개선 (docs/longterm-plan.md, 2026-10-11): 실제 병역 자료, 입대(2026-10-21 상무 정원·현역·보충역으로 바꿈)·입대 선택, 방출 순서(포수 최소 인원·신인 유예), 방출 선수 시장.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season } from '../src/engine';
import {
  activeMonths, isAsianGamesYear, isReserveGrade, isServing, militaryStep, reserveMonths, serviceEnd, UNIT_MAX_AGE, UNIT_TEAM_SHARE, unitQuota,
} from '../src/league/careers';
import { worldFromLeague } from '../src/league/world';
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

describe('입대: 군 야구단 정원 + 현역·보충역 (2026-10-21)', () => {
  it('복무 기간은 입대한 해의 실제 제도를 따르고, 전역 시점은 개막 뒤 일수로', () => {
    expect([1983, 1990, 2000, 2008, 2015, 2019, 2026].map(activeMonths)).toEqual([33, 30, 26, 24, 21, 20, 18]);
    expect([1990, 1999, 2004, 2010, 2026].map(reserveMonths)).toEqual([18, 28, 26, 24, 21]);
    // 2026 시즌 뒤 18개월 → 2028 6월, 24개월 → 2029 개막 전, 33개월 → 2029 9월
    expect(serviceEnd(2026, 18)).toEqual({ year: 2028, day: 69 });
    expect(serviceEnd(2026, 24)).toEqual({ year: 2029, day: 0 });
    expect(serviceEnd(2026, 33)).toEqual({ year: 2029, day: 160 });
    // 군 야구단: 1998년까지 프로 선수 없음, 1999 상무 5명, 경찰 2006~2018, 2019부터 상무만
    expect(unitQuota(1995)).toEqual({ sangmu: 0, police: 0 });
    expect(unitQuota(1999)).toEqual({ sangmu: 5, police: 0 });
    expect(unitQuota(2010).police).toBeGreaterThan(0);
    expect(unitQuota(2019).police).toBe(0);
  });

  it('첫 오프시즌: 군 야구단은 리그 정원·구단 상한 안에서, 28세는 지원하지 못하고, 나머지는 현역·보충역', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'enlist-cap' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const went = g.league.players.filter((p) => p.military?.state === 'serving' && p.military.enlisted === 2026);
    const unit = went.filter((p) => p.military!.kind === 'unit');
    const q = unitQuota(2027);
    expect(unit.length).toBeGreaterThan(0);
    expect(unit.length).toBeLessThanOrEqual(q.sangmu + q.police);
    const cap = Math.ceil((UNIT_TEAM_SHARE * (q.sangmu + q.police)) / g.league.teams.length);
    for (let t = 0; t < g.league.teams.length; t++) expect(unit.filter((p) => p.team === t).length, g.league.teams[t].name).toBeLessThanOrEqual(cap);
    for (const p of unit) {
      expect(2027 - p.birthYear!, p.name).toBeLessThanOrEqual(UNIT_MAX_AGE);
      expect(isReserveGrade(g.league.seed, p.id, 2027), p.name).toBe(false);
      expect(p.military!.note).toBe('상무');
      expect(p.military).toMatchObject({ returnYear: 2028, returnDay: 69 });
    }
    expect(went.some((p) => p.military!.kind === 'active')).toBe(true);
    for (const p of went.filter((x) => x.military!.kind === 'reserve')) expect(p.military).toMatchObject({ returnYear: 2028, returnDay: 160 });
    // 알림: 실존 선수도 복무 형태와 기간만
    expect(g.offseason!.log.some((l) => /입대 \(상무 18개월/.test(l.text))).toBe(true);
  }, 120_000);

  it('플레이어가 고른 명단·지원대로 입대하고 (강제 입대는 늘 포함), 저장·조작 기록으로 다시 돌려도 같다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const opts = { year: 2026, teamIdx: lg, seed: 'enlist-pick' };
    const g = GameSession.create(store, opts, FAST);
    g.advance(100000);
    const { cands, recommended } = g.enlistOptions();
    const free = cands.filter((c) => !c.forced);
    expect(free.length).toBeGreaterThan(1);
    // 추천에 없는 선수 한 명만 고르고, 지원할 수 있으면 현역으로 보낸다 (지원하지 않음)
    const pick = free.find((c) => !recommended.includes(c.id) && c.canApply) ?? free[0];
    const chosen = g.setEnlist([pick.id]);
    expect(chosen).toEqual([...cands.filter((c) => c.forced).map((c) => c.id), pick.id]);
    const apply = g.setApply([]);
    expect(apply).toEqual([]);
    const h = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), FAST);
    expect(h.enlistOptions().chosen).toEqual(chosen);
    expect(h.enlistOptions().apply).toEqual([]);
    g.beginOffseason();
    for (const c of cands) {
      const p = g.league.players.find((x) => x.id === c.id)!;
      expect(isServing(p), `${p.name} ${chosen.includes(c.id) ? '입대' : '미룸'}`).toBe(chosen.includes(c.id));
      if (chosen.includes(c.id)) expect(p.military!.kind, p.name).toBe(c.reserve ? 'reserve' : 'active');
    }
    const r = GameSession.replay(store, opts, g.actions, undefined, FAST);
    expect(r.league.players.map((p) => [p.id, p.military])).toEqual(g.league.players.map((p) => [p.id, p.military]));
  }, 120_000);

  it('방위병(1994년 입대까지)은 리그에 남아 홈경기에만 나오고, 1995년부터는 출전 금지로 리그 밖에서 복무한다', () => {
    const { league } = createLeague(store, 1990, 'bangwi', { ...DEFAULT_PARAMS, pilotSeasons: 0 });
    const p = league.players.filter((x) => !x.foreign && x.team >= 0 && !x.isPitcher)
      .sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id))[0];
    p.military = { state: 'homeOnly', kind: 'reserve', enlisted: 1989, returnYear: 1991, returnDay: 69 };
    const w = worldFromLeague(league, store);
    const sp = w.players.find((x) => x.id === p.id)!;
    expect(sp.homeOnlyUntil).toBe(Number.MAX_SAFE_INTEGER);
    const season = Season.start(w, { ...DEFAULT_PARAMS, rosterChurn: 0, pilotSeasons: 0 }, 'bangwi');
    let home = 0;
    let away = 0;
    for (let d = 0; d < 60 && !season.done; d++) {
      const day = season.day;
      const game = season.schedule[day].find((x) => x.home === sp.teamIdx || x.away === sp.teamIdx);
      season.simulateDay();
      if (!game) continue;
      const ts = season.teamSeasons[sp.teamIdx];
      const on = [...ts.hitters, ...ts.rotation, ...ts.bullpen].some((x) => x.idx === sp.idx);
      if (game.home === sp.teamIdx) home += on ? 1 : 0;
      else { away++; expect(on, `${day}일 원정`).toBe(false); }
    }
    expect(away).toBeGreaterThan(0);
    expect(home).toBeGreaterThan(0);
    // 1994 시즌 뒤: 1995년 출전 금지 → 리그 밖 복무로 바뀌고, 전역이 1995 시즌 중이면 그날부터 합류
    p.military = { state: 'homeOnly', kind: 'reserve', enlisted: 1993, returnYear: 1995, returnDay: 69 };
    militaryStep({ league, year: 1994, nextRuns: () => 0 }, () => {});
    expect(p.military).toMatchObject({ state: 'done' });
    expect(p.startAbsent).toBe(69);
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
