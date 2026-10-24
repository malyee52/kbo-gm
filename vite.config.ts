import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 배포 경로: GitHub Pages처럼 하위 경로(/<저장소 이름>/)에 올릴 때는 BASE_PATH 환경 변수로 준다 (.github/workflows/deploy.yml).
// 데이터 로더(src/data/loadBrowser.ts)는 import.meta.env.BASE_URL을 따른다.
// 시험 작업자 수: 기본 8 (2026-10-24, 작업자 하나가 최대 약 0.4GB. 15개일 때 5.2GB → 8개 3.8GB, 시간 약 +30%).
// KBO_TEST_FORKS로 바꾸고, 0이면 vitest 기본값(코어 수 − 1)
const forks = process.env.KBO_TEST_FORKS === undefined ? 8 : Number(process.env.KBO_TEST_FORKS) || 0;
// 작업자 heap 한도 기본 512MB (2026-10-24 시험 메모리 카드): 시험 파일이 실제로 붙잡는 값은 대개 수십 MB인데
// 한도가 없으면 V8이 GC를 미뤄 작업자 하나가 최대 0.5~0.6GB까지 커진다. 512면 무거운 파일 최대 RSS가 35~45% 줄고 시간은 같다.
// 가장 많이 붙잡는 schedule 시험은 160MB에서 heap 부족으로 죽고 256MB는 지나간다. KBO_TEST_HEAP로 바꾸고, 0이면 한도 없음
const heap = process.env.KBO_TEST_HEAP === undefined ? 512 : Number(process.env.KBO_TEST_HEAP) || 0;
const forkOptions = {
  ...(forks ? { maxForks: forks, minForks: Math.min(forks, 1) } : {}),
  ...(heap ? { execArgv: [`--max-old-space-size=${heap}`] } : {}),
};
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  // KBO_TEST_MEM=<파일>이면 시험 파일마다 최대 RSS를 적는다 (tools/testMemProbe.ts)
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts', ...(process.env.KBO_TEST_MEM ? ['tools/testMemProbe.ts'] : [])], testTimeout: 60000,
    ...(Object.keys(forkOptions).length ? { poolOptions: { forks: forkOptions } } : {}) },
});
