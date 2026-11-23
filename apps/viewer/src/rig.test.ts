import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateTeam, type PlayerDef } from '@hockey/engine';
import { bodyDims } from './body';
import { initialGait, poseOf, stepGait, type Motion } from './gait';
import { createMarker, createRigKit, createSkaterRig, handedMotion, mirrorPose } from './rig';
import { createGoalieRig } from './goalie-rig';

const base = generateTeam(5, 'Test', 'TST').players.find((p) => p.position === 'LD')!;
const defWith = (heightCm: number, weightKg: number, shoots: 'L' | 'R' = 'L'): PlayerDef => ({ ...base, heightCm, weightKg, shoots });
const standing: Motion = { speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false };
const colors = { jersey: 0xb3202e, trim: 0xffffff, pants: 0x1a1a1a };

/** World (x, z) of a named part's centre. */
function centreOf(root: THREE.Object3D, name: string): THREE.Vector3 {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
}

describe('skater rig', () => {
  it('builds a figure whose skates rest on the ice for small and large players', () => {
    for (const [h, w] of [[165, 70], [185, 90], [200, 110]] as const) {
      const rig = createSkaterRig(defWith(h, w), { jersey: 0xb3202e, trim: 0xffffff, pants: 0x1a1a1a });
      rig.apply(poseOf(initialGait(), standing, bodyDims(h, w)), 0, 0, 0);
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.root);
      expect(box.min.y).toBeGreaterThan(-0.02); expect(box.min.y).toBeLessThan(0.05);
      expect(box.max.y).toBeGreaterThan(h / 100 * 0.9);
    }
  });

  it('a heavier player of the same height is wider', () => {
    const width = (w: number) => { const r = createSkaterRig(defWith(185, w), colors); r.apply(poseOf(initialGait(), standing, bodyDims(185, w)), 0, 0, 0); r.root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(r.root); return b.max.z - b.min.z; };
    expect(width(105)).toBeGreaterThan(width(75));
  });

  it('faces along the engine facing, with the stick on his shooting side, wherever he is', () => {
    for (const shoots of ['L', 'R'] as const) {
      for (const f of [0, 0.7, 2.2, -1.9]) {
        const rig = createSkaterRig(defWith(185, 90, shoots), colors);
        rig.apply(poseOf(initialGait(), standing, bodyDims(185, 90)), 4, -3, f);
        rig.root.updateMatrixWorld(true);
        const fwd = new THREE.Vector2(Math.cos(f), Math.sin(f));
        const right = new THREE.Vector2(-Math.sin(f), Math.cos(f)); // engine (-sin f, cos f) is his right
        const rel = (name: string) => { const c = centreOf(rig.root, name); return new THREE.Vector2(c.x - 4, c.z + 3); };
        const nose = rel('face'), back = rel('number');
        expect(nose.dot(fwd)).toBeGreaterThan(0.05); // the face is in front
        expect(back.dot(fwd)).toBeLessThan(-0.05); // the number is on his back
        const blade = rel('stickBlade');
        expect(blade.dot(fwd)).toBeGreaterThan(0.2);
        if (shoots === 'L') expect(blade.dot(right)).toBeLessThan(-0.1); else expect(blade.dot(right)).toBeGreaterThan(0.1);
        rig.dispose();
      }
    }
  });

  it('a right shot crosses over the same way as a left shot (motion mirrored in, pose mirrored out)', () => {
    // Sideways travel toward his right (+z): the outside (left) skate crosses over in front toward +z for both.
    const motion: Motion = { speed: 4, forward: 0.5, lateral: 4, accelAlong: 0, turnRate: 0, facing: 0, down: false };
    const travel = new Map<string, number>();
    for (const shoots of ['L', 'R'] as const) {
      const def = defWith(185, 90, shoots), d = bodyDims(185, 90);
      let g = initialGait();
      const m = handedMotion(def, motion);
      for (let i = 0; i < 40; i++) g = stepGait(g, m, 1 / 30);
      expect(g.style).toBe('crossover');
      const rig = createSkaterRig(def, colors);
      // Average the skate positions over a cycle: they sit toward the side he travels to... and the hips open that way.
      let zSum = 0;
      for (let i = 0; i < 30; i++) {
        g = stepGait(g, m, 1 / 30);
        rig.apply(poseOf(g, m, d), 0, 0, 0);
        rig.root.updateMatrixWorld(true);
        zSum += centreOf(rig.root, 'skate0').z + centreOf(rig.root, 'skate1').z;
      }
      travel.set(shoots, zSum);
    }
    expect(Math.sign(travel.get('L')!)).toBe(Math.sign(travel.get('R')!));
  });

  it('mirrorPose carries the blade, the head tilt and the grip over to a right shot', () => {
    const d = bodyDims(185, 90);
    const p = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.3 }, { ...standing, speed: 9, forward: 9, accelAlong: 2 }, d);
    const m = mirrorPose(p);
    expect(m.blade).toEqual({ x: p.blade.x, y: p.blade.y, z: -p.blade.z });
    expect(m.lookDown).toBe(p.lookDown);
    expect(m.grip).toBe(p.grip);
  });

  it('draws the blade lifted off the ice when the pose carries it up, and on the ice otherwise', () => {
    const d = bodyDims(185, 90);
    const sprint = { ...standing, speed: 9, forward: 9, accelAlong: 2 };
    for (const shoots of ['L', 'R'] as const) {
      const rig = createSkaterRig(defWith(185, 90, shoots), colors);
      const up = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.3 }, sprint, d);
      expect(up.blade.y).toBeGreaterThan(0.1);
      rig.apply(up, 0, 0, 0); rig.root.updateMatrixWorld(true);
      const lifted = new THREE.Box3().setFromObject(rig.root.getObjectByName('stickBlade')!).min.y;
      expect(lifted).toBeGreaterThan(0.1);
      const down = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.3 }, sprint, d, { hasPuck: true });
      rig.apply(down, 0, 0, 0); rig.root.updateMatrixWorld(true);
      const onIce = new THREE.Box3().setFromObject(rig.root.getObjectByName('stickBlade')!).min.y;
      expect(Math.abs(onIce)).toBeLessThan(0.03);
      // The shaft ends at the blade's heel (no gap between them).
      const heel = new THREE.Vector3(down.blade.x, down.blade.y, shoots === 'R' ? -down.blade.z : down.blade.z);
      const shaft = rig.root.getObjectByName('shaft')!;
      const box = new THREE.Box3().setFromObject(shaft);
      expect(box.distanceToPoint(heel)).toBeLessThan(0.03);
      rig.dispose();
    }
  });

  it('tilts the head down by lookDown', () => {
    const d = bodyDims(185, 90);
    const rig = createSkaterRig(defWith(185, 90), colors);
    const p = poseOf(initialGait(), standing, d);
    const visorY = (lookDown: number): number => { rig.apply({ ...p, lookDown }, 0, 0, 0); rig.root.updateMatrixWorld(true); return centreOf(rig.root, 'face').y; };
    expect(visorY(0.5)).toBeLessThan(visorY(0) - 0.02);
  });

  it('a shared kit gives every figure of a team the same materials and geometries', () => {
    const kit = createRigKit();
    const a = createSkaterRig(defWith(180, 80), colors, kit), b = createSkaterRig(defWith(195, 100, 'R'), colors, kit);
    const c = createSkaterRig(defWith(185, 90), { jersey: 0xf2f3f5, trim: 0x1b4fa0, pants: 0x1c2438 }, kit);
    const g = createGoalieRig({ ...defWith(188, 88), position: 'G' }, colors, kit);
    const h = createGoalieRig({ ...defWith(192, 92), position: 'G' }, colors, kit);
    const get = (r: { root: THREE.Object3D }, n: string) => r.root.getObjectByName(n) as THREE.Mesh;
    // Every skater part is one material (coloured by vertex); the team's colours are in its geometry, one set per team.
    expect(get(a, 'jersey').material).toBe(get(c, 'jersey').material);
    expect(get(a, 'jersey').geometry).toBe(get(b, 'jersey').geometry);
    expect(get(a, 'jersey').geometry).not.toBe(get(c, 'jersey').geometry);
    expect(get(a, 'boot0').geometry).toBe(get(c, 'boot1').geometry);
    expect(get(a, 'thigh0').geometry).toBe(get(b, 'thigh1').geometry);
    expect(get(g, 'jersey').material).toBe(get(h, 'jersey').material);
    // One shadow blob per figure in a shared kit, sharing one material.
    const blobs = (r: { root: THREE.Object3D }) => { const out: THREE.Mesh[] = []; r.root.traverse((o) => { if (o.name === 'shadow') out.push(o as THREE.Mesh); }); return out; };
    expect(blobs(a).length).toBe(1);
    expect(blobs(a)[0]!.material).toBe(blobs(g)[0]!.material);
    a.dispose(); b.dispose(); c.dispose(); g.dispose(); h.dispose(); kit.dispose();
  });

  it('a figure built with a shared kit still rests on the ice and faces the engine facing', () => {
    const kit = createRigKit();
    for (const shoots of ['L', 'R'] as const) {
      const rig = createSkaterRig(defWith(170, 75, shoots), colors, kit);
      rig.apply(poseOf(initialGait(), standing, bodyDims(170, 75)), 2, 1, 1.1);
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.root);
      expect(box.min.y).toBeGreaterThan(-0.02); expect(box.min.y).toBeLessThan(0.05);
      expect(box.max.y).toBeGreaterThan(1.7 * 0.9);
      const fwd = new THREE.Vector2(Math.cos(1.1), Math.sin(1.1));
      const face = centreOf(rig.root, 'face'), back = centreOf(rig.root, 'number');
      expect(new THREE.Vector2(face.x - 2, face.z - 1).dot(fwd)).toBeGreaterThan(0.05);
      expect(new THREE.Vector2(back.x - 2, back.z - 1).dot(fwd)).toBeLessThan(-0.02);
      rig.dispose();
    }
    kit.dispose();
  });

  it('a marker shows its facing with a notch', () => {
    const mk = createMarker(0x1b64d6, 0.4);
    mk.position.set(2, 0, 1);
    mk.rotation.y = -Math.PI / 2; // facing +PI/2 in the engine: toward world +Z
    mk.updateMatrixWorld(true);
    const notch = centreOf(mk, 'notch');
    expect(notch.z - 1).toBeGreaterThan(0.2);
    expect(Math.abs(notch.x - 2)).toBeLessThan(0.05);
  });
});
