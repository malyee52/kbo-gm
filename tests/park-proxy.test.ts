// 옛 해 구장 효과 (구장효과 기획안 P5, 4.3 섞는 규칙, engine/park.ts realParkYear): 실측 거꾸로·차이 방식·짐작, 해마다 평균 1,
// 실측 해의 구성표 모양 경계(사직 2015~2021), 잠실 X-존(2009~2010 LG 홈 경기만), 엔진·능력 산출·리그 월드가 같은 값을 쓰는지
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, leagueRpa, realParkYear, runFactorOf, seasonPark, worldForYear, type RealParkValue } from '../src/engine';
import { createLeague } from '../src/league/create';
import { worldFromLeague } from '../src/league/world';

let store: DataStore;
const P = DEFAULT_PARAMS.park;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

const src = () => ({ parkFactors: store.meta.parkFactors, parkEvents: store.meta.parkEvents, parks: store.parks });
function year(y: number, withParks = true): Map<string, RealParkValue> {
  const s = store.season(y)!;
  return realParkYear(withParks ? src() : { ...src(), parks: undefined }, y, s.teams.map((t) => t.franchise), leagueRpa(s.league), P);
}

describe('득점 계수 곱 꼴 (runFactorOf, 2026-10-24 구장 개발 9)', () => {
  it('작은 변화에서는 예전 선형 식(1 + Σ 가치 × 비율 × (배율 − 1) ÷ 타석당 득점)과 같고, 큰 배율에서는 덜 움직인다', () => {
    const lg = leagueRpa(store.season(2025)!.league);
    const v = P.runValue;
    const linear = (m: Record<'s1' | 'd2' | 't3' | 'hr', number>) =>
      1 + (['s1', 'd2', 't3', 'hr'] as const).reduce((a, k) => a + v[k] * lg.rates[k] * (m[k] - 1), 0) / lg.rpa;
    expect(runFactorOf({ s1: 1, d2: 1, t3: 1, hr: 1 }, lg.rates, lg.rpa, P)).toBe(1);
    for (const e of [0.01, -0.01]) {
      const m = { s1: 1 + e, d2: 1 - e / 2, t3: 1 + e, hr: 1 + 2 * e };
      const f = runFactorOf(m, lg.rates, lg.rpa, P);
      expect(Math.abs(f - linear(m))).toBeLessThan(2e-4);
      expect(Math.abs(f - 1)).toBeGreaterThan(5e-3);
    }
    // 잠실·SSG 크기의 홈런 배율: 곱 꼴은 줄 때 더 줄고 늘 때 덜 는다 (로그는 오목하다, 묶음 진단의 시뮬 방향)
    const low = { s1: 1, d2: 1, t3: 1, hr: 0.75 }, high = { s1: 1, d2: 1, t3: 1, hr: 1.37 };
    expect(runFactorOf(low, lg.rates, lg.rpa, P)).toBeLessThan(linear(low));
    expect(runFactorOf(high, lg.rates, lg.rpa, P)).toBeLessThan(linear(high));
  });

  it('실측 해 사건별 배율(build_data.py park_events)로 센 득점 계수가 그 해 f와 같다 (파이썬·엔진이 같은 식)', () => {
    for (const y of ['2016', '2019', '2023', '2025']) {
      const lg = leagueRpa(store.season(Number(y))!.league);
      const ev = store.meta.parkEvents![y];
      for (const [fr, m] of Object.entries(ev)) {
        expect(Math.abs(runFactorOf(m, lg.rates, lg.rpa, P) - store.meta.parkFactors![y][fr]), `${y} ${fr}`).toBeLessThan(0.004);
      }
    }
  });
});

