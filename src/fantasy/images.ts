// 판타지 삽화 저장소: 이 브라우저의 IndexedDB 'kbo-gm-art' (게임 저장 DB와 따로). 저장 파일·내보내기에는 들어가지 않는다.
// 키는 게임(시드·시작 연도)과 이야기 글(연도·날짜·종류·제목)로 만든다.
import type { FantasyEntry } from './types';

const DB = 'kbo-gm-art';
const STORE = 'images';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function artKey(game: { seed: string; startYear: number }, e: FantasyEntry): string {
  return `${game.startYear}|${game.seed}|${e.year}|${e.day}|${e.kind}|${e.title}`;
}

export async function getArt(key: string): Promise<Blob | null> {
  try {
    const db = await open();
    try {
      return await new Promise((resolve) => {
        const q = db.transaction(STORE).objectStore(STORE).get(key);
        q.onsuccess = () => resolve((q.result as Blob | undefined) ?? null);
        q.onerror = () => resolve(null);
      });
    } finally { db.close(); }
  } catch { return null; }
}

export async function putArt(key: string, blob: Blob): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(blob, key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** PNG를 WebP로 줄인다 (브라우저가 지원하면). 실패하면 PNG 그대로 */
export async function compactImage(png: Uint8Array): Promise<Blob> {
  const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' });
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return blob;
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const out = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
    return out.size > 0 && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}
