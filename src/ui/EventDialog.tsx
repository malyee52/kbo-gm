// 시즌 중 무작위 이벤트 선택 창 (league/events.ts). 답하기 전에는 진행 버튼이 막힌다.
import { useState } from 'react';
import { eventDef } from '../league/events';
import { useGame } from './context';

export function EventDialog() {
  const { session, changed, autosave } = useGame();
  const [result, setResult] = useState<string | null>(null);
  const ev = session.pendingEvent;
  if (!ev && !result) return null;
  if (!ev) {
    return (
      <section className="panel event-panel" role="status">
        <p className="small">{result}</p>
        <div className="actions"><button type="button" className="ghost" onClick={() => setResult(null)}>닫기</button></div>
      </section>
    );
  }
  const def = eventDef(ev.id)!;
  const ctx = session.eventContext();
  return (
    <section className="panel event-panel" role="dialog" aria-label={`이벤트: ${def.title}`}>
      <h2><span className="muted small">이벤트</span> {def.title}</h2>
      <p>{def.text(ctx, ev.vars)}</p>
      <div className="event-choices">
        {def.choices.map((c, i) => (
          <button key={c.label} type="button" className={i === 0 ? 'ghost' : ''} onClick={() => {
            const r = session.answerEvent(i);
            setResult(`${def.title}: ${r.message}`);
            changed();
            void autosave();
          }}>
            <strong>{c.label}</strong>
            <span className="muted small">{c.note(ctx, ev.vars)}</span>
          </button>
        ))}
      </div>
      <p className="muted small">답하기 전에는 진행할 수 없습니다. 효과의 크기는 임시값입니다.</p>
    </section>
  );
}
