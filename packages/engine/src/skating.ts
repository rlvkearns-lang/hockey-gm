import { resolveBoards } from './rink';
import { TUNING } from './tuning';
import { hypot2 } from './vec';
import type { PlayerDef, SkaterState, SlowMode } from './types';
import { datan2, dcos, dexp, dsin } from './dmath';

export type Movement = {
  topSpeed: number;
  accel: number;
  turnRate: number;
  backwardFactor: number;
  mass: number;
  radius: number;
  /** Hard-stop deceleration and the largest sideways acceleration his edges hold in a turn (m/s^2). */
  brake: number;
  carve: number;
};

/** How he slows when he is going faster than he wants, and whether he means to stop at his target or skate through it. */
export type Drive = { slow: SlowMode; through: boolean };
export const DEFAULT_DRIVE: Drive = { slow: 'coast', through: false };

const S = TUNING.skating;
/** He means to come to rest this far (m) short of his target, so that braking onto it does not overshoot. */
const ARRIVE_SHORT = 0.3;
/**
 * Inside the last stretch he still closes on his target at this rate (m/s per m of distance left), so a target he is
 * held to (a corner on his route round the net) is reached, not stopped ARRIVE_SHORT short of for good.
 */
const ARRIVE_CREEP = 2;
/** Below this speed (m/s) his turn is no longer limited by how hard his edges hold (he turns at turnRate). */
const CARVE_MIN_SPEED = 1.5;
/** The smallest sine of the angle to his target used for the turn-reach limit (avoids dividing by zero dead ahead). */
const MIN_REACH_SIN = 0.05;
/** Sideways velocity shed per second (skate edges). */
const EDGE_GRIP = 6;
/** Speed lost per second while down. */
const DOWN_FRICTION = 2;
/**
 * Squaring up: with a spot to face (faceTarget) and somewhere to go, he keeps his body to that spot once his travel is
 * more than SQUARE_ENTER off it, and goes back to facing his travel only when it is less than SQUARE_EXIT off
 * (hysteresis, so he does not flip between the two). Squared up, travel more than BACKWARD_FROM off his facing is
 * backward skating; less is crossovers (sideways, or forward at an angle).
 */
const SQUARE_ENTER = (65 * Math.PI) / 180;
const SQUARE_EXIT = (45 * Math.PI) / 180;
const BACKWARD_FROM = (120 * Math.PI) / 180;
/** Squared up, his top speed sideways is this share of his forward top speed, and his sideways acceleration this share of his accel. */
const LATERAL_SPEED = 0.8;
const LATERAL_ACCEL = 0.75;

/** Body radius (m) of a skater of this weight. */
export const bodyRadius = (weightKg: number): number => 0.38 + (weightKg - 85) * 0.002;

export function movementOf(def: PlayerDef, energy: number): Movement {
  const a = def.attrs;
  const tired = energy >= 0.5 ? 1 : 0.85 + 0.15 * (Math.max(0, energy) / 0.5);
  return {
    topSpeed: (S.topSpeed.base + a.speed * S.topSpeed.perPoint) * tired,
    accel: (S.accel.base + a.acceleration * S.accel.perPoint) * tired,
    turnRate: 2.2 + a.agility * 0.03,
    backwardFactor: S.backward.base + a.agility * S.backward.perPoint,
    mass: def.weightKg + 9,
    radius: bodyRadius(def.weightKg),
    brake: S.brake.base + a.agility * S.brake.perPoint,
    carve: S.carve.base + a.agility * S.carve.perPoint,
  };
}

const TWO_PI = 2 * Math.PI;
/** Wrap an angle to (-PI, PI] by whole turns (no trigonometry: this runs for every skater every tick). */
export function wrapAngle(a: number): number {
  if (a > -Math.PI && a <= Math.PI) return a;
  const w = a - TWO_PI * Math.round(a / TWO_PI);
  return w <= -Math.PI ? w + TWO_PI : w > Math.PI ? w - TWO_PI : w;
}
/** Cheap wrap to about [-PI, PI]; within ~1e-15 of wrapAngle, so only used where that cannot change an outcome. */
const roughWrap = (a: number): number => a - TWO_PI * Math.round(a / TWO_PI);
/** Margin far above roughWrap's error, so a comparison outside it decides the same way as with wrapAngle. */
const SAFE = 1e-9;

/** Clamp wrapAngle(a) to [-max, max]. Skips the exact wrap when it is clearly beyond the clamp (same result). */
function clampedTurn(a: number, max: number): number {
  const w = roughWrap(a);
  const aw = Math.abs(w);
  if (aw > max + SAFE && aw < Math.PI - SAFE) return w > 0 ? max : -max;
  return Math.max(-max, Math.min(max, wrapAngle(a)));
}

let gripDt = NaN, gripFactor = 1;

/** The new speed along one axis: toward `want` at `up` (m/s per tick) when speeding up or reversing, at `down` when slowing. */
function approach(cur: number, want: number, up: number, down: number): number {
  if (cur > 0 && want >= 0 && want < cur) return Math.max(want, cur - down);
  if (cur < 0 && want <= 0 && want > cur) return Math.min(want, cur + down);
  return cur + Math.max(-up, Math.min(up, want - cur));
}

