import { beforeAll, describe, expect, it } from 'vitest';
import type { GameEventOf, GameSetup } from '@hockey/engine';
import { carryPoint } from './carry';
import type { Playback } from './playback';
import { createGameScene, seekScene } from './scene';
import { sharedPlayback } from './test/game';
import { buildTimeline } from './timeline';

/**
 * The drawn puck while play runs (moved here from scene.test.ts so the two files run side by side). Its continuity over
 * two minutes of play at three display rates is in scene-puck.picture.test.ts (npm run test:picture).
 */
describe('game scene', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); });

  it('a release seen while paused (dt = 0) holds the puck where it was, then slides once play resumes', () => {
    const sc = createGameScene(game);
    // Find a release: a tick where the carrier is gone at the next tick.
    pb.seek(1200);
    let t = 1200;
    for (; t < 20000; t++) { pb.seek(t); const f = pb.frame(); if (f.prev.carrierId !== null && f.next.carrierId === null) break; }
    pb.seek(t - 10); sc.reset(); sc.update(pb.frame(), 0);
    for (let i = 0; i < 20; i++) { pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60); }
    const f = pb.frame();
    expect(f.prev.carrierId !== null && f.next.carrierId === null).toBe(true);
    const before = sc.puckWorld();
    sc.update(pb.frame(), 0); sc.update(pb.frame(), 0);
    expect(sc.puckWorld().distanceTo(before)).toBeLessThan(1e-9);
    pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
    // Next tick (no carrier at either tick): exactly the engine's puck.
    const g = pb.frame();
    if (g.prev.carrierId === null && g.next.carrierId === null) {
      const p = sc.puckWorld();
      expect(p.x).toBeCloseTo(g.prev.puck.pos.x + (g.next.puck.pos.x - g.prev.puck.pos.x) * g.alpha, 9);
    }
    sc.dispose();
  });

  it('the released puck starts from the blade: at the moment the engine lets it go (display time T - 1, the tick before the release event\'s tick T) the drawn puck is within 0.25 m of the releaser blade', () => {
    // Measured one tick before the event's tick, on purpose: the engine lets the puck go during the step that ends on
    // the release event's tick T (in state T it is already a tick of flight from his stick, and from then the drawn puck
    // must be exactly the engine's), so the moment it leaves the stick is display time T - 1, the last moment he has
    // it. There the drawn puck is where it sits on his blade (carry.ts carryPoint), played into at 60 Hz with the log.
    for (const seed of [5, 42]) {
      const { setup, pb: cursor } = sharedPlayback(seed);
      const sc = createGameScene(setup, { timeline: buildTimeline(cursor.events) });
      const right = new Map([...setup.home.players, ...setup.away.players].map((d) => [d.id, d.shoots === 'R']));
      const rels = cursor.events.filter((e): e is GameEventOf<'release'> => e.type === 'release').slice(0, 60);
      let checked = 0, worst = 0, touches = 0;
      for (const rel of rels) {
        // A one-touch redirect: the engine handed him the puck in the tick before he let it go, up to two metres short
        // of his stick (it takes a pass that comes within reach during a tick), so it cannot be on his blade yet; the
        // puck is chased onto the blade (carry.ts CHASE_GAIN) and the stick goes to meet it (overlays/stick.ts).
        cursor.seek(rel.tick - 2);
        if (cursor.frame().prev.carrierId !== rel.playerId) { touches++; continue; }
        const start = rel.tick - 1 - 30;
        seekScene(cursor, sc, start);
        for (let i = 1; i <= 60; i++) { cursor.seek(start + i * 0.5); sc.update(cursor.frame(), 1 / 60); }
        const f = cursor.frame();
        expect(f.tick).toBe(rel.tick - 1); expect(f.alpha).toBe(0);
        // Picked off in the very tick it was let go (the puck goes straight to the man who took it), or across a cut.
        if (f.prev.carrierId !== rel.playerId || f.next.carrierId !== null || sc.cutNow()) continue;
        const fig = sc.figure(rel.playerId!)!, cp = carryPoint(fig.pose!), bz = right.get(rel.playerId!) ? -cp.z : cp.z;
        const c = Math.cos(fig.facing), n = Math.sin(fig.facing);
        const bx = fig.position.x + cp.x * c - bz * n, bzw = fig.position.z + cp.x * n + bz * c;
        const p = sc.puckWorld(), d = Math.hypot(p.x - bx, p.z - bzw);
        worst = Math.max(worst, d);
        expect(d, `seed ${seed} release at ${rel.tick}`).toBeLessThan(0.25);
        checked++;
      }
      sc.dispose();
      expect(checked).toBeGreaterThan(50);
      expect(touches).toBeLessThan(5);
      expect(worst).toBeLessThan(0.25);
    }
  });
});
