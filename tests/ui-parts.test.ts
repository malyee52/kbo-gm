// UI 2단계 공통 부품 (2026-10-23 U2-1): 리그 대비 자리, 표 정렬·거르기·열 고르기·표 보기 저장, 잠재 범위.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { leagueRank, topPercent, vsMark } from '../src/ui/compare';
import { EMPTY_VIEW, filterRows, loadView, nextSort, saveView, sortRows, toggleColumn, toggleGroup, visibleColumns, type Column } from '../src/ui/table';

type Row = { name: string; avg: number | null; era: number; pa: number };
const COLS: Column<Row>[] = [
  { key: 'name', label: '선수', value: (r) => r.name, fixed: true, text: true },
  { key: 'avg', label: '타율', value: (r) => r.avg, brief: true, group: '기본' },
  { key: 'pa', label: '타석', value: (r) => r.pa, group: '기본' },
  { key: 'era', label: '평균자책', value: (r) => r.era, lower: true, group: '투구' },
];
const ROWS: Row[] = [
  { name: '김 하나', avg: 0.301, era: 3.1, pa: 400 },
  { name: '이둘', avg: null, era: 4.5, pa: 10 },
  { name: '박셋', avg: 0.255, era: 2.2, pa: 300 },
];

describe('리그 대비', () => {
  it('자리는 좋은 쪽이 1에 가깝고, 낮을수록 좋은 기록은 거꾸로 센다', () => {
    const lg = [0.2, 0.25, 0.3, 0.35];
    expect(leagueRank(0.36, lg)).toBe(1);
    expect(leagueRank(0.19, lg)).toBe(0);
    expect(leagueRank(1.5, [2, 3, 4], false)).toBe(1);
    expect(leagueRank(0.3, [])).toBeNull();
  });
  it('요약은 상위·하위 40%에만 ▲▼, 상세는 상위 N%', () => {
    expect(vsMark(0.9)).toBe('up');
    expect(vsMark(0.5)).toBeNull();
    expect(vsMark(0.1)).toBe('down');
    expect(topPercent(0.92)).toBe(8);
    expect(topPercent(1)).toBe(1);
  });
});

describe('공통 표', () => {
  it('정렬: 처음은 좋은 쪽, 다시 누르면 반대, 세 번째는 풀림. 없는 값은 늘 맨 뒤', () => {
    const avg = COLS[1];
    const s1 = nextSort(avg, null);
    expect(s1).toEqual({ key: 'avg', desc: true });
    expect(sortRows(ROWS, COLS, s1).map((r) => r.name)).toEqual(['김 하나', '박셋', '이둘']);
    const s2 = nextSort(avg, s1);
    expect(sortRows(ROWS, COLS, s2).map((r) => r.name)).toEqual(['박셋', '김 하나', '이둘']);
    expect(nextSort(avg, s2)).toBeNull();
    // 평균자책은 낮은 순부터
    expect(sortRows(ROWS, COLS, nextSort(COLS[3], null)).map((r) => r.name)).toEqual(['박셋', '김 하나', '이둘']);
  });
  it('거르기: 띄어쓰기 무시, 표본 미만 빼기', () => {
    expect(filterRows(ROWS, { ...EMPTY_VIEW, filter: '김하' }, (r) => r.name).map((r) => r.name)).toEqual(['김 하나']);
    expect(filterRows(ROWS, { ...EMPTY_VIEW, hideThin: true }, undefined, (r) => r.pa < 50)).toHaveLength(2);
  });
  it('열 고르기: 요약은 brief·고정 열만, 상세는 고른 열, 묶음째 켜고 끄기', () => {
    expect(visibleColumns(COLS, EMPTY_VIEW, false).map((c) => c.key)).toEqual(['name', 'avg']);
    expect(visibleColumns(COLS, EMPTY_VIEW, true)).toHaveLength(4);
    const off = toggleColumn(COLS, EMPTY_VIEW, 'pa');
    expect(visibleColumns(COLS, off, true).map((c) => c.key)).toEqual(['name', 'avg', 'era']);
    const noBase = toggleGroup(COLS, EMPTY_VIEW, '기본');
    expect(visibleColumns(COLS, noBase, true).map((c) => c.key)).toEqual(['name', 'era']);
    expect(visibleColumns(COLS, toggleGroup(COLS, noBase, '기본'), true)).toHaveLength(4);
    // 저장한 열이 표 정의에서 모두 사라지면 기본으로
    expect(visibleColumns(COLS, { ...EMPTY_VIEW, cols: ['old'] }, true)).toHaveLength(4);
  });

  const mem = new Map<string, string>();
  const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; mem.clear(); });
  it('표 보기 저장: 표마다 따로 기억하고, 저장소가 없거나 깨져도 기본으로', () => {
    expect(loadView('t1')).toEqual(EMPTY_VIEW); // localStorage 없음 (Node)
    saveView('t1', EMPTY_VIEW); // 던지지 않는다
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    const v = { cols: ['avg'], sort: { key: 'avg', desc: false }, filter: '박', hideThin: true };
    saveView('t1', v);
    expect(loadView('t1')).toEqual(v);
    expect(loadView('t2')).toEqual(EMPTY_VIEW);
    mem.set('kbo-gm.views', '{깨짐');
    expect(loadView('t1')).toEqual(EMPTY_VIEW);
  });
});

describe('컨디션 낱말 (U2-9)', () => {
  it('화면은 parts.tsx의 useCondition 한 곳에서만 conditionText를 부르고, 컨디션 도움말에도 숫자가 없다', () => {
    const dir = 'src/ui';
    const files = [...readdirSync(dir).map((f) => join(dir, f)), ...readdirSync(join(dir, 'screens')).map((f) => join(dir, 'screens', f))]
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('parts.tsx'));
    expect(files.filter((f) => /conditionText\(/.test(readFileSync(f, 'utf8')))).toEqual([]);
    const help = /CONDITION_HELP = '([^\n]*)';/.exec(readFileSync(join(dir, 'parts.tsx'), 'utf8'));
    expect(help).not.toBeNull();
    expect(help![1]).not.toMatch(/\d/);
  });
});
