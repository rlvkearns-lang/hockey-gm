import { DT } from './constants';
import { RINK } from './rink';
import type { Rng } from './rng';
import { nearestOpponentDist, steeredByContest } from './team-play';
import { TUNING } from './tuning';
import type { GameEvent, GameState, PlayerDef, Side, SkaterState } from './types';
import { hypot2, segDistXY, type Vec2 } from './vec';

/** After a release (draw, pass, shot, dump), the releasing players cannot pick the puck up again for this long. */
export const RELEASE_NO_PICKUP_SECONDS = 0.3;
const GRAVITY = 9.81;
const PASS = TUNING.pass;
const SHOT = TUNING.shot;
const DUMP = TUNING.dump;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 0 (nobody within 5 m) to 1 (an opponent on top of him). */
export function pressureOn(state: GameState, s: SkaterState): number {
  return clamp((5 - nearestOpponentDist(state, s)) / 4, 0, 1);
}

/** Longest touch chain kept: the scorer, two assists, and room for repeats. */
const MAX_TOUCHES = 6;

/** `id` of `side` has the puck now: a new team starts a new chain; a new player of the same team joins it. */
export function recordTouch(state: GameState, id: string, side: Side): void {
  state.icingWatch = null;
  const t = state.touches;
  state.lastAttackTouch[side] = id;
  if (t.side !== side) { t.side = side; t.ids.length = 0; t.ticks.length = 0; t.ids.push(id); t.ticks.push(state.tick); return; }
  if (t.ids[t.ids.length - 1] === id) { t.ticks[t.ticks.length - 1] = state.tick; return; }
  t.ids.push(id);
  t.ticks.push(state.tick);
  if (t.ids.length > MAX_TOUCHES) { t.ids.shift(); t.ticks.shift(); }
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
  recordTouch(state, from.id, from.side); // his touch lasts until he lets it go
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
  state.lastRelease = { id: from.id, tick: state.tick };
  blockPickup(state, [from.id]);
}

/** `fromId` (the carrier) lets the puck go with velocity (vx, vy, vz) m/s: the release behind every pass, shot and dump. */
export function releasePuck(state: GameState, fromId: string, vx: number, vy: number, vz: number): void {
  release(state, skaterById(state, fromId), vx, vy, vz);
}

const event = (state: GameState, e: Omit<GameEvent, 'tick' | 'period' | 'clock'>): GameEvent =>
  ({ tick: state.tick, period: state.period, clock: state.clock, ...e });

/**
 * Pass along the ice to `toId`, led to where he will be. Speed TUNING.pass.speed (base + per point of passing); off by a
 * normal error that shrinks with passing and grows with pressure.
 */
export function executePass(state: GameState, fromId: string, toId: string, defs: Map<string, PlayerDef>, rng: Rng): GameEvent {
  const from = skaterById(state, fromId), to = skaterById(state, toId);
  const passing = defs.get(fromId)!.attrs.passing;
  const speed = PASS.speed.base + passing * PASS.speed.perPoint;
  const p = state.puck.pos;
  const l = hypot2(to.pos.x - p.x, to.pos.y - p.y);
  const lead = l / speed;
  const aimX = to.pos.x + to.vel.x * lead, aimY = to.pos.y + to.vel.y * lead;
  const sigma = PASS.error.base + (100 - passing) * PASS.error.perPoint + pressureOn(state, from) * PASS.error.pressure;
  const angle = Math.atan2(aimY - p.y, aimX - p.x) + rng.gauss() * sigma;
  release(state, from, Math.cos(angle) * speed, Math.sin(angle) * speed, 0);
  state.pendingPass = { fromId, toId, untilTick: state.tick + Math.round((lead + PASS.graceSeconds) / DT), tried: [] };
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
 * normal spread from shootingAccuracy, distance and pressure. Speed TUNING.shot.speed (base + per point of power), lifted so it
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
  const sigma = SHOT.spread.base + (100 - a.shootingAccuracy) * SHOT.spread.perPoint + d * SHOT.spread.perMetre
    + pressureOn(state, s) * SHOT.spread.pressure;
  const shade = goalieShade(state, s.side);
  const openSide = shade > 0 ? -1 : 1;
  const aimSide = rng.chance(clamp(0.5 + Math.abs(shade) * SHOT.openSidePull, 0.5, SHOT.openSideMax)) ? openSide : -openSide;
  // A weaker shooter aims nearer the middle: he just wants it on net.
  const aimY = aimSide * rng.range(SHOT.aimY[0], SHOT.aimY[1]) * (SHOT.aimReach.base + SHOT.aimReach.perPoint * a.shootingAccuracy);
  const aimZ = rng.range(SHOT.aimZ[0], SHOT.aimZ[1]);
  const y = aimY + rng.gauss() * sigma;
  const z = Math.max(0.02, aimZ + rng.gauss() * sigma * 0.7);
  const speed = SHOT.speed.base + a.shootingPower * SHOT.speed.perPoint;
  const dx = netX - p.x, dy = y - p.y;
  const l = hypot2(dx, dy) || 1;
  const t = l / speed;
  const from = { x: p.x, y: p.y };
  release(state, s, (dx / l) * speed, (dy / l) * speed, (z + 0.5 * GRAVITY * t * t) / t);
  state.shotInFlight = { shooterId, side: s.side, from, fromDist: d, tick: state.tick, blockTried: [] };
}

