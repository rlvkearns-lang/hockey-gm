import { beforeAll, describe, expect, it } from 'vitest';
import type { GameEvent, GameSetup } from '@hockey/engine';
import type { Playback } from './playback';
import { createGameScene } from './scene';
import { isCut, probeOf } from './cuts';
import { sharedPlayback } from './test/game';
import { buildTimeline, lastSinceDrop } from './timeline';

/** The drawn puck's continuity while play runs (npm run test:picture; moved from scene-puck.test.ts). */
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
  function puckMovement(hz: number, seconds: number, events?: readonly GameEvent[]): { release: number[]; other: number[]; exact: boolean } {
    const sc = createGameScene(game, events ? { events } : {});
    const tl = events ? buildTimeline(events) : null;
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
      // (Except in the stopped play after a goal, before the next faceoff, where the puck is drawn eased into the net: a
      // ruled exception, Task 6 fix round 1, tested in puck-marker.test.ts.)
      const afterGoal = f.prev.phase === 'stopped' && tl !== null && lastSinceDrop(tl, 'goal', f.prev.tick) !== undefined;
      if (f.prev.carrierId === null && f.next.carrierId === null && !afterGoal) {
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

  it('the drawn puck does not jump while the play runs (carried, released, picked up or won off another skater), with the stick actions on, at 30, 60 and 144 Hz', () => {
    // A release reaches the engine's puck by the end of its tick, sliding from the previous frame's spot at an even
    // speed: the gap from the blade to where the engine lets the puck go, shared by the frames of one tick.
    // (With the game's event timeline, as the page draws it: two minutes at 60 Hz, 30 s at 30 and 144 Hz.)
    for (const [hz, seconds, worstRelease, worstOther, p999] of [[30, 30, 0.35, 0.7, 0.6], [60, 120, 0.25, 0.35, 0.27], [144, 30, 0.2, 0.18, 0.15]] as const) {
      const r = puckMovement(hz, seconds, pb.events);
      const all = [...r.release, ...r.other].sort((x, y) => x - y);
      expect(r.exact).toBe(true);
      // (At least 20 releases in two minutes: in proportion, 5 in 30 s.)
      expect(r.release.length).toBeGreaterThan(seconds === 120 ? 20 : 5);
      expect(r.release[r.release.length - 1]!, `${hz} Hz release`).toBeLessThan(worstRelease);
      expect(r.other[r.other.length - 1]!, `${hz} Hz other`).toBeLessThan(worstOther);
      expect(pct(all, 0.999), `${hz} Hz 99.9th percentile`).toBeLessThan(p999);
    }
  });
});
