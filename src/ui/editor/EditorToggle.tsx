// 에디터 켜기·끄기 칸 (저장·설정 화면, docs/에디터_기획안.md 2.1). 처음 켤 때만 확인 창을 띄운다.
// 이 폴더(src/ui/editor/)는 숨긴 값 시험의 의도된 예외 묶음이다. 숨긴 값은 game/editor.ts로만 얻는다.
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context';

/** 확인 창 문구 (2026-11-03 사용자 Q1·Q2·Q4 결정) */
export const EDITOR_CONFIRM_TEXT = [
  '에디터를 켜면 숨긴 값(진짜 능력·천장·성장 성향·시기·AI가 보는 천장·숨겨진 특수능력)이 에디터 화면과 선수 상세의 "에디터" 탭에서 보입니다.',
  '이 게임에는 "에디터 사용" 표시가 영구히 남습니다. 끄면 화면은 다시 숨김으로 돌아가지만 표시는 지워지지 않습니다.',
  '업적·구단주 평가·기록은 그대로 진행되고, 에디터를 켠 뒤 얻은 업적과 연표의 시즌에는 "에디터" 꼬리표가 붙습니다.',
];

/** 처음 켤 때 확인 창 */
export function EditorConfirm({ onOk, onCancel }: { onOk: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="player editor-confirm" aria-labelledby="editor-confirm-title" onClose={onCancel}>
      <div className="dialog-body">
        <h2 id="editor-confirm-title">에디터를 켤까요?</h2>
        {EDITOR_CONFIRM_TEXT.map((t) => <p key={t} className="small">{t}</p>)}
        <div className="inline">
          <button type="button" className="go" onClick={() => { onOk(); ref.current?.close(); }}>켜기</button>
          <button type="button" className="ghost" onClick={() => ref.current?.close()}>그만두기</button>
        </div>
      </div>
    </dialog>
  );
}

/** 저장·설정 화면의 에디터 칸 */
export function EditorPanel() {
  const { session, changed, autosave, go } = useGame();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const on = session.editorOn;
  const mark = session.editorMark;
  const first = session.league.editor?.firstOn;
  const set = (v: boolean) => {
    const r = session.setEditor(v);
    setNote(r.message);
    if (r.ok) { changed(); void autosave(); }
  };
  return (
    <section className="panel">
      <div className="row-between wrap">
        <h2>에디터 모드 {mark && <span className="tag" title="이 게임은 에디터를 켠 적이 있습니다">에디터 ({mark})</span>}</h2>
        <span className="inline">
          {on && <button type="button" className="small-btn ghost" onClick={() => go('editor')}>에디터 열기</button>}
          <button type="button" className={on ? 'small-btn ghost' : 'small-btn'} onClick={() => (on ? set(false) : mark ? set(true) : setAsking(true))}>{on ? '끄기' : '켜기'}</button>
        </span>
      </div>
      <p className="muted small">
        {on ? '켜져 있습니다. 아카이브 > 에디터와 선수 상세의 "에디터" 탭에서 숨긴 값을 보고 선수 값을 고칩니다 (고친 값은 조작 기록에 남습니다).'
          : '게임 안의 숨긴 값(진짜 능력·잠재력·성장 성향 등)을 보는 치트 도구입니다. 언제든 켜고 끌 수 있습니다.'}
        {first && ` 처음 켠 때: ${first.year}년${first.day >= 0 ? ' 시즌 중' : ' 오프시즌'}.`}
      </p>
      {note && <p className="note small" role="status">{note}</p>}
      {asking && <EditorConfirm onOk={() => set(true)} onCancel={() => setAsking(false)} />}
    </section>
  );
}
