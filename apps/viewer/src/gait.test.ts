import { describe, expect, it } from 'vitest';
import type { SkaterState } from '@hockey/engine';
import { bodyDims } from './body';
import {
  STYLES, initialGait, motionOf, poseOf, solveLeg, stepGait,
  type GaitState, type Motion, type Pose, type Vec3,
} from './gait';

const m = (p: Partial<Motion>): Motion => ({ speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false, ...p });

describe('gait styles', () => {
  it('standing still does not move the legs', () => {
    let g = initialGait(); for (let i = 0; i < 120; i++) g = stepGait(g, m({}), 1 / 60);
    expect(g.style).toBe('stand'); expect(g.phase).toBe(0);
  });
  it('accelerating forward strides, and the stride phase advances faster at higher speed', () => {
    const run = (speed: number) => { let g = initialGait(); for (let i = 0; i < 60; i++) g = stepGait(g, m({ speed, forward: speed, accelAlong: 3 }), 1 / 60); return g; };
    expect(run(4).style).toBe('stride'); expect(run(8).phase).toBeGreaterThan(run(4).phase);
  });
  it('coasting at speed glides', () => {
    let g = initialGait(); for (let i = 0; i < 90; i++) g = stepGait(g, m({ speed: 7, forward: 7, accelAlong: 0 }), 1 / 60);
    expect(g.style).toBe('glide');
  });
  it('moving opposite to his facing is backward skating', () => {
    let g = initialGait(); for (let i = 0; i < 60; i++) g = stepGait(g, m({ speed: 4, forward: -4 }), 1 / 60);
    expect(g.style).toBe('backward');
  });
  it('moving mostly sideways, or turning hard at speed, is a crossover', () => {
    let a = initialGait(), b = initialGait();
    for (let i = 0; i < 60; i++) { a = stepGait(a, m({ speed: 4, lateral: 4 }), 1 / 60); b = stepGait(b, m({ speed: 7, forward: 7, turnRate: 2.2, accelAlong: 1 }), 1 / 60); }
    expect(a.style).toBe('crossover'); expect(b.style).toBe('crossover');
  });
  it('braking hard is a stop', () => {
    let g = initialGait(); for (let i = 0; i < 20; i++) g = stepGait(g, m({ speed: 6, forward: 6, accelAlong: -9 }), 1 / 60);
    expect(g.style).toBe('stop');
  });
  it('a downed skater is down and his style does not flicker', () => {
    let g = initialGait(); const seen = new Set<string>();
    for (let i = 0; i < 60; i++) { g = stepGait(g, m({ speed: 3, forward: 3, down: true }), 1 / 60); seen.add(g.style); }
    expect([...seen]).toEqual(['down']);
  });
  it('style does not flip back and forth across a threshold', () => {
    let g = initialGait(), flips = 0, last = g.style;
    for (let i = 0; i < 240; i++) { g = stepGait(g, m({ speed: 5, forward: 5, accelAlong: i % 2 ? 0.9 : 1.1 }), 1 / 60); if (g.style !== last) { flips++; last = g.style; } }
    expect(flips).toBeLessThanOrEqual(2);
  });

  // Beyond the brief's list.
  it('a one-tick shove does not run his legs, and slow drifting is a stand', () => {
    let g = initialGait(); const seen = new Set<string>();
    // At 30 Hz ticks shown at 60 fps: one tick (two frames) of a hard shove, then the speed bleeds off.
    for (let i = 0; i < 2; i++) { g = stepGait(g, m({ speed: 1.5, forward: 1.5, accelAlong: 45 }), 1 / 60); seen.add(g.style); }
    for (let i = 0; i < 60; i++) { g = stepGait(g, m({ speed: 1.5 - i * 0.02, forward: 1.5 - i * 0.02, accelAlong: -1.2 }), 1 / 60); seen.add(g.style); }
    expect(seen.has('stride')).toBe(false);
    let h = initialGait();
    for (let i = 0; i < 60; i++) h = stepGait(h, m({ speed: 0.6, lateral: 0.6, accelAlong: -0.2 }), 1 / 60);
    expect(h.style).toBe('stand'); expect(h.phase).toBe(0);
  });
  it('a shove sideways that bleeds off quickly is not a crossover', () => {
    let g = initialGait();
    for (let i = 0; i < 30; i++) g = stepGait(g, m({ speed: 2.5, lateral: 2.5, accelAlong: -12 }), 1 / 60);
    expect(g.style).not.toBe('crossover');
  });
  it('is frame-rate independent', () => {
    const run = (hz: number) => {
      let g = initialGait();
      for (let i = 0; i < hz * 2; i++) g = stepGait(g, m({ speed: 6, forward: 6, accelAlong: 4 }), 1 / hz);
      return g;
    };
    const a = run(30), b = run(60), c = run(144);
    expect(b.style).toBe(a.style); expect(c.style).toBe(a.style);
    expect(Math.abs(b.phase - a.phase)).toBeLessThan(0.05); expect(Math.abs(c.phase - a.phase)).toBeLessThan(0.05);
    expect(Math.abs(c.lean - a.lean)).toBeLessThan(0.01);
  });
  it('sprinting gives about 1.5 to 2.5 strides (pushes) a second', () => {
    let g = initialGait();
    for (let i = 0; i < 30; i++) g = stepGait(g, m({ speed: 8.5, forward: 8.5, accelAlong: 3 }), 1 / 60);
    const p0 = g.phase;
    for (let i = 0; i < 60; i++) g = stepGait(g, m({ speed: 8.5, forward: 8.5, accelAlong: 3 }), 1 / 60);
    const pushes = (g.phase - p0) * 2; // one phase cycle is a push with each leg
    expect(pushes).toBeGreaterThan(1.5); expect(pushes).toBeLessThan(2.5);
  });
  it('lean and roll ease toward their targets rather than snapping', () => {
    let g = initialGait();
    g = stepGait(g, m({ speed: 7, forward: 7, turnRate: 2, accelAlong: 6 }), 1 / 60);
    expect(g.lean).toBeGreaterThan(0); expect(g.lean).toBeLessThan(0.05);
    expect(g.roll).toBeGreaterThanOrEqual(0); expect(g.roll).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 7, forward: 7, turnRate: 2, accelAlong: 6 }), 1 / 60);
    expect(g.lean).toBeGreaterThan(0.2); expect(g.roll).toBeGreaterThan(0.3);
  });
});

