// 화면 공통 부품 (2026-10-23 UI 2단계 U2-1, 기획안 1.3): 등급 칸, 리그 평균 대비, 짐작 문구 칸, 없음 표시, 공통 표.
// 계산은 compare.ts(리그 대비)·table.ts(정렬·거르기·열 고르기·표 보기 저장)·grades.ts(잠재 범위)에 두고 여기서는 그리기만 한다.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Grade, gradeClass, useGame } from './context';
import { potentialText, potentialView, type PotentialView } from './grades';
import { activeLevel, SCOUT_NOISE } from '../league/finance';
import { topPercent, vsMark } from './compare';
import { EMPTY_VIEW, filterRows, loadView, nextSort, saveView, sortRows, toggleColumn, toggleGroup, visibleColumns, type Column, type TableView } from './table';

/**
 * 등급 칸: 이름 | 막대 | 숫자. 상세 모드에서는 잠재(범위)·지난 시즌 대비 변화·관련 기록을 뒤에 붙인다.
 * 등급 낱말("좋음" 등)은 쓰지 않는다 (결정 2: 요약은 능력치 숫자만, 기준 없는 낱말 빼기)
 */
export function GradeBar({ label, v, title, pot, delta, note }: {
  label: ReactNode; v: number | null; title?: string;
  /** 잠재 글자 ("55~65"). 상세에서만 넘긴다 */
  pot?: string | null;
  /** 지난 오프시즌 대비 (+3 / −2). 상세에서만 */
  delta?: number | null;
  /** 관련 결과 기록 (상세에서만) */
  note?: ReactNode;
}) {
  const extra = pot !== undefined || delta !== undefined || note !== undefined;
  return (
    <div className={`gbar${extra ? ' gbar-x' : ''}`} title={title}>
      <span>{label}</span>
      <span className="track" aria-hidden><i className={gradeClass(v)} style={{ width: `${v === null ? 0 : ((Math.min(80, v) - 20) / 60) * 100}%` }} /></span>
      <Grade v={v} />
      {extra && (
        <span className="gbar-more small">
          {pot !== undefined && <span title="잠재 (스카우트 짐작, 범위 밖일 수도 있다)">{pot === null ? <Missing /> : <>잠재 {pot}</>}</span>}
          {delta !== undefined && <Delta v={delta} />}
          {note !== undefined && <span className="muted">{note}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * 잠재 표시 규칙 (결정 5, 모든 화면): 27세 이하 범위, 28~30세 숫자 하나, 31세 이상 숨김.
 * 스카우트 오차는 우리 구단 스카우트 투자 단계. age는 그 화면이 쓰는 나이 (오프시즌은 다음 시즌 나이)
 */
export function usePotentialOf(): (p: { id: string; potential: number; scoutPotential?: number }, age: number | null) => PotentialView {
  const { session } = useGame();
  const noise = SCOUT_NOISE[activeLevel(session.league, session.teamIdx, 'scout')];
  const seed = session.league.seed;
  const year = session.year;
  return (p, age) => potentialView(p, age, { seed, noise, year });
}

/** 정렬·거르기용 잠재 등급: 범위는 가운데(짐작값), 숨김은 null */
export function potentialSortValue(v: PotentialView): number | null {
  return !v ? null : v.kind === 'one' ? v.v : v.guess;
}

/** 표 안 잠재 칸. 범위는 가운데(짐작값) 색으로 칠한다 */
export function PotCell({ v }: { v: PotentialView }) {
  if (!v) return <span className="muted" title="31세 이상은 잠재를 보이지 않습니다">-</span>;
  if (v.kind === 'one') return <Grade v={v.v} />;
  return <span className={`grade pot-range ${gradeClass(v.guess)}`} title="스카우트 짐작 범위 (실제 값이 범위 밖일 수도 있다)">{potentialText(v)}</span>;
}

/** 지난 시즌 대비 변화 (+3 / −2 / 0). null은 비교할 값 없음 */
export function Delta({ v }: { v: number | null }) {
  if (v === null) return <span className="muted" title="비교할 지난 값이 없습니다">—</span>;
  const r = Math.round(v);
  return <span className={r > 0 ? 'vs-up' : r < 0 ? 'vs-dn' : 'muted'} title="지난 오프시즌 판정 대비">{r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0'}</span>;
}

/**
 * 리그 평균 대비 (결정 1): 요약은 ▲▼ 모양 + 색, 상세는 "상위 8%". rank는 compare.ts leagueRank (1 = 가장 좋음).
 * 색을 못 보는 사람도 읽도록 모양·글자를 함께 쓴다
 */
export function VsLeague({ rank, full }: { rank: number | null; full: boolean }) {
  if (rank === null) return null;
  const m = vsMark(rank);
  if (full) {
    const cls = m === 'up' ? 'vs-up' : m === 'down' ? 'vs-dn' : 'muted';
    return <span className={`vs small ${cls}`} title="그 해 리그 규정 이상 선수 가운데 자리">상위 {topPercent(rank)}%</span>;
  }
  if (!m) return null;
  return m === 'up'
    ? <span className="vs vs-up" role="img" aria-label="리그 평균보다 좋음" title="리그 평균보다 좋음">▲</span>
    : <span className="vs vs-dn" role="img" aria-label="리그 평균보다 나쁨" title="리그 평균보다 나쁨">▼</span>;
}

/** 없음 표시: 0과 구별하는 — + 사유 */
export function Missing({ why }: { why?: string }) {
  return <span className="muted" title={why ?? '자료 없음'}>—{why ? <span className="small"> {why}</span> : null}</span>;
}

/** 컨디션 도움말 (docs/컨디션_기획안.md 6.3). 크기 숫자는 쓰지 않는다 */
export const CONDITION_HELP = '컨디션은 며칠씩 이어지는 선수의 몸 상태입니다. 좋음이면 타석에서 조금 더 잘하고, 나쁨이면 조금 못합니다. 구단의 선택이나 날씨가 팀 전체에 주는 영향은 \'경기력\'으로 따로 보입니다.';

/**
 * 컨디션 한 줄 "낱말 · 사유" (2026-10-23 UI 2단계 U2-9, 엔진 2 12단계). session.conditionText만 거쳐 숫자는 받지도 보이지도 않는다.
 * 정규시즌 중 구단 소속 선수만 (오프시즌·가을야구·시장 선수는 null)
 */
export function useCondition(): (p: { idx: number; teamIdx: number }) => string | null {
  const { session } = useGame();
  const on = session.phase === 'season' && !session.done;
  return (p) => (on && p.teamIdx >= 0 ? session.conditionText(p.idx) : null);
}

/** 컨디션 낱말: 좋음·보통·나쁨에 따라 색. label이면 앞에 "컨디션"을 붙인다 */
export function CondTag({ text, label }: { text: string | null | undefined; label?: boolean }) {
  if (!text) return null;
  const w = text.split(' · ')[0];
  return <span className={`status cond-${w === '좋음' ? 'good' : w === '나쁨' ? 'bad' : 'ok'}`} title={CONDITION_HELP}>{label ? `컨디션 ${text}` : text}</span>;
}

/** 짐작 문구 칸 ("스카우트 메모"): 숫자 없이 문구만. 아직 문구가 없으면 비어 있다는 뜻을 적는다 */
export function ScoutNote({ notes, full }: { notes: string[]; full: boolean }) {
  const shown = full ? notes : notes.slice(0, 1);
  return (
    <div className="scout-note">
      <span className="small muted">스카우트 메모</span>
      {shown.length ? <p>{shown.map((n) => `"${n}"`).join(' · ')}</p> : <p className="muted small">아직 알 수 없음</p>}
    </div>
  );
}

/**
 * 공통 표: 머리 눌러 정렬, 이름 거르기, (상세) 열 고르기·묶음 전환·리그 평균 줄, 표본 미만 줄 흐림·빼기.
 * 고른 열·정렬·거르기는 표(id)마다 이 브라우저에 기억한다 (결정 8)
 */
export function DataTable<R>({ id, cols, rows, rowKey, full, searchText, thin, thinToggle = true, rowClass, foot, label, empty }: {
  id: string; cols: Column<R>[]; rows: R[]; rowKey: (r: R) => string; full: boolean;
  /** 거르기에 쓰는 글자 (없으면 거르기 칸 없음) */
  searchText?: (r: R) => string;
  /** 표본 미만 줄 (흐리게) */
  thin?: (r: R) => boolean;
  /** 상세에서 "표본 적은 줄 빼기" 칸을 보일까 (화면이 따로 거르기를 두면 false) */
  thinToggle?: boolean;
  /** sorted: 사용자가 머리를 눌러 다시 늘어놓았나 (순위 선처럼 원래 순서에만 뜻이 있는 표시를 끌 때) */
  rowClass?: (r: R, sorted: boolean) => string | undefined;
  /** 맨 아래 줄 (리그 평균 등). 상세에서만 */
  foot?: { label: ReactNode; cells: Partial<Record<string, ReactNode>> }[];
  label?: string;
  empty?: ReactNode;
}) {
  const [view, setViewState] = useState<TableView>(() => loadView(id));
  useEffect(() => setViewState(loadView(id)), [id]);
  const setView = (v: TableView) => { setViewState(v); saveView(id, v); };
  const shown = visibleColumns(cols, view, full);
  const list = sortRows(filterRows(rows, view, searchText, thin), cols, view.sort);
  const groups = [...new Set(cols.filter((c) => c.group && !c.fixed).map((c) => c.group!))];
  const on = new Set(shown.map((c) => c.key));
  const fid = useId();
  const tools = !!searchText || (full && cols.some((c) => !c.fixed)) || (!!thin && thinToggle && full);
  return (
    <div className="dt">
      {tools && (
        <div className="dt-tools">
          {searchText && (
            <label className="small dt-find" htmlFor={fid}>
              거르기 <input id={fid} type="search" value={view.filter} placeholder="이름" onChange={(e) => setView({ ...view, filter: e.target.value })} />
            </label>
          )}
          {full && groups.length > 1 && (
            <span className="seg small" role="group" aria-label="열 묶음">
              {groups.map((g) => {
                const keys = cols.filter((c) => c.group === g && !c.fixed).map((c) => c.key);
                const all = keys.every((k) => on.has(k));
                return <button key={g} type="button" aria-pressed={all} className={all ? 'on' : ''} onClick={() => setView(toggleGroup(cols, view, g))}>{g}</button>;
              })}
            </span>
          )}
          {full && cols.some((c) => !c.fixed) && (
            <details className="dt-cols">
              <summary className="small">열 고르기</summary>
              <div className="dt-cols-list">
                {cols.filter((c) => !c.fixed).map((c) => (
                  <label key={c.key} className="small" title={c.title}>
                    <input type="checkbox" checked={on.has(c.key)} onChange={() => setView(toggleColumn(cols, view, c.key))} /> {c.label}
                  </label>
                ))}
                <button type="button" className="link small" onClick={() => setView({ ...EMPTY_VIEW, filter: view.filter })}>처음대로</button>
              </div>
            </details>
          )}
          {thin && thinToggle && full && (
            <label className="small"><input type="checkbox" checked={view.hideThin} onChange={(e) => setView({ ...view, hideThin: e.target.checked })} /> 표본 적은 줄 빼기</label>
          )}
        </div>
      )}
      <div className="scroll dt-scroll">
        <table aria-label={label}>
          <thead>
            <tr>
              {shown.map((c) => {
                const s = view.sort?.key === c.key ? view.sort : null;
                return (
                  <th key={c.key} className={c.text ? 'l' : undefined} title={c.title} aria-sort={s ? (s.desc ? 'descending' : 'ascending') : undefined}>
                    <button type="button" className="th-sort" onClick={() => setView({ ...view, sort: nextSort(c, view.sort) })}>
                      {c.label}{s ? (s.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={shown.length} className="l muted">{empty ?? '보일 줄이 없습니다.'}</td></tr>}
            {list.map((r) => {
              const cls = [rowClass?.(r, view.sort !== null), thin?.(r) ? 'thin' : ''].filter(Boolean).join(' ');
              return (
                <tr key={rowKey(r)} className={cls || undefined} title={thin?.(r) ? '표본이 기준보다 적습니다' : undefined}>
                  {shown.map((c) => <td key={c.key} className={c.text ? 'l' : undefined}>{c.cell ? c.cell(r) : cellText(c.value(r))}</td>)}
                </tr>
              );
            })}
          </tbody>
          {full && foot && foot.length > 0 && (
            <tfoot>
              {foot.map((f, k) => (
                <tr key={k} className="lg-row">
                  {shown.map((c, i) => <td key={c.key} className={c.text ? 'l' : undefined}>{i === 0 ? f.label : f.cells[c.key] ?? ''}</td>)}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function cellText(v: number | string | null): ReactNode {
  if (v === null || (typeof v === 'number' && !Number.isFinite(v))) return <Missing />;
  return v;
}
