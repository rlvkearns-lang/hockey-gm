import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

/**
 * The picture's measurements (whole periods, whole games, seek sweeps, the picture hashes) run apart, with
 * `npm run test:picture` (vitest.picture.config.ts); `npm test` is the fast suite of unit and event-sampled tests.
 */
export const PICTURE_TESTS = ['src/**/*.picture.test.ts', 'src/picture.test.ts'];

/** Dev server and plain build: the watch page (index.html). */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], exclude: [...configDefaults.exclude, ...PICTURE_TESTS], globalSetup: ['src/test/global-setup.ts'] },
} as Parameters<typeof defineConfig>[0]);
