// 개막 준비 단계의 기용 보드 (2026-10-23 사용자 결정): 오프시즌 마지막 단계(개막 준비)에서 개막 날 기용 보드를 미리 연다.
// 미리 보기 세션(session.previewOpening = 지금 오프시즌을 복사해 개막까지 한 것)을 실제 세션별로 하나 기억하고,
// 실제로 개막하면 그 세션에서 한 1군·기용표 조작을 실제 세션에 옮긴다 (조작 기록에 남아 재현된다).
// 미리 보기를 만든 뒤 오프시즌 조작이 하나라도 더 생기면(조작 기록 길이가 바뀌면) 미리 보기와 고친 것은 버린다.
import type { GameSession } from '../game/session';

const cache = new WeakMap<GameSession, { at: number; preview: GameSession }>();

/** 미리 보기 세션. make가 false면 이미 있는 것만 (없으면 null) */
export function openingPreview(s: GameSession, make = true): GameSession | null {
  const c = cache.get(s);
  if (c && c.at === s.actions.length) return c.preview;
  cache.delete(s);
  if (!make) return null;
  const preview = s.previewOpening();
  if (preview) cache.set(s, { at: s.actions.length, preview });
  return preview;
}

/** 미리 보기에서 고친 조작 수 (미리 보기가 없으면 0) */
export function openingEdits(s: GameSession): number {
  return openingPreview(s, false)?.openingBoardActions().length ?? 0;
}

/**
 * 실제로 개막한다. 미리 보기에서 고친 1군·기용표가 있으면 개막 직후(첫 경기 전) 그대로 옮긴다.
 * 돌려주는 값: 개막 결과와 옮긴 조작 수
 */
export function openWithPreview(s: GameSession): { ok: boolean; message: string; carried: number } {
  const edits = openingPreview(s, false)?.openingBoardActions() ?? [];
  const r = s.openNextSeason();
  if (!r.ok) return { ...r, carried: 0 };
  cache.delete(s);
  return { ...r, carried: edits.length ? s.applyOpeningBoard(edits) : 0 };
}
