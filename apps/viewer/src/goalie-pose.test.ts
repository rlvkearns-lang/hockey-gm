import { describe, expect, it } from 'vitest';
import type { GoaliePose, GoalieState } from '@hockey/engine';
import { bodyDims } from './body';
import { goalieMotion, goaliePoseOf, initialGoalieGait, stepGoalie, type GoalieGait } from './goalie-pose';

const POSES = ['stance', 'butterfly', 'glove', 'blocker', 'pad', 'cover'] as const;

describe('goalie pose', () => {
  it('eases into a save and back to the stance, with no jump', () => {
    let g = initialGoalieGait(); const d = bodyDims(188, 88); let last = goaliePoseOf(g, d, 'L').hipY, worst = 0;
    const run = (pose: GoaliePose, poseT: number, n: number) => { for (let i = 0; i < n; i++) { g = stepGoalie(g, { pose, poseT, lateral: 0, speed: 0 }, 1 / 60); const h = goaliePoseOf(g, d, 'L').hipY; worst = Math.max(worst, Math.abs(h - last)); last = h; } };
    run('butterfly', 0.5, 30); const down = last; run('stance', 0, 40);
    expect(down).toBeLessThan(goaliePoseOf(initialGoalieGait(), d, 'L').hipY - 0.2);
    expect(last).toBeCloseTo(goaliePoseOf(initialGoalieGait(), d, 'L').hipY, 2);
    expect(worst).toBeLessThan(0.06);
  });

  it('the butterfly puts both knees on the ice with the pads flared', () => {
    const p = goaliePoseOf({ ...initialGoalieGait(), pose: 'butterfly', from: 'butterfly', t: 1 }, bodyDims(188, 88), 'L');
    for (const l of p.legs) expect(l.knee.y).toBeLessThan(0.12);
    expect(Math.abs(p.legs[0].foot.z - p.legs[1].foot.z)).toBeGreaterThan(0.9);
  });

  it('a glove save reaches to the catching side, mirrored for the other hand', () => {
    const at = (c: 'L' | 'R') => goaliePoseOf({ ...initialGoalieGait(), pose: 'glove', from: 'glove', t: 1 }, bodyDims(188, 88), c).glove;
    expect(at('L').z).toBeLessThan(-0.5); expect(at('R').z).toBeGreaterThan(0.5); expect(at('L').y).toBeGreaterThan(0.6);
  });

  it('no pose produces NaN or puts a pad below the ice', () => {
    for (const pose of ['stance', 'butterfly', 'glove', 'blocker', 'pad', 'cover'] as const) for (let t = 0; t <= 1; t += 0.1) {
      const p = goaliePoseOf({ ...initialGoalieGait(), pose, from: 'stance', t }, bodyDims(188, 88), 'L');
      expect(Number.isFinite(p.hipY)).toBe(true); for (const l of p.legs) { expect(l.foot.y).toBeGreaterThanOrEqual(0); expect(l.knee.y).toBeGreaterThanOrEqual(0); }
    }
  });

  it('every pose keeps the limbs their own length and the hands within reach, for small and big goalies', () => {
    for (const [h, w] of [[178, 76], [188, 88], [198, 102]] as const) {
      const d = bodyDims(h, w);
      for (const c of ['L', 'R'] as const) for (const pose of POSES) for (const side of [1, -1] as const) {
        const p = goaliePoseOf({ ...initialGoalieGait(), pose, from: pose, t: 1, side }, d, c);
        for (const l of p.legs) {
          expect(Math.hypot(l.knee.x - l.hip.x, l.knee.y - l.hip.y, l.knee.z - l.hip.z)).toBeCloseTo(d.thigh, 2);
          expect(Math.hypot(l.ankle.x - l.knee.x, l.ankle.y - l.knee.y, l.ankle.z - l.knee.z)).toBeCloseTo(d.shin, 2);
        }
        const reach = d.upperArm + d.forearm;
        const gi = c === 'L' ? 0 : 1, bi = c === 'L' ? 1 : 0;
        const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        expect(dist(p.glove, p.shoulders[gi])).toBeLessThan(reach + 0.01);
        expect(dist(p.blocker, p.shoulders[bi])).toBeLessThan(reach + 0.01);
        // The blocker hand holds the stick above its paddle, whatever the pose.
        expect(dist(p.blocker, p.blade.heel)).toBeGreaterThan(0.45);
        expect(p.blade.heel.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('stance, glove and blocker keep both skates on the ice; the stick blade is on the ice in the stance', () => {
    const d = bodyDims(188, 88);
    for (const pose of ['stance', 'glove', 'blocker'] as const) {
      const p = goaliePoseOf({ ...initialGoalieGait(), pose, from: pose, t: 1 }, d, 'L');
      for (const l of p.legs) expect(l.foot.y).toBeLessThan(0.01);
    }
    const s = goaliePoseOf(initialGoalieGait(), d, 'L');
    expect(s.blade.heel.y).toBeLessThan(0.01);
    expect(s.blade.heel.x).toBeGreaterThan(0.3); // in front of him
    // Pads together-ish at the knees, skates wider.
    const kneeGap = Math.abs(s.legs[1].knee.z - s.legs[0].knee.z), footGap = Math.abs(s.legs[1].foot.z - s.legs[0].foot.z);
    expect(kneeGap).toBeLessThan(footGap);
    expect(s.glove.z).toBeLessThan(-0.3); // glove out on the catching side
    expect(s.blocker.z).toBeGreaterThan(0.15);
  });

  it('a blocker save reaches to the blocker side; a pad save kicks the pad to the side of the puck', () => {
    const d = bodyDims(188, 88);
    const b = goaliePoseOf({ ...initialGoalieGait(), pose: 'blocker', from: 'blocker', t: 1 }, d, 'L');
    expect(b.blocker.z).toBeGreaterThan(0.5);
    for (const side of [1, -1] as const) {
      const p = goaliePoseOf({ ...initialGoalieGait(), pose: 'pad', from: 'pad', t: 1, side }, d, 'L');
      const out = p.legs[side > 0 ? 1 : 0], other = p.legs[side > 0 ? 0 : 1];
      expect(out.foot.z * side).toBeGreaterThan(0.8);
      expect(other.knee.y).toBeLessThan(0.15);
    }
    // Stepping into a pad save while moving toward a side, or told the puck's side, picks that pad.
    let g = initialGoalieGait();
    g = stepGoalie(g, { pose: 'pad', poseT: 0.6, lateral: 0, speed: 0, side: -1 }, 1 / 60);
    expect(g.side).toBe(-1);
    g = initialGoalieGait();
    g = stepGoalie(g, { pose: 'pad', poseT: 0.6, lateral: 1.2, speed: 1.2 }, 1 / 60);
    expect(g.side).toBe(1);
  });

  it('the cover is down over the puck, glove on the ice in front', () => {
    const p = goaliePoseOf({ ...initialGoalieGait(), pose: 'cover', from: 'cover', t: 1 }, bodyDims(188, 88), 'L');
    expect(p.glove.y).toBeLessThan(0.15);
    expect(p.glove.x).toBeGreaterThan(0.5);
    expect(p.pitch).toBeGreaterThan(0.9);
  });

  it('moving sideways in the stance shuffles the pads (small lifts), not a stride, and settles when he stops', () => {
    const d = bodyDims(188, 88);
    let g = initialGoalieGait(), maxLift = 0, worst = 0;
    let prev = goaliePoseOf(g, d, 'L');
    for (let i = 0; i < 90; i++) {
      g = stepGoalie(g, { pose: 'stance', poseT: 0, lateral: 2, speed: 2 }, 1 / 60);
      const p = goaliePoseOf(g, d, 'L');
      for (const j of [0, 1] as const) {
        maxLift = Math.max(maxLift, p.legs[j].foot.y);
        worst = Math.max(worst, Math.hypot(p.legs[j].foot.x - prev.legs[j].foot.x, p.legs[j].foot.y - prev.legs[j].foot.y, p.legs[j].foot.z - prev.legs[j].foot.z));
      }
      // The pads stay roughly under him: never a skating stride out behind.
      for (const l of p.legs) expect(Math.abs(l.foot.x)).toBeLessThan(0.3);
      prev = p;
    }
    expect(g.shuffle).toBeGreaterThan(1);
    expect(maxLift).toBeGreaterThan(0.01); expect(maxLift).toBeLessThan(0.08);
    expect(worst).toBeLessThan(0.06);
    for (let i = 0; i < 60; i++) g = stepGoalie(g, { pose: 'stance', poseT: 0, lateral: 0, speed: 0 }, 1 / 60);
    const still = goaliePoseOf(g, d, 'L'), rest = goaliePoseOf(initialGoalieGait(), d, 'L');
    for (const j of [0, 1] as const) { expect(still.legs[j].foot.y).toBeLessThan(0.005); expect(still.legs[j].foot.z).toBeCloseTo(rest.legs[j].foot.z, 1); }
  });

  it('a save interrupted mid-blend by another pose does not jump', () => {
    const d = bodyDims(188, 88);
    let g: GoalieGait = initialGoalieGait(), worst = 0, last = goaliePoseOf(g, d, 'L');
    const seq: [GoaliePose, number][] = [['butterfly', 4], ['cover', 3], ['stance', 5], ['glove', 2], ['pad', 20], ['stance', 30]];
    for (const [pose, n] of seq) for (let i = 0; i < n; i++) {
      g = stepGoalie(g, { pose, poseT: pose === 'stance' ? 0 : 0.5, lateral: 0, speed: 0 }, 1 / 60);
      const p = goaliePoseOf(g, d, 'L');
      worst = Math.max(worst, Math.abs(p.hipY - last.hipY), Math.hypot(p.glove.x - last.glove.x, p.glove.y - last.glove.y, p.glove.z - last.glove.z) / 3);
      last = p;
    }
    expect(worst).toBeLessThan(0.06);
  });

  it('reads the save pose, poseT and sideways speed from a goalie state', () => {
    const s: GoalieState = { id: 'g', pos: { x: -27, y: 0 }, vel: { x: 0, y: 2 }, facing: 0, pose: 'glove', poseT: 0.3 };
    const m = goalieMotion(s);
    expect(m.pose).toBe('glove'); expect(m.poseT).toBe(0.3);
    expect(m.lateral).toBeCloseTo(2); expect(m.speed).toBeCloseTo(2);
    expect(goalieMotion({ ...s, facing: Math.PI }).lateral).toBeCloseTo(-2);
  });
});
