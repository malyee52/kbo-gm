// 외국인 스카우트 파견과 관찰 명단 (능력치 v2 기획안 19.4, league/scoutfx.ts). 리그를 만들지 않는 가벼운 시험.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FX_AGENT_SCALE, FX_COST, FX_LIST_MAX, FX_OFF_SENDS, fxDrop, fxOpenOff, fxSendBlock, fxSendOff, fxSendSeason, fxSigned, fxState, fxVisible, fxWeek,
  type FxCtx, type FxRegion,
} from '../src/league/scoutfx';
import { foreignSigma } from '../src/league/scout';
import type { InvestKind } from '../src/league/finance';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

const REGIONS: FxRegion[] = ['na', 'latam', 'japan', 'pacific'];

/** 지역마다 n명, 머무는 주는 [from, until) */
function fakeLeague(seed: string, n = 8, win: (i: number) => [number, number] = () => [0, 99]): LeagueState {
  const players: LeaguePlayer[] = [];
  REGIONS.forEach((region, r) => {
    for (let i = 0; i < n; i++) {
      const [from, until] = win(i);
      players.push({ id: `v-${region}-${i}`, name: `${region}${i}`, foreign: true, asia: region === 'pacific', isPitcher: (i + r) % 2 === 0, team: -1, fx: { region, from, until } } as LeaguePlayer);
    }
  });
  const lv: Record<InvestKind, number> = { scout: 1, scoutPro: 1, develop: 1, medical: 1, marketing: 1 };
  return {
    seed, year: 2027, difficulty: 'normal', players, ledger: [],
    teams: Array.from({ length: 10 }, (_, t) => ({ name: `구단${t}`, franchise: `f${t}` })),
    finance: Array.from({ length: 10 }, () => ({ invest: lv, active: lv, history: [] })), owner: { team: 0 },
  } as unknown as LeagueState;
}

const ctxOf = (league: LeagueState, signed = new Set<string>()): FxCtx => ({ league, year: 2027, userTeam: 0, free: (id) => !signed.has(id) });
const signedBy = () => null;

