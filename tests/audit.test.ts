// 2차 전수조사(docs/qa-audit.md)에서 고친 것: C1 창단 해 오프시즌 구단 표시, M14 재현 정보, H6 외부 FA 영입 한도.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { MAX_FA_SIGNINGS } from '../src/league/offseason';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

/** 플레이어 결정을 모두 자동으로 해서 오프시즌을 끝내고 개막한다 */
function finishOffseason(g: GameSession): void {
  for (let guard = 0; g.offseason && g.offseason.stage !== 'ready' && guard < 50; guard++) {
    if (g.offseason.stage === 'draft') g.autoDraft();
    if (g.offseason.stage === 'comp') g.autoComp();
    if (g.offseason.stage === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.openNextSeason().ok).toBe(true);
}

describe('C1: 창단이 있는 해의 오프시즌에도 모든 구단 이름을 얻는다', () => {
  it('2012 시즌 뒤 월드는 8구단, 리그는 NC를 더해 9구단이고 teamInfo는 9구단 모두 답한다', () => {
    const g = GameSession.create(store, { year: 2012, teamIdx: 0, seed: 'audit-c1' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    // 버그의 조건: 화면이 읽던 월드에는 새 구단이 없다
    expect(g.world.teams.length).toBe(8);
    expect(g.league.teams.length).toBe(9);
    expect(g.world.teams[8]).toBeUndefined();
    for (let t = 0; t < g.league.teams.length; t++) expect(g.teamInfo(t).name, `구단 ${t}`).toBeTruthy();
    expect(g.teamInfo(8)).toEqual({ name: 'NC', franchise: 'NC' });
    // 기존 구단은 막 끝난 시즌 이름 그대로 (월드 우선)
    expect(g.teamInfo(0).name).toBe(g.world.teams[0].name);
    expect(() => g.teamInfo(9)).toThrow(/구단 색인/);

    // FA를 마감하면 NC가 계약하고(화면이 원 소속·영입 구단을 그린다), 드래프트 첫 순번도 NC다
    g.nextStage();
    while (g.offseason!.stage === 'fa') g.nextStage();
    const teamsShown = new Set<number>();
    for (const e of g.offseason!.fa.entries) {
      teamsShown.add(e.from);
      const p = g.league.players.find((x) => x.id === e.id)!;
      if (p.team >= 0) teamsShown.add(p.team);
    }
    expect([...teamsShown].some((t) => t >= g.world.teams.length)).toBe(true);
    for (const t of teamsShown) expect(g.teamInfo(t).name).toBeTruthy();
  }, 120_000);
});

describe('M14: 재현 정보는 처음 게임을 만든 조건을 담는다', () => {
  it('두 번째 시즌에도 시작 연도·게임 시드·처음 구단·난이도를 담고, 그대로 replay하면 같은 상태가 된다', () => {
    const opts = { year: 2026, teamIdx: 3, seed: 'audit-repro', difficulty: 'hard' as const };
    const g = GameSession.create(store, opts, FAST);
    g.advance(30);
    g.setEntry(null);
    g.advance(100000);
    g.beginOffseason();
    finishOffseason(g);
    g.advance(15);
    const sp = g.registered().filter((p) => p.isPitcher)[2];
    g.move(sp, false);
    g.advance(6);

    const r = g.reproInfo();
    expect(g.year).toBe(2027);
    expect(g.season.seed).not.toBe(opts.seed); // 예전 재현 정보는 이 시즌 시드를 담아 다른 게임이 됐다
    expect(r.opts).toEqual(opts);
    expect(r.at).toEqual({ year: 2027, day: g.day, phase: 'season' });
    expect(r.actions).toEqual(g.actions);

    const back = GameSession.replay(store, JSON.parse(JSON.stringify(r.opts)), JSON.parse(JSON.stringify(r.actions)), { year: r.at.year, day: r.at.day }, FAST);
    expect(back.year).toBe(2027);
    expect(back.day).toBe(g.day);
    expect(back.toSave().league).toEqual(g.toSave().league);
    expect(back.toSave().season).toEqual(g.toSave().season);
  }, 180_000);
});

describe('H6: 외부 FA 영입 한도는 플레이어에게도 지켜진다', () => {
  it('외부 FA 6명에게 요구액의 1.3배를 제시해도 한도만큼만 제시가 들어가고, 계약도 한도를 넘지 않는다', () => {
    const kiwoom = store.season(2026)!.teams.findIndex((t) => t.name === '키움');
    const g = GameSession.create(store, { year: 2026, teamIdx: kiwoom, seed: 'audit-fa' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    g.nextStage(); // FA 1라운드
    const off = g.offseason!;
    expect(off.stage).toBe('fa');
    const external = off.fa.entries.filter((e) => e.from !== kiwoom && e.status === 'open').sort((a, b) => a.ask - b.ask).slice(0, 6);
    expect(external.length).toBe(6);
    const results = external.map((e) => g.offerFa(e.id, Math.round(e.ask * 1.3), e.years));
    expect(results.filter((x) => x.ok).length).toBe(MAX_FA_SIGNINGS);
    expect(results.find((x) => !x.ok)!.message).toContain(`${MAX_FA_SIGNINGS}명까지`);

    // 거두면 자리가 다시 난다
    const first = external[0].id;
    g.withdrawFa(first);
    expect(g.offerFa(external[5].id, Math.round(external[5].ask * 1.3), external[5].years).ok).toBe(true);
    expect(g.offerFa(first, Math.round(external[0].ask * 1.3), external[0].years).ok).toBe(false);

    while (g.offseason!.stage === 'fa') g.nextStage();
    expect(g.offseason!.fa.signings[kiwoom]).toBeLessThanOrEqual(MAX_FA_SIGNINGS);
    for (let t = 0; t < g.league.teams.length; t++) expect(g.offseason!.fa.signings[t], `구단 ${t}`).toBeLessThanOrEqual(MAX_FA_SIGNINGS);
  }, 120_000);
});
