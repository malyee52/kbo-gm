// 잠재력 v2: 숨은 천장과 숨은 성장 성향 (능력치 v2 기획안 17·18장, 16-4). 시험 목록은 기획안 18.7·17.10
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { Rng, worldForYear } from '../src/engine';
import { currentRuns, valueContext } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { careerIndex, growthRoom, growthRuns, realPeakRuns } from '../src/league/growth';
import {
  ageWidth, bestSeasonWar, draftIndex, entryGap, entryPathOf, gradeRuns, realCeiling, recentSample, runsGradeRaw, runsPerGrade,
  type RealCeilingInput,
} from '../src/league/potential';
import type { LeagueState } from '../src/league/types';

let store: DataStore;
const leagues = new Map<string, ReturnType<typeof createLeague>>();
const leagueOf = (year: number, seed: string) => {
  const k = `${year}/${seed}`;
  if (!leagues.has(k)) leagues.set(k, createLeague(store, year, seed));
  return leagues.get(k)!;
};
const grade = (runs: number, year: number) => Math.max(20, Math.min(80, Math.round(runsGradeRaw(runs, year))));
const byId = (l: LeagueState, id: string) => l.players.find((p) => p.id === id)!;

/** 2026 시작판 실존 선수의 천장 입력 (createLeague와 같은 값) */
function inputsOf(year: number, seed: string): Map<string, RealCeilingInput> {
  const { league } = leagueOf(year, seed);
  const recorded = { world: worldForYear(store, year) };
  const ctx = valueContext(recorded.world);
  const idx = careerIndex(store);
  const drafts = draftIndex(store);
  const out = new Map<string, RealCeilingInput>();
  for (const sp of recorded.world.players) {
    const lp = league.players.find((p) => p.id === sp.id);
    if (!lp || lp.foreign || lp.entryYear >= year) continue;
    out.set(sp.id, {
      id: sp.id, now: currentRuns(sp, ctx), peakBefore: realPeakRuns(sp, idx, store, ctx, undefined, year), bestWar: bestSeasonWar(sp, idx, store, year),
      age: sp.age, sample: recentSample(sp, idx, year), year, room: growthRoom(sp.age ?? 28), draft: drafts.get(sp.id),
    });
  }
  return out;
}

beforeAll(() => {
  store = loadDataStore();
});

