// 실제 구장 역사 (league/ballparks.ts): 시작 연도 구장 이름, 진행 중 실제 새 구장으로 옮기기, 게임 안에서 지은 구단은 그대로
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { realParkAt, REAL_PARKS } from '../src/league/ballparks';
import { stadiumFill, stadiumYearEnd } from '../src/league/stadium';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('실제 구장 역사', () => {
  it('자료: 계보마다 해가 겹치지 않고, 그 해 구장을 찾는다', () => {
    for (const p of REAL_PARKS) expect(REAL_PARKS.filter((q) => q.franchise === p.franchise && q.from === p.from).length).toBe(1);
    expect(realParkAt('히어로즈', 2015)!.name).toBe('목동야구장');
    expect(realParkAt('히어로즈', 2016)!.name).toBe('고척 스카이돔');
    expect(realParkAt('KT', 2010)).toBeUndefined();
  });

  it('새 게임은 구장 이름만 붙이고 (관중 모델 값은 그대로), 진행하다 실제 새 구장이 열린 해가 오면 옮긴다', () => {
    const g = GameSession.create(store, { year: 2013, teamIdx: 0, seed: 'parks-1' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const L = g.league;
    const kia = L.teams.findIndex((t) => t.franchise === 'KIA');
    const sam = L.teams.findIndex((t) => t.franchise === '삼성');
    // 결산 정리가 이미 2014 시즌 개장을 처리했다 (beginOffseason → settleSeason → stadiumYearEnd)
    expect(L.stadiums![kia]).toMatchObject({ name: '광주-기아 챔피언스 필드', opened: 2014, quality: 100, unchecked: true });
    expect(L.stadiums![sam].name).toBe('대구시민운동장 야구장');
    expect(L.stadiums![sam].opened).toBeUndefined();
    // 게임 안에서 신구장을 지은 구단은 실제 구장으로 옮기지 않는다
    L.stadiums![sam].done = [{ kind: 'new', open: 2014, cost: 1 }];
    const before = { ...L.stadiums![sam] };
    stadiumYearEnd(L, 2015, () => 0, 0);
    expect(L.stadiums![sam].name).toBe(before.name);
  }, 300_000);

  it('2026 시작: 고척은 이름만 (돔 관중 가산 없음), 잠실은 2032년 돔 계획', () => {
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'parks-2' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const L = g.league;
    const her = L.teams.findIndex((t) => t.franchise === '히어로즈');
    expect(L.stadiums![her].name).toBe('고척 스카이돔');
    expect(L.stadiums![her].dome).toBeUndefined();
    expect(stadiumFill(L.stadiums![her], 2027)).toBeCloseTo(((L.stadiums![her].quality - 50) / 50) * 0.06, 5);
    const lg = L.teams.findIndex((t) => t.franchise === 'LG');
    stadiumYearEnd(L, 2031, () => 0, -1);
    expect(L.stadiums![lg]).toMatchObject({ name: '잠실 돔구장', dome: true, capacity: 30_000, opened: 2032 });
  }, 300_000);
});
