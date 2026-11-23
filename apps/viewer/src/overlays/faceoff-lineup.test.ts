import { describe, expect, it } from 'vitest';
import { DT, type GameState, type SkaterState } from '@hockey/engine';
import { lerpAngle } from '../playback';
import { createGameScene, seekScene } from '../scene';
import { sharedPlayback } from '../test/game';

/**
 * Faceoffs line up: through the scene (as the watch page draws them), at the last tick of each of the first 20 faceoff
 * setups of seeds 5 and 42 (each reached by a seek, played in), and then through the drop.
 */

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r: number): number => (Math.abs(r) * 180) / Math.PI;
/** How far from his own place (m) a centre's blade can reach the dot: arm and stick, bent low. */
const REACH = 1.6;
/** The centres whose blade is not by the dot at the drop, by seed (see the test). */
const SKIPPED: Record<number, { far: number; offTheDraw: number }> = { 5: { far: 1, offTheDraw: 0 }, 42: { far: 0, offTheDraw: 1 } };

describe('faceoff line-up', () => {
  for (const seed of [5, 42]) {
    it(`seed ${seed}: centres square to each other with blades by the dot, wingers and defencemen facing the dot; after the drop the drawn facing is the engine's`, () => {
      const { setup, pb } = sharedPlayback(seed);
      const sc = createGameScene(setup, { events: pb.events });
      const defs = new Map([...setup.home.players, ...setup.away.players].map((d) => [d.id, d]));
      const faceoffs = pb.events.filter((e) => e.type === 'faceoff').slice(0, 20);
      expect(faceoffs.length).toBe(20);
      let checkedWD = 0, liveFrames = 0, turnedMuch = 0, farCentres = 0, offTheDraw = 0;
      const skipped: string[] = [];
      /** His blade heel in the world, as drawn. */
      const bladeOf = (id: string): { x: number; z: number } => {
        const v = sc.figure(id)!, p = v.pose!, bz = defs.get(id)!.shoots === 'R' ? -p.blade.z : p.blade.z;
        return { x: v.position.x + p.blade.x * Math.cos(v.facing) - bz * Math.sin(v.facing), z: v.position.z + p.blade.x * Math.sin(v.facing) + bz * Math.cos(v.facing) };
      };
      for (const fo of faceoffs) {
        // A centre who shoots straight off the draw: 0.2 s before the drop his blade is still by the dot (his wind-up,
        // overlays/stick.ts, starts after that).
        const shooters = new Set(pb.events.filter((e) => e.type === 'release' && e.tick > fo.tick && e.tick <= fo.tick + 15).map((e) => e.playerId));
        const early = new Map<string, number>();
        if (shooters.size) {
          seekScene(pb, sc, fo.tick - 6);
          const st0 = pb.frame().prev;
          for (const c of st0.skaters) if (c.onIce && c.slot === 'C' && shooters.has(c.id)) { const b = bladeOf(c.id); early.set(c.id, Math.hypot(b.x - st0.faceoffSpot.x, b.z - st0.faceoffSpot.y)); }
        }
        seekScene(pb, sc, fo.tick - 1);
        const st = pb.frame().prev;
        expect(st.phase, `${seed} faceoff ${fo.tick}`).toBe('faceoffSetup');
        const spot = st.faceoffSpot;
        const on = st.skaters.filter((s) => s.onIce && s.slot !== null);
        const view = (s: SkaterState) => sc.figure(s.id)!;
        const centres = on.filter((s) => s.slot === 'C');
        expect(centres.length).toBe(2);
        for (const c of centres) {
          const o = centres.find((x) => x !== c)!, v = view(c), ov = view(o);
          const at = Math.atan2(ov.position.z - v.position.z, ov.position.x - v.position.x);
          expect(deg(wrap(v.facing - at)), `${seed} ${fo.tick} centre ${c.id} square to the other`).toBeLessThan(20);

          // His blade (the heel, world) by the dot.
          const p = v.pose!, right = defs.get(c.id)!.shoots === 'R', bz = right ? -p.blade.z : p.blade.z;
          const bx = v.position.x + p.blade.x * Math.cos(v.facing) - bz * Math.sin(v.facing);
          const by = v.position.z + p.blade.x * Math.sin(v.facing) + bz * Math.cos(v.facing);
          // Two cases where his blade cannot be by the dot at the drop, each checked otherwise and counted exactly:
          // - the engine left him further from the dot than his stick reaches (the drop came at the setup's time limit
          //   with him still on his way, which no drawn offset of 0.35 m could make up): drawn at his engine place,
          //   turned toward the dot, the blade out along the line to the dot at full reach;
          // - he shoots straight off the draw (his wind-up shows before the drop): drawn at his engine place, turned
          //   toward the dot, the blade by the dot until 0.2 s before the drop.
          const blade = Math.hypot(bx - spot.x, by - spot.y);
          if (blade >= 0.6) {
            const label = `${seed} faceoff ${fo.tick} centre ${c.id}`;
            const toDot = Math.atan2(spot.y - v.position.z, spot.x - v.position.x);
            expect(Math.hypot(v.position.x - c.pos.x, v.position.z - c.pos.y), `${label}: drawn at his engine place`).toBeLessThan(0.35);
            expect(deg(wrap(v.facing - toDot)), `${label}: turned toward the dot`).toBeLessThan(20);
            if (early.has(c.id)) {
              expect(early.get(c.id)!, `${label}: shoots off the draw; blade by the dot 0.2 s before`).toBeLessThan(0.6);
              offTheDraw++; skipped.push(`${label} (shoots off the draw, blade ${blade.toFixed(2)} m at the drop)`);
            } else {
              const far = Math.hypot(c.pos.x - spot.x, c.pos.y - spot.y);
              expect(far, `${label}: blade ${blade.toFixed(2)} m from the dot`).toBeGreaterThanOrEqual(REACH);
              const out = Math.hypot(bx - v.position.x, by - v.position.z);
              expect(deg(wrap(Math.atan2(by - v.position.z, bx - v.position.x) - toDot)), `${label}: blade toward the dot`).toBeLessThan(20);
              expect(out, `${label}: blade at full reach`).toBeGreaterThan(1.2);
              farCentres++; skipped.push(`${label} (${far.toFixed(2)} m from the dot)`);
            }
          }
          // Low: in the crouch (hips well below his standing height).
          expect(p.hipY, `${seed} ${fo.tick} centre ${c.id} low`).toBeLessThan(defs.get(c.id)!.heightCm / 100 * 0.5);
          if (deg(wrap(c.facing - at)) > 30) turnedMuch++;
        }
        for (const s of on.filter((x) => x.slot !== 'C')) {
          const v = view(s);
          const at = Math.atan2(spot.y - v.position.z, spot.x - v.position.x);
          expect(deg(wrap(v.facing - at)), `${seed} ${fo.tick} ${s.slot} ${s.id} facing the dot`).toBeLessThan(30);
          checkedWD++;
        }
        // Play on through the drop: from 0.4 s after it every drawn facing is the engine's (blended between the ticks).
        for (let i = 0; i < 60 * 1.2; i++) {
          pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
          const f = pb.frame();
          if ((f.tick + f.alpha - fo.tick) * DT < 0.4) continue;
          liveFrames++;
          for (const s of f.prev.skaters) {
            if (!s.onIce) continue;
            const n = f.next.skaters.find((x) => x.id === s.id)!;
            const engine = n.onIce ? lerpAngle(s.facing, n.facing, f.alpha) : s.facing;
            expect(Math.abs(sc.figure(s.id)!.facing - engine), `${seed} ${fo.tick} +${f.tick - fo.tick} ${s.id}`).toBeLessThan(1e-9);
          }
        }
      }
      expect(checkedWD).toBeGreaterThan(20 * 6);
      expect(liveFrames).toBeGreaterThan(20 * 40);
      // The engine's own facing was far off for many of these (the turn did real work).
      expect(turnedMuch).toBeGreaterThan(5);
      // The counts measured today (seed 5: one centre 3.02 m from the dot at a timed-out drop; seed 42: one centre who
      // shoots off the draw): a change either way fails, naming them.
      expect({ far: farCentres, offTheDraw }, skipped.join('; ')).toEqual(SKIPPED[seed]);
      sc.dispose();
    });
  }

  it('in live play the drawn facing is exactly the engine\'s (20 s of play)', () => {
    const { setup, pb } = sharedPlayback(5);
    const sc = createGameScene(setup, { events: pb.events });
    seekScene(pb, sc, 6000);
    let n = 0;
    for (let i = 0; i < 60 * 20; i++) {
      pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60);
      const f = pb.frame();
      const live = (s: GameState): boolean => s.phase === 'live';
      if (!live(f.prev) || !live(f.next)) continue;
      for (const s of f.prev.skaters) {
        if (!s.onIce) continue;
        const nx = f.next.skaters.find((x) => x.id === s.id)!;
        if (!nx.onIce) continue;
        expect(sc.figure(s.id)!.facing).toBe(lerpAngle(s.facing, nx.facing, f.alpha));
        n++;
      }
    }
    expect(n).toBeGreaterThan(5000);
    sc.dispose();
  });
});
