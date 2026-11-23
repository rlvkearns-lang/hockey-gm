import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameScene, seekScene } from './scene';
import { sharedPlayback } from './test/game';

/**
 * The picture, pinned. For seeds 5 and 42, 40 seconds of real play from tick 3000 at 60 Hz through scene.update (as
 * the watch page drives it, with the event log): every frame, for every figure drawn (each skater on the ice and both
 * goalies), every transform the rig set (each joint's place, turn and scale, which is everything the pose numbers
 * become: hip height, torso pitch, feet, hands, stick and blade), and the drawn puck, rounded to 1e-6 and hashed.
 *
 * This is the behaviour-preservation check for restructures of the animation code: a change of hash is a change of
 * picture. Find out why rather than updating the constant.
 */

// Re-pinned by Task 2 of milestone 3 (stick actions): the picture changed on purpose (the stick overlays, and the puck
// machine leaving from the blade at the moment the engine lets it go and chasing a pass onto the blade). Before that,
// with only the faceoff crouch and the old carry.ts, these were 5: e21e2fd3cf98651d and 42: 7107aa93e57f2c7d, which
// that code still gives.
// Re-pinned again by Task 2's fix round 1 (the faceoff crouch's stick aim made continuous, the shot types and their
// poses, the carried puck's catch-up speeds): 5: 12657c9df77f0d51 and 42: 01b183534ee12000 before, which the previous
// faceoff.ts, overlays/stick.ts and carry.ts still give.
// Re-pinned by Task 2's fix round 2 (a stick held above the hands in pose-mix.ts fitBody; the slapshot's and the
// one-timer's swings in overlays/stick.ts): 5: 4942b8aaaf7560b6 and 42: 55d09213ba0e0c48 before, which the previous
// pose-mix.ts and overlays/stick.ts still give.
// Re-pinned by Task 3 (saves that reach the puck, the goalie's glove on the hand the engine's glove saves come to, the
// held puck, blocks and goal reactions): 5: 073086cad08ddce8 and 42: d7a3e1ad01ac907f before, which this code still
// gives with the skater overlays block and celebrate, every goalie overlay and GOALIE_CATCHES 'R' taken out.
// Re-pinned by Task 3's fix round 1 (the glove held open at his side in the stance, a light pocket, the held puck at
// the pocket's face, the goalie held facing the shot in dead play, goals he commits to and loses, sticks raised
// overhead in celebration): 5: 0c5debb176ec837d and 42: 4a7c530204679412 before, which 420d200 gives.
const PICTURE_HASH: Record<number, string> = {
  5: '97e20551b0cad32b',
  42: 'eba1ba61baa6f591',
};

/** Two 32-bit FNV-1a lanes over integers. */
function hasher(): { put(v: number): void; hex(): string } {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  return {
    put(v: number) {
      const q = Math.round(v * 1e6); // rounded to 1e-6; |values| stay well inside 2^31 / 1e6
      if (!Number.isFinite(q)) throw new Error('non-finite value in the picture');
      const lo = q | 0, hi = Math.floor(q / 4294967296) | 0;
      a = Math.imul(a ^ lo, 16777619); a = Math.imul(a ^ hi, 16777619);
      b = Math.imul(b ^ lo, 0x5bd1e995); b ^= b >>> 15; b = Math.imul(b ^ hi, 0x5bd1e995); b ^= b >>> 13;
    },
    hex: () => (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'),
  };
}

function pictureHash(seed: number): { hash: string; frames: number; figures: number } {
  const { setup, pb } = sharedPlayback(seed);
  const sc = createGameScene(setup, { events: pb.events });
  const figures = sc.root.getObjectByName('figures')!;
  const puck = sc.root.getObjectByName('puck')!, disc = sc.root.getObjectByName('puckDisc')!;
  const h = hasher();
  const put = (o: THREE.Object3D): void => {
    h.put(o.position.x); h.put(o.position.y); h.put(o.position.z);
    h.put(o.quaternion.x); h.put(o.quaternion.y); h.put(o.quaternion.z); h.put(o.quaternion.w);
    h.put(o.scale.x); h.put(o.scale.y); h.put(o.scale.z);
  };
  seekScene(pb, sc, 3000);
  let frames = 0, drawn = 0;
  for (let i = 0; i < 60 * 40; i++) {
    pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
    for (const fig of figures.children) {
      h.put(fig.visible ? 1 : 0);
      if (!fig.visible) continue;
      drawn++;
      fig.traverse(put);
    }
    put(puck); put(disc);
    const p = sc.puckWorld(); h.put(p.x); h.put(p.y); h.put(p.z);
    h.put(sc.cutNow() ? 1 : 0);
    frames++;
  }
  sc.dispose();
  return { hash: h.hex(), frames, figures: drawn / frames };
}

describe('the picture', () => {
  for (const seed of [5, 42]) {
    it(`is unchanged for seed ${seed}: 40 s of play from tick 3000 at 60 Hz, every figure and the puck`, () => {
      const r = pictureHash(seed);
      expect(r.frames).toBe(2400);
      expect(r.figures).toBeGreaterThan(11); // about ten skaters and both goalies in every frame
      expect(r.hash).toBe(PICTURE_HASH[seed]);
    });
  }
});
