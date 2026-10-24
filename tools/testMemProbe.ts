// 시험 메모리 재기 (KBO_TEST_MEM=<파일>일 때만 vite.config.ts가 setupFiles에 더한다). 시험 결과에는 손대지 않는다.
// 시험 파일마다 한 줄: F <pid> <시작 ms> <끝 ms> <최대 RSS KB> <끝 heap MB> <파일>
// 최대 RSS는 process.resourceUsage().maxRSS (Windows는 최대 작업 집합)라 동기 계산 중의 최고점까지 잡는다.
// 같은 프로세스가 여러 파일을 돌리면(isolate: false·threads) 그 프로세스의 지금까지 최고점이 된다.
import { appendFileSync } from 'node:fs';
import { relative } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

const out = process.env.KBO_TEST_MEM;
let start = 0;
let file = '?';
if (out) {
  beforeAll((suite) => {
    start = Date.now();
    file = relative(process.cwd(), (suite as { filepath?: string }).filepath ?? '?').replace(/\\/g, '/');
  });
  afterAll(() => {
    const heap = process.memoryUsage().heapUsed / 1048576;
    appendFileSync(out, `F ${process.pid} ${start} ${Date.now()} ${process.resourceUsage().maxRSS} ${heap.toFixed(0)} ${file}\n`);
  });
}
