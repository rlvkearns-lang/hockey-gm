import { describe, expect, it } from 'vitest';
import { bodyDims } from './body';
import { carryPoint, stepCarry, stickhandle, type CarryBlend } from './carry';
import { initialGait, poseOf, type Motion, type Style } from './gait';

const m = (p: Partial<Motion>): Motion => ({ speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false, ...p });

describe('carry', () => {
  it('the carry point is ahead of him and on his forehand side', () => {
    const p = poseOf({ ...initialGait(), style: 'glide', styleT: 1 }, m({ speed: 6, forward: 6 }), bodyDims(185, 90), { hasPuck: true });
    const c = carryPoint(p);
    expect(c.x).toBeGreaterThan(0.4); expect(c.x).toBeLessThan(1.2); expect(Math.abs(c.z)).toBeGreaterThan(0.1);
  });
  it('stickhandling is small, smooth and bounded', () => {
    let prev = stickhandle(0, 3);
    for (let t = 1 / 60; t < 4; t += 1 / 60) { const s = stickhandle(t, 3); expect(Math.hypot(s.dx, s.dz)).toBeLessThan(0.18); expect(Math.hypot(s.dx - prev.dx, s.dz - prev.dz)).toBeLessThan(0.03); prev = s; }
  });
  it('the drawn puck eases onto the blade, and back to the engine puck when the carry ends, without a jump', () => {
    let b: CarryBlend = { w: 0, from: { x: 0, z: 0 } }, last = { x: 0, z: 0 }, worst = 0;
    const step = (carried: boolean, eng: { x: number; z: number }, blade: { x: number; z: number }) => { const r = stepCarry(b, carried, eng, blade, 1 / 60); worst = Math.max(worst, Math.hypot(r.drawn.x - last.x, r.drawn.z - last.z)); b = r.blend; last = r.drawn; return r.drawn; };
    for (let i = 0; i < 30; i++) step(true, { x: 0, z: 0 }, { x: 0.8, z: 0.3 });
    expect(Math.hypot(last.x - 0.8, last.z - 0.3)).toBeLessThan(0.01);
    for (let i = 0; i < 12; i++) step(false, { x: 0.1, z: 0 }, { x: 0.8, z: 0.3 });
    expect(last).toEqual({ x: 0.1, z: 0 });
    expect(worst).toBeLessThan(0.2);
  });

  // Beyond the brief's list.
  it('the carry point is on the blade, in every moving style, at every phase', () => {
    for (const d of [bodyDims(165, 70), bodyDims(200, 110)]) for (const style of ['glide', 'stride', 'sprint', 'crossover', 'backward', 'stop', 'stand'] as Style[]) for (let ph = 0; ph < 1; ph += 0.1) {
      const p = poseOf({ ...initialGait(), style, styleT: 1, phase: ph }, m({ speed: 7, forward: 7, accelAlong: 2 }), d, { hasPuck: true });
      const c = carryPoint(p);
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
      // Within a blade's length of the heel, and ahead of him on his forehand (left) side.
      expect(Math.hypot(c.x - p.blade.x, c.z - p.blade.z)).toBeLessThan(0.3);
      expect(c.x).toBeGreaterThan(0.3); expect(c.z).toBeLessThan(0);
    }
  });
  it('the timing: on the blade within 0.15 s, back on the engine puck within 0.1 s, and the engine puck exactly when not carried', () => {
    for (const hz of [30, 60, 144]) {
      let b: CarryBlend = { w: 0, from: { x: 0, z: 0 } };
      const eng = { x: 3, z: -2 }, blade = { x: 3.7, z: -1.6 };
      // Not carried: exactly the engine puck, whatever the blade does.
      let r = stepCarry(b, false, eng, blade, 1 / hz); expect(r.drawn).toEqual(eng); b = r.blend;
      for (let t = 0; t < 0.15 - 1e-9; t += 1 / hz) { r = stepCarry(b, true, eng, blade, 1 / hz); b = r.blend; }
      expect(r.drawn).toEqual(blade);
      // A moving blade is followed exactly once the blend is done.
      r = stepCarry(b, true, eng, { x: 4, z: -1 }, 1 / hz); b = r.blend; expect(r.drawn).toEqual({ x: 4, z: -1 });
      for (let t = 0; t < 0.1 - 1e-9; t += 1 / hz) { r = stepCarry(b, false, { x: 4.5, z: -1 }, blade, 1 / hz); b = r.blend; }
      expect(r.drawn).toEqual({ x: 4.5, z: -1 });
      expect(b.w).toBe(0);
    }
  });
  it('changes of carry part way through an ease turn it round where it is, and bad input does not poison it', () => {
    const eng = { x: 2, z: 1 }, blade = { x: 2.5, z: 1.35 }; // about as far apart as the engine's reach and the blade
    let b: CarryBlend = { w: 0, from: eng }, last = eng, worst = 0;
    const seq: [boolean, number][] = [[true, 3], [false, 2], [true, 5], [false, 1], [true, 20], [false, 3], [true, 1], [false, 20]];
    for (const [carried, n] of seq) for (let i = 0; i < n; i++) {
      const r = stepCarry(b, carried, eng, blade, 1 / 60);
      worst = Math.max(worst, Math.hypot(r.drawn.x - last.x, r.drawn.z - last.z));
      expect(r.blend.from).toEqual(r.drawn);
      b = r.blend; last = r.drawn;
    }
    expect(last).toEqual(eng);
    expect(worst).toBeLessThan(0.2);
    const r = stepCarry({ w: NaN, from: { x: NaN, z: 0 } }, true, { x: 1, z: 1 }, { x: 2, z: 2 }, NaN);
    expect(Number.isFinite(r.drawn.x + r.drawn.z + r.blend.w)).toBe(true);
  });
  it('stickhandling slows and narrows as he speeds up, and is still at a sprint', () => {
    // How wide it goes, how often it turns, and how far the blade travels in 4 s.
    const span = (speed: number) => {
      let lo = Infinity, hi = -Infinity, turns = 0, path = 0, prev = stickhandle(0, speed);
      for (let t = 1 / 60; t < 4; t += 1 / 60) {
        const s = stickhandle(t, speed);
        lo = Math.min(lo, s.dz); hi = Math.max(hi, s.dz); path += Math.hypot(s.dx - prev.dx, s.dz - prev.dz);
        if (Math.sign(s.dz) !== Math.sign(prev.dz) && prev.dz !== 0) turns++;
        prev = s;
      }
      return { w: hi - lo, turns, path };
    };
    const slow = span(1), mid = span(5), fast = span(9);
    expect(slow.turns).toBeGreaterThan(fast.turns); expect(slow.path).toBeGreaterThan(mid.path); expect(mid.path).toBeGreaterThan(fast.path);
    expect(slow.w).toBeGreaterThan(fast.w);
    for (const sp of [0, 3, 6, 9, 12]) for (let t = 0; t < 4; t += 0.01) { const s = stickhandle(t, sp); expect(Math.hypot(s.dx, s.dz)).toBeLessThan(0.18); }
    // The stickhandle moves the blade, and the carry point with it.
    const d = bodyDims(185, 90), g = { ...initialGait(), style: 'glide' as const, styleT: 1 };
    const a = carryPoint(poseOf(g, m({ speed: 4, forward: 4 }), d, { hasPuck: true }));
    const c = carryPoint(poseOf(g, m({ speed: 4, forward: 4 }), d, { hasPuck: true, handle: { dx: 0, dz: 0.12 } }));
    expect(c.z - a.z).toBeGreaterThan(0.06);
  });
});
