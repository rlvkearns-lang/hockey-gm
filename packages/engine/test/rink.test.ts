import { describe, it, expect } from 'vitest';
import { zoneOf, resolveBoards, FACEOFF_DOTS, RINK } from '../src/rink';

describe('rink', () => {
  it('zoneOf follows the attack direction', () => {
    expect(zoneOf(20, 1)).toBe('O');
    expect(zoneOf(20, -1)).toBe('D');
    expect(zoneOf(0, 1)).toBe('N');
  });
  it('boards keep a body inside, including corners', () => {
    const p = { x: 40, y: 20 }, v = { x: 5, y: 5 };
    expect(resolveBoards(p, v, 0.4, 0)).toBe(true);
    expect(Math.hypot(p.x - (30.48 - 8.53), p.y - (12.955 - 8.53))).toBeCloseTo(8.53 - 0.4, 3);
  });
  it('straight boards reflect with restitution and report no contact inside', () => {
    const p = { x: 0, y: 13 }, v = { x: 1, y: 4 };
    expect(resolveBoards(p, v, 0.5, 0.5)).toBe(true);
    expect(p.y).toBeCloseTo(RINK.halfWidth - 0.5, 6);
    expect(v.y).toBeCloseTo(-2, 6);
    expect(resolveBoards({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.5, 0.5)).toBe(false);
  });
  it('has the face-off dots', () => {
    expect(FACEOFF_DOTS.centre).toEqual({ x: 0, y: 0 });
    expect(FACEOFF_DOTS.neutral).toHaveLength(4);
    expect(FACEOFF_DOTS.end).toHaveLength(4);
  });
});
