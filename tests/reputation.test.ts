// 단장 평판 (league/reputation.ts): 시즌 평가로 바뀌고, FA·다년 계약 요구, 트레이드 호의, 해고 뒤 제의에 쓰인다
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { offersFor } from '../src/league/owner';
import { offersByRep, repDemand, repGoodwill, repOf, updateReputation } from '../src/league/reputation';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
beforeAll(() => { store = loadDataStore(); }, 120_000);

const base = { year: 2026, winPct: 0.5, postseason: false, seriesWon: 0, champion: false, goalMet: true, capOver: false, rescued: false, achievements: 0, fired: false };

describe('단장 평판', () => {
  it('시즌 평가: 우승 시즌은 크게 오르고, 해고된 시즌은 떨어지며, 해마다 50 쪽으로 돌아간다', () => {
    const L = { reputation: undefined } as unknown as LeagueState;
    expect(repOf(L)).toBe(50);
    const r = updateReputation(L, { ...base, winPct: 0.6, postseason: true, seriesWon: 2, champion: true, achievements: 1 });
    // 승률 +4, 진출 +3, 2시리즈 +6, 우승 +8, 목표 +2, 업적 +1 = +24 → 74, 50 쪽으로 10% → 71.6
    // (2026-11-12 사용자 그릴 Q38: 진출·시리즈·우승을 키워 우승 한 시즌이면 70(강팀 제의 기준)에 닿게. 예전 값은 65.3)
    expect(r.after).toBeCloseTo(71.6, 1);
    expect(r.after).toBeGreaterThanOrEqual(70);
    const f = updateReputation(L, { ...base, year: 2027, winPct: 0.4, goalMet: false, fired: true });
    expect(f.after).toBeLessThan(r.after - 10);
    expect(L.reputation!.log.some((x) => x.reason === '해고')).toBe(true);
    // 평균 시즌만 이어지면 50으로 모인다
    for (let y = 0; y < 40; y++) updateReputation(L, { ...base, year: 2028 + y, goalMet: y % 2 === 0 });
    expect(Math.abs(repOf(L) - 50)).toBeLessThan(3);
  });

  it('효과: 50이면 아무 변화 없음, 높으면 요구가 줄고 호의가 생긴다', () => {
    const at = (v: number) => ({ reputation: { value: v, log: [] } }) as unknown as LeagueState;
    expect(repDemand(at(50))).toBe(1);
    expect(repGoodwill(at(50))).toBe(0);
    // 2026-11-12 사용자 그릴 Q38: ±5%·±1.5런 → ±15%·±4런
    expect(repDemand(at(100))).toBeCloseTo(0.85);
    expect(repDemand(at(0))).toBeCloseTo(1.15);
    expect(repGoodwill(at(100))).toBeCloseTo(4);
    expect(repGoodwill(at(0))).toBeCloseTo(-4);
  });

  it('70에 닿는 길: 50에서 가을야구·목표 달성 시즌을 이어 가면 몇 해 안에 70을 넘는다', () => {
    const L = { reputation: undefined } as unknown as LeagueState;
    const years: number[] = [];
    for (let y = 0; y < 6; y++) years.push(updateReputation(L, { ...base, year: 2026 + y, winPct: 0.55, postseason: true }).after);
    // 승률 +2, 진출 +3, 목표 +2 = +7 → 해마다 약 +6, 셋째 해쯤 70
    expect(years.findIndex((v) => v >= 70)).toBeGreaterThanOrEqual(0);
    expect(years.findIndex((v) => v >= 70)).toBeLessThanOrEqual(3);
  });

  it('해고 뒤 제의: 보통은 예전과 같고, 평판이 높으면 위쪽 구단도, 낮으면 두 곳만', () => {
    const st = [3, 1, 4, 0, 9, 2, 6, 5, 8, 7];
    expect(offersByRep(st, 8, 50)).toEqual(offersFor(st, 8));
    const high = offersByRep(st, 8, 80);
    expect(high.length).toBe(3);
    expect(high.some((t) => st.indexOf(t) < 5)).toBe(true);
    expect(high).not.toContain(8);
    expect(offersByRep(st, 8, 20).length).toBe(2);
  });

  it('게임에서: 시즌을 마치면 평판이 매겨지고 소식에 남는다', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 1, seed: 'rep-1' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    g.advance(100000);
    g.beginOffseason();
    expect(g.league.reputation).toBeDefined();
    expect(g.league.reputation!.log.length).toBeGreaterThan(0);
    expect(g.news.some((n) => n.text.startsWith('단장 평판 50 →'))).toBe(true);
  }, 300_000);
});
