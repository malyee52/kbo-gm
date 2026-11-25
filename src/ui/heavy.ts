// 오래 걸리는 진행을 Web Worker로 (2026-11-25 사용자 결정 Q55): 새 게임·결산·개막·개막 미리 보기 동안 화면이 멈추지 않는다.
// Worker가 결과 저장을 돌려주면 본 스레드는 불러오기만 한다 (약 0.1~0.2초). 일은 한 덩어리라 "멈추기"는 Worker를 끝내고
// 아무것도 바꾸지 않은 채 돌아간다 (세션은 결과를 받기 전까지 그대로다).
// Worker를 만들 수 없거나 Worker가 뜨지 못하면(오래된 브라우저, 모듈 Worker 미지원) 같은 일을 본 스레드에서 한다.
import type { DataStore } from '../data/types';
import { runHeavyJob, type HeavyJob, type HeavyResult } from '../game/heavy';
import type { HeavyReply, HeavyRequest } from '../game/heavy.worker';
import { afterPaint } from './paint';

/** 멈추기로 끝낸 일 */
export class HeavyCancelled extends Error {
  constructor() { super('멈췄습니다'); }
}

export interface HeavyRun {
  result: Promise<HeavyResult>;
  /** Worker를 끝내고 결과를 버린다 (본 스레드로 돌리는 중이면 끝날 때까지 기다린 뒤 버린다) */
  cancel(): void;
  /** Worker에서 도는가 (false = 본 스레드, 멈추기 단추가 소용없다) */
  inWorker: boolean;
}

let worker: Worker | null = null;
/** Worker가 한 번 뜨지 못했으면 이 창에서는 다시 쓰지 않는다 */
let broken = typeof Worker === 'undefined';
let nextId = 1;

function spawn(): Worker {
  return new Worker(new URL('../game/heavy.worker.ts', import.meta.url), { type: 'module' });
}

/** 본 스레드에서 (Worker를 못 쓸 때) */
function onMain(store: DataStore, job: HeavyJob): HeavyRun {
  let dropped = false;
  const result = (async () => {
    await afterPaint();
    const r = runHeavyJob(store as Parameters<typeof runHeavyJob>[0], job);
    if (dropped) throw new HeavyCancelled();
    return r;
  })();
  return { result, cancel: () => { dropped = true; }, inWorker: false };
}

/**
 * 오래 걸리는 일을 시작한다. store는 Worker를 못 쓸 때 본 스레드에서 쓰는 데이터 (모든 시즌이 불러와져 있어야 한다).
 * 결과 저장은 GameSession.load(새 게임)나 session.adopt(결산·개막)로 들인다.
 */
export function startHeavy(store: DataStore, job: HeavyJob): HeavyRun {
  if (broken) return onMain(store, job);
  let w: Worker;
  try {
    w = worker ??= spawn();
  } catch {
    broken = true;
    return onMain(store, job);
  }
  const id = nextId++;
  let settle: { ok: (r: HeavyResult) => void; fail: (e: Error) => void } | null = null;
  let fallback = false;
  const result = new Promise<HeavyResult>((ok, fail) => { settle = { ok, fail }; });
  const cleanup = () => {
    w.removeEventListener('message', onMessage);
    w.removeEventListener('error', onError);
  };
  const onMessage = (e: MessageEvent<HeavyReply>) => {
    if (e.data.id !== id) return;
    cleanup();
    if ('error' in e.data) settle?.fail(new Error(e.data.error));
    else settle?.ok(e.data.result);
  };
  // Worker 스크립트가 뜨지 못함 (모듈 Worker 미지원 등): 이번 일부터 본 스레드로
  const onError = (e: ErrorEvent) => {
    e.preventDefault();
    cleanup();
    broken = true;
    worker?.terminate();
    worker = null;
    fallback = true;
    const main = onMain(store, job);
    run.cancel = main.cancel;
    run.inWorker = false;
    main.result.then((r) => settle?.ok(r), (err) => settle?.fail(err as Error));
  };
  w.addEventListener('message', onMessage);
  w.addEventListener('error', onError);
  w.postMessage({ id, job } satisfies HeavyRequest);
  const run: HeavyRun = {
    result,
    inWorker: true,
    cancel: () => {
      if (fallback) return;
      cleanup();
      w.terminate();
      if (worker === w) worker = null;
      settle?.fail(new HeavyCancelled());
    },
  };
  return run;
}
