// 시즌 반발계수 평균 회귀 AR(1) (2026-11-25 사용자 Q54, futureRules.ts corDraw): 결정성, 범위, 한 해 변동, 예전 저장 호환
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { ballHrMul, COR_AR_PHI, COR_CENTER, COR_HIGH, COR_LOW, COR_START_2026, seasonCor } from '../src/league/futureRules';
import type { LeagueState } from '../src/league/types';

const league = (seed: string, ballCor?: LeagueState['ballCor']): LeagueState => ({ seed, ...(ballCor ? { ballCor } : {}) }) as unknown as LeagueState;
const YEARS = Array.from({ length: 49 }, (_, i) => 2027 + i);
const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
/** 시드 여럿의 해마다 차이 (로그 홈런 배율) */
const diffs = (mk: (seed: string) => LeagueState) => {
  const out: number[] = [];
  for (let s = 0; s < 40; s++) {
    const L = mk(`ar-${s}`);
    const m = YEARS.map((y) => Math.log(ballHrMul(L, y)));
    for (let i = 1; i < m.length; i++) out.push(m[i] - m[i - 1]);
  }
  return out;
};

describe('반발계수 AR(1)', () => {
  it('새 리그(ballCor 칸)는 시드로 재현되고 실제 퍼짐 안에 있다', () => {
    const vals = YEARS.map((y) => seasonCor(league('cor-a', {}), y)!);
    expect(vals.every((v) => v >= COR_LOW - 1e-4 && v <= COR_HIGH + 1e-4)).toBe(true);
    expect(YEARS.map((y) => seasonCor(league('cor-a', {}), y))).toEqual(vals);
    expect(YEARS.map((y) => seasonCor(league('cor-b', {}), y))).not.toEqual(vals);
  });

  it('2027 값은 실제 2026 검사값에서 가운데 쪽으로 움직인 자리 근처다', () => {
    const mean = Array.from({ length: 200 }, (_, s) => seasonCor(league(`m-${s}`, {}), 2027)!).reduce((a, b) => a + b, 0) / 200;
    const expected = COR_CENTER + COR_AR_PHI * (COR_START_2026 - COR_CENTER);
    expect(Math.abs(mean - expected)).toBeLessThan(0.0006);
  });

  it('해마다 차이가 따로 뽑던 예전 방식보다 작고, 지난해와 같은 쪽으로 이어진다', () => {
    const next = diffs((s) => league(s, {}));
    const old = diffs((s) => league(s));
    expect(sd(next)).toBeLessThan(sd(old) * 0.6);
    // 1차 자기상관: 예전(따로 뽑음)은 0 근처, AR(1)은 φ 근처
    let num = 0, den = 0;
    for (let s = 0; s < 40; s++) {
      const x = YEARS.map((y) => seasonCor(league(`ac-${s}`, {}), y)! - COR_CENTER);
      for (let i = 1; i < x.length; i++) { num += x[i] * x[i - 1]; den += x[i - 1] ** 2; }
    }
    expect(num / den).toBeGreaterThan(0.5);
  });

  it('예전 저장: 칸이 없으면 예전 값, legacyTo까지는 예전 값이고 다음 해부터 그 값에서 AR(1)', () => {
    const old = league('legacy');
    const mixed = league('legacy', { legacyTo: 2035 });
    for (let y = 2027; y <= 2035; y++) expect(seasonCor(mixed, y)).toBe(seasonCor(old, y));
    // 2036은 예전 2035 값에서 출발한 AR(1): 새 리그의 2036과도, 예전 방식의 2036과도 (보통) 다르다
    expect(seasonCor(mixed, 2036)).not.toBe(seasonCor(old, 2036));
    expect(seasonCor(mixed, 2036)).not.toBe(seasonCor(league('legacy', {}), 2036));
    // 이어지는 정도: 2036 값과 예전 2035 값의 차이는 한 해 AR(1) 걸음 안 (가운데 끌림 + 4σ)
    const a = seasonCor(old, 2035)!, b = seasonCor(mixed, 2036)!;
    expect(Math.abs(b - a)).toBeLessThan((1 - COR_AR_PHI) * Math.abs(a - COR_CENTER) + 0.0125 + 1e-4);
  });
});

describe('예전 저장 불러오기 (세션)', () => {
  let store: DataStore;
  beforeAll(() => {
    store = loadDataStore();
  });

  it('ballCor 칸이 없는 저장은 불러올 때 지금 월드 해를 legacyTo로 적고, 2026 저장은 새 게임과 같은 앞날 값이 나온다', () => {
    const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
    const g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'ball-cor' }, FAST);
    expect(g.league.ballCor).toEqual({});
    const save = JSON.parse(JSON.stringify(g.toSave()));
    delete save.league.ballCor;
    const h = GameSession.load(store, save, FAST);
    expect(h.league.ballCor).toEqual({ legacyTo: 2026 });
    for (const y of [2027, 2030, 2040]) expect(ballHrMul(h.league, y)).toBe(ballHrMul(g.league, y));
    // 칸이 있는 저장은 그대로 (새 게임 저장 → 불러오기)
    const k = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), FAST);
    expect(k.league.ballCor).toEqual({});
  });
});
