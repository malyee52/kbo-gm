// 해외 진출과 복귀 (league/overseas.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import { cashOf } from '../src/league/finance';
import { ABROAD, returnDecision } from '../src/league/overseas';
import type { LeaguePlayer } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

function finishOffseason(g: GameSession): void {
  for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.openNextSeason().ok).toBe(true);
}

describe('시작 때 해외에 있던 선수', () => {
  it('2020 시작: 류현진·김광현은 해외(리그 명단에만, 시즌 월드에는 없다), 복귀 해는 기록대로', () => {
    const { league, world } = createLeague(store, 2020, 'ov', FAST);
    const kim = league.players.find((p) => p.name === '김광현' && p.birthYear === 1988)!;
    expect(kim.team).toBe(ABROAD);
    expect(kim.abroad).toMatchObject({ since: 2020, returnYear: 2022, mode: 'posting' });
    expect(league.teams[kim.abroad!.origin].franchise).toBe('SSG');
    expect(league.players.find((p) => p.name === '류현진' && p.birthYear === 1987)!.abroad?.returnYear).toBe(2024);
    expect(world.players.some((p) => p.id === kim.id)).toBe(false);
  });

  it('복귀 판단: 아는 복귀 해에 돌아오고, 모르면 나이에 따라 확률, 39세면 은퇴', () => {
    const p = { id: 'x', birthYear: 1990, abroad: { since: 2020, origin: 0, mode: 'posting', returnYear: 2023 } } as LeaguePlayer;
    expect(returnDecision({ seed: 's' }, p, 2022)).toBe('stay');
    expect(returnDecision({ seed: 's' }, p, 2023)).toBe('return');
    const q = { id: 'y', birthYear: 1990, abroad: { since: 2025, origin: 0, mode: 'fa' } } as LeaguePlayer;
    expect(returnDecision({ seed: 's' }, q, 2026)).toBe('stay'); // 떠난 지 2시즌 전
    expect(returnDecision({ seed: 's' }, q, 2029)).toBe('retire');
  });

  it('2016 시작 → 2017 오프시즌: 포스팅으로 간 박병호는 넥센으로 복귀, FA로 간 김현수는 보상 없는 FA로 시장에 나온다', () => {
    const nexen = store.season(2016)!.teams.findIndex((t) => t.name === '넥센');
    const g = GameSession.create(store, { year: 2016, teamIdx: nexen, seed: 'ov-2016' }, FAST);
    const park = g.league.players.find((p) => p.name === '박병호' && p.birthYear === 1986)!;
    const kim = g.league.players.find((p) => p.name === '김현수' && p.birthYear === 1988)!;
    expect(park.team).toBe(ABROAD);
    expect(kim.abroad?.mode).toBe('fa');
    g.advance(100000);
    g.beginOffseason();
    expect(park.team).toBe(ABROAD); // 2017에는 아직
    finishOffseason(g);
    g.advance(100000);
    g.beginOffseason(); // 2017 오프시즌 → 2018 복귀
    const p2 = g.league.players.find((p) => p.id === park.id)!;
    expect(p2.team).toBe(nexen);
    expect(p2.abroad).toBeUndefined();
    expect(p2.contract.until).toBeGreaterThanOrEqual(2019);
    const e = g.offseason!.fa.entries.find((x) => x.id === kim.id)!;
    expect(e).toMatchObject({ returnee: true, status: 'open' });
    expect(g.league.articles!.some((a) => a.kind === 'overseas' && a.title.includes('박병호'))).toBe(true);
  }, 400_000);
});

describe('포스팅 요청', () => {
  it('보내면 이적료를 받고 선수는 해외로, 정원 정리 단계 뒤에는 답할 수 없다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'ov-post' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const star = g.league.players.filter((p) => p.team === lg && !p.foreign).sort((a, b) => b.potential - a.potential)[0];
    (g.offseason!.postings ??= []).push({ id: star.id, fee: 800_000 });
    const before = cashOf(g.league, lg);
    expect(g.answerPosting(star.id, true).ok).toBe(true);
    expect(star.team).toBe(ABROAD);
    expect(star.abroad).toMatchObject({ origin: lg, mode: 'posting' });
    expect(cashOf(g.league, lg)).toBe(before + 800_000);
    expect(g.answerPosting(star.id, true).ok).toBe(false);
    expect(g.abroadPlayers().some((p) => p.id === star.id)).toBe(true);
    finishOffseason(g);
    expect(g.league.players.some((p) => p.id === star.id && p.team === ABROAD)).toBe(true); // 개막 뒤에도 리그 명단에 남는다
    expect(g.world.players.some((p) => p.id === star.id)).toBe(false);
  }, 300_000);
});
