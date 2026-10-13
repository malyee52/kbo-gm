// 구단주와 정기 면담 (src/fantasy/ownerMeeting.ts): 안건 듣기 → 답하기 → 신뢰·자금 변화
import { useState } from 'react';
import { meetingAgenda, meetingJudge, meetingSlot, SLOT_LABEL } from '../../fantasy/ownerMeeting';
import { effectText } from '../../fantasy/effects';
import { loadAiSettings } from '../../fantasy/settings';
import { useGame } from '../context';

export function OwnerMeeting({ compact = false }: { compact?: boolean }) {
  const { session, store, changed, autosave } = useGame();
  const [a, setA] = useState<{ speaker: string; agenda: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const slot = meetingSlot(session);
  if (!session.fantasy || (!slot && !a && !msg)) return null;
  const open = async () => {
    if (!slot) return;
    setBusy(true);
    setMsg(null);
    try {
      setA(await meetingAgenda(session, store, loadAiSettings(), slot));
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const reply = async () => {
    if (!a || !slot) return;
    setBusy(true);
    setMsg(null);
    try {
      const e = await meetingJudge(session, store, loadAiSettings(), slot, a.speaker, a.agenda, answer.trim());
      session.addFantasy(e);
      const fx = (e.effects ?? []).map((x) => effectText(x, (id) => id)).join(', ');
      setMsg({ text: `${e.title}: ${e.text}${fx ? ` (${fx})` : ''}` });
      setA(null);
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
      {!compact && <h2>구단주 면담 <span className="muted small">한 해 세 번 (시즌 전·중반·결산). 답에 따라 신뢰와 예산이 바뀝니다</span></h2>}
      {slot && !a && (
        <button type="button" className={compact ? 'small-btn ghost' : ''} onClick={() => void open()} disabled={busy}>
          {busy ? '면담 준비 중…' : `${SLOT_LABEL[slot]} 열기`}
        </button>
      )}
      {a && (
        <>
          <p className="small"><strong>{a.speaker} (구단주 비서실장)</strong> {a.agenda}</p>
          <textarea rows={3} maxLength={1000} value={answer} disabled={busy} placeholder="단장의 답·제안 (예: 내년 우승을 위해 외국인 투수 예산 20억 증액을 요청드립니다)" onChange={(e) => setAnswer(e.target.value)} />
          <span className="inline">
            <button type="button" className="small-btn" onClick={() => void reply()} disabled={busy || !answer.trim()}>{busy ? '구단주가 듣는 중…' : '답하기'}</button>
          </span>
        </>
      )}
      {msg && <p className={msg.error ? 'note error-box' : 'note'}>{msg.text}</p>}
    </div>
  );
}
