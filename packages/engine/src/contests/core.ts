import { blockPickup, recordTouch } from '../actions';
import { composite, type SkaterAttrs } from '../attributes';
import { DT } from '../constants';
import type { Rng } from '../rng';
import type { ContestState, GameEvent, GameSetup, GameState, PlayerDef, SkaterState } from '../types';
import type { Vec2 } from '../vec';
import { hitContest } from './hit';
import { pokeCheckContest } from './poke-check';

export type Weights = Partial<Record<keyof SkaterAttrs, number>>;
export type Chemistry = GameSetup['chemistry'];

export type ContestCtx = {
  state: GameState;
  defs: Map<string, PlayerDef>;
  rng: Rng;
  emit(e: GameEvent): void;
  /** The game's chemistry pairs (GameSetup.chemistry). */
  chemistry: Chemistry;
};

/**
 * What a finished contest does to the puck: `toWinner` gives it to `winnerId`; `loose` knocks it off the carrier
 * (who must be a participant) with `looseVel`; `unchanged` leaves it be.
 */
export type ContestResult = { winnerId: string | null; puck: 'toWinner' | 'loose' | 'unchanged'; looseVel?: Vec2 };

/**
 * One kind of staged contest. Its state's `freeIds` name the participants who keep their normal steering; the
 * contest steers only the others. `trigger` is asked, for each free skater (on the ice, not leaving, not down, in no
 * contest) in turn, whether he starts one of this kind now, and returns its participants (him first) or null.
 * `start` builds its state and steers its players; `update` runs once per live tick after the core has added `dt` to
 * `stageT`: it steers its players (target, faceTarget, speedCap), moves the stages on (setting `stageT` to 0 at each
 * new stage), and returns a result once it is over.
 */
