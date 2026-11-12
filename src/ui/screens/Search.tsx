// 선수 찾기: 리그 전체(시즌 중 월드의 모든 구단 + 자유계약)에서 이름·구단·자리·나이·등급·계약으로 거른다.
// 트레이드 상대를 찾을 때 쓰라고 만든 화면이라 시즌 중에만 연다 (오프시즌은 오프시즌 화면의 FA·외국인 목록).
import { useMemo, useState } from 'react';
import { isStarterSkill, lineTeam, type SimPlayer } from '../../engine';
import { seasonWar } from '../../league/awards';
import { dollarText } from '../../league/salary';
import { WON_PER_USD } from '../../league/finance';
import type { LeaguePlayer } from '../../league/types';
import type { GuessSet } from '../../league/scout';
import { PlayerLink, posName, TeamLink, useGame, useWon } from '../context';
import { DataTable, guessColumn, useSeen } from '../parts';
import type { Column } from '../table';

type Kind = 'all' | 'hit' | 'pit' | 'sp' | 'rp';
type SortKey = 'guess' | 'war' | 'age' | 'salary' | 'until' | 'name';
const POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const PAGE = 100;

export interface SearchFilter {
  text: string;
  /** 'all' | 'others'(우리 구단 빼고) | 'free'(자유계약) | 구단 색인 */
  team: 'all' | 'others' | 'free' | number;
  kind: Kind;
  pos: string;
  ageMin: number | null;
  ageMax: number | null;
  /** 능력 추측 가운데값 평균 이상 (타자 컨택·파워·선구, 투수 구위·제구·체력) */
  guessMin: number | null;
  /** foreign은 아시아쿼터 포함 외국인 전부, asia는 아시아쿼터만 */
  foreign: 'all' | 'domestic' | 'foreign' | 'asia';
  /** 'fa' = 이번 시즌 뒤 계약이 끝남 */
  contract: 'all' | 'fa' | 'multi';
}

export const EMPTY_FILTER: SearchFilter = { text: '', team: 'others', kind: 'all', pos: '', ageMin: null, ageMax: null, guessMin: null, foreign: 'all', contract: 'all' };

/** guess는 우리 스카우트 팀의 갈래 추측 셋 (능력치 v2 17.6: 종합·잠재 대신), 정렬·거르기는 그 가운데값 평균 */
export interface SearchRow { p: SimPlayer; lp: LeaguePlayer | undefined; guess: GuessSet | null; war: number | null }

const guessOf = (r: SearchRow) => r.guess?.sort ?? -1;

/** 거르기 (화면과 시험이 같이 쓴다) */
export function filterPlayers(rows: SearchRow[], f: SearchFilter, userTeam: number, year: number): SearchRow[] {
  const text = f.text.trim().toLowerCase();
  return rows.filter(({ p, lp, guess }) => {
    const team = lineTeam(p);
    if (f.team === 'others' && team === userTeam) return false;
    if (f.team === 'free' && p.teamIdx >= 0) return false;
    if (typeof f.team === 'number' && p.teamIdx !== f.team) return false;
    if (text && !p.name.toLowerCase().includes(text)) return false;
    if (f.kind === 'hit' && p.isPitcher) return false;
    if (f.kind === 'pit' && !p.isPitcher) return false;
    if (f.kind === 'sp' && !(p.isPitcher && isStarterSkill(p.pit))) return false;
    if (f.kind === 'rp' && !(p.isPitcher && !isStarterSkill(p.pit))) return false;
    if (f.pos && (p.isPitcher || p.pos !== f.pos)) return false;
    if (f.ageMin !== null && (p.age === null || p.age < f.ageMin)) return false;
    if (f.ageMax !== null && (p.age === null || p.age > f.ageMax)) return false;
    if (f.guessMin !== null && (!guess || guess.sort < f.guessMin)) return false;
    if (f.foreign === 'domestic' && p.foreign) return false;
    if (f.foreign === 'foreign' && !p.foreign) return false;
    if (f.foreign === 'asia' && !(p.foreign && lp?.asia)) return false;
    if (f.contract === 'fa' && !(lp && lp.contract.until <= year)) return false;
    if (f.contract === 'multi' && !(lp && lp.contract.until > year)) return false;
    return true;
  });
}

