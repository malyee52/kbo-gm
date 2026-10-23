// 신구장 지자체 협상과 AI 신구장 (league/stadium.ts, 2026-10-14)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { AI_NEW_AGE, MUNICIPAL, municipalChance, NEW_PARK, orderStadium, stadiumYearEnd } from '../src/league/stadium';
import type { LeagueState } from '../src/league/types';
import { wageIndex } from '../src/league/salary';

/** 2026 오프시즌 착공: 공사비는 2027년 연봉 상승 지수만큼 (2026-10-22) */
const NEW0 = Math.round(NEW_PARK.options[0].cost * wageIndex(2027));

let store: DataStore;
let base: LeagueState;
beforeAll(() => {
  store = loadDataStore();
  const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'deal' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  g.advance(100000);
  g.beginOffseason();
  base = g.league;
}, 300_000);
const copy = () => JSON.parse(JSON.stringify(base)) as LeagueState;

describe('지자체 협상', () => {
  it('표준 분담은 표 그대로, 지원을 더 요구하면 성공 때 구단 부담 −30%, 실패 때 착공 한 시즌 늦어지고 팬이 실망한다', () => {
    const std = copy();
    expect(orderStadium(std, 0, 2026, 'new-0', 10_000_000).ok).toBe(true);
    expect(std.stadiums![0].project).toMatchObject({ cost: NEW0, start: 2027, open: 2030 });
    // 여러 구단으로 굴려 성공·실패가 둘 다 나오는지 본다 (난수는 시드·연도·구단으로 정해진다)
    let win = 0;
    let lose = 0;
    for (let t = 0; t < base.teams.length; t++) {
      const L = copy();
      const fans0 = L.fans![t].level;
      expect(municipalChance(L, t, 2026)).toBeGreaterThanOrEqual(MUNICIPAL.min);
      const r = orderStadium(L, t, 2026, 'new-0', 10_000_000, { deal: 'push' });
      expect(r.ok).toBe(true);
      const p = L.stadiums![t].project!;
      if (p.cost < NEW0) {
        win++;
        expect(p.cost).toBe(Math.round(NEW0 * MUNICIPAL.share));
        expect(p.start).toBe(2027);
      } else {
        lose++;
        expect(p).toMatchObject({ start: 2028, open: 2031 });
        expect(L.fans![t].level).toBeLessThan(fans0);
      }
      // 같은 조건이면 같은 결과 (재현)
      const L2 = copy();
      orderStadium(L2, t, 2026, 'new-0', 10_000_000, { deal: 'push' });
      expect(L2.stadiums![t].project).toEqual(p);
    }
    expect(win).toBeGreaterThan(0);
    expect(lose).toBeGreaterThan(0);
  });
});

describe('AI 신구장', () => {
  it('오래되고 낡은 구장에 자금이 넉넉한 AI 구단은 신구장을 짓는다 (아니면 예전처럼 리모델링)', () => {
    const L = copy();
    const t = 3;
    L.stadiums![t].quality = 25;
    L.stadiums![t].opened = 2026 - AI_NEW_AGE - 1;
    delete L.stadiums![t].project;
    L.ledger.push({ year: 2027, from: -1, to: t, amount: 20_000_000, note: '시험 자금', kind: 'other' });
    const news = stadiumYearEnd(L, 2026, (x) => (x === t ? 20_000_000 : 0), 0);
    expect(L.stadiums![t].project).toMatchObject({ kind: 'new', start: 2027, open: 2030, hr: 1 });
    expect(news.some((n) => n.includes('신구장 착공'))).toBe(true);
    // 새 구장(나이가 어린 구장)이면 신구장 대신 리모델링
    const M = copy();
    M.stadiums![t].quality = 25;
    M.stadiums![t].opened = 2020;
    delete M.stadiums![t].project;
    stadiumYearEnd(M, 2026, (x) => (x === t ? 20_000_000 : 0), 0);
    expect((M.stadiums![t] as { project?: { kind: string } }).project?.kind).toBe('remodel');
  });
});
