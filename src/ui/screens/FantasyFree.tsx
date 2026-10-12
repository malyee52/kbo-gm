// 자유 모드 (AI 진행): 무엇이든 글로 하면 AI 게임 마스터가 판정하고 실제 게임을 바꾼다 (src/fantasy/free.ts)
import { useState } from 'react';
import { settlePromises } from '../../fantasy/free';
import { GmPreviewCard, opText, useGmJudge } from './GmPreview';
import { ChoiceButtons } from './FantasyChoices';
import { duePromises, dueText } from '../../fantasy/promises';
import { loadAiSettings } from '../../fantasy/settings';
import { formatDate } from '../../game/calendar';
import { useGame } from '../context';
import { changedRules } from '../../league/rules';
import { leniencyOf, LENIENCY_LABEL } from '../../fantasy/leniency';

export { opText };

/** compact: 홈 화면용 (입력 + 최근 행동 3개, 2026-10-13 사용자 요청) */
export function FantasyFree({ compact = false }: { compact?: boolean }) {
  const { session, store, changed, autosave, go } = useGame();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const L = session.league;
  const nameOf = (id: string) => L.players.find((p) => p.id === id)?.name ?? id;
  const teamName = (t: number) => L.teams[t]?.name ?? '?';
  // 판정 미리보기: 받아들이기·다시 판정·거둬들이기 (GmPreview.tsx)
  const judge = useGmJudge((_, accepted) => { setText(''); setMsg(accepted ? null : { text: '행동을 거둬들였습니다 (기록에는 남습니다).' }); });
  const act = () => {
    const a = text.trim();
    if (!a || judge.pending) return;
    setMsg(null);
    void judge.run(a);
  };
  const settle = async () => {
    setBusy(true);
    setMsg({ text: '게임 마스터가 약속을 판정하는 중입니다…' });
    try {
      const r = await settlePromises(session, store, loadAiSettings());
      if (r) session.addFantasy(r.entry);
      setMsg(r?.dropped.length ? { text: `반영하지 못한 조작: ${r.dropped.join(', ')}` } : null);
      changed();
      void autosave();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const promises = session.fantasy?.promises ?? [];
  const open = promises.filter((p) => p.status === 'open');
  const due = duePromises(session.fantasy, session.promiseNow);
  const statusLabel = { open: '진행 중', kept: '지킴', broken: '어김', void: '없던 일' } as const;
  const log = (session.fantasy?.log ?? []).filter((e) => e.kind === 'action').slice(compact ? -3 : -30).reverse();
  return (
    <section className="stack">
      <div className="panel stack">
        <h2>행동 <span className="muted small">무엇이든 하겠다고 쓰면 게임 마스터(AI)가 판정해 바로 반영합니다</span>{compact && <button type="button" className="link small card-more" onClick={() => go('fantasy')}>판타지 전체</button>}</h2>
        <textarea rows={compact ? 2 : 3} maxLength={1000} value={text} disabled={busy || judge.busy || !!judge.pending}
          placeholder="예: 롯데 단장에게 전화해 우리 2군 유망주 둘과 현금 10억으로 마무리 투수를 달라고 한다 / 일본 독립리그에서 강속구 투수를 찾아 데려온다 / 구단주에게 내년 예산 증액을 설득한다"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); act(); } }} />
        <div className="actions">
          <button type="button" onClick={act} disabled={busy || judge.busy || !!judge.pending || !text.trim()}>{judge.busy && !judge.pending ? '판정 중…' : '행동하기'}</button>
          <span className="muted small">AI 판정 {leniencyOf(L) + 1}/7 {LENIENCY_LABEL[leniencyOf(L)]} (저장·설정 → 난이도에서 바꿈). 명분이 있어야 통합니다. Ctrl+Enter. 결과는 바로 게임에 들어가고 저장·재현에도 남습니다.</span>
        </div>
        {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
        {judge.error && <p className="note error-box" role="status">{judge.error}</p>}
        <GmPreviewCard judge={judge} />
        {due.length > 0 && (
          <p className="note">기한이 된 약속 {due.length}개 <button type="button" className="small-btn" disabled={busy} onClick={() => void settle()}>약속 판정하기</button></p>
        )}
        {changedRules(L).length > 0 && (
          <p className="small"><strong>바뀐 규정</strong> {changedRules(L).map((c) => `${c.label} ${c.from ?? '실제'} → ${c.to ?? '실제'}`).join(' · ')}</p>
        )}
      </div>
      {!compact && promises.length > 0 && (
        <div className="panel">
          <h2>약속 장부 <span className="muted small">진행 중 {open.length}개 · 기한이 되면 게임 마스터가 지켰는지 판정합니다</span></h2>
          <ul className="plain small">
            {[...open, ...promises.filter((p) => p.status !== 'open').slice(-8).reverse()].map((p) => (
              <li key={p.id}><span className={p.status === 'broken' ? 'down' : p.status === 'kept' ? 'up' : 'muted'}>[{statusLabel[p.status]}]</span> {p.party}: {p.text} <span className="muted">(기한 {dueText(p)})</span></li>
            ))}
          </ul>
        </div>
      )}
      {log.length === 0 ? <p className="muted">아직 행동이 없습니다.</p> : log.map((e) => (
        <article key={e.id} className="panel">
          <p className="muted small">{e.day < 0 ? `${e.year} 오프시즌` : formatDate(e.year, e.day)}</p>
          {e.rival !== undefined ? <p className="small"><span className="muted">{e.who}</span></p> : <p className="small chat-me"><span className="muted">단장</span> {e.ask}</p>}
          <h3 className={e.withdrawn ? 'muted' : undefined}>{e.title}{e.rerolls ? <span className="muted small"> (다시 판정 {e.rerolls}번)</span> : null}</h3>
          {e.text.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
          {e.ops?.length ? <ul className="plain small fantasy-ops">{e.ops.map((op, k) => <li key={k}>✓ {opText(op, nameOf, teamName)}</li>)}</ul> : <p className="muted small">{e.withdrawn ? '거둬들임 — 게임 변화 없음' : '게임 변화 없음'}</p>}
          <ChoiceButtons entry={e} />
          {(e.promises?.length || e.settles?.length) ? (
            <ul className="plain small">
              {e.promises?.map((p, k) => <li key={`p${k}`}>🤝 약속: {p.party} — {p.text} (기한 {dueText(p)})</li>)}
              {e.settles?.map((x) => <li key={x.id}>📒 {promises.find((p) => p.id === x.id)?.text ?? x.id}: {statusLabel[x.status]}</li>)}
            </ul>
          ) : null}
        </article>
      ))}
    </section>
  );
}
