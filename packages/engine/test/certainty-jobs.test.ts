/**
 * Task 12 close-out ruling 1: as certainty-entry.test.ts, for the forecheck, defence and pinch tactics, the home team on
 * the tactic (as the Task 11 close-out ruling read them). (The test rosters alone read 0.168 with the home team passive
 * after Task 12; over the six pairs at the close-out: passive mean 0.146, max 0.153; aggressive 0.137 / 0.149; pressure
 * 0.137 / 0.148; often 0.138 / 0.144; rarely 0.134 / 0.148.)
 */
import { describe, it, expect } from 'vitest';
import type { Tactics } from '../src/types';
import { pairCertainty } from './measures';

describe('tactics shade, they never decide: forecheck, defence and pinch tactics over six team pairs', () => {
  it.each([{ forecheck: 'passive' }, { forecheck: 'aggressive' }, { defence: 'pressure' }, { pinch: 'often' }, { pinch: 'rarely' }] as Partial<Tactics>[])('%o: mean under 0.15, every pair under 0.17', (t) => {
    const pairs = pairCertainty(t, false);
    expect(pairs.reduce((x, y) => x + y, 0) / pairs.length).toBeLessThan(0.15); expect(Math.max(...pairs)).toBeLessThan(0.17);
  }, 600_000);
});
