// 역사와 서사 1단계 D4: 라이벌과 왕조 (league/rivals.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { fillRate } from '../src/league/finance';
import { realYearbook, type YearRecord } from '../src/league/history';
import { computeRivals, dynasties, isRivalry, RIVAL_FILL, titleStreak } from '../src/league/rivals';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('왕조', () => {
  it('실제 기록: 해태 1986~1993(6회, 4연속), 삼성 2011~2014(4연속), SK 2007~2010', () => {
    const d = dynasties(realYearbook(store, 2026));
    expect(d.find((x) => x.name === '해태')).toMatchObject({ from: 1986, to: 1993, streak: 4 });
    expect(d.find((x) => x.name === '해태')!.titles).toHaveLength(6);
    expect(d.find((x) => x.name === '삼성' && x.from === 2011)).toMatchObject({ to: 2014, streak: 4 });
    expect(d.find((x) => x.name === 'SK')).toMatchObject({ from: 2007, to: 2010 });
  });

  it('연속 우승 횟수: 2014 삼성은 4년 연속, 2015 두산은 1', () => {
    const yb = realYearbook(store, 2026);
    expect(titleStreak(yb, 2014)).toBe(4);
    expect(titleStreak(yb, 2015)).toBe(1);
  });
});

describe('라이벌', () => {
  it('2015 시작: SK(SSG 계보)·삼성은 2010~2012 한국시리즈 세 번으로 라이벌, 한 시즌뿐인 쌍은 아니다', () => {
    const r = computeRivals(realYearbook(store, 2026), 2015);
    const p = r.find((x) => x.a === 'SSG' && x.b === '삼성')!;
    expect(p.score).toBe(9);
    expect(r.every((x) => x.years.length >= 2)).toBe(true);
  });

  it('게임 안 가을야구 시리즈도 점수에 들어간다', () => {
    const team = (f: string) => ({ name: f, franchise: f, w: 70, l: 70, t: 4 });
    const yb: YearRecord[] = [2030, 2031].map((year) => ({
      year, inGame: true, champion: 'A', runnerUp: 'B', teams: [team('A'), team('B'), team('C')],
      series: [{ a: 'B', b: 'C', winner: 'B', ks: false }, { a: 'A', b: 'B', winner: 'A', ks: true }],
    }));
    const r = computeRivals(yb, 2032);
    expect(r.find((x) => x.a === 'A' && x.b === 'B')!.score).toBe(2 * (3 + 1));
    expect(r.find((x) => x.a === 'B' && x.b === 'C')!.score).toBe(4);
  });

  it('개막 때 라이벌이 정해지고, 라이벌전 홈 경기 관중률이 오른다', () => {
    const doosan = store.season(2026)!.teams.findIndex((t) => t.name === '두산');
    const g = GameSession.create(store, { year: 2026, teamIdx: doosan, seed: 'rivals' }, FAST);
    const L = g.league;
    expect(L.rivals!.year).toBe(2026);
    const nc = L.teams.findIndex((t) => t.franchise === 'NC');
    expect(isRivalry(L, doosan, nc)).toBe(true);
    const lotte = L.teams.findIndex((t) => t.franchise === '롯데');
    expect(isRivalry(L, doosan, lotte)).toBe(false);
    const base = fillRate(L, doosan, 0.4, 0, 10, 2026, lotte);
    expect(fillRate(L, doosan, 0.4, 0, 10, 2026, nc)).toBeCloseTo(Math.min(1, base + RIVAL_FILL), 10);
    expect(g.news.some((n) => n.text.includes('시즌 라이벌'))).toBe(true);
  });
});