export function sortRows(rows: SearchRow[], key: SortKey): SearchRow[] {
  const by: Record<SortKey, (a: SearchRow, b: SearchRow) => number> = {
    guess: (a, b) => guessOf(b) - guessOf(a),
    war: (a, b) => (b.war ?? -99) - (a.war ?? -99),
    age: (a, b) => (a.p.age ?? 99) - (b.p.age ?? 99) || guessOf(b) - guessOf(a),
    salary: (a, b) => (b.lp?.contract.salary ?? 0) - (a.lp?.contract.salary ?? 0),
    until: (a, b) => (a.lp?.contract.until ?? 9999) - (b.lp?.contract.until ?? 9999) || guessOf(b) - guessOf(a),
    name: (a, b) => a.p.name.localeCompare(b.p.name, 'ko'),
  };
  return [...rows].sort((a, b) => by[key](a, b) || a.p.idx - b.p.idx);
}

const numOrNull = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

/** initialText: 상태 줄 검색 칸에서 넘어온 이름 (2026-10-22 UI 대개편 1차). 이름으로 찾을 때는 우리 구단도 포함한다 */
export function Search({ initialText = '' }: { initialText?: string }) {
  const { session, version } = useGame();
  const won = useWon();
  const year = session.world.year;
  const [f, setF] = useState<SearchFilter>(initialText ? { ...EMPTY_FILTER, text: initialText, team: 'all' } : EMPTY_FILTER);
  const seen = useSeen();
  const set = (patch: Partial<SearchFilter>) => setF((x) => ({ ...x, ...patch }));

  const all = useMemo<SearchRow[]>(() => {
    const lp = new Map(session.league.players.map((p) => [p.id, p]));
    const war = seasonWar(session.world, session.season);
    const market = new Set(session.marketPlayers().map((p) => p.idx));
    return session.world.players
      // 소속 선수와 시장(자유계약·외국인 후보)만. 자유 모드 예비 자리(아직 안 쓴 빈 선수)는 뺀다
      .filter((p) => lp.get(p.id)?.reserve === undefined && (p.teamIdx >= 0 || market.has(p.idx)))
      .map((p) => {
        return { p, lp: lp.get(p.id), guess: seen.set(p.id), war: war.get(p.idx) ?? null };
      });
  }, [session, version, year]); // eslint-disable-line react-hooks/exhaustive-deps
  // 기본 순서는 능력 추측 가운데값 평균 (높은 순). 열 머리를 누르면 공통 표가 다시 늘어놓는다 (같은 값은 이 순서를 지킨다)
  const rows = useMemo(() => sortRows(filterPlayers(all, f, session.teamIdx, year), 'guess'), [all, f, session.teamIdx, year]);
  const role = (p: SimPlayer) => (p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : posName(p.pos));
  const salary = (lp: LeaguePlayer | undefined) => (!lp ? '-' : lp.contract.kind === 'foreign' ? dollarText(lp.contract.salary) : won(lp.contract.salary));
  // 능력 열은 우리 스카우트 추측(guessColumn, 가운데값 평균)으로만 정렬한다 (능력치 v2 17.6)
  const cols: Column<SearchRow>[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (r) => r.p.name, cell: (r) => <PlayerLink p={r.p} /> },
    { key: 'team', label: '구단', text: true, value: (r) => (r.p.teamIdx >= 0 ? session.teamInfo(r.p.teamIdx).name : null), cell: (r) => <span className="small"><TeamLink idx={r.p.teamIdx} /></span> },
    { key: 'role', label: '자리', text: true, value: (r) => role(r.p) },
    { key: 'age', label: '나이', lower: true, value: (r) => r.p.age, cell: (r) => (r.p.age === null ? '-' : r.p.ageEstimated ? `약 ${r.p.age}` : r.p.age) },
    guessColumn((r) => r.guess),
    { key: 'war', label: 'WAR', title: '올해 WAR (근사)', value: (r) => r.war, cell: (r) => <span className="small">{r.war === null ? '-' : (Math.abs(r.war) < 0.05 ? 0 : r.war).toFixed(1)}</span> },
    // 외국인 연봉은 달러라 원으로 환산해 견준다 (예전 정렬 고르기는 달러·원을 그대로 견줘 외국인이 늘 위였다)
    { key: 'salary', label: '연봉', value: (r) => (!r.lp ? null : r.lp.contract.kind === 'foreign' ? r.lp.contract.salary * WON_PER_USD : r.lp.contract.salary), cell: (r) => <span className="small">{salary(r.lp)}</span> },
    { key: 'until', label: '계약', title: '계약 끝 해', lower: true, value: (r) => r.lp?.contract.until ?? null, cell: (r) => <span className="small">{r.lp ? `${r.lp.contract.until}년` : '-'}</span> },
  ];

  return (
    <div className="stack">
      <section className="panel">
        <div className="row-between wrap">
          <h2>선수 찾기</h2>
          <button type="button" className="ghost" onClick={() => setF(EMPTY_FILTER)}>조건 지우기</button>
        </div>
        <div className="form-row">
          <label>이름<input type="search" value={f.text} placeholder="이름 일부" onChange={(e) => set({ text: e.target.value })} /></label>
          <label>구단
            <select value={String(f.team)} onChange={(e) => { const v = e.target.value; set({ team: v === 'all' || v === 'others' || v === 'free' ? v : Number(v) }); }}>
              <option value="others">우리 구단 빼고</option>
              <option value="all">전체</option>
              {session.world.teams.map((_, i) => <option key={i} value={i}>{session.teamInfo(i).name}{i === session.teamIdx ? ' (우리)' : ''}</option>)}
              <option value="free">자유계약</option>
            </select>
          </label>
          <label>구분
            <select value={f.kind} onChange={(e) => set({ kind: e.target.value as Kind, pos: e.target.value === 'hit' || e.target.value === 'all' ? f.pos : '' })}>
              <option value="all">전체</option><option value="hit">타자</option><option value="pit">투수</option><option value="sp">선발</option><option value="rp">구원</option>
            </select>
          </label>
          <label>포지션
            <select value={f.pos} disabled={f.kind !== 'all' && f.kind !== 'hit'} onChange={(e) => set({ pos: e.target.value })}>
              <option value="">전체</option>
              {POS.map((p) => <option key={p} value={p}>{posName(p)}</option>)}
            </select>
          </label>
          <label>나이
            <span className="inline">
              <input type="number" min={15} max={50} value={f.ageMin ?? ''} placeholder="최소" style={{ width: '5em' }} onChange={(e) => set({ ageMin: numOrNull(e.target.value) })} />
              {' ~ '}
              <input type="number" min={15} max={50} value={f.ageMax ?? ''} placeholder="최대" style={{ width: '5em' }} onChange={(e) => set({ ageMax: numOrNull(e.target.value) })} />
            </span>
          </label>
          <label title="타자 컨택·파워·선구, 투수 구위·제구·체력 추측의 가운데값 평균">능력 추측 이상<input type="number" min={20} max={80} step={5} value={f.guessMin ?? ''} placeholder="20~80" style={{ width: '7em' }} onChange={(e) => set({ guessMin: numOrNull(e.target.value) })} /></label>
          <label>국적
            <select value={f.foreign} onChange={(e) => set({ foreign: e.target.value as SearchFilter['foreign'] })}>
              <option value="all">전체</option><option value="domestic">국내</option><option value="foreign">외국인</option><option value="asia">아시아쿼터</option>
            </select>
          </label>
          <label>계약
            <select value={f.contract} onChange={(e) => set({ contract: e.target.value as SearchFilter['contract'] })}>
              <option value="all">전체</option><option value="fa">올해 끝남</option><option value="multi">내년 이후까지</option>
            </select>
          </label>
        </div>
        <p className="muted small" role="status">{rows.length}명. 열 머리를 누르면 그 열로 늘어놓습니다. 외국인은 트레이드할 수 없습니다. 능력은 우리 스카우트 팀의 추측이라 범위로 보이고 실제와 다를 수 있습니다 (타자 컨·파·선 = 컨택·파워·선구, 투수 구·제·체 = 구위·제구·체력).</p>
      </section>

      <section className="panel">
        <DataTable id="search" cols={cols} rows={rows} rowKey={(r) => String(r.p.idx)} full pageSize={PAGE}
          label="선수 찾기 결과" empty="조건에 맞는 선수가 없습니다." />
      </section>
    </div>
  );
}
