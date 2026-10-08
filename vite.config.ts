import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 배포 경로: GitHub Pages처럼 하위 경로(/<저장소 이름>/)에 올릴 때는 BASE_PATH 환경 변수로 준다 (.github/workflows/deploy.yml).
// 데이터 로더(src/data/loadBrowser.ts)는 import.meta.env.BASE_URL을 따른다.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
