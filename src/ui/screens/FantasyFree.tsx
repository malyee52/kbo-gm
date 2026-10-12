// 자유 모드 (AI 진행): 무엇이든 글로 하면 AI 게임 마스터가 판정하고 실제 게임을 바꾼다 (src/fantasy/free.ts)
import { useState } from 'react';
import { freeAction, settlePromises, type FreeOp } from '../../fantasy/free';
import { duePromises, dueText } from '../../fantasy/promises';
import { effectText } from '../../fantasy/effects';
import { loadAiSettings } from '../../fantasy/settings';
import { formatDate } from '../../game/calendar';
import { useGame } from '../context';
import { changedRules, RULE_DEFS } from '../../league/rules';
import { leniencyOf, LENIENCY_LABEL } from '../../fantasy/leniency';

export function opText(op: FreeOp, nameOf: (id: string) => string, teamName: (t: number) => string): string {
  switch (op.op) {
    case 'move': return op.to < 0 ? `${nameOf(op.player)} 방출` : `${nameOf(op.player)} → ${teamName(op.to)}`;
    case 'create': return `${op.real ? '영입 (리그 밖)' : '새 선수'} ${op.name} (${teamName(op.team)}, ${op.pos === 'P' ? '투수' : op.pos === 'C' ? '포수' : op.pos === 'IF' ? '내야수' : '외야수'} ${op.age}세, 능력 ${op.now} 잠재 ${op.potential})`;
    case 'ability': return `${nameOf(op.player)} ${op.now !== undefined ? `능력 ${op.now}` : ''}${op.now !== undefined && op.potential !== undefined ? ' · ' : ''}${op.potential !== undefined ? `잠재 ${op.potential}` : ''}`;
    case 'contract': return `${nameOf(op.player)} 계약 연 ${(op.salary / 10000).toFixed(1)}억 원 ${op.years}년`;
    case 'teamCash': return `${teamName(op.team)} 자금 ${op.amount > 0 ? '+' : '−'}${Math.abs(op.amount / 10000).toFixed(1)}억 원`;
    case 'effect': return effectText(op.effect, nameOf);
    case 'pick': return `${op.draft} ${op.round}라운드 지명권(${teamName(op.from)} 원래) → ${teamName(op.to)}`;
    case 'rule': return `규정 변경: ${RULE_DEFS.find((d) => d.key === op.key)?.label ?? op.key} → ${op.value ?? '실제 규정'}`;
  }
}

/** compact: 홈 화면용 (입력 + 최근 행동 3개, 2026-10-13 사용자 요청) */
export function FantasyFree({ compact = false }: { compact?: boolean }) {
  const { session, store, changed, autosave, go } = useGame();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const L = session.league;
  const nameOf = (id: string) => L.players.find((p) => p.id === id)?.name ?? id;
  const teamName = (t: number) => L.teams[t]?.name ?? '?';
  const act = async () => {
    const a = text.trim();
    if (!a) return;
    setBusy(true);
    setMsg({ text: '게임 마스터가 판정하는 중입니다…' });
    try {
      const { entry, dropped } = await freeAction(session, store, loadAiSettings(), a);
      session.addFantasy(entry);
      setText('');
      setMsg(dropped.length ? { text: `반영하지 못한 조작: ${dropped.join(', ')}` } : null);
      changed();
      void autosave();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
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
        <textarea rows={compact ? 2 : 3} maxLength={1000} value={text} disabled={busy}
          placeholder="예: 롯데 단장에게 전화해 우리 2군 유망주 둘과 현금 10억으로 마무리 투수를 달라고 한다 / 일본 독립리그에서 강속구 투수를 찾아 데려온다 / 구단주에게 내년 예산 증액을 설득한다"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void act(); } }} />
        <div className="actions">
          <button type="button" onClick={() => void act()} disabled={busy || !text.trim()}>{busy ? '판정 중…' : '행동하기'}</button>
          <span className="muted small">AI 판정 {leniencyOf(L) + 1}/7 {LENIENCY_LABEL[leniencyOf(L)]} (저장·설정 → 난이도에서 바꿈). 명분이 있어야 통합니다. Ctrl+Enter. 결과는 바로 게임에 들어가고 저장·재현에도 남습니다.</span>
        </div>
        {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
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
          <p className="small chat-me"><span className="muted">단장</span> {e.ask}</p>
          <h3>{e.title}</h3>
          {e.text.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
          {e.ops?.length ? <ul className="plain small fantasy-ops">{e.ops.map((op, k) => <li key={k}>✓ {opText(op, nameOf, teamName)}</li>)}</ul> : <p className="muted small">게임 변화 없음</p>}
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
