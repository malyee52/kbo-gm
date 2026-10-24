// 구장 특성 (league/stadium.ts, 2026-10-14): 신구장 펜스·돔을 골라 짓고(P6, 구장효과 기획안 6장), 완공 뒤 홈 경기 2루타·3루타·홈런에 곱해진다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, fenceParkEvents, fenceValid, Season, worldForYear, type EngineParams } from '../src/engine';
import { GameSession } from '../src/game/session';
import { DOME, FENCE_PRESETS, NEW_PARK, orderStadium, parkFactor, stadiumFill, stadiumYearEnd } from '../src/league/stadium';
import { createLeague } from '../src/league/create';
import { worldFromLeague } from '../src/league/world';

let store: DataStore;
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('구장 특성', () => {
  it('신구장: 펜스·돔을 골라 주문하면 착공 때 배율을 계산해 두고, 완공 뒤 그 배율·돔 관중 가산이 생긴다 (P6)', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'park-1' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    g.advance(100000);
    g.beginOffseason();
    const L = g.league;
    L.ledger.push({ year: 2027, from: -1, to: 0, amount: 5_000_000, note: '시험 자금', kind: 'other' });
    const fence = { l: 96, c: 121, r: 99, h: 30 };
    // 범위 밖·단위 밖 제원은 거절
    expect(g.orderStadium('new-0', { fence: { ...fence, l: 94 } })).toMatchObject({ ok: false, message: '고를 수 없는 펜스 제원입니다.' });
    expect(g.orderStadium('new-0', { fence: { ...fence, h: 32 } }).ok).toBe(false);
    expect(g.orderStadium('new-0', { fence: { ...fence, c: 121.5 } }).ok).toBe(false);
    const r = g.orderStadium('new-0', { fence, dome: true });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('좌 96 · 중 121 · 우 99m, 높이 3m');
    const p = L.stadiums![0].project!;
    expect(p).toMatchObject({ kind: 'new', fence, dome: true, cost: Math.round(NEW_PARK.options[0].cost * DOME.cost) });
    expect(p.hr).toBeUndefined();
    expect(p.park).toEqual(fenceParkEvents(fence, DEFAULT_PARAMS.park).ev);
    // 개장 전에는 실제 구장 효과 그대로 (신구장 홈런 배율 없음)
    expect(parkFactor(L.stadiums![1])).toEqual({ hr: 1, dome: false });
    expect(worldFromLeague(L, store, DEFAULT_PARAMS).teams[0].park?.hr ?? 1).toBe(1);
    // 저장 → 불러오기 뒤에도 같은 제원·배율
    const h = GameSession.load(store, roundTrip(g.toSave()), { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    expect(h.league.stadiums![0].project).toEqual(p);
    // 완공 (결산 정리)
    const news = stadiumYearEnd(L, p.open - 1, () => 0, 0);
    expect(news.some((x) => x.includes('좌 96 · 중 121 · 우 99m') && x.includes(`홈런 지수 ${Math.round(p.park!.hr * 100)}`))).toBe(true);
    expect(L.stadiums![0]).toMatchObject({ fence, park: p.park, dome: true, opened: p.open });
    expect(L.stadiums![0].hr).toBeUndefined();
    expect(stadiumFill(L.stadiums![0], p.open + 5)).toBeCloseTo(((L.stadiums![0].quality - 50) / 50) * 0.06 + DOME.fill, 5);
    expect(worldFromLeague(L, store, DEFAULT_PARAMS).teams[0].park).toEqual({ hr: 1, ev: p.park });
    expect(g.orderStadium('new-1', { size: 'huge' as never }).ok).toBe(false);
  }, 300_000);

  it('신구장 단순 규칙 (기획안 6.3, 결정 B): 가장 작은 구장 홈런 147 · 가장 큰 구장 70, 높이·좌우 규칙, 같은 제원 = 같은 배율', () => {
    const P = DEFAULT_PARAMS.park;
    const small = fenceParkEvents({ l: 95, c: 120, r: 95, h: 34 }, P);
    const big = fenceParkEvents({ l: 101, c: 125, r: 101, h: 34 }, P);
    expect(small.ev.hr).toBeCloseTo(1.47, 9);
    expect(big.ev.hr).toBeCloseTo(0.7, 9);
    expect(small.ev.d2).toBeCloseTo(0.86, 9);
    expect(big.ev.d2).toBeCloseTo(1.22, 9);
    expect(small.ev.s1).toBe(1);
    // 같은 거리면 높을수록 홈런 ↓, 2루타 ↑ (1m당 −4%·+3%)
    const lowW = fenceParkEvents({ l: 98, c: 122, r: 98, h: 30 }, P).ev;
    const highW = fenceParkEvents({ l: 98, c: 122, r: 98, h: 40 }, P).ev;
    expect(highW.hr / lowW.hr).toBeCloseTo(0.96, 9);
    expect(highW.d2 / lowW.d2).toBeCloseTo(1.03, 9);
    // 우측이 짧으면 좌타 홈런이 우타보다 많다 (1m당 2%, 상한 8%)
    const asym = fenceParkEvents({ l: 101, c: 122, r: 95, h: 30 }, P).ev;
    expect(asym.L!.hr / asym.hr).toBeCloseTo(1.08, 9);
    expect(asym.R!.hr / asym.hr).toBeCloseTo(0.92, 9);
    // 가장 작은 구장 + 낮은 펜스는 상·하한에 닿는다
    expect(fenceParkEvents({ l: 95, c: 120, r: 95, h: 25 }, P).edge.hr).toBe(true);
    expect(fenceParkEvents({ l: 98, c: 122, r: 98, h: 30 }, P)).toEqual(fenceParkEvents({ l: 98, c: 122, r: 98, h: 30 }, P));
    // 예시값 셋은 모두 고를 수 있는 제원
    for (const k of Object.keys(FENCE_PRESETS) as (keyof typeof FENCE_PRESETS)[]) expect(fenceValid(FENCE_PRESETS[k].fence, P)).toBe(true);
  });

  it('P6 전 조작 기록의 크기(size)는 예시값 제원으로 읽는다 (재현), AI 신구장은 예시값 "중립"', () => {
    const { league } = createLeague(store, 2026, 'park-size', { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    expect(orderStadium(league, 0, 2026, 'new-0', 10_000_000, { size: 'hitter' }).ok).toBe(true);
    expect(league.stadiums![0].project).toMatchObject({ fence: FENCE_PRESETS.hitter.fence, park: fenceParkEvents(FENCE_PRESETS.hitter.fence, DEFAULT_PARAMS.park).ev });
    // AI: 낡고 오래된 구장, 자금 넉넉
    const t = 1;
    Object.assign(league.stadiums![t], { quality: 21, opened: 1990 });
    stadiumYearEnd(league, 2026, () => 1e9, 0);
    expect(league.stadiums![t].project).toMatchObject({ kind: 'new', fence: FENCE_PRESETS.neutral.fence });
  }, 300_000);

  it('엔진: 홈 구장 홈런 배율이 크면 그 구장 경기에서 홈런이 늘어난다 (구장 효과 없는 월드와 비교)', () => {
    const hr = (park: number) => {
      let n = 0;
      for (const seed of ['pk-a', 'pk-b']) {
        const w = worldForYear(store, 2025);
        if (park !== 1) for (const t of w.teams.slice(0, 3)) t.park = { hr: park };
        const s = Season.start(w, NO_PILOT, seed);
        s.runToEnd();
        n += s.totals.hr;
      }
      return n;
    };
    const base = hr(1);
    const big = hr(2);
    // 세 구단 홈 경기(약 30%)에서 홈런 확률 두 배 → 리그 홈런 약 +25%
    expect(big / base).toBeGreaterThan(1.12);
  }, 300_000);
});
