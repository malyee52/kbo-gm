// 역사와 서사 1단계: 통산 기록 보존과 연표 (docs/roadmap.md 3장).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession, type GameSaveV2 } from '../src/game/session';
import { careerLeaders, careers, FAREWELL_DAYS, farewellWorthy, franchiseHistory, hallOfFame, LEGEND_SEASONS, legendCandidates, legendFill, realYearbook, seasonBests, yearbook } from '../src/league/history';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let g: GameSession;
let lg: number;

/** 오프시즌 단계를 자동으로 끝내고 개막 */
function finishOffseason(s: GameSession): void {
  let guard = 0;
  while (s.offseason!.stage !== 'ready' && guard++ < 40) {
    const st = s.offseason!.stage;
    if (st === 'draft') s.autoDraft(); if (st === 'comp') s.autoComp(); if (st === 'release') s.autoRelease();
    s.nextStage();
  }
  expect(s.openNextSeason().ok).toBe(true);
}

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  // 시드: 게임 안 시즌 홈런이 56개를 넘으면 첫 시험이 성립하지 않는다 (2026-10-22 구장 효과 때 history → history-2, 2026-10-24 병합 준비 때 데이비슨 69개로 → history-3)
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'history-3' }, FAST);
  g.advance(100000);
  g.beginOffseason();
  finishOffseason(g);
}, 300_000);

describe('연표', () => {
  it('시작 전 시즌은 자료의 최종 순위로: 2024 우승 KIA, 양대 리그 1999는 한화 우승·롯데 준우승', () => {
    const yb = realYearbook(store, 2026);
    expect(yb.find((y) => y.year === 2024)!.champion).toBe('KIA');
    expect(yb.find((y) => y.year === 1999)).toMatchObject({ champion: '한화', runnerUp: '롯데' });
    expect(yb.find((y) => y.year === 1982)!.champion).toBe('OB');
    expect(yb.some((y) => y.year >= 2026)).toBe(false);
  });

  it('게임 안 시즌은 결산 때 순위·우승·준우승이 남고, 저장했다 불러와도 같다', () => {
    const y = g.league.yearbook!.find((x) => x.year === 2026)!;
    expect(y.inGame).toBe(true);
    expect(y.teams).toHaveLength(10);
    expect(y.champion).toBeTruthy();
    expect(y.runnerUp).toBeTruthy();
    expect(y.champion).not.toBe(y.runnerUp);
    expect(yearbook(g.league, store).at(-1)!.year).toBe(2026);
    const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
    expect(h.league.yearbook).toEqual(g.league.yearbook);
  });
});

describe('통산 기록', () => {
  it('리그를 떠난 선수(은퇴·방출)의 게임 안 통산이 보관된다', () => {
    const arch = g.league.archive ?? [];
    expect(arch.length).toBeGreaterThan(0);
    for (const a of arch) {
      expect(g.league.players.some((p) => p.id === a.id)).toBe(false);
      expect(a.lastYear).toBe(2026);
      expect(a.bat || a.pit).toBeTruthy();
    }
    const retiredIds = new Set((g.league.retired ?? []).filter((r) => r.year === 2026).map((r) => r.id));
    expect(arch.filter((a) => retiredIds.has(a.id)).every((a) => a.why === 'retired')).toBe(true);
  });

  it('통산 = 시작 전 실제 기록 + 게임 안 기록 (현역 최정의 통산 홈런이 2025년까지 실제 홈런 + 2026 게임 안 홈런)', () => {
    const all = careers(g.league, store);
    const choi = [...all.values()].find((c) => c.name === '최정' && !c.isPitcher && c.active)!;
    expect(choi).toBeDefined();
    const realHr = store.meta.years.filter((y) => y < 2026).reduce((s, y) => s + (store.season(y)!.bat.find((r) => r.id === choi.id)?.hr ?? 0), 0);
    const p = g.league.players.find((x) => x.id === choi.id)!;
    const gameHr = p.history.reduce((s, h) => s + (h.bat?.[7] ?? 0), 0);
    expect(choi.bat.hr).toBe(realHr + gameHr);
    expect(choi.hasReal).toBe(true);
  });

  it('통산 순위: 홈런 1위는 홈런 수가 가장 많고, 은퇴한 실제 선수도 들어 있다', () => {
    const all = careers(g.league, store);
    const top = careerLeaders(all, 'hr', 20);
    expect(top).toHaveLength(20);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].v).toBeGreaterThanOrEqual(top[i].v);
    expect(top.some((x) => !x.c.active)).toBe(true);
  });
});

