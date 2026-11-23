import { defineConfig } from 'vite';

/** Dev server and plain build: the watch page (index.html). */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], globalSetup: ['src/test/global-setup.ts'] },
} as Parameters<typeof defineConfig>[0]);
