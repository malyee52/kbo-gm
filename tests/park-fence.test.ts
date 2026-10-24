// 펜스 조정 공사·가벽·실제 미래 구장 (league/stadium.ts·engine/park.ts, 구장효과 기획안 6.7·6.8·4.5, P6b·P6c·P7)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import type { ParkData, ParkEvents } from '../src/data/types';
import { applyDiff, DEFAULT_PARAMS, fenceBaseOf, fenceParkEvents, fenceSpecOf, gameParkOf, guessLogs, type ParkSource } from '../src/engine';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import {
  FENCE_PRESETS, FENCE_WORK, fenceWorkCost, fenceWorkState, openWalls, orderStadium, stadiumOptions, stadiumYearEnd, teamParkInfo, WALL, type StadiumState,
} from '../src/league/stadium';
import { wageIndex } from '../src/league/salary';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
let src: ParkSource;
let base: LeagueState;
const PP = DEFAULT_PARAMS.park;
const P = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const LG = { rates: { s1: 0.15, d2: 0.045, t3: 0.004, hr: 0.025 }, rpa: 0.12 };
const copy = () => JSON.parse(JSON.stringify(base)) as LeagueState;
const idx = (L: LeagueState, fr: string) => L.teams.findIndex((t) => t.franchise === fr);
const park = (L: LeagueState, t: number, year: number, s: ParkSource = src) =>
  teamParkInfo(s, L.teams[t].franchise, year, L.stadiums![t], L.teams.map((x) => x.franchise), LG);
const hr = (L: LeagueState, t: number, year: number) => gameParkOf(park(L, t, year).park, PP).hr;
const close = (a: ParkEvents | undefined, b: ParkEvents | undefined) => {
  for (const k of ['s1', 'd2', 't3', 'hr'] as const) expect(a![k]).toBeCloseTo(b![k], 9);
  for (const side of ['L', 'R'] as const) if (b![side]) for (const k of ['s1', 'd2', 't3', 'hr'] as const) expect(a![side]![k]).toBeCloseTo(b![side]![k], 9);
};

beforeAll(() => {
  store = loadDataStore();
  src = { parkFactors: store.meta.parkFactors, parkEvents: store.meta.parkEvents, parks: store.parks };
  base = createLeague(store, 2026, 'fence', P).league;
}, 300_000);

