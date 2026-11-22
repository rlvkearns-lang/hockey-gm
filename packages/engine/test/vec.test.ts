import { it, expect } from 'vitest';
import { createRng } from '../src/rng';
import { hypot2 } from '../src/vec';

it('hypot2 is bit-identical to Math.hypot', () => {
  const r = createRng(7);
  const bad: [number, number][] = [];
  for (let i = 0; i < 200_000; i++) {
    const s = [1e-9, 1e-3, 1, 30, 1e6][i % 5]!;
    const x = r.range(-s, s), y = r.range(-s, s);
    if (!Object.is(hypot2(x, y), Math.hypot(x, y))) bad.push([x, y]);
  }
  for (const [x, y] of [[0, 0], [-0, 0], [3, 4], [Infinity, 1], [1, -Infinity], [NaN, 1], [Infinity, NaN], [-5, 0]] as const)
    if (!Object.is(hypot2(x, y), Math.hypot(x, y))) bad.push([x, y]);
  expect(bad).toEqual([]);
});
