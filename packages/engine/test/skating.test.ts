import { describe, it, expect } from 'vitest';
import { len } from '../src/vec';
import { movementOf } from '../src/skating';
import { at, backwardSpeedAfter, def, movingAt, retreatMeasure, speedAfter, stepFor } from './helpers';

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
  it('squares up to the spot he faces once his travel is well off it, and says how he skates', () => {
    const s = at(0, 0); s.target = { x: -15, y: 0 }; s.faceTarget = { x: 20, y: 0 }; stepFor(s, 1.5);
    expect(s.mode).toBe('backward');
    const c = at(0, 0); c.target = { x: 0, y: 15 }; c.faceTarget = { x: 20, y: 0 }; stepFor(c, 1.5);
    expect(c.mode).toBe('crossover'); expect(Math.cos(c.facing)).toBeGreaterThan(0.9); expect(c.vel.y).toBeGreaterThan(3);
    const f = at(0, 0); f.target = { x: 15, y: 5 }; f.faceTarget = { x: 20, y: 0 }; stepFor(f, 1);
    expect(f.mode).toBe('forward');
  });
  it('moves sideways while squared up (crossovers), slower than straight ahead', () => {
    const c = at(-28, 0); c.facing = Math.PI / 2; c.target = { x: 1000, y: 0 }; c.faceTarget = { x: 0, y: 1000 }; stepFor(c, 3);
    expect(c.vel.x).toBeGreaterThan(speedAfter(def({}), 3) * 0.6); expect(c.vel.x).toBeLessThan(speedAfter(def({}), 3) * 0.9);
    expect(Math.abs(c.vel.y)).toBeLessThan(0.5); expect(c.mode).toBe('crossover');
  });
  it('hysteresis: squared up, he stays squared up until his travel is within 45 degrees of the spot he faces', () => {
    const s = at(0, 0); s.target = { x: -15, y: 0 }; s.faceTarget = { x: 20, y: 0 }; stepFor(s, 1);
    expect(s.mode).not.toBe('forward');
    // Travel now 55 degrees off the faced spot: inside the 45-65 band, so he keeps facing it.
    s.faceTarget = { x: s.pos.x + 10 * Math.cos(55 * Math.PI / 180), y: s.pos.y + 10 * Math.sin(55 * Math.PI / 180) };
    s.target = { x: s.pos.x + 20, y: s.pos.y }; stepFor(s, 0.2);
    expect(s.mode).not.toBe('forward');
    const f = at(0, 0); f.target = { x: 20, y: 0 }; f.faceTarget = { x: 10 * Math.cos(55 * Math.PI / 180), y: 10 * Math.sin(55 * Math.PI / 180) }; stepFor(f, 0.2);
    expect(f.mode).toBe('forward');
  });
  it('retreating defencemen face the puck (final review measure, two whole games)', () => {
    const m = retreatMeasure([1, 2]);
    expect(m.samples).toBeGreaterThan(10_000);
    expect(m.facingPuck).toBeGreaterThan(0.8);
  }, 60_000);
});
