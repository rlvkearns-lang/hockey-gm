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
 * the puck was drawn last (world ice plane). After a new game or a seek, start from `{ w: 0, from: enginePuck }`, or
 * `{ w: 1, from: bladeWorld }` if someone carries it at that moment, so nothing eases across the cut.
 */
export type CarryBlend = { w: number; from: IcePoint };

/** Seconds to ease onto the blade once he has the puck, and back to the engine's puck once he has not. */
export const CARRY_ON = 0.15, CARRY_OFF = 0.1;

/**
 * Step the drawn puck by `dt` seconds. While `carried` it eases from the engine's puck onto the blade (`bladeWorld`,
 * the carry point in world x, z) within CARRY_ON; once the carry ends it eases back to the engine's puck within
 * CARRY_OFF and is then exactly it. Both ends move with the play while it eases (the engine keeps a carried puck at
 * his reach, and a released one flies from his stick), so the drawn puck never lags or jumps; a change of mind
 * part way through turns the ease round where it is.
 */
export function stepCarry(b: CarryBlend, carried: boolean, enginePuck: IcePoint, bladeWorld: IcePoint, dt: number): { blend: CarryBlend; drawn: IcePoint } {
  const h = Math.max(0, fin(dt));
  const w0 = clamp01(fin(b.w));
  let w = carried ? w0 + h / CARRY_ON : w0 - h / CARRY_OFF;
  if (w >= 1 - 1e-9) w = 1; else if (w <= 1e-9) w = 0;
  let drawn: IcePoint;
  if (w === 0) drawn = { x: enginePuck.x, z: enginePuck.z };
  else if (w === 1) drawn = { x: bladeWorld.x, z: bladeWorld.z };
  else {
    const k = smooth(w);
    drawn = { x: enginePuck.x + (bladeWorld.x - enginePuck.x) * k, z: enginePuck.z + (bladeWorld.z - enginePuck.z) * k };
  }
  return { blend: { w, from: drawn }, drawn };
}
