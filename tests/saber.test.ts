// 세이버 기록 계산 (선수단 화면 3페이지): 정의상 성립해야 하는 관계와 손으로 계산한 값.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, emptyBatLine, emptyPitLine, Season, worldForYear, type BatLine, type PitLine } from '../src/engine';
import { babip, fip, iso, leagueBase, lobPct, woba, wraa, wrcPlus } from '../src/game/saber';
import { era } from '../src/game/stats';

let bat: BatLine[];
let pit: PitLine[];

beforeAll(() => {
  const world = worldForYear(loadDataStore(), 2025);
  const s = Season.start(world, { ...DEFAULT_PARAMS, pilotSeasons: 0 }, 'saber', { cal: { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 } });
  s.runToEnd();
  bat = s.bat;
  pit = s.pit;
});

const sumBat = (ls: BatLine[]) => ls.reduce((a, b) => {
  for (const k of Object.keys(a) as (keyof BatLine)[]) a[k] += b[k];
  return a;
}, emptyBatLine());
const sumPit = (ls: PitLine[]) => ls.reduce((a, b) => {
  for (const k of Object.keys(a) as (keyof PitLine)[]) a[k] += b[k];
  return a;
}, emptyPitLine());

describe('세이버 기록', () => {
  it('리그 전체를 한 타자로 보면 wRC+ 100, wRAA 0', () => {
    const lg = leagueBase(bat, pit);
    const all = sumBat(bat);
    expect(wrcPlus(all, lg)).toBeCloseTo(100, 6);
    expect(wraa(all, lg)).toBeCloseTo(0, 6);
    expect(lg.woba).toBeGreaterThan(0.28);
    expect(lg.woba).toBeLessThan(0.4);
  });

  it('리그 전체 투수 기록의 FIP는 리그 평균자책과 같다 (FIP 상수의 정의)', () => {
    const lg = leagueBase(bat, pit);
    const all = sumPit(pit);
    expect(fip(all, lg)).toBeCloseTo(era(all), 6);
  });

  it('손으로 계산한 값과 같다', () => {
    const b = { ...emptyBatLine(), pa: 100, ab: 85, h: 25, d: 5, t: 1, hr: 4, bb: 10, hbp: 2, sf: 3, so: 20 };
    // wOBA = (0.69×10 + 0.72×2 + 0.89×15 + 1.27×5 + 1.62×1 + 2.1×4) / (85 + 10 + 3 + 2)
    expect(woba(b)).toBeCloseTo((6.9 + 1.44 + 13.35 + 6.35 + 1.62 + 8.4) / 100, 9);
    expect(iso(b)).toBeCloseTo((5 + 2 + 12) / 85, 9);
    expect(babip(b)).toBeCloseTo(21 / (85 - 20 - 4 + 3), 9);
    const p = { ...emptyPitLine(), h: 50, bb: 20, hbp: 3, r: 25, hr: 5 };
    expect(lobPct(p)).toBeCloseTo((50 + 20 + 3 - 25) / (50 + 20 + 3 - 7), 9);
    // 표본이 적어 식이 100%를 넘으면 100%로 (예: 안타 4, 볼넷 1, 홈런 2, 실점 2 → 식 3 ÷ 2.2)
    expect(lobPct({ ...emptyPitLine(), h: 4, bb: 1, hr: 2, r: 2 })).toBe(1);
  });

  it('기록이 없으면 NaN (화면에는 -)', () => {
    const lg = leagueBase(bat, pit);
    expect(Number.isNaN(woba(emptyBatLine()))).toBe(true);
    expect(Number.isNaN(wrcPlus(emptyBatLine(), lg))).toBe(true);
    expect(Number.isNaN(fip(emptyPitLine(), lg))).toBe(true);
  });
});
