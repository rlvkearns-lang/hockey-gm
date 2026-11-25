import { defineConfig } from 'vitest/config';

/**
 * Multi-hundred-game checks (calibration, robustness) run with `npm run test:calibration` instead, and (Task 13b) the
 * whole-game guards that play more than 16 games, so the fast suite stays under four minutes.
 */
export const SLOW_TESTS = [
  'test/calibration.test.ts', 'test/robustness.test.ts',
  'test/look-interval.test.ts', 'test/tactics-slow.test.ts', 'test/valuation-calibration.test.ts', 'test/tactics-defence.test.ts', 'test/certainty-entry.test.ts', 'test/certainty-jobs.test.ts',
];

export default defineConfig({ test: { include: ['test/**/*.test.ts'], exclude: SLOW_TESTS } });
