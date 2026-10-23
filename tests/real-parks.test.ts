// 실제 구장 역사 (league/ballparks.ts): 시작 연도 구장 이름, 진행 중 실제 새 구장으로 옮기기, 게임 안에서 지은 구단은 그대로.
// 이름·확인 표시는 parks.json (구장효과 기획안 P1), 옮기는 해·관중 좌석은 코드 안 표 CODE_PARKS (P5까지)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import type { ParkData } from '../src/data/types';
import { CODE_PARKS, realParkAt, realParkOpening, realParks, useParkData } from '../src/league/ballparks';
import { createLeague } from '../src/league/create';
import { stadiumFill, stadiumYearEnd } from '../src/league/stadium';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); useParkData(store.parks); }, 120_000);

/** parks.json 표에서 바로 찾은 그 해 그 계보의 구장 이름 (ballparks.ts와 따로 계산) */
function tableName(parks: ParkData, franchise: string, year: number): string | undefined {
  const use = parks.use.filter((u) => u.franchise === franchise && u.from <= year && year <= (u.to ?? 9999)).sort((a, b) => b.from - a.from)[0];
  return use && parks.specs.find((s) => s.id === use.park && !s.franchise && s.from <= year && year <= (s.to ?? 9999))?.name;
}

describe('실제 구장 역사', () => {
  it('자료: 계보마다 해가 겹치지 않고, 그 해 구장을 찾는다', () => {
    for (const p of CODE_PARKS) expect(CODE_PARKS.filter((q) => q.franchise === p.franchise && q.from === p.from).length).toBe(1);
    expect(realParkAt('히어로즈', 2015)!.name).toBe('목동 야구장');
    expect(realParkAt('히어로즈', 2016)!.name).toBe('고척 스카이돔');
    expect(realParkAt('KT', 2010)).toBeUndefined();
    // 이름은 그 해 자료, 옮기는 해·관중 좌석은 코드 안 표
    expect(realParkAt('LG', 1982)).toMatchObject({ name: '동대문야구장', from: 1982, capacity: 23_750, parkId: 'dongdaemun' });
    expect(realParkAt('LG', 1983)).toMatchObject({ name: '서울종합운동장 야구장', from: 1982, parkId: 'jamsil', seats: 30_500 });
    expect(realParkAt('LG', 2032)).toMatchObject({ name: '잠실 돔구장', dome: true, planned: true, parkId: 'jamsil_dome' });
    expect(realParkOpening('KIA', 2014)).toMatchObject({ name: '광주-기아 챔피언스 필드', capacity: 20_500, seats: 22_244, checked: true });
    expect(realParks().map((p) => [p.franchise, p.from, p.capacity])).toEqual(CODE_PARKS.map((p) => [p.franchise, p.from, p.capacity]));
  });

  it('parks.json이 없으면 코드 안 표 이름으로 돌아간다', () => {
    useParkData(undefined);
    try {
      expect(realParkAt('히어로즈', 2015)!.name).toBe('목동야구장');
      expect(realParkAt('LG', 1982)!.name).toBe('잠실야구장');
      expect(realParkAt('LG', 1982)!.parkId).toBeUndefined();
    } finally {
      useParkData(store.parks);
    }
  });

  it('새 게임 1982·2000·2016·2026: 시작 구장 이름이 parks.json 표와 같다', () => {
    expect(store.parks).toBeDefined();
    for (const year of [1982, 2000, 2016, 2026]) {
      const { league } = createLeague(store, year, `parks-names-${year}`, FAST);
      for (let t = 0; t < league.teams.length; t++) {
        const fr = league.teams[t].franchise;
        const want = tableName(store.parks!, fr, year);
        if (want) expect(league.stadiums![t].name, `${year} ${fr}`).toBe(want);
      }
    }
    // 표 값 몇 개는 직접 (자료가 바뀌면 같이 본다)
    const named = (year: number, fr: string) => {
      const { league } = createLeague(store, year, `parks-names-${year}`, FAST);
      return league.stadiums![league.teams.findIndex((t) => t.franchise === fr)].name;
    };
    expect(named(1982, '롯데')).toBe('구덕 야구장');
    expect(named(2016, '삼성')).toBe('대구 삼성 라이온즈 파크');
  }, 300_000);

  it('자료에서만 구장이 바뀐 해는 이름만 바꾼다 (LG 1983 동대문 → 잠실: 시설·좌석 그대로)', () => {
    const { league } = createLeague(store, 1982, 'parks-rename', FAST);
    const lg = league.teams.findIndex((t) => t.franchise === 'LG');
    const s = league.stadiums![lg];
    expect(s.name).toBe('동대문야구장');
    const before = { capacity: s.capacity, quality: s.quality, opened: s.opened };
    stadiumYearEnd(league, 1982, () => 0, -1);
    expect(s.name).toBe('서울종합운동장 야구장');
    expect({ capacity: s.capacity, quality: s.quality + 1, opened: s.opened }).toEqual(before);
  }, 300_000);

  it('새 게임은 구장 이름만 붙이고 (관중 모델 값은 그대로), 진행하다 실제 새 구장이 열린 해가 오면 옮긴다', () => {
    const g = GameSession.create(store, { year: 2013, teamIdx: 0, seed: 'parks-1' }, FAST);
    g.advance(100000);
    g.beginOffseason();
    const L = g.league;
    const kia = L.teams.findIndex((t) => t.franchise === 'KIA');
    const sam = L.teams.findIndex((t) => t.franchise === '삼성');
    // 결산 정리가 이미 2014 시즌 개장을 처리했다 (beginOffseason → settleSeason → stadiumYearEnd)
    expect(L.stadiums![kia]).toMatchObject({ name: '광주-기아 챔피언스 필드', opened: 2014, quality: 100 });
    expect(L.stadiums![kia].unchecked).toBeUndefined();
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
