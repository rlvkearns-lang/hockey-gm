import { DT } from './constants';
import { RINK } from './rink';
import type { Rng } from './rng';
import { nearestOpponentDist } from './team-play';
import type { GameEvent, GameState, PlayerDef, SkaterState } from './types';
import { hypot2 } from './vec';

/** After a release (draw, pass, shot, dump), the releasing players cannot pick the puck up again for this long. */
export const RELEASE_NO_PICKUP_SECONDS = 0.3;
const GRAVITY = 9.81;
const PUCK_RADIUS = 0.05;
/** A pass stays "pending" (its receiver chases it) for its travel time plus this long. */
const PASS_GRACE_SECONDS = 1;
/** Pass direction error (rad, one standard deviation): a floor, per point of passing below 100, and at full pressure. */
const PASS_ERROR = { base: 0.008, perPoint: 0.0011, pressure: 0.03 };
/** Shot spread at the net (m, one standard deviation): a floor, per point of accuracy below 100, per metre out, at full pressure. */
const SHOT_SPREAD = { base: 0.1, perPoint: 0.006, perMetre: 0.008, pressure: 0.25 };
/** Shooters aim this far (m) from the centre of the net, either side, and this high. */
const SHOT_AIM_Y: [number, number] = [0.35, 0.75];
const SHOT_AIM_Z: [number, number] = [0.1, 0.8];
/** Dumps go to a spot this deep and this wide (attack-relative m), chipped up at this vertical speed (m/s). */
const DUMP_SPOT = { x: 25.5, y: 8 };
const DUMP_VZ = 2;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 0 (nobody within 5 m) to 1 (an opponent on top of him). */
export function pressureOn(state: GameState, s: SkaterState): number {
  return clamp((5 - nearestOpponentDist(state, s)) / 4, 0, 1);
}

/** The players `ids` may not pick the puck up for RELEASE_NO_PICKUP_SECONDS. */
export function blockPickup(state: GameState, ids: string[]): void {
  state.pickupBlock = { ids, untilTick: state.tick + Math.round(RELEASE_NO_PICKUP_SECONDS / DT) };
}

function skaterById(state: GameState, id: string): SkaterState {
  for (const s of state.skaters) if (s.id === id) return s;
  throw new Error(`no skater ${id}`);
}

/** The carrier lets the puck go with this velocity; it becomes loose and he cannot re-take it at once. */
function release(state: GameState, from: SkaterState, vx: number, vy: number, vz: number): void {
  const p = state.puck;
  p.vel.x = vx;
  p.vel.y = vy;
  p.z = 0;
  p.vz = vz;
  state.carrierId = null;
  state.lastTouch = { id: from.id, side: from.side };
  state.possession = from.side;
  state.pendingPass = null;
  blockPickup(state, [from.id]);
}

const event = (state: GameState, e: Omit<GameEvent, 'tick' | 'period' | 'clock'>): GameEvent =>
  ({ tick: state.tick, period: state.period, clock: state.clock, ...e });

/**
 * Pass along the ice to `toId`, led to where he will be. Speed 13 + passing * 0.09 m/s; the direction is off by a
 * normal error that shrinks with passing and grows with pressure.
 */
export function executePass(state: GameState, fromId: string, toId: string, defs: Map<string, PlayerDef>, rng: Rng): GameEvent {
  const from = skaterById(state, fromId), to = skaterById(state, toId);
  const passing = defs.get(fromId)!.attrs.passing;
  const speed = 13 + passing * 0.09;
  const p = state.puck.pos;
  const l = hypot2(to.pos.x - p.x, to.pos.y - p.y);
  const lead = l / speed;
  const aimX = to.pos.x + to.vel.x * lead, aimY = to.pos.y + to.vel.y * lead;
  const sigma = PASS_ERROR.base + (100 - passing) * PASS_ERROR.perPoint + pressureOn(state, from) * PASS_ERROR.pressure;
  const angle = Math.atan2(aimY - p.y, aimX - p.x) + rng.gauss() * sigma;
  release(state, from, Math.cos(angle) * speed, Math.sin(angle) * speed, 0);
  state.pendingPass = { fromId, toId, untilTick: state.tick + Math.round((lead + PASS_GRACE_SECONDS) / DT) };
  return event(state, { type: 'pass', side: from.side, playerId: fromId, otherId: toId, assistIds: [], detail: `${l.toFixed(1)}m` });
}

/**
 * Shoot at the attacked net: aim at a spot inside it, missed by a normal spread from shootingAccuracy, distance and
 * pressure. Speed 22 + shootingPower * 0.2 m/s, lifted so it arrives at the aimed height. Emits `shot` when the puck is
 * headed between the posts and under the bar, `miss` otherwise.
 */
export function executeShot(state: GameState, shooterId: string, defs: Map<string, PlayerDef>, rng: Rng): GameEvent {
  const s = skaterById(state, shooterId);
  const a = defs.get(shooterId)!.attrs;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const netX = dir * RINK.goalLineX;
  const d = hypot2(netX - p.x, p.y);
  const sigma = SHOT_SPREAD.base + (100 - a.shootingAccuracy) * SHOT_SPREAD.perPoint + d * SHOT_SPREAD.perMetre
    + pressureOn(state, s) * SHOT_SPREAD.pressure;
  const aimY = (rng.chance(0.5) ? 1 : -1) * rng.range(SHOT_AIM_Y[0], SHOT_AIM_Y[1]);
  const aimZ = rng.range(SHOT_AIM_Z[0], SHOT_AIM_Z[1]);
  const y = aimY + rng.gauss() * sigma;
  const z = Math.max(0.02, aimZ + rng.gauss() * sigma * 0.7);
  const speed = 22 + a.shootingPower * 0.2;
  const dx = netX - p.x, dy = y - p.y;
  const l = hypot2(dx, dy) || 1;
  const t = l / speed;
  release(state, s, (dx / l) * speed, (dy / l) * speed, (z + 0.5 * GRAVITY * t * t) / t);
  const onNet = Math.abs(y) < RINK.netHalfWidth - PUCK_RADIUS && z < RINK.netHeight;
  const goalie = state.goalies[s.side === 'home' ? 'away' : 'home'].id;
  return event(state, {
    type: onNet ? 'shot' : 'miss', side: s.side, playerId: shooterId, otherId: goalie, assistIds: [], detail: `${d.toFixed(1)}m`,
  });
}

/**
 * Chip the puck deep into the attacked end, toward one corner (picked at random), with a passing-based direction error.
 * Emits a `pass` event with detail `dump` and no receiver.
 */
export function executeDump(state: GameState, fromId: string, defs: Map<string, PlayerDef>, rng: Rng): GameEvent {
  const s = skaterById(state, fromId);
  const passing = defs.get(fromId)!.attrs.passing;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const tx = dir * DUMP_SPOT.x, ty = (rng.chance(0.5) ? 1 : -1) * DUMP_SPOT.y;
  const speed = 16 + passing * 0.05;
  const sigma = 1.5 * (PASS_ERROR.base + (100 - passing) * PASS_ERROR.perPoint);
  const angle = Math.atan2(ty - p.y, tx - p.x) + rng.gauss() * sigma;
  release(state, s, Math.cos(angle) * speed, Math.sin(angle) * speed, DUMP_VZ);
  return event(state, { type: 'pass', side: s.side, playerId: fromId, otherId: null, assistIds: [], detail: 'dump' });
}
