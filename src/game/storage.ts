// 브라우저 저장: IndexedDB 저장 칸과 JSON 파일 내보내기·가져오기.
// 엔진·세션은 이 파일에 의존하지 않는다 (Node 테스트에서는 toSave/load만 쓴다).

import { SEASON_SAVE_FORMAT } from '../engine';
import type { GameSave } from './session';
import { detailHash, joinSave, splitSave, type SaveDetail, type SplitMark } from './saveSplit';

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
 * 저장소에 들어가는 모습 (2026-11-25 Q55): data는 본 칸이고 split이 있으면 지난 시즌 기록 칸(DETAIL_STORE)과 합쳐야 원래 저장이다.
 * split이 없는 기록(DB 버전 2까지 쓴 칸)은 data가 저장 전체다. 그대로 읽고, 다음에 저장할 때 나눈다.
 */
interface StoredRecord extends SaveRecord {
  split?: SplitMark;
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
/**
 * 지난 시즌 기록 칸 (2026-11-25 Q55, game/saveSplit.ts). 키는 [칸 이름, 연도, 지문], 값은 { text: 기록 칸 JSON }.
 * 지문이 키에 있어 값을 읽지 않고(키만 훑어) 바뀐 칸만 다시 쓴다
 */
const DETAIL_STORE = 'save-detail';
/** DB 버전 2 (2026-11-11): 요약 store를 더했다. 1 → 2로 올릴 때 있던 칸의 요약을 채운다. 버전 3 (2026-11-25): 기록 칸 store */
const DB_VERSION = 3;
/** 한 저장 칸의 기록 칸 키 범위 */
const detailRange = (slot: string) => IDBKeyRange.bound([slot], [slot, []]);

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const t = req.transaction!;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(DETAIL_STORE)) db.createObjectStore(DETAIL_STORE);
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

/**
 * 칸에 저장한다: 본 칸·요약·지난 시즌 기록 칸을 한 트랜잭션으로 (Q55).
 * 기록 칸은 키(연도·지문)만 훑어 지문이 바뀐 해만 다시 쓰고, 이제 없는 해는 지운다
 */
export async function putSave(rec: SaveRecord): Promise<IDBValidKey> {
  const { main, details } = splitSave(rec.data);
  const texts = details.map((d) => JSON.stringify(d));
  const split: SplitMark = { v: 1, years: {} };
  const want = new Map<string, string>();
  details.forEach((d, i) => {
    const h = detailHash(texts[i]);
    split.years[d.year] = h;
    want.set(`${d.year}`, h);
  });
  const stored: StoredRecord = { ...rec, data: main, ...(details.length ? { split } : {}) };
  const db = await open();
  try {
    return await new Promise<IDBValidKey>((resolve, reject) => {
      const t = db.transaction([STORE, INFO_STORE, DETAIL_STORE], 'readwrite');
      t.objectStore(INFO_STORE).put(infoOf(rec));
      const req = t.objectStore(STORE).put(stored);
      const ds = t.objectStore(DETAIL_STORE);
      const have = new Set<string>();
      const cur = ds.openKeyCursor(detailRange(rec.slot));
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) {
          const [, year, hash] = c.primaryKey as [string, number, string];
          if (want.get(`${year}`) === hash) have.add(`${year}`);
          else ds.delete(c.primaryKey);
          c.continue();
          return;
        }
        details.forEach((d, i) => {
          if (!have.has(`${d.year}`)) ds.put({ text: texts[i] }, [rec.slot, d.year, split.years[d.year]]);
        });
      };
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error('저장소 작업에 실패했습니다'));
      t.onabort = () => reject(t.error ?? new Error('저장소 작업이 취소됐습니다 (저장 공간 부족일 수 있습니다)'));
    });
  } finally {
    db.close();
  }
}

/** 칸 하나를 데이터째 읽는다 (불러오기). 나눈 칸이면 기록 칸과 합쳐 원래 저장으로 */
export async function getSave(slot: string): Promise<SaveRecord | undefined> {
  const db = await open();
  try {
    return await new Promise<SaveRecord | undefined>((resolve, reject) => {
      const t = db.transaction([STORE, DETAIL_STORE], 'readonly');
      let rec: StoredRecord | undefined;
      const parts: { year: number; hash: string; text: string }[] = [];
      const r = t.objectStore(STORE).get(slot);
      r.onsuccess = () => { rec = r.result as StoredRecord | undefined; };
      const cur = t.objectStore(DETAIL_STORE).openCursor(detailRange(slot));
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        const [, year, hash] = c.primaryKey as [string, number, string];
        parts.push({ year, hash, text: (c.value as { text: string }).text });
        c.continue();
      };
      t.oncomplete = () => {
        try { resolve(rec && joinRecord(rec, parts)); } catch (e) { reject(e); }
      };
      t.onerror = () => reject(t.error ?? new Error('저장소 작업에 실패했습니다'));
    });
  } finally {
    db.close();
  }
}

