// 능력치 v2 16-3: 수비 새 식을 엔진에 (src/engine/fielding.ts defenseV2·virtualDefense, ratings.ts, team.ts·subs.ts 배정 벌점).
// 숫자는 docs/능력치v2_기획안.md 13.1~13.3·14.1~14.2·16.1~16.4의 어림 (운 0)이고, 운(표준편차 1런 = 등급 ±2)만큼 여유를 둔다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { assignSlots, defenseGrade, worldForYear, type SimPlayer, type World } from '../src/engine';
import { defenseV2, fieldLeague, fieldYears, errorMetric, virtualDefense, type DefenseV2 } from '../src/engine/fielding';

let store: DataStore;
let w: World;

beforeAll(() => {
  store = loadDataStore();
  w = worldForYear(store, 2026);
});

const hitter = (name: string): SimPlayer => {
  const c = w.players.filter((p) => p.name === name && !p.isPitcher);
  expect(c, name).toHaveLength(1);
  return c[0];
};
const grade = (p: SimPlayer, q: string) => defenseGrade(p.bat!.def![q as 'SS']!);
const v2Of = (p: SimPlayer, start = 2026): DefenseV2 =>
  defenseV2({ id: p.id, years: fieldYears(store, p.id, start), startYear: start, reps: store.defense!.rep[p.id], awards: store.defenseAwards?.[p.id],
    age: p.age, speed: p.bat!.speed, league: fieldLeague(store.defense!) });

describe('수비 v2 값 (2026 시작)', () => {
  it('박성한: SS·2B 수비 가능, SS ≈ 65 (평판 좋음 20 < 수상 3위 두 해 25), 2B는 유사 손해만큼 낮다', () => {
    const p = hitter('박성한');
    expect(p.bat!.playable).toEqual(['2B', 'SS']);
    expect(grade(p, 'SS')).toBeGreaterThanOrEqual(62);
    expect(grade(p, 'SS')).toBeLessThanOrEqual(68);
    expect(v2Of(p).base.SS).toBeCloseTo(25, 5);
    expect(grade(p, '2B')).toBeLessThan(grade(p, 'SS'));
    expect(grade(p, '3B')).toBe(20);
  });

  it('에레디아: 1B 불가 (20), LF ≈ 65, CF 수비 가능 35 근처 (108이닝), 수비상이 1B로 가지 않는다', () => {
    const p = hitter('에레디아');
    expect(p.bat!.playable).not.toContain('1B');
    expect(grade(p, '1B')).toBe(20);
    expect(grade(p, 'LF')).toBeGreaterThanOrEqual(62);
    expect(p.bat!.playable).toContain('CF');
    expect(grade(p, 'CF')).toBeLessThan(42);
    const v = v2Of(p);
    expect(v.base['1B']).toBe(0);
    expect(v.base.LF).toBeCloseTo(30, 5);
  });

  it('외야 본 자리 선수가 1B 수비 가능이면 실제 1B 이닝이 있다 (안 해 본 1루로 나오지 않는다)', () => {
    for (const p of w.players.filter((x) => !x.isPitcher && ['LF', 'CF', 'RF'].includes(x.pos ?? '') && x.bat?.playable?.includes('1B'))) {
      const inn = fieldYears(store, p.id, 2026).reduce((a, y) => a + (y.inn?.['1B'] ?? 0), 0);
      expect(inn, p.name).toBeGreaterThan(0);
    }
  });

  it('유격수: 평판 좋은 주전 넷(김주원·박찬호·오지환·박성한)이 근거 없는 백업(최재영·이유찬)보다 위', () => {
    const top = ['김주원', '박찬호', '오지환', '박성한'].map((n) => grade(hitter(n), 'SS'));
    const backup = ['최재영', '이유찬'].map((n) => grade(hitter(n), 'SS'));
    expect(Math.min(...top)).toBeGreaterThan(Math.max(...backup) + 10);
  });

  it('박계범 SS 평판은 무게 가중 평균 (합이면 25.8, 가중이면 16.3) — 16.1', () => {
    const v = v2Of(hitter('박계범'));
    expect(v.base.SS).toBeGreaterThan(13);
    expect(v.base.SS).toBeLessThan(18);
  });

  it('김주원: 2025 SS 1위는 2026 시작에 그대로 (수상 몫 30 = 평판 매우 좋음)', () => {
    expect(v2Of(hitter('김주원')).base.SS).toBeCloseTo(30, 5);
  });

  it('김도영 3B 실책 지표는 한 시즌(1,150이닝)당 (−3에 잘림) — 16.3', () => {
    const p = hitter('김도영');
    const m = errorMetric(fieldYears(store, p.id, 2026), 2026, '3B', fieldLeague(store.defense!));
    expect(m).toBeCloseTo(-3, 5);
  });

  it('리그 영점 m은 50 근처이고 가상 선수 B 분포가 있다 (13.6)', () => {
    expect(w.env.defZero).toBeGreaterThan(44);
    expect(w.env.defZero).toBeLessThan(54);
    expect(w.defPool!.length).toBeGreaterThan(50);
  });
});

describe('수비 v2 길: 기록 없는 선수 (16.4)', () => {
  it('가상 OF는 CF가 본 자리라 외야 셋이 수비 가능, 내야는 20', () => {
    const v = virtualDefense('v-test-of', 'OF', 0.5, 25, w.defPool);
    expect(v.playable).toEqual(['LF', 'CF', 'RF']);
    expect(v.grade.SS).toBe(20);
    expect(v.grade['1B']).toBe(20);
  });

  it('가상 IF는 SS가 본 자리라 SS·2B, DH는 수비 가능 자리가 없다', () => {
    expect(virtualDefense('v-test-if', 'IF', 0.5, 25, w.defPool).playable).toEqual(['2B', 'SS']);
    expect(virtualDefense('v-test-dh', 'DH', 0.5, 25, w.defPool).playable).toEqual([]);
  });

  it('가상 선수 B는 실존 주전 분포에서 뽑는다 (모두 40에 모이지 않는다)', () => {
    const g = Array.from({ length: 200 }, (_, i) => virtualDefense(`v-${i}`, 'SS', 0.5, 27, w.defPool).grade.SS);
    const sd = Math.sqrt(g.reduce((a, x) => a + (x - 45) ** 2, 0) / g.length);
    expect(sd).toBeGreaterThan(4);
  });
});

describe('라인업 배정 (16-3, 14.2)', () => {
  it('정규 포수가 있으면 비상 포수(강백호)는 포수로 나오지 않는다', () => {
    const p = hitter('강백호');
    const team = w.teams[p.teamIdx].org.filter((x) => !x.isPitcher);
    const placed = assignSlots(team);
    expect(placed.find((x) => x.p === p)?.slot).not.toBe('C');
    const c = placed.find((x) => x.slot === 'C')!.p;
    expect(c.bat!.playable).toContain('C');
  });

  it('정규 포수가 모두 빠지면 비상 포수가 포수로 나온다', () => {
    const p = hitter('강백호');
    const team = w.teams[p.teamIdx].org.filter((x) => !x.isPitcher && !x.bat?.playable?.includes('C'));
    expect(assignSlots(team).find((x) => x.slot === 'C')?.p).toBe(p);
  });

  it('주전 라인업에 수비 가능이 아닌 자리 기용이 없다 (10구단 2026 시작)', () => {
    for (const t of w.teams) {
      for (const { p, slot } of assignSlots(t.org.filter((x) => !x.isPitcher))) {
        if (slot !== 'DH') expect(p.bat!.playable, `${t.name} ${p.name} ${slot}`).toContain(slot);
      }
    }
  });
});
