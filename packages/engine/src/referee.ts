import { gameEvent } from './events';
import { stopPlay } from './faceoff';
import { FACEOFF_DOTS, RINK } from './rink';
import { bodyRadius, movementOf } from './skating';
import type { GameEvent, GameState, PlayerDef, Side, SkaterState } from './types';
import type { Vec2 } from './vec';

const SIDES = ['home', 'away'] as const;
const BLUE = RINK.blueLineX;
const GOAL = RINK.goalLineX;
/** The puck has fully crossed a line once its centre is this far (its radius, m) past it. */
const PUCK_RADIUS = 0.05;
/** Attack-relative x of the end-zone faceoff dots: the line the hybrid-icing race is to. */
const DOT_LINE = Math.abs(FACEOFF_DOTS.end[0]!.x);
/** A typical skater (every attribute 70, 85 kg), used when refereeTick is given no player definitions. */
const TYPICAL = { radius: 0.38, topSpeed: 8.74, accel: 9.2 };

type Racer = { topSpeed: number; accel: number };

function skaterById(state: GameState, id: string | null): SkaterState | null {
  if (id === null) return null;
  for (const s of state.skaters) if (s.id === id) return s;
  return null;
}

/** The dot of `dots` on the `end` side of centre (+1 or -1 along x) nearest to `y` across the ice. */
function dotNear(dots: Vec2[], end: 1 | -1, y: number): Vec2 {
  let best = dots[0]!, bestD = Infinity;
  for (const d of dots) {
    if (d.x * end <= 0) continue;
    const dd = Math.abs(d.y - y);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/**
 * Seconds `s` needs to reach attack-relative x `line` (attacking toward `dir`): from where he is and his speed toward
 * it, accelerating at `m.accel` up to `m.topSpeed`. 0 if he is already there.
 */
function timeToLine(s: SkaterState, line: number, dir: 1 | -1, m: Racer): number {
  const d = line - s.pos.x * dir;
  if (d <= 0) return 0;
  const top = m.topSpeed, a = m.accel;
  const v0 = Math.max(-top, Math.min(top, s.vel.x * dir));
  const dAccel = (top * top - v0 * v0) / (2 * a);
  if (d <= dAccel) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
  return (top - v0) / a + (d - dAccel) / top;
}

/**
 * Offside, icing and their whistles, once per live tick after the puck has moved (prevPuckX is where it was before).
 * Does nothing unless play is live (a goal or freeze may already have stopped it this tick).
 *
 * - Offside: when the puck fully crosses a team's attacking blue line, last played by that team, with one of its
 *   skaters other than the carrier wholly in the zone (his centre past the line by more than his body radius), a
 *   delayed offside starts. That team touching the puck (having a carrier) stops play for a faceoff at the neutral
 *   dot outside that blue line nearest where the puck went in; so a puck carried in with a teammate ahead of it is
 *   whistled at once. The delayed offside is waved off when the puck fully leaves the zone or none of the team is
 *   wholly in it.
 * - Hybrid icing: a puck released from a team's own half (`state.icingWatch`) that fully crosses the far goal line
 *   untouched (a puck on net stops on the line instead) is icing when a defending skater, not the goalie, would reach
 *   the end-zone dot line no later than any of that team's skaters; otherwise it is waved off. Faceoff at the
 *   offending team's end dot nearest the release, and that team may not change (`state.noChange`). With a delayed
 *   offside against the same team still on, the offside is called instead (it happened first).
 *
 * `defs` gives body radii and skating for the race; without it every skater is a typical one.
 */
export function refereeTick(state: GameState, prevPuckX: number, defs?: Map<string, PlayerDef>): GameEvent | null {
  if (state.phase !== 'live') return null;
  const puck = state.puck.pos;
  const carrier = skaterById(state, state.carrierId);
  const playedBy: Side | null = carrier ? carrier.side : state.lastTouch?.side ?? null;

  for (const side of SIDES) {
    const dir = state.attackDir[side];
    const prev = prevPuckX * dir, now = puck.x * dir;
    if (state.delayedOffside === null && playedBy === side && prev <= BLUE + PUCK_RADIUS && now > BLUE + PUCK_RADIUS
      && firstInZone(state, side, carrier, defs) !== null) state.delayedOffside = { side, y: puck.y };
    const watch = state.icingWatch;
    if (watch !== null && watch.side === side && prev <= GOAL + PUCK_RADIUS && now > GOAL + PUCK_RADIUS) {
      state.icingWatch = null;
      const call = hybridIcing(state, side, dir, watch.fromY, defs);
      if (call) return call;
    }
  }

  const off = state.delayedOffside;
  if (off === null) return null;
  const dir = state.attackDir[off.side];
  if (carrier && carrier.side === off.side) {
    const offender = firstInZone(state, off.side, carrier, defs);
    const spot = dotNear(FACEOFF_DOTS.neutral, dir, off.y);
    const e = call(state, 'offside', off.side, carrier.id, offender?.id ?? null, spot);
    stopPlay(state, spot);
    return e;
  }
  if (puck.x * dir < BLUE - PUCK_RADIUS || firstInZone(state, off.side, null, defs) === null) state.delayedOffside = null;
  return null;
}

/**
 * The first on-ice skater of `side` other than `except` wholly inside its attacking zone (his centre past the blue
 * line by more than his body radius), or null.
 */
function firstInZone(state: GameState, side: Side, except: SkaterState | null, defs: Map<string, PlayerDef> | undefined): SkaterState | null {
  const dir = state.attackDir[side];
  for (const s of state.skaters) {
    if (!s.onIce || s.side !== side || s === except) continue;
    const r = defs ? bodyRadius(defs.get(s.id)!.weightKg) : TYPICAL.radius;
    if (s.pos.x * dir > BLUE + r) return s;
  }
  return null;
}

/**
 * The race for a puck iced by `side` (attacking toward `dir`, released at y = fromY): the icing call (the offside call
 * when a delayed offside against `side` is on), or null when one of its skaters would get to the dot line first.
 */
function hybridIcing(state: GameState, side: Side, dir: 1 | -1, fromY: number, defs: Map<string, PlayerDef> | undefined): GameEvent | null {
  const racer = (s: SkaterState): Racer => (defs ? movementOf(defs.get(s.id)!, s.energy) : TYPICAL);
  let defT = Infinity, attT = Infinity;
  let defender: string | null = null;
  for (const s of state.skaters) {
    if (!s.onIce || s.downT > 0) continue;
    const t = timeToLine(s, DOT_LINE, dir, racer(s));
    if (s.side === side) attT = Math.min(attT, t);
    else if (t < defT) { defT = t; defender = s.id; }
  }
  if (defender === null || defT > attT) return null;
  // Untouched since the release, so the last touch is the releaser's.
  const shooter = state.lastTouch !== null && state.lastTouch.side === side ? state.lastTouch.id : null;
  const off = state.delayedOffside;
  if (off !== null && off.side === side) {
    // It went in offside first: the offside is the call.
    const offender = firstInZone(state, side, null, defs);
    const spot = dotNear(FACEOFF_DOTS.neutral, dir, off.y);
    const e = call(state, 'offside', side, shooter, offender?.id ?? null, spot);
    stopPlay(state, spot);
    return e;
  }
  const spot = dotNear(FACEOFF_DOTS.end, (-dir) as 1 | -1, fromY);
  const e = call(state, 'icing', side, shooter, defender, spot);
  stopPlay(state, spot);
  state.noChange = side;
  return e;
}

/** An offside or icing call against `side` (pos: the puck), with the faceoff `spot`. */
function call(state: GameState, type: 'offside' | 'icing', side: Side, playerId: string | null, otherId: string | null, spot: Vec2): GameEvent {
  const fields = { side, playerId, otherId, pos: state.puck.pos, detail: { spot: { x: spot.x, y: spot.y } } };
  return type === 'offside' ? gameEvent(state, { type: 'offside', ...fields }) : gameEvent(state, { type: 'icing', ...fields });
}