describe('펜스 조정 공사 (6.7, P6b)', () => {
  it('혼자 쓰는 실제 구장: 차이 방식으로 계산해 저장하고, 다음 시즌부터 그 구단 홈 경기에 쓴다', () => {
    const L = copy();
    const nc = idx(L, 'NC');
    const st = fenceWorkState(L, nc, 2026, src);
    expect(st.kind).toBe('fence');
    expect(st.now).toEqual({ l: 101, c: 122, r: 101, h: 33 });
    expect(stadiumOptions(1, st).map((o) => o.id)).toEqual(['remodel', 'new-0', 'new-1', 'fence']);
    const before = hr(L, nc, 2027);
    const fence = { l: 99, c: 120, r: 99, h: 33 };
    const r = orderStadium(L, nc, 2026, 'fence', 1e9, { fence }, src);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('좌 101 → 99m · 중 122 → 120m · 우 101 → 99m · 높이 3.3m 그대로');
    const s = L.stadiums![nc];
    // 차이 방식: 조정 전 값(실측 기간 평균) × (새 제원 짐작 ÷ 원래 제원 짐작)
    const b = fenceBaseOf(src, 'NC', 2027, FENCE_PRESETS.neutral.fence, PP);
    const want = applyDiff(b.base, guessLogs(fenceSpecOf(fence, b.row, PP), PP)!, b.ref, PP);
    close(s.park, want);
    expect(s).toMatchObject({ fence, fenceFrom: 2027 });
    // 공사비는 다음 시즌(2027) 연봉 상승 지수만큼 오른다 (리모델링·신구장과 같은 규칙, 2026-10-24 클사장 결정)
    const cost = Math.round(FENCE_WORK.cost * wageIndex(2027, L));
    expect(cost).toBeGreaterThan(FENCE_WORK.cost);
    expect(s.done!.at(-1)).toMatchObject({ kind: 'fence', open: 2027, cost, fence });
    expect(L.ledger.at(-1)).toMatchObject({ year: 2027, from: nc, amount: cost, kind: 'stadium' });
    expect(r.message).toContain('구단 부담 31.5억 원'); // 30억 × 2027 지수 1.05
    // 조정 전 시즌(2026)은 그대로, 2027부터 조정 값 (펜스를 당겼으니 홈런이 는다)
    expect(park(L, nc, 2026)).toEqual(park(base, nc, 2026));
    expect(park(L, nc, 2027)).toMatchObject({ basis: 'fence', park: { hr: 1, ev: s.park } });
    expect(hr(L, nc, 2027)).toBeGreaterThan(before);
    // 다른 구단은 그대로 (평균 1 맞춤에 넣지 않는다)
    for (let t = 0; t < L.teams.length; t++) if (t !== nc) expect(park(L, t, 2027)).toEqual(park(base, t, 2027));
    // 간격: 2027 시즌부터 새 펜스 → 2031 시즌 뒤에 다시
    expect(orderStadium(L, nc, 2027, 'fence', 1e9, { fence: { ...fence, l: 98 } }, src)).toEqual({ ok: false, message: '펜스는 5시즌마다 바꿀 수 있습니다. 다음은 2031 시즌 뒤입니다.' });
    expect(orderStadium(L, nc, 2030, 'fence', 1e9, { fence: { ...fence, l: 98 } }, src).ok).toBe(false);
    // 원래 펜스로 되돌리면 실측 값(실측 기간 평균)으로 정확히 돌아간다
    expect(orderStadium(L, nc, 2031, 'fence', 1e9, { fence: { l: 101, c: 122, r: 101, h: 33 } }, src).ok).toBe(true);
    close(park(L, nc, 2032).park!.ev, b.base);
    // 다섯 해 뒤 공사비는 그 해(2032) 지수
    expect(L.ledger.at(-1)).toMatchObject({ year: 2032, from: nc, amount: Math.round(FENCE_WORK.cost * wageIndex(2032, L)) });
  });

  it('펜스 조정·가벽 비용은 리모델링·신구장처럼 연봉 상승 지수만큼 오른다 (2026-10-24 클사장 결정)', () => {
    expect([fenceWorkCost('fence'), fenceWorkCost('wall'), fenceWorkCost('wall-yearly')]).toEqual([FENCE_WORK.cost, WALL.install, WALL.yearly]);
    expect([fenceWorkCost('fence', 1.2), fenceWorkCost('wall', 1.2), fenceWorkCost('wall-yearly', 1.2)]).toEqual([360_000, 120_000, 48_000]);
    const cost = (wage: number) => Object.fromEntries(stadiumOptions(wage).map((o) => [o.id, o.cost]));
    const a = cost(1), b = cost(1.2);
    for (const id of ['remodel', 'new-0', 'fence', 'wall']) expect(b[id]).toBe(Math.round(a[id] * 1.2));
    expect(b['wall-off']).toBe(0);
  });

  it('거절: 범위·단위 밖, 바뀌는 칸 없음, 자금, 함께 쓰는 구장, 신구장 공사 중', () => {
    const L = copy();
    const nc = idx(L, 'NC');
    const lg = idx(L, 'LG');
    const now = { l: 101, c: 122, r: 101, h: 33 };
    expect(orderStadium(L, nc, 2026, 'fence', 1e9, { fence: { ...now, l: 94 } }, src).message).toBe('고를 수 없는 펜스 제원입니다.');
    expect(orderStadium(L, nc, 2026, 'fence', 1e9, { fence: { ...now, h: 32 } }, src).message).toBe('고를 수 없는 펜스 제원입니다.');
    expect(orderStadium(L, nc, 2026, 'fence', 1e9, { fence: now }, src).message).toBe('바뀌는 펜스가 없습니다.');
    expect(orderStadium(L, nc, 2026, 'fence', 100_000, { fence: { ...now, c: 120 } }, src).message).toBe('자금이 모자랍니다. 31.5억 원은 있어야 합니다.');
    expect(orderStadium(L, lg, 2026, 'fence', 1e9, { fence: { l: 99, c: 122, r: 99, h: 30 } }, src).message).toBe('함께 쓰는 구장은 펜스 대신 가벽을 세웁니다.');
    // 그대로 둔 칸은 범위 밖 값도 된다 (사직 95.8m · 6m, 중앙만 당김)
    const lt = idx(L, '롯데');
    expect(fenceWorkState(L, lt, 2026, src).now).toEqual({ l: 95.8, c: 121, r: 95.8, h: 60 });
    expect(orderStadium(L, lt, 2026, 'fence', 1e9, { fence: { l: 95.8, c: 120, r: 95.8, h: 60 } }, src).ok).toBe(true);
    // 신구장 공사가 잡혀 있으면 못 하고, 리모델링과는 같은 오프시즌에 할 수 있다
    expect(orderStadium(L, nc, 2026, 'new-0', 1e9, {}, src).ok).toBe(true);
    expect(orderStadium(L, nc, 2026, 'fence', 1e9, { fence: { ...now, c: 120 } }, src).message).toBe('신구장 공사 중에는 지금 구장의 펜스를 바꿀 수 없습니다.');
    const kt = idx(L, 'KT');
    expect(orderStadium(L, kt, 2026, 'remodel', 1e9, {}, src).ok).toBe(true);
    expect(orderStadium(L, kt, 2026, 'fence', 1e9, { fence: { l: 98, c: 121, r: 98, h: 34 } }, src).ok).toBe(true);
  });

  it('게임 안 신구장의 펜스 조정은 새 제원으로 다시 계산하고, 개장 시즌 값은 남는다. 개장도 간격에 센다', () => {
    const L = copy();
    const t = 0;
    const first = { l: 98, c: 122, r: 98, h: 30 };
    expect(orderStadium(L, t, 2026, 'new-0', 1e9, { fence: first }, src).ok).toBe(true);
    const open = L.stadiums![t].project!.open;
    stadiumYearEnd(L, open - 1, () => 0, t);
    expect(fenceWorkState(L, t, open, src)).toMatchObject({ kind: 'fence', now: first, next: open + 5 });
    expect(orderStadium(L, t, open + 3, 'fence', 1e9, { fence: { ...first, l: 95 } }, src).ok).toBe(false);
    const next = { ...first, l: 95, r: 95 };
    expect(orderStadium(L, t, open + 4, 'fence', 1e9, { fence: next }, src).ok).toBe(true);
    expect(park(L, t, open + 5)).toEqual({ park: { hr: 1, ev: fenceParkEvents(next, PP).ev }, basis: 'fence' });
    expect(park(L, t, open)).toEqual({ park: { hr: 1, ev: fenceParkEvents(first, PP).ev }, basis: 'built' });
  });
});

