// 육성선수 (docs/roadmap.md 7.3): 정원 밖, 1군 불가, 5월 1일~7월 31일 정식 등록.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { activeOf, GameSession, type GameSaveV2 } from '../src/game/session';
import { dateOf } from '../src/game/calendar';
import { ensureEvents } from '../src/league/events';
import { DEV_LIMIT, DEV_MAX_AGE } from '../src/league/offseason';
import { ORG_LIMIT } from '../src/league/salary';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let g: GameSession;
let lg: number;
let devId: string;
let signedId: string;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'dev' }, FAST);
  g.advance(100000);
  g.beginOffseason();
  let guard = 0;
  while (g.offseason!.stage !== 'release' && guard++ < 30) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp();
    g.nextStage();
  }
}, 300_000);

describe('오프시즌', () => {
  it('정원 정리: 어린 선수를 육성선수로 돌리면 정원에서 빠지고, 미지명 신인을 육성선수로 데려올 수 있다', () => {
    const L = g.league;
    const regular = () => L.players.filter((p) => p.team === lg && !p.dev && p.military?.state !== 'serving').length;
    const before = regular();
    const young = L.players.find((p) => p.team === lg && !p.foreign && !p.dev && p.birthYear && 2027 - p.birthYear <= DEV_MAX_AGE && p.contract.kind !== 'fa')!;
    expect(g.toDev(young.id).ok).toBe(true);
    expect(young.dev).toBe(true);
    expect(regular()).toBe(before - 1);
    devId = young.id;
    const old = L.players.find((p) => p.team === lg && !p.foreign && !p.dev && p.birthYear && 2027 - p.birthYear > DEV_MAX_AGE)!;
    expect(g.toDev(old.id).ok).toBe(false);
    const pool = g.devPool();
    expect(pool.length).toBeGreaterThan(0);
    expect(g.signDev(pool[0].id).ok).toBe(true);
    signedId = pool[0].id;
    expect(L.players.find((p) => p.id === signedId)).toMatchObject({ team: lg, dev: true });
  });

  it('단계를 마치면 AI 구단도 육성선수를 두고, 모든 구단 정식 선수는 정원 안, 육성선수는 상한 안', () => {
    g.autoRelease();
    g.nextStage();
    expect(g.offseason!.stage).toBe('ready');
    const L = g.league;
    const aiDevs = L.players.filter((p) => p.dev && p.team >= 0 && p.team !== lg).length;
    expect(aiDevs).toBeGreaterThan(10);
    for (let t = 0; t < L.teams.length; t++) {
      const mine = L.players.filter((p) => p.team === t && p.military?.state !== 'serving');
      expect(mine.filter((p) => !p.dev).length, `구단 ${t}`).toBeLessThanOrEqual(ORG_LIMIT);
      expect(mine.filter((p) => p.dev).length).toBeLessThanOrEqual(DEV_LIMIT);
    }
    expect(g.openNextSeason().ok).toBe(true);
  });
});

describe('시즌 중', () => {
  it('육성선수는 1군에 못 나가고, 5월 전에는 정식 등록이 안 되며, 5월 1일부터 등록하면 1군에 올릴 수 있다', () => {
    const dev = g.world.players.find((p) => p.id === devId)!;
    expect(dev.dev).toBe(true);
    expect(g.move(dev, true).errors.join()).toContain('육성선수');
    expect(g.convertBlock(dev)).toContain('5월 1일');
    // 한 달 동안 어떤 구단 1군에도 육성선수가 없다
    for (let i = 0; i < 30; i++) {
      ensureEvents(g.league).chance = 0;
      g.advance(1);
      for (const ts of g.season.teamSeasons) for (const p of activeOf(ts)) expect(p.dev, p.name).toBeFalsy();
    }
    while (dateOf(2027, g.day).month < 5) { ensureEvents(g.league).chance = 0; g.advance(1); }
    const before = g.regularCount();
    const r = g.convertDev(dev);
    expect(r.ok, r.message).toBe(before < ORG_LIMIT);
    if (r.ok) {
      expect(g.regularCount()).toBe(before + 1);
      expect(g.league.players.find((p) => p.id === devId)!.dev).toBe(false);
      expect(g.move(dev, true).errors.join()).not.toContain('육성선수');
      const h = GameSession.load(store, roundTrip(g.toSave()) as GameSaveV2, FAST);
      expect(h.world.players.find((p) => p.id === devId)!.dev).toBeFalsy();
    }
  }, 300_000);
});
