import { DT as DT_TICK } from '@hockey/engine';
import type { SkaterPose } from './pose-mix';

/**
 * The puck on the carrier's stick (pure: no three.js, no DOM). The engine keeps a carried puck a fixed reach ahead of
 * the carrier's centre; the viewer draws it on his blade instead, easing between the two so it never jumps, and draws
 * exactly the engine's puck whenever nobody carries it. stepPuckDraw is the whole machine (pick-up, carry, release,
 * loose); the scene feeds it each frame.
 */

export type IcePoint = { x: number; z: number };

/** Length of the blade from the heel (m), and how far in front of its face the puck's centre sits. */
const BLADE_SPOT = 0.13, PUCK_OFF = 0.045;
/** The blade's toe is turned this far (rad) further out than the shaft's heading, to his stick side (as the rig draws it). */
const TOE_OUT = 0.35;

/**
 * Where the puck sits on the blade, on the ice in the body frame (x forward, z to his right), for a pose from poseOf
 * (a left shot: mirror z for a right shot, as the pose is mirrored). It is along the blade from the heel, just in
 * front of the blade's forehand face.
 */
export function carryPoint(pose: Pick<SkaterPose, 'blade' | 'stickAngle'>): IcePoint {
  const h = pose.stickAngle - TOE_OUT; // the blade's heading (toe out to his left, -z)
  const c = Math.cos(h), s = Math.sin(h);
  // The forehand face looks a quarter turn round from the blade toward +z (forward and in front of him).
  return { x: pose.blade.x + BLADE_SPOT * c - PUCK_OFF * s, z: pose.blade.z + BLADE_SPOT * s + PUCK_OFF * c };
}

const TAU = 2 * Math.PI;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * Stickhandling: a small side-to-side offset of the blade (dx forward, dz toward +z) at time `t` (s). Standing or
 * skating slowly he moves it quickly and widely (about 1.5 a second, up to 12 cm); at speed slowly and narrowly
 * (about one every two seconds, 3 cm). Speed only reweights two fixed rhythms, so a change of speed never jumps.
 * Pass it to poseOf as `handle`, then the puck follows the blade through carryPoint.
 */
export function stickhandle(t: number, speed: number): { dx: number; dz: number } {
  const tt = fin(t), u = smooth(fin(speed) / 8);
  const a = 0.12 - 0.09 * u;
  const quick = Math.sin(TAU * 1.5 * tt), slow = Math.sin(TAU * 0.5 * tt + 1);
  return { dx: 0.25 * a * (1 - u) * Math.sin(TAU * 3 * tt), dz: a * ((1 - u) * quick + u * slow) };
}

/**
 * `w` is the blade's share of the drawn puck (0: exactly the engine's puck, 1: exactly on the blade); `from` is where
 * the puck was drawn last (world ice plane), which the next step eases on from. After a new game or a seek, start from
 * `{ w: 0, from: enginePuck }`, or `{ w: 1, from: bladeWorld }` if someone carries it at that moment, so nothing eases
 * across the cut (a stale blend is eased out, not jumped).
 */
export type CarryBlend = { w: number; from: IcePoint };

/** Seconds to ease onto the blade once he has the puck, and back to the engine's puck once he has not. */
export const CARRY_ON = 0.15, CARRY_OFF = 0.1;
/**
 * While carried, the drawn puck and both ends of the blend move with the carrier (well under 12 m/s), so a gap between
 * where it was drawn and where the blend says it was that is wider than CATCH_UP_SLACK plus that much in a step means
 * the blade itself jumped (a new carrier, or a blend not reset after a seek). The gap is then closed at CATCH_UP_SPEED.
 */
const CATCH_UP_SLACK = 0.05, CARRIER_SPEED = 12, CATCH_UP_SPEED = 24;

