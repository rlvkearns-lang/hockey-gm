import { resolveBoards } from './rink';
import { TUNING } from './tuning';
import { hypot2 } from './vec';
import type { PlayerDef, SkaterState } from './types';

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
/** Angle between travel and facing target beyond which he skates backward. */
const BACKWARD_ANGLE = (100 * Math.PI) / 180;

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
    const travel = hasGoal ? Math.atan2(dy, dx) : s.facing;

    let backward = false;
    let wantFacing = travel;
    if (s.faceTarget) {
      const fx = s.faceTarget.x - s.pos.x, fy = s.faceTarget.y - s.pos.y;
      if (fx !== 0 || fy !== 0) {
        const toFace = Math.atan2(fy, fx);
        if (!hasGoal) wantFacing = toFace;
        else {
          const off = Math.abs(roughWrap(toFace - travel));
          const isBack = Math.abs(off - BACKWARD_ANGLE) > SAFE ? off > BACKWARD_ANGLE : Math.abs(wrapAngle(toFace - travel)) > BACKWARD_ANGLE;
          if (isBack) { backward = true; wantFacing = toFace; }
        }
      }
    }

    // Turn, slower at speed.
    const maxTurn = (m.turnRate / (1 + speed / 6)) * dt;
    s.facing = wrapAngle(s.facing + clampedTurn(wantFacing - s.facing, maxTurn));

    const fx = Math.cos(s.facing), fy = Math.sin(s.facing);
    const moveDir = backward ? -1 : 1;
    // Only effort along the facing counts; scale by how well it points at the goal.
    const align = hasGoal ? Math.max(0, (moveDir * fx * dx + moveDir * fy * dy) / dist) : 0;
    const arrive = Math.min(1, dist / ARRIVE_RADIUS);
    const cap = Math.max(0, Math.min(1, s.speedCap));
    const wantSpeed = m.topSpeed * cap * arrive * align * (backward ? m.backwardFactor : 1);
    const wantAlong = moveDir * wantSpeed;

    const along = s.vel.x * fx + s.vel.y * fy;
    const latX = s.vel.x - fx * along, latY = s.vel.y - fy * along;
    const step = m.accel * dt;
    const newAlong = along + Math.max(-step, Math.min(step, wantAlong - along));
    if (dt !== gripDt) { gripDt = dt; gripFactor = Math.exp(-EDGE_GRIP * dt); }
    const grip = gripFactor;
    s.vel.x = fx * newAlong + latX * grip;
    s.vel.y = fy * newAlong + latY * grip;
  }

  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  resolveBoards(s.pos, s.vel, m.radius, 0);
}
