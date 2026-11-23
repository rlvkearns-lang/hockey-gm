import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateTeam, type PlayerDef } from '@hockey/engine';
import { bodyDims } from './body';
import { initialGait, poseOf, stepGait, type Motion } from './gait';
import { createMarker, createSkaterRig, handedMotion } from './rig';

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
