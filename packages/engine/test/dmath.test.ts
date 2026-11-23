import { describe, it, expect } from 'vitest';
import { datan, datan2, dcos, dexp, dlog, dpow, dsin, dtanh, hypot3 } from '../src/dmath';

/** A fixed xorshift stream (not the engine's Rng, so this test does not depend on it). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Worst relative error (absolute below `floor`) of f against g over `n` draws of `gen`. */
function worst(f: (x: number) => number, g: (x: number) => number, gen: () => number, n = 100_000, floor = 1e-300): number {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const x = gen();
    const a = f(x), b = g(x);
    const e = Math.abs(a - b) / Math.max(floor, Math.abs(b));
    if (e > w) w = e;
  }
  return w;
}

describe('deterministic math matches Math.* closely', () => {
  const r = stream(42);
  it('exp over [-50, 50] and its range ends', () => {
    expect(worst(dexp, Math.exp, () => (r() - 0.5) * 100)).toBeLessThan(4e-16);
    expect(worst(dexp, Math.exp, () => (r() - 0.5) * 1400)).toBeLessThan(4e-16);
    expect(dexp(0)).toBe(1);
    expect(dexp(710)).toBe(Infinity);
    expect(dexp(-750)).toBe(0);
    expect(Math.abs(dexp(709.7) / Math.exp(709.7) - 1)).toBeLessThan(4e-16);
  });
  it('log over many magnitudes', () => {
    expect(worst(dlog, Math.log, () => r() * 20)).toBeLessThan(4e-16);
    expect(worst(dlog, Math.log, () => Math.exp((r() - 0.5) * 1400))).toBeLessThan(4e-16);
    expect(Math.abs(dlog(1 + 1e-12) - Math.log(1 + 1e-12)) / Math.log(1 + 1e-12)).toBeLessThan(1e-15);
    expect(dlog(1)).toBe(0);
    expect(dlog(0)).toBe(-Infinity);
    expect(dlog(-1)).toBeNaN();
    expect(dlog(5e-324)).toBeCloseTo(Math.log(5e-324), 10);
  });
  it('sin and cos over several turns (absolute error)', () => {
    expect(worst(dsin, Math.sin, () => (r() - 0.5) * 40, 100_000, 1)).toBeLessThan(3e-16);
    expect(worst(dcos, Math.cos, () => (r() - 0.5) * 40, 100_000, 1)).toBeLessThan(3e-16);
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
  });
  it('atan and atan2 everywhere', () => {
    expect(worst(datan, Math.atan, () => (r() - 0.5) * 40)).toBeLessThan(1e-15);
    expect(worst(datan, Math.atan, () => Math.tan((r() - 0.5) * 3.1))).toBeLessThan(1e-15);
    let w = 0;
    for (let i = 0; i < 100_000; i++) {
      const y = (r() - 0.5) * 40, x = (r() - 0.5) * 40;
      w = Math.max(w, Math.abs(datan2(y, x) - Math.atan2(y, x)));
    }
    expect(w).toBeLessThan(1e-15);
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(0, -1)).toBe(Math.PI);
    expect(datan2(-0, -1)).toBe(Math.PI); // the sign of zero does not matter
    expect(datan2(1, 0)).toBe(Math.PI / 2);
    expect(datan2(-1, -0)).toBe(-Math.PI / 2);
  });
  it('tanh, pow and hypot3', () => {
    expect(worst(dtanh, Math.tanh, () => (r() - 0.5) * 10, 100_000, 1)).toBeLessThan(1e-15);
    expect(dtanh(30)).toBe(1);
    // exp(b log a): the error grows with |b log a| (here up to about 75), so the tolerance is wider.
    expect(worst((x) => dpow(x, 3.6), (x) => Math.pow(x, 3.6), () => r())).toBeLessThan(1e-14);
    expect(worst((x) => dpow(x * 10, -1.7), (x) => Math.pow(x * 10, -1.7), () => r() + 1e-3)).toBeLessThan(1e-14);
    expect(dpow(0, 2)).toBe(0);
    expect(dpow(5, 0)).toBe(1);
    expect(hypot3(3, 4, 12)).toBe(13);
    expect(worst((x) => hypot3(x, x * 0.5 - 3, 2), (x) => Math.hypot(x, x * 0.5 - 3, 2), () => (r() - 0.5) * 60)).toBeLessThan(5e-16);
    expect(hypot3(0, 0, 0)).toBe(0);
  });
});
