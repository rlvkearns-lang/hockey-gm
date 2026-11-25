/**
 * Moved out of play.test.ts at Task 13b (it plays 48 whole games): the fast suite keeps guards of at most 16 games; this
 * runs with `npm run test:calibration`.
 */
import { describe, it, expect } from 'vitest';
import { createGameWith } from '../src/game';
import { gameSetup } from './helpers';

describe('A3: decisions at decision points (Task 8 fix round 2)', () => {
  // A pick drawn on a clock is a rate nobody chose: the carrier draws at decision points, and how often he looks for one
  // (lookTicks, 6 by default) barely moves what he does.
  // Close-out: read on seeds 1-16. With half the shots, eight games' attempts move by about 6% from one run to another
  // by themselves (988 / 872 / 922 at 3 / 6 / 12 ticks on seeds 1-8; 1,926 / 1,824 / 1,814 on seeds 1-16). The bar is unchanged.
  it('A3: halving or doubling the look interval changes shots and passes a game by under 10% (seeds 1-16)', () => {
    const per = (lookTicks: number): { shots: number; passes: number } => {
      let shots = 0, passes = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const g = createGameWith(gameSetup(seed), { lookTicks });
        while (!g.done) g.step();
        for (const e of g.result().events) { if (e.type === 'release' && e.detail.kind === 'shot') shots++; if (e.type === 'pass' && e.detail.kind === 'pass') passes++; }
      }
      return { shots, passes };
    };
    const base = per(6);
    for (const lt of [3, 12]) {
      const o = per(lt);
      expect(Math.abs(o.shots / base.shots - 1)).toBeLessThan(0.10); expect(Math.abs(o.passes / base.passes - 1)).toBeLessThan(0.10);
    }
  }, 900_000);
});

