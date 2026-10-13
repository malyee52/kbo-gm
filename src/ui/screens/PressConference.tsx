// 기자회견 (src/fantasy/press.ts): 질문 받기 → 답하기 → 기사와 반응 (팬·구단주·선수단)
import { useState } from 'react';
import { pressBlock, pressJudge, pressQuestions } from '../../fantasy/press';
import { effectText } from '../../fantasy/effects';
import { loadAiSettings } from '../../fantasy/settings';
import { useGame } from '../context';

export function PressConference({ compact = false }: { compact?: boolean }) {
  const { session, store, changed, autosave } = useGame();
  const [q, setQ] = useState<{ reporter: string; questions: string[] } | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  if (!session.fantasy) return null;
  const block = pressBlock(session);
  const open = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setQ(await pressQuestions(session, store, loadAiSettings()));
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const reply = async () => {
    if (!q) return;
    setBusy(true);
    setMsg(null);
    try {
      const e = await pressJudge(session, store, loadAiSettings(), q.reporter, q.questions, answer.trim());
      session.addFantasy(e);
      const fx = (e.effects ?? []).map((x) => effectText(x, (id) => id)).join(', ');
      setMsg({ text: `기사: ${e.title}${fx ? ` (${fx})` : ''}` });
      setQ(null);
      setAnswer('');
      changed();
      void autosave();
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={compact ? 'negotiate small' : 'panel stack'}>
      {!compact && <h2>기자회견 <span className="muted small">답에 따라 팬·구단주·선수단 분위기가 바뀝니다 (시즌 중 7일에 한 번, 오프시즌 한 번)</span></h2>}
      {!q ? (
        <span className="inline">
          <button type="button" className={compact ? 'small-btn ghost' : ''} onClick={() => void open()} disabled={busy || !!block}>{busy ? '기자들이 모이는 중…' : '기자회견 열기'}</button>
          {block && <span className="muted small">{block}</span>}
        </span>
      ) : (
        <>
          <p className="small"><strong>{q.reporter} 기자</strong></p>
          <ol className="small">{q.questions.map((x, k) => <li key={k}>{x}</li>)}</ol>
          <textarea rows={3} maxLength={1000} value={answer} disabled={busy} placeholder="단장의 답 (질문 모두에 한 번에)" onChange={(e) => setAnswer(e.target.value)} />
          <span className="inline">
            <button type="button" className="small-btn" onClick={() => void reply()} disabled={busy || !answer.trim()}>{busy ? '기사 쓰는 중…' : '답하기'}</button>
            <button type="button" className="small-btn ghost" onClick={() => setQ(null)} disabled={busy}>취소</button>
          </span>
        </>
      )}
      {msg && <p className={msg.error ? 'note error-box' : 'note'}>{msg.text}</p>}
    </div>
  );
}
