import { describe, expect, it } from 'vitest';
import { bodyDims } from './body';

describe('bodyDims', () => {
  it('bodyDims scales: taller is longer-legged, heavier is bulkier, and the leg reaches the ice', () => {
    const a = bodyDims(170, 75), b = bodyDims(195, 75), c = bodyDims(195, 105);
    expect(b.thigh).toBeGreaterThan(a.thigh); expect(c.bulk).toBeGreaterThan(b.bulk);
    for (const d of [a, b, c]) expect(d.thigh + d.shin + d.skate).toBeGreaterThan(d.hipHeight);
  });

  it('gives human proportions in metres for an average player', () => {
    const d = bodyDims(185, 90);
    expect(d.hipHeight).toBeGreaterThan(0.85); expect(d.hipHeight).toBeLessThan(1.0);
    expect(d.shoulderWidth).toBeGreaterThan(d.hipWidth);
    expect(d.stick).toBeGreaterThan(1.3); expect(d.stick).toBeLessThan(1.7);
    for (const v of Object.values(d)) expect(Number.isFinite(v) && v > 0).toBe(true);
  });
});