describe('잠재력 v2: 실존 선수 천장 (18.2)', () => {
  it('2026판 김도영(2024 8.6승, 극단 줄)은 판마다 천장 80 고정이고 성장 성향은 ¼ 폭', () => {
    for (const seed of ['pot-a', 'pot-b', 'pot-c']) {
      const p = byId(leagueOf(2026, seed).league, '52605');
      expect(grade(p.potential, 2026), seed).toBe(80);
      expect(Math.abs(p.drive ?? 0)).toBeLessThanOrEqual(0.25);
    }
  });

  it('고정 선수(시작 전 2승+)는 천장이 보여 준 고점 아래로 안 가고, 기준 ± 나이 폭 ½ 안에 있다', () => {
    const inputs = inputsOf(2026, 'pot-a');
    const { league } = leagueOf(2026, 'pot-a');
    let fixed = 0;
    for (const [id, x] of inputs) {
      if ((x.bestWar ?? -1) < 2 || (x.bestWar ?? 0) >= 8) continue;
      fixed++;
      const p = byId(league, id);
      if (x.peakBefore !== null) expect(p.potential, id).toBeGreaterThanOrEqual(x.peakBefore - 1e-9);
      const base = Math.max(x.peakBefore ?? -Infinity, x.now + x.room);
      const half = ageWidth((x.age ?? 27) + 1) * 0.5 * runsPerGrade(2026);
      // 시작 월드에서 다시 잰 지금 능력이 천장을 받치는 경우(아주 조금 위)만 빼면 기준 ± 반폭 안
      expect(p.potential, id).toBeLessThanOrEqual(Math.max(base + half, x.now) + 1);
    }
    // 기획안 18.2 어림: 2026판 고정 169명 (8승+ 포함). 선수 ID로 다시 세면 조금 다르다
    expect(fixed).toBeGreaterThan(100);
  });

  it('같은 리그 시드면 같은 천장·성향, 다른 시드면 범위 선수의 천장이 달라진다', () => {
    const a = createLeague(store, 2026, 'pot-same').league;
    const b = createLeague(store, 2026, 'pot-same').league;
    expect(a.players.map((p) => [p.id, p.potential, p.drive])).toEqual(b.players.map((p) => [p.id, p.potential, p.drive]));
    const c = leagueOf(2026, 'pot-b').league;
    const changed = a.players.filter((p) => { const q = c.players.find((x) => x.id === p.id); return q && Math.abs(q.potential - p.potential) > 0.5; });
    expect(changed.length).toBeGreaterThan(100);
  });

  it('모든 선수의 지금 능력은 천장을 넘지 않는다 (시작 월드 기준)', () => {
    for (const [year, seed] of [[2026, 'pot-a'], [2022, 'pot-a'], [2001, 'pot-a']] as const) {
      const { league, world } = leagueOf(year, seed);
      const ctx = valueContext(world);
      for (const sp of world.players) expect(currentRuns(sp, ctx), `${year} ${sp.name}`).toBeLessThanOrEqual(byId(league, sp.id).potential + 1e-6);
    }
  });

  it('시작 연도 뒤 기록은 천장을 바꾸지 않는다 (2015판, 자료를 2015년까지로 잘라도 같은 값)', () => {
    const cut: DataStore = { ...store, meta: { ...store.meta, years: store.meta.years.filter((y) => y <= 2015) }, season: (y: number) => (y <= 2015 ? store.season(y) : undefined) } as DataStore;
    const full = leagueOf(2015, 'pot-cut').league;
    const short = createLeague(cut, 2015, 'pot-cut').league;
    // 시작 전 1군 기록이 있는 실존 선수만 (늦게 데뷔하는 지명자는 지명 신인 길이라 실제 고점 ¼을 일부러 쓴다, Q10 ②)
    let n = 0;
    for (const p of short.players) {
      if (p.foreign || p.entryYear >= 2015 || (store.players.get(p.id)?.first ?? 9999) >= 2015) continue;
      const q = full.players.find((x) => x.id === p.id);
      if (!q) continue;
      expect(q.potential, p.name).toBeCloseTo(p.potential, 6);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  }, 120_000);

  it('바닥 선수(2026 차승준·정민규, 지금 20대 등급)도 판의 일부에서는 천장 50+ (F3 바닥, 18.4)', () => {
    const inputs = inputsOf(2026, 'pot-a');
    const { league } = leagueOf(2026, 'pot-a');
    for (const name of ['차승준', '정민규']) {
      const x = [...inputs.values()].find((v) => byId(league, v.id).name === name);
      expect(x, name).toBeDefined();
      let hi = 0;
      const N = 400;
      for (let i = 0; i < N; i++) if (runsGradeRaw(realCeiling(x!, `floor-${i}`).potential, 2026) >= 50) hi++;
      // 기획안 18.4 어림: 차승준 36%, 정민규 18% (F0 식이면 11%·0%)
      expect(hi / N, name).toBeGreaterThan(0.1);
      expect(hi / N, name).toBeLessThan(0.7);
    }
  });
});

describe('잠재력 v2: 지명 신인·시작 연도 신인 (18.3)', () => {
  it('2022판 김도영(시작 연도 신인)은 생성기로 매겨 천장이 판마다 다르다 (지명 순위 표 중심 + 실제 고점 ¼)', () => {
    const gs = ['pot-a', 'pot-b', 'pot-c', 'pot-d', 'pot-e', 'pot-f'].map((s) => grade(byId(leagueOf(2022, s).league, '52605').potential, 2022));
    expect(new Set(gs).size).toBeGreaterThanOrEqual(3);
    // 기획안 18.3 어림 (k = ¼): 10/50/90% 49 / 61 / 72. 여섯 판이 모두 80에 붙지 않는다
    expect(gs.filter((g) => g >= 80).length).toBeLessThan(3);
    expect(Math.min(...gs)).toBeGreaterThanOrEqual(35);
  });

  it('2001판 이대호·김태균(시작 연도 신인)은 범위에서 뽑히고, 지금 능력은 2001 기록이 아니라 생성기 (Q11 ①)', () => {
    for (const id of ['71564', '71752']) {
      const gs = ['pot-a', 'pot-b', 'pot-c', 'pot-d'].map((s) => grade(byId(leagueOf(2001, s).league, id).potential, 2001));
      expect(new Set(gs).size, id).toBeGreaterThanOrEqual(2);
      expect(Math.max(...gs), id).toBeLessThanOrEqual(80);
      const p = byId(leagueOf(2001, 'pot-a').league, id);
      expect(p.estimated, id).toBe(false);
    }
  });
});

describe('잠재력 v2: 고졸·대졸 (18.5)', () => {
  it('같은 천장이면 대졸 22세 입단의 시작이 고졸 18세보다 높고, 22세에 기대 지금 능력 차이가 2등급 안', () => {
    const P = gradeRuns(60, 2026);
    const hs = entryPathOf('HS', 18, 18);
    const un = entryPathOf('UNIV', 22, 18);
    expect(hs).toEqual({ path: 'hs', years: 0 });
    expect(un).toEqual({ path: 'univ', years: 4 });
    const hsStart = P - entryGap(growthRoom(18), hs.years, hs.path);
    const unStart = P - entryGap(growthRoom(18), un.years, un.path);
    expect(unStart).toBeGreaterThan(hsStart);
    // 고졸: 18 → 22세 네 번의 오프시즌 성장 (2군 기회 0.8, 성향 0), 여러 운 평균
    let sum = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      let r = hsStart;
      for (let age = 19; age <= 22; age++) r = Math.min(P, growthRuns(age, r, P, 0.8, new Rng(`edu/${i}/${age}`), false, 1, 0));
      sum += r;
    }
    const hsAt22 = sum / N;
    expect(Math.abs(runsGradeRaw(hsAt22, 2026) - runsGradeRaw(unStart, 2026))).toBeLessThan(2);
  });
});

describe('잠재력 v2: 숨은 성장 성향은 어디에도 보이지 않는다 (17.4 ②)', () => {
  it('화면·AI·소식 코드가 drive를 읽지 않는다 (소스 검사)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    for (const d of ['src/ui', 'src/ai', 'src/fantasy']) walk(d);
    walk('src/game');
    const leaks = files.filter((f) => {
      const src = readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      return /\.drive\b|driveOf|driveScale/.test(src);
    });
    expect(leaks).toEqual([]);
  });
});
