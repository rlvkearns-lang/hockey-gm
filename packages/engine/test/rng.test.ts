import { describe, it, expect } from 'vitest';
import { createRng, restoreRng, type RngState } from '../src/rng';

describe('rng', () => {
  it('same seed gives the same stream', () => {
    const a = createRng(42), b = createRng(42);
    expect(Array.from({ length: 100 }, () => a.next())).toEqual(Array.from({ length: 100 }, () => b.next()));
  });
  it('different seeds give different streams', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
  it.each([0, -7, 3.9, 2 ** 40])('seed %s gives valid numbers', (seed) => {
    const r = createRng(seed);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('2**40 and 0 do not collide', () => { expect(createRng(2 ** 40).next()).not.toBe(createRng(0).next()); });
  it('gauss has mean ~0 and sd ~1', () => {
    const r = createRng(5), xs = Array.from({ length: 20000 }, () => r.gauss());
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03); expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });
  it('a stream restored from its state carries on exactly', () => {
    const a = createRng(77);
    for (let i = 0; i < 50; i++) a.next();
    const b = restoreRng(JSON.parse(JSON.stringify(a.getState())) as RngState);
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(Array.from({ length: 100 }, () => a.next()));
    expect(() => restoreRng([1, 2, 3] as unknown as RngState)).toThrow(/rng state/);
  });
  it('int is inclusive', () => {
    const r = createRng(9);
    const seen = new Set(Array.from({ length: 500 }, () => r.int(1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
});
