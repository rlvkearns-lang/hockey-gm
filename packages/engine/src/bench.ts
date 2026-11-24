import { PERIOD_SECONDS } from './constants';
import { gameEvent } from './events';
import { faceoffPosition } from './faceoff';
import { zoneOf } from './rink';
import { movementOf } from './skating';
import { phaseFor } from './team-play';
import { holdJob, indexOf } from './commit';
import { TUNING } from './tuning';
import type { BenchState, BenchUnit, GameEvent, GameSetup, GameState, Position, Side, SkaterState } from './types';
import { hypot2, type Vec2 } from './vec';
import { dexp, dlog } from './dmath';
import { SIDES, skaterById } from './util';

export type Unit = 'forwards' | 'defence';

/** Where each team's skaters come off and step on (the benches do not move when the teams switch ends). */
export const BENCH_DOORS: Record<Side, Vec2> = { home: { x: -7, y: -12.2 }, away: { x: 7, y: -12.2 } };
/** A leaving skater comes off, and his replacement steps on at the door, once he is this close to it (m). */
const DOOR_REACH = 1.5;
/** A replacement steps on only when no one on the ice is this close to the door (m): two body radii and a margin. */
const DOOR_CLEAR = 0.9;
/** Target ice-time shares by line (forwards) and pair (defence), first unit first. */
const SHARES: Record<Unit, readonly number[]> = { forwards: [0.36, 0.3, 0.21, 0.13], defence: [0.41, 0.34, 0.25] };
const SLOTS: Record<Unit, readonly Position[]> = { forwards: ['LW', 'C', 'RW'], defence: ['LD', 'RD'] };
const UNITS: readonly Unit[] = ['forwards', 'defence'];

/** Energy drain and recovery (see TUNING.fatigue). With the defaults a 45 s shift flat out takes a stamina-50 player from 1.0 to 0.55. */
const F = TUNING.fatigue;
/** On the bench the gap to full energy keeps F.benchKeep of itself every F.benchSeconds s. */
const RECOVERY_RATE = -dlog(F.benchKeep) / F.benchSeconds;
/** A unit is due a change when its mean energy is below F.tired, or its shift has passed shiftSeconds; at a stoppage, this fraction of shiftSeconds is enough. */
const STOPPAGE_SHIFT_FRACTION = 0.5;
/** Attack-relative x (m) past which the puck is deep in a team's far end: it may change whoever has the puck. */
const DEEP_X = 20;

/** Target ice-time shares for a team with `n` units of this kind: the first n shares, rescaled to sum to 1 on a short bench. */
export function iceShares(unit: Unit, n: number): number[] {
  const all = SHARES[unit];
  if (n >= all.length) return all.slice();
  const s = all.slice(0, n);
  const total = s.reduce((a, b) => a + b, 0);
  return s.map((v) => v / total);
}

/** Energy drained per second at full effort by a skater of this stamina. */
const fullDrain = (stamina: number): number => F.fullDrain * (1 + (50 - stamina) * F.staminaPerPoint);
const drained = (energy: number, full: number, effort: number, dt: number): number =>
  Math.max(0, energy - full * (F.idleShare + (1 - F.idleShare) * effort) * dt);
/** `energy` after resting long enough to keep `factor` of the gap to full. */
const rested = (energy: number, factor: number): number => (energy >= 1 ? 1 : 1 - (1 - energy) * factor);

/** Energy after `dt` seconds on the ice at `effort` (0 standing, 1 top speed) for a skater of this stamina. */
export function drainEnergy(energy: number, stamina: number, effort: number, dt: number): number {
  return drained(energy, fullDrain(stamina), effort, dt);
}

/** Energy after `dt` seconds of rest on the bench. */
export function recoverEnergy(energy: number, dt: number): number {
  return rested(energy, dexp(-RECOVERY_RATE * dt));
}

/** A fresh bench: the first line and pair on, nobody credited with ice time yet. */
export function initialBench(setup: GameSetup): Record<Side, BenchState> {
  const unit = (n: number): BenchUnit => ({ cur: 0, changing: false, shiftStart: 0, toi: new Array<number>(n).fill(0) });
  const of = (side: Side): BenchState => ({ forwards: unit(setup[side].lines.forwards.length), defence: unit(setup[side].lines.defence.length) });
  return { home: of('home'), away: of('away') };
}

/** Clock seconds since the opening faceoff. */
const gameSeconds = (state: GameState): number => (state.period - 1) * PERIOD_SECONDS + (PERIOD_SECONDS - state.clock);

/** Full-effort drain (per second) and fresh top speed of each skater, parallel to the `state.skaters` array they were built for. */
type Info = { fullDrain: number; topSpeed: number };
const infoCache = new WeakMap<SkaterState[], Info[]>();
function infoFor(setup: GameSetup, skaters: SkaterState[]): Info[] {
  let a = infoCache.get(skaters);
  if (!a) {
    const defs = new Map(setup.home.players.concat(setup.away.players).map((p) => [p.id, p]));
    a = skaters.map((s) => { const p = defs.get(s.id)!; return { fullDrain: fullDrain(p.attrs.stamina), topSpeed: movementOf(p, 1).topSpeed }; });
    infoCache.set(skaters, a);
  }
  return a;
}

