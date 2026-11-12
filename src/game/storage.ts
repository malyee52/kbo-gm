// 브라우저 저장: IndexedDB 저장 칸과 JSON 파일 내보내기·가져오기.
// 엔진·세션은 이 파일에 의존하지 않는다 (Node 테스트에서는 toSave/load만 쓴다).

import { SEASON_SAVE_FORMAT } from '../engine';
import type { GameSave } from './session';

const DB_NAME = 'kbo-gm';
const STORE = 'saves';
/**
 * 자동 저장 칸. 예전(1.0)에는 'auto' 하나라 같은 브라우저에서 두 게임(두 탭)을 하면 서로 덮어썼다 (2026-10-09 QA).
 * 이제 게임마다 'auto:<시작 연도>:<시드>' 칸을 쓰고, 최근 AUTO_KEEP개만 남긴다. 예전 'auto' 칸은 자동 저장으로 보되 자동으로 지우지 않는다.
 */
export const AUTO_SLOT = 'auto';
export const AUTO_KEEP = 3;
export function autoSlotOf(startYear: number, seed: string): string {
  return `auto:${startYear}:${seed}`;
}
export function isAutoSlot(slot: string): boolean {
  return slot === AUTO_SLOT || slot.startsWith('auto:');
}

export interface SaveRecord {
  slot: string;
  /** 저장한 시각 (ISO 문자열) */
  savedAt: string;
  year: number;
  teamName: string;
  /** 다음에 치를 날짜 색인 */
  day: number;
  /** 저장 시점의 팀 성적 요약 */
  summary: string;
  /** 플레이어가 붙인 이름 (2026-10-12, 없으면 칸 이름) */
  label?: string;
  data: GameSave;
}

/**
 * 저장 칸 요약 (2026-11-11 편의 P1): 목록·자동 저장 정리는 이것만 읽는다.
 * 큰 data는 STORE에, 요약은 INFO_STORE에 같은 칸 이름으로 둔다. 저장 데이터 형식(GameSave)은 그대로다.
 */
export interface SaveInfo extends Omit<SaveRecord, 'data'> {
  /** 에디터 사용 표시 (editorMarkOfSave) */
  editor: '보기' | '고침' | null;
  /** 오프시즌 저장 */
  offseason: boolean;
  /** 그 시즌 정규시즌이 끝난 저장 (오프시즌 포함) */
  done: boolean;
  /** 불러올 수 없는 예전 형식 (isOutdatedSave) */
  outdated: boolean;
}

/** 저장 기록이 그 시즌 종료(또는 오프시즌) 상태인지. 지난 시즌의 "정규시즌 종료" 소식은 세지 않는다 */
export function seasonDoneOf(year: number, data: GameSave): boolean {
  if (data.format === 3 && data.phase === 'offseason') return true;
  return (data.news ?? []).some((n) => (n.year ?? year) === year && n.kind === 'season' && n.text.startsWith('정규시즌 종료'));
}

/** 저장 기록 → 요약 */
export function infoOf(rec: SaveRecord): SaveInfo {
  const { data, ...head } = rec;
  const offseason = (data as { format?: unknown; phase?: unknown } | undefined)?.format === 3 && (data as { phase?: unknown }).phase === 'offseason';
  let done = offseason;
  try { done = offseason || seasonDoneOf(rec.year, data); } catch { /* 깨진 저장: 종료 아님으로 */ }
  return { ...head, editor: editorMarkOfSave(data), offseason, done, outdated: isOutdatedSave(data) };
}

const INFO_STORE = 'save-info';
/** DB 버전 2 (2026-11-11): 요약 store를 더했다. 1 → 2로 올릴 때 있던 칸의 요약을 채운다 */
const DB_VERSION = 2;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const t = req.transaction!;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(INFO_STORE)) {
        const info = db.createObjectStore(INFO_STORE, { keyPath: 'slot' });
        // 예전 칸의 요약 채우기: 한 번만 모든 칸을 읽는다
        const cur = t.objectStore(STORE).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          info.put(infoOf(c.value as SaveRecord));
          c.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('브라우저 저장소를 열 수 없습니다'));
  });
}

async function tx<T>(mode: IDBTransactionMode, stores: string[], fn: (t: IDBTransaction) => IDBRequest<T> | undefined): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req?.result as T);
      t.onerror = () => reject(t.error ?? new Error('저장소 작업에 실패했습니다'));
      t.onabort = () => reject(t.error ?? new Error('저장소 작업이 취소됐습니다 (저장 공간 부족일 수 있습니다)'));
    });
  } finally {
    db.close();
  }
}

