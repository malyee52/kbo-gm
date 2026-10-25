// 전력 > 기용 보드, 오프시즌 개막 준비 단계 (2026-10-23 사용자 결정): 개막 날 기용 보드를 미리 연다.
// 미리 보기 세션(openingBoard.ts)을 기존 기용 보드에 그대로 넘긴다. 고친 것은 개막 때 실제 세션으로 옮겨진다.
import { useEffect, useMemo, useState } from 'react';
import { computeGrades } from '../../engine';
import type { GameSession } from '../../game/session';
import { GameProvider, useGame, type GameUi } from '../context';
import { openingPreview } from '../openingBoard';
import { LineupBoard } from './LineupBoard';

export function OpeningBoard() {
  const ui = useGame();
  const { session, go } = ui;
  // undefined = 만드는 중, null = 만들 수 없음
  const [preview, setPreview] = useState<GameSession | null | undefined>(() => openingPreview(session, false) ?? undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (preview !== undefined) return;
    // 개막은 리그 환경 맞춤이 있어 잠깐 걸린다: 안내 문구를 먼저 그리고 만든다
    const t = setTimeout(() => setPreview(openingPreview(session)), 30);
    return () => clearTimeout(t);
  }, [preview, session]);
  const grades = useMemo(() => (preview ? computeGrades(preview.world) : null), [preview]);
  const year = session.year + 1;

  if (!preview || !grades) {
    return (
      <section className="panel">
        <h2>{year} 개막 기용 미리 보기</h2>
        <p className="muted">{preview === null ? '개막 준비 단계에서만 열 수 있습니다.' : `${year} 시즌 개막 모습을 만드는 중입니다 (리그 환경 맞춤)…`}</p>
      </section>
    );
  }
  const edits = preview.openingBoardActions().length;
  // 미리 보기 세션을 기용 보드에 넘긴다. 저장·선수 창·직접 지휘는 실제 세션 것이라 막는다
  const value: GameUi = {
    ...ui, session: preview, grades, version,
    changed: () => setVersion((v) => v + 1),
    autosave: async () => {},
    openPlayer: () => {},
    command: () => {},
  };
  return (
    <div className="stack">
      <section className="panel opening-note">
        <div className="row-between wrap">
          <h2>{year} 개막 기용 미리 보기</h2>
          <button type="button" className="ghost" onClick={() => go('offseason')}>개막 준비로 돌아가기</button>
        </div>
        <p className="small">
          개막 날(첫 경기 전) 모습입니다. 여기서 고친 1군·기용표는 <strong>{year} 시즌 개막</strong>을 누르면 그대로 옮겨집니다
          {edits ? <> (지금 고친 것 <strong>{edits}건</strong>)</> : ' (아직 고친 것 없음 · 그대로 두면 AI 감독이 짠 기용)'}.
        </p>
        <p className="small muted">개막 전에 다른 오프시즌 일(방출·영입 등)을 하면 미리 보기를 새로 만들고, 여기서 고친 것은 사라집니다.</p>
      </section>
      <GameProvider value={value}>
        <LineupBoard />
      </GameProvider>
    </div>
  );
}
