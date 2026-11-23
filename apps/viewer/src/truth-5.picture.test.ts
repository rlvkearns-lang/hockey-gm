import { describe, expect, it } from 'vitest';
import { FACING_AFTER_DROP, SAVE_AFTER, SAVE_REACH, truthOfGame } from './test/truth';

/** The engine's truth over the whole game of seed 5, through the scene at 60 Hz (test/truth.ts; npm run test:picture). */
describe('the whole game of seed 5 against the engine', () => {
  it('in live play the loose puck is the engine\'s but while a goalie stops it, skaters face the engine\'s way from ' + FACING_AFTER_DROP + ' s after a drop, goalies are not turned, and nobody is drawn more than 0.35 m from his place', () => {
    const t = truthOfGame(5);
    console.log(JSON.stringify(t));
    expect(t.liveFrames).toBeGreaterThan(100000);
    // The puck: off the engine's only in a save's window (from the plane crossing to SAVE_AFTER ticks after its tick),
    // and there within SAVE_REACH of it.
    expect(t.puck.outside, t.puck.outsideAt).toBe(0);
    expect(t.puck.late, t.puck.lateAt).toBe(0);
    expect(t.puck.early, t.puck.earlyAt).toBe(0);
    expect(t.puck.far, t.puck.farAt).toBeLessThanOrEqual(SAVE_REACH);
    expect(t.puck.lastRel).toBeLessThanOrEqual(SAVE_AFTER);
    expect(t.puck.saves).toBeGreaterThan(20);
    expect(t.facing.worst, t.facing.worstAt).toBeLessThan(1e-9);
    expect(t.facing.goalieTurn).toBe(0);
    expect(t.place.worst, t.place.worstAt).toBeLessThanOrEqual(0.35 + 1e-9);
  });
});
