// 공통 표 부품의 계산 (2026-10-23 UI 2단계 U2-1): 열 정의, 정렬, 거르기, 열 고르기, 표 보기 저장.
// 그리기는 parts.tsx의 DataTable. 표 보기(고른 열·정렬·거르기)는 표마다 이 브라우저에 기억한다 (결정 8).
// 화면 취향이라 저장 파일·조작 기록에는 넣지 않는다.
import type { ReactNode } from 'react';

export interface Column<R> {
  key: string;
  label: string;
  /** 머리 풀이 (용어 뜻) */
  title?: string;
  /** 정렬·리그 대비에 쓰는 값. null은 '없음'으로 맨 뒤 */
  value(r: R): number | string | null;
  /** 칸에 그릴 것 (없으면 value 그대로) */
  cell?(r: R): ReactNode;
  /** 열 묶음 이름 (기본·세이버 등). 열 고르기에서 묶음째 켜고 끈다 */
  group?: string;
  /** 요약 모드에 보이는 열 */
  brief?: boolean;
  /** 늘 보이는 열 (고를 수 없음, 휴대폰에서 왼쪽에 붙음) */
  fixed?: boolean;
  /** 글자 열 (왼쪽 정렬) */
  text?: boolean;
  /** 낮을수록 좋은 값 (처음 누르면 낮은 순) */
  lower?: boolean;
}

export interface TableView {
  /** 고른 열 key (null = 기본) */
  cols: string[] | null;
  sort: { key: string; desc: boolean } | null;
  /** 이름 거르기 */
  filter: string;
  /** 표본 미만 줄 빼기 */
  hideThin: boolean;
}

export const EMPTY_VIEW: TableView = { cols: null, sort: null, filter: '', hideThin: false };

const VIEWS_KEY = 'kbo-gm.views';

function readAll(): Record<string, TableView> {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, TableView>) : {};
  } catch {
    return {};
  }
}

/** 이 표의 저장된 보기 (없거나 저장소를 못 쓰면 기본) */
export function loadView(id: string): TableView {
  const v = readAll()[id];
  if (!v) return EMPTY_VIEW;
  return {
    cols: Array.isArray(v.cols) ? v.cols.filter((x) => typeof x === 'string') : null,
    sort: v.sort && typeof v.sort.key === 'string' ? { key: v.sort.key, desc: !!v.sort.desc } : null,
    filter: typeof v.filter === 'string' ? v.filter : '',
    hideThin: !!v.hideThin,
  };
}

export function saveView(id: string, view: TableView): void {
  try {
    const all = readAll();
    all[id] = view;
    localStorage.setItem(VIEWS_KEY, JSON.stringify(all));
  } catch { /* 기억하지 못해도 표는 그대로 */ }
}

/** 보이는 열: 요약은 brief·fixed 열, 상세는 고른 열(없으면 전부). 정의 순서를 지킨다. 없어진 열 key는 무시 */
export function visibleColumns<R>(cols: readonly Column<R>[], view: TableView, full: boolean): Column<R>[] {
  if (!full) return cols.filter((c) => c.fixed || c.brief);
  if (!view.cols) return [...cols];
  const on = new Set(view.cols);
  const shown = cols.filter((c) => c.fixed || on.has(c.key));
  // 저장한 열이 모두 사라졌으면 (표 정의가 바뀜) 기본으로
  return shown.some((c) => !c.fixed) ? shown : [...cols];
}

/** 열 하나 켜고 끄기 */
export function toggleColumn<R>(cols: readonly Column<R>[], view: TableView, key: string): TableView {
  const now = new Set(view.cols ?? cols.map((c) => c.key));
  if (now.has(key)) now.delete(key);
  else now.add(key);
  return { ...view, cols: cols.filter((c) => now.has(c.key)).map((c) => c.key) };
}

/** 묶음째 켜고 끄기: 묶음 열이 하나라도 꺼져 있으면 모두 켜고, 모두 켜져 있으면 모두 끈다 */
export function toggleGroup<R>(cols: readonly Column<R>[], view: TableView, group: string): TableView {
  const now = new Set(view.cols ?? cols.map((c) => c.key));
  const keys = cols.filter((c) => c.group === group && !c.fixed).map((c) => c.key);
  const allOn = keys.every((k) => now.has(k));
  for (const k of keys) {
    if (allOn) now.delete(k);
    else now.add(k);
  }
  return { ...view, cols: cols.filter((c) => now.has(c.key)).map((c) => c.key) };
}

/** 머리를 눌렀을 때 다음 정렬: 처음은 좋은 쪽부터, 같은 열을 다시 누르면 반대, 세 번째는 정렬 풀기 */
export function nextSort<R>(col: Column<R>, sort: TableView['sort']): TableView['sort'] {
  const first = col.text ? false : !col.lower;
  if (!sort || sort.key !== col.key) return { key: col.key, desc: first };
  if (sort.desc === first) return { key: col.key, desc: !first };
  return null;
}

/** 정렬 (안정 정렬, null은 방향과 상관없이 맨 뒤) */
export function sortRows<R>(rows: readonly R[], cols: readonly Column<R>[], sort: TableView['sort']): R[] {
  const col = sort && cols.find((c) => c.key === sort.key);
  if (!sort || !col) return [...rows];
  const dir = sort.desc ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: col.value(r) })).sort((a, b) => {
    const an = a.v === null || (typeof a.v === 'number' && !Number.isFinite(a.v));
    const bn = b.v === null || (typeof b.v === 'number' && !Number.isFinite(b.v));
    if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'ko');
    return c ? c * dir : a.i - b.i;
  }).map((x) => x.r);
}

/** 거르기: 이름 글자(띄어쓰기 무시, 대소문자 무시)와 표본 미만 빼기 */
export function filterRows<R>(rows: readonly R[], view: TableView, textOf?: (r: R) => string, thin?: (r: R) => boolean): R[] {
  const q = view.filter.replace(/\s+/g, '').toLowerCase();
  return rows.filter((r) => {
    if (view.hideThin && thin?.(r)) return false;
    if (!q || !textOf) return true;
    return textOf(r).replace(/\s+/g, '').toLowerCase().includes(q);
  });
}