const blendAt = (engine: IcePoint, blade: IcePoint, w: number): IcePoint => {
  if (w === 0) return { x: engine.x, z: engine.z };
  if (w === 1) return { x: blade.x, z: blade.z };
  const k = smooth(w);
  return { x: engine.x + (blade.x - engine.x) * k, z: engine.z + (blade.z - engine.z) * k };
};
const snapW = (w: number): number => (w >= 1 - 1e-9 ? 1 : w <= 1e-9 ? 0 : w);

/**
 * Step the drawn puck by `dt` seconds. While `carried` it eases from the engine's puck onto the blade (`bladeWorld`,
 * the carry point in world x, z) within CARRY_ON; once the carry ends it eases back to the engine's puck within
 * CARRY_OFF and is then exactly it. Both ends move with the play while it eases (the engine keeps a carried puck at
 * his reach, and a released one flies from his stick), so the drawn puck never lags; a change of mind part way
 * through turns the ease round where it is. If, while carried, the blade is suddenly far from where the puck was
 * drawn (`from`), the puck travels there from where it was at CATCH_UP_SPEED instead of jumping (3 m in an eighth of
 * a second).
 */
export function stepCarry(b: CarryBlend, carried: boolean, enginePuck: IcePoint, bladeWorld: IcePoint, dt: number): { blend: CarryBlend; drawn: IcePoint } {
  const h = Math.max(0, fin(dt));
  const w0 = clamp01(fin(b.w));
  const w = snapW(carried ? w0 + h / CARRY_ON : w0 - h / CARRY_OFF);
  let drawn = blendAt(enginePuck, bladeWorld, w);
  if (carried && Number.isFinite(b.from?.x) && Number.isFinite(b.from?.z)) {
    // Where the blend, with the ends where they are now, says the puck was: it was drawn at `from`.
    const was = blendAt(enginePuck, bladeWorld, snapW(w0));
    const gx = b.from.x - was.x, gz = b.from.z - was.z, gap = Math.hypot(gx, gz);
    if (gap > CATCH_UP_SLACK + CARRIER_SPEED * h) {
      const keep = Math.max(0, gap - CATCH_UP_SPEED * h) / gap;
      drawn = { x: drawn.x + gx * keep, z: drawn.z + gz * keep };
    }
  }
  return { blend: { w, from: drawn }, drawn };
}

// ---------------------------------------------------------------------------------------------------------------
// The puck machine: where the puck is drawn each frame (picked up, carried, released, loose).

/**
 * The drawn puck's state between frames. `drawn` is where it was last drawn (world: x, z on the ice, y its height).
 * `blend` eases it onto a carrier's blade (stepCarry); `pickup` is a pick-up under way (who, and where the puck was
 * relative to him when he got it); `release` a carry ending during the tick that starts at `tick` (who had it, where
 * it was drawn relative to his blade, and the alpha `a0` the slide starts from). `fresh`: the next step starts afresh
 * (after a seek, a new game, or an engine cut that moved the puck), with nothing eased across.
 */
export type PuckDraw = {
  fresh: boolean;
  blend: CarryBlend;
  pickup: { id: string; ox: number; oz: number };
  release: { active: boolean; tick: number; id: string; ox: number; oz: number; a0: number };
  drawn: { x: number; y: number; z: number };
};

export function initialPuckDraw(): PuckDraw {
  return {
    fresh: true, blend: { w: 0, from: { x: 0, z: 0 } }, pickup: { id: '', ox: 0, oz: 0 },
    release: { active: false, tick: -1, id: '', ox: 0, oz: 0, a0: 0 }, drawn: { x: 0, y: 0, z: 0 },
  };
}

/**
 * One frame for the puck machine: the frame's earlier tick and alpha, who had the puck at the two ticks drawn, the
 * engine's puck blended between them (`engine`, world x, z; `height` above the ice) and its place at the later tick
 * (`nextPuck`), and, for a skater drawn on the ice, where the puck sits on his blade this frame and where he is drawn
 * (`holder`, null for anyone else).
 */
export type PuckDrawInput = {
  tick: number; alpha: number;
  prevCarrier: string | null; nextCarrier: string | null;
  engine: IcePoint; height: number; nextPuck: IcePoint;
  holder(id: string): { blade: IcePoint; position: IcePoint } | null;
};

