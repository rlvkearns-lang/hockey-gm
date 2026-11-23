import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GameSetup } from '@hockey/engine';
import type { Playback } from './playback';
import { createGameScene, seekScene } from './scene';
import { sharedPlayback } from './test/game';

/**
 * Line changes through the scene (moved here from scene.test.ts so the files run side by side). Each test plays the
 * scene only round the line changes the recording has (found from the engine states), not through minutes of play.
 */
describe('game scene', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); });

  /** The first `n` ticks t (before `until`) at which some skater is on the ice at t and off at t + 1 (`off`), or the reverse. */
  function changes(kind: 'off' | 'on', n: number, until = 9000): number[] {
    const out: number[] = [];
    for (let t = 30; t < until && out.length < n; t++) {
      pb.seek(t);
      const f = pb.frame();
      if (f.prev.skaters.some((p, k) => { const q = f.next.skaters[k]!; return kind === 'off' ? p.onIce && !q.onIce : !p.onIce && q.onIce; })) { out.push(t); t += 30; }
    }
    return out;
  }

  it('a skater the engine takes off keeps moving toward the door for his last tick, never skating in place', () => {
    const sc = createGameScene(game);
    let exits = 0;
    for (const t of changes('off', 8)) {
      seekScene(pb, sc, t - 15);
      for (let i = 0; i < 2 * 20; i++) {
        pb.advance(1 / 60);
        const before = new Map<string, THREE.Vector3>();
        for (const s of pb.frame().prev.skaters) before.set(s.id, sc.figure(s.id)!.position.clone());
        sc.update(pb.frame(), 1 / 60);
        const f = pb.frame();
        for (let k = 0; k < f.prev.skaters.length; k++) {
          const p = f.prev.skaters[k]!, n = f.next.skaters.find((x) => x.id === p.id)!;
          if (!p.onIce || n.onIce || f.alpha === 0) continue;
          const speed = Math.hypot(p.vel.x, p.vel.y);
          if (speed < 0.5) continue;
          const moved = sc.figure(p.id)!.position.distanceTo(before.get(p.id)!);
          expect(moved).toBeGreaterThan(speed / 60 * 0.5);
          exits++;
        }
      }
    }
    expect(exits).toBeGreaterThan(3);
    sc.dispose();
  });

  it('a skater stepping on gets a fresh gait, and one who left is hidden', () => {
    const sc = createGameScene(game);
    let ons = 0;
    for (const t of changes('on', 8)) {
      seekScene(pb, sc, t - 15);
      const was = new Map<string, boolean>();
      for (const s of pb.frame().prev.skaters) was.set(s.id, s.onIce);
      for (let i = 0; i < 30; i++) {
        pb.advance(1 / 30); sc.update(pb.frame(), 1 / 30);
        const st = pb.frame().prev;
        for (const s of st.skaters) {
          const f = sc.figure(s.id)!;
          expect(f.onIce).toBe(s.onIce);
          if (s.onIce && was.get(s.id) === false) {
            ons++;
            // Drawn where the engine puts him (at the bench door), not where he was last seen.
            expect(Math.hypot(f.position.x - s.pos.x, f.position.z - s.pos.y)).toBeLessThan(0.5);
          }
          was.set(s.id, s.onIce);
        }
      }
    }
    expect(ons).toBeGreaterThan(5);
    sc.dispose();
  });
});
