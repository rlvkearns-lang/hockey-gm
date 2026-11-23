import { defineConfig } from 'vitest/config';
import { SLOW_TESTS } from './vitest.config';

/** The calibration and robustness game sets (`npm run test:calibration`). */
export default defineConfig({ test: { include: SLOW_TESTS } });
