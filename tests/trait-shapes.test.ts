// 가상 선수 특기 모양 (2026-10-26 사용자 결정, 2026-11-04 특기 모양 카드): league/offseason.ts applyShape, 표 league/shapeTable.ts ← tools/fit_shapes.ts.
// - 같은 줄기면 같은 모양 (선수별 시드), 크기 0이면 예전처럼 평평한 모양 그대로.
// - 자리 무리 모양: 1루수가 유격수보다 홈런 쪽, 천장이 높은 선수가 낮은 선수보다 홈런 쪽 (실존 스타처럼), 준족(도루 시도율↑)은 3루타 쪽.
// - 시작 해 기록이 있는 실존 선수 능력은 모양과 관계없다 (모양 0 · 기본값으로 만든 시작 리그의 실존 선수 능력이 같다).
// - 가치 총량은 makeVirtual의 skillForRuns가 모양 뒤에 목표 런으로 맞춘다 (growth.ts 이분법, 여기서는 따로 보지 않는다).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type BatSkill, type PitSkill } from '../src/engine';
import { createLeague } from '../src/league/create';
import { applyShape } from '../src/league/offseason';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const flatBat = (sbAtt = 0.06): BatSkill => ({ so: 1, bb: 1, hbp: 1, hr: 1, s1: 1, d2: 1, t3: 1, sbAtt, sbPct: 0.7, speed: 0.5, sample: 0 });
const flatPit = (): PitSkill => ({ so: 1, bb: 1, hbp: 1, hr: 1, hit: 1, stamina: 22, reliefStint: 5, startShare: 0.85, sample: 0 });
const size = DEFAULT_PARAMS.shape;

function meanLog(n: number, f: (i: number) => BatSkill, k: keyof BatSkill): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.log(f(i)[k] as number);
  return s / n;
}
function shaped(pos: string, ceiling: number, i: number, sbAtt = 0.06): BatSkill {
  const p = { bat: flatBat(sbAtt), pit: null, pos, foreign: false };
  applyShape(p, `t/shape/${pos}/${ceiling}/${sbAtt}/${i}`, size, false, ceiling);
  return p.bat;
}

describe('특기 모양 (applyShape)', () => {
  it('같은 줄기면 같은 모양, 크기 0이면 그대로', () => {
    const a = { bat: flatBat(), pit: null, pos: 'SS', foreign: false };
    const b = { bat: flatBat(), pit: null, pos: 'SS', foreign: false };
    applyShape(a, 'x/shape/v1', size, false, 20);
    applyShape(b, 'x/shape/v1', size, false, 20);
    expect(a.bat).toEqual(b.bat);
    expect(a.bat.hr).not.toBe(1);
    const c = { bat: flatBat(), pit: flatPit(), pos: 'SS', foreign: false };
    applyShape(c, 'x/shape/v1', { ...size, bat: 0, pit: 0, noise: {} }, true, 20);
    expect(c.bat).toEqual(flatBat());
    expect(c.pit).toEqual(flatPit());
  });

  it('자리·천장·도루 시도율에 따라 모양이 실존 선수처럼 갈린다', () => {
    const n = 1500;
    // 1루수는 유격수보다 홈런 쪽 (실존 2001~2025 무리 평균 차 약 0.25)
    expect(meanLog(n, (i) => shaped('1B', 23, i), 'hr') - meanLog(n, (i) => shaped('SS', 23, i), 'hr')).toBeGreaterThan(0.15);
    // 천장이 높은 선수는 홈런 쪽·단타는 덜 (가치는 skillForRuns가 맞추므로 모양만)
    expect(meanLog(n, (i) => shaped('LF', 50, i), 'hr') - meanLog(n, (i) => shaped('LF', 0, i), 'hr')).toBeGreaterThan(0.1);
    expect(meanLog(n, (i) => shaped('LF', 50, i), 's1')).toBeLessThan(meanLog(n, (i) => shaped('LF', 0, i), 's1'));
    // 준족(도루 시도율 0.2)은 3루타 쪽
    expect(meanLog(n, (i) => shaped('CF', 23, i, 0.2), 't3') - meanLog(n, (i) => shaped('CF', 23, i, 0.03), 't3')).toBeGreaterThan(0.2);
    // 퍼짐: 홈런 모양 표준편차가 실존 쯤 (0.3 안팎)
    const hr = Array.from({ length: n }, (_, i) => Math.log(shaped('RF', 23, i).hr));
    const m = hr.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(hr.reduce((s, x) => s + (x - m) ** 2, 0) / n);
    expect(sd).toBeGreaterThan(0.25);
    expect(sd).toBeLessThan(0.45);
  });

  it('투수도 모양이 생긴다 (구위형·제구형)', () => {
    const so = Array.from({ length: 800 }, (_, i) => {
      const p = { bat: null, pit: flatPit(), pos: null, foreign: false };
      applyShape(p, `t/pit/${i}`, size, true, 20);
      return Math.log(p.pit.so);
    });
    const m = so.reduce((s, x) => s + x, 0) / so.length;
    expect(Math.sqrt(so.reduce((s, x) => s + (x - m) ** 2, 0) / so.length)).toBeGreaterThan(0.08);
  });
});

describe('실존 선수는 그대로', () => {
  let store: DataStore;
  beforeAll(() => { store = loadDataStore(); });

  it('시작 해 기록이 있는 실존 선수 능력은 모양 크기와 관계없다', () => {
    const a = createLeague(store, 2026, 'shape-real', FAST).league;
    const b = createLeague(store, 2026, 'shape-real', { ...FAST, shape: { ...size, bat: 0, pit: 0, noise: {} } }).league;
    // 시작 해 1군 기록이 없는 지명 신인(makeDraftee, id d… · 시작 뒤 데뷔)은 신인 생성기라 모양을 받는다 (tests/rookie-shape.test.ts)
    const recorded = (id: string) => (store.players.get(id)?.first ?? Infinity) <= 2026;
    const skill = (l: typeof a) => new Map(l.players.filter((p) => p.real !== false && recorded(p.id)).map((p) => [p.id, JSON.stringify([p.bat, p.pit, p.potential])]));
    const sa = skill(a);
    const sb = skill(b);
    expect(sa.size).toBeGreaterThan(500);
    expect([...sa].filter(([id, v]) => sb.get(id) !== v)).toEqual([]);
  }, 300_000);
});
