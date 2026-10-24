import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 배포 경로: GitHub Pages처럼 하위 경로(/<저장소 이름>/)에 올릴 때는 BASE_PATH 환경 변수로 준다 (.github/workflows/deploy.yml).
// 데이터 로더(src/data/loadBrowser.ts)는 import.meta.env.BASE_URL을 따른다.
// 시험 작업자 수: 기본 8 (2026-10-24, 작업자 하나가 최대 약 0.4GB. 15개일 때 5.2GB → 8개 3.8GB, 시간 약 +30%).
// KBO_TEST_FORKS로 바꾸고, 0이면 vitest 기본값(코어 수 − 1)
const forks = process.env.KBO_TEST_FORKS === undefined ? 8 : Number(process.env.KBO_TEST_FORKS) || 0;
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'], testTimeout: 60000,
    ...(forks ? { poolOptions: { forks: { maxForks: forks, minForks: Math.min(forks, 1) } } } : {}) },
});