describe('관찰 명단 (19.4)', () => {
  it('파견이 없으면 에이전트 추천만: 4주마다 1명, 추측 폭 1.5배', () => {
    const league = fakeLeague('fx-agent');
    const ctx = ctxOf(league);
    fxState(league, 2027, false);
    for (let w = 0; w < 12; w++) fxWeek(ctx, w, signedBy);
    const t = league.scoutFx!.teams[0];
    expect(t.list.length).toBe(3);
    expect(t.list.every((e) => e.agent)).toBe(true);
    const e = t.list[0];
    const plain = foreignSigma(league, { team: 0, user: true }, { id: 'x', sample: null });
    expect(foreignSigma(league, { team: 0, user: true }, { id: e.id, sample: null })).toBeCloseTo(plain * FX_AGENT_SCALE);
  });

  it('같은 시드 = 같은 발견, 파견 4주에 평균 약 1.5명, 비용 3억', () => {
    const run = (seed: string) => {
      const league = fakeLeague(seed);
      const ctx = ctxOf(league);
      fxState(league, 2027, false);
      fxSendSeason(ctx, 1, 'na');
      for (let w = 0; w < 4; w++) fxWeek(ctx, w, signedBy);
      return league;
    };
    const a = run('fx-same');
    expect(run('fx-same').scoutFx).toEqual(a.scoutFx);
    expect(a.ledger).toEqual([{ year: 2027, from: 1, to: -1, amount: FX_COST, note: '외국인 스카우트 파견 (북미)', kind: 'scouting' }]);
    expect(a.scoutFx!.teams[1].out).toEqual([]); // 4주 뒤 돌아옴
    let found = 0;
    const N = 400;
    for (let i = 0; i < N; i++) found += run(`fx-rate-${i}`).scoutFx!.teams[1].list.filter((e) => !e.agent).length;
    expect(found / N).toBeGreaterThan(1.3);
    expect(found / N).toBeLessThan(1.7);
  });

  it('파견한 지역 후보만 붙고, 그 지역 관찰 주가 쌓여 추측 폭이 좁아진다', () => {
    const league = fakeLeague('fx-watch');
    const ctx = ctxOf(league);
    fxState(league, 2027, false);
    for (let k = 0; k < 3; k++) {
      fxSendSeason(ctx, 2, 'japan');
      for (let w = k * 4; w < k * 4 + 4; w++) fxWeek(ctx, w, signedBy);
    }
    const t = league.scoutFx!.teams[2];
    const scouted = t.list.filter((e) => !e.agent);
    expect(scouted.length).toBeGreaterThan(0);
    for (const e of scouted) expect(e.id).toMatch(/^v-japan-/);
    const first = scouted[0];
    expect(first.weeks).toBeGreaterThan(0);
    const who = { team: 2, user: false };
    const s0 = foreignSigma(league, who, { id: 'none', sample: null });
    expect(foreignSigma(league, who, { id: first.id, sample: null })).toBeCloseTo(s0 * 0.7 ** (first.weeks / 4));
  });

  it('머무는 기간이 지나면 떠나고, 다른 구단과 계약하면 빠진다 (소식)', () => {
    const league = fakeLeague('fx-leave', 3, (i) => [0, 5 + i]);
    const signed = new Set<string>();
    const ctx = ctxOf(league, signed);
    fxState(league, 2027, false);
    fxSendSeason(ctx, 0, 'na');
    fxSendSeason(ctx, 0, 'latam');
    for (let w = 0; w < 4; w++) fxWeek(ctx, w, signedBy);
    const before = [...league.scoutFx!.teams[0].list];
    expect(before.length).toBeGreaterThan(0);
    const leftNews = fxWeek(ctx, 9, signedBy);
    expect(league.scoutFx!.teams[0].list.length).toBe(0);
    expect(leftNews.filter((n) => n.team === 0 && /다른 리그와 계약/.test(n.text)).length).toBe(before.length);
    // 계약: 모든 명단에서 빠지고 다른 구단 명단 소식
    const l2 = fakeLeague('fx-sign');
    fxState(l2, 2027, false);
    l2.scoutFx!.teams[0].list.push({ id: 'v-na-1', at: 0, weeks: 0 });
    l2.scoutFx!.teams[4].list.push({ id: 'v-na-1', at: 0, weeks: 0 });
    const news = fxSigned(l2, 'v-na-1', 4);
    expect(l2.scoutFx!.teams[0].list).toEqual([]);
    expect(l2.scoutFx!.teams[4].list).toEqual([]);
    expect(news).toEqual([{ team: 0, text: '관찰하던 외국인 후보 na1: 구단4와 계약해 명단에서 빠졌습니다.' }]);
  });

  it('명단은 8명까지: 플레이어 구단은 기다림 칸, 빼면 들어온다. AI 구단은 가장 오래된 후보를 뺀다', () => {
    const league = fakeLeague('fx-full', 12);
    fxState(league, 2027, false);
    const t = league.scoutFx!.teams[0];
    for (let i = 0; i < FX_LIST_MAX; i++) t.list.push({ id: `v-latam-${i}`, at: 0, weeks: 0 });
    const ctx = ctxOf(league);
    for (let k = 0; k < 6 && !t.wait; k++) {
      fxSendSeason(ctx, 0, 'na');
      for (let w = 0; w < 4; w++) fxWeek(ctx, k * 4 + w, signedBy);
    }
    expect(t.list.length).toBe(FX_LIST_MAX);
    expect(t.wait).toBeDefined();
    const waiting = t.wait!.id;
    expect(fxVisible(league, 0, league.players.find((p) => p.id === waiting)!)).toBe(false);
    expect(fxDrop(league, 0, 'v-latam-0')).toBe(true);
    expect(t.list.some((e) => e.id === waiting)).toBe(true);
    expect(t.wait).toBeUndefined();
    // AI
    const ai = league.scoutFx!.teams[5];
    ai.list = [];
    for (let i = 0; i < FX_LIST_MAX; i++) ai.list.push({ id: `v-latam-${i}`, at: 0, weeks: 0 });
    for (let k = 0; k < 6 && ai.list[0].id === 'v-latam-0'; k++) {
      fxSendSeason(ctx, 5, 'japan');
      for (let w = 0; w < 4; w++) fxWeek(ctx, 30 + k * 4 + w, signedBy);
    }
    expect(ai.list.length).toBe(FX_LIST_MAX);
    expect(ai.list[0].id).not.toBe('v-latam-0');
    expect(ai.wait).toBeUndefined();
  });

  it('오프시즌: 단계를 열 때 에이전트 2명, 파견은 바로 4주, 4번까지', () => {
    const league = fakeLeague('fx-off');
    const ctx = ctxOf(league);
    fxOpenOff(ctx);
    expect(league.scoutFx!.teams.every((t) => t.list.length === 2)).toBe(true);
    for (let i = 0; i < FX_OFF_SENDS; i++) {
      expect(fxSendBlock(league, 0, 'na', { off: true, asiaRule: true, open: true })).toBeNull();
      fxSendOff(ctx, 0, 'na');
    }
    expect(fxSendBlock(league, 0, 'na', { off: true, asiaRule: true, open: true })).toMatch(/모두 썼습니다/);
    expect(league.ledger.length).toBe(FX_OFF_SENDS);
    // 파견 동안 붙은 북미 후보는 지켜본 주가 있다
    const na = league.scoutFx!.teams[0].list.filter((e) => !e.agent);
    expect(na.length).toBeGreaterThan(0);
    for (const e of na) expect(e.weeks).toBeGreaterThan(0);
  });

  it('관찰 명단 밖의 파견 후보는 보이지 않고, 계약도 막힌다 (소스 검사)', () => {
    const league = fakeLeague('fx-vis');
    fxState(league, 2027, false);
    const p = league.players[0];
    expect(fxVisible(league, 0, p)).toBe(false);
    expect(fxVisible(league, 0, { id: 'real', fx: undefined })).toBe(true); // KBO에서 풀린 외국인·실존 시장 외국인
    league.scoutFx!.teams[0].list.push({ id: p.id, at: 0, weeks: 0 });
    expect(fxVisible(league, 0, p)).toBe(true);
    const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const off = strip(readFileSync('src/league/offseason.ts', 'utf8'));
    const can = off.slice(off.indexOf('export function canSignForeign'), off.indexOf('function feeCheck'));
    expect(can).toMatch(/fxVisible/);
    const mk = strip(readFileSync('src/league/market.ts', 'utf8'));
    expect(mk.slice(mk.indexOf('export function signBlock'), mk.indexOf('export function signSalary'))).toMatch(/fxVisible/);
    expect(mk.slice(mk.indexOf('export function aiMarketDay'), mk.indexOf('function seasonFxCtx'))).toMatch(/fxVisible/);
    expect(mk.slice(mk.indexOf('export function marketPlayers'), mk.indexOf('export function isMarketForeign'))).toMatch(/fxVisible/);
  });
});
