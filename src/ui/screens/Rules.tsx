// 리그 > 규칙 연표: 지금 연도 규칙 전체와 지난 해들의 변화 (다시 보기). 표시만 한다 (league/ruleNews.ts).
import { useMemo } from 'react';
import { perkTeamsFor, ruleSnapshot, ruleSummary } from '../../league/ruleNews';
import { useGame } from '../context';
import { RuleNewsBody } from '../RuleNews';
import { voteAgendaText } from '../../league/ruleNews';
import type { RuleVoteRecord } from '../../ai/vote';
import { DataTable } from '../parts';
import type { Column } from '../table';
import { useShell } from '../shell';

export function Rules() {
  const { session, store } = useGame();
  const year = session.phase === 'offseason' ? session.year + 1 : session.year;
  const first = store.meta.years[0];
  const now = useMemo(() => {
    const sd = store.season(year);
    return ruleSummary(store.ruleChanges, ruleSnapshot(store.meta, year, session.league, sd ? { teams: sd.teams.length, games: sd.games } : undefined), perkTeamsFor(session.league, year));
  }, [store, session.league, year]);
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = year; y > first; y--) out.push(y);
    return out;
  }, [year, first]);
  return (
    <div className="stack">
      <section className="panel">
        <h1>규칙 연표</h1>
        <p className="muted small">
          게임이 쓰는 규칙 값과 연도별로 달라진 규칙입니다. 리그 운영 항목(엔트리·외국인·FA·캡·연장)의 전·후 값은 게임 값에서 읽습니다.
          <b> 조사값</b>은 웹 조사 값으로 자료집 제도연표로 확인하기 전입니다.
        </p>
        <h2>{year}년 리그 규칙{session.phase === 'offseason' ? ' (다음 시즌)' : ''}</h2>
        <ul className="rule-summary">{now.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="muted small">개막 때 "달라지는 규칙" 창은 시즌마다 한 번 뜹니다. 자동 진행으로 개막일을 지나쳤으면 진행이 멈출 때 뜹니다.</p>
      </section>
      <VoteHistory />
      {years.map((y) => <YearRules key={y} year={y} open={y === year} />)}
    </div>
  );
}

function YearRules({ year, open }: { year: number; open: boolean }) {
  const { session } = useGame();
  const news = useMemo(() => session.ruleNewsFor(year), [session, year]);
  const total = news.main.filter((l) => !l.info).length + news.other.length;
  return (
    <details className="panel rule-year" open={open}>
      <summary><strong>{year}</strong> <span className="muted small">{total ? `달라진 규칙 ${total}가지` : '달라진 규칙 없음'}{year < session.league.startYear ? ' · 게임 시작 전' : ''}</span></summary>
      <RuleNewsBody news={{ ...news, summary: [] }} />
      {news.dated.length > 0 && <ul className="muted small">{news.dated.map((d) => <li key={d.text}>{d.text}</li>)}</ul>}
      {news.closing.length > 0 && <ul className="muted small">{news.closing.map((d) => <li key={d}>{d}</li>)}</ul>}
    </details>
  );
}

/** 단장 회의 표결 이력 (구단투표 기획안 2.3): 가결·부결 모두, 최근 것부터 */
function VoteHistory() {
  const { session } = useGame();
  const full = useShell().density === 'full';
  const rows = useMemo(() => [...(session.league.ruleVotes ?? [])].reverse(), [session.league.ruleVotes]);
  if (!rows.length) return null;
  const name = (t: number) => session.league.teams[t]?.name ?? '';
  const side = (r: RuleVoteRecord, x: number) => r.votes.map((v, t) => (v === x ? t : -1)).filter((t) => t >= 0).map(name).join(' · ') || '없음';
  const ours = (r: RuleVoteRecord) => (r.userTeam === undefined ? '' : r.user === 'yes' ? '찬성' : r.user === 'no' ? '반대' : '반대 (안 냄)');
  const cols: Column<RuleVoteRecord>[] = [
    { key: 'year', label: '적용 시즌', value: (r) => r.year, fixed: true, brief: true },
    { key: 'agenda', label: '안건 (전 → 후)', value: (r) => voteAgendaText(r), text: true, brief: true },
    { key: 'count', label: '찬성 : 반대', value: (r) => r.yes, cell: (r) => `${r.yes} : ${r.no}`, brief: true },
    { key: 'need', label: '문턱', value: (r) => r.need },
    { key: 'result', label: '결과', value: (r) => (r.passed ? '가결' : '부결'), text: true, brief: true },
    { key: 'user', label: '우리 표', value: (r) => ours(r), text: true, brief: true },
    { key: 'yes', label: '찬성 구단', value: (r) => side(r, 1), text: true },
    { key: 'no', label: '반대 구단', value: (r) => side(r, 0), text: true },
  ];
  return (
    <section className="panel">
      <h2>단장 회의 표결 이력</h2>
      <p className="muted small">결산 때 리그 흐름 신호로 올라온 규칙 안건을 구단들이 표결한 기록입니다 (게임 속 가상 결정). 문턱 이상 찬성하면 다음 시즌부터 바뀌고, 부결된 안건은 같은 방향으로 2시즌 쉽니다.</p>
      <DataTable id="rule-votes" label="단장 회의 표결 이력" cols={cols} rows={rows} rowKey={(r) => r.id} full={full} empty="표결 기록이 없습니다." />
    </section>
  );
}
