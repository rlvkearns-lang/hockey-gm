import { resolveBoards } from './rink';
import { TUNING } from './tuning';
import { hypot2 } from './vec';
import type { PlayerDef, SkaterState } from './types';
import { datan2, dcos, dexp, dsin } from './dmath';

export type Movement = {
  topSpeed: number;
  accel: number;
  turnRate: number;
  backwardFactor: number;
  mass: number;
  radius: number;
};

const S = TUNING.skating;
/** Distance from the target (m) inside which a skater eases off. */
const ARRIVE_RADIUS = 2;
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
    backwardFactor: 0.72 + a.agility * 0.0012,
    mass: def.weightKg + 9,
    radius: bodyRadius(def.weightKg),
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

export function stepSkater(s: SkaterState, m: Movement, dt: number): void {
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

    // Turn, slower at speed going forward (his momentum is along his blades); squared up he pivots his upper body and
    // hips freely, since his travel no longer follows his facing.
    const maxTurn = (squared ? m.turnRate : m.turnRate / (1 + speed / 6)) * dt;
    s.facing = wrapAngle(s.facing + clampedTurn(wantFacing - s.facing, maxTurn));

    const fx = dcos(s.facing), fy = dsin(s.facing);
    const along = s.vel.x * fx + s.vel.y * fy;
    const latX = s.vel.x - fx * along, latY = s.vel.y - fy * along;
    const step = m.accel * dt;
    const arrive = Math.min(1, dist / ARRIVE_RADIUS);
    const cap = Math.max(0, Math.min(1, s.speedCap));
    if (dt !== gripDt) { gripDt = dt; gripFactor = dexp(-EDGE_GRIP * dt); }
    const grip = gripFactor;

    if (!squared) {
      s.mode = 'forward';
      // Only effort along the facing counts; scale by how well it points at the goal.
      const align = hasGoal ? Math.max(0, (fx * dx + fy * dy) / dist) : 0;
      const wantAlong = m.topSpeed * cap * arrive * align;
      const newAlong = along + Math.max(-step, Math.min(step, wantAlong - along));
      s.vel.x = fx * newAlong + latX * grip;
      s.vel.y = fy * newAlong + latY * grip;
    } else {
      // Squared up: he pushes toward the goal in any direction, fastest forward, then sideways, slowest backward (an
      // ellipse of top speeds), and sideways only as fast as crossovers allow.
      const ux = hasGoal ? dx / dist : 0, uy = hasGoal ? dy / dist : 0;
      const a = ux * fx + uy * fy, l = uy * fx - ux * fy;
      const limA = a >= 0 ? m.topSpeed : m.topSpeed * m.backwardFactor, limL = m.topSpeed * LATERAL_SPEED;
      const ellipse = hasGoal ? 1 / Math.sqrt((a / limA) * (a / limA) + (l / limL) * (l / limL)) : 0;
      const want = ellipse * cap * arrive;
      const wantAlong = a * want, wantLat = l * want;
      const newAlong = along + Math.max(-step, Math.min(step, wantAlong - along));
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