describe('단일 시즌 기록과 구단 역사', () => {
  it('시즌 최다 홈런 1위는 2003 이승엽 56개(실제), 게임 안 시즌 기록도 결산 때 들어온다', () => {
    const hr = seasonBests(g.league, store, 'hr', 10);
    expect(hr[0]).toMatchObject({ name: '이승엽', year: 2003, value: 56 });
    expect(g.league.seasonBests!.hr.every((e) => e.year === 2026)).toBe(true);
    expect(g.league.seasonBests!.hr.length).toBeGreaterThan(0);
    const era = seasonBests(g.league, store, 'era', 5);
    for (let i = 1; i < era.length; i++) expect(era[i - 1].value).toBeLessThanOrEqual(era[i].value);
  });

  it('구단 역사: 계보별 우승 횟수 (KIA 계보는 시작 전 12번 + 게임 안 우승)', () => {
    const fh = franchiseHistory(g.league, store);
    const kia = fh.find((f) => f.franchise === 'KIA')!;
    const gameTitles = (g.league.yearbook ?? []).filter((y) => y.teams.find((t) => t.name === y.champion)?.franchise === 'KIA').length;
    expect(kia.titles.filter((y) => y < 2026)).toHaveLength(12);
    expect(kia.titles.length).toBe(12 + gameTitles);
    expect(kia.name).toBe('KIA');
  });
});

describe('명예의 전당과 구단 레전드', () => {
  it('명예의 전당: 시작 전에 은퇴한 실제 명선수는 기록 기준으로 들어가고, 현역은 빠진다', () => {
    const hof = hallOfFame(g.league, careers(g.league, store));
    const names = new Set(hof.map((h) => h.c.name));
    for (const n of ['이승엽', '양준혁', '송진우']) expect(names.has(n), n).toBe(true);
    expect(hof.some((h) => h.c.name === '최정' && h.c.active)).toBe(false);
    expect(hof.find((h) => h.c.name === '이승엽')!.reasons).toContain('300홈런');
  });

  it('구단 레전드: 시즌 중에는 지정할 수 없고, 오프시즌에 후보(우리 구단 8시즌 이상, 은퇴)를 지정하면 관중률 보정이 생긴다', () => {
    const s = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'legend' }, FAST);
    const fr = s.team.franchise;
    const cand = legendCandidates(careers(s.league, store), fr);
    expect(cand.length).toBeGreaterThan(0);
    expect(cand.every((c) => !c.active && (c.franchiseSeasons[fr] ?? 0) >= LEGEND_SEASONS)).toBe(true);
    expect(s.designateLegend(cand[0].id).ok).toBe(false); // 시즌 중
    s.advance(100000);
    s.beginOffseason();
    expect(s.designateLegend('없는-선수').ok).toBe(false);
    expect(s.designateLegend(cand[0].id).ok).toBe(true);
    expect(s.designateLegend(cand[0].id).ok).toBe(false); // 이미 레전드
    expect(s.league.legends).toEqual([{ franchise: fr, id: cand[0].id, name: cand[0].name, year: 2027 }]);
    expect(legendFill(s.league, fr)).toBeCloseTo(0.01, 10);
  });

  it('은퇴식: 한 구단에서 10시즌 이상 뛴 프랜차이즈 스타가 은퇴하면 다음 시즌 개막 사흘 동안 그 구단 관중 효과가 생긴다', () => {
    const retired = (g.league.archive ?? []).filter((a) => a.why === 'retired' && a.lastYear === 2026);
    const all = careers(g.league, store);
    const long = retired.filter((a) => Object.keys(all.get(a.id)!.franchiseSeasons).some((f) => farewellWorthy(all.get(a.id)!, f)));
    const buffs = (g.league.events?.buffs ?? []).filter((b) => b.year === 2027 && b.note.endsWith('은퇴식'));
    expect(buffs.length).toBeGreaterThanOrEqual(long.length);
    for (const b of buffs) expect(b.until - b.from).toBe(FAREWELL_DAYS);
  });
});