describe('가벽 (6.8, P6c)', () => {
  it('함께 쓰는 잠실: 세운 구단 홈 경기만 바뀌고, 설치비·시즌마다 조립·해체 비용, 철거하면 실측으로', () => {
    const L = copy();
    const lg = idx(L, 'LG');
    const ds = idx(L, '두산');
    const st = fenceWorkState(L, lg, 2026, src);
    expect(st).toMatchObject({ kind: 'wall', partner: ds, now: { l: 100, c: 125, r: 100, h: 26 } });
    expect(stadiumOptions(1, st).map((o) => o.id)).toEqual(['remodel', 'new-0', 'new-1', 'wall']);
    expect(orderStadium(L, lg, 2026, 'wall', 1e9, { fence: { l: 101, c: 121, r: 100, h: 25 } }, src).message).toBe('가벽은 원래 펜스보다 안쪽에만 세울 수 있습니다.');
    expect(orderStadium(L, lg, 2026, 'wall', 1e9, { fence: { l: 100, c: 125, r: 100, h: 25 } }, src).message).toBe('줄어드는 펜스 거리가 없습니다.');
    expect(orderStadium(L, lg, 2026, 'wall', 1e9, { fence: { l: 100, c: 121, r: 100, h: 26 } }, src).message).toBe('고를 수 없는 펜스 제원입니다.');
    expect(orderStadium(L, lg, 2026, 'wall', 50_000, { fence: { l: 100, c: 121, r: 100, h: 25 } }, src).message).toBe('자금이 모자랍니다. 10.5억 원은 있어야 합니다.');
    expect(orderStadium(L, lg, 2026, 'wall-off', 1e9, {}, src).message).toBe('철거할 가벽이 없습니다.');
    expect(orderStadium(L, idx(L, 'NC'), 2026, 'wall', 1e9, { fence: { l: 100, c: 121, r: 100, h: 25 } }, src).message).toBe('혼자 쓰는 구장은 가벽 대신 펜스 조정을 합니다.');
    const wall = { l: 100, c: 121, r: 100, h: 25 };
    const before = hr(L, lg, 2027);
    const r = orderStadium(L, lg, 2026, 'wall', 1e9, { fence: wall }, src);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('두산 홈 경기는 그대로');
    expect(L.ledger.at(-1)).toMatchObject({ year: 2027, from: lg, amount: Math.round(WALL.install * wageIndex(2027, L)), kind: 'stadium' });
    expect(park(L, lg, 2027).basis).toBe('wall');
    expect(hr(L, lg, 2027)).toBeGreaterThan(before);
    expect(park(L, ds, 2027)).toEqual(park(base, ds, 2027));
    expect(park(L, lg, 2026)).toEqual(park(base, lg, 2026));
    // 개막 때마다 조립·해체 비용 한 줄
    L.year = 2027;
    const n = L.ledger.length;
    openWalls(L, lg);
    expect(L.ledger.slice(n)).toEqual([{ year: 2027, from: lg, to: -1, amount: Math.round(WALL.yearly * wageIndex(2027, L)), note: `${L.teams[lg].name} 가벽 조립·해체`, kind: 'stadium' }]);
    // 철거는 간격과 상관없이, 다음 시즌부터 원래 펜스(실측 값). 다시 세우는 것은 간격 뒤
    expect(stadiumOptions(1, fenceWorkState(L, lg, 2027, src)).map((o) => o.id)).toContain('wall-off');
    expect(orderStadium(L, lg, 2027, 'wall-off', 0, {}, src).ok).toBe(true);
    expect(park(L, lg, 2028)).toEqual(park(base, lg, 2028));
    expect(L.stadiums![lg].wall).toBeUndefined();
    expect(orderStadium(L, lg, 2028, 'wall', 1e9, { fence: wall }, src).message).toContain('5시즌마다');
    L.year = 2028;
    const m = L.ledger.length;
    openWalls(L, lg);
    expect(L.ledger.length).toBe(m);
  });

  it('상대가 신구장으로 떠나면 혼자 쓰는 구장: 펜스 조정을 할 수 있고 가벽은 같이 걷힌다. 플레이어가 떠난 구단의 가벽은 AI가 걷는다', () => {
    const L = copy();
    const lg = idx(L, 'LG');
    const ds = idx(L, '두산');
    expect(orderStadium(L, lg, 2026, 'wall', 1e9, { fence: { l: 100, c: 121, r: 100, h: 25 } }, src).ok).toBe(true);
    // 두산이 2029 시즌부터 새 구장
    (L.stadiums![ds].done ??= []).push({ kind: 'new', open: 2029, cost: 1 });
    expect(fenceWorkState(L, lg, 2027, src).kind).toBe('wall');
    const st = fenceWorkState(L, lg, 2031, src);
    expect(st.kind).toBe('fence');
    expect(orderStadium(L, lg, 2031, 'fence', 1e9, { fence: { l: 98, c: 122, r: 98, h: 30 } }, src).ok).toBe(true);
    expect(L.stadiums![lg].wall).toBeUndefined();
    expect(park(L, lg, 2032).basis).toBe('fence');
    // AI 구단이 된 구단의 가벽: 다음 결산 오프시즌에 걷는다
    const M = copy();
    expect(orderStadium(M, lg, 2026, 'wall', 1e9, { fence: { l: 100, c: 121, r: 100, h: 25 } }, src).ok).toBe(true);
    const news = stadiumYearEnd(M, 2027, () => 0, ds);
    expect(news.some((x) => x.includes('가벽 철거'))).toBe(true);
    expect(M.stadiums![lg].wall).toBeUndefined();
    expect(M.stadiums![lg].done!.at(-1)).toEqual({ kind: 'wall-off', open: 2028, cost: 0 });
    expect(park(M, lg, 2027).basis).toBe('wall');
    expect(park(M, lg, 2028)).toEqual(park(base, lg, 2028));
  });

  it('실제 역사의 X-존 (2009~2010 LG): 플레이어 LG가 2009 앞 오프시즌에 철거하면 2009·2010 LG 홈 경기가 원래 잠실 값', () => {
    const { league: L } = createLeague(store, 2008, 'xzone', P);
    const lg = idx(L, 'LG');
    const ds = idx(L, '두산');
    const st = fenceWorkState(L, lg, 2008, src);
    expect(st.history?.franchise).toBe('LG');
    expect(stadiumOptions(1, st).map((o) => o.id)).toContain('wall-off');
    expect(fenceWorkState(L, ds, 2008, src).history).toBeUndefined();
    const ratio = (y: number) => hr(L, lg, y) / hr(L, ds, y);
    const r08 = ratio(2008);
    const dsBefore = [2009, 2010].map((y) => park(L, ds, y));
    expect(ratio(2009)).toBeGreaterThan(r08 * 1.03);
    const r = orderStadium(L, lg, 2008, 'wall-off', 0, {}, src);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('실제 역사의 가벽을 더는 따르지 않습니다');
    // 실제 역사 가벽 철거는 간격을 세지 않는다
    expect(L.stadiums![lg].fenceFrom).toBeUndefined();
    for (const y of [2009, 2010]) expect(ratio(y)).toBeCloseTo(r08, 9);
    expect([2009, 2010].map((y) => park(L, ds, y))).toEqual(dsBefore);
  });

  it('저장 → 불러오기 → 이어 돌리기가 끊김 없는 결과와 같다 (펜스 조정·가벽 조작 재현)', () => {
    const opts = { year: 2026, teamIdx: idx(base, 'LG'), seed: 'fence-save' };
    const a = GameSession.create(store, opts, P);
    a.advance(100000);
    a.beginOffseason();
    expect(a.orderStadium('wall', { fence: { l: 100, c: 121, r: 100, h: 25 } }).ok).toBe(true);
    const b = GameSession.load(store, JSON.parse(JSON.stringify(a.toSave())), P);
    expect(b.league.stadiums).toEqual(a.league.stadiums);
    for (const g of [a, b]) {
      for (let guard = 0; g.offseason && g.offseason.stage !== 'ready' && guard < 50; guard++) {
        if (g.offseason.stage === 'draft') g.autoDraft();
        if (g.offseason.stage === 'comp') g.autoComp();
        if (g.offseason.stage === 'release') g.autoRelease();
        g.nextStage();
      }
      expect(g.openNextSeason().ok).toBe(true);
      g.advance(30);
    }
    expect(a.year).toBe(2027);
    expect(b.world.teams[a.teamIdx].park).toEqual({ hr: 1, ev: a.league.stadiums![a.teamIdx].wall!.park });
    expect(b.season.teams).toEqual(a.season.teams);
    expect(b.league.ledger).toEqual(a.league.ledger);
    expect(a.league.ledger.some((e) => e.note.includes('가벽 조립·해체') && e.year === 2027)).toBe(true);
    // 같은 시드·조작 기록으로 다시 돌리면 같은 상태 (재현)
    const r = GameSession.replay(store, opts, a.actions, { year: a.year, day: a.day }, P);
    expect(r.league.stadiums).toEqual(a.league.stadiums);
    expect(r.season.teams).toEqual(a.season.teams);
  }, 900_000);
});

