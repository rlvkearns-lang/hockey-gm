import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateTeam, type PlayerDef } from '@hockey/engine';
import { bodyDims } from './body';
import { initialGait, poseOf, type Motion } from './gait';
import { goaliePoseOf, initialGoalieGait } from './goalie-pose';
import { createGoalieRig } from './goalie-rig';
import { createRigKit, createSkaterRig } from './rig';

const team = generateTeam(5, 'Test', 'TST');
const goalieBase = team.players.find((p) => p.position === 'G')!;
const skaterBase = team.players.find((p) => p.position === 'LD')!;
const goalieDef = (heightCm: number, weightKg: number, shoots: 'L' | 'R' = 'L'): PlayerDef => ({ ...goalieBase, heightCm, weightKg, shoots });
const skaterDef = (heightCm: number, weightKg: number): PlayerDef => ({ ...skaterBase, heightCm, weightKg, shoots: 'L' });
const standing: Motion = { speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false };
const colors = { jersey: 0xb3202e, trim: 0xffffff, pants: 0x1a1a1a };

const centreOf = (root: THREE.Object3D, name: string): THREE.Vector3 => {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
};

describe('goalie rig', () => {
  it('the goalie figure rests on the ice and is clearly wider than a skater of the same size', () => {
    const g = createGoalieRig(goalieDef(188, 88), colors); g.apply(goaliePoseOf(initialGoalieGait(), bodyDims(188, 88), 'L'), 0, 0, 0); g.root.updateMatrixWorld(true);
    const gb = new THREE.Box3().setFromObject(g.root);
    const s = createSkaterRig(skaterDef(188, 88), colors, createRigKit()); s.apply(poseOf(initialGait(), standing, bodyDims(188, 88)), 0, 0, 0); s.root.updateMatrixWorld(true);
    const sb = new THREE.Box3().setFromObject(s.root);
    expect(gb.min.y).toBeGreaterThan(-0.02); expect(gb.min.y).toBeLessThan(0.05);
    expect(gb.max.z - gb.min.z).toBeGreaterThan((sb.max.z - sb.min.z) * 1.15);
  });

  it('nothing goes through the ice in any pose', () => {
    for (const pose of ['stance', 'butterfly', 'glove', 'blocker', 'pad', 'cover'] as const) for (const side of [1, -1] as const) {
      const g = createGoalieRig(goalieDef(188, 88), colors);
      g.apply(goaliePoseOf({ ...initialGoalieGait(), pose, from: pose, t: 1, side }, bodyDims(188, 88), 'L'), 0, 0, 0);
      g.root.updateMatrixWorld(true);
      expect(new THREE.Box3().setFromObject(g.root).min.y).toBeGreaterThan(-0.02);
      g.dispose();
    }
  });

  it('faces along the engine facing with the glove on his catching side and the mask in front', () => {
    for (const shoots of ['L', 'R'] as const) for (const f of [0, 1.2, Math.PI, -2]) {
      const g = createGoalieRig(goalieDef(188, 88, shoots), colors);
      g.apply(goaliePoseOf(initialGoalieGait(), bodyDims(188, 88), shoots), 3, -2, f);
      g.root.updateMatrixWorld(true);
      const fwd = new THREE.Vector2(Math.cos(f), Math.sin(f)), right = new THREE.Vector2(-Math.sin(f), Math.cos(f));
      const rel = (name: string) => { const c = centreOf(g.root, name); return new THREE.Vector2(c.x - 3, c.z + 2); };
      expect(rel('face').dot(fwd)).toBeGreaterThan(0.05);
      expect(rel('number').dot(fwd)).toBeLessThan(-0.05);
      expect(rel('stickBlade').dot(fwd)).toBeGreaterThan(0.25);
      const glove = rel('catchGlove').dot(right), blocker = rel('blocker').dot(right);
      if (shoots === 'L') { expect(glove).toBeLessThan(-0.2); expect(blocker).toBeGreaterThan(0.1); }
      else { expect(glove).toBeGreaterThan(0.2); expect(blocker).toBeLessThan(-0.1); }
      g.dispose();
    }
  });

  it('shares geometries and materials between the two sides of the figure', () => {
    const g = createGoalieRig(goalieDef(188, 88), colors);
    const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
    let meshes = 0;
    g.root.traverse((o) => { if (o instanceof THREE.Mesh) { meshes++; geos.add(o.geometry); mats.add(o.material as THREE.Material); } });
    expect(geos.size).toBeLessThan(meshes * 0.8);
    expect(mats.size).toBeLessThanOrEqual(12);
    g.dispose();
  });
});
