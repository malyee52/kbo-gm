// 구장과 팬덤 (league/stadium.ts, 2026-10-12).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { ensureEvents } from '../src/league/events';
import { ensureFinance } from '../src/league/finance';
import {
  addFanEvent, downPayment, FAN_LOSS, fanBase, fanLevel, FRANCHISE_RUNS, FRANCHISE_SEASONS, isFranchiseStar, QUALITY_DECAY, QUALITY_START,
  REMODEL, seatsAt, yearlyPayment,
} from '../src/league/stadium';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let lg: number;
let kt: number;
const opts = (seed: string) => ({ year: 2026, teamIdx: lg, seed });

beforeAll(() => {
  store = loadDataStore();
  const teams = store.season(2026)!.teams;
  lg = teams.findIndex((t) => t.name === 'LG');
  kt = teams.findIndex((t) => t.name === 'KT');
}, 120_000);

/** 오프시즌을 끝내고 다음 시즌을 연다 */
function nextSeason(g: GameSession): void {
  let guard = 0;
  while (g.offseason!.stage !== 'ready' && guard++ < 40) {
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.openNextSeason().ok).toBe(true);
}

describe('구장·팬덤 기본값', () => {
  it('새 게임: 모든 구단에 구장(수용 인원·시설 50)과 팬 만족도(연고 기본값)가 생긴다. 서울 구단이 신생 구단보다 높다', () => {
    const g = GameSession.create(store, opts('st-a'), FAST);
    const L = g.league;
    expect(L.stadiums).toHaveLength(L.teams.length);
    expect(L.stadiums!.every((s) => s.capacity > 10_000 && s.quality === QUALITY_START)).toBe(true);
    expect(L.fans![lg].level).toBeGreaterThan(L.fans![kt].level);
    expect(L.fans![lg].level).toBe(fanBase(0.08));
  });

  it('시즌 중 팬 변화는 그날부터만 반영되고, 결산·오프시즌 변화는 시작 값에 바로 들어간다', () => {
    const L = { teams: [{ name: 'A', franchise: 'A' }], fans: [{ level: 50, log: [] }] } as unknown as LeagueState;
    addFanEvent(L, 0, 2026, 30, -8, '트레이드');
    expect(fanLevel(L, 0, 2026, 29)).toBe(50);
    expect(fanLevel(L, 0, 2026, 30)).toBe(42);
    expect(fanLevel(L, 0, 2027, 30)).toBe(50);
    addFanEvent(L, 0, 2026, -2, 3, '잔류');
    expect(L.fans![0].level).toBe(53);
  });

  it('프랜차이즈 스타: 그 구단에서 5시즌 이상(시작 전 실제 기록 + 게임 안), 지금 15런 이상', () => {
    const L = { teams: [{ name: 'LG', franchise: 'LG' }, { name: '두산', franchise: '두산' }] } as unknown as LeagueState;
    const p = { history: [{ year: 2026, team: 'LG' }], tenure0: { franchise: 'LG', seasons: FRANCHISE_SEASONS - 1 } } as never;
    expect(isFranchiseStar(p, L, 0, FRANCHISE_RUNS)).toBe(true);
    expect(isFranchiseStar(p, L, 0, FRANCHISE_RUNS - 1)).toBe(false);
    expect(isFranchiseStar(p, L, 1, FRANCHISE_RUNS)).toBe(false);
  });

  it('시작 때 실제 기록의 구단 연차가 들어간다 (오지환: LG 계보 2009~)', () => {
    const g = GameSession.create(store, opts('st-tenure'), FAST);
    const oh = g.league.players.find((p) => p.name === '오지환' && p.team === lg)!;
    expect(oh.tenure0?.franchise).toBe('LG');
    expect(oh.tenure0!.seasons).toBeGreaterThanOrEqual(15);
  });
});

