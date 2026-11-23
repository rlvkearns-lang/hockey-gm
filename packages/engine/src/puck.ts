import type { Vec2 } from './vec';
import { RINK, resolveBoards } from './rink';
import { hypot2 } from './vec';
import { dexp, hypot3 } from './dmath';
import { GRAVITY, PUCK_RADIUS } from './util';

export type Puck = { pos: Vec2; z: number; vel: Vec2; vz: number };

export type PuckEvent =
  | { kind: 'boards' }
  | { kind: 'post'; end: 1 | -1 }
  | { kind: 'onNet'; end: 1 | -1; y: number; z: number; speed: number }
  | { kind: 'overNet'; end: 1 | -1 };

const ICE_DECAY = 0.38; // per second, on speed, while on the ice
const BOARDS_RESTITUTION = 0.55;
const NET_RESTITUTION = 0.3;
const POST_RESTITUTION = 0.6;
const POST_RADIUS = 0.03;
/** A post contact is a `post` (it rings) when the puck's speed into the post is at least this share of its speed. */
const POST_RING = 0.25;
/** Maximum travel per sub-step; below the puck+post contact distance so nothing tunnels. */
const MAX_SUBSTEP = 0.04;
const ENDS: readonly (1 | -1)[] = [1, -1];
const SIGNS: readonly (1 | -1)[] = [1, -1];

const backX = RINK.goalLineX + RINK.netDepth;
/** Bounding box (per end, in x * end and |y|) of every post and netting contact; 0.01 m spare. */
const NET_REACH = PUCK_RADIUS + POST_RADIUS + 0.01;
const NET_NEAR_X = RINK.goalLineX - NET_REACH;
const NET_FAR_X = backX + NET_REACH;
const NET_HALF_REACH = RINK.netHalfWidth + NET_REACH;

/** Push the puck out of a segment (a === b for a point) and reflect. Returns the pre-contact approach speed, or -1 for no contact. */
function collideSegment(p: Puck, ax: number, ay: number, bx: number, by: number, r: number, e: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.pos.x - ax) * abx + (p.pos.y - ay) * aby) / l2));
  const qx = ax + abx * t, qy = ay + aby * t;
  const dx = p.pos.x - qx, dy = p.pos.y - qy;
  // Clearly out of reach (margin far above rounding): same outcome as the exact test, without the square root.
  if (dx * dx + dy * dy > r * r * (1 + 1e-9)) return -1;
  const d = hypot2(dx, dy);
  if (d >= r) return -1;
  // Degenerate (centre exactly on the segment): push toward the rink centre line.
  const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : (p.pos.y >= 0 ? 1 : -1);
  p.pos.x = qx + nx * r;
  p.pos.y = qy + ny * r;
  const vn = p.vel.x * nx + p.vel.y * ny;
  if (vn >= 0) return 0;
  p.vel.x -= (1 + e) * vn * nx;
  p.vel.y -= (1 + e) * vn * ny;
  return -vn;
}

export function stepPuck(puck: Puck, dt: number): PuckEvent[] {
  const events: PuckEvent[] = [];
  const speed = hypot2(puck.vel.x, puck.vel.y);
  const n = Math.max(1, Math.ceil((speed * dt) / MAX_SUBSTEP));
  const h = dt / n;
  const friction = dexp(-ICE_DECAY * h);
  let boardsHit = false;

  for (let i = 0; i < n; i++) {
    const px = puck.pos.x, py = puck.pos.y, pz = puck.z;

    if (puck.z === 0 && puck.vz === 0) {
      puck.vel.x *= friction;
      puck.vel.y *= friction;
    } else {
      puck.vz -= GRAVITY * h;
      puck.z += puck.vz * h;
      if (puck.z <= 0) { puck.z = 0; puck.vz = 0; }
    }
    puck.pos.x += puck.vel.x * h;
    puck.pos.y += puck.vel.y * h;

    // Nets: posts and netting only stop a puck below the crossbar.
    if (puck.z < RINK.netHeight) {
      for (const end of ENDS) {
        // Nothing of this net within reach: every collideSegment below would return -1 untouched.
        if (puck.pos.x * end < NET_NEAR_X || puck.pos.x * end > NET_FAR_X || Math.abs(puck.pos.y) > NET_HALF_REACH) continue;
        const gx = end * RINK.goalLineX, bx = end * backX;
        for (const sy of SIGNS) {
          const sp = hypot2(puck.vel.x, puck.vel.y);
          // A clean ring off the post is a `post`; a graze only nudges the puck on its way (in, or wide).
          if (collideSegment(puck, gx, sy * RINK.netHalfWidth, gx, sy * RINK.netHalfWidth, PUCK_RADIUS + POST_RADIUS, POST_RESTITUTION) > POST_RING * sp) {
            events.push({ kind: 'post', end });
          }
          collideSegment(puck, gx, sy * RINK.netHalfWidth, bx, sy * RINK.netHalfWidth, PUCK_RADIUS, NET_RESTITUTION);
        }
        collideSegment(puck, bx, -RINK.netHalfWidth, bx, RINK.netHalfWidth, PUCK_RADIUS, NET_RESTITUTION);
      }
    }

    if (resolveBoards(puck.pos, puck.vel, PUCK_RADIUS, BOARDS_RESTITUTION)) boardsHit = true;

    // Goal-line crossing from the front, between the posts.
    for (const end of ENDS) {
      const gx = end * RINK.goalLineX;
      if (px * end >= RINK.goalLineX || puck.pos.x * end < RINK.goalLineX) continue;
      const t = (gx - px) / (puck.pos.x - px);
      const y = py + (puck.pos.y - py) * t;
      if (Math.abs(y) >= RINK.netHalfWidth) continue;
      const z = pz + (puck.z - pz) * t;
      if (z < RINK.netHeight) {
        const sp = hypot3(puck.vel.x, puck.vel.y, puck.vz);
        puck.pos.x = gx;
        puck.pos.y = y;
        puck.z = z;
        puck.vel.x = 0;
        puck.vel.y = 0;
        puck.vz = 0;
        if (boardsHit) events.unshift({ kind: 'boards' });
        events.push({ kind: 'onNet', end, y, z, speed: sp });
        return events;
      }
      events.push({ kind: 'overNet', end });
    }
  }
  if (boardsHit) events.unshift({ kind: 'boards' });
  return events;
}