const inUnit = (unit: Unit, slot: Position | null): boolean => slot !== null && SLOTS[unit].includes(slot);
/** Index of a side's unit in the per-tick scratch arrays. */
const unitIndex = (side: Side, unit: Unit): number => (side === 'home' ? 0 : 2) + (unit === 'forwards' ? 0 : 1);
const slotIndex = (side: Side, slot: Position | null): number =>
  (slot === null || slot === 'G' ? -1 : (side === 'home' ? 0 : 2) + (slot === 'LD' || slot === 'RD' ? 1 : 0));
/** Per-tick scratch: summed energy and head count of each side's on-ice units, by unitIndex. */
const energySum = [0, 0, 0, 0];
const headCount = [0, 0, 0, 0];

/**
 * Fatigue and line changes, once per tick in every phase but intermission (before team play, so a skater stepping on
 * gets his job the same tick). Emits a `lineChange` event into `out` when a unit change starts.
 *
 * - Energy: on the ice with play live it drains with effort (speed over top speed) and less with high stamina; on the
 *   bench it recovers, and on the ice while play is stopped it recovers at half that rate.
 * - Forward lines and defence pairs rotate: the incoming unit is the one furthest behind its target share of ice time.
 * - A unit is due when its shift passes `shiftSeconds` or its mean energy drops below 0.45. On the fly it changes only
 *   when its team has the puck outside its own zone, or the puck is deep in its far end, and only one unit of a team
 *   changes on the fly at a time. At a stoppage, half of `shiftSeconds` is enough, unless `noChange` names the team.
 * - A change sends every outgoing player but the puck carrier (who goes once he has let it go) to the bench door; he
 *   takes no further part in play. Within 1.5 m of the door he comes off, so the player nearest the bench goes first,
 *   and his replacement steps on there in his slot as soon as nobody else is in the doorway (one per tick).
 */
export function benchTick(state: GameState, setup: GameSetup, dt: number, out: GameEvent[] = []): void {
  const skaters = state.skaters;
  const info = infoFor(setup, skaters);
  const live = state.phase === 'live';
  const benchRest = dexp(-RECOVERY_RATE * dt), iceRest = dexp(-RECOVERY_RATE * dt * F.stoppageRecovery);
  let carrierSide: Side | null = null;
  for (let u = 0; u < 4; u++) { energySum[u] = 0; headCount[u] = 0; }
  for (let k = 0; k < skaters.length; k++) {
    const s = skaters[k]!;
    if (!s.onIce) { s.energy = rested(s.energy, benchRest); continue; }
    if (live) {
      const i = info[k]!;
      s.energy = drained(s.energy, i.fullDrain, Math.min(1, hypot2(s.vel.x, s.vel.y) / i.topSpeed), dt);
    } else s.energy = rested(s.energy, iceRest);
    if (s.id === state.carrierId) carrierSide = s.side;
    const u = slotIndex(s.side, s.slot);
    if (u >= 0) { energySum[u] = energySum[u]! + s.energy; headCount[u] = headCount[u]! + 1; }
  }
  if (!live && state.phase !== 'stopped' && state.phase !== 'faceoffSetup') return;
  const now = gameSeconds(state);
  for (const side of SIDES) {
    const bench = state.bench[side];
    for (const unit of UNITS) {
      const b = bench[unit];
      if (live) b.toi[b.cur]! += dt;
      if (b.changing) continueChange(state, setup, side, unit, b, now, false);
      else if (isDue(state, setup, side, unit, b, now, bench[unit === 'forwards' ? 'defence' : 'forwards'].changing, carrierSide)) {
        startChange(state, setup, side, unit, b, now, out);
      }
    }
  }
}

/** Every change still under way finishes now: outgoing players off, replacements on at the door. Call before the drop. */
export function finishChanges(state: GameState, setup: GameSetup): void {
  const now = gameSeconds(state);
  for (const side of SIDES) for (const unit of UNITS) {
    const b = state.bench[side][unit];
    if (b.changing) continueChange(state, setup, side, unit, b, now, true);
  }
}

/** `b` should change now (its on-ice energy is in this tick's energySum and headCount). */
function isDue(state: GameState, setup: GameSetup, side: Side, unit: Unit, b: BenchUnit, now: number, otherChanging: boolean, carrierSide: Side | null): boolean {
  const shift = now - b.shiftStart;
  if (shift <= 0) return false;
  const limit = setup[side].tactics.shiftSeconds[unit];
  if (state.phase === 'live') {
    if (otherChanging || !mayChangeOnTheFly(state, side, carrierSide)) return false;
  } else if (state.noChange === side) return false;
  if (shift >= (state.phase === 'live' ? limit : limit * STOPPAGE_SHIFT_FRACTION)) return true;
  const u = unitIndex(side, unit);
  const n = headCount[u]!;
  return n > 0 && energySum[u]! / n < F.tired;
}