describe('옛 해 구장 효과 (P5)', () => {
  it('실측 해는 그 해 f 그대로, 사직은 2022 펜스 변경 앞(2015~2021)만 구성표 모양 대신 지수 규칙', () => {
    for (const y of [2015, 2019, 2021, 2022, 2025]) {
      const t = year(y);
      for (const [fr, v] of t) {
        expect(v.basis).toBe('measured');
        expect(v.run).toBe(store.meta.parkFactors![String(y)][fr]);
      }
      const sajik = t.get('롯데')!;
      if (y <= 2021) expect(sajik.ev).toBeUndefined();
      else expect(sajik.ev).toEqual(store.meta.parkEvents![String(y)]['롯데']);
      // 다른 구장은 구성표 그대로
      expect(t.get('SSG')!.ev).toEqual(store.meta.parkEvents![String(y)].SSG);
    }
  });

  it('제원 자료가 없으면 옛 해는 모두 중립 (P5 전과 같다)', () => {
    expect(year(1995, false).size).toBe(0);
    expect(year(2009, false).size).toBe(0);
  });

  it('옛 해는 사건별로 구단 평균 1 (중립 구단은 1)', () => {
    for (const y of [1982, 1985, 1991, 1995, 2000, 2009, 2014]) {
      const s = store.season(y)!;
      const frs = [...new Set(s.teams.map((t) => t.franchise))];
      const t = year(y);
      for (const k of ['s1', 'd2', 't3', 'hr'] as const) {
        const mean = frs.reduce((a, fr) => a + (t.get(fr)?.ev?.[k] ?? 1), 0) / frs.length;
        expect(mean, `${y} ${k}`).toBeCloseTo(1, 9);
      }
    }
  });

  it('근거: 이어진 구장은 실측 거꾸로·차이 방식, 사라진 구장은 짐작, 제원이 없으면 중립', () => {
    const y85 = year(1985);
    expect(y85.get('두산')!.basis).toBe('back');
    expect(y85.get('LG')!.basis).toBe('back');
    expect(y85.get('롯데')!.basis).toBe('guess'); // 구덕
    expect(y85.get('삼성')!.basis).toBe('back'); // 대구시민 (2015 실측까지 이어짐)
    expect(year(1990).get('한화')).toBeUndefined(); // 한밭 2013년 이전: 펜스 제원 없음
    expect(year(2003).get('현대계')!.basis).toBe('guess'); // 수원 현대 시절: 2015 리모델링 전
    expect(year(2003).get('SSG')!.basis).toBe('back'); // 문학
    // 잠실 1991~2002 좌우 95m: 같은 해 다른 잠실 기간보다 홈런이 많다 (차이 방식, 결정 14)
    const y95 = year(1995).get('LG')!;
    expect(y95.basis).toBe('diff');
    expect(y95.ev!.hr / year(2005).get('LG')!.ev!.hr).toBeGreaterThan(1.05);
    // 짐작은 당김 0.5라 실측 범위(홈런 70~147)보다 좁고, 좌우타가 같다
    for (const fr of ['롯데', 'KIA', '현대계']) {
      const e = y85.get(fr)!.ev!;
      expect(e.hr).toBeGreaterThan(0.85);
      expect(e.hr).toBeLessThan(1.3);
      expect(e.L).toBeUndefined();
    }
  });

  it('잠실 X-존: 2009·2010 LG 홈 경기만 차이 방식, 두산 홈 경기와 2008·2011 LG는 잠실 실측 거꾸로', () => {
    for (const y of [2009, 2010]) {
      const t = year(y);
      expect(t.get('LG')!.basis).toBe('diff');
      expect(t.get('두산')!.basis).toBe('back');
      expect(t.get('LG')!.ev!.hr).toBeGreaterThan(t.get('두산')!.ev!.hr);
      expect(t.get('LG')!.ev!.L!.hr).toBeGreaterThan(t.get('두산')!.ev!.L!.hr);
    }
    // X-존 없는 해는 두 구단 모두 잠실 실측 거꾸로 (수준 f는 구단별 실측 평균이라 조금 다르다)
    const ratio = (y: number) => year(y).get('LG')!.ev!.hr / year(y).get('두산')!.ev!.hr;
    for (const y of [2008, 2011]) {
      expect(year(y).get('LG')!.basis).toBe('back');
      expect(ratio(y)).toBeCloseTo(ratio(2005), 9);
    }
    expect(ratio(2009)).toBeGreaterThan(ratio(2008) * 1.04);
  });

  it('엔진 월드·능력 산출·리그 월드가 같은 값을 쓴다 (2009)', () => {
    const t = year(2009);
    const w = worldForYear(store, 2009);
    for (const team of w.teams) {
      const v = t.get(team.franchise);
      if (!v) { expect(team.park).toBeUndefined(); continue; }
      expect(team.park).toEqual({ hr: 1, run: v.run, ev: v.ev });
    }
    // 능력 산출: 2009 시즌 LG 기록은 X-존 값의 절반으로 나눈다 (2010 시작 LG 타자)
    const s = store.season(2009)!;
    const lgName = s.teams.find((x) => x.franchise === 'LG')!.name;
    const doName = s.teams.find((x) => x.franchise === '두산')!.name;
    const lgPark = seasonPark(store.meta, s, lgName, 'L', store.parks)!;
    const doPark = seasonPark(store.meta, s, doName, 'L', store.parks)!;
    expect(lgPark.ev!.hr).toBeCloseTo(t.get('LG')!.ev!.L!.hr, 9);
    expect(lgPark.ev!.hr).toBeGreaterThan(doPark.ev!.hr);
    expect(lgPark.run).toBeCloseTo((1 + t.get('LG')!.run) / 2, 9);
    // 제원이 없으면 2009는 중립 (P5 전)
    expect(seasonPark(store.meta, s, lgName, 'L')).toBeUndefined();
  }, 300_000);

  it('리그 월드(새 게임 1995)도 같은 값', () => {
    const { league } = createLeague(store, 1995, 'park-proxy-1995', FAST);
    const w = worldFromLeague(league, store, FAST);
    const t = year(1995);
    for (const team of w.teams) {
      const v = t.get(team.franchise);
      expect(team.park ?? null, team.franchise).toEqual(v ? { hr: 1, run: v.run, ev: v.ev } : null);
    }
  }, 300_000);
});
