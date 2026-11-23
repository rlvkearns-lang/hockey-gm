import { describe, it, expect } from 'vitest';
import { GOLDEN_SEEDS, goldenRun } from './golden';
import { GOLDEN_EXPECTED } from './golden-expected';

/**
 * The same games, bit for bit, as the checked-in fingerprints (and as headless Chromium, `npm run test:browser`).
 * A deliberate change of results updates them with `npm run golden:update`.
 */
describe('golden games', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: rosters, positions every tick and the final score match the fingerprint`, () => {
      expect(goldenRun(seed)).toEqual(GOLDEN_EXPECTED[seed]);
    }, 30_000);
  }
});
