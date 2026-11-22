import { describe, it, expect } from 'vitest';
import { len } from '../src/vec';
import { movementOf } from '../src/skating';
import { at, backwardSpeedAfter, def, movingAt, speedAfter, stepFor } from './helpers';

describe('skating', () => {
  it('faster players reach a higher top speed', () => { expect(speedAfter(def({ speed: 95 }), 6)).toBeGreaterThan(speedAfter(def({ speed: 50 }), 6) + 0.7); });
  it('a skater cannot turn on the spot at speed', () => {
    const s = movingAt(8, 0); s.target = { x: s.pos.x, y: s.pos.y + 20 }; stepFor(s, 0.5);
    expect(s.vel.x).toBeGreaterThan(3);
    expect(Math.abs(s.facing)).toBeLessThan(1.2);
  });
  it('skates backward when told to face the play while retreating', () => {
    const s = at(0, 0); s.target = { x: -15, y: 0 }; s.faceTarget = { x: 20, y: 0 }; stepFor(s, 2);
    expect(s.vel.x).toBeLessThan(-3); expect(Math.cos(s.facing)).toBeGreaterThan(0.8);
  });
  it('backward is slower than forward', () => { expect(backwardSpeedAfter(4)).toBeLessThan(speedAfter(def({}), 4) * 0.85); });
  it('tired legs are slower', () => { expect(movementOf(def({}), 0.1).topSpeed).toBeLessThan(movementOf(def({}), 1).topSpeed * 0.92); });
  it('a downed skater does not move under his own power', () => { const s = at(0, 0); s.downT = 1; s.target = { x: 10, y: 0 }; stepFor(s, 0.5); expect(len(s.vel)).toBeLessThan(0.1); });
  it('eases off and settles at the target instead of orbiting it', () => {
    const s = at(0, 0); s.target = { x: 10, y: 0 }; stepFor(s, 8);
    expect(Math.hypot(s.pos.x - 10, s.pos.y)).toBeLessThan(0.5); expect(len(s.vel)).toBeLessThan(0.5);
  });
});
