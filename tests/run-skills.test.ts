// 능력치 v2 16-3: 주루·작전·포수·투수 짝 손잡이 (도루 스타트·판단, 주루 판단, 번트 수행, 포수 블로킹·프레이밍, 견제·퀵모션).
// 모두 0(리그 평균)이면 손잡이가 없을 때와 같은 결과이고, 올리면 맞는 쪽으로 움직인다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyRunTally, Season, simulateSeason, worldForYear, type EngineParams, type World } from '../src/engine';
import { addLogit } from '../src/engine/rules';
import { armWord, bodyGrade, experienceGrade, measuredBunting, measuredRunIQ, runGradesOf } from '../src/engine/runskills';
import type { BatSkill, PitSkill, SimPlayer } from '../src/engine/types';

const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let store: DataStore;
let base: World;
let cal: ReturnType<typeof simulateSeason>['cal'];

/** 2019 월드 (자동 볼 판정 전 해라 프레이밍이 작동한다)를 새로 만들고 선수 손잡이를 바꾼다 */
function worldWith(bat: Partial<BatSkill>, pit: Partial<PitSkill>): World {
  const w = worldForYear(store, 2019, FAST);
  for (const p of w.players as SimPlayer[]) {
    if (p.bat) Object.assign(p.bat, bat);
    if (p.pit) Object.assign(p.pit, pit);
  }
  return w;
}

function run(w: World, seed = 'skill2') {
  const running = emptyRunTally();
  const s = Season.start(w, FAST, seed, { running, cal });
  s.runToEnd();
  return { running, t: s.totals, bat: s.bat };
}

beforeAll(() => {
  store = loadDataStore();
  base = worldForYear(store, 2019, FAST);
  cal = simulateSeason(base, FAST, 'skill2-cal').cal;
}, 120_000);

describe('주루·작전 손잡이 (능력치 v2 16-3)', () => {
  it('addLogit: 0이면 확률 그대로 (0~1 밖도), 아니면 로짓 덧셈', () => {
    for (const p of [-0.2, 0, 0.013, 0.5, 0.97, 1.3]) expect(addLogit(p, 0)).toBe(p);
    expect(addLogit(0.5, Math.log(3))).toBeCloseTo(0.75, 12);
    expect(addLogit(0.7, -1)).toBeLessThan(0.7);
  });

  it('손잡이를 모두 0으로 둔 월드는 손잡이가 없는 월드와 한 시즌 결과가 같다', () => {
    const zero = worldWith({ sbStart: 0, sbJudge: 0, runIQ: 0, bunting: 0, cBlock: 0, cFrame: 0, arm: 0 }, { hold: 0, quick: 0 });
    const u = undefined;
    const a = run(worldWith({ sbStart: u, sbJudge: u, runIQ: u, bunting: u, cBlock: u, cFrame: u, arm: u }, { hold: u, quick: u }));
    const b = run(zero);
    expect(b.t).toEqual(a.t);
    expect(b.running).toEqual(a.running);
    expect(b.bat).toEqual(a.bat);
  }, 120_000);

  it('도루 스타트↑ 성공률↑, 투수 퀵모션↑ 성공률↓, 도루 판단↑ 시도↑, 견제↑ 시도↓·견제사↑', () => {
    const pct = (r: ReturnType<typeof run>) => r.t.sb / (r.t.sb + r.t.cs);
    const att = (r: ReturnType<typeof run>) => r.t.sb + r.t.cs;
    const a = run(base);
    const start = run(worldWith({ sbStart: 0.8 }, {}));
    const quick = run(worldWith({}, { quick: 0.8 }));
    const judge = run(worldWith({ sbJudge: 0.5 }, {}));
    const hold = run(worldWith({}, { hold: 0.5 }));
    expect(pct(start)).toBeGreaterThan(pct(a) + 0.05);
    expect(pct(quick)).toBeLessThan(pct(a) - 0.05);
    expect(att(judge)).toBeGreaterThan(att(a) * 1.3);
    expect(att(hold)).toBeLessThan(att(a) * 0.8);
    expect(hold.running.pickoff).toBeGreaterThan(a.running.pickoff);
  }, 240_000);

  it('포수 블로킹↑ 폭투·포일↓, 프레이밍↑ 삼진↑·볼넷↓ (2019, 자동 판정 전)', () => {
    const a = run(base);
    const block = run(worldWith({ cBlock: 0.7 }, {}));
    const frame = run(worldWith({ cFrame: 0.5 }, {}));
    expect(block.t.wildPitches).toBeLessThan(a.t.wildPitches * 0.7);
    expect(frame.t.so).toBeGreaterThan(a.t.so * 1.02);
    expect(frame.t.bb).toBeLessThan(a.t.bb * 0.98);
  }, 180_000);

  it('자동 판정 해(2025)에는 프레이밍이 결과를 바꾸지 않는다', () => {
    const w0 = worldForYear(store, 2025, FAST);
    const c = simulateSeason(w0, FAST, 'skill2-cal').cal;
    const w1 = worldForYear(store, 2025, FAST);
    for (const p of w1.players) if (p.bat) p.bat.cFrame = 0.8;
    const a = Season.start(w0, FAST, 'abs', { cal: c });
    const b = Season.start(w1, FAST, 'abs', { cal: c });
    a.runToEnd();
    b.runToEnd();
    expect(b.totals).toEqual(a.totals);
  }, 180_000);

  it('주루 판단↑ 추가 진루↑ (득점↑), 번트 수행↑ 희생번트 성공 몫↑', () => {
    const a = run(base);
    const iq = run(worldWith({ runIQ: 1, bunting: 1 }, {}));
    expect(iq.t.r).toBeGreaterThan(a.t.r);
    expect(iq.t.outsOnBases).toBeLessThan(a.t.outsOnBases);
    const sac = (r: ReturnType<typeof run>) => r.running.buntSac / r.running.bunt;
    expect(sac(iq)).toBeGreaterThan(sac(a) + 0.05);
  }, 180_000);

  it('어깨↑ (16-3d) 희생플라이·득점↓, 병살↑', () => {
    const a = run(base);
    const strong = run(worldWith({ arm: 0.2 }, {}));
    expect(strong.t.sf).toBeLessThan(a.t.sf * 0.95);
    expect(strong.t.gdp).toBeGreaterThan(a.t.gdp * 1.1);
    expect(strong.t.r).toBeLessThan(a.t.r);
  }, 180_000);
});

