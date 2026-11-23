import { beforeAll, describe, expect, it } from 'vitest';
import type { GameSetup } from '@hockey/engine';
import type { Playback } from './playback';
import { createGameScene } from './scene';
import { isCut, probeOf } from './cuts';
import { sharedPlayback } from './test/game';

/** The drawn puck while play runs (moved here from scene.test.ts so the two files run side by side). */
describe('game scene', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); });

  /**
   * Play `seconds` from tick 1200 at `hz` and return the per-frame movement of the drawn puck beyond what the engine's
   * puck has done lately (shots fly; a puck picked up at speed is eased onto the blade at about the speed it had),
   * split into frames where a carry ends (the release slide) and the rest, sorted; and whether every frame with no
   * carrier at either tick drew exactly the engine's puck.
   */
  function puckMovement(hz: number, seconds: number): { release: number[]; other: number[]; exact: boolean } {
    const sc = createGameScene(game);
    pb.seek(1200); sc.reset(); sc.update(pb.frame(), 0);
    const last = sc.puckWorld();
    const release: number[] = [], other: number[] = [], speeds: number[] = [];
    let exact = true;
    for (let i = 0; i < hz * seconds; i++) {
      pb.advance(1 / hz); sc.update(pb.frame(), 1 / hz);
      const f = pb.frame(), p = sc.puckWorld();
      speeds.push(Math.hypot(f.next.puck.vel.x, f.next.puck.vel.y), Math.hypot(f.prev.puck.vel.x, f.prev.puck.vel.y));
      if (speeds.length > Math.ceil(hz / 2) * 2) speeds.splice(0, 2);
      const excess = Math.hypot(p.x - last.x, p.z - last.z) - Math.max(...speeds) / hz;
      if (f.next.phase === 'live' && f.prev.phase === 'live') (f.prev.carrierId !== null && f.next.carrierId === null ? release : other).push(excess);
      if (f.prev.carrierId === null && f.next.carrierId === null) {
        // Across a tick the engine cuts in (the puck put on the dot) the engine's puck is its earlier place all tick.
        const k = isCut(probeOf(f.prev), f.next) ? 0 : f.alpha;
        const ex = f.prev.puck.pos.x + (f.next.puck.pos.x - f.prev.puck.pos.x) * k;
        const ez = f.prev.puck.pos.y + (f.next.puck.pos.y - f.prev.puck.pos.y) * k;
        if (Math.abs(p.x - ex) > 1e-9 || Math.abs(p.z - ez) > 1e-9) exact = false;
      }
      last.copy(p);
    }
    sc.dispose();
    const sort = (v: number[]): number[] => v.sort((x, y) => x - y);
    return { release: sort(release), other: sort(other), exact };
  }
  const pct = (v: number[], q: number): number => v[Math.min(v.length - 1, Math.floor(v.length * q))]!;

  it('the drawn puck does not jump while the play runs (carried, released, picked up or won off another skater), at 30, 60 and 144 Hz', () => {
    // A release reaches the engine's puck by the end of its tick, sliding from the previous frame's spot at an even
    // speed: the gap from the blade to where the engine lets the puck go, shared by the frames of one tick.
    for (const [hz, worstRelease, worstOther, p999] of [[30, 0.35, 0.7, 0.6], [60, 0.25, 0.35, 0.27], [144, 0.2, 0.18, 0.15]] as const) {
      const r = puckMovement(hz, 120);
      const all = [...r.release, ...r.other].sort((x, y) => x - y);
      expect(r.exact).toBe(true);
      expect(r.release.length).toBeGreaterThan(20);
      expect(r.release[r.release.length - 1]!, `${hz} Hz release`).toBeLessThan(worstRelease);
      expect(r.other[r.other.length - 1]!, `${hz} Hz other`).toBeLessThan(worstOther);
      expect(pct(all, 0.999), `${hz} Hz 99.9th percentile`).toBeLessThan(p999);
    }
  });

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

});
