import { defineConfig } from 'vite';

/** Dev server and plain build: the watch page (index.html) and the skating test (skating.html), linked to each other. */
export default defineConfig({
  define: { __SKATING_LINK__: 'true' },
  build: { rollupOptions: { input: { index: 'index.html', skating: 'skating.html' } } },
  test: { include: ['src/**/*.test.ts'], globalSetup: ['src/test/global-setup.ts'] },
} as Parameters<typeof defineConfig>[0]);
