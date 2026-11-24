/**
 * A shot on its way (Task 7, moved out of goalie.ts): blocks, which stop the puck at the blocker, and the end of a shot
 * that does not reach the net (a miss or a post). A shot that reaches the net is goalie.ts resolveOnNet's.
 */
import { recordTouch as recordTouch_ } from './actions';
import { DT as DT_ } from './constants';
import { gameEvent as gameEvent_ } from './events';
import { stepPuck as stepPuck_, type PuckEvent } from './puck';
import { faceShot as faceShot_, lateSave as lateSave_, resolveOnNet as resolveOnNet_ } from './goalie';
import { tryTip as tryTip_ } from './tips';
import { RINK as RINK_ } from './rink';
import type { Rng } from './rng';
import { TUNING as TUNING_ } from './tuning';
import type { GameEvent, GameState, PlayerDef } from './types';
import { dist as dist_, hypot2 as hypot2_, type Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { clamp as clamp_, findSkater as findSkater_, other as other_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const recordTouch = recordTouch_;
const stepPuck = stepPuck_;
const faceShot = faceShot_;
const lateSave = lateSave_;
const resolveOnNet = resolveOnNet_;
const tryTip = tryTip_;
const DT = DT_;
const gameEvent = gameEvent_;
const RINK = RINK_;
const TUNING = TUNING_;
const dist = dist_;
const hypot2 = hypot2_;
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;
const clamp = clamp_;
const findSkater = findSkater_;
const other = other_;

const GOAL = RINK.goalLineX;
const BLOCK = TUNING.block;
/** A shot that slows below this (m/s), or is still going after this long (s), has missed. */
const MISS_SPEED = 3;
const SHOT_MAX_SECONDS = 3;

/**
 * A shot in flight below BLOCK.maxZ: each defender whose body the puck's path this tick passes within BLOCK.path (0.55 m) of, more
 * than BLOCK.clearOfShooter from the shooter, gets one chance, `clamp(BLOCK.base + shotBlocking * BLOCK.perPoint, 0.03, 0.97)`.
 * On a block the puck is moved to the point of its path nearest him (it stops at the blocker) and leaves at BLOCK.keep of its
 * speed, turned by up to BLOCK.spread either side of straight back. A block emits `block` into `out` (at the blocker) and ends
 * the shot.
 */
export function tryBlock(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): boolean {
  const shot = state.shotInFlight;
  const pk = state.puck;
  if (shot === null || shot.faced || shot.beat === true || pk.z >= BLOCK.maxZ) return false;
  const shooter = findSkater(state, shot.shooterId);
  const ax = pk.pos.x, ay = pk.pos.y, mx = pk.vel.x * DT, my = pk.vel.y * DT;
  const l2 = mx * mx + my * my;
  for (const s of state.skaters) {
    if (!s.onIce || s.leaving || s.side === shot.side || s.downT > 0 || shot.blockTried.includes(s.id)) continue;
    let u = l2 === 0 ? 0 : ((s.pos.x - ax) * mx + (s.pos.y - ay) * my) / l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + mx * u, qy = ay + my * u;
    if (hypot2(s.pos.x - qx, s.pos.y - qy) > BLOCK.path) continue;
    if (shooter && dist(s.pos, shooter.pos) <= BLOCK.clearOfShooter) continue;
    shot.blockTried.push(s.id);
    if (!rng.chance(clamp(BLOCK.base + defs.get(s.id)!.attrs.shotBlocking * BLOCK.perPoint, 0.03, 0.97))) continue;
    // It stops at him: at the point of its path nearest his body.
    pk.pos.x = qx;
    pk.pos.y = qy;
    const speed = hypot2(pk.vel.x, pk.vel.y) * rng.range(BLOCK.keep[0], BLOCK.keep[1]);
    const angle = datan2(pk.vel.y, pk.vel.x) + Math.PI + rng.range(-BLOCK.spread, BLOCK.spread);
    pk.vel.x = dcos(angle) * speed;
    pk.vel.y = dsin(angle) * speed;
    pk.z = 0;
    pk.vz = 0;
    state.shotInFlight = null;
    state.lastTouch = { id: s.id, side: s.side };
    recordTouch(state, s.id, s.side);
    out.push(gameEvent(state, { type: 'block', side: s.side, playerId: s.id, otherId: shot.shooterId, pos: pk.pos, detail: { distance: shot.fromDist, releaseTick: shot.tick } }));
    return true;
  }
  return false;
}

/**
 * Ends a shot in flight that did not reach the net this tick: `post` when it hit a post of the attacked net, `miss`
 * when it went wide or over, hit the boards, turned away from the net, slowed below 3 m/s, was picked up, or is still
 * going after 3 s. Call after the puck step and pickup (an `onNet` goes to resolveOnNet instead).
 */
export function trackShot(state: GameState, puckEvents: PuckEvent[], out: GameEvent[] = [], defs?: Map<string, PlayerDef>, rng?: Rng): void {
  const shot = state.shotInFlight;
  if (shot === null) return;
  if (shot.faced) {
    // A shot past the goalie is on its way in (resolveOnNet scores it at the line); one that turns back or stops short
    // (a fallback) was saved after all.
    const pk0 = state.puck, end0 = state.attackDir[shot.side];
    if (state.carrierId !== null || pk0.vel.x * end0 <= 0 || hypot2(pk0.vel.x, pk0.vel.y) < MISS_SPEED || (state.tick - shot.tick) * DT > SHOT_MAX_SECONDS) lateSave(state, defs, out, rng);
    return;
  }
  const end = state.attackDir[shot.side];
  const pk = state.puck;
  let post = false, gone = false;
  for (const ev of puckEvents) {
    if (ev.kind === 'post' && ev.end === end) post = true;
    else if (ev.kind === 'boards' || ev.kind === 'overNet') gone = true;
  }
  if (!post) {
    gone = gone || state.carrierId !== null || pk.pos.x * end > GOAL || pk.vel.x * end <= 0
      || hypot2(pk.vel.x, pk.vel.y) < MISS_SPEED || (state.tick - shot.tick) * DT > SHOT_MAX_SECONDS;
    if (!gone) return;
  }
  state.shotInFlight = null;
  // After a tip it is the tipper's, from the shooter (Task 8).
  const e = { side: shot.side, playerId: shot.tippedBy ?? shot.shooterId, otherId: state.goalies[other(shot.side)].id, pos: pk.pos, detail: { distance: shot.fromDist, releaseTick: shot.tick, tippedFrom: shot.tippedBy !== null ? shot.shooterId : null } };
  out.push(post ? gameEvent(state, { type: 'post', ...e }) : gameEvent(state, { type: 'miss', ...e }));
}

const NO_PUCK_EVENTS: PuckEvent[] = [];

/**
 * The loose puck's move this tick (Task 8), in this order: a tip in front (tips.ts tryTip), a block (tryBlock), the goalie
 * facing a shot at his plane (goalie.ts faceShot), then the puck's step and, when it reaches the goal line, resolveOnNet.
 * After a tip or a save the puck has gone its way to the stick or the goalie and is not stepped again this tick (no
 * puck moves further in a tick than its speed allows). Writes the puck's position before the step into `prev` (the
 * stick, block or save point when there is one). Returns the step's puck events and whether it reached the net.
 */
export function moveLoosePuck(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[], prev: Vec2): { puckEvents: PuckEvent[]; onNet: boolean } {
  const pk = state.puck;
  let moved = !tryTip(state, defs, rng, out);
  if (moved) {
    tryBlock(state, defs, rng, out);
    if (faceShot(state, defs, rng, out) && state.shotInFlight === null) moved = false;
  }
  prev.x = pk.pos.x;
  prev.y = pk.pos.y;
  if (!moved || state.phase !== 'live') return { puckEvents: NO_PUCK_EVENTS, onNet: false };
  const puckEvents = stepPuck(pk, DT);
  for (const ev of puckEvents) {
    if (ev.kind !== 'onNet') continue;
    resolveOnNet(state, ev, defs, rng, out);
    return { puckEvents, onNet: true };
  }
  return { puckEvents, onNet: false };
}