/**
 * Chip the puck deep into the attacked end, toward one corner (picked at random), with a passing-based direction error.
 * Emits a `pass` event with detail `dump` and no receiver. With `onNet` he throws it at the net instead (a shoot-in:
 * detail `shootIn`); if it gets there the goalie has to play it like any puck on net.
 */
export function executeDump(state: GameState, fromId: string, defs: Map<string, PlayerDef>, rng: Rng, onNet = false): GameEvent {
  const s = skaterById(state, fromId);
  const passing = defs.get(fromId)!.attrs.passing;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const tx = dir * (onNet ? RINK.goalLineX : DUMP.spot.x), ty = onNet ? 0 : (rng.chance(0.5) ? 1 : -1) * DUMP.spot.y;
  const speed = DUMP.speed.base + passing * DUMP.speed.perPoint;
  const sigma = DUMP.errorFactor * (PASS.error.base + (100 - passing) * PASS.error.perPoint);
  const angle = Math.atan2(ty - p.y, tx - p.x) + rng.gauss() * sigma;
  release(state, s, Math.cos(angle) * speed, Math.sin(angle) * speed, DUMP.vz);
  return event(state, { type: 'pass', side: s.side, playerId: fromId, otherId: null, assistIds: [], detail: onNet ? 'shootIn' : 'dump' });
}

/**
 * Chance that `d` intercepts a pass going `speed` m/s that comes within reach:
 * clamp(base + stickChecking * perStick + defensivePositioning * perPositioning, 0.03, 0.97) (TUNING.pass.intercept),
 * scaled down for fast passes.
 */
export function interceptChance(d: PlayerDef, speed: number): number {
  const base = clamp(PASS.intercept.base + d.attrs.stickChecking * PASS.intercept.perStick + d.attrs.defensivePositioning * PASS.intercept.perPositioning, 0.03, 0.97);
  const [lo, hi] = PASS.interceptSpeed;
  return base * (1 - 0.5 * clamp((speed - lo) / (hi - lo), 0, 1));
}

/**
 * A pass still on its way (state.pendingPass) at PASS.interceptSpeed[0] m/s or faster: each opposing skater (on the ice,
 * not leaving, not down, not steered by a contest) whose body came within PASS.interceptRange of the puck's path this tick (from
 * `prev` to its position now) gets one try. On success the pass is over and a `takeaway` is returned: 60% he takes it
 * (`taker`, now the carrier; the caller puts the puck on his stick), 40% he deflects it loose (`taker` null).
 */
export function tryIntercept(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, prev: Vec2,
): { event: GameEvent; taker: SkaterState | null } | null {
  const pass = state.pendingPass;
  if (pass === null) return null;
  const p = state.puck;
  const speed = hypot2(p.vel.x, p.vel.y);
  if (speed < PASS.interceptSpeed[0] || p.z > 0) return null;
  const from = skaterById(state, pass.fromId);
  for (const s of state.skaters) {
    if (!s.onIce || s.leaving || s.downT > 0 || steeredByContest(state, s) || s.side === from.side || pass.tried.includes(s.id)) continue;
    if (segDistXY(s.pos.x, s.pos.y, prev.x, prev.y, p.pos.x, p.pos.y) > PASS.interceptRange) continue;
    pass.tried.push(s.id);
    if (!rng.chance(interceptChance(defs.get(s.id)!, speed))) continue;
    const take = rng.chance(PASS.interceptTake);
    state.pendingPass = null;
    state.lastTouch = { id: s.id, side: s.side };
    state.possession = s.side;
    recordTouch(state, s.id, s.side);
    if (take) {
      state.carrierId = s.id;
      p.vel.x = s.vel.x;
      p.vel.y = s.vel.y;
    } else {
      const turn = (rng.chance(0.5) ? 1 : -1) * rng.range(PASS.deflectTurn[0], PASS.deflectTurn[1]);
      const a = Math.atan2(p.vel.y, p.vel.x) + turn, v = speed * PASS.deflectKeep;
      p.vel.x = Math.cos(a) * v;
      p.vel.y = Math.sin(a) * v;
      blockPickup(state, [s.id]);
    }
    return {
      event: event(state, { type: 'takeaway', side: s.side, playerId: s.id, otherId: pass.fromId, assistIds: [], detail: take ? 'intercept' : 'deflect' }),
      taker: take ? s : null,
    };
  }
  return null;
}
