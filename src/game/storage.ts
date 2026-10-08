// 브라우저 저장: IndexedDB 저장 칸과 JSON 파일 내보내기·가져오기.
// 엔진·세션은 이 파일에 의존하지 않는다 (Node 테스트에서는 toSave/load만 쓴다).

import type { GameSave } from './session';

const DB_NAME = 'kbo-gm';
const STORE = 'saves';
/** 진행할 때마다 덮어쓰는 자동 저장 칸 */
export const AUTO_SLOT = 'auto';

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
  data: GameSave;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('브라우저 저장소를 열 수 없습니다'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error('저장소 작업에 실패했습니다'));
      t.onabort = () => reject(t.error ?? new Error('저장소 작업이 취소됐습니다 (저장 공간 부족일 수 있습니다)'));
    });
  } finally {
    db.close();
  }
}

export function putSave(rec: SaveRecord): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(rec));
}

export function getSave(slot: string): Promise<SaveRecord | undefined> {
  return tx('readonly', (s) => s.get(slot) as IDBRequest<SaveRecord | undefined>);
}

export function deleteSave(slot: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(slot) as IDBRequest<undefined>);
}

/** 저장 목록 (최근 저장 순). 큰 data는 빼지 않고 그대로 돌려준다 */
export async function listSaves(): Promise<SaveRecord[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
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