describe('구장 공사와 팬 반응 (시즌을 넘기며)', () => {
  it('리모델링: 착공금은 바로, 할부는 공사 시즌 결산 때. 공사 시즌엔 좌석 20% 못 쓰고, 끝나면 좌석·시설이 오른다. 재현해도 같다', () => {
    const o = opts('st-remodel');
    const g = GameSession.create(store, o, FAST);
    g.advance(100000);
    g.beginOffseason();
    const L = g.league;
    const cash0 = g.cashNow();
    const cap0 = L.stadiums![lg].capacity;
    const r = g.orderStadium('remodel');
    expect(r.ok).toBe(true);
    expect(g.orderStadium('remodel').ok).toBe(false); // 이미 잡혀 있다
    expect(g.cashNow()).toBe(cash0 - downPayment(REMODEL.cost));
    nextSeason(g);
    expect(seatsAt(L.stadiums![lg], 2027)).toBe(Math.round(cap0 * (1 - REMODEL.closed)));
    g.advance(100000);
    g.beginOffseason();
    const fy = L.finance![lg].history.at(-1)!;
    expect(fy.year).toBe(2027);
    expect(fy.items.stadium).toBe(-(downPayment(REMODEL.cost) + yearlyPayment(REMODEL.cost, REMODEL.years)));
    const s = L.stadiums![lg];
    expect(s.project).toBeUndefined();
    expect(s.capacity).toBe(cap0 + REMODEL.capacity);
    expect(s.quality).toBe(QUALITY_START - 2 * QUALITY_DECAY + REMODEL.quality);
    const rep = GameSession.replay(store, o, g.actions, undefined, FAST);
    expect(rep.league.stadiums).toEqual(L.stadiums);
    expect(rep.league.fans).toEqual(L.fans);
    expect(rep.cashNow()).toBe(g.cashNow());
  }, 600_000);

  it('결산 때 성적·가을야구가 만족도에 들어가고, 우승 구단은 오른다', () => {
    const g = GameSession.create(store, opts('st-fans'), FAST);
    const before = g.league.fans!.map((f) => f.level);
    g.advance(100000);
    g.beginOffseason();
    const champ = g.league.lastSeason!.postseason!.champion!;
    const log = g.league.fans![champ].log.filter((e) => e.year === 2026 && e.day === -1);
    expect(log.some((e) => e.reason.includes('우승'))).toBe(true);
    expect(g.league.fans![champ].level).toBeGreaterThan(before[champ]);
  }, 300_000);

  it('프랜차이즈 스타를 트레이드하면 그날부터 우리 팬 만족도가 떨어지고 알림이 뜬다', () => {
    const g = GameSession.create(store, opts('st-trade'), FAST);
    ensureEvents(g.league).chance = 0;
    g.advance(10);
    // 오래 뛴 주축 (시작 전 실제 기록으로 LG 5시즌 이상): 오지환
    const star = g.team.org.find((p) => p.name === '오지환')!;
    const ai = (lg + 1) % g.world.teams.length;
    const get = [...g.world.teams[ai].org].filter((p) => !p.foreign && !p.dev).sort((a, b) => a.value - b.value);
    const lv0 = fanLevel(g.league, lg, 2026);
    // AI 판단과 상관없이 트레이드 처리만 본다 (proposeTrade가 받아들인 뒤 부르는 곳)
    (g as unknown as { applyTrade: (ai: number, give: number[], get: number[]) => void }).applyTrade(ai, [star.idx], [get[0].idx]);
    expect(fanLevel(g.league, lg, 2026, g.day)).toBe(lv0 + FAN_LOSS.trade);
    expect(fanLevel(g.league, lg, 2026, g.day - 1)).toBe(lv0);
    expect(g.news.some((n) => n.text.includes('프랜차이즈 스타'))).toBe(true);
  }, 300_000);
});

describe('예전 저장', () => {
  it('구장·팬 정보가 없는 리그도 재정 계산 때 채워진다', () => {
    const g = GameSession.create(store, opts('st-old'), FAST);
    const L = JSON.parse(JSON.stringify(g.league)) as LeagueState;
    delete L.stadiums;
    delete L.fans;
    ensureFinance(L);
    expect(L.stadiums).toHaveLength(L.teams.length);
    expect(L.fans).toHaveLength(L.teams.length);
  });
});
