import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GameSetup, GameState } from '@hockey/engine';
import { bodyDims } from './body';
import { carryPoint } from './carry';
import { initialGait, poseOf, type Pose } from './gait';
import type { Playback } from './playback';
import { createGameScene, PREROLL_SECONDS, seekScene, type GameScene } from './scene';
import { sharedPlayback } from './test/game';

/**
 * Seeks show the pose each figure would have had if play had reached that moment (the pre-roll); engine cuts are
 * drawn as cuts. The seek sweep against play and the real-game continuity bound through the scene are in
 * scene-seek.picture.test.ts (npm run test:picture).
 */

const still = { speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false };
const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** The largest move of a foot, a hand or the hip between two poses (body frame, m). */
function moved(a: Pose, b: Pose): number {
  let j = Math.abs(a.hipY - b.hipY);
  for (const i of [0, 1] as const) j = Math.max(j, dist3(a.legs[i].foot, b.legs[i].foot), dist3(a.arms[i].hand, b.arms[i].hand));
  return j;
}

describe('seeking shows the moment as play would have', () => {
  let pb: Playback;
  let game: GameSetup;
  let sc: GameScene;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); sc = createGameScene(game); });

  /** First tick from `from` (in steps of `step`) where `pick` finds something. */
  function find<T>(from: number, step: number, pick: (s: GameState, t: number) => T | null): { t: number; v: T } {
    for (let t = from; t < pb.totalTicks; t += step) {
      pb.seek(t);
      const v = pick(pb.frame().prev, t);
      if (v !== null) return { t, v };
    }
    throw new Error('not found');
  }

  it('after a seek to a man who has been down a while, he is drawn down (hip low), not standing', () => {
    // A skater who is down with more than 1.2 s of it left, shown a second later (still down).
    const fall = find(2000, 5, (s) => {
      const k = s.skaters.find((x) => x.onIce && x.downT > 1.2);
      return k ? k.id : null;
    });
    const t = fall.t + 30;
    seekScene(pb, sc, t);
    const st = pb.frame().prev;
    const k = st.skaters.find((x) => x.id === fall.v)!;
    expect(k.downT).toBeGreaterThan(0);
    const f = sc.figure(fall.v)!;
    expect(f.onIce).toBe(true);
    const standHip = poseOf(initialGait(), still, bodyDims(185, 90)).hipY;
    expect(standHip).toBeGreaterThan(0.75);
    expect(f.hipY).toBeLessThan(0.5);
  });

  it('after a seek into a rush, the carrier is skating (not the standing pose) and the puck is on his blade', () => {
    const rush = find(2000, 7, (s) => {
      if (s.phase !== 'live' || !s.carrierId) return null;
      const c = s.skaters.find((x) => x.id === s.carrierId)!;
      return Math.hypot(c.vel.x, c.vel.y) > 7 ? c.id : null;
    });
    // He must have had it for the whole pre-roll, so the carry has settled on the blade.
    let t = rush.t;
    for (let back = 1; back < PREROLL_SECONDS * 30; back++) { pb.seek(t - back); if (pb.frame().prev.carrierId !== rush.v) { t = -1; break; } }
    if (t < 0) {
      const again = find(rush.t + 30, 7, (s) => {
        if (s.phase !== 'live' || !s.carrierId) return null;
        const c = s.skaters.find((x) => x.id === s.carrierId)!;
        return Math.hypot(c.vel.x, c.vel.y) > 7 ? c.id : null;
      });
      t = again.t; rush.v = again.v;
    }
    seekScene(pb, sc, t);
    const f = sc.figure(rush.v)!;
    const def = [...game.home.players, ...game.away.players].find((p) => p.id === rush.v)!;
    const stand = poseOf(initialGait(), still, bodyDims(def.heightCm, def.weightKg));
    expect(moved(stand, f.pose!)).toBeGreaterThan(0.1);
    // The puck is drawn on his blade (the carry point of the pose drawn, in the world).
    const cp = carryPoint(f.pose!), bz = def.shoots === 'R' ? -cp.z : cp.z, c = Math.cos(f.facing), s = Math.sin(f.facing);
    const bx = f.position.x + cp.x * c - bz * s, bzw = f.position.z + cp.x * s + bz * c;
    const p = sc.puckWorld();
    expect(Math.hypot(p.x - bx, p.z - bzw)).toBeLessThan(0.02);
  });

});

