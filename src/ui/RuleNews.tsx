// "올해 달라지는 규칙" 알림 (docs/리그규칙변경_기획안.md 2장): 개막 전용 창, 목록 부품, 확인 상태 배지.
// 표시만 한다. 창을 봤는지는 저장하지 않는다. 개막 창은 시즌마다 한 번 꼭 띄운다 (2026-10-22 사용자 결정: "띄우지 않기"를 없앰).
import { useEffect, useRef } from 'react';
import type { RuleStatus } from '../data/types';
import { CAT_LABEL, EFFECT_LABEL, STATUS_HELP, STATUS_LABEL, type RuleLine, type RuleNews } from '../league/ruleNews';
import { useGame } from './context';
import { teamVars } from './teams';


export function StatusBadge({ status }: { status: RuleStatus }) {
  return <span className={`tag rule-status rule-${status}`} title={STATUS_HELP[status]} tabIndex={0}>{STATUS_LABEL[status]}</span>;
}

function Line({ l }: { l: RuleLine }) {
  return (
    <li className="rule-line">
      <div className="rule-head">
        <strong>{l.title}</strong>
        {(l.before || l.after) && <span className="rule-change">{l.before ? <>{l.before} → {l.after}</> : l.after}</span>}
      </div>
      {l.vote && <div className="small rule-vote">{l.vote}</div>}
      {l.real && <div className="muted small">실제: {l.real}</div>}
      {l.detail?.map((d) => <div key={d} className="muted small">{d}</div>)}
      {l.simplified && <div className="muted small">게임은 단순화: {l.simplified}</div>}
      {l.note && <div className="muted small">{l.note}</div>}
      <div className="rule-meta">
        <span className="muted small">{EFFECT_LABEL[l.effect]}</span>
        <StatusBadge status={l.status} />
      </div>
    </li>
  );
}

/** 분류별 묶음. 위 칸이 10줄 넘으면 분류마다 접을 수 있게 */
function Grouped({ lines, fold }: { lines: RuleLine[]; fold: boolean }) {
  const cats = [...new Set(lines.map((l) => l.cat))];
  return (
    <>
      {cats.map((c) => {
        const ls = lines.filter((l) => l.cat === c);
        const body = <ul className="rule-lines">{ls.map((l, i) => <Line key={`${l.title}-${i}`} l={l} />)}</ul>;
        return fold
          ? <details key={c} className="rule-cat" open={c === 'ball'}><summary>{CAT_LABEL[c]} ({ls.length})</summary>{body}</details>
          : <div key={c} className="rule-cat"><h3>{CAT_LABEL[c]}</h3>{body}</div>;
      })}
    </>
  );
}

/** 단장 회의에서 부결된 안건 (접힌 줄 하나, 구단투표 기획안 2.3) */
function Rejected({ news }: { news: RuleNews }) {
  if (!news.rejected?.length) return null;
  return (
    <details className="rule-other">
      <summary>부결된 안건 ({news.rejected.length}건, 게임 속 가상 결정)</summary>
      <ul className="plain small">{news.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
    </details>
  );
}

/** 알림 본문: 시작 연도 요약 → 위 칸 → 그 밖의 변경(접힘) → 지난 시즌 한 줄 */
export function RuleNewsBody({ news, lines }: { news: RuleNews; lines?: RuleLine[] }) {
  const main = lines ?? news.main;
  return (
    <div className="rule-news">
      {news.summary.length > 0 && (
        <div className="rule-cat">
          <h3>{news.year}년 리그 규칙 (게임 값)</h3>
          <ul className="rule-summary">{news.summary.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      {main.length === 0 && news.other.length === 0 && <p className="muted">지난해와 달라진 규칙이 없습니다.</p>}
      <Grouped lines={main} fold={main.length > 10} />
      {news.other.length > 0 && (
        <details className="rule-other">
          <summary>그 밖의 변경 ({news.other.length}가지)</summary>
          <ul className="rule-lines">{news.other.map((l, i) => <Line key={`${l.title}-${i}`} l={l} />)}</ul>
        </details>
      )}
      <Rejected news={news} />
      {news.dated.length > 0 && <p className="muted small">시즌 중 바뀌는 것 {news.dated.length}가지는 그날 소식으로 알립니다.</p>}
      {news.lastSeason && <p className="muted small">{news.lastSeason}</p>}
    </div>
  );
}

/**
 * 개막 준비 카드의 미리 보기 (UI 2단계 기획안 2.5.3): 위 칸 앞 top줄만 펼치고 나머지 위 칸·그 밖의 변경은 접는다.
 * 줄 모양은 개막 창(RuleNewsBody)과 같다
 */
export function RulePreviewBody({ news, lines, top }: { news: RuleNews; lines: RuleLine[]; top: number }) {
  const head = lines.slice(0, top);
  const rest = [...lines.slice(top), ...news.other];
  return (
    <div className="rule-news">
      {news.summary.length > 0 && (
        <details className="rule-cat">
          <summary>{news.year}년 리그 규칙 (게임 값)</summary>
          <ul className="rule-summary">{news.summary.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      {lines.length === 0 && news.other.length === 0 && <p className="muted small">지난해와 달라진 규칙이 없습니다.</p>}
      {head.length > 0 && <ul className="rule-lines">{head.map((l, i) => <Line key={`${l.title}-${i}`} l={l} />)}</ul>}
      {rest.length > 0 && (
        <details className="rule-other">
          <summary>그 밖의 변경 {rest.length}가지</summary>
          <ul className="rule-lines">{rest.map((l, i) => <Line key={`${l.title}-${i}`} l={l} />)}</ul>
        </details>
      )}
      <Rejected news={news} />
      {news.dated.length > 0 && <p className="muted small">시즌 중 바뀌는 것 {news.dated.length}가지는 그날 소식으로 알립니다.</p>}
    </div>
  );
}

/** 개막 전용 창 (한 번 보고 닫으면 끝) */
export function RuleNewsDialog({ news, onClose }: { news: RuleNews; onClose: () => void }) {
  const { session, go } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const close = () => { ref.current?.close(); onClose(); };
  return (
    <dialog ref={ref} className="player summary tv" onClose={onClose} aria-label={`${news.year} 시즌 달라지는 규칙`} style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2>{news.start ? `${news.year} 시즌 리그 규칙` : `${news.year} 시즌, 달라지는 규칙`}</h2>
            {/* 시작 해가 아니면 개막 준비 단계에서 미리 본 내용과 같다 (UI 2단계 기획안 2.5.3: 반복을 덜 느끼게 한 줄) */}
            {!news.start && <p className="muted small">개막 준비에서 미리 본 내용과 같습니다.</p>}
            <p className="muted small">조사값 배지는 웹 조사 값으로, 자료집 제도연표로 확인하기 전입니다.</p>
          </div>
          <button type="button" className="ghost" onClick={close}>닫기</button>
        </header>
        <RuleNewsBody news={news} />
        <div className="actions">
          <button type="button" className="ghost" onClick={() => { close(); go('rules'); }}>규칙 연표 전체 보기</button>
        </div>
      </div>
    </dialog>
  );
}