describe('시작값 (나이 평균, 가상 선수 분포, 포수 수비)', () => {
  it('나이 곡선은 기획안 9.5 표와 같다 (경험 21·25·29·33·37세 45·48·51·53·53, 몸 50·51·51·49·46, 반올림 1칸 안)', () => {
    const ages = [21, 25, 29, 33, 37];
    expect(ages.map((a) => Math.round(experienceGrade(a)))).toEqual([45, 48, 51, 53, 53]);
    ages.map(bodyGrade).forEach((g, i) => expect(Math.abs(g - [50, 51, 51, 49, 46][i])).toBeLessThanOrEqual(1));
    expect(experienceGrade(null)).toBe(50);
    expect(bodyGrade(null)).toBe(50);
  });

  it('실존 선수는 나이만으로 정해지고, 가상 선수는 선수 ID마다 같은 값을 뽑아 퍼진다 (표준편차 약 8등급)', () => {
    const bat = { so: 1, bb: 1, hbp: 1, hr: 1, s1: 1, d2: 1, t3: 1, sbAtt: 0.05, sbPct: 0.7, speed: 0.5, sample: 300 };
    const real = runGradesOf({ id: 'r1', age: 25, real: true, bat, pit: null }, DEFAULT_PARAMS).bat!;
    const real2 = runGradesOf({ id: 'r2', age: 25, real: undefined, bat, pit: null }, DEFAULT_PARAMS).bat!;
    expect(real).toEqual(real2);
    expect(real.runIQ).toBe(experienceGrade(25));
    expect(real.cBlock).toBe(bodyGrade(25));
    const v = (id: string) => runGradesOf({ id, age: 25, real: false, bat, pit: null }, DEFAULT_PARAMS).bat!.runIQ;
    expect(v('v1')).toBe(v('v1'));
    const xs = Array.from({ length: 2000 }, (_, i) => v(`v${i}`) - experienceGrade(25));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.6);
    expect(sd).toBeGreaterThan(7.4);
    expect(sd).toBeLessThan(8.6);
  });

  it('2026 시작 월드: 손잡이는 리그 대비 (출장량 가중 평균 0), 정규 포수는 포수 수비 런만큼 블로킹이 옮겨진다, 도루 스타트·판단은 없다', () => {
    const w = worldForYear(store, 2026, FAST);
    const sc = DEFAULT_PARAMS.skill2.scale;
    const hit = w.players.filter((p) => p.bat && !p.isPitcher);
    const wavg = (ps: typeof hit, f: (p: SimPlayer) => number, wt: (p: SimPlayer) => number) =>
      ps.reduce((a, p) => a + f(p) * Math.max(1, wt(p)), 0) / ps.reduce((a, p) => a + Math.max(1, wt(p)), 0);
    expect(wavg(hit, (p) => p.bat!.runIQ ?? 0, (p) => p.bat!.sample)).toBeCloseTo(0, 9);
    const pits = w.players.filter((p) => p.isPitcher && p.pit);
    expect(wavg(pits, (p) => p.pit!.quick ?? 0, (p) => p.pit!.sample)).toBeCloseTo(0, 9);
    const cs = hit.filter((p) => p.bat!.playable?.includes('C'));
    expect(cs.length).toBeGreaterThan(15);
    expect(wavg(cs, (p) => p.bat!.cBlock ?? 0, (p) => p.bat!.sample)).toBeCloseTo(0, 9);
    // 같은 나이 두 포수의 블로킹 차 = 포수 수비 런 차 × catcherPerRun (등급)
    const [a, b] = cs.filter((p) => p.age === cs[0].age && p !== cs[0]).length ? [cs[0], cs.find((p) => p.age === cs[0].age && p !== cs[0])!] : [cs[0], cs[0]];
    const d = ((a.bat!.cBlock ?? 0) - (b.bat!.cBlock ?? 0)) / sc.cBlock * 10;
    expect(d).toBeCloseTo(DEFAULT_PARAMS.skill2.catcherPerRun * ((a.bat!.def?.C ?? 0) - (b.bat!.def?.C ?? 0)), 6);
    expect(hit.every((p) => p.bat!.sbStart === undefined && p.bat!.sbJudge === undefined)).toBe(true);
  });

  it('어깨 낱말 (16-3d): 앞날 시기는 버리고, 오래된 시기는 줄여 평균한다', () => {
    expect(armWord(undefined, 2026)).toBe(0);
    expect(armWord([[1, null, null]], 2026)).toBe(1);
    expect(armWord([[1, 2026, 2027]], 2026)).toBe(0);
    expect(armWord([[-1, 2014, 2025]], 2026)).toBe(-1);
    // 2018 끝(8년 전, 무게 0.7^5) 좋음 + 통산 나쁨 (무게 1)
    const w = 0.7 ** 5;
    expect(armWord([[1, 2010, 2018], [-1, null, null]], 2026)).toBeCloseTo((w - 1) / (w + 1), 12);
  });

  it('주루 판단·번트 실측 (16-3d): 직전 3시즌만, 주력 몫을 빼고, 기습 번트 몫을 빼고, 표본만큼 당긴다', () => {
    // [기회, 성공, 주루사, 리그 기대, 희생번트, W·V 공]
    const rows = { '2022': [100, 90, 0, 50, 0, 0], '2023': [40, 25, 1, 20, 6, 2], '2025': [40, 25, 1, 20, 4, 2], '2026': [100, 0, 0, 50, 0, 50] } as Record<string, [number, number, number, number, number, number]>;
    // 2023·2025만: 기회 80, 성공 50, 기대 40 → 기회당 +0.125, p 0.5 → 로짓 0.5, 당김 80 ÷ (80 + 80)
    expect(measuredRunIQ(rows, 2026, 0.5, 80)).toBeCloseTo(0.25, 12);
    // 주력 0.9면 엔진 주력 몫 (0.4 × 0.3) = 0.12를 빼고 0.005만 남는다
    expect(measuredRunIQ(rows, 2026, 0.9, 80)).toBeCloseTo(0.5 * (0.125 - 0.12) / 0.25, 12);
    expect(measuredRunIQ(undefined, 2026, 0.5, 80)).toBe(0);
    expect(measuredRunIQ(rows, 2022, 0.5, 80)).toBe(0);
    // 번트: 희생번트 10 · W·V 4, 리그 1:1 (L 0.5) → (10 + 15) ÷ (14 + 30)
    const lg = { '2023': [100, 100], '2024': [50, 50], '2025': [100, 100] } as Record<string, [number, number]>;
    const post = 25 / 44;
    expect(measuredBunting(rows, lg, 2026, 30)).toBeCloseTo(Math.log(post / (1 - post)), 12);
    expect(measuredBunting(rows, undefined, 2026, 30)).toBe(0);
    // 기습 번트 몫 (16-3e, 7번째 칸): 선수 W·V 4 − 2 = 2, 리그 W·V 250 − 50 = 200 (L = 250 ÷ 450) → 당긴 평균 (10 + 30L) ÷ (12 + 30)
    const rowsH = { '2023': [40, 25, 1, 20, 6, 2, 1.5], '2025': [40, 25, 1, 20, 4, 2, 0.5] } as Record<string, [number, number, number, number, number, number, number]>;
    const lgH = { '2023': [100, 100, 20], '2024': [50, 50, 10], '2025': [100, 100, 20] } as Record<string, [number, number, number]>;
    const L = 250 / 450;
    const postH = (10 + 30 * L) / 42;
    expect(measuredBunting(rowsH, lgH, 2026, 30)).toBeCloseTo(Math.log(postH / (1 - postH)) - Math.log(L / (1 - L)), 12);
  });

  it('2026 시작 월드: 어깨는 리그 대비 (타자 출장량 가중 평균 0), 어깨 좋음 낱말 선수(구자욱)는 같은 나이 실존 선수보다 armWord만큼 위', () => {
    const w = worldForYear(store, 2026, FAST);
    const sp = DEFAULT_PARAMS.skill2;
    const hit = w.players.filter((p) => p.bat && !p.isPitcher);
    const tw = hit.reduce((a, p) => a + Math.max(1, p.bat!.sample), 0);
    expect(hit.reduce((a, p) => a + (p.bat!.arm ?? 0) * Math.max(1, p.bat!.sample), 0) / tw).toBeCloseTo(0, 9);
    const koo = hit.find((p) => p.id === '62404')!;
    const peer = hit.find((p) => p.real !== false && p.age === koo.age && !store.defense?.arm?.[p.id])!;
    expect(((koo.bat!.arm ?? 0) - (peer.bat!.arm ?? 0)) / sp.scale.arm * 10).toBeCloseTo(sp.armWord, 6);
  });
});
