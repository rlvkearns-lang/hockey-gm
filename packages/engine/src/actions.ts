import { DT as DT_ } from './constants';
import { RINK as RINK_ } from './rink';
import type { Rng } from './rng';
import { nearestOpponentDist as nearestOpponentDist_, steeredByContest as steeredByContest_ } from './team-play';
import { TUNING as TUNING_ } from './tuning';
import { watchTurnover as watchTurnover_ } from './turnovers';
import { gameEvent as gameEvent_ } from './events';
import type { GameEvent, GameState, PlayerDef, Side, SkaterState } from './types';
import { hypot2 as hypot2_, segDistXY as segDistXY_, type Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { clamp as clamp_, GRAVITY as GRAVITY_, skaterById as skaterById_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const DT = DT_;
const RINK = RINK_;
const nearestOpponentDist = nearestOpponentDist_;
const steeredByContest = steeredByContest_;
const TUNING = TUNING_;
const watchTurnover = watchTurnover_;
const gameEvent = gameEvent_;
const hypot2 = hypot2_;
const segDistXY = segDistXY_;
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;
const clamp = clamp_;
const GRAVITY = GRAVITY_;
const skaterById = skaterById_;

/** After a release (draw, pass, shot, dump), the releasing players cannot pick the puck up again for this long. */
export const RELEASE_NO_PICKUP_SECONDS = 0.3;
/** Upward speed (m/s) a shot can be lifted with, at most: about 5 m high at the top of its flight. */
const MAX_SHOT_LIFT = 10;
const PASS = TUNING.pass;
const SHOT = TUNING.shot;
const DUMP = TUNING.dump;


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

/**
 * The carrier lets the puck go with this velocity; it becomes loose and he cannot re-take it at once. Released from
 * his own half (behind the centre line), it is watched for icing until someone touches it. With `out`, a `release`
 * event (of `kind`, toward `toId`) goes into it.
 */
function release(
  state: GameState, from: SkaterState, vx: number, vy: number, vz: number,
  out: GameEvent[] | null = null, kind: 'pass' | 'shot' | 'dump' = 'pass', toId: string | null = null,
): void {
  const p = state.puck;
  if (out) out.push(gameEvent(state, { type: 'release', side: from.side, playerId: from.id, otherId: toId, pos: p.pos, detail: { kind, toId, vel: { x: vx, y: vy, z: vz } } }));
  recordTouch(state, from.id, from.side); // his touch lasts until he lets it go
  state.icingWatch = p.pos.x * state.attackDir[from.side] < 0 ? { side: from.side, fromY: p.pos.y } : null;
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

/**
 * Pass along the ice to `toId`, led to where he will be. Speed TUNING.pass.speed (base + per point of passing); off by a
 * normal error that shrinks with passing and grows with pressure. Its `release` and `pass` events go into `out`.
 */
export function executePass(state: GameState, fromId: string, toId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const from = skaterById(state, fromId), to = skaterById(state, toId);
  const passing = defs.get(fromId)!.attrs.passing;
  const speed = PASS.speed.base + passing * PASS.speed.perPoint;
  const p = state.puck.pos;
  const l = hypot2(to.pos.x - p.x, to.pos.y - p.y);
  const lead = l / speed;
  const aimX = to.pos.x + to.vel.x * lead, aimY = to.pos.y + to.vel.y * lead;
  const pressure = pressureOn(state, from);
  const sigma = PASS.error.base + (100 - passing) * PASS.error.perPoint + pressure * PASS.error.pressure;
  const angle = datan2(aimY - p.y, aimX - p.x) + rng.gauss() * sigma;
  out.push(gameEvent(state, { type: 'pass', side: from.side, playerId: fromId, otherId: toId, pos: p, detail: { kind: 'pass', distance: l } }));
  release(state, from, dcos(angle) * speed, dsin(angle) * speed, 0, out, 'pass', toId);
  state.pendingPass = { fromId, toId, untilTick: state.tick + Math.round((lead + PASS.graceSeconds) / DT), tried: [], pressure };
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
 * normal spread from shootingAccuracy, distance and pressure, or now and then mishit wide or high (TUNING.shot.wild).
 * Speed TUNING.shot.speed (base + per point of power), lifted so it arrives at the aimed height. No event yet: the release is recorded in `state.shotInFlight`, and what happens to the
 * puck decides whether it is a shot on goal, a miss, a post or a block. Its `release` event goes into `out`.
 */
export function executeShot(state: GameState, shooterId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const s = skaterById(state, shooterId);
  const a = defs.get(shooterId)!.attrs;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const netX = dir * RINK.goalLineX;
  const d = hypot2(netX - p.x, p.y);
  const pressure = pressureOn(state, s);
  const sigma = SHOT.spread.base + (100 - a.shootingAccuracy) * SHOT.spread.perPoint + d * SHOT.spread.perMetre
    + pressure * SHOT.spread.pressure;
  const shade = goalieShade(state, s.side);
  const openSide = shade > 0 ? -1 : 1;
  const aimSide = rng.chance(clamp(0.5 + Math.abs(shade) * SHOT.openSidePull, 0.5, SHOT.openSideMax)) ? openSide : -openSide;
  // A weaker shooter aims nearer the middle: he just wants it on net.
  const aimY = aimSide * rng.range(SHOT.aimY[0], SHOT.aimY[1]) * (SHOT.aimReach.base + SHOT.aimReach.perPoint * a.shootingAccuracy);
  const aimZ = rng.range(SHOT.aimZ[0], SHOT.aimZ[1]);
  let y = aimY + rng.gauss() * sigma;
  let z = Math.max(0.02, aimZ + rng.gauss() * sigma * 0.7);
  // Besides that spread, some shots are mishit or rushed and miss the net outright, wide of the post he aimed beside
  // or over the bar (more often for a poor shooter under pressure, from far out): most missed shots come from here.
  const W = SHOT.wild;
  if (rng.chance(clamp(W.base + (100 - a.shootingAccuracy) * W.perPoint + pressure * W.pressure + d * W.perMetre, 0.03, 0.97))) {
    const by = W.clear + Math.abs(rng.gauss()) * W.spread;
    if (rng.chance(W.highShare)) z = RINK.netHeight + by;
    else y = aimSide * (RINK.netHalfWidth + by);
  }
  const speed = SHOT.speed.base + a.shootingPower * SHOT.speed.perPoint;
  const dx = netX - p.x, dy = y - p.y;
  const l = hypot2(dx, dy) || 1;
  const t = l / speed;
  const from = { x: p.x, y: p.y };
  // Lifted to arrive at height z, but never harder than MAX_SHOT_LIFT (from beside the net that would launch it skyward).
  release(state, s, (dx / l) * speed, (dy / l) * speed, Math.min(MAX_SHOT_LIFT, (z + 0.5 * GRAVITY * t * t) / t), out, 'shot');
  state.shotInFlight = { shooterId, side: s.side, from, fromDist: d, tick: state.tick, blockTried: [] };
}

/**
 * Chip the puck deep into the attacked end, toward one corner (picked at random), with a passing-based direction error.
 * Its `pass` event (kind `dump`, no receiver) and `release` event go into `out`.
 */
export function executeDump(state: GameState, fromId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const s = skaterById(state, fromId);
  const passing = defs.get(fromId)!.attrs.passing;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const tx = dir * DUMP.spot.x, ty = (rng.chance(0.5) ? 1 : -1) * DUMP.spot.y;
  const speed = DUMP.speed.base + passing * DUMP.speed.perPoint;
  const sigma = DUMP.errorFactor * (PASS.error.base + (100 - passing) * PASS.error.perPoint);
  const angle = datan2(ty - p.y, tx - p.x) + rng.gauss() * sigma;
  out.push(gameEvent(state, { type: 'pass', side: s.side, playerId: fromId, otherId: null, pos: p, detail: { kind: 'dump', distance: null } }));
  release(state, s, dcos(angle) * speed, dsin(angle) * speed, DUMP.vz, out, 'dump');
}

/**
 * Chance that `d` intercepts a pass going `speed` m/s that comes within reach:
 * base + stickChecking * perStick + defensivePositioning * perPositioning (TUNING.pass.intercept), scaled down for fast
 * passes, then clamped to [0.03, 0.97].
 */
export function interceptChance(d: PlayerDef, speed: number): number {
  const base = PASS.intercept.base + d.attrs.stickChecking * PASS.intercept.perStick + d.attrs.defensivePositioning * PASS.intercept.perPositioning;
  const [lo, hi] = PASS.interceptSpeed;
  return clamp(base * (1 - 0.5 * clamp((speed - lo) / (hi - lo), 0, 1)), 0.03, 0.97);
}

/**
 * A pass still on its way (state.pendingPass) at PASS.interceptSpeed[0] m/s or faster: each opposing skater (on the ice,
 * not leaving, not down, not steered by a contest) whose body came within PASS.interceptRange of the puck's path this tick (from
 * `prev` to its position now) gets one try. On success the pass is over and a `turnover` is returned: 60% he takes it
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
      watchTurnover(state, s.side, s.id, pass.fromId, 'intercepted', { passPressure: pass.pressure });
      state.carrierId = s.id;
      p.vel.x = s.vel.x;
      p.vel.y = s.vel.y;
    } else {
      const turn = (rng.chance(0.5) ? 1 : -1) * rng.range(PASS.deflectTurn[0], PASS.deflectTurn[1]);
      const a = datan2(p.vel.y, p.vel.x) + turn, v = speed * PASS.deflectKeep;
      p.vel.x = dcos(a) * v;
      p.vel.y = dsin(a) * v;
      blockPickup(state, [s.id]);
    }
    return {
      // The interceptor won the puck off the passer (whether it goes in the box score is turnovers.ts's call).
      event: gameEvent(state, { type: 'turnover', side: s.side, playerId: s.id, otherId: pass.fromId, pos: p.pos, detail: { how: take ? 'intercepted' : 'deflected' } }),
      taker: take ? s : null,
    };
  }
  return null;
}
