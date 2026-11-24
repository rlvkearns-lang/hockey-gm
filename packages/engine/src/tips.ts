/**
 * Tips in front (Task 8): an attacker near the net with his stick blade in a shot's path deflects it. After a tip the
 * shot is his (playerId of its shot, goal, miss or post), with the shooter as `tippedFrom` and the first assist.
 */
import { recordTouch as recordTouch_ } from './actions';
import { composite as composite_ } from './attributes';
import { bladePos as bladePos_ } from './blade';
import { DT as DT_ } from './constants';
import { gameEvent as gameEvent_ } from './events';
import { RINK as RINK_ } from './rink';
import type { Rng } from './rng';
import { TUNING as TUNING_ } from './tuning';
import type { GameEvent, GameState, PlayerDef } from './types';
import { hypot2 as hypot2_, type Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { clamp as clamp_ } from './util';
import { tieOf, tiedChance } from './engage-state';
const recordTouch = recordTouch_;
const composite = composite_;
const bladePos = bladePos_;
const DT = DT_;
const gameEvent = gameEvent_;
const RINK = RINK_;
const TUNING = TUNING_;
const hypot2 = hypot2_;
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;
const clamp = clamp_;

const T = TUNING.tip;
const HAND_EYE = { puckHandling: 0.5, shootingAccuracy: 0.3, iq: 0.2 };
const blade: Vec2 = { x: 0, y: 0 };

/** Hand-eye for a tip: puckHandling .5, shootingAccuracy .3, iq .2. Chance: TUNING.tip.base (0.10) + TUNING.tip.perPoint (0.004) * (handEye - 50), clamped to [0.03, 0.97]. */
export function tipChance(d: PlayerDef, tie = 0): number {
  // A tied-up man (Task 10) tips it less often: times 1 - TUNING.engage.limits.tip * his tie, never never.
  return tiedChance(clamp(T.base + T.perPoint * (composite(d.attrs, HAND_EYE) - 50), 0.03, 0.97), tie, TUNING.engage.limits.tip);
}

/**
 * A shot in flight below TUNING.tip.maxZ (1.2 m), released TUNING.tip.minDistance (9 m) or more out, not yet tipped nor
 * past the goalie: each attacker but the shooter within TUNING.tip.netRange (4.5 m) of the net centre, in front of the
 * goal line, not down, not leaving and not tied up, whose stick blade is within TUNING.tip.reach (0.9 m) of the puck's path
 * this tick gets one try (shot.tipTried). A tip moves the puck to the point of its path nearest his blade, turns it by
 * gauss * TUNING.tip.turn (0.12 rad), changes vz by gauss * TUNING.tip.lift (2.5 m/s), keeps 0.85 of its speed, records his
 * touch, sets shot.tippedBy (and the shot's `from` to where it was tipped) and emits `tip`. It may now miss the net. The
 * caller does not step the puck again this tick (it has gone its way to the tip).
 */
export function tryTip(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): boolean {
  const shot = state.shotInFlight;
  const pk = state.puck;
  if (shot === null || shot.faced || shot.beat === true || shot.tippedBy !== null || pk.z >= T.maxZ || shot.fromDist < T.minDistance) return false;
  const end = state.attackDir[shot.side];
  const nx = end * RINK.goalLineX;
  const ax = pk.pos.x, ay = pk.pos.y, mx = pk.vel.x * DT, my = pk.vel.y * DT;
  const l2 = mx * mx + my * my;
  if (l2 === 0) return false;
  for (const s of state.skaters) {
    if (!s.onIce || s.leaving || s.side !== shot.side || s.downT > 0 || s.id === shot.shooterId || shot.tipTried.includes(s.id)) continue;
    if (hypot2(s.pos.x - nx, s.pos.y) > T.netRange || s.pos.x * end >= RINK.goalLineX) continue;
    let tied = false;
    for (const t of state.tiedUpUntil) if (t.id === s.id && state.tick < t.tick) tied = true;
    if (tied) continue;
    const d = defs.get(s.id)!;
    const b = bladePos(s.pos, s.facing, d.shoots, blade);
    let u = ((b.x - ax) * mx + (b.y - ay) * my) / l2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = ax + mx * u, qy = ay + my * u;
    if (hypot2(b.x - qx, b.y - qy) > T.reach) continue;
    shot.tipTried.push(s.id);
    if (!rng.chance(tipChance(d, state.engagements.length > 0 ? tieOf(state, s.id) : 0))) continue;
    // Off his stick: from where it met it, turned, lifted or knocked down, a little slower.
    pk.pos.x = qx;
    pk.pos.y = qy;
    const speed = hypot2(pk.vel.x, pk.vel.y) * T.keep;
    const a = datan2(pk.vel.y, pk.vel.x) + rng.gauss() * T.turn;
    pk.vel.x = dcos(a) * speed;
    pk.vel.y = dsin(a) * speed;
    // Its height at the blade, then lifted or knocked down.
    pk.z = Math.max(0, pk.z + pk.vz * DT * u);
    pk.vz = pk.vz * T.keep + rng.gauss() * T.lift;
    if (pk.z === 0 && pk.vz < 0) pk.vz = 0;
    shot.tippedBy = s.id;
    shot.from = { x: qx, y: qy };
    shot.fromDist = hypot2(nx - qx, qy);
    state.lastTouch = { id: s.id, side: s.side };
    recordTouch(state, s.id, s.side);
    out.push(gameEvent(state, { type: 'tip', side: s.side, playerId: s.id, otherId: shot.shooterId, pos: pk.pos, detail: { releaseTick: shot.tick, vel: { x: pk.vel.x, y: pk.vel.y, z: pk.vz } } }));
    return true;
  }
  return false;
}
