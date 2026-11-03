// 에디터: 리그 규정 고치기 (docs/에디터_기획안.md 3.2·7장 E4). 자유 모드 rule 조작을 그대로 쓴다 (league/rules.ts, AI 구단에도 같이).
// 한 규정씩 "전 → 후"를 보고 고친다. 바꾼 규정은 고친 기록 탭과 기록실 연표(그 시즌 줄)에 남는다.
import { useMemo, useState } from 'react';
import { editorPreview, editorRules, ruleText, type EditorRuleRow } from '../../game/editor';
import type { EditOp } from '../../game/editOps';
import { RULE_DEFAULTS } from '../../league/rules';
import { useGame } from '../context';

export function EditorRules() {
  const { session, version } = useGame();
  const rows = useMemo(() => editorRules(session) ?? [], [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [note, setNote] = useState<{ text: string; warn: string[] } | null>(null);
  return (
    <section className="panel">
      <h2>리그 규정</h2>
      <p className="muted small">바꾼 규정은 AI 구단에도 똑같이 적용되고 저장·재현됩니다. 범위 안으로 맞추며, 규정을 넘어선 결과는 평소 규칙대로 따라옵니다.</p>
      <div className="scroll flat">
        <table className="editor-rules">
          <thead><tr><th className="l">규정</th><th>지금</th><th>기본</th><th className="l">새 값</th></tr></thead>
          <tbody>{rows.map((r) => <RuleRow key={`${r.key}:${version}`} r={r} onDone={setNote} />)}</tbody>
        </table>
      </div>
      {note && (
        <div role="status">
          <p className="note small">{note.text}</p>
          {note.warn.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
        </div>
      )}
    </section>
  );
}

function RuleRow({ r, onDone }: { r: EditorRuleRow; onDone: (n: { text: string; warn: string[] }) => void }) {
  const { session, changed, autosave } = useGame();
  const [v, setV] = useState(r.value === null ? '' : String(r.value));
  const value = v.trim() === '' ? (r.nullable ? null : NaN) : Number(v);
  const op: EditOp = { op: 'rule', key: r.key, value };
  const pv = useMemo(() => (value === r.value ? null : editorPreview(session, [op])), [session, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    const res = session.editPlayer([op]);
    onDone({ text: res.message, warn: res.warnings });
    if (res.ok) { changed(); void autosave(); }
  };
  return (
    <tr className={r.changed ? 'me' : undefined}>
      <td className="l">{r.label} <span className="muted small">({r.min}~{r.max}{r.unit})</span></td>
      <td><strong>{ruleText(r.key, r.value)}</strong></td>
      <td className="muted small">{ruleText(r.key, RULE_DEFAULTS[r.key])}</td>
      <td className="l">
        <span className="inline">
          <input type="number" step={r.key === 'capScale' || r.key === 'capFineScale' ? 0.05 : 1} value={v} placeholder={r.nullable ? '비우면 실제 규정' : ''}
            onChange={(e) => setV(e.target.value)} aria-label={`${r.label} 새 값`} />
          <button type="button" className="small-btn" disabled={!pv || !!pv.error} onClick={save}>바꾸기</button>
          {r.changed && (
            <button type="button" className="small-btn ghost" onClick={() => setV(RULE_DEFAULTS[r.key] === null ? '' : String(RULE_DEFAULTS[r.key]))}>기본값</button>
          )}
        </span>
        {pv && (pv.error ? <p className="warn-line small">{pv.error}</p> : <p className="small">{pv.lines.join(' / ')}{pv.warnings.map((w) => ` · 경고: ${w}`).join('')}</p>)}
      </td>
    </tr>
  );
}
