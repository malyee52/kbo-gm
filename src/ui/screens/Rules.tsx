// 리그 > 규칙 연표: 지금 연도 규칙 전체와 지난 해들의 변화 (다시 보기). 표시만 한다 (league/ruleNews.ts).
import { useMemo, useState } from 'react';
import { ruleSnapshot, ruleSummary } from '../../league/ruleNews';
import { useGame } from '../context';
import { RuleNewsBody, ruleDialogMuted, setRuleDialogMuted } from '../RuleNews';

export function Rules() {
  const { session, store } = useGame();
  const year = session.phase === 'offseason' ? session.year + 1 : session.year;
  const first = store.meta.years[0];
  const [muted, setMuted] = useState(ruleDialogMuted);
  const now = useMemo(() => {
    const sd = store.season(year);
    return ruleSummary(store.ruleChanges, ruleSnapshot(store.meta, year, session.league, sd ? { teams: sd.teams.length, games: sd.games } : undefined));
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
        <label className="small"><input type="checkbox" checked={!muted} onChange={(e) => { setRuleDialogMuted(!e.target.checked); setMuted(!e.target.checked); }} /> 개막 때 "달라지는 규칙" 창 띄우기 (이 브라우저 설정)</label>
      </section>
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
