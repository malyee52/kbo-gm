// 관심 명단 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 3·결정 9): 영입 > 관심 명단.
// 선수 상세·구단 창·드래프트·FA 표의 ☆로 담는다. 목록은 그 게임 저장 파일에 담기고(저장마다 따로) 조작 기록에는 넣지 않는다.
// 은퇴한 선수는 "은퇴" 회색으로 남기고 사용자가 직접 뺀다. 지명 안 된 신인 후보는 다음 개막 때 저절로 빠진다 (game/watch.ts).
import { useMemo } from 'react';
import { dollarText } from '../../league/salary';
import { overall, slotOf, tradeBlockReason } from '../tradeDesk';
import { runsGrade } from '../grades';
import { isStarterSkill } from '../../engine';
import { Grade, PlayerLink, Pos, TeamLink, useGame, useWon } from '../context';
import { DataTable, PotCell, potentialSortValue, usePotentialOf } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';
import type { WatchEntry, WatchStatus } from '../../game/watch';
import type { LeaguePlayer } from '../../league/types';
import type { SimPlayer } from '../../engine';

/** ☆ 관심: 누르면 담거나 뺀다 (저장 파일에 남는다) */
/** small: 작은 단추, bare: 별만 (표 안) */
export function WatchStar({ id, name, small = false, bare = false }: { id: string; name: string; small?: boolean; bare?: boolean }) {
  const { session, changed } = useGame();
  const on = session.isWatched(id);
  return (
    <button type="button" className={`ghost watch-star${small ? ' small-btn' : ''}${on ? ' on' : ''}`} aria-pressed={on}
      aria-label={on ? `${name} 관심 명단에서 빼기` : `${name} 관심 명단에 담기`} title={on ? '관심 명단에서 빼기' : '관심 명단에 담기 (이 게임 저장 파일에 남습니다)'}
      onClick={(e) => { e.stopPropagation(); session.toggleWatch(id, name); changed(); }}>
      {on ? '★' : '☆'}{bare ? '' : on ? ' 관심 중' : ' 관심'}
    </button>
  );
}

interface Row { w: WatchEntry; st: WatchStatus; lp: LeaguePlayer | undefined; p: SimPlayer | null; age: number | null; ov: number | null; slot: string; trade: string | null }

export function Watch() {
  const { session, version, changed } = useGame();
  const won = useWon();
  const potOf = usePotentialOf();
  const { density } = useShell();
  const off = session.phase === 'offseason';
  const year = session.world.year;
  const rows: Row[] = useMemo(() => {
    const lps = new Map(session.league.players.map((p) => [p.id, p]));
    const wps = new Map(session.world.players.map((p) => [p.id, p]));
    return session.watch.map((w) => {
      const st = session.watchStatus(w.id);
      const lp = lps.get(w.id);
      const wp = wps.get(w.id) ?? null;
      // 시즌 중엔 월드 선수(지금 능력), 오프시즌엔 리그 상태(다음 시즌 예상)
      const p = !off && wp ? wp : null;
      const age = p ? p.age : lp?.birthYear ? year + (off ? 1 : 0) - lp.birthYear : null;
      const ov = p ? overall(session, p) : lp && off ? runsGrade(session.nextRuns(lp.id), year) : null;
      const slot = p ? slotOf(p) : lp ? (lp.isPitcher ? (isStarterSkill(lp.pit) ? 'SP' : 'RP') : lp.pos ?? 'DH') : '-';
      const trade = p && p.teamIdx >= 0 && p.teamIdx !== session.teamIdx ? tradeBlockReason(session, p) ?? '트레이드 가능' : null;
      return { w, st, lp, p: wp, age, ov, slot, trade };
    });
  }, [session, version, off, year]);

  const remove = (w: WatchEntry) => { session.toggleWatch(w.id, w.name); changed(); };
  const cols: Column<Row>[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (r) => r.w.name,
      cell: (r) => (r.p && !r.st.gray ? <PlayerLink p={r.p} /> : <span>{r.lp?.name ?? r.w.name}</span>) },
    { key: 'st', label: '상태', brief: true, text: true, value: (r) => r.st.text,
      cell: (r) => (r.st.kind === 'team' ? <TeamLink idx={r.st.team} /> : <span className={r.st.gray ? 'muted' : 'status'}>{r.st.text}</span>) },
    { key: 'slot', label: '자리', brief: true, value: (r) => r.slot, cell: (r) => (r.slot === 'SP' || r.slot === 'RP' || r.slot === '-' ? r.slot : <Pos pos={r.slot} />) },
    { key: 'age', label: '나이', brief: true, lower: true, value: (r) => (r.st.gray ? null : r.age) },
    { key: 'ov', label: '종합', brief: true, value: (r) => (r.st.gray ? null : r.ov), cell: (r) => (r.st.gray ? '-' : <Grade v={r.ov} />) },
    { key: 'pot', label: '잠재', brief: true, title: '27세 이하 범위(스카우트 짐작), 28~30세 숫자, 31세 이상 숨김',
      value: (r) => (r.lp && !r.st.gray ? potentialSortValue(potOf(r.lp, r.age)) : null), cell: (r) => (r.lp && !r.st.gray ? <PotCell v={potOf(r.lp, r.age)} /> : '-') },
    { key: 'sal', label: '연봉', brief: true, value: (r) => r.lp?.contract.salary ?? null,
      cell: (r) => (r.lp && !r.st.gray && r.st.kind !== 'prospect' && r.st.kind !== 'undrafted' ? (r.lp.foreign ? dollarText(r.lp.contract.salary) : won(r.lp.contract.salary)) : '-') },
    { key: 'until', label: '계약', title: '계약 마지막 해', value: (r) => (r.lp && r.st.kind === 'team' ? r.lp.contract.until : null) },
    { key: 'trade', label: '트레이드', text: true, title: '시즌 중 다른 구단 선수만', value: (r) => r.trade, cell: (r) => (r.trade ? <span className="small">{r.trade === '트레이드 가능' ? r.trade : '불가'}</span> : '-') },
    { key: 'year', label: '담은 해', value: (r) => r.w.year },
    { key: 'act', label: '', fixed: true, value: () => null, cell: (r) => <button type="button" className="ghost small-btn" onClick={() => remove(r.w)} aria-label={`${r.w.name} 빼기`}>빼기</button> },
  ];

  return (
    <div className="stack">
      <p className="muted small">
        선수 상세·구단 창·드래프트·FA 표의 ☆로 담습니다. 목록은 <strong>이 게임의 저장 파일</strong>에 함께 저장됩니다 (다른 저장과 따로).
        은퇴한 선수는 회색으로 남으니 직접 빼세요. 지명되지 않은 신인 후보는 다음 시즌 개막 때 저절로 빠집니다.
      </p>
      <DataTable id="watch" cols={cols} rows={rows} rowKey={(r) => r.w.id} full={density === 'full'} searchText={(r) => r.w.name}
        rowClass={(r) => (r.st.gray ? 'blocked' : undefined)} label="관심 명단" empty="담은 선수가 없습니다. 선수 상세의 ☆ 관심을 누르세요." />
    </div>
  );
}