const d185 = bodyDims(185, 90);
const pose = (g: Partial<GaitState> & Pick<GaitState, 'style'>, mo: Motion, d = d185): Pose =>
  poseOf({ phase: 0, styleT: 1, lean: 0, roll: 0, ...g }, mo, d);

describe('poses', () => {
  it('poses keep at least one skate on the ice and never produce NaN', () => {
    for (const d of [bodyDims(165, 70), bodyDims(185, 90), bodyDims(200, 110)]) for (const style of STYLES) for (let ph = 0; ph < 1; ph += 0.05) {
      const p = poseOf({ phase: ph, style, styleT: 1, lean: 0.2, roll: 0.1 }, m({ speed: 6, forward: 6 }), d);
      expect(Number.isFinite(p.hipY)).toBe(true);
      expect(Math.min(p.legs[0].foot.y, p.legs[1].foot.y)).toBeCloseTo(0, 5);
      for (const l of p.legs) expect(l.foot.y).toBeGreaterThanOrEqual(0);
    }
  });
  it('skates do not point across the direction of glide when gliding forward', () => {
    const p = poseOf({ phase: 0.3, style: 'glide', styleT: 1, lean: 0, roll: 0 }, m({ speed: 7, forward: 7 }), bodyDims(185, 90));
    for (const l of p.legs) expect(Math.abs(l.footYaw)).toBeLessThan(0.35);
  });

  it('every pose is finite everywhere and its feet and hands are within reach', () => {
    for (const d of [bodyDims(165, 70), bodyDims(200, 110)]) for (const style of STYLES) for (const from of [undefined, ...STYLES]) for (let ph = 0; ph < 2; ph += 0.07) {
      const p = poseOf({ phase: ph, style, styleT: 0.1, lean: 0.35, roll: -0.6, from }, m({ speed: 9, forward: 6, lateral: 6, accelAlong: 8, turnRate: -2 }), d);
      expect(JSON.stringify(p)).not.toMatch(/null|NaN/);
      expect(Math.min(p.legs[0].foot.y, p.legs[1].foot.y)).toBeCloseTo(0, 5);
      for (const side of [0, 1] as const) {
        const hip = hipSocket(p, side, d), f = p.legs[side].foot;
        expect(dist(hip, { x: f.x, y: f.y + d.skate, z: f.z })).toBeLessThanOrEqual(d.thigh + d.shin + 1e-6);
        expect(p.arms[side].hand.y).toBeGreaterThan(0);
      }
    }
  });
  it('striding alternates the legs: each skate leaves the ice in turn and pushes back and out with the toe turned out', () => {
    let leftUp = false, rightUp = false, pushedOut = false;
    for (let ph = 0; ph < 1; ph += 0.02) {
      const p = pose({ style: 'stride', phase: ph }, m({ speed: 7, forward: 7, accelAlong: 4 }));
      leftUp ||= p.legs[0].lifted; rightUp ||= p.legs[1].lifted;
      expect(p.legs[0].lifted && p.legs[1].lifted).toBe(false);
      const l = p.legs[0];
      if (!l.lifted && l.foot.x < -0.2 && l.foot.z < -0.3 && l.footYaw < -0.4) pushedOut = true;
    }
    expect(leftUp && rightUp && pushedOut).toBe(true);
    // Torso further forward under hard acceleration.
    expect(pose({ style: 'stride', lean: 0.3 }, m({ speed: 3, forward: 3 })).pitch).toBeGreaterThan(pose({ style: 'stride' }, m({ speed: 3, forward: 3 })).pitch);
  });
  it('gliding keeps both skates on the ice about shoulder width apart', () => {
    const p = pose({ style: 'glide', phase: 0.4 }, m({ speed: 7, forward: 7 }));
    expect(p.legs[0].lifted || p.legs[1].lifted).toBe(false);
    const w = p.legs[1].foot.z - p.legs[0].foot.z;
    expect(w).toBeGreaterThan(d185.shoulderWidth * 0.8); expect(w).toBeLessThan(d185.shoulderWidth * 1.3);
  });
  it('a crossover rolls into the turn and the outside skate crosses in front of the inside one', () => {
    let crossed = false;
    for (let ph = 0; ph < 1; ph += 0.02) {
      const p = pose({ style: 'crossover', phase: ph, side: 1, roll: 0.4 }, m({ speed: 7, forward: 7, turnRate: 2 }));
      expect(p.roll).toBeGreaterThan(0.2);
      const out = p.legs[0], inside = p.legs[1];
      if (out.foot.z > inside.foot.z && out.foot.x > inside.foot.x) crossed = true;
    }
    expect(crossed).toBe(true);
  });
  it('a stop turns both skates sideways to travel with the knees deeply bent', () => {
    const p = pose({ style: 'stop', lean: -0.25 }, m({ speed: 6, forward: 6, accelAlong: -8 }));
    for (const l of p.legs) { expect(Math.abs(l.footYaw)).toBeGreaterThan(1.2); expect(l.lifted).toBe(false); }
    expect(p.hipY).toBeLessThan(pose({ style: 'glide' }, m({ speed: 6, forward: 6 })).hipY);
    expect(p.pitch).toBeLessThan(pose({ style: 'glide' }, m({ speed: 6, forward: 6 })).pitch);
  });
  it('backward skating sits more upright with both skates on the ice through its C-cuts', () => {
    let sweptOut = 0;
    for (let ph = 0; ph < 1; ph += 0.05) {
      const p = pose({ style: 'backward', phase: ph, acc: 3 }, m({ speed: 5, forward: -5, accelAlong: 3 }));
      expect(p.legs[0].lifted || p.legs[1].lifted).toBe(false);
      sweptOut = Math.max(sweptOut, -p.legs[0].foot.z);
      expect(p.pitch).toBeLessThan(pose({ style: 'stride' }, m({ speed: 5, forward: 5 })).pitch);
    }
    expect(sweptOut).toBeGreaterThan(pose({ style: 'backward', phase: 0.75, acc: 3 }, m({ speed: 5, forward: -5 })).legs[0].foot.z * -1 + 0.1);
  });
  it('a downed skater is on the ice', () => {
    const p = pose({ style: 'down' }, m({ speed: 2, forward: 2, down: true }));
    expect(p.hipY).toBeLessThan(0.35);
  });
  it('a skater who comes to rest eases his feet back to the stand pose instead of freezing mid-stride', () => {
    let g = initialGait();
    for (let i = 0; i < 70; i++) g = stepGait(g, m({ speed: 6, forward: 6, accelAlong: 4 }), 1 / 60);
    expect(g.style).toBe('stride');
    const stand = pose({ style: 'stand' }, m({}));
    const gap = (p: Pose) => Math.max(...[0, 1].map((i) => dist(p.legs[i]!.foot, stand.legs[i]!.foot)));
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) { g = stepGait(g, m({}), 1 / 60); seen.push(gap(poseOf(g, m({}), d185))); }
    expect(g.style).toBe('stand');
    expect(seen[0]!).toBeGreaterThan(0.05); // not snapped on the first frame
    expect(seen[seen.length - 1]!).toBeLessThan(1e-9);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]! + 0.03); // and no jumps
  });
});

