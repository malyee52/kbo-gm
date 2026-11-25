// 브라우저 IndexedDB 저장 쓰기 시간 (Q55): 예전 방식(저장 전체를 한 칸에) ↔ 지금 방식(game/storage.ts putSave, 본 칸 + 바뀐 기록 칸만).
// tools/save_bench.html이 부른다. 해마다 다섯 번 재서 가운데 값. 결과는 화면과 console.log(JSON)로.
import { deleteSave, getSave, putSave, type SaveRecord } from '../src/game/storage';
import type { GameSave } from '../src/game/session';

const YEARS = (new URLSearchParams(location.search).get('years') ?? '2027,2036,2051,2076').split(',').map(Number);
const REPS = 5;
const out = document.getElementById('out')!;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** 예전 방식: 저장 전체를 한 칸에 (DB 버전 2까지의 putSave와 같은 모습, 따로 연 시험용 DB) */
function openOld(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kbo-bench-old', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('saves', { keyPath: 'slot' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putOld(rec: SaveRecord): Promise<void> {
  const db = await openOld();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(['saves'], 'readwrite');
    t.objectStore('saves').put(rec);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

async function time(f: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await f();
  return performance.now() - t0;
}

const rows: Record<string, number | string>[] = [];
for (const year of YEARS) {
  const res = await fetch(`/reports/tmp/save-bench-${year}.json`);
  if (!res.ok) { rows.push({ year, error: `파일 없음 (${res.status})` }); continue; }
  const text = await res.text();
  const data = JSON.parse(text) as GameSave;
  const rec = (slot: string): SaveRecord => ({ slot, savedAt: new Date().toISOString(), year, teamName: 'bench', day: 0, summary: '', data });
  const old: number[] = [];
  const first: number[] = [];
  const again: number[] = [];
  const read: number[] = [];
  for (let i = 0; i < REPS; i++) {
    old.push(await time(() => putOld(rec(`bench:${year}`))));
    await deleteSave(`bench:${year}`);
    first.push(await time(() => putSave(rec(`bench:${year}`))));
    again.push(await time(() => putSave(rec(`bench:${year}`))));
    read.push(await time(() => getSave(`bench:${year}`)));
  }
  await deleteSave(`bench:${year}`);
  rows.push({ year, kb: Math.round(text.length / 1024), old: median(old), first: median(first), again: median(again), read: median(read) });
  out.textContent = JSON.stringify(rows, null, 1);
}
indexedDB.deleteDatabase('kbo-bench-old');
out.textContent = ['개막 | 저장 KB | 예전 쓰기 ms | 지금 첫 쓰기 ms | 지금 다시 쓰기 ms | 지금 읽기 ms',
  ...rows.map((r) => r.error ? `${r.year} | ${r.error}` : `${r.year} | ${r.kb} | ${(r.old as number).toFixed(0)} | ${(r.first as number).toFixed(0)} | ${(r.again as number).toFixed(0)} | ${(r.read as number).toFixed(0)}`)].join('\n');
console.log('SAVE_BENCH', JSON.stringify(rows));