export interface Contest {
  readonly kind: string;
  trigger(ctx: ContestCtx, s: SkaterState): string[] | null;
  start(ctx: ContestCtx, participants: string[]): ContestState;
  update(c: ContestState, ctx: ContestCtx, dt: number): ContestResult | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Steepness of the parity curve (rating points per unit of log-odds) and its limits: no contest is ever certain. */
const PARITY_SCALE = 24;
const PARITY_MIN = 0.1;
const PARITY_MAX = 0.9;

/** Chance that the side with an `edge` (difference in rating points) wins. A 15-point edge gives about 0.65. */
export function winProb(edge: number): number {
  return clamp(1 / (1 + Math.exp(-edge / PARITY_SCALE)), PARITY_MIN, PARITY_MAX);
}

/** Rating points lost at energy 0 (linear in energy), and at most gained or lost for form, morale and chemistry. */
const ENERGY_POINTS = 8;
const FORM_POINTS = 4;
const MORALE_POINTS = 4;
const CHEMISTRY_POINTS = 3;

/**
 * A player's rating for a contest: `composite` of his attributes with `weights`, minus up to 8 points as his energy
 * runs out, plus or minus up to 4 for form and 4 for morale, and up to 3 for `chemistry` (-1..1, the mean chemistry
 * with the teammates taking part in the same contest; see chemistryWith).
 */
export function effective(def: PlayerDef, s: SkaterState, weights: Weights, chemistry = 0): number {
  return composite(def.attrs, weights)
    - ENERGY_POINTS * (1 - clamp(s.energy, 0, 1))
    + FORM_POINTS * clamp(def.form, -1, 1)
    + MORALE_POINTS * clamp(def.morale, -1, 1)
    + CHEMISTRY_POINTS * clamp(chemistry, -1, 1);
}

/** Mean chemistry of `id` with each of `mates` (a pair not listed counts 0); 0 with no mates. */
export function chemistryWith(pairs: Chemistry, id: string, mates: readonly string[]): number {
  if (mates.length === 0) return 0;
  let total = 0;
  for (const m of mates) {
    for (const p of pairs) if ((p.a === id && p.b === m) || (p.a === m && p.b === id)) { total += p.value; break; }
  }
  return total / mates.length;
}

/** Mean chemistry of participant `id` of `c` with his teammates in it. */
export function contestChemistry(ctx: ContestCtx, c: ContestState, id: string): number {
  const side = skaterById(ctx.state, id).side;
  const mates = c.participants.filter((p) => p !== id && skaterById(ctx.state, p).side === side);
  return chemistryWith(ctx.chemistry, id, mates);
}

/** `effective` for participant `id` of `c`, with his chemistry with the teammates in it. */
export function contestRating(ctx: ContestCtx, c: ContestState, id: string, weights: Weights): number {
  return effective(ctx.defs.get(id)!, skaterById(ctx.state, id), weights, contestChemistry(ctx, c, id));
}

export function skaterById(state: GameState, id: string): SkaterState {
  for (const s of state.skaters) if (s.id === id) return s;
  throw new Error(`no skater ${id}`);
}

/** Can take part in a new contest: on the ice, not heading off, not down, in no contest now. */
export const isFree = (s: SkaterState): boolean => s.onIce && !s.leaving && s.downT === 0 && s.contestId === null;

/** The skater carrying the puck, or null. */
export function carrierOf(state: GameState): SkaterState | null {
  if (state.carrierId === null) return null;
  for (const s of state.skaters) if (s.id === state.carrierId) return s;
  return null;
}

/** True while `id` may not start a contest of `kind`. */
export function onCooldown(state: GameState, id: string, kind: string): boolean {
  for (const c of state.contestCooldowns) if (c.id === id && c.kind === kind && state.tick < c.untilTick) return true;
  return false;
}

/** `id` may not start a contest of `kind` for `seconds`. */
export function setCooldown(state: GameState, id: string, kind: string, seconds: number): void {
  const untilTick = state.tick + Math.round(seconds / DT);
  for (const c of state.contestCooldowns) if (c.id === id && c.kind === kind) { c.untilTick = untilTick; return; }
  state.contestCooldowns.push({ id, kind, untilTick });
}

/** Moves `c` to `stage` (stageT back to 0). */
export function enterStage(c: ContestState, stage: string): void {
  c.stage = stage;
  c.stageT = 0;
}

/** `id` leaves contest `c` while it goes on without him. */
export function dropParticipant(state: GameState, c: ContestState, id: string): void {
  const i = c.participants.indexOf(id);
  if (i >= 0) c.participants.splice(i, 1);
  const f = c.freeIds.indexOf(id);
  if (f >= 0) c.freeIds.splice(f, 1);
  const s = skaterById(state, id);
  if (s.contestId === c.id) s.contestId = null;
}

/** Stage lengths are compared with this slack, so a 0.25 s stage ends on the tick its time is reached. */
export const STAGE_EPS = 1e-9;

/**
 * Applies a result's effect on the puck. `toWinner`: the winner becomes the carrier (a touch). `loose`: the carrier, if
 * he is in the contest, loses the puck at `looseVel`, and nobody in the contest may pick it up for a moment.
 */
export function applyResult(ctx: ContestCtx, c: ContestState, r: ContestResult): void {
  const state = ctx.state;
  if (r.puck === 'toWinner' && r.winnerId !== null) {
    const w = skaterById(state, r.winnerId);
    state.carrierId = w.id;
    state.lastTouch = { id: w.id, side: w.side };
    state.possession = w.side;
    state.pendingPass = null;
    recordTouch(state, w.id, w.side);
    state.puck.vel.x = w.vel.x;
    state.puck.vel.y = w.vel.y;
  } else if (r.puck === 'loose' && state.carrierId !== null && c.participants.includes(state.carrierId)) {
    state.carrierId = null;
    state.pendingPass = null;
    state.puck.vel.x = r.looseVel?.x ?? 0;
    state.puck.vel.y = r.looseVel?.y ?? 0;
    blockPickup(state, c.participants.slice());
  }
}

let registry: readonly Contest[] | null = null;
/** Every kind of contest, in the order their triggers are asked (built on first use: the kinds import this module). */
export function contestKinds(): readonly Contest[] {
  registry ??= [hitContest, pokeCheckContest];
  return registry;
}

function kindOf(kind: string): Contest {
  for (const k of contestKinds()) if (k.kind === kind) return k;
  throw new Error(`no contest kind ${kind}`);
}

/** Contests started on one tick get ids tick * ID_STRIDE + 0, 1, ...: unique without a counter in the state. */
const ID_STRIDE = 16;

/**
 * Once per live tick (after the brain, before skaters move): advances every running contest and applies the results
 * of those that end, then starts new ones where a trigger holds. A contest one of whose players has left the ice or
 * is heading off ends with no result. Events go to `out`; `chemistry` is the game's chemistry pairs.
 */
export function contestTick(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, dt: number, out: GameEvent[] = [], chemistry: Chemistry = [],
): void {
  if (state.phase !== 'live') return;
  const ctx: ContestCtx = { state, defs, rng, emit: (e) => { out.push(e); }, chemistry };
  if (state.contestCooldowns.some((c) => state.tick >= c.untilTick)) state.contestCooldowns = state.contestCooldowns.filter((c) => state.tick < c.untilTick);

  for (let i = 0; i < state.contests.length;) {
    const c = state.contests[i]!;
    let r: ContestResult | null;
    if (c.participants.some((id) => { const s = skaterById(state, id); return !s.onIce || s.leaving; })) r = { winnerId: null, puck: 'unchanged' };
    else {
      c.stageT += dt;
      r = kindOf(c.kind).update(c, ctx, dt);
    }
    if (r === null) { i++; continue; }
    applyResult(ctx, c, r);
    for (const id of c.participants) { const s = skaterById(state, id); if (s.contestId === c.id) s.contestId = null; }
    state.contests.splice(i, 1);
  }

  for (const s of state.skaters) {
    if (!isFree(s)) continue;
    for (const k of contestKinds()) {
      const ps = k.trigger(ctx, s);
      if (ps === null) continue;
      begin(ctx, k, ps);
      break;
    }
  }
}

/** Starts a contest of kind `k` with `participants`: gives it the next id of this tick and marks its players. */
function begin(ctx: ContestCtx, k: Contest, participants: string[]): ContestState {
  const state = ctx.state;
  let n = 0;
  for (const c of state.contests) if (Math.floor(c.id / ID_STRIDE) === state.tick) n++;
  const c = k.start(ctx, participants);
  c.id = state.tick * ID_STRIDE + n;
  for (const id of c.participants) skaterById(state, id).contestId = c.id;
  state.contests.push(c);
  return c;
}

/**
 * Starts a contest of kind `k` with `participants` (all free) now, without its trigger: for set pieces and tests.
 * contestTick advances it from the next tick.
 */
export function startContest(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, k: Contest, participants: string[], out: GameEvent[] = [], chemistry: Chemistry = [],
): ContestState {
  return begin({ state, defs, rng, emit: (e) => { out.push(e); }, chemistry }, k, participants);
}

/** Every contest ends at once with no result and its players are free (whistles, period ends). */
export function clearContests(state: GameState): void {
  state.contests = [];
  for (const s of state.skaters) s.contestId = null;
}

/** A GameEvent stamped with the state's tick, period and clock. */
export function contestEvent(state: GameState, e: Omit<GameEvent, 'tick' | 'period' | 'clock'>): GameEvent {
  return { tick: state.tick, period: state.period, clock: state.clock, ...e };
}
