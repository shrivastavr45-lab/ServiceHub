import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { setupFiles: ['./test/setup.js'], fileParallelism: false, testTimeout: 20000, hookTimeout: 30000, include: ['test/**/*.test.js'] },
});
