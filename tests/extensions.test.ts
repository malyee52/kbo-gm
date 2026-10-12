// 비FA 다년 계약 (league/offseason.ts extendByUser).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { cashOf } from '../src/league/finance';
import { EXT_BONUS_SHARE } from '../src/league/offseason';
import { faEligible } from '../src/league/salary';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let g: GameSession;
let lg: number;

beforeAll(() => {
  store = loadDataStore();
  lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
  g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'ext5' }, FAST);
  g.advance(100000);
  g.beginOffseason();
}, 300_000);

describe('비FA 다년 계약', () => {
  it('후보는 국내 보류·신인 계약 선수, 요구 연봉은 지금 연봉 이상', () => {
    const offers = g.extensionOffers();
    expect(offers.length).toBeGreaterThan(20);
    for (const o of offers) {
      expect(o.p.foreign).toBe(false);
      expect(['reserve', 'rookie']).toContain(o.p.contract.kind);
      for (const d of o.demands) expect(d.salary).toBeGreaterThanOrEqual(o.p.contract.salary);
    }
    // FA 시장에 나온 선수는 후보가 아니다
    const fa = new Set(g.offseason!.fa.entries.filter((e) => e.status === 'open').map((e) => e.id));
    expect(offers.some((o) => fa.has(o.p.id))).toBe(false);
  });

  it('맺으면 nonFA 계약(기간 동안 FA 아님), 계약금이 나가고, 연봉 협상에서 빠진다', () => {
    const o = [...g.extensionOffers()].sort((a, b) => b.p.potential - a.p.potential)[0];
    const d = o.demands.find((x) => x.years === 5)!;
    // 계약금을 낼 자금 (시즌 성적에 따라 자금이 모자랄 수 있다. 2026-10-13 엔트리 순환 뒤 이 시드는 10억 남짓이었다)
    g.league.ledger.push({ year: g.year + 1, from: -1, to: lg, amount: 500_000, note: '시험 자금', kind: 'event' });
    const before = cashOf(g.league, lg);
    expect(g.extend(o.p.id, 5).ok).toBe(true);
    const p = g.league.players.find((x) => x.id === o.p.id)!;
    expect(p.contract).toMatchObject({ kind: 'nonFA', salary: d.salary, until: 2031 });
    expect(before - cashOf(g.league, lg)).toBe(Math.round(d.salary * 5 * EXT_BONUS_SHARE));
    expect(faEligible(p, 2028)).toBe(false);
    expect(g.extend(o.p.id, 3).ok).toBe(false); // 이미 다년 계약
    expect(g.extend(g.extensionOffers()[0].p.id, 9).ok).toBe(false); // 기간 범위 밖
    // 연봉 협상 단계까지 가도 그 선수는 협상 목록에 없다
    for (let guard = 0; g.offseason!.stage !== 'salary' && guard < 20; guard++) {
      const st = g.offseason!.stage;
      if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp();
      g.nextStage();
    }
    expect(g.offseason!.salary!.demands[o.p.id]).toBeUndefined();
  }, 300_000);

  it('AI 구단도 FA가 가까운 주축과 다년 계약을 맺는다 (오프시즌 소식)', () => {
    const logs = g.offseason!.log.filter((l) => l.text.includes('비FA 다년 계약') && !l.mine);
    expect(logs.length).toBeGreaterThan(0);
  });
});
