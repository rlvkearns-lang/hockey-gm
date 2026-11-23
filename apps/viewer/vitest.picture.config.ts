import { defineConfig } from 'vitest/config';
import { PICTURE_TESTS } from './vite.config';

/**
 * `npm run test:picture`: the measurements of the picture, too slow for every `npm test` (whole periods and games
 * through the animator or the scene, seek sweeps, the puck's continuity at three display rates, the picture hashes).
 */
export default defineConfig({
  test: { include: PICTURE_TESTS, globalSetup: ['src/test/global-setup.ts'], testTimeout: 900_000, hookTimeout: 900_000 },
});
