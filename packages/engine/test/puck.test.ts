import { describe, it, expect } from 'vitest';
import { len } from '../src/vec';
import { DT } from '../src/constants';
import { stepPuck } from '../src/puck';
import { puckAt, run, runUntilEvent } from './helpers';

describe('puck', () => {
  it('a sliding puck slows and stops', () => {
    const k = puckAt(0, 0, 10, 0); run(k, 20);
    expect(len(k.vel)).toBeLessThan(0.05);
    expect(k.pos.x).toBeGreaterThan(15);
    expect(k.pos.x).toBeLessThan(30.48);
  });
  it('a rim travels around the corner', () => {
    const k = puckAt(20, 12.5, 25, 0); run(k, 1.5);
    expect(k.pos.y).toBeLessThan(5);
    expect(k.vel.x).toBeLessThan(0);
  });
  it('a shot between the posts reports onNet with its crossing point', () => {
    const ev = runUntilEvent(puckAt(20, 0.3, 30, 0, 0.2, 1));
    expect(ev).toMatchObject({ kind: 'onNet', end: 1 });
    expect(ev.y).toBeCloseTo(0.3, 1);
    expect(ev.speed).toBeGreaterThan(25);
  });
  it('a shot at the post bounces out', () => {
    expect(runUntilEvent(puckAt(20, 0.95, 30, 0)).kind).toBe('post');
  });
  it('a high shot goes over', () => {
    expect(runUntilEvent(puckAt(24, 0, 30, 0, 0.5, 9)).kind).toBe('overNet');
  });
  it('a puck cannot enter the net from behind', () => {
    const k = puckAt(29, 0, -20, 0); run(k, 0.5);
    expect(k.pos.x).toBeGreaterThan(27.13 + 1.0 - 0.01);
  });
  it('the -x net works too', () => {
    expect(runUntilEvent(puckAt(-20, -0.4, -30, 0, 0.1, 1))).toMatchObject({ kind: 'onNet', end: -1 });
  });
  it('a puck from the side bounces off the net', () => {
    const k = puckAt(27.6, 3, 0, -15); run(k, 0.5);
    expect(k.pos.y).toBeGreaterThan(0.9);
  });
  it('a rim emits at most one boards event per tick', () => {
    const k = puckAt(20, 12.5, 25, 0);
    let total = 0;
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      const n = stepPuck(k, DT).filter((e) => e.kind === 'boards').length;
      expect(n).toBeLessThanOrEqual(1);
      total += n;
    }
    expect(total).toBeGreaterThan(0);
  });

  // Task 13: the puck out of play, by its height where it meets the boards (boards 1.07 m; glass 1.52 m above them on
  // the sides, 2.44 m behind the goal lines with netting above; nothing above the boards in front of the benches).
  it('a lifted puck meeting the side boards above the glass is out of play; below the top of the glass it comes back', () => {
    const over = runUntilEvent(puckAt(15, 8, 0, 25, 2.5, 3));
    expect(over).toMatchObject({ kind: 'outOfPlay', where: 'glass' });
    const under = puckAt(15, 8, 0, 25, 1.5, 0.5); run(under, 0.5);
    expect(under.vel.y).toBeLessThan(0);
  });
  it('over the boards in front of a bench (no glass there) it is out of play', () => {
    expect(runUntilEvent(puckAt(-7, -8, 0, -25, 1.2, 1))).toMatchObject({ kind: 'outOfPlay', where: 'bench' });
    const k = puckAt(-7, -8, 0, -25, 0.5, 0); run(k, 0.5); expect(k.vel.y).toBeGreaterThan(0);
  });
  it('behind the goal line above the end glass it goes into the netting: out of play', () => {
    expect(runUntilEvent(puckAt(28.5, 5, 25, 0, 3.4, 4))).toMatchObject({ kind: 'outOfPlay', where: 'netting' });
    const k = puckAt(28.5, 5, 25, 0, 2.5, 0); run(k, 0.3); expect(k.vel.x).toBeLessThan(0);
  });
  it('out of play, the puck stops where it met the boards', () => {
    const k = puckAt(15, 8, 0, 25, 2.5, 3); runUntilEvent(k);
    expect(k.vel).toEqual({ x: 0, y: 0 }); expect(k.vz).toBe(0); expect(Math.abs(k.pos.y)).toBeGreaterThan(12.8);
  });
});
