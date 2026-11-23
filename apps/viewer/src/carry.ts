import type { SkaterPose } from './gait';

/**
 * The puck on the carrier's stick (pure: no three.js, no DOM). The engine keeps a carried puck a fixed reach ahead of
 * the carrier's centre; the viewer draws it on his blade instead, easing between the two so it never jumps, and draws
 * exactly the engine's puck whenever nobody carries it.
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