describe('solveLeg', () => {
  it('solveLeg never returns NaN, even for a foot out of reach', () => {
    const s = solveLeg({ x: 0, y: 0.9, z: 0 }, { x: 3, y: 0, z: 0 }, 0.45, 0.45);
    expect(Number.isFinite(s.kneeAngle) && Number.isFinite(s.hipPitch) && Number.isFinite(s.hipRoll)).toBe(true);
  });
  it('places the ankle where asked (knee forward), and straight for an unreachable foot', () => {
    const hip = { x: 0.1, y: 0.9, z: 0.1 };
    for (const foot of [{ x: 0, y: 0.14, z: 0.2 }, { x: -0.25, y: 0.2, z: 0.35 }, { x: 0.3, y: 0.3, z: -0.1 }, { x: 0.1, y: 0.9, z: 0.1 }]) {
      const s = solveLeg(hip, foot, 0.45, 0.46);
      const r = ankleOf(hip, s, 0.45, 0.46);
      const want = dist(hip, foot) < 0.01 ? null : foot;
      if (want) { expect(r.ankle.x).toBeCloseTo(want.x, 6); expect(r.ankle.y).toBeCloseTo(want.y, 6); expect(r.ankle.z).toBeCloseTo(want.z, 6); }
      expect(r.knee.x).toBeGreaterThanOrEqual(Math.min(hip.x, r.ankle.x) - 1e-9); // knee bends forward
      expect(s.kneeAngle).toBeGreaterThanOrEqual(0);
    }
    expect(solveLeg(hip, { x: 3, y: 0, z: 0 }, 0.45, 0.46).kneeAngle).toBeCloseTo(0, 9);
    expect(Number.isFinite(solveLeg(hip, hip, 0.45, 0.46).hipPitch)).toBe(true);
  });
});

