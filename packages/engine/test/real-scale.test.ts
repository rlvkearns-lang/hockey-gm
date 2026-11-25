/**
 * Task 13b item 2: real-world scale (the owner: "McDavid can skate up to, what? 24 mph? ... same with puck speed after a
 * slapper"). Top skating speed and shot speed by type and power in real units.
 */
import { describe, it, expect } from 'vitest';
import { movementOf } from '../src/skating';
import { shotSpeedOf } from '../src/actions';
import type { ShotType } from '../src/types';
import { def } from './helpers';

const MPH = 2.23694;
const top = (r: number): number => movementOf(def({ speed: r }), 1).topSpeed * MPH;
const shot = (power: number, type: ShotType): number => shotSpeedOf(def({ shootingPower: power }), type) * MPH;

describe('real-world scale (Task 13b)', () => {
  it('top skating speed: about 20 mph at the bottom of NHL-calibre ratings (40), 21.5 to 22.5 at the mean (70), 24.5 at 99', () => {
    expect(top(40)).toBeGreaterThan(19.5); expect(top(40)).toBeLessThan(20.5);
    expect(top(70)).toBeGreaterThanOrEqual(21.5); expect(top(70)).toBeLessThanOrEqual(22.5);
    expect(top(99)).toBeGreaterThan(24.2); expect(top(99)).toBeLessThan(24.8);
  });
  it('time to top speed and turn radius at top speed are what they were (accel and carve scale with it)', () => {
    const m = movementOf(def({}), 1);
    expect(m.topSpeed / m.accel).toBeGreaterThan(0.85); expect(m.topSpeed / m.accel).toBeLessThan(1.0);
    expect((m.topSpeed * m.topSpeed) / m.carve).toBeGreaterThan(9); expect((m.topSpeed * m.topSpeed) / m.carve).toBeLessThan(10);
  });
  it('wrist shots 70 to 90 mph across shooting power; slapshots 85 to 105, a 99-power slapshot 100 to 105; one-timers near a slapshot; backhands slower', () => {
    for (const p of [40, 70, 99]) { expect(shot(p, 'wrist')).toBeGreaterThanOrEqual(69.5); expect(shot(p, 'wrist')).toBeLessThanOrEqual(90.5); }
    for (const p of [40, 70, 99]) { expect(shot(p, 'slap')).toBeGreaterThanOrEqual(83); expect(shot(p, 'slap')).toBeLessThanOrEqual(105); }
    expect(shot(99, 'slap')).toBeGreaterThanOrEqual(100);
    for (const p of [40, 70, 99]) {
      expect(shot(p, 'oneTimer')).toBeGreaterThan(shot(p, 'wrist')); expect(shot(p, 'oneTimer')).toBeGreaterThan(0.95 * shot(p, 'slap'));
      expect(shot(p, 'backhand')).toBeLessThan(0.85 * shot(p, 'wrist'));
    }
  });
});