describe('pad saves', () => {
  it('kick out the pad on the side the save event puts the puck, given the event log', () => {
    const { setup: game, pb } = sharedPlayback();
    const saves = pb.events.filter((e) => e.type === 'save' && e.detail.pose === 'pad');
    expect(saves.length).toBeGreaterThan(2);
    let checked = 0;
    for (const e of saves.slice(0, 4)) {
      const side = (events: typeof pb.events): number => {
        const sc = createGameScene(game, { events });
        seekScene(pb, sc, e.tick + 4);
        const st = pb.frame().prev;
        const g = st.goalies.home.id === e.playerId ? st.goalies.home : st.goalies.away;
        const root = sc.root.getObjectByName(`goalie-${[...game.home.players, ...game.away.players].find((p) => p.id === g.id)!.number}`)!;
        root.updateWorldMatrix(true, true);
        // Which pad is further out to his side, as a sign (+1 his right).
        let best = 0, sign = 0;
        for (const name of ['pad0', 'pad1']) {
          const v = new THREE.Box3().setFromObject(root.getObjectByName(name)!).getCenter(new THREE.Vector3());
          const right = (v.x - g.pos.x) * -Math.sin(g.facing) + (v.z - g.pos.y) * Math.cos(g.facing);
          if (Math.abs(right) > best) { best = Math.abs(right); sign = Math.sign(right); }
        }
        sc.dispose();
        return sign;
      };
      pb.seek(e.tick);
      const st = pb.frame().prev;
      const g = st.goalies.home.id === e.playerId ? st.goalies.home : st.goalies.away;
      const toRight = (e.pos.x - g.pos.x) * -Math.sin(g.facing) + (e.pos.y - g.pos.y) * Math.cos(g.facing);
      pb.seek(e.tick + 4);
      const later = pb.frame().prev.goalies[st.goalies.home.id === e.playerId ? 'home' : 'away'];
      if (Math.abs(toRight) < 0.1 || later.pose !== 'pad') continue; // a save he froze is a cover, not a pad save
      // The same save with its puck mirrored to his other side.
      const mx = -Math.sin(g.facing) * toRight, my = Math.cos(g.facing) * toRight;
      const mirrored = pb.events.map((x) => (x === e ? { ...e, pos: { x: e.pos.x - 2 * mx, y: e.pos.y - 2 * my } } : x));
      expect(side(pb.events)).toBe(Math.sign(toRight));
      expect(side(mirrored)).toBe(-Math.sign(toRight));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('engine cuts are drawn as cuts', () => {
  let pb: Playback;
  let game: GameSetup;
  beforeAll(() => { ({ setup: game, pb } = sharedPlayback()); });

  /**
   * Play across cut tick `c` at 120 Hz at half speed (8 frames a tick). In the ticks either side of the cut, every
   * drawn place of the goalies and the puck is at (or within a tick's normal motion of) its old or its new place,
   * and the frame the picture cuts on is the first of tick c.
   */
  function across(c: number): { worstGoalie: number; worstPuck: number; cutFrames: number[]; kinds: (string | null)[] } {
    const sc = createGameScene(game);
    pb.seek(c - 1);
    const before = structuredClone(pb.frame().prev), after = structuredClone(pb.frame().next);
    seekScene(pb, sc, c - 3);
    let worstGoalie = 0, worstPuck = 0;
    const cutFrames: number[] = [], kinds: (string | null)[] = [];
    for (let i = 0; i < 6 * 8; i++) {
      pb.advance(1 / 240); sc.update(pb.frame(), 1 / 240);
      const f = pb.frame();
      if (sc.cutNow()) { cutFrames.push(f.tick); kinds.push(sc.cutKind()); }
      if (f.tick !== c - 1 && f.tick !== c) continue; // the two ticks either side of the cut
      for (const side of ['home', 'away'] as const) {
        const g = sc.figure(before.goalies[side].id)!.position;
        const o = before.goalies[side].pos, n = after.goalies[side].pos;
        worstGoalie = Math.max(worstGoalie, Math.min(Math.hypot(g.x - o.x, g.z - o.y), Math.hypot(g.x - n.x, g.z - n.y)));
      }
      const p = sc.puckWorld(), o = before.puck.pos, n = after.puck.pos;
      worstPuck = Math.max(worstPuck, Math.min(Math.hypot(p.x - o.x, p.z - o.y), Math.hypot(p.x - n.x, p.z - n.y)));
    }
    sc.dispose();
    return { worstGoalie, worstPuck, cutFrames, kinds };
  }

  it('at a period break the goalies change ends in one frame, not across centre ice', () => {
    const periodEnd = pb.events.find((e) => e.type === 'periodEnd')!.tick;
    const c = pb.cuts.find((t) => t > periodEnd)!;
    pb.seek(c - 1);
    const f = pb.frame();
    expect(f.next.attackDir.home).not.toBe(f.prev.attackDir.home);
    expect(Math.abs(f.next.goalies.home.pos.x - f.prev.goalies.home.pos.x)).toBeGreaterThan(40);
    const r = across(c);
    expect(r.worstGoalie).toBeLessThan(0.3);
    expect(r.worstPuck).toBeLessThan(1);
    expect(r.cutFrames).toEqual([c]);
    expect(r.kinds).toEqual(['ends']);
  });

  it('at a whistle the puck goes to the dot in one frame, never drawn half way', () => {
    // A restart where the puck is put on a dot far from where play stopped.
    const c = pb.cuts.find((t) => {
      pb.seek(t - 1);
      const f = pb.frame();
      return f.next.phase === 'faceoffSetup' && f.prev.attackDir.home === f.next.attackDir.home
        && Math.hypot(f.next.puck.pos.x - f.prev.puck.pos.x, f.next.puck.pos.y - f.prev.puck.pos.y) > 4;
    })!;
    expect(c).toBeGreaterThan(0);
    const r = across(c);
    expect(r.worstPuck).toBeLessThan(0.3);
    expect(r.worstGoalie).toBeLessThan(0.3);
    expect(r.cutFrames).toEqual([c]);
    expect(r.kinds).toEqual(['restart']);
  });
});
