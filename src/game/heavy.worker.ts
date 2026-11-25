// 오래 걸리는 진행을 화면 밖에서 돌리는 Web Worker (Q55, game/heavy.ts). 화면 쪽은 ui/heavy.ts.
// 데이터는 이 Worker가 따로 불러 둔다 (처음 일 한 번, 그 뒤는 다시 쓴다).
import { loadBrowserStore, type BrowserStore } from '../data/loadBrowser';
import { runHeavyJob, type HeavyJob, type HeavyResult } from './heavy';

export interface HeavyRequest { id: number; job: HeavyJob }
export type HeavyReply = { id: number; result: HeavyResult } | { id: number; error: string };

let store: Promise<BrowserStore> | null = null;
const storeOnce = () => (store ??= loadBrowserStore().then(async (s) => { await s.ensureAll(); return s; }));

self.onmessage = async (e: MessageEvent<HeavyRequest>) => {
  const { id, job } = e.data;
  try {
    const s = await storeOnce();
    const result = runHeavyJob(s, job);
    (self as unknown as Worker).postMessage({ id, result } satisfies HeavyReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error)?.message ?? String(err) } satisfies HeavyReply);
  }
};
