import type { Vec2 } from './vec';

export const RINK = {
  halfLength: 30.48,
  halfWidth: 12.955,
  cornerRadius: 8.53,
  goalLineX: 27.13,
  blueLineX: 7.62,
  netHalfWidth: 0.915,
  netHeight: 1.22,
  netDepth: 1.0,
  creaseRadius: 1.83,
} as const;

export const FACEOFF_DOTS: { centre: Vec2; neutral: Vec2[]; end: Vec2[] } = {
  centre: { x: 0, y: 0 },
  neutral: [
    { x: -6.1, y: -6.7 }, { x: -6.1, y: 6.7 }, { x: 6.1, y: -6.7 }, { x: 6.1, y: 6.7 },
  ],
  end: [
    { x: -21.03, y: -6.7 }, { x: -21.03, y: 6.7 }, { x: 21.03, y: -6.7 }, { x: 21.03, y: 6.7 },
  ],
};

export type Zone = 'D' | 'N' | 'O';

/** Zone of an x position for a team attacking toward attackDir (blue lines divide the zones). */
export function zoneOf(x: number, attackDir: 1 | -1): Zone {
  const rel = x * attackDir;
  if (rel > RINK.blueLineX) return 'O';
  if (rel < -RINK.blueLineX) return 'D';
  return 'N';
}

/**
 * Keep a circular body of the given radius inside the rounded-rectangle boards.
 * Mutates pos and vel (outward normal velocity is reflected with restitution).
 * Returns true when the body touched or crossed the boards.
 */
export function resolveBoards(pos: Vec2, vel: Vec2, radius: number, restitution: number): boolean {
  const R = RINK.cornerRadius;
  const cx = RINK.halfLength - R;
  const cy = RINK.halfWidth - R;
  let hit = false;

  if (Math.abs(pos.x) > cx && Math.abs(pos.y) > cy) {
    const sx = Math.sign(pos.x), sy = Math.sign(pos.y);
    const dx = pos.x - sx * cx, dy = pos.y - sy * cy;
    const d = Math.hypot(dx, dy);
    const limit = R - radius;
    if (d >= limit) {
      const nx = dx / d, ny = dy / d;
      pos.x = sx * cx + nx * limit;
      pos.y = sy * cy + ny * limit;
      const vn = vel.x * nx + vel.y * ny;
      if (vn > 0) {
        vel.x -= (1 + restitution) * vn * nx;
        vel.y -= (1 + restitution) * vn * ny;
      }
      return true;
    }
    return false;
  }

  const lx = RINK.halfLength - radius;
  if (pos.x > lx) { pos.x = lx; if (vel.x > 0) vel.x = -vel.x * restitution; hit = true; }
  else if (pos.x < -lx) { pos.x = -lx; if (vel.x < 0) vel.x = -vel.x * restitution; hit = true; }
  const ly = RINK.halfWidth - radius;
  if (pos.y > ly) { pos.y = ly; if (vel.y > 0) vel.y = -vel.y * restitution; hit = true; }
  else if (pos.y < -ly) { pos.y = -ly; if (vel.y < 0) vel.y = -vel.y * restitution; hit = true; }
  return hit;
}
