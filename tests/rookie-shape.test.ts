// 실존 지명 신인의 기록 모양 (2026-11-04 사용자 결정): league/offseason.ts applyShape(career)·makeDraftee, league/growth.ts careerShapeOf.
// - 실제 커리어가 충분하면 그 기록의 모양 그대로, 표본이 적으면 몫만큼 분포와 섞고, 기록이 없으면 가상 선수와 같은 뽑기다.
// - 모양(비율)만 쓴다: 총량(지금 런)과 잠재력은 모양 크기와 관계없이 지명 규칙 그대로이고, 공유 난수 흐름도 바뀌지 않는다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng, type BatSkill } from '../src/engine';
import { createLeague } from '../src/league/create';
import { BAT_SHIFT, careerIndex, careerShapeOf, PIT_SHIFT, runsOf, type CareerIndex } from '../src/league/growth';
import { applyShape, draftPool, leagueView, makeDraftee, takenNames } from '../src/league/offseason';
import { SHAPE_BAT_KEYS, SHAPE_PIT_KEYS } from '../src/league/shapeTable';
import type { LeaguePlayer, LeagueState } from '../src/league/types';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const size = DEFAULT_PARAMS.shape;
const flatBat = (): BatSkill => ({ so: 1, bb: 1, hbp: 1, hr: 1, s1: 1, d2: 1, t3: 1, sbAtt: 0.06, sbPct: 0.7, speed: 0.5, sample: 0 });

/** log 비율에서 성장 방향을 뺀 나머지 */
function residual(x: number[], w: number[]): number[] {
  const c = x.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((s, v) => s + v * v, 0);
  return x.map((v, i) => v - c * w[i]);
}
const batShape = (b: BatSkill) => residual(SHAPE_BAT_KEYS.map((k) => Math.log(b[k])), SHAPE_BAT_KEYS.map((k) => BAT_SHIFT[k]));

describe('applyShape 커리어 몫', () => {
  const career = { ...flatBat(), hr: 2.2, so: 1.4, s1: 0.85, t3: 0.3 };
  const shaped = (stream: string, weight: number | null) => {
    const p = { bat: flatBat(), pit: null, pos: 'LF', foreign: false };
    applyShape(p, stream, size, false, 20, weight === null ? null : { weight, bat: career });
    return p.bat;
  };

  it('몫 1이면 줄기와 관계없이 기록의 모양 그대로', () => {
    const want = batShape(career);
    for (const s of ['a', 'b', 'c']) batShape(shaped(s, 1)).forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
  });

  it('몫 0·기록 없음은 가상 선수와 같은 뽑기', () => {
    expect(shaped('x', 0)).toEqual(shaped('x', null));
  });

  it('몫이 커질수록 기록 쪽으로 간다', () => {
    const want = batShape(career)[SHAPE_BAT_KEYS.indexOf('hr')];
    const gap = (w: number) => {
      let s = 0;
      for (let i = 0; i < 300; i++) s += Math.abs(batShape(shaped(`g${i}`, w))[SHAPE_BAT_KEYS.indexOf('hr')] - want);
      return s;
    };
    expect(gap(0.75)).toBeLessThan(gap(0.25));
  });
});

