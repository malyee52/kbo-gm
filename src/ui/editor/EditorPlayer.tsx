// 에디터: 선수 하나의 숨긴 값 보기 (선수 상세 '에디터' 탭과 에디터 화면 아래 칸, docs/에디터_기획안.md 6.3).
// 진짜 값 옆에 우리 스카우트 추측을 나란히 둔다. 아래 고치기 칸 (E2).
import { useMemo, useState } from 'react';
import { driveWord, editorView, timingText, type EditorPlayerView } from '../../game/editor';
import { guessText } from '../../league/scout';
import { useGame } from '../context';
import { EditorEdit, type EditNote } from './EditorEdit';
import { EditorCurve } from './EditorCurve';
import { EditorDefense } from './EditorDefense';

const fmt = (x: number, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

/** 선수 상세 탭·에디터 화면 공용. 에디터가 꺼져 있거나 선수가 없으면 안내만 */
export function EditorPlayer({ id }: { id: string }) {
  const { session, version } = useGame();
  const v = useMemo(() => editorView(session, id), [session, id, version, session.editorOn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <p className="muted small">{session.editorOn ? '이 선수는 에디터로 볼 값이 없습니다.' : '에디터가 꺼져 있습니다 (저장·설정에서 켭니다).'}</p>;
  return <EditorPlayerBody key={v.id} v={v} />;
}

function EditorPlayerBody({ v }: { v: EditorPlayerView }) {
  // 고친 뒤 칸을 새 값으로 다시 연다 (epoch), 결과 문장은 여기 남긴다
  const [epoch, setEpoch] = useState(0);
  const [note, setNote] = useState<EditNote>(null);
  const guessOf = (key: string) => {
    const it = v.guessSet?.items.find((x) => x.key === key);
    return it ? guessText(it.view) : '-';
  };
  return (
    <div className="stack editor-player">
      <p className="small">
        <span className="tag">에디터</span> {v.name} · {v.place} · {v.pos} · {v.age === null ? '나이 모름' : `${v.ageEstimated ? '약 ' : ''}${v.age}세`}
        {!v.real && <span className="muted"> · 가상 선수</span>}
      </p>
      <div className="scroll flat">
        <table className="editor-grades">
          <thead><tr><th className="l">항목</th><th>진짜</th><th>천장</th><th>우리 추측</th></tr></thead>
          <tbody>
            <tr>
              <td className="l"><strong>종합</strong> <span className="muted small">(기여 {fmt(v.nowRuns)}런 → 천장 {fmt(v.potRuns)}런)</span></td>
              <td><span className="grade ed-true">{v.now}</span></td>
              <td><span className="grade ed-true">{v.pot}</span></td>
              <td className="muted small">{v.guess}{v.scoutPhrase ? ` · ${v.scoutPhrase}` : ''}</td>
            </tr>
            {v.grades.map((g) => (
              <tr key={g.key}>
                <td className="l">{g.label}</td>
                <td><span className="grade ed-true">{g.value}</span></td>
                <td>{g.ceil === undefined ? <span className="muted small">자라지 않음</span> : <span className="grade ed-true">{g.ceil}</span>}</td>
                <td className="muted small">{guessOf(g.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="editor-facts">
        <div><dt>AI가 보는 천장</dt><dd>{v.aiPot} <span className="muted small">({fmt(v.aiPotRuns)}런, 진짜와 {fmt(v.aiPotRuns - v.potRuns)}런 차이 · 난이도 오차)</span></dd></div>
        <div><dt>성장 성향</dt><dd>{driveWord(v.drive)} <span className="muted small">d {fmt(v.drive, 2)}{v.driveSet ? '' : ' (정해지지 않아 0으로 봄)'}</span></dd></div>
        <div><dt>성장 시기</dt><dd>{timingText(v.timing)} <span className="muted small">τ {fmt(v.timing, 2)}년</span></dd></div>
        <div><dt>조기 노쇠</dt><dd>{v.decline ? `${fmt(v.decline)}세 더 먹은 것으로` : '없음'}</dd></div>
        <div><dt>다음 시즌 슬럼프</dt><dd>{v.slump ? fmt(v.slump, 2) : '없음'}</dd></div>
        <div><dt>혹사지수</dt><dd>{v.overuse ? v.overuse.toFixed(2) : '0'}</dd></div>
        <div><dt>컨디션</dt><dd>{v.condition ? <>{v.condition.text} <span className="muted small">효과 {fmt(v.condition.value, 2)}</span></> : <span className="muted small">시즌 중 1군·2군 선수만</span>}</dd></div>
      </dl>
      <section>
        <h3>숨겨진 특수능력</h3>
        {v.traits.length === 0 ? <p className="muted small">없음</p> : (
          <ul className="editor-specials">
            {v.traits.map((t) => <li key={t.label}><strong>{t.label}</strong> <span className="small">{t.note}</span></li>)}
          </ul>
        )}
        <p className="muted small">특수능력은 에디터에서만 보이고 고칠 수 없습니다 (2026-11-03 결정).</p>
      </section>
      <EditorCurve id={v.id} />
      <EditorEdit key={`${v.id}:${epoch}`} v={v} note={note} onSaved={(n, ok) => { setNote(n); if (ok) setEpoch(epoch + 1); }} />
      {v.defense && <EditorDefense key={`${v.id}:def:${epoch}`} id={v.id} rows={v.defense} onSaved={(text, ok) => { setNote({ text, warn: [] }); if (ok) setEpoch(epoch + 1); }} />}
    </div>
  );
}
