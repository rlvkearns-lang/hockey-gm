/**
 * Where a skater's stick blade is, and how he plays a puck toward a spot: off the forehand, the backhand or behind him.
 *
 * Left and right are the engine's one convention (plan, Global Constraints): a player's left is at facing + PI/2
 * (counter-clockwise, with +x right and +y up), so facing +x his left is +y. `shoots: 'L'` puts the blade on his left.
 */
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { TUNING } from './tuning';
import type { PassHand } from './types';
import type { Vec2 } from './vec';
// Local bindings of hot imports (a call through an imported binding costs more under the test runner).
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;

/** The blade's offset from his centre (m): `forward` along his facing, `side` to his shooting side. For the viewer. */
export const BLADE: { forward: number; side: number } = { forward: TUNING.blade.forward, side: TUNING.blade.side };
const F = BLADE.forward, S = BLADE.side;
/** A forehand reaches from FORE_MIN to FORE_MAX (rad, positive toward his blade side) off his facing; a backhand on to BACK_MAX. */
const FORE_MIN = (-110 * Math.PI) / 180;
const FORE_MAX = (40 * Math.PI) / 180;
const BACK_MAX = (140 * Math.PI) / 180;

/** +1 when the blade is on his left (shoots 'L'), -1 on his right. */
export function handSign(shoots: 'L' | 'R'): 1 | -1 {
  return shoots === 'L' ? 1 : -1;
}

/** Where his stick blade is: TUNING.blade.forward (0.9 m) ahead of his centre along his facing and TUNING.blade.side (0.4 m) to his shooting side. Writes `out`. */
export function bladePos(pos: Vec2, facing: number, shoots: 'L' | 'R', out: Vec2): Vec2 {
  const c = dcos(facing), s = dsin(facing), h = shoots === 'L' ? S : -S;
  // His left is (-sin, cos).
  const x = pos.x + c * F - s * h, y = pos.y + s * F + c * h;
  out.x = x;
  out.y = y;
  return out;
}

/**
 * How he has to play a puck toward `to`: with phi the angle from his facing to it, positive toward his blade side,
 * forehand for -110 to +40 degrees, backhand for +40 to +140, behind for the rest.
 */
export function handFor(pos: Vec2, facing: number, shoots: 'L' | 'R', to: Vec2): PassHand {
  const phi = bladeSideAngle(pos, facing, shoots, to);
  if (phi >= FORE_MIN && phi <= FORE_MAX) return 'forehand';
  if (phi > FORE_MAX && phi <= BACK_MAX) return 'backhand';
  return 'behind';
}

/** The angle (rad, -PI to PI) from his facing to `to`, positive toward his blade side. */
export function bladeSideAngle(pos: Vec2, facing: number, shoots: 'L' | 'R', to: Vec2): number {
  const c = dcos(facing), s = dsin(facing);
  const dx = to.x - pos.x, dy = to.y - pos.y;
  // Angle off his facing, counter-clockwise (toward his left) positive; flipped for a right shot.
  return datan2(c * dy - s * dx, c * dx + s * dy) * (shoots === 'L' ? 1 : -1);
}

/**
 * Whether he can play a puck toward `to` off the forehand once he has turned his body up to `open` rad toward it (a
 * shooter opens his hips or turns as he winds up): the forehand range (-110 to +40 degrees) widened by `open` each way.
 */
export function forehandWithin(pos: Vec2, facing: number, shoots: 'L' | 'R', to: Vec2, open: number): boolean {
  if (FORE_MAX - FORE_MIN + 2 * open >= 2 * Math.PI) return true;
  const phi = bladeSideAngle(pos, facing, shoots, to);
  const lo = FORE_MIN - open, hi = FORE_MAX + open;
  return (phi >= lo && phi <= hi) || (phi - 2 * Math.PI >= lo && phi - 2 * Math.PI <= hi) || (phi + 2 * Math.PI >= lo && phi + 2 * Math.PI <= hi);
}
