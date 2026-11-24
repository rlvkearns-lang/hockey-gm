/**
 * Task 12 close-out ruling 1: tactics shade, they never decide (Review Focus 3), read over six generated team pairs (two
 * games each) instead of the one pair of test rosters: for each entry and offence tactic, both teams on it, one kind of
 * option is certain before the cap in under 15% of ordinary decisions on average over the pairs, and in no pair over 17%.
 * (The test rosters alone read 0.161 with both teams carrying in after Task 12; over the six pairs at the close-out: carry
 * mean 0.142, max 0.150; dump 0.120 / 0.127; pointShots 0.129 / 0.143; rush 0.129 / 0.138.)
 */
import { describe, it, expect } from 'vitest';
import type { Tactics } from '../src/types';
import { pairCertainty } from './measures';

describe('tactics shade, they never decide: entry and offence tactics over six team pairs', () => {
  it.each([{ zoneEntry: 'dump' }, { zoneEntry: 'carry' }, { offence: 'pointShots' }, { offence: 'rush' }] as Partial<Tactics>[])('%o: mean under 0.15, every pair under 0.17', (t) => {
    const pairs = pairCertainty(t, true);
    expect(pairs.reduce((x, y) => x + y, 0) / pairs.length).toBeLessThan(0.15); expect(Math.max(...pairs)).toBeLessThan(0.17);
  }, 600_000);
});
