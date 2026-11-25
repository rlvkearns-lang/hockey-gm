/**
 * Task 13b item 2: real-world scale (the owner: "McDavid can skate up to, what? 24 mph? ... same with puck speed after a
 * slapper"). Top skating speed and shot speed by type and power in real units.
 */
import { describe, it, expect } from 'vitest';
import { movementOf } from '../src/skating';
import { executeShot, shotSpeedOf } from '../src/actions';
import { createRng } from '../src/rng';
import type { GameEvent, ShotType } from '../src/types';
import { def, defs, stateWith } from './helpers';

const MPH = 2.23694;
const top = (r: number): number => movementOf(def({ speed: r }), 1).topSpeed * MPH;
const shot = (power: number, type: ShotType): number => shotSpeedOf(def({ shootingPower: power }), type) * MPH;

describe('real-world scale (Task 13b)', () => {
  it('top skating speed: about 20 mph at the bottom of NHL-calibre ratings (40), 21.5 to 22.5 at the mean (70), 24.5 at 99', () => {
    expect(top(40)).toBeGreaterThan(19.5); expect(top(40)).toBeLessThan(20.5);
    expect(top(70)).toBeGreaterThanOrEqual(21.5); expect(top(70)).toBeLessThanOrEqual(22.5);
    expect(top(99)).toBeGreaterThan(24.2); expect(top(99)).toBeLessThan(24.8);
  });
  it('acceleration from rest and turn radius at top speed are what they were (accel and carve scale with it; Task 14: the push fades toward top speed, skating.test.ts)', () => {
    const m = movementOf(def({}), 1);
    expect(m.topSpeed / m.accel).toBeGreaterThan(0.85); expect(m.topSpeed / m.accel).toBeLessThan(1.0);
    expect((m.topSpeed * m.topSpeed) / m.carve).toBeGreaterThan(9); expect((m.topSpeed * m.topSpeed) / m.carve).toBeLessThan(10);
  });
  // Task 14 (Task 13b review, Minor 4): a 99-power Heavy Slapshot read 112 mph; nothing leaves a stick above 108.
  it('the hardest shot there is (a 99-power Heavy Slapshot) is 105 to 108 mph', () => {
    const v = shotSpeedOf({ ...def({ shootingPower: 99 }), badges: ['Heavy Slapshot'] }, 'slap') * MPH;
    expect(v).toBeGreaterThanOrEqual(105); expect(v).toBeLessThanOrEqual(108);
    expect(shotSpeedOf({ ...def({ shootingPower: 70 }), badges: ['Heavy Slapshot'] }, 'slap')).toBeGreaterThan(shotSpeedOf(def({ shootingPower: 70 }), 'slap') * 1.07);
  });
  // Task 14b (controller ruling, section 3: the hardest slapshot read 109.8 mph in 300 games): the cap is on the puck's
  // whole release speed, lift included, not on its speed along the ice.
  it('no shot leaves the stick above 108 mph, its lift included: 300 hard slapshots from the point, many of them high', () => {
    const me = { ...def({ shootingPower: 99, shootingAccuracy: 30 }), id: 'home-LD', position: 'LD' as const, badges: ['Heavy Slapshot' as const] };
    const ds = new Map(defs); ds.set('home-LD', me);
    let most = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const st = stateWith({ carrier: 'home', puckX: 6 + (seed % 12), puckY: (seed % 7) - 3, carrierSlot: 'LD' });
      for (const s of st.skaters) if (s.side === 'away') s.pos = { x: -20, y: s.pos.y };
      const out: GameEvent[] = [];
      executeShot(st, 'home-LD', ds, createRng(seed), out, 'slap');
      for (const e of out) if (e.type === 'release') most = Math.max(most, Math.hypot(e.detail.vel.x, e.detail.vel.y, e.detail.vel.z) * MPH);
    }
    expect(most).toBeGreaterThan(105); expect(most).toBeLessThanOrEqual(108);
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
