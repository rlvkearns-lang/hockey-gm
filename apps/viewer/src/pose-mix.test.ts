import { describe, expect, it } from 'vitest';
import { bodyDims } from './body';
import { gaitRaw, initialGait, poseOf, rawPose, STYLES, type Motion, type Style } from './gait';
import { bladeAt, fitBody, mixRaw, shoulderJoint, type RawPose } from './pose-mix';

const motion = (speed: number): Motion => ({ speed, forward: speed, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false });
/** A style's raw key pose (before the fit), held part way through its cycle at 4 m/s. */
const rawOf = (style: Style, d: ReturnType<typeof bodyDims>): RawPose =>
  rawPose(style, { ...initialGait(), style, phase: 0.3, speed: 4 }, 1, motion(4), d, {});

describe('pose mixing', () => {
  it('bladeAt puts the blade on the target when it is in reach and as near as reach allows when it is not', () => {
    const d = bodyDims(185, 90), raw = rawOf('glide', d);
    const near = fitBody(bladeAt(raw, { x: 0.8, y: 0, z: -0.3 }, d), d);
    expect(Math.hypot(near.blade.x - 0.8, near.blade.z + 0.3)).toBeLessThan(0.02); expect(near.blade.y).toBeLessThan(0.03);
    const far = fitBody(bladeAt(raw, { x: 4, y: 0, z: 0 }, d), d);
    expect(far.blade.x).toBeLessThan(2.2); expect(Number.isFinite(far.blade.x + far.hipY)).toBe(true);
  });
  it('mixRaw at 0 and 1 returns the ends and is continuous between', () => {
    const d = bodyDims(185, 90), a = rawOf('stand', d), b = rawOf('stop', d);
    expect(fitBody(mixRaw(a, b, 0), d)).toEqual(fitBody(a, d)); expect(fitBody(mixRaw(a, b, 1), d)).toEqual(fitBody(b, d));
    let last = fitBody(a, d).hipY; for (let w = 0; w <= 1; w += 0.01) { const h = fitBody(mixRaw(a, b, w), d).hipY; expect(Math.abs(h - last)).toBeLessThan(0.01); last = h; }
  });

  // Beyond the brief's list.
  it('poseOf is the gait raw pose fitted to the body', () => {
    const d = bodyDims(178, 84);
    for (const style of STYLES) {
      const g = { ...initialGait(), style, phase: 0.62, speed: 6, from: [{ style: 'glide' as Style, side: 1 as const, w: 1 }], blendT: 0.1, blendDur: 0.35 };
      expect(poseOf(g, motion(6), d, { hasPuck: true })).toEqual(fitBody(gaitRaw(g, motion(6), d, { hasPuck: true }), d));
    }
  });
  it('bladeAt keeps the blade on a moving target, the hands within reach, and stays continuous', () => {
    const d = bodyDims(185, 90), raw = rawOf('stand', d);
    let last: ReturnType<typeof fitBody> | null = null;
    for (let a = -1.2; a <= 1.2; a += 0.01) {
      const target = { x: 0.6 + 0.4 * Math.cos(a), y: 0.15 * (1 + Math.sin(3 * a)), z: -0.2 + 0.6 * Math.sin(a) };
      const p = fitBody(bladeAt(raw, target, d), d);
      expect(Math.hypot(p.blade.x - target.x, p.blade.y - target.y, p.blade.z - target.z)).toBeLessThan(0.02);
      const sr = shoulderJoint({ hipY: p.hipY, pitch: p.pitch, roll: p.roll, twist: p.twist ?? 0 }, 1, d);
      const h = p.arms[1].hand;
      expect(Math.hypot(h.x - sr.x, h.y - sr.y, h.z - sr.z)).toBeLessThanOrEqual((d.upperArm + d.forearm) * 0.98 + 1e-9);
      if (last) expect(Math.hypot(h.x - last.arms[1].hand.x, h.y - last.arms[1].hand.y, h.z - last.arms[1].hand.z)).toBeLessThan(0.05);
      last = p;
    }
  });
});
