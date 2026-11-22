/**
 * Task 5 stand-in for team play and the player brain. Task 6 deletes this file.
 * The nearest skater on each team chases the puck, the carrier skates at the attacking net
 * and lets the puck go at it from close range; everyone else trails the puck in a loose shape.
 */
import { RINK } from './rink';
import type { Rng } from './rng';
import type { GameState, Position, SkaterState } from './types';
import { dist } from './vec';

const SHOOT_RANGE = 10;
const SHOT_SPEED = 25;
/** Distance behind the puck (along attack direction) and lane (+ = left) per slot. */
const SHAPE: Record<Exclude<Position, 'G'>, { back: number; left: number }> = {
  C: { back: 4, left: 0 },
  LW: { back: 3, left: 7 },
  RW: { back: 3, left: -7 },
  LD: { back: 12, left: 4 },
  RD: { back: 12, left: -4 },
};
const X_LIMIT = RINK.goalLineX - 1;

/** Sets targets for on-ice skaters; may release the carrier's puck at the net. Returns the shooter's id if he shot. */
export function standInPlay(state: GameState, rng: Rng): string | null {
  const puck = state.puck.pos;
  for (const side of ['home', 'away'] as const) {
    const dir = state.attackDir[side];
    let chaser: SkaterState | null = null;
    let best = Infinity;
    for (const s of state.skaters) {
      if (!s.onIce || s.side !== side || s.downT > 0) continue;
      const d = s.id === state.carrierId ? -1 : dist(s.pos, puck);
      if (d < best) { best = d; chaser = s; }
    }
    for (const s of state.skaters) {
      if (!s.onIce || s.side !== side) continue;
      s.speedCap = 1;
      if (s.id === state.carrierId) {
        const behindGoalLine = s.pos.x * dir > RINK.goalLineX - 0.5;
        s.target = { x: dir * (behindGoalLine ? RINK.goalLineX - 6 : RINK.goalLineX - 1), y: 0 };
        s.faceTarget = null;
      } else if (s === chaser) {
        s.target = { x: puck.x, y: puck.y };
        s.faceTarget = null;
      } else {
        const shape = SHAPE[s.slot === null || s.slot === 'G' ? 'C' : s.slot];
        const x = Math.max(-X_LIMIT, Math.min(X_LIMIT, puck.x - dir * shape.back));
        s.target = { x, y: dir * shape.left };
        s.faceTarget = { x: puck.x, y: puck.y };
        s.speedCap = 0.75;
      }
    }
  }

  const carrier = state.carrierId === null ? null : state.skaters.find((s) => s.id === state.carrierId) ?? null;
  if (!carrier) return null;
  const dir = state.attackDir[carrier.side];
  const net = { x: dir * RINK.goalLineX, y: 0 };
  if (puck.x * dir >= RINK.goalLineX - 0.3 || dist(puck, net) > SHOOT_RANGE) return null;
  const aim = { x: net.x, y: rng.range(-1.5, 1.5) };
  const dx = aim.x - puck.x, dy = aim.y - puck.y;
  const d = Math.hypot(dx, dy) || 1;
  state.puck.vel = { x: (dx / d) * SHOT_SPEED, y: (dy / d) * SHOT_SPEED };
  state.carrierId = null;
  return carrier.id;
}
