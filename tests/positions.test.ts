// 하드힛 이력으로 정하는 주 포지션·수비 가능 포지션 (포지션 2안, 2026-10-22 사용자 결정)
import { describe, expect, it } from 'vitest';
import { hardhitPositions } from '../src/engine';
import type { SeasonData } from '../src/data/types';

type Row = [id: string, year: number, pos: string, pa: number, src?: 'H' | 'E'];
/** 팀 하나(144경기, 규정타석 446.4)짜리 시즌 목록 */
function seasons(rows: Row[]): Pick<SeasonData, 'year' | 'teams' | 'bat'>[] {
  const years = [...new Set(rows.map((r) => r[1]))].sort();
  return years.map((year) => ({
    year,
    teams: [{ name: 'A', g: 144 }],
    bat: rows.filter((r) => r[1] === year).map(([id, , pos, pa, src]) => ({ id, team: 'A', pos, pa, posSrc: src ?? 'H' })),
  })) as unknown as Pick<SeasonData, 'year' | 'teams' | 'bat'>[];
}

describe('하드힛 포지션 (포지션 2안)', () => {
  it('주 포지션은 직전 3시즌 가중 타석: 예전 규정타석 시즌이 많아도 지금 맡는 자리를 따른다', () => {
    const m = hardhitPositions(seasons([
      ['a', 2019, '1B', 500], ['a', 2020, '1B', 500], ['a', 2021, '1B', 500], ['a', 2022, '1B', 500],
      ['a', 2023, '3B', 300], ['a', 2024, '3B', 500], ['a', 2025, '3B', 500],
    ]), 2026);
    expect(m.get('a')).toEqual({ main: '3B', playable: ['3B', '1B'] });
  });

  it('한 해만 다른 자리를 맡아도 주 포지션이 뒤집히지 않고, 규정타석 못 채운 한 시즌 자리는 수비 가능에 없다', () => {
    const m = hardhitPositions(seasons([['b', 2023, 'SS', 500], ['b', 2024, 'SS', 500], ['b', 2025, '2B', 400]]), 2026);
    expect(m.get('b')).toEqual({ main: 'SS', playable: ['SS'] });
  });

  it('규정타석을 못 채워도 2시즌 이상 맡은 자리는 수비 가능', () => {
    const m = hardhitPositions(seasons([['c', 2023, 'RF', 500], ['c', 2024, 'CF', 300], ['c', 2025, 'CF', 300]]), 2026);
    expect(m.get('c')).toEqual({ main: 'CF', playable: ['CF', 'RF'] });
  });

  it('지명타자는 가중 타석의 70%를 넘을 때만 주 포지션', () => {
    const m = hardhitPositions(seasons([
      ['d', 2024, '1B', 500], ['d', 2025, 'DH', 500],
      ['e', 2023, '1B', 100], ['e', 2024, 'DH', 500], ['e', 2025, 'DH', 500],
    ]), 2026);
    expect(m.get('d')!.main).toBe('1B');
    expect(m.get('e')!.main).toBe('DH');
  });

  it('직전 3시즌에 하드힛 기록이 없으면 규정타석 시즌이 많은 자리, 추정값(E)은 쓰지 않는다', () => {
    const m = hardhitPositions(seasons([
      ['f', 2018, 'LF', 500], ['f', 2019, 'LF', 500], ['f', 2020, 'CF', 500], ['f', 2025, 'CF', 300, 'E'],
    ]), 2026);
    expect(m.get('f')).toEqual({ main: 'LF', playable: ['LF', 'CF'] });
  });

  it('시작 연도를 주지 않으면 가장 늦은 시즌 다음 해로 본다', () => {
    const rows: Row[] = [['g', 2023, 'C', 500], ['g', 2024, '1B', 200], ['g', 2025, '1B', 200]];
    expect(hardhitPositions(seasons(rows))).toEqual(hardhitPositions(seasons(rows), 2026));
  });
});