describe('motionOf', () => {
  const sk = (p: Partial<SkaterState>): SkaterState => ({
    id: 'a', side: 'home', slot: 'C', pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, facing: 0, target: { x: 0, y: 0 }, faceTarget: null,
    mode: 'forward', speedCap: 1, energy: 1, onIce: true, leaving: false, downT: 0, contestId: null, shiftStart: 0, toiTicks: 0, ...p,
  });
  it('reads velocity in his own frame, turn the short way round, acceleration from the change in speed', () => {
    const f = Math.PI - 0.05;
    const mo = motionOf(sk({ vel: { x: 3, y: 0 }, facing: -Math.PI + 0.05 }), sk({ vel: { x: 0, y: 4 }, facing: f, mode: 'crossover' }), 1 / 30);
    expect(mo.speed).toBeCloseTo(4, 9);
    expect(mo.forward).toBeCloseTo(4 * Math.sin(f), 9);
    // +z (his right) is the engine's facing + 90 degrees: engine y is world Z.
    expect(mo.lateral).toBeCloseTo(4 * Math.cos(f), 9);
    expect(mo.turnRate).toBeCloseTo(-0.1 * 30, 6);
    expect(mo.accelAlong).toBeCloseTo(30, 6);
    expect(mo.facing).toBe(f); expect(mo.down).toBe(false);
    expect(motionOf(sk({}), sk({ downT: 1 }), 1 / 30).down).toBe(true);
    const z = motionOf(sk({}), sk({}), 0);
    expect(z.turnRate).toBe(0); expect(z.accelAlong).toBe(0);
  });
});

// Helpers that follow the conventions documented in gait.ts.
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function hipSocket(p: Pose, side: 0 | 1, d: ReturnType<typeof bodyDims>): Vec3 {
  const w = (side === 0 ? -1 : 1) * d.hipWidth / 2;
  return { x: -w * Math.sin(p.yaw), y: p.hipY, z: w * Math.cos(p.yaw) };
}
function ankleOf(hip: Vec3, s: { kneeAngle: number; hipPitch: number; hipRoll: number }, thigh: number, shin: number) {
  const dir = (pitch: number) => ({ x: Math.sin(pitch), y: -Math.cos(pitch) * Math.cos(s.hipRoll), z: Math.cos(pitch) * Math.sin(s.hipRoll) });
  const a = dir(s.hipPitch), b = dir(s.hipPitch - s.kneeAngle);
  const knee = { x: hip.x + thigh * a.x, y: hip.y + thigh * a.y, z: hip.z + thigh * a.z };
  return { knee, ankle: { x: knee.x + shin * b.x, y: knee.y + shin * b.y, z: knee.z + shin * b.z } };
}
