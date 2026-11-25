/**
 * Task 14b (section 2; Task 13b review, Important 3): a cheap version of the per-tactic certainty checks
 * (certainty-entry.test.ts, certainty-jobs.test.ts: six team pairs each, in the slow suite) in the fast suite, so a later
 * task that touches tactics sees them: the first two generated team pairs, two games each, the same bars (one kind of
 * option certain before the cap in under 15% of ordinary decisions on average over the pairs, under 17% in each).
 * Entry and offence tactics with both teams on them; forecheck, defence and pinch with the home team on them, as the
 * slow checks read them. Split in two files (this one: entry and offence; certainty-fast-jobs.test.ts the rest) so
 * the fast suite runs them side by side (about 65 s each).
 */
import { describe, it, expect } from 'vitest';
import type { Tactics } from '../src/types';
import { pairCertainty } from './measures';

const PAIRS = 2;
describe('tactics shade, they never decide (two team pairs; the slow suite reads six)', () => {
  it.each([
    [{ zoneEntry: 'dump' }, true], [{ zoneEntry: 'carry' }, true], [{ offence: 'pointShots' }, true], [{ offence: 'rush' }, true],
  ] as [Partial<Tactics>, boolean][])('%o (both teams: %s): mean under 0.15, each pair under 0.17', (t, both) => {
    const pairs = pairCertainty(t, both, PAIRS);
    expect(pairs.reduce((x, y) => x + y, 0) / pairs.length).toBeLessThan(0.15); expect(Math.max(...pairs)).toBeLessThan(0.17);
  }, 600_000);
});