describe('실제 기록', () => {
  let store: DataStore;
  let idx: CareerIndex;
  beforeAll(() => { store = loadDataStore(); idx = careerIndex(store); });
  const idOf = (name: string, pitcher: boolean) => [...store.players.values()].filter((m) => m.name === name && (m.kind === 'P') === pitcher)
    .sort((a, b) => (idx.bat.get(b.id)?.length ?? 0) - (idx.bat.get(a.id)?.length ?? 0))[0].id;

  it('커리어 모양은 거포와 교타자를 가른다', () => {
    const hr = SHAPE_BAT_KEYS.indexOf('hr');
    const of = (name: string) => batShape(careerShapeOf(idOf(name, false), false, null, idx, store, FAST)!.bat!);
    expect(of('박병호')[hr]).toBeGreaterThan(0.3);
    expect(of('이용규')[hr]).toBeLessThan(-0.3);
    expect(careerShapeOf(idOf('이용규', false), false, null, idx, store, FAST)!.run!.skill.sbAtt).toBeGreaterThan(0.1);
  });

  it('기록이 없거나 모양 크기가 0이면 없다', () => {
    expect(careerShapeOf('no-such-player', false, null, idx, store, FAST)).toBeNull();
    expect(careerShapeOf('no-such-player', true, null, idx, store, FAST)).toBeNull();
    expect(careerShapeOf(idOf('박병호', false), false, null, idx, store, { ...FAST, shape: { ...size, bat: 0 } })).toBeNull();
  });

  it('표본이 문턱보다 적으면 그 몫만큼만 믿는다', () => {
    const id = idOf('박병호', false);
    const big = { ...FAST, shape: { ...size, career: { pa: 1e6, bf: 1e6 } } };
    const c = careerShapeOf(id, false, null, idx, store, big)!;
    expect(c.weight).toBeGreaterThan(0);
    expect(c.weight).toBeLessThan(0.1);
    expect(careerShapeOf(id, false, null, idx, store, FAST)!.weight).toBe(1);
  });
});

describe('makeDraftee', () => {
  let store: DataStore;
  let base: LeagueState;
  const ENTRY = 2003;

  /** 시작 리그 복사본에 그 해 지명자를 모두 만든다 */
  function draft(params: typeof FAST) {
    const league: LeagueState = structuredClone(base);
    const view = leagueView(league, store, params);
    const rng = new Rng('rookie-shape');
    const taken = takenNames(league, store);
    let ci: CareerIndex | null = null;
    const career = () => (ci ??= careerIndex(store));
    const made = draftPool(store, ENTRY).map((d, i) => makeDraftee(league, view, rng, taken, d, i, ENTRY, store, career, params.potential));
    return { made, view, after: rng.next(), career: career() };
  }

  beforeAll(() => {
    store = loadDataStore();
    base = createLeague(store, ENTRY - 1, 'rookie-shape', FAST).league;
  }, 300_000);

  it('총량·잠재력·공유 난수는 모양 크기와 관계없고, 충분한 기록은 그 모양이 된다', () => {
    const on = draft(FAST);
    const off = draft({ ...FAST, shape: { ...size, bat: 0, pit: 0 } });
    expect(on.made.length).toBeGreaterThan(30);
    expect(on.after).toBe(off.after);
    on.made.forEach((p, i) => {
      const q: LeaguePlayer = off.made[i];
      expect(p.id).toBe(q.id);
      expect(p.potential).toBe(q.potential);
      expect(runsOf(p, on.view.ctx, ENTRY)).toBeCloseTo(runsOf(q, off.view.ctx, ENTRY), 1);
    });
    const full = on.made.filter((p) => !p.isPitcher && (careerShapeOf(p.id, false, p.bats, on.career, store, FAST)?.weight ?? 0) >= 1);
    expect(full.length).toBeGreaterThan(5);
    for (const p of full) {
      const want = batShape(careerShapeOf(p.id, false, p.bats, on.career, store, FAST)!.bat!);
      batShape(p.bat!).forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
    }
    const pits = on.made.filter((p) => p.isPitcher && !p.underhand && (careerShapeOf(p.id, true, null, on.career, store, FAST)?.weight ?? 0) >= 1);
    expect(pits.length).toBeGreaterThan(3);
    const w = SHAPE_PIT_KEYS.map((k) => PIT_SHIFT[k]);
    for (const p of pits) {
      const c = careerShapeOf(p.id, true, null, on.career, store, FAST)!.pit!;
      const want = residual(SHAPE_PIT_KEYS.map((k) => Math.log(c[k])), w);
      residual(SHAPE_PIT_KEYS.map((k) => Math.log(p.pit![k])), w).forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
    }
  }, 300_000);

  it('같은 시드는 같은 신인', () => {
    const a = draft(FAST).made;
    const b = draft(FAST).made;
    expect(a.map((p) => JSON.stringify([p.bat, p.pit]))).toEqual(b.map((p) => JSON.stringify([p.bat, p.pit])));
  }, 300_000);
});
