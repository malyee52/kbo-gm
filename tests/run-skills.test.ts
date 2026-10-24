// 능력치 v2 16-3: 주루·작전·포수·투수 짝 손잡이 (도루 스타트·판단, 주루 판단, 번트 수행, 포수 블로킹·프레이밍, 견제·퀵모션).
// 모두 0(리그 평균)이면 손잡이가 없을 때와 같은 결과이고, 올리면 맞는 쪽으로 움직인다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyRunTally, Season, simulateSeason, worldForYear, type EngineParams, type World } from '../src/engine';
import { addLogit } from '../src/engine/rules';
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
    const zero = worldWith({ sbStart: 0, sbJudge: 0, runIQ: 0, bunting: 0, cBlock: 0, cFrame: 0 }, { hold: 0, quick: 0 });
    const a = run(base);
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
});