/** 칸에 저장한다: 데이터와 요약을 한 트랜잭션으로 */
export function putSave(rec: SaveRecord): Promise<IDBValidKey> {
  return tx('readwrite', [STORE, INFO_STORE], (t) => {
    t.objectStore(INFO_STORE).put(infoOf(rec));
    return t.objectStore(STORE).put(rec);
  });
}

/** 칸 하나를 데이터째 읽는다 (불러오기) */
export function getSave(slot: string): Promise<SaveRecord | undefined> {
  return tx('readonly', [STORE], (t) => t.objectStore(STORE).get(slot) as IDBRequest<SaveRecord | undefined>);
}

/** 칸 하나의 요약만 */
export function getSaveInfo(slot: string): Promise<SaveInfo | undefined> {
  return tx('readonly', [INFO_STORE], (t) => t.objectStore(INFO_STORE).get(slot) as IDBRequest<SaveInfo | undefined>);
}

/** 저장 칸에 이름을 붙인다 (빈 문자열이면 지운다) */
export async function renameSave(slot: string, label: string): Promise<void> {
  const rec = await getSave(slot);
  if (!rec) return;
  const t = label.trim().slice(0, 30);
  if (t) rec.label = t;
  else delete rec.label;
  await putSave(rec);
}

export function deleteSave(slot: string): Promise<undefined> {
  return tx('readwrite', [STORE, INFO_STORE], (t) => {
    t.objectStore(INFO_STORE).delete(slot);
    return t.objectStore(STORE).delete(slot) as IDBRequest<undefined>;
  });
}

/** 저장 목록 요약 (최근 저장 순). 큰 data는 읽지 않는다 */
export async function listSaveInfos(): Promise<SaveInfo[]> {
  const all = await tx('readonly', [INFO_STORE], (t) => t.objectStore(INFO_STORE).getAll() as IDBRequest<SaveInfo[]>);
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** 저장 목록 (최근 저장 순), 데이터째. 진행마다 부르지 않는다 (목록은 listSaveInfos) */
export async function listSaves(): Promise<SaveRecord[]> {
  const all = await tx('readonly', [STORE], (t) => t.objectStore(STORE).getAll() as IDBRequest<SaveRecord[]>);
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** 자동 저장 칸 정리: 이 게임 칸(keep)과 예전 'auto' 칸을 빼고 다른 게임의 자동 저장은 최근 AUTO_KEEP − 1개만 남긴다. 지운 칸 */
export async function pruneAutoSaves(keep: string): Promise<string[]> {
  const autos = (await listSaveInfos()).filter((r) => isAutoSlot(r.slot) && r.slot !== AUTO_SLOT && r.slot !== keep);
  const gone = autos.slice(Math.max(0, AUTO_KEEP - 1)).map((r) => r.slot);
  for (const slot of gone) await deleteSave(slot);
  return gone;
}

/** 저장의 에디터 사용 표시 (docs/에디터_기획안.md 2.2): 켠 적 없으면 null */
export function editorMarkOfSave(data: GameSave | undefined): '보기' | '고침' | null {
  const e = (data as { league?: { editor?: { firstEdit?: unknown } } } | undefined)?.league?.editor;
  return e ? (e.firstEdit ? '고침' : '보기') : null;
}

/** 예전 저장을 지운 뒤 한 번 보여 주는 문구 (일정 개편 기획안 6.1) */
export const OUTDATED_NOTICE = '게임 규칙(정규시즌 일정·잠재력)이 바뀌어 예전 저장을 지웠습니다';

/** 불러올 수 없는 저장인가: 시즌 저장 형식이 지금(SEASON_SAVE_FORMAT)보다 낮거나(엔진 2·일정 개편 이전), 세션 형식 2(잠재력 v2 이전) */
export function isOutdatedSave(data: GameSave | undefined): boolean {
  const f = (data as { season?: { format?: unknown } } | undefined)?.season?.format;
  if ((data as { format?: unknown } | undefined)?.format === 2) return true;
  return typeof f !== 'number' || f < SEASON_SAVE_FORMAT;
}

/** 불러올 수 없는 예전 형식 저장 칸(자동 저장·예전 'auto'·수동 칸)을 지운다. 지운 칸 수 */
export async function purgeOutdatedSaves(): Promise<number> {
  const old = (await listSaveInfos()).filter((r) => r.outdated);
  for (const r of old) await deleteSave(r.slot);
  return old.length;
}

/** 저장 데이터를 JSON 파일로 내려받게 한다 */
export function exportFile(save: GameSave, fileName: string): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 파일에서 저장 데이터를 읽는다. 형식 확인은 GameSession.load가 한다 */
export async function readSaveFile(file: File): Promise<GameSave> {
  const text = await file.text();
  try {
    return JSON.parse(text) as GameSave;
  } catch {
    throw new Error('JSON 파일이 아니거나 내용이 깨졌습니다');
  }
}
