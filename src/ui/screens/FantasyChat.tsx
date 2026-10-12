// 판타지 3단계: 가상 인물과 자유 대화 (src/fantasy/cast.ts·ai.ts). 대화마다 이야기 기록에 남고, 제안된 효과는 받아들여야 적용된다.
import { useState } from 'react';
import { castOf, type CastMember } from '../../fantasy/cast';
import { chatTurn } from '../../fantasy/ai';
import { loadAiSettings } from '../../fantasy/settings';
import { useGame } from '../context';
import { ChoiceButtons } from './FantasyChoices';

export function FantasyChat() {
  const { session } = useGame();
  const cast = castOf(session.league);
  const [who, setWho] = useState<CastMember>(cast[0]);
  return (
    <section className="stack">
      <div className="panel">
        <h2>대화 <span className="muted small">가상 인물 (실존 인물이 아닙니다)</span></h2>
        <div className="seg" role="tablist" aria-label="대화 상대">
          {cast.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={who.key === c.key} className={who.key === c.key ? 'on' : ''} onClick={() => setWho(c)}>
              {c.role} {c.name}
            </button>
          ))}
        </div>
        <p className="muted small">{who.persona}</p>
      </div>
      <Thread c={who} />
    </section>
  );
}

function Thread({ c }: { c: CastMember }) {
  const { session, store, changed } = useGame();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const entries = (session.fantasy?.log ?? []).filter((e) => e.kind === 'chat' && e.who === c.name).slice(-20);
  const send = async () => {
    const ask = text.trim();
    if (!ask) return;
    setBusy(true);
    setErr(null);
    try {
      const e = await chatTurn(session, store, loadAiSettings(), c, ask);
      session.addFantasy(e);
      setText('');
      changed();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel stack">
      {entries.length === 0 && <p className="muted small">{c.role} {c.name}에게 말을 걸어 보세요. 트레이드 소문, 유망주, 팬 반응, 계약, 구단주 생각 무엇이든.</p>}
      <div className="chat-log">
        {entries.map((e) => (
          <div key={e.id} className="chat-turn">
            <p className="chat-me"><span className="muted small">단장</span> {e.ask}</p>
            <p className="chat-them"><span className="muted small">{c.name}</span> {e.text}</p>
            <ChoiceButtons entry={e} />
          </div>
        ))}
      </div>
      <div className="chat-input">
        <textarea value={text} rows={2} maxLength={500} placeholder={`${c.name}에게 할 말`} disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button type="button" onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? '답을 기다리는 중…' : '보내기'}</button>
      </div>
      {err && <p className="note error-box" role="status">{err}</p>}
    </div>
  );
}
