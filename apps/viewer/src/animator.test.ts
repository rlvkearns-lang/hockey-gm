import { describe, expect, it } from 'vitest';
import { bodyDims } from './body';
import { initialSkaterAnim, motionOfSample, poseSkater, stepSkater, type Overlay } from './animator';
import { poseOf } from './gait';
import { mixRaw } from './pose-mix';
import { contextWith, emptyContext, sample } from './test/anim';

describe('animator', () => {
  it('with no overlays active the animator gives exactly the gait pose', () => {
    const d = bodyDims(185, 90); let a = initialSkaterAnim(); const s = sample({ speed: 6 }); const ctx = emptyContext();
    for (let i = 0; i < 90; i++) a = stepSkater(a, s, ctx, 1 / 60);
    expect(poseSkater(a, s, ctx, d).pose).toEqual(poseOf(a.gait, motionOfSample(s), d)); expect(poseSkater(a, s, ctx, d).offset).toEqual({ x: 0, z: 0 });
  });
  it('the faceoff crouch is an overlay: it fades in at the dot during faceoff setup and out when play starts', () => {
    const d = bodyDims(185, 90); let a = initialSkaterAnim(); const s = sample({ speed: 0 });
    const at = (phase: 'faceoffSetup' | 'live') => contextWith({ phase, faceoffSpot: { x: s.pos.x + 0.6, y: s.pos.y } });
    for (let i = 0; i < 60; i++) a = stepSkater(a, s, at('faceoffSetup'), 1 / 60); const low = poseSkater(a, s, at('faceoffSetup'), d).pose.hipY;
    for (let i = 0; i < 60; i++) a = stepSkater(a, s, at('live'), 1 / 60); const up = poseSkater(a, s, at('live'), d).pose.hipY;
    expect(low).toBeLessThan(up - 0.08);
  });

  // Beyond the brief's list.
  it('overlays apply in order with their weights, keep their own state, and may ask for a drawn-body offset', () => {
    const d = bodyDims(185, 90), s = sample({ speed: 3 }), ctx = emptyContext();
    const lift: Overlay<{ t: number }> = {
      id: 'lift',
      step: (slot, _s, _c, dt) => ({ t: (slot?.t ?? 0) + dt }),
      weight: (anim) => Math.min(1, ((anim.slots.lift as { t: number } | undefined)?.t ?? 0) / 0.5),
      apply: (raw) => ({ ...raw, hipY: raw.hipY - 0.3 }),
      offset: () => ({ x: 0.2, z: -0.1 }),
    };
    const list = [lift as Overlay];
    let a = initialSkaterAnim();
    a = stepSkater(a, s, ctx, 1 / 60, list);
    const plain = poseSkater(a, s, ctx, d, []).pose;
    for (let i = 0; i < 14; i++) a = stepSkater(a, s, ctx, 1 / 60, list); // a quarter second: weight about 0.5
    const half = poseSkater(a, s, ctx, d, list);
    expect((a.slots.lift as { t: number }).t).toBeCloseTo(0.25, 9);
    expect(half.offset.x).toBeCloseTo(0.1, 6); expect(half.offset.z).toBeCloseTo(-0.05, 6);
    expect(half.pose.hipY).toBeLessThan(poseSkater(a, s, ctx, d, []).pose.hipY - 0.1);
    expect(Number.isFinite(plain.hipY)).toBe(true);
    // A skater starting afresh (a seek, a cut, stepping on) starts every overlay's state afresh.
    a = stepSkater({ ...a, fresh: true }, s, ctx, 1 / 60, list);
    expect((a.slots.lift as { t: number }).t).toBeCloseTo(1 / 60, 9);
    expect(mixRaw).toBeTypeOf('function');
  });
  it('a skater off the ice starts afresh when he steps back on', () => {
    const s = sample({ speed: 5 }), ctx = emptyContext();
    let a = initialSkaterAnim();
    for (let i = 0; i < 30; i++) a = stepSkater(a, s, ctx, 1 / 60);
    expect(a.fresh).toBe(false);
    a = stepSkater(a, { ...s, onIce: false }, ctx, 1 / 60);
    expect(a.fresh).toBe(true);
  });
});