/**
 * Where the puck is drawn this frame. While a skater keeps it, it eases from the engine's puck onto his blade
 * (stepCarry, CARRY_ON) and follows the blade; a puck he picks up (or wins off another skater) eases from where it was
 * last drawn, carried along with him, rather than from the engine's spot at his reach. When he lets it go (a pass, a
 * shot, a check, a poke) it slides from his blade straight to the engine's puck within that same tick, at an even
 * speed starting from the previous frame's moment (`dt` of game time ago), so from the first tick nobody has it, it is
 * exactly the engine's puck; with `dt` 0 (paused) it holds and moves once play resumes. A puck in the air is drawn at
 * the engine's height. Moved here from scene.ts with its behaviour and numbers unchanged.
 */
export function stepPuckDraw(s: PuckDraw, input: PuckDrawInput, dt: number): PuckDraw {
  const { engine, alpha: a } = input;
  const A = input.prevCarrier, B = input.nextCarrier;
  const height = input.height;
  let blend: CarryBlend = { w: s.blend.w, from: { x: s.blend.from.x, z: s.blend.from.z } };
  const pickup = { ...s.pickup }, release = { ...s.release };
  let drawnX = s.drawn.x, drawnZ = s.drawn.z;
  const holderB = B !== null ? input.holder(B) : null;
  if (s.fresh) {
    blend = { w: B !== null && A === B && holderB ? 1 : 0, from: { x: engine.x, z: engine.z } };
    drawnX = engine.x; drawnZ = engine.z;
    release.active = false;
    pickup.id = blend.w === 1 ? B! : '';
  }
  let k = 0; // the blade's share of the drawn puck
  let bx = engine.x, bz = engine.z, ex = engine.x, ez = engine.z;
  const holderA = B === null && A !== null ? input.holder(A) : null;
  if (holderB) {
    // He has it (or gets it during this tick, picked up or won off another skater): ease onto his blade and follow
    // it. The engine snaps a puck it hands him to a spot at his reach, so the ease starts from where the puck was
    // last drawn instead, carried along with him, not from the engine's spot.
    const f = holderB.position, bladeB = holderB.blade;
    if (pickup.id !== B) { pickup.id = B!; blend.w = 0; pickup.ox = drawnX - f.x; pickup.oz = drawnZ - f.z; }
    const anchor = { x: f.x + pickup.ox, z: f.z + pickup.oz };
    const r = stepCarry(blend, true, anchor, bladeB, dt);
    blend = r.blend;
    k = smooth(blend.w);
    bx = bladeB.x; bz = bladeB.z;
    ex = anchor.x; ez = anchor.z;
    release.active = false;
  } else if (holderA) {
    // He let it go during this tick: slide from his blade to the engine's puck by the tick's end.
    // Where it was drawn when he let it go is kept relative to his blade, so it leaves from there.
    const bladeA = holderA.blade;
    if (!release.active || release.tick !== input.tick || release.id !== A) {
      release.active = true; release.tick = input.tick; release.id = A!; release.a0 = Math.min(a, 0.999) - dt / DT_TICK;
      release.ox = drawnX - bladeA.x; release.oz = drawnZ - bladeA.z;
    }
    // It heads straight for where the engine's puck is at the tick's end, at an even speed: the shortest slide.
    k = 1 - Math.min(1, Math.max(0, (a - release.a0) / (1 - release.a0)));
    bx = bladeA.x + release.ox; bz = bladeA.z + release.oz;
    ex = input.nextPuck.x; ez = input.nextPuck.z;
    blend.w = 0;
    pickup.id = '';
  } else {
    blend.w = 0;
    release.active = false;
    pickup.id = '';
  }
  const px = ex + (bx - ex) * k, pz = ez + (bz - ez) * k;
  blend.from.x = px; blend.from.z = pz;
  return { fresh: false, blend, pickup, release, drawn: { x: px, y: height * (1 - k), z: pz } };
}
