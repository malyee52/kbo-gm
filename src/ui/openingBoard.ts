// 개막 준비 단계의 기용 보드 (2026-10-23 사용자 결정): 오프시즌 마지막 단계(개막 준비)에서 개막 날 기용 보드를 미리 연다.
// 미리 보기 세션(session.previewOpening = 지금 오프시즌을 복사해 개막까지 한 것)을 실제 세션별로 하나 기억하고,
// 실제로 개막하면 그 세션에서 한 1군·기용표 조작을 실제 세션에 옮긴다 (조작 기록에 남아 재현된다).
// 미리 보기를 만든 뒤 오프시즌 조작이 하나라도 더 생기면(조작 기록 길이가 바뀌면) 미리 보기와 고친 것은 버린다.
import { GameSession, type GameSave } from '../game/session';

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

/**
 * 미리 보기 세션을 Worker가 만든 저장으로 들인다 (Q55, ui/heavy.ts의 'preview'). make 대신 쓴다.
 * 저장을 만든 뒤 오프시즌 조작이 생겼으면(at이 지금 조작 수와 다르면) 버린다
 */
export function setOpeningPreview(s: GameSession, at: number, save: GameSave): GameSession | null {
  if (at !== s.actions.length) return null;
  const preview = GameSession.load(s.store as Parameters<typeof GameSession.load>[0], save, s.params);
  cache.set(s, { at, preview });
  return preview;
}

/** 미리 보기에서 고친 조작 수 (미리 보기가 없으면 0) */
export function openingEdits(s: GameSession): number {
  return openingPreview(s, false)?.openingBoardActions().length ?? 0;
}

/**
 * 실제로 개막한다. 미리 보기에서 고친 1군·기용표가 있으면 개막 직후(첫 경기 전) 그대로 옮긴다.
 * open = 개막하는 방법 (화면은 Worker로 돌리는 ui.heavy('open'), 없으면 s.openNextSeason). 돌려주는 값: 개막 결과와 옮긴 조작 수
 */
export async function openWithPreview(s: GameSession, open?: () => Promise<{ ok: boolean; message?: string; cancelled?: boolean }>): Promise<{ ok: boolean; message: string; carried: number; cancelled?: boolean }> {
  const edits = openingPreview(s, false)?.openingBoardActions() ?? [];
  const r = open ? await open() : s.openNextSeason();
  if (!r.ok) return { ok: false, message: r.message ?? '', carried: 0, ...('cancelled' in r && r.cancelled ? { cancelled: true } : {}) };
  cache.delete(s);
  return { ok: true, message: r.message ?? '', carried: edits.length ? s.applyOpeningBoard(edits) : 0 };
}