export function stepSkater(s: SkaterState, m: Movement, dt: number, drive: Drive = DEFAULT_DRIVE): void {
  if (s.downT > 0) {
    const f = Math.max(0, 1 - DOWN_FRICTION * dt);
    s.vel.x *= f;
    s.vel.y *= f;
  } else {
    const dx = s.target.x - s.pos.x, dy = s.target.y - s.pos.y;
    const dist = hypot2(dx, dy);
    const speed = hypot2(s.vel.x, s.vel.y);
    const hasGoal = dist > 0.05;
    const travel = hasGoal ? datan2(dy, dx) : s.facing;

    // Squared up (backward or crossover) or not, with hysteresis on the angle between travel and the spot to face.
    let squared = false;
    let wantFacing = travel;
    if (s.faceTarget) {
      const fx = s.faceTarget.x - s.pos.x, fy = s.faceTarget.y - s.pos.y;
      if (fx !== 0 || fy !== 0) {
        const toFace = datan2(fy, fx);
        if (!hasGoal) { wantFacing = toFace; squared = s.mode !== 'forward'; }
        else {
          const off = Math.abs(wrapAngle(toFace - travel));
          squared = off > (s.mode === 'forward' ? SQUARE_ENTER : SQUARE_EXIT);
          if (squared) wantFacing = toFace;
        }
      }
    }

    // Turn. Going forward his edges hold at most m.carve sideways, so at speed he carves a circle of radius
    // speed^2 / carve; squared up he pivots his upper body and hips freely, since his travel no longer follows his facing.
    const ox = dcos(s.facing), oy = dsin(s.facing);
    const maxTurn = (squared ? m.turnRate : Math.min(m.turnRate, m.carve / Math.max(speed, CARVE_MIN_SPEED))) * dt;
    const turn = clampedTurn(wantFacing - s.facing, maxTurn);
    s.facing = wrapAngle(s.facing + turn);
    const fx = dcos(s.facing), fy = dsin(s.facing);

    if (!squared) {
      // Carving: the speed he carries along his blades turns with them, less a little per radian turned.
      const carried = Math.max(0, s.vel.x * ox + s.vel.y * oy);
      const kept = carried * dexp(-S.carveLoss * Math.abs(turn));
      s.vel.x += fx * kept - ox * carried;
      s.vel.y += fy * kept - oy * carried;
    }

    const along = s.vel.x * fx + s.vel.y * fy;
    const latX = s.vel.x - fx * along, latY = s.vel.y - fy * along;
    const step = m.accel * dt;
    const cap = Math.max(0, Math.min(1, s.speedCap));
    if (dt !== gripDt) { gripDt = dt; gripFactor = dexp(-EDGE_GRIP * dt); }
    const grip = gripFactor;
    // Arrival: the fastest speed from which he can still stop ARRIVE_SHORT short of his target.
    const arrival = drive.through ? Infinity
      : Math.max(Math.sqrt(2 * (drive.slow === 'stop' ? m.brake : S.easeDecel) * Math.max(0, dist - ARRIVE_SHORT)), ARRIVE_CREEP * dist);
    // Slowing: for a limit (arrival, turn reach) he brakes lightly, or hard when stopping; otherwise as his drive says.
    const limitDecel = (drive.slow === 'stop' ? m.brake : S.easeDecel) * dt;
    const freeDecel = (drive.slow === 'stop' ? m.brake : drive.slow === 'ease' ? S.easeDecel : S.glideDecel) * dt;

    if (!squared) {
      s.mode = 'forward';
      const free = m.topSpeed * cap;
      let limit = arrival;
      if (hasGoal) {
        // Reach: the fastest speed whose turning circle (tangent to his blades) passes through the target.
        const offLine = Math.abs(wrapAngle(travel - s.facing));
        const off = Math.min(offLine, Math.PI / 2);
        // Told to stop, he does not carve a wide circle round to a target behind him: he stops and turns (a hockey
        // stop; it is what keeps a skater held at the blue line, or heading off, from sweeping a 15-20 m arc).
        const reach = drive.slow === 'stop' && offLine > Math.PI / 2 ? 0
          : Math.sqrt((m.carve * dist) / (2 * Math.max(MIN_REACH_SIN, dsin(off))));
        if (reach < limit) limit = reach;
      }
      const want = Math.min(free, limit);
      const newAlong = approach(along, want, step, limit < free ? limitDecel : freeDecel);
      s.vel.x = fx * newAlong + latX * grip;
      s.vel.y = fy * newAlong + latY * grip;
    } else {
      // Squared up: he pushes toward the goal in any direction, fastest forward, then sideways, slowest backward (an
      // ellipse of top speeds), and sideways only as fast as crossovers allow.
      const ux = hasGoal ? dx / dist : 0, uy = hasGoal ? dy / dist : 0;
      const a = ux * fx + uy * fy, l = uy * fx - ux * fy;
      const limA = a >= 0 ? m.topSpeed : m.topSpeed * m.backwardFactor, limL = m.topSpeed * LATERAL_SPEED;
      const ellipse = hasGoal ? 1 / Math.sqrt((a / limA) * (a / limA) + (l / limL) * (l / limL)) : 0;
      const free = ellipse * cap;
      const want = Math.min(free, arrival);
      const wantAlong = a * want, wantLat = l * want;
      const newAlong = approach(along, wantAlong, step, arrival < free ? limitDecel : freeDecel);
      const lat = latY * fx - latX * fy; // signed, + to his left
      const latStep = step * LATERAL_ACCEL;
      const pushed = lat + Math.max(-latStep, Math.min(latStep, wantLat - lat));
      const slid = wantLat + (lat - wantLat) * grip; // his edges shed whatever he does not want
      const newLat = Math.abs(slid - wantLat) < Math.abs(pushed - wantLat) ? slid : pushed;
      s.vel.x = fx * newAlong - fy * newLat;
      s.vel.y = fy * newAlong + fx * newLat;
      s.mode = hasGoal && Math.abs(wrapAngle(travel - s.facing)) > BACKWARD_FROM ? 'backward' : 'crossover';
    }
  }

  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  resolveBoards(s.pos, s.vel, m.radius, 0);
}
