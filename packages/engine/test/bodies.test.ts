import { describe, it, expect } from 'vitest';
import { dist } from '../src/vec';
import { resolveBodies } from '../src/bodies';
import { at, mv } from './helpers';

describe('bodies', () => {
  it('bodies do not overlap and the lighter one gives more', () => {
    const big = at(0, 0), small = at(0.3, 0); const c = resolveBodies([big, small], id => id === big.id ? mv(110) : mv(78));
    expect(dist(big.pos, small.pos)).toBeGreaterThanOrEqual(0.74); expect(Math.abs(small.pos.x - 0.3)).toBeGreaterThan(Math.abs(big.pos.x)); expect(c.length).toBe(1);
  });
  it('reports closing speed and ignores bodies that are apart', () => {
    const a = at(0, 0), b = at(0.5, 0), far = at(10, 0); a.vel = { x: 3, y: 0 };
    const c = resolveBodies([a, b, far], () => mv(85));
    expect(c).toHaveLength(1); expect(c[0]!.closing).toBeCloseTo(3);
  });
  it('separates bodies sitting at exactly the same spot', () => {
    const a = at(5, 2), b = at(5, 2);
    const c = resolveBodies([a, b], () => mv(85));
    expect(c).toHaveLength(1);
    expect(Number.isFinite(a.pos.x) && Number.isFinite(b.pos.x) && Number.isFinite(a.pos.y) && Number.isFinite(b.pos.y)).toBe(true);
    expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(2 * mv(85).radius - 1e-9);
  });
});
