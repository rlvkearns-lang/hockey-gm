import { DT } from './constants';
import { RINK } from './rink';
import type { Rng } from './rng';
import { nearestOpponentDist } from './team-play';
import type { GameEvent, GameState, PlayerDef, Side, SkaterState } from './types';
import { hypot2 } from './vec';

/** After a release (draw, pass, shot, dump), the releasing players cannot pick the puck up again for this long. */
export const RELEASE_NO_PICKUP_SECONDS = 0.3;
const GRAVITY = 9.81;
/** A pass stays "pending" (its receiver chases it) for its travel time plus this long. */
const PASS_GRACE_SECONDS = 1;
/** Pass direction error (rad, one standard deviation): a floor, per point of passing below 100, and at full pressure. */
const PASS_ERROR = { base: 0.008, perPoint: 0.0011, pressure: 0.03 };
/** Shot spread at the net (m, one standard deviation): a floor, per point of accuracy below 100, per metre out, at full pressure. */
const SHOT_SPREAD = { base: 0.1, perPoint: 0.006, perMetre: 0.008, pressure: 0.25 };
/** Shooters aim this far (m) from the centre of the net, either side, and this high. */
const SHOT_AIM_Y: [number, number] = [0.35, 0.75];
const SHOT_AIM_Z: [number, number] = [0.1, 0.8];
/** Chance of aiming at the open side: 0.5, plus this per metre the goalie is shaded off centre, at most OPEN_SIDE_MAX. */
const OPEN_SIDE_PULL = 0.6;
const OPEN_SIDE_MAX = 0.8;
/** Dumps go to a spot this deep and this wide (attack-relative m), chipped up at this vertical speed (m/s). */
const DUMP_SPOT = { x: 25.5, y: 8 };
const DUMP_VZ = 2;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 0 (nobody within 5 m) to 1 (an opponent on top of him). */
export function pressureOn(state: GameState, s: SkaterState): number {
  return clamp((5 - nearestOpponentDist(state, s)) / 4, 0, 1);
}

/** Longest touch chain kept: the scorer, two assists, and room for repeats. */
const MAX_TOUCHES = 6;

/** `id` of `side` has the puck: a new team starts a new chain; a new player of the same team joins it. */
export function recordTouch(state: GameState, id: string, side: Side): void {
  state.icingWatch = null;
  const t = state.touches;
  state.lastAttackTouch[side] = id;
  if (t.side !== side) { t.side = side; t.ids.length = 0; t.ids.push(id); return; }
  if (t.ids[t.ids.length - 1] === id) return;
  t.ids.push(id);
  if (t.ids.length > MAX_TOUCHES) t.ids.shift();
}

/** The players `ids` may not pick the puck up for RELEASE_NO_PICKUP_SECONDS. */
export function blockPickup(state: GameState, ids: string[]): void {
  state.pickupBlock = { ids, untilTick: state.tick + Math.round(RELEASE_NO_PICKUP_SECONDS / DT) };
}

function skaterById(state: GameState, id: string): SkaterState {
  for (const s of state.skaters) if (s.id === id) return s;
  throw new Error(`no skater ${id}`);
}

/**
 * The carrier lets the puck go with this velocity; it becomes loose and he cannot re-take it at once. Released from
 * his own half (behind the centre line), it is watched for icing until someone touches it.
 */
function release(state: GameState, from: SkaterState, vx: number, vy: number, vz: number): void {
  const p = state.puck;
  state.icingWatch = p.pos.x * state.attackDir[from.side] < 0
    ? { side: from.side, fromX: p.pos.x, fromY: p.pos.y, tick: state.tick } : null;
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

/** `fromId` (the carrier) lets the puck go with velocity (vx, vy, vz) m/s: the release behind every pass, shot and dump. */
export function releasePuck(state: GameState, fromId: string, vx: number, vy: number, vz: number): void {
  release(state, skaterById(state, fromId), vx, vy, vz);
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
 * Where across the attacked goal line (y, m) the defending goalie stands in the way, seen from the puck: 0 when he
 * is square to it, positive when he is shaded to +y (so the -y side is open).
 */
export function goalieShade(state: GameState, attackingSide: Side): number {
  const dir = state.attackDir[attackingSide];
  const g = state.goalies[attackingSide === 'home' ? 'away' : 'home'].pos;
  const p = state.puck.pos;
  const netX = dir * RINK.goalLineX;
  const gx = (g.x - p.x) * dir, nx = (netX - p.x) * dir;
  if (gx <= 0.1 || nx <= 0) return 0;
  return clamp(p.y + ((g.y - p.y) * nx) / gx, -RINK.netHalfWidth, RINK.netHalfWidth);
}

/**
 * Shoot at the attacked net: aim at a spot inside it (more often on the side the goalie leaves open), missed by a
 * normal spread from shootingAccuracy, distance and pressure. Speed 22 + shootingPower * 0.2 m/s, lifted so it
 * arrives at the aimed height. No event yet: the release is recorded in `state.shotInFlight`, and what happens to the
 * puck decides whether it is a shot on goal, a miss, a post or a block.
 */
export function executeShot(state: GameState, shooterId: string, defs: Map<string, PlayerDef>, rng: Rng): void {
  const s = skaterById(state, shooterId);
  const a = defs.get(shooterId)!.attrs;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const netX = dir * RINK.goalLineX;
  const d = hypot2(netX - p.x, p.y);
  const sigma = SHOT_SPREAD.base + (100 - a.shootingAccuracy) * SHOT_SPREAD.perPoint + d * SHOT_SPREAD.perMetre
    + pressureOn(state, s) * SHOT_SPREAD.pressure;
  const shade = goalieShade(state, s.side);
  const openSide = shade > 0 ? -1 : 1;
  const aimSide = rng.chance(clamp(0.5 + Math.abs(shade) * OPEN_SIDE_PULL, 0.5, OPEN_SIDE_MAX)) ? openSide : -openSide;
  const aimY = aimSide * rng.range(SHOT_AIM_Y[0], SHOT_AIM_Y[1]);
  const aimZ = rng.range(SHOT_AIM_Z[0], SHOT_AIM_Z[1]);
  const y = aimY + rng.gauss() * sigma;
  const z = Math.max(0.02, aimZ + rng.gauss() * sigma * 0.7);
  const speed = 22 + a.shootingPower * 0.2;
  const dx = netX - p.x, dy = y - p.y;
  const l = hypot2(dx, dy) || 1;
  const t = l / speed;
  const from = { x: p.x, y: p.y };
  release(state, s, (dx / l) * speed, (dy / l) * speed, (z + 0.5 * GRAVITY * t * t) / t);
  state.shotInFlight = { shooterId, side: s.side, from, fromDist: d, tick: state.tick, blockTried: [] };
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
