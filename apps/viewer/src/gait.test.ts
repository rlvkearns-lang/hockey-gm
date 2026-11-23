import { describe, expect, it } from 'vitest';
import type { SkaterState } from '@hockey/engine';
import { bodyDims } from './body';
import {
  STYLES, hipJoint, initialGait, motionOf, poseOf, solveLeg, stepGait,
  type GaitState, type Motion, type Pose, type SkaterPose, type Style, type Vec3,
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
  it('slow drifting is a stand and does not move the legs', () => {
    let h = initialGait();
    for (let i = 0; i < 60; i++) h = stepGait(h, m({ speed: 0.6, lateral: 0.6, accelAlong: -0.2 }), 1 / 60);
    expect(h.style).toBe('stand'); expect(h.phase).toBe(0);
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
    for (const d of [bodyDims(165, 70), bodyDims(200, 110)]) for (const style of STYLES) for (const from of [undefined, ...STYLES.map((style) => [{ style, side: -1 as const, w: 1 }])]) for (let ph = 0; ph < 2; ph += 0.07) {
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

// ---------------------------------------------------------------------------------------------------------------
// Review fix round 1: each test would have caught the glitch it is named after.

const BODIES = [bodyDims(165, 70), bodyDims(185, 90), bodyDims(200, 110)];
const RATES = [30, 60, 144];
const deg = Math.PI / 180;
/** Largest move of a foot, hand or the pelvis between two poses (m). */
function moved(a: Pose, b: Pose): number {
  let j = Math.abs(a.hipY - b.hipY);
  for (const i of [0, 1] as const) j = Math.max(j, dist(a.legs[i].foot, b.legs[i].foot), dist(a.arms[i].hand, b.arms[i].hand));
  return j;
}
/** Run `script(t)` at `hz` for `secs`, calling `each` with the state, pose and motion of every frame. */
function play(script: (t: number) => Motion, hz: number, secs: number, each: (g: GaitState, p: Pose, mo: Motion, t: number) => void, d = d185, g0 = initialGait()) {
  let g = g0;
  for (let i = 0; i < Math.round(secs * hz); i++) {
    const t = i / hz, mo = script(t);
    g = stepGait(g, mo, 1 / hz);
    each(g, poseOf(g, mo, d), mo, t);
  }
  return g;
}
/** Worst single-frame move, scaled to a 60 Hz frame. */
function worstMove(script: (t: number) => Motion, hz: number, secs: number, d = d185): { j: number; at: string } {
  let prev: Pose | null = null, worst = 0, at = '';
  play(script, hz, secs, (g, p, _mo, t) => {
    if (prev) { const j = moved(prev, p) * (hz / 60); if (j > worst) { worst = j; at = `t=${t.toFixed(3)} ${g.style}`; } }
    prev = p;
  }, d);
  return { j: worst, at };
}
/**
 * An engine-like passive shove: velocity jumps to v0 along `dir` (forward, lateral) in one 30 Hz tick, then with no
 * goal the engine brakes his along-facing speed at 8 m/s^2 and his edges shed the sideways part at exp(-6t).
 */
function shove(v0: number, dir: [number, number]): (t: number) => Motion {
  const ticks: { f: number; l: number }[] = [{ f: 0, l: 0 }];
  let f = v0 * dir[0], l = v0 * dir[1];
  for (let k = 1; k < 90; k++) {
    ticks.push({ f, l });
    f = Math.sign(f) * Math.max(0, Math.abs(f) - 8 / 30); l *= Math.exp(-6 / 30);
  }
  const sp = (k: number) => Math.hypot(ticks[k]!.f, ticks[k]!.l);
  return (t) => {
    const k = Math.min(ticks.length - 1, Math.floor(t * 30));
    return m({ speed: sp(k), forward: ticks[k]!.f, lateral: ticks[k]!.l, accelAlong: k === 0 ? 0 : (sp(k) - sp(k - 1)) * 30 });
  };
}

describe('review fixes', () => {
  it('I-1: the pelvis rises and falls smoothly through each push-off', () => {
    for (const d of BODIES) for (const speed of [5, 7, 9]) {
      let prev = NaN;
      for (let q = 0; q <= 1.0005; q += 0.001) {
        const p = poseOf({ phase: q, style: 'stride', styleT: 1, lean: 0.2, roll: 0, acc: 4 }, m({ speed, forward: speed, accelAlong: 4 }), d);
        if (!Number.isNaN(prev)) expect(Math.abs(p.hipY - prev)).toBeLessThan(0.002);
        prev = p.hipY;
      }
    }
  });

  it('I-2: a change that lands mid-blend continues from the pose shown (no foot, hand or hip jumps over 6 cm a frame)', () => {
    const scenes: [string, Motion, Motion][] = [
      ['glide/stop', m({ speed: 7, forward: 7 }), m({ speed: 7, forward: 7, accelAlong: -10 })],
      ['stride/stop', m({ speed: 7, forward: 7, accelAlong: 6 }), m({ speed: 7, forward: 7, accelAlong: -10 })],
      ['cross/stop', m({ speed: 7, forward: 7, turnRate: 2.2, accelAlong: 1 }), m({ speed: 7, forward: 7, accelAlong: -10 })],
      ['stride/down', m({ speed: 7, forward: 7, accelAlong: 6 }), m({ speed: 7, forward: 7, down: true })],
      ['stop/down', m({ speed: 7, forward: 7, accelAlong: -10 }), m({ speed: 7, forward: 7, down: true })],
      ['down/stand', m({ speed: 0.2, down: true }), m({})],
      ['back/cross', m({ speed: 5, forward: -5, accelAlong: 2 }), m({ speed: 5, lateral: 5, accelAlong: 1 })],
      // A collision jolt mid-stop: speed falls from 4 to 0.8 m/s in one engine tick.
      ['stop/jolt', m({ speed: 4, forward: 4, accelAlong: -8 }), m({ speed: 0.8, forward: 0.8, accelAlong: -96 })],
    ];
    for (const hz of RATES) for (const [name, a, b] of scenes) for (const k of [0.05, 0.1, 0.17, 0.25, 0.4, 0.6]) {
      // a for 2.5 s, b for k seconds (landing in the blend a -> b), back to a, then b again.
      const script = (t: number) => (t < 2.5 ? a : t < 2.5 + k ? b : t < 2.5 + k + 0.12 ? a : b);
      const w = worstMove(script, hz, 4);
      expect(w.j, `${name} k=${k} ${hz} Hz ${w.at}`).toBeLessThan(0.06);
    }
    // Starting to stride, then braking at once, then falling while that is still blending.
    for (const hz of RATES) for (const tStop of [0.5, 0.55, 0.6, 0.65]) {
      const script = (t: number) => t < tStop ? m({ speed: 3 + t * 6, forward: 3 + t * 6, accelAlong: 8 })
        : t < tStop + 0.1 ? m({ speed: 7, forward: 7, accelAlong: -10 }) : m({ speed: 6, forward: 6, down: true });
      const w = worstMove(script, hz, 2);
      expect(w.j, `stride/stop/down ${tStop} ${hz} Hz ${w.at}`).toBeLessThan(0.06);
    }
  });

  it('I-3: a passive shove never shows a stride, crossover or stop', () => {
    const dirs: [string, [number, number]][] = [['side', [0, 1]], ['other side', [0, -1]], ['diagonal', [Math.SQRT1_2, Math.SQRT1_2]], ['backward', [-1, 0]], ['back-diagonal', [-Math.SQRT1_2, -Math.SQRT1_2]], ['forward', [1, 0]]];
    for (const hz of RATES) for (const v0 of [1.5, 2.5, 4]) for (const [name, dir] of dirs) {
      const seen = new Set<Style>();
      play(shove(v0, dir), hz, 2, (g) => seen.add(g.style));
      for (const s of ['stride', 'crossover', 'stop'] as const) expect(seen.has(s), `${name} v0=${v0} ${hz} Hz saw ${[...seen]}`).toBe(false);
    }
    // Shoved sideways while gliding at 5 m/s: still a glide.
    const glide = initialGait();
    let g = glide; for (let i = 0; i < 60; i++) g = stepGait(g, m({ speed: 5, forward: 5 }), 1 / 60);
    const sp = (k: number) => Math.hypot(5, k === 0 ? 0 : 3 * Math.exp(-6 * (k - 1) / 30));
    const seen = new Set<Style>();
    play((t) => { const k = Math.floor(t * 30); const l = k === 0 ? 0 : 3 * Math.exp(-6 * (k - 1) / 30); return m({ speed: sp(k), forward: 5, lateral: l, accelAlong: k === 0 ? 0 : (sp(k) - sp(k - 1)) * 30 }); }, 60, 1.5, (s) => seen.add(s.style), d185, g);
    expect([...seen]).toEqual(['glide']);
  });

  it('I-4: planted skates follow the line of travel, and turn continuously as the travel swings round', () => {
    const lineOff = (yaw: number, th: number) => { const a = Math.abs(Math.atan2(Math.sin(yaw - th), Math.cos(yaw - th))); return Math.min(a, Math.PI - a); };
    for (const speed of [3, 7]) for (let a = -180; a <= 180; a += 5) {
      const th = a * deg, mo = m({ speed, forward: speed * Math.cos(th), lateral: speed * Math.sin(th) });
      let checked = 0;
      play(() => mo, 60, 3.5, (g, p, _mo, t) => {
        if (t < 2 || g.from) return;
        for (const i of [0, 1] as const) {
          const l = p.legs[i];
          if (l.lifted || g.style === 'stop' || g.style === 'stand') continue;
          const q = frac(g.phase + (i === 0 ? 0 : 0.5)), ph = frac(g.phase);
          if (g.style === 'stride' && q >= 0.15) continue; // pushing
          if (g.style === 'backward' && q < 0.5) continue; // cutting
          if (g.style === 'crossover' && i === ((g.side ?? 1) > 0 ? 1 : 0) && ph >= 0.45) continue; // inside leg pushing
          checked++;
          expect(lineOff(l.footYaw, th), `${g.style} travel ${a} deg at ${speed}`).toBeLessThan(25 * deg);
        }
      });
      expect(checked).toBeGreaterThan(0);
    }
    // Travel swinging all the way round and back: skate headings move continuously (a pivot is the fastest part).
    for (const hz of RATES) {
      let prev: Pose | null = null, worst = 0;
      const angle = (t: number) => Math.PI * Math.sin((t / 12) * Math.PI); // 0 -> 180 -> 0 -> -180 degrees
      play((t) => m({ speed: 5, forward: 5 * Math.cos(angle(t)), lateral: 5 * Math.sin(angle(t)) }), hz, 24, (_g, p) => {
        if (prev) for (const i of [0, 1] as const) worst = Math.max(worst, Math.abs(p.legs[i].footYaw - prev.legs[i].footYaw) * (hz / 60));
        prev = p;
      });
      expect(worst, `${hz} Hz`).toBeLessThan(0.25);
    }
  });

  it('M-1: style timelines agree across frame rates', () => {
    const script = (t: number): Motion => t < 1 ? m({ speed: 1 + 6 * t, forward: 1 + 6 * t, accelAlong: 6 })
      : t < 2 ? m({ speed: 7, forward: 7 }) : t < 3 ? m({ speed: 7, forward: 7, turnRate: 1.6 })
        : t < 3.6 ? m({ speed: Math.max(0, 7 - 10 * (t - 3)), forward: Math.max(0, 7 - 10 * (t - 3)), accelAlong: -10 })
          : t < 4.5 ? m({ speed: 3, forward: -3, accelAlong: 1 }) : m({});
    // Brake, then his travel swings round to the side his toes point (a side flip inside the stop), then on.
    const flip = (t: number): Motion => { const a = t < 1.6 ? 0 : Math.min(1.7, (t - 1.6) * 3); const sp = t < 1 ? 7 : Math.max(1.6, 7 - 6 * (t - 1)); return m({ speed: sp, forward: sp * Math.cos(a), lateral: sp * Math.sin(a), accelAlong: t < 1 ? 0 : -6 }); };
    for (const s of [script, flip]) {
      const timeline = (hz: number) => { const out: [Style, number][] = []; play(s, hz, 6, (g, _p, _mo, t) => { if (out.length === 0 || out[out.length - 1]![0] !== g.style) out.push([g.style, t]); }); return out; };
      const ref = timeline(60);
      for (const hz of [30, 144]) {
        const tl = timeline(hz);
        expect(tl.map((x) => x[0]), `${hz} Hz`).toEqual(ref.map((x) => x[0]));
        tl.forEach(([, t], i) => expect(Math.abs(t - ref[i]![1]), `${hz} Hz change ${i}`).toBeLessThan(0.05));
      }
    }
  });

  it('M-2: non-finite motion does not poison the gait', () => {
    let g = initialGait();
    for (let i = 0; i < 30; i++) g = stepGait(g, m({ speed: 6, forward: 6, accelAlong: 4 }), 1 / 60);
    g = stepGait(g, m({ speed: 6, forward: 6, accelAlong: NaN, turnRate: Infinity }), 1 / 60);
    g = stepGait(g, m({ speed: NaN, forward: -Infinity, lateral: NaN }), 1 / 60);
    for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 7, forward: 7 }), 1 / 60);
    expect(JSON.stringify(g)).not.toMatch(/null|NaN|Infinity/);
    expect(g.style).toBe('glide');
    expect(JSON.stringify(poseOf(g, m({ speed: NaN, accelAlong: Infinity }), d185))).not.toMatch(/null|NaN/);
  });

  it('M-3: the downed pose sits with knees up and forward, and the leg solve never flips', () => {
    for (const d of BODIES) {
      const p = poseOf({ phase: 0, style: 'down', styleT: 1, lean: 0, roll: 0 }, m({ down: true }), d);
      for (const i of [0, 1] as const) {
        const hip = hipJoint(p, i, d), f = p.legs[i].foot, ankle = { x: f.x, y: f.y + d.skate, z: f.z };
        const s = solveLeg(hip, ankle, d.thigh, d.shin);
        const k = ankleOf(hip, s, d.thigh, d.shin);
        expect(Math.abs(s.hipRoll)).toBeLessThan(0.2);
        expect(k.knee.y).toBeGreaterThan(Math.max(hip.y, ankle.y) + 0.1);
        expect(k.knee.x).toBeGreaterThan(hip.x);
      }
    }
    const hip = { x: 0, y: 0.3, z: 0.1 };
    for (const foot of [{ x: 0.6, y: 0.3, z: 0.1 }, { x: 0.5, y: 0.45, z: 0.2 }, { x: 0.5, y: 0.3, z: 0.25 }, { x: 0.4, y: 0.6, z: -0.1 }]) {
      const s = solveLeg(hip, foot, 0.45, 0.46);
      expect(Math.abs(s.hipRoll)).toBeLessThanOrEqual(Math.PI / 2);
      const r = ankleOf(hip, s, 0.45, 0.46).ankle;
      expect(r.x).toBeCloseTo(foot.x, 6); expect(r.y).toBeCloseTo(foot.y, 6); expect(r.z).toBeCloseTo(foot.z, 6);
    }
  });

  it('M-4: skates turn smoothly at touchdown, and no style moves a foot or hand more than 6 cm a frame at full speed', () => {
    for (const speed of [5, 7, 9]) {
      let prev: Pose | null = null;
      for (let q = 0; q <= 1.0005; q += 0.001) {
        const p = poseOf({ phase: q, style: 'stride', styleT: 1, lean: 0.2, roll: 0, acc: 4 }, m({ speed, forward: speed, accelAlong: 4 }), d185);
        if (prev) for (const i of [0, 1] as const) expect(Math.abs(p.legs[i].footYaw - prev.legs[i].footYaw)).toBeLessThan(0.01);
        prev = p;
      }
    }
    const steady: Motion[] = [
      m({ speed: 9.5, forward: 9.5, accelAlong: 9 }), m({ speed: 9, forward: 9, turnRate: 2, accelAlong: 1 }),
      m({ speed: 7, lateral: 7, accelAlong: 1 }), m({ speed: 7, forward: -7, accelAlong: 3 }), m({ speed: 9, forward: 9 }),
    ];
    for (const d of BODIES) for (const mo of steady) {
      const w = worstMove(() => mo, 60, 3, d);
      expect(w.j, w.at).toBeLessThan(0.06);
    }
  });
});

const frac = (v: number) => v - Math.floor(v);

// ---------------------------------------------------------------------------------------------------------------
// Milestone 2, task 1: the sprint and the stick when carrying the puck.

describe('sprint', () => {
  it('flat-out skating is a sprint, and easing off returns to a stride or glide', () => {
    let g = initialGait();
    for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 8.8, forward: 8.8, accelAlong: 2.5 }), 1 / 60);
    expect(g.style).toBe('sprint');
    for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 5, forward: 5, accelAlong: 0 }), 1 / 60);
    expect(['stride', 'glide']).toContain(g.style);
  });
  it('a moderate stride is not a sprint', () => {
    let g = initialGait();
    for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 5.5, forward: 5.5, accelAlong: 2 }), 1 / 60);
    expect(g.style).toBe('stride');
  });
  it('the sprint leans further forward and looks down more than the stride', () => {
    const d = bodyDims(185, 90);
    const s = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.3 }, m({ speed: 9, forward: 9, accelAlong: 2 }), d);
    const t = poseOf({ ...initialGait(), style: 'stride', styleT: 1, phase: 0.3 }, m({ speed: 6, forward: 6, accelAlong: 2 }), d);
    expect(s.pitch).toBeGreaterThan(t.pitch + 0.08);
    // Milestone 1's `look` is the head's turn (a number); the head's pitch toward the ice is `lookDown`.
    expect(s.lookDown ?? 0).toBeGreaterThan(t.lookDown ?? 0);
  });
  it('with the puck the blade is on the ice in every moving style; sprinting without it the blade is up', () => {
    const d = bodyDims(185, 90);
    for (const style of ['glide', 'stride', 'sprint', 'crossover', 'backward'] as const) {
      const p = poseOf({ ...initialGait(), style, styleT: 1, phase: 0.4 }, m({ speed: 7, forward: 7 }), d, { hasPuck: true });
      expect(p.blade.y).toBeLessThan(0.03);
    }
    const free = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.4 }, m({ speed: 9, forward: 9, accelAlong: 2 }), d);
    expect(free.blade.y).toBeGreaterThan(0.1);
  });

  // Beyond the brief's list.
  it('fast but coasting, or carried along by a shove, is never a sprint', () => {
    let g = initialGait(); const seen = new Set<Style>();
    for (let i = 0; i < 180; i++) { g = stepGait(g, m({ speed: 8, forward: 8 }), 1 / 60); seen.add(g.style); }
    expect(seen.has('sprint')).toBe(false); expect(g.style).toBe('glide');
    for (const hz of RATES) for (const v0 of [6, 8, 9]) for (const dir of [[1, 0], [Math.SQRT1_2, Math.SQRT1_2]] as [number, number][]) {
      const s = new Set<Style>();
      play(shove(v0, dir), hz, 2, (st) => s.add(st.style));
      expect(s.has('sprint'), `v0=${v0} ${hz} Hz saw ${[...s]}`).toBe(false);
    }
  });
  it('a sprint holds while he holds top speed, ends for a glide once he eases off, and a hard brake from it is a stop', () => {
    // Into the sprint: up to 8.5 m/s at an engine-like 8 m/s^2.
    const rush = (t: number): Motion => { const v = Math.min(8.5, 0.5 + 8 * t); return m({ speed: v, forward: v, accelAlong: v < 8.5 ? 8 : 0 }); };
    for (const hz of RATES) {
      const into = (g0 = initialGait()) => { let g = g0; for (let i = 0; i < Math.round(1.5 * hz); i++) g = stepGait(g, rush(i / hz), 1 / hz); return g; };
      let g = into();
      expect(g.style, `${hz} Hz`).toBe('sprint');
      // Holding 8.5 m/s with no acceleration for 3 s: still flat out.
      for (let i = 0; i < 3 * hz; i++) { g = stepGait(g, m({ speed: 8.5, forward: 8.5 }), 1 / hz); expect(g.style, `${hz} Hz hold`).toBe('sprint'); }
      // Easing off as the engine does (no friction: he sheds 1 m/s at 8 m/s^2, then holds the lower speed): a glide
      // within about half a second.
      let left = -1;
      for (let i = 0; i < hz; i++) {
        const t = i / hz, v = Math.max(7.5, 8.5 - 8 * t);
        g = stepGait(g, m({ speed: v, forward: v, accelAlong: v > 7.5 ? -8 : 0 }), 1 / hz);
        if (left < 0 && g.style !== 'sprint') { left = t; expect(g.style).toBe('glide'); }
      }
      expect(left, `${hz} Hz`).toBeGreaterThan(0); expect(left, `${hz} Hz`).toBeLessThan(0.6);
      // A hard brake from the sprint goes to the stop, with nothing between.
      g = into();
      const seen: Style[] = [];
      for (let i = 0; i < hz; i++) { const v = Math.max(1, 8.5 - 9 * (i / hz)); g = stepGait(g, m({ speed: v, forward: v, accelAlong: -9 }), 1 / hz); if (seen[seen.length - 1] !== g.style) seen.push(g.style); }
      expect(seen, `${hz} Hz`).toEqual(['sprint', 'stop']);
    }
  });
  it('the sprint pushes harder: longer pushes, deeper knees and a bigger arm drive than the stride at the same speed', () => {
    const mo = m({ speed: 8.5, forward: 8.5, accelAlong: 3 });
    let sReach = 0, tReach = 0, sArm = 0, tArm = 0;
    for (let ph = 0; ph < 1; ph += 0.01) {
      const s = pose({ style: 'sprint', phase: ph, acc: 3 }, mo), t = pose({ style: 'stride', phase: ph, acc: 3 }, mo);
      sReach = Math.max(sReach, -s.legs[0].foot.x); tReach = Math.max(tReach, -t.legs[0].foot.x);
      sArm = Math.max(sArm, s.arms[0].hand.x); tArm = Math.max(tArm, t.arms[0].hand.x);
      expect(s.hipY).toBeLessThan(t.hipY);
    }
    expect(sReach).toBeGreaterThan(tReach + 0.03);
    expect(sArm).toBeGreaterThan(tArm + 0.03);
  });
  it('blends into and out of the sprint, and in and out of carrying the puck, move nothing more than 6 cm a frame', () => {
    // Accelerate from rest to 9 m/s, hold it under effort, coast, then accelerate again and brake hard.
    const run = (t: number): Motion => {
      if (t < 1.2) return m({ speed: 0.5 + 7.5 * t, forward: 0.5 + 7.5 * t, accelAlong: 7.5 });
      if (t < 2.5) return m({ speed: 9.5, forward: 9.5, accelAlong: 2.5 });
      if (t < 3.5) return m({ speed: 9, forward: 9 });
      if (t < 4.5) return m({ speed: 9, forward: 9, accelAlong: 3 });
      if (t < 4.9) return m({ speed: 9 - 10 * (t - 4.5), forward: 9 - 10 * (t - 4.5), accelAlong: -10 });
      return m({ speed: 5, forward: 5, accelAlong: 4 });
    };
    for (const d of BODIES) for (const hz of RATES) {
      const seen = new Set<Style>();
      let prev: Pose | null = null, worst = 0;
      play(run, hz, 6, (g, p) => { seen.add(g.style); if (prev) worst = Math.max(worst, moved(prev, p) * (hz / 60)); prev = p; }, d);
      expect(seen.has('sprint')).toBe(true);
      expect(worst, `${hz} Hz`).toBeLessThan(0.06);
    }
    // Sprint interrupted mid-blend by a stop, a crossover or a fall.
    const sprint = m({ speed: 9, forward: 9, accelAlong: 3 });
    const scenes: [string, Motion][] = [
      ['stop', m({ speed: 9, forward: 9, accelAlong: -10 })], ['cross', m({ speed: 9, forward: 9, turnRate: 2.2, accelAlong: 1 })],
      ['down', m({ speed: 9, forward: 9, down: true })], ['glide', m({ speed: 9, forward: 9 })],
    ];
    for (const hz of RATES) for (const [name, b] of scenes) for (const k of [0.05, 0.17, 0.4, 0.6]) {
      const w = worstMove((t) => (t < 2.5 ? sprint : t < 2.5 + k ? b : t < 2.5 + k + 0.12 ? sprint : b), hz, 4);
      expect(w.j, `sprint/${name} k=${k} ${hz} Hz ${w.at}`).toBeLessThan(0.06);
    }
    // Picking the puck up and losing it while sprinting: the free hand comes to the stick and the blade down smoothly.
    for (const d of BODIES) for (const hz of RATES) {
      let g = initialGait(), prev: SkaterPose | null = null, worst = 0, last: SkaterPose | null = null;
      for (let i = 0; i < hz * 5; i++) {
        const t = i / hz, carrying = t > 2 && t < 3.5;
        g = stepGait(g, sprint, 1 / hz, carrying);
        const p = poseOf(g, sprint, d, { hasPuck: carrying });
        if (prev) worst = Math.max(worst, moved(prev, p) * (hz / 60), Math.abs(p.blade.y - prev.blade.y) * (hz / 60));
        prev = p;
        if (Math.abs(t - 3.4) < 0.5 / hz) last = p;
      }
      expect(g.style).toBe('sprint');
      expect(last!.blade.y).toBeLessThan(0.03);
      expect(prev!.blade.y).toBeGreaterThan(0.1);
      expect(worst, `${hz} Hz`).toBeLessThan(0.06);
    }
  });
  it('the sprint pelvis rises and falls smoothly through each push, and no foot or hand moves more than 6 cm a frame', () => {
    for (const d of BODIES) for (const speed of [7.5, 9, 10]) {
      let prev: Pose | null = null;
      for (let q = 0; q <= 1.0005; q += 0.001) {
        const p = poseOf({ phase: q, style: 'sprint', styleT: 1, lean: 0.2, roll: 0, acc: 4 }, m({ speed, forward: speed, accelAlong: 4 }), d);
        if (prev) {
          expect(Math.abs(p.hipY - prev.hipY)).toBeLessThan(0.002);
          for (const i of [0, 1] as const) expect(Math.abs(p.legs[i].footYaw - prev.legs[i].footYaw)).toBeLessThan(0.01);
        }
        prev = p;
      }
      for (const puck of [false, true]) {
        let g: GaitState = { ...initialGait(), style: 'sprint', styleT: 1, acc: 4, speed }, p0: Pose | null = null, worst = 0;
        for (let i = 0; i < 180; i++) {
          g = stepGait(g, m({ speed, forward: speed, accelAlong: 4 }), 1 / 60, puck);
          const p = poseOf(g, m({ speed, forward: speed, accelAlong: 4 }), d, { hasPuck: puck });
          if (p0) worst = Math.max(worst, moved(p0, p));
          p0 = p;
        }
        expect(g.style).toBe('sprint');
        expect(worst, `speed ${speed} puck ${puck}`).toBeLessThan(0.06);
      }
    }
  });
});
