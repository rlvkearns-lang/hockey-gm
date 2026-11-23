import { defineConfig } from 'vitest/config';

/** Multi-hundred-game checks (calibration, robustness) run with `npm run test:calibration` instead. */
export const SLOW_TESTS = ['test/calibration.test.ts', 'test/robustness.test.ts'];

export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: SLOW_TESTS } });
