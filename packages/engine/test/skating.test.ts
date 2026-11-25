import { describe, it, expect } from 'vitest';
import { len, type Vec2 } from '../src/vec';
import { movementOf } from '../src/skating';
import { SPEED_SCALE } from '../src/tuning';
import { DT } from '../src/constants';
import type { SlowMode } from '../src/types';
import { at, backwardSpeedAfter, def, movingAt, retreatMeasure, speedAfter, stepFor } from './helpers';

describe('skating', () => {
  // Task 13b (real speeds): after 4 s, not 6 (at 10 m/s six seconds from the end boards runs into the far ones).
  it('faster players reach a higher top speed', () => { expect(speedAfter(def({ speed: 95 }), 4)).toBeGreaterThan(speedAfter(def({ speed: 50 }), 4) + 0.7); });
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
    // (Task 13b, real speeds: he gets further up in 1.5 s, so the spot he faces is further off too: 20 m up, facing a
    // spot 30 m out rather than 15 and 20, the same angles.)
    const c = at(0, 0); c.target = { x: 0, y: 20 }; c.faceTarget = { x: 30, y: 0 }; stepFor(c, 1.5);
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
  const fresh = movementOf(def({}), 1);
  const slowing = (slow: SlowMode): number => { const s = movingAt(8, 0); s.target = { x: 200, y: 0 }; s.speedCap = 0; stepFor(s, 1, fresh, { slow, through: true }); return len(s.vel); };
  it('three ways to slow down: coasting barely slows, easing is light braking, stopping is hard', () => {
    expect(slowing('coast')).toBeGreaterThan(7.0); expect(slowing('coast')).toBeLessThan(7.7);
    expect(slowing('ease')).toBeGreaterThan(5.0); expect(slowing('ease')).toBeLessThan(6.0);
    expect(slowing('stop')).toBeLessThan(1.5);
  });
  it('coasting is the default', () => { const s = movingAt(8, 0); s.target = { x: 200, y: 0 }; s.speedCap = 0; stepFor(s, 1); expect(len(s.vel)).toBeGreaterThan(7.0); });
  it('told to stop at a spot, he stops on it', () => {
    const s = movingAt(8, 0); s.target = { x: 6, y: 0 }; stepFor(s, 2.5, fresh, { slow: 'stop', through: false });
    expect(Math.hypot(s.pos.x - 6, s.pos.y)).toBeLessThan(0.5); expect(len(s.vel)).toBeLessThan(0.5);
  });
  it('skating through a target, he does not ease off toward it', () => {
    const s = movingAt(8, 0); s.target = { x: 4, y: 0 }; let atTarget = 0;
    for (let t = 0; t < 30 && s.pos.x < 4; t++) { stepFor(s, DT, fresh, { slow: 'coast', through: true }); atTarget = len(s.vel); }
    expect(atTarget).toBeGreaterThan(8 * 0.9);
  });
  /** From the origin at 8 m/s along +x toward `target`; the whole scene is moved 10 m toward the right-hand boards (y - 10) so the turn has room before the far boards (12.955 m out). */
  const minSpeedTo = (to: Vec2, d = def({})): { min: number; widest: number } => {
    const target = { x: to.x, y: to.y - 10 };
    const s = movingAt(8, 0); s.pos.y = -10; s.target = target; let min = 8, widest = 0; const m = movementOf(d, 1);
    for (let t = 0; t < 30 * 6 && Math.hypot(s.pos.x - target.x, s.pos.y - target.y) > 1; t++) { stepFor(s, DT, m, { slow: 'coast', through: true }); min = Math.min(min, len(s.vel)); widest = Math.max(widest, s.pos.x); }
    return { min, widest };
  };
  it('a turn is carved: speed is mostly kept', () => {
    expect(minSpeedTo({ x: 12, y: 14 }).min).toBeGreaterThan(8 * 0.8);   // a quarter turn
    expect(minSpeedTo({ x: -15, y: 12 }).min).toBeGreaterThan(8 * 0.6);  // back the way he came
  });
  it('the turn radius comes from speed and agility: 4 to 10 m at 8 m/s, tighter for the agile', () => {
    const r = (agility: number): number => minSpeedTo({ x: -15, y: 12 }, def({ agility })).widest; // how far he runs on before he is round
    expect(r(70)).toBeGreaterThan(4); expect(r(70)).toBeLessThan(10);
    expect(r(95)).toBeLessThan(r(45) * 0.85);
  });
  // Task 13b (real speeds): 6.6 m/s times SPEED_SCALE (backward speed is a share of the forward top speed).
  it('backward is clearly slower than forward and under 7.5 m/s', () => {
    expect(backwardSpeedAfter(4)).toBeLessThan(speedAfter(def({}), 4) * 0.75); expect(backwardSpeedAfter(4)).toBeLessThan(6.6 * SPEED_SCALE);
  });
  it('told to stop with his target behind him, he stops and turns instead of carving round', () => {
    const runOn = (slow: SlowMode): number => { const s = movingAt(8, 0); s.target = { x: -10, y: 1 }; let far = 0; for (let t = 0; t < 90; t++) { stepFor(s, DT, fresh, { slow, through: false }); far = Math.max(far, s.pos.x); } return far; };
    expect(runOn('stop')).toBeLessThan(5); expect(runOn('coast')).toBeGreaterThan(runOn('stop') + 2);
  });
  it('never NaN: on his target, at rest, with no speed cap', () => { const s = at(0, 0); s.speedCap = 0; stepFor(s, 1); expect(Number.isFinite(s.pos.x + s.vel.x + s.facing)).toBe(true); });
  it('retreating defencemen face the puck (final review measure, two whole games)', () => {
    const m = retreatMeasure([1, 2]);
    expect(m.samples).toBeGreaterThan(10_000);
    expect(m.facingPuck).toBeGreaterThan(0.8);
  }, 60_000);
});