describe('실제 미래 구장과 2027년 뒤 (4.5, P7)', () => {
  it('2027년 뒤는 같은 구장-기간 실측 해의 기간 평균을 해마다 구단 평균 1로 나눈 값, 잠실 돔(제원 미확정)은 2031·2032·2033 배율이 같다', () => {
    const L = copy();
    const nc = idx(L, 'NC');
    const v = park(L, nc, 2027);
    expect(v.basis).toBe('mean');
    expect(park(L, nc, 2040)).toEqual(v);
    // 사건별·득점 계수 모두 구단 평균 1 (기간 평균만이면 2027 득점 계수 평균 1.0065)
    const all = L.teams.map((_, t) => park(L, t, 2027).park!);
    for (const k of ['s1', 'd2', 't3', 'hr'] as const) expect(all.reduce((a, x) => a + x.ev![k], 0) / all.length).toBeCloseTo(1, 12);
    expect(all.reduce((a, x) => a + x.run!, 0) / all.length).toBeCloseTo(1, 12);
    // 펜스 조정의 조정 전 값(창원 2019~ 실측 기간 평균)을 같은 해 사건별 평균으로 나눈 값: 구단끼리의 비는 기간 평균 그대로
    const b = fenceBaseOf(src, 'NC', 2027, FENCE_PRESETS.neutral.fence, PP).base;
    const b2 = fenceBaseOf(src, 'SSG', 2027, FENCE_PRESETS.neutral.fence, PP).base;
    const v2 = park(L, idx(L, 'SSG'), 2027).park!.ev!;
    for (const k of ['s1', 'd2', 't3', 'hr'] as const) expect(v.park!.ev![k] / v2[k]).toBeCloseTo(b[k] / b2[k], 12);
    for (const fr of ['LG', '두산']) {
      const t = idx(L, fr);
      const y31 = park(L, t, 2031);
      expect(park(L, t, 2032)).toEqual(y31);
      expect(park(L, t, 2033)).toEqual(y31);
    }
  });

  it('제원이 확정된 미래 구장은 짐작 × 당김, 그 전 구장의 가벽은 옮긴 해부터 쓰지 않는다', () => {
    const parks = JSON.parse(JSON.stringify(store.parks)) as ParkData;
    const dome = parks.specs.find((r) => r.id === 'jamsil_dome')!;
    Object.assign(dome, { fence: { l: 99, lc: null, c: 122, rc: null, r: 99 }, height: { lr: 3, c: 3 }, confirmed: '출처 확인' });
    const sure = { ...src, parks };
    const L = copy();
    const lg = idx(L, 'LG');
    expect(orderStadium(L, lg, 2026, 'wall', 1e9, { fence: { l: 100, c: 121, r: 100, h: 25 } }, sure).ok).toBe(true);
    expect(park(L, lg, 2031, sure).basis).toBe('wall');
    const v = park(L, lg, 2032, sure);
    expect(v.basis).toBe('guess');
    const g = guessLogs(dome, PP)!;
    // 짐작 × 당김을 그 해 평균 1로 나눈 값: 다른 구단(창원 실측 기간 평균)과의 비가 나누기 전 비와 같다
    const nc = park(L, idx(L, 'NC'), 2032, sure).park!.ev!;
    const ncBase = fenceBaseOf(sure, 'NC', 2032, FENCE_PRESETS.neutral.fence, PP).base;
    expect(v.park!.ev!.hr / nc.hr).toBeCloseTo(Math.exp(PP.specFit.w * g.hr) / ncBase.hr, 12);
    expect(park(L, idx(L, '두산'), 2032, sure).park!.ev).toEqual(v.park!.ev);
    // 확정 전(지금 자료)은 가벽이 이어진다
    expect(park(L, lg, 2032).basis).toBe('wall');
    const s: StadiumState = L.stadiums![lg];
    expect(s.wall).toBeDefined();
  });
});
