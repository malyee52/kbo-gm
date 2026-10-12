// 판타지 선택지 (대화의 제안·사건의 선택지)와 효과 표시
import { useState } from 'react';
import { effectText } from '../../fantasy/effects';
import type { FantasyEntry } from '../../fantasy/types';
import { useGame } from '../context';

export function ChoiceButtons({ entry }: { entry: FantasyEntry }) {
  const { session, changed, autosave } = useGame();
  const [msg, setMsg] = useState<string | null>(null);
  if (!entry.choices?.length) return null;
  const nameOf = (id: string) => session.league.players.find((p) => p.id === id)?.name ?? id;
  if (entry.chosen !== undefined) {
    const c = entry.choices[entry.chosen];
    return (
      <p className="small fantasy-chosen">
        <strong>선택: {c.label}</strong>{c.result ? ` — ${c.result}` : ''}
        {c.effects.length > 0 && <span className="muted"> ({c.effects.map((x) => effectText(x, nameOf)).join(', ')})</span>}
      </p>
    );
  }
  const pick = (i: number) => {
    const r = session.chooseFantasy(entry.id!, i);
    setMsg(r.message);
    if (r.ok) { changed(); void autosave(); }
  };
  return (
    <div className="fantasy-choices">
      {entry.choices.map((c, i) => (
        <button key={i} type="button" className={i === 0 ? '' : 'ghost'} onClick={() => pick(i)}>
          {c.label}
          {c.effects.length > 0 && <span className="small fantasy-effects">{c.effects.map((x) => effectText(x, nameOf)).join(' · ')}</span>}
        </button>
      ))}
      {msg && <span className="muted small">{msg}</span>}
    </div>
  );
}
