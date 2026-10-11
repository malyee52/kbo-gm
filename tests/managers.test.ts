// 감독 (league/managers.ts, 2026-10-12): 실명 명단, 기록으로 본 운영 경향, 해임·선임.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { cashOf } from '../src/league/finance';
import {
  candidates, infoOf, MANAGER_BUYOUT, NEUTRAL_TACTICS, openManagers, realOpening, tacticsOf,
} from '../src/league/managers';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
const opts = (seed: string, year = 2026, team = lg) => ({ year, teamIdx: team, seed });

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
}, 120_000);

function nextSeason(g: GameSession): void {
  let guard = 0;
  while (g.offseason!.stage !== 'ready' && guard++ < 40) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.openNextSeason().ok).toBe(true);
}

describe('감독 자료', () => {
  it('1982~2026 모든 구단-시즌에 개막 감독이 있다', () => {
    for (const y of store.meta.years) {
      for (const t of store.season(y)!.teams) expect(realOpening(store, t.franchise, y), `${y} ${t.name}`).toBeTruthy();
    }
  });

  it('창단 구단의 퓨처스 시절은 1군 첫해 감독 (NC 2012 → 김경문), 자료가 끝난 해 뒤는 없음', () => {
    expect(realOpening(store, 'NC', 2012)).toBe('김경문');
    expect(realOpening(store, 'NC', 2010)).toBeNull();
    expect(realOpening(store, 'LG', 2027)).toBeNull();
  });

  it('운영 경향은 기록 배율에서 나오고 경기 배율은 좁은 범위, 자료 없는 사람은 중립', () => {
    const info = infoOf(store, '염경엽')!;
    expect(info.seasons).toBeGreaterThanOrEqual(9);
    const t = tacticsOf(info);
    for (const v of [t.steal, t.bunt]) expect(v).toBeGreaterThanOrEqual(0.7), expect(v).toBeLessThanOrEqual(1.4);
    expect(t.hook).toBeGreaterThanOrEqual(0.9);
    expect(t.hook).toBeLessThanOrEqual(1.1);
    expect(tacticsOf(undefined)).toEqual(NEUTRAL_TACTICS);
  });
});

describe('게임 속 감독', () => {
  it('2026 새 게임: 구단마다 실제 개막 감독, 맡기 시작한 해는 자료에서 (LG 염경엽 2023)', () => {
    const g = GameSession.create(store, opts('mgr-a'), FAST);
    const m = g.league.managers!;
    expect(m[lg]).toMatchObject({ name: '염경엽', since: 2023 });
    const names = m.map((x) => x!.name);
    expect(new Set(names).size).toBe(names.length);
    // 작전 배율이 팀 시즌에 걸린다
    expect(g.season.teamSeasons[lg].tactics).toEqual(tacticsOf(infoOf(store, '염경엽')));
  });

  it('과거 시작: 자료가 있는 해에는 AI 구단 감독이 실제대로 바뀐다 (2012 시작 → 2013 KIA 선동열 유지, 한화 김응용 취임)', () => {
    const teams = store.season(2012)!.teams;
    const kia = teams.findIndex((t) => t.franchise === 'KIA');
    const hanwha = teams.findIndex((t) => t.franchise === '한화');
    const g = GameSession.create(store, opts('mgr-b', 2012, kia), FAST);
    expect(g.league.managers![hanwha]!.name).toBe('한대화');
    g.advance(100000);
    g.beginOffseason();
    nextSeason(g);
    expect(g.year).toBe(2013);
    expect(g.league.managers![kia]!.name).toBe('선동열');
    expect(g.league.managers![hanwha]!.name).toBe('김응용');
    expect(g.news.some((n) => n.text.includes('김응용 감독 선임'))).toBe(true);
  }, 240_000);

  it('해임하면 위약금(남은 연봉의 절반)이 장부에 들고, 선임한 감독이 다음 시즌을 맡으며, 조작 기록으로 다시 돌려도 같다', () => {
    const g = GameSession.create(store, opts('mgr-c'), FAST);
    const before = g.league.managers![lg]!;
    g.advance(100000);
    g.beginOffseason();
    expect(g.hireManager('류중일').ok).toBe(false); // 자리가 차 있다
    const cash0 = cashOf(g.league, lg);
    expect(g.fireManager().ok).toBe(true);
    const buyout = Math.round(before.salary * (before.until - 2026) * MANAGER_BUYOUT);
    expect(cash0 - cashOf(g.league, lg)).toBe(buyout);
    const pool = candidates(g.league, store, 2027);
    expect(pool).not.toContain('이범호'); // 다른 구단에 있다
    const pick = pool.find((n) => n !== before.name)!;
    expect(g.hireManager(pick).ok).toBe(true);
    nextSeason(g);
    expect(g.league.managers![lg]).toMatchObject({ name: pick, since: 2027 });
    expect(g.season.teamSeasons[lg].tactics).toEqual(tacticsOf(infoOf(store, pick)));
    const rep = GameSession.replay(store, opts('mgr-c'), g.actions, undefined, FAST);
    expect(rep.league.managers).toEqual(g.league.managers);
  }, 240_000);

  it('해임하고 고르지 않으면 개막 때 첫 후보로 채운다', () => {
    const g = GameSession.create(store, opts('mgr-d'), FAST);
    g.advance(100000);
    g.beginOffseason();
    const fired = g.league.managers![lg]!.name;
    g.fireManager();
    nextSeason(g);
    const now = g.league.managers![lg]!;
    expect(now.name).not.toBe(fired);
    expect(now.since).toBe(2027);
  }, 240_000);

  it('자료가 끝난 뒤: 계약 만료 때 하위권이면 바꾸고, 가을야구 팀은 재계약한다. 같은 사람이 두 구단을 맡지 않는다', () => {
    const L = {
      year: 2030,
      teams: [{ name: 'A', franchise: 'X1' }, { name: 'B', franchise: 'X2' }, { name: 'C', franchise: 'X3' }],
      managers: [
        { name: '김태형', since: 2027, until: 2029, salary: 1 },
        { name: '이강철', since: 2027, until: 2029, salary: 1 },
        { name: '박진만', since: 2027, until: 2031, salary: 1 },
      ],
      ledger: [],
    } as unknown as LeagueState;
    const news = openManagers(L, store, -1, [0, 2, 1], 1);
    expect(L.managers![0]).toMatchObject({ name: '김태형', until: 2031 });
    expect(L.managers![1]!.name).not.toBe('이강철');
    expect(L.managers![2]!.name).toBe('박진만');
    expect(news.some((t) => t.includes('이강철 감독 퇴진'))).toBe(true);
    const names = L.managers!.map((m) => m!.name);
    expect(new Set(names).size).toBe(3);
  });
});

describe('작전 배율이 경기에 반영된다', () => {
  it('도루·번트 배율을 크게 하면 같은 시드에서 도루 시도·희생번트가 늘어난다', () => {
    const run = (k: number) => {
      const g = GameSession.create(store, opts('mgr-e'), FAST);
      for (const ts of g.season.teamSeasons) ts.tactics = { steal: k, bunt: k, hook: 1 };
      g.advance(40);
      return g.season.totals;
    };
    const a = run(0.7);
    const b = run(1.4);
    expect(b.sb + b.cs).toBeGreaterThan((a.sb + a.cs) * 1.3);
    expect(b.sac).toBeGreaterThan(a.sac * 1.3);
  }, 120_000);
});
