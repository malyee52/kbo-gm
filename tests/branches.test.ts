// 갈래 성장과 갈래 천장 (능력치 v2 16-4a, 기획안 2.3·2.4·17.2, league/branches.ts)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Rng } from '../src/engine';
import { valueContext, type ValueContext } from '../src/ai/value';
import { createLeague } from '../src/league/create';
import { growBranches, makeCeiling, timingOf, BAT_BRANCHES, PIT_BRANCHES } from '../src/league/branches';
import { growthRuns, runsOf } from '../src/league/growth';
import type { LeaguePlayer } from '../src/league/types';

let store: DataStore;
let league: ReturnType<typeof createLeague>['league'];
let ctx: ValueContext;
const YEAR = 2026;
const ln = Math.log;

beforeAll(() => {
  store = loadDataStore();
  const made = createLeague(store, YEAR, 'br-a');
  league = made.league;
  ctx = valueContext(made.world);
});

const batter = (pred: (p: LeaguePlayer) => boolean) => league.players.find((p) => !p.isPitcher && p.bat && p.ceil?.bat && pred(p))!;
const age = (p: LeaguePlayer) => YEAR + 1 - (p.birthYear ?? YEAR - 27);

describe('갈래 천장 P_c', () => {
  it('같은 시드면 같은 갈래 천장·τ, 다른 시드면 τ가 달라진다', () => {
    const again = createLeague(store, YEAR, 'br-a').league;
    const other = createLeague(store, YEAR, 'br-b').league;
    let diff = 0;
    for (const p of league.players.slice(0, 200)) {
      const q = again.players.find((x) => x.id === p.id)!;
      expect(q.ceil).toEqual(p.ceil);
      expect(q.timing).toBe(p.timing);
      if (other.players.find((x) => x.id === p.id)!.timing !== p.timing) diff++;
    }
    expect(diff).toBeGreaterThan(150);
  });

  it('갈래마다 천장은 지금 능력보다 나쁘지 않다 (좋은 방향으로만), 종합 천장 런은 potential 근처', () => {
    let checked = 0;
    for (const p of league.players) {
      if (!p.ceil) continue;
      if (p.bat && p.ceil.bat) {
        for (const k of BAT_BRANCHES) {
          const good = k === 'so' ? -1 : 1;
          expect(good * (ln(p.ceil.bat[k]) - ln(p.bat[k]))).toBeGreaterThanOrEqual(-1e-4);
        }
      }
      if (p.pit && p.ceil.pit) {
        for (const k of PIT_BRANCHES) {
          const good = k === 'so' ? 1 : -1;
          expect(good * (ln(p.ceil.pit[k]) - ln(p.pit[k]))).toBeGreaterThanOrEqual(-1e-4);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
    // 천장 모양을 넣은 능력의 런이 종합 천장과 가깝다 (지금보다 나쁜 갈래를 지금 값으로 올린 몫만큼 위)
    let near = 0;
    let n = 0;
    for (const p of league.players) {
      if (!p.ceil || p.isPitcher || !p.bat || !p.ceil.bat) continue;
      const now = runsOf(p, ctx, YEAR);
      if (p.potential < now + 3) continue;
      const atCeil = runsOf({ ...p, bat: { ...p.bat, ...p.ceil.bat } }, ctx, YEAR);
      n++;
      if (atCeil >= p.potential - 0.5 && atCeil <= p.potential + 4) near++;
      else expect(atCeil).toBeGreaterThan(p.potential);
    }
    expect(n).toBeGreaterThan(50);
    // 16-5 여유분 실측으로 격차가 큰 선수가 줄어 +4 넘는 몫(모두 위쪽, 2026 시드 br-a 230명 중 23명)이 10%가 됐다
    expect(near / n).toBeGreaterThan(0.85);
  });

  it('김도영(극단 천장) τ는 ¼ 폭 안, 다른 실존 선수 τ는 ±2해 안', () => {
    const kim = league.players.find((p) => p.name === '김도영')!;
    expect(Math.abs(kim.timing!)).toBeLessThanOrEqual(DEFAULT_PARAMS.growth2.tauSpan * DEFAULT_PARAMS.potential.extremeDrive + 1e-9);
    for (const p of league.players) if (p.timing !== undefined) expect(Math.abs(p.timing)).toBeLessThanOrEqual(DEFAULT_PARAMS.growth2.tauSpan + 1e-9);
    expect(timingOf('br-a', kim.id, true)).toBe(kim.timing);
  });
});

describe('갈래 성장', () => {
  /** 천장을 넉넉히 둔 시험용 선수 */
  const roomy = (p: LeaguePlayer): LeaguePlayer => {
    const q = { ...p, potential: runsOf(p, ctx, YEAR) + 25 };
    return { ...q, ceil: makeCeiling(q, ctx, YEAR, 'br-test') };
  };

  it('목표 런을 맞춘다 (자랄 때·떨어질 때)', () => {
    const p = roomy(batter((x) => age(x) <= 24));
    const now = runsOf(p, ctx, YEAR);
    for (const target of [now + 4, now - 4]) {
      const g = growBranches(p, p.ceil!, target, ctx, YEAR, { age: 23, timing: 0, stream: 'br/t' });
      expect(runsOf({ ...p, ...g }, ctx, YEAR)).toBeCloseTo(target, 1);
    }
  });

  it('갈래 곡선 모양: 22세 이하는 파워·선구가 컨택보다 많이 크고, 35세는 파워가 선구보다 많이 떨어진다', () => {
    const p = roomy(batter((x) => age(x) <= 26));
    const now = runsOf(p, ctx, YEAR);
    const rel = (g: { bat: LeaguePlayer['bat'] }, k: 'hr' | 'bb' | 's1') => ln(g.bat![k]) - ln(p.bat![k]);
    // 해마다 운이 갈래 무게에 섞이므로 여러 줄기 평균으로 본다
    let hrUp = 0; let s1Up = 0; let bbUp = 0; let hrDown = 0; let bbDown = 0;
    for (let i = 0; i < 40; i++) {
      const up = growBranches(p, p.ceil!, now + 4, ctx, YEAR, { age: 21, timing: 0, stream: `br/u${i}` });
      hrUp += rel(up, 'hr'); s1Up += rel(up, 's1'); bbUp += rel(up, 'bb');
      const down = growBranches(p, p.ceil!, now - 4, ctx, YEAR, { age: 36, timing: 0, stream: `br/d${i}` });
      hrDown += rel(down, 'hr'); bbDown += rel(down, 'bb');
    }
    expect(hrUp).toBeGreaterThan(s1Up * 2);
    expect(bbUp).toBeGreaterThan(s1Up * 2);
    expect(hrDown).toBeLessThan(bbDown * 2);
    expect(hrDown).toBeLessThan(0);
  });

  it('천장이 다 찬 갈래는 자라지 않고, 자란 갈래도 천장을 넘지 않는다', () => {
    const p = roomy(batter((x) => age(x) <= 24));
    const ceil = { ...p.ceil!, bat: { ...p.ceil!.bat!, hr: p.bat!.hr } };
    const now = runsOf(p, ctx, YEAR);
    for (let i = 0; i < 20; i++) {
      const g = growBranches(p, ceil, now + 6, ctx, YEAR, { age: 22, timing: 0, stream: `br/c${i}`, breakout: i % 2 === 0 });
      expect(g.bat!.hr).toBeCloseTo(p.bat!.hr, 9);
      for (const k of BAT_BRANCHES) {
        const good = k === 'so' ? -1 : 1;
        expect(good * (ln(g.bat![k]) - ln(ceil.bat[k]))).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('엇갈린 성장: 천장 모양이 다르면 같은 성장 총량이 다른 갈래로 간다 (파워 천장 높은 선수는 홈런, 컨택 천장 높은 선수는 단타)', () => {
    const p = batter((x) => age(x) <= 24);
    const now = runsOf(p, ctx, YEAR);
    const power = { pa: now + 20, bat: { ...pick(p), hr: p.bat!.hr * 1.6, s1: p.bat!.s1 } };
    const contact = { pa: now + 20, bat: { ...pick(p), hr: p.bat!.hr, s1: p.bat!.s1 * 1.25 } };
    const a = growBranches(p, power, now + 5, ctx, YEAR, { age: 24, timing: 0, stream: 'br/x' });
    const b = growBranches(p, contact, now + 5, ctx, YEAR, { age: 24, timing: 0, stream: 'br/x' });
    expect(a.bat!.hr / p.bat!.hr).toBeGreaterThan(b.bat!.hr / p.bat!.hr);
    expect(b.bat!.s1 / p.bat!.s1).toBeGreaterThan(a.bat!.s1 / p.bat!.s1);
  });

  it('시기 τ: 대기만성(+2)은 21세에 덜 크고 28세에 더 크며, 일찍 크는 선수(−2)는 반대 (노화에는 안 씀)', () => {
    // 한 해 상한(growthCap)에 걸리지 않는 작은 격차로 본다
    const grow = (a: number, t: number) => growthRuns(a, 0, 8, 1, new Rng('br/tau'), false, 1, 0, undefined, t) - growthRuns(a, 0, 8, 1, new Rng('br/tau'), false, 1, 0, undefined, 0);
    expect(grow(21, 2)).toBeLessThan(0);
    expect(grow(28, 2)).toBeGreaterThan(0);
    expect(grow(21, -2)).toBeGreaterThan(0);
    expect(grow(28, -2)).toBeLessThan(0);
    expect(growthRuns(34, 10, 30, 1, new Rng('br/old'), false, 1, 0, undefined, 2)).toBe(growthRuns(34, 10, 30, 1, new Rng('br/old'), false, 1, 0, undefined, 0));
  });

  it('투수도 갈래로 자란다: 목표를 맞추고 체력 같은 갈래 밖 능력은 그대로', () => {
    const p0 = league.players.find((x) => x.isPitcher && x.pit && age(x) <= 25)!;
    const p = roomy(p0);
    const now = runsOf(p, ctx, YEAR);
    const g = growBranches(p, p.ceil!, now + 3, ctx, YEAR, { age: 23, timing: 0, stream: 'br/p' });
    expect(runsOf({ ...p, ...g }, ctx, YEAR)).toBeCloseTo(now + 3, 1);
    expect(g.pit!.stamina).toBe(p.pit!.stamina);
  });
});

function pick(p: LeaguePlayer) {
  const b = p.bat!;
  return { so: b.so, bb: b.bb, s1: b.s1, d2: b.d2, t3: b.t3, hr: b.hr };
}
