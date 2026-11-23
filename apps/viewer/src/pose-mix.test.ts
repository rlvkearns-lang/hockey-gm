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

  // Task 2: a stick raised above the hands.
  it('a blade target at shoulder height behind him on his stick side is reached, with the top hand in front of his chest', () => {
    const d = bodyDims(185, 90), raw = { ...rawOf('stand', d), top: { x: 0.4, y: 0.2, z: -0.25 } };
    for (const target of [{ x: -0.55, y: 1.4, z: -0.65 }, { x: -0.7, y: 1.2, z: -0.5 }, { x: -0.4, y: 1.5, z: -0.75 }]) {
      const p = fitBody(bladeAt(raw, target, d), d);
      expect(Math.hypot(p.blade.x - target.x, p.blade.y - target.y, p.blade.z - target.z), JSON.stringify(target)).toBeLessThan(0.1);
      expect(p.blade.y).toBeGreaterThan(p.arms[1].hand.y); // the blade above the hands
      expect(p.arms[1].hand.x).toBeGreaterThan(0); // the top hand in front of him
      expect(shaftClear(p, d)).toBeGreaterThan(0.1);
    }
  });
  it('the fit is continuous as the blade sweeps from the ice in front, back and up to shoulder height, and through to a high finish in front', () => {
    const d = bodyDims(185, 90), base = rawOf('stand', d);
    // A path through key points (body frame of a left shot), with the top hand asked to come up in front as it rises.
    const keys = [{ x: 0.85, y: 0, z: -0.45 }, { x: -0.1, y: 0.4, z: -0.8 }, { x: -0.55, y: 1.4, z: -0.65 }, { x: 0.65, y: 0, z: -0.2 }, { x: 1.2, y: 0.4, z: 0.1 }, { x: 1.1, y: 1.1, z: 0.3 }];
    let last: ReturnType<typeof fitBody> | null = null, worst = 0;
    for (let i = 0; i < keys.length - 1; i++) for (let s = 0; s < 1; s += 0.01) {
      const a = keys[i]!, b = keys[i + 1]!, u = s * s * (3 - 2 * s);
      const t = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
      const lift = Math.min(1, t.y / 0.9);
      const raw = { ...base, top: { x: base.top.x + (0.4 - base.top.x) * lift, y: base.top.y + (0.2 - base.top.y) * lift, z: base.top.z + (-0.25 - base.top.z) * lift } };
      const p = fitBody(bladeAt(raw, t, d), d);
      expect(Math.hypot(p.blade.x - t.x, p.blade.y - t.y, p.blade.z - t.z)).toBeLessThan(0.1);
      if (last) worst = Math.max(worst, Math.hypot(p.blade.x - last.blade.x, p.blade.y - last.blade.y, p.blade.z - last.blade.z),
        ...[0, 1].map((k) => Math.hypot(p.arms[k]!.hand.x - last!.arms[k]!.hand.x, p.arms[k]!.hand.y - last!.arms[k]!.hand.y, p.arms[k]!.hand.z - last!.arms[k]!.hand.z)));
      last = p;
    }
    expect(worst).toBeLessThan(0.06);
  });
});

/** How far (m) the shaft, from the top hand to the heel, stays from his torso's centre line and his head. */
function shaftClear(p: ReturnType<typeof fitBody>, d: ReturnType<typeof bodyDims>): number {
  const sl = shoulderJoint({ hipY: p.hipY, pitch: p.pitch, roll: p.roll, twist: p.twist ?? 0 }, 0, d);
  const sr = shoulderJoint({ hipY: p.hipY, pitch: p.pitch, roll: p.roll, twist: p.twist ?? 0 }, 1, d);
  const neck = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2, z: (sl.z + sr.z) / 2 }, pelvis = { x: 0, y: p.hipY, z: 0 };
  const head = { x: neck.x, y: neck.y + 0.2, z: neck.z };
  const a = p.arms[1].hand, b = p.blade;
  let best = Infinity;
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const s = i / 20, u = j / 20;
    const q = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s };
    const c = { x: pelvis.x + (head.x - pelvis.x) * u, y: pelvis.y + (head.y - pelvis.y) * u, z: pelvis.z + (head.z - pelvis.z) * u };
    // The body is about bulk thick round its centre line; the shaft from 0.25 m above the hand (it is held in front of the chest).
    if (s * Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 0.25) continue;
    best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z) - d.bulk);
  }
  return best;
}
