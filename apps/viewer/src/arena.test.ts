import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildArena } from './arena';
import { buildRink } from './rink';

describe('arena', () => {
  it('builds stands, one crowd mesh and lights, fewer blocks on low', () => {
    const blocks = (g: THREE.Object3D): number => (g.getObjectByName('crowd')!.userData.blocks as number);
    const hi = buildArena('high'), lo = buildArena('low');
    let crowds = 0, lights = 0;
    hi.traverse((o) => { if (o.name === 'crowd') crowds++; if (o instanceof THREE.Light) lights++; });
    expect(crowds).toBe(1);
    expect(lights).toBeGreaterThan(0);
    expect(blocks(lo)).toBeLessThan(blocks(hi));
    expect(blocks(lo)).toBeGreaterThan(500);
  });

  it('keeps the side opposite the benches low, so a high camera there sees the whole ice', () => {
    const g = buildArena('high');
    g.updateMatrixWorld(true);
    // A camera high on the +z side (the benches are at engine y < 0, world z < 0), looking at the near boards.
    const cam = new THREE.Vector3(0, 16, 34);
    const ray = new THREE.Raycaster();
    const blockers: THREE.Object3D[] = [];
    g.traverse((o) => { if (o instanceof THREE.Mesh && o.name !== 'glass' && o.name !== 'ceiling') blockers.push(o); });
    for (const x of [-25, -12, 0, 12, 25]) {
      const target = new THREE.Vector3(x, 0.1, 12);
      const dir = target.clone().sub(cam);
      const dist = dir.length();
      ray.set(cam, dir.normalize());
      ray.far = dist - 0.5;
      const hits = ray.intersectObjects(blockers, false);
      expect(hits.map((h) => h.object.name)).toEqual([]);
    }
  });
  it('is closed in: from every camera place, every direction meets the building (no view out into nothing)', () => {
    const g = new THREE.Group();
    const rink = buildRink();
    rink.getObjectByName('floor')!.visible = false; // as the scene: the arena lays its own floor
    g.add(buildArena('low'), rink);
    g.updateMatrixWorld(true);
    const solid: THREE.Object3D[] = [];
    g.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && o.name !== 'glass') solid.push(o); });
    const ray = new THREE.Raycaster();
    const places = [new THREE.Vector3(0, 15.5, 29), new THREE.Vector3(18, 15.5, 29), new THREE.Vector3(-30.2, 6, 0), new THREE.Vector3(30.2, 6, -2),
      new THREE.Vector3(6.5, 1.8, 10.75), new THREE.Vector3(-19, 1.8, 10.75), new THREE.Vector3(10, 28, 0.6), new THREE.Vector3(5, 3, -9)];
    let misses = 0;
    for (const from of places) for (let i = 0; i < 24; i++) for (let j = 0; j < 12; j++) {
      const yaw = (i / 24) * 2 * Math.PI, pitch = -1.2 + (j / 11) * 2.4;
      ray.set(from, new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)));
      ray.far = 400;
      if (ray.intersectObjects(solid, false).length === 0) misses++;
    }
    expect(misses).toBe(0);
  });
});