/** 본 칸 + 기록 칸 → 저장 기록. 표지의 해마다 지문이 맞는 칸이 있어야 한다 */
function joinRecord(rec: StoredRecord, parts: { year: number; hash: string; text: string }[]): SaveRecord {
  const { split, ...plain } = rec;
  if (!split) return plain;
  const details: SaveDetail[] = [];
  for (const [year, hash] of Object.entries(split.years)) {
    const p = parts.find((x) => `${x.year}` === year && x.hash === hash);
    if (!p) throw new Error(`저장의 ${year} 시즌 기록 칸이 없거나 맞지 않습니다 (다른 탭에서 같은 칸에 저장했을 수 있습니다)`);
    details.push(JSON.parse(p.text) as SaveDetail);
  }
  return { ...plain, data: joinSave(plain.data, details) };
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
  return tx('readwrite', [STORE, INFO_STORE, DETAIL_STORE], (t) => {
    t.objectStore(INFO_STORE).delete(slot);
    t.objectStore(DETAIL_STORE).delete(detailRange(slot));
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
  const slots = (await listSaveInfos()).map((r) => r.slot);
  const all = (await Promise.all(slots.map((s) => getSave(s)))).filter((r): r is SaveRecord => !!r);
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** 자동 저장 칸 정리: 이 게임 칸(keep)과 예전 'auto' 칸을 빼고 다른 게임의 자동 저장은 최근 AUTO_KEEP − 1개만 남긴다. 지운 칸 */
export async function pruneAutoSaves(keep: string): Promise<string[]> {
  // 이전 판 저장은 사용자가 고를 때까지 남긴다 (Q64)
  const autos = (await listSaveInfos()).filter((r) => isAutoSlot(r.slot) && r.slot !== AUTO_SLOT && r.slot !== keep && !r.outdated);
  const gone = autos.slice(Math.max(0, AUTO_KEEP - 1)).map((r) => r.slot);
  for (const slot of gone) await deleteSave(slot);
  return gone;
}

/** 저장의 에디터 사용 표시 (docs/에디터_기획안.md 2.2): 켠 적 없으면 null */
export function editorMarkOfSave(data: GameSave | undefined): '보기' | '고침' | null {
  const e = (data as { league?: { editor?: { firstEdit?: unknown } } } | undefined)?.league?.editor;
  return e ? (e.firstEdit ? '고침' : '보기') : null;
}

/**
 * 이전 판 저장 안내 (2026-11-25 사용자 Q64: 묻지 않고 지우지 않는다). 시작 화면이 개수와 함께 보이고
 * 내보내기·지우기는 사용자가 고른다 (예전에는 게임을 열 때 purgeOutdatedSaves로 바로 지웠다)
 */
export const OUTDATED_NOTICE = '게임 규칙(정규시즌 일정·잠재력)이 바뀌어 지금 판에서는 불러올 수 없습니다. 파일로 내보내 보관하거나 지울 수 있습니다';

/** 이전 판 저장을 파일 하나로 묶는다 (보관용, 지금 판에서는 불러올 수 없다) */
export async function outdatedBundle(): Promise<{ kind: 'kbo-gm-outdated-saves'; exportedAt: string; saves: SaveRecord[] } | null> {
  const old = (await listSaveInfos()).filter((r) => r.outdated);
  if (!old.length) return null;
  const saves = (await Promise.all(old.map((r) => getSave(r.slot)))).filter((r): r is SaveRecord => !!r);
  return { kind: 'kbo-gm-outdated-saves', exportedAt: new Date().toISOString(), saves };
}

/** 불러올 수 없는 저장인가: 시즌 저장 형식이 지금(SEASON_SAVE_FORMAT)보다 낮거나(엔진 2·일정 개편 이전), 세션 형식 2(잠재력 v2 이전) */
export function isOutdatedSave(data: GameSave | undefined): boolean {
  const f = (data as { season?: { format?: unknown } } | undefined)?.season?.format;
  if ((data as { format?: unknown } | undefined)?.format === 2) return true;
  return typeof f !== 'number' || f < SEASON_SAVE_FORMAT;
}

/** 불러올 수 없는 예전 형식 저장 칸(자동 저장·예전 'auto'·수동 칸)을 지운다. 지운 칸 수. 사용자가 시작 화면에서 '지우기'를 골랐을 때만 부른다 (Q64) */
export async function purgeOutdatedSaves(): Promise<number> {
  const old = (await listSaveInfos()).filter((r) => r.outdated);
  for (const r of old) await deleteSave(r.slot);
  return old.length;
}

/** 저장 데이터를 JSON 파일로 내려받게 한다 */
export function exportFile(save: GameSave | object, fileName: string): void {
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