/** The team has the puck in the neutral or offensive zone, or the puck is deep in its far end. */
function mayChangeOnTheFly(state: GameState, side: Side, carrierSide: Side | null): boolean {
  const dir = state.attackDir[side];
  const px = state.puck.pos.x;
  return px * dir > DEEP_X || (carrierSide === side && zoneOf(px, dir) !== 'D');
}

function startChange(state: GameState, setup: GameSetup, side: Side, unit: Unit, b: BenchUnit, now: number, out: GameEvent[]): void {
  const from = b.cur;
  const shares = iceShares(unit, b.toi.length);
  let total = 0;
  for (const t of b.toi) total += t;
  // The unit furthest behind its share; ties go to the next one in rotation order.
  let to = from, best = -Infinity;
  for (let k = 1; k < b.toi.length; k++) {
    const i = (from + k) % b.toi.length;
    const deficit = shares[i]! * total - b.toi[i]!;
    if (deficit > best) { best = deficit; to = i; }
  }
  b.cur = to;
  b.changing = true;
  b.shiftStart = now;
  out.push(gameEvent(state, {
    type: 'lineChange', side, playerId: null, otherId: null, pos: BENCH_DOORS[side],
    detail: { unit, from, to, onTheFly: state.phase === 'live', phase: phaseFor(state, side) },
  }));
  continueChange(state, setup, side, unit, b, now, false);
}

/**
 * Sends the outgoing players of `b`'s change to the door (all but the carrier); each one within reach of it (every
 * one, with `force`) comes off. A replacement steps on at the door into an empty slot of the unit once nobody else on
 * the ice is within DOOR_CLEAR of it (with `force`, at once). The change ends when the incoming unit is all on.
 */
function continueChange(state: GameState, setup: GameSetup, side: Side, unit: Unit, b: BenchUnit, now: number, force: boolean): void {
  const incoming = setup[side].lines[unit][b.cur]!;
  const door = BENCH_DOORS[side];
  let busy = false;
  for (const s of state.skaters) {
    if (!s.onIce || s.side !== side || !inUnit(unit, s.slot) || incoming.includes(s.id)) continue;
    if (!s.leaving) {
      if (s.id === state.carrierId && !force) { busy = true; continue; }
      s.leaving = true;
      holdJob(state, indexOf(state, s.id), 'change', null, 'stop');
      if (state.pendingPass !== null && state.pendingPass.toId === s.id) state.pendingPass = null;
    }
    if (force || hypot2(s.pos.x - door.x, s.pos.y - door.y) <= DOOR_REACH) comeOff(state, s, door);
    else {
      s.target.x = door.x;
      s.target.y = door.y;
      s.faceTarget = null;
      s.speedCap = 1;
      busy = true;
    }
  }
  for (let i = 0; i < incoming.length; i++) {
    const on = skaterById(state, incoming[i]!);
    if (on.onIce) continue;
    const slot = SLOTS[unit][i]!;
    if (slotTaken(state, side, slot) || (!force && !doorClear(state, door))) { busy = true; continue; }
    stepOn(state, on, slot, door, now);
  }
  if (!busy) b.changing = false;
}

function slotTaken(state: GameState, side: Side, slot: Position): boolean {
  for (const s of state.skaters) if (s.onIce && s.side === side && s.slot === slot) return true;
  return false;
}

/** Nobody on the ice within DOOR_CLEAR of the door. */
function doorClear(state: GameState, door: Vec2): boolean {
  for (const s of state.skaters) if (s.onIce && hypot2(s.pos.x - door.x, s.pos.y - door.y) < DOOR_CLEAR) return false;
  return true;
}

/** `off` leaves the ice at the door and waits there, on the bench. */
function comeOff(state: GameState, off: SkaterState, door: Vec2): void {
  off.onIce = false;
  off.leaving = false;
  off.slot = null;
  off.pos = { x: door.x, y: door.y };
  off.vel = { x: 0, y: 0 };
  off.target = { x: door.x, y: door.y };
  off.faceTarget = null;
  off.downT = 0;
  off.contestId = null;
  const ids = state.onIce[off.side];
  ids.splice(ids.indexOf(off.id), 1);
}

/** `on` steps on at the door into `slot` (heading for his faceoff spot if play is stopped). */
function stepOn(state: GameState, on: SkaterState, slot: Position, door: Vec2, now: number): void {
  on.onIce = true;
  on.leaving = false;
  on.slot = slot;
  on.pos = { x: door.x, y: door.y };
  on.vel = { x: 0, y: 0 };
  on.facing = Math.PI / 2;
  on.target = state.phase === 'live' ? { x: door.x, y: door.y } : faceoffPosition(state.faceoffSpot, slot, state.attackDir[on.side]);
  on.faceTarget = null;
  on.speedCap = state.phase === 'live' ? 1 : 0.8;
  on.downT = 0;
  on.contestId = null;
  on.shiftStart = now;
  state.onIce[on.side].push(on.id);
  // His plan starts afresh: a job from team play at once if play is live, else his place in the line-up.
  holdJob(state, indexOf(state, on.id), state.phase === 'live' ? 'shape' : 'lineUp', 'steppedOn');
}
