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
});
