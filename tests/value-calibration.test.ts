// 투수 가치·잠재력 기준표 정렬 (2026-10-12, tools/benchmark_peaks.ts·tools/calibrate_value.ts·reports/peak-benchmark.md).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, leagueQuality, Season, worldForYear } from '../src/engine';
import { runsGrade, runsWar } from '../src/ui/grades';

let store: DataStore;
beforeAll(() => { store = loadDataStore(); }, 120_000);

describe('기준표 정렬', () => {
  it('선발·구원을 겸한 1980년대 에이스는 선발 로테이션에 들어간다 (예전에는 마무리가 되어 한 해 50~60이닝)', () => {
    const params = { ...DEFAULT_PARAMS, ratingBasis: 'season' as const, pilotSeasons: 1 };
    for (const [y, name] of [[1986, '선동열'], [1984, '최동원']] as const) {
      const w = worldForYear(store, y, params);
      const p = w.players.find((x) => x.name === name && x.isPitcher)!;
      const s = Season.start(w, params, `ace/${y}`);
      s.simulateDay();
      const ts = s.teamSeasons[p.teamIdx];
      expect(ts.rotation.map((x) => x.idx), `${y} ${name}`).toContain(p.idx);
      expect(ts.closer?.idx).not.toBe(p.idx);
    }
  }, 120_000);

  it('등급 눈금은 기준표와 같다: 평균 주전(2승) 50, 8승 80, 리그 수준이 낮은 해는 같은 런도 낮게', () => {
    expect(runsGrade(23)).toBe(50);
    expect(runsGrade(79)).toBe(80);
    expect(runsWar(60)).toBeCloseTo(5.99, 1);
    expect(leagueQuality(1982)).toBe(0.8);
    expect(leagueQuality(2010)).toBe(1);
    expect(runsGrade(60, 1982)).toBeLessThan(runsGrade(60, 2010));
  });
});
