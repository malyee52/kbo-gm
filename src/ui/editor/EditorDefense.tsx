// 에디터 수비 고치기 (2026-11-05 사용자, 기획서 v2 부록 B 물음 4): 선수 상세 수비 칸의 "고치기"를 에디터로 옮겼다.
// 진짜 포지션별 수비 등급(20~80, 50 = 그 자리 평균, 5런 = 10점)에서 시작하고, 고친 자리는 수비 가능(익숙함이 다 참)이 된다.
// 조작 하나(def-edit / def-edit-off)로 남고 고친 기록 탭과 사용 표시에 나온다.
import { useState } from 'react';
import type { EditorDefense as Row } from '../../game/editor';
import { useGame } from '../context';

export function EditorDefense({ id, rows, onSaved }: { id: string; rows: Row[]; onSaved: (text: string, ok: boolean) => void }) {
  const { session, changed, autosave } = useGame();
  const [val, setVal] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.pos, String(r.grade)])));
  // 등급을 바꾼 자리만 수비 런으로 (등급 → 런: (등급 − 50) ÷ 2)
  const changes = rows.flatMap((r) => {
    const v = Number(val[r.pos]);
    if (!Number.isFinite(v) || Math.round(v) === r.grade) return [];
    const g = Math.max(20, Math.min(80, Math.round(v)));
    return [{ pos: r.pos, from: r.grade, to: g, runs: (g - 50) / 2 }];
  });
  const save = () => {
    const r = session.editDefense(id, Object.fromEntries(changes.map((c) => [c.pos, c.runs])));
    onSaved(r.message, r.ok);
    if (r.ok) { changed(); void autosave(); }
  };
  return (
    <section className="editor-edit">
      <h3>수비 고치기</h3>
      <div className="scroll flat">
        <table className="editor-grades editor-branches">
          <thead><tr><th className="l">자리</th><th>진짜</th><th>고칠 값</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pos}>
                <td className="l">{r.pos}</td>
                <td><span className="grade ed-true">{r.grade}</span></td>
                <td><input type="number" min={20} max={80} value={val[r.pos] ?? ''} onChange={(x) => setVal({ ...val, [r.pos]: x.target.value })} aria-label={`${r.pos} 수비 등급`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {changes.length > 0 && (
        <div className="editor-preview" role="status">
          <ul className="small">{changes.map((c) => <li key={c.pos}>수비 {c.pos} {c.from} → {c.to}</li>)}</ul>
        </div>
      )}
      <div className="inline">
        <button type="button" className="small-btn" disabled={!changes.length || !!session.gameLock} onClick={save}>수비 고치기</button>
        {session.gameLock && <span className="muted small">{session.gameLock}</span>}
        <span className="muted small">20~80 (50 = 그 자리 평균, 40 아래면 맡기기 어렵다). 고친 자리는 수비 가능이 되고, 조작 기록에 남아 재현됩니다.</span>
      </div>
    </section>
  );
}
