// 빠른 묶음: tests/heavy.json(무거운 파일 목록, tools/test_split.ts)을 뺀 시험만 돌린다. npm run test:fast
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config';
import heavy from './tests/heavy.json';

export default mergeConfig(base, defineConfig({
  test: { exclude: [...configDefaults.exclude, ...heavy.files.map((f) => `tests/${f}`)] },
}));
