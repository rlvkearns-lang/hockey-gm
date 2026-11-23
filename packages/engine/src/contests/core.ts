import { blockPickup, recordTouch } from '../actions';
import { composite, type SkaterAttrs } from '../attributes';
import { DT } from '../constants';
import type { Rng } from '../rng';
import { gameEvent, type EventFields } from '../events';
import type {
  ContestKind, ContestOutcome, ContestStages, ContestState, ContestStateOf, GameEvent, GameEventOf, GameEventType, GameSetup, GameState, PlayerDef,
  SkaterState,
} from '../types';
import type { Vec2 } from '../vec';
import { boardBattleContest } from './board-battle';
import { hitContest } from './hit';
import { looseRaceContest } from './loose-race';
import { netFrontContest } from './net-front';
import { pokeCheckContest } from './poke-check';
import { dexp } from '../dmath';
import { carrierOf, clamp, skaterById } from '../util';

export type Weights = Partial<Record<keyof SkaterAttrs, number>>;
export type Chemistry = GameSetup['chemistry'];

export type ContestCtx = {
  state: GameState;
  defs: Map<string, PlayerDef>;
  rng: Rng;
  emit(e: GameEvent): void;
  /** The game's chemistry pairs (GameSetup.chemistry). */
  chemistry: Chemistry;
  /**
   * Working values triggers may share while contestTick asks them in turn on one tick (e.g. each side's first man to a
   * loose puck). Emptied before the triggers are asked and whenever a contest starts, so it never outlives the state
   * it was worked out from. Derived data only: nothing in it carries over from one tick to the next.
   */
  memo: Map<string, unknown>;
};

/**
 * What a finished contest does to the puck: `toWinner` gives it to `winnerId`; `loose` knocks it off the carrier
 * (who must be a participant) with `looseVel`; `unchanged` leaves it be. `outcome` says how it ended (the
 * `contestEnd` event).
 */
export type ContestResult = { winnerId: string | null; puck: 'toWinner' | 'loose' | 'unchanged'; looseVel?: Vec2; outcome: ContestOutcome };

/**
 * One kind of staged contest. Its state's `freeIds` name the participants who keep their normal steering; the
 * contest steers only the others. `trigger` is asked, for each free skater (on the ice, not leaving, not down, in no
 * contest) in turn, whether he starts one of this kind now, and returns its participants (him first) or null.
 * `start` builds its state and steers its players; `update` runs once per live tick after the core has added `dt` to
 * `stageT`: it steers its players (target, faceTarget, speedCap), moves the stages on (setting `stageT` to 0 at each
 * new stage), and returns a result once it is over.
 */
export interface Contest<K extends ContestKind = ContestKind> {
  readonly kind: K;
  /** Optional: false when the trigger cannot fire for anyone now (checked once per round of triggers, before asking each skater). */
  gate?(ctx: ContestCtx): boolean;
  trigger(ctx: ContestCtx, s: SkaterState): string[] | null;
  start(ctx: ContestCtx, participants: string[]): ContestStateOf<K>;
  update(c: ContestStateOf<K>, ctx: ContestCtx, dt: number): ContestResult | null;
}


/** Steepness of the parity curve (rating points per unit of log-odds) and its limits: no contest is ever certain. */
const PARITY_SCALE = 24;
const PARITY_MIN = 0.1;
const PARITY_MAX = 0.9;

/** Chance that the side with an `edge` (difference in rating points) wins. A 15-point edge gives about 0.65. */
export function winProb(edge: number): number {
  return clamp(1 / (1 + dexp(-edge / PARITY_SCALE)), PARITY_MIN, PARITY_MAX);
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

/** `effective` for participant `id` of `c`, with his chemistry with the teammates in it, plus his team's jump on the night. */
export function contestRating(ctx: ContestCtx, c: ContestState, id: string, weights: Weights): number {
  const s = skaterById(ctx.state, id);
  return effective(ctx.defs.get(id)!, s, weights, contestChemistry(ctx, c, id)) + ctx.state.teamJump[s.side];
}

export { carrierOf, skaterById } from '../util';

/** Can take part in a new contest: on the ice, not heading off, not down, in no contest now. */
export const isFree = (s: SkaterState): boolean => s.onIce && !s.leaving && s.downT === 0 && s.contestId === null;

const CARRIER = 'core.carrier';

/** carrierOf for triggers: worked out once per round of triggers (kept in `ctx.memo`, emptied whenever a contest starts). */
export function carrierNow(ctx: ContestCtx): SkaterState | null {
  const m = ctx.memo.get(CARRIER) as SkaterState | null | undefined;
  if (m !== undefined) return m;
  const c = carrierOf(ctx.state);
  ctx.memo.set(CARRIER, c);
  return c;
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

/**
 * True while a contest holds the loose puck in place (a board battle: the puck is in the players' feet, `carrierId`
 * null). Nobody may pick it up then; its `data.holdsPuck` is true.
 */
export function puckHeldByContest(state: GameState): boolean {
  for (const c of state.contests) if (c.kind === 'boardBattle' && c.data.holdsPuck) return true;
  return false;
}

/** Moves `c` to `stage` (stageT back to 0). */
export function enterStage<K extends ContestKind>(c: ContestStateOf<K>, stage: ContestStages[K]): void {
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

/** A contest of any kind (its state and update function are of the same kind; see update()). */
type AnyContest = Contest<ContestKind>;

let registry: readonly AnyContest[] | null = null;
/** Every kind of contest, in the order their triggers are asked (built on first use: the kinds import this module). */
export function contestKinds(): readonly AnyContest[] {
  registry ??= [hitContest, pokeCheckContest, boardBattleContest, netFrontContest, looseRaceContest] as unknown as AnyContest[];
  return registry;
}

function kindOf(kind: ContestKind): AnyContest {
  for (const k of contestKinds()) if (k.kind === kind) return k;
  throw new Error(`no contest kind ${kind}`);
}

/** Contests started on one tick get ids tick * ID_STRIDE + 0, 1, ...: unique without a counter in the state. */
const ID_STRIDE = 16;

/**
 * Once per live tick (after the brain, before skaters move): advances every running contest and applies the results
 * of those that end, then starts new ones where a trigger holds (unless a contest has stopped play). A contest one of
 * whose players has left the ice or is heading off ends with no result. Expired cooldowns and net-front tie-ups are
 * dropped. Events go to `out`; `chemistry` is the game's chemistry pairs.
 */
export function contestTick(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, dt: number, out: GameEvent[] = [], chemistry: Chemistry = [],
): void {
  if (state.phase !== 'live') return;
  const ctx: ContestCtx = { state, defs, rng, emit: (e) => { out.push(e); }, chemistry, memo: new Map() };
  dropExpired(state);

  for (let i = 0; i < state.contests.length;) {
    const c = state.contests[i]!;
    let r: ContestResult | null;
    if (anyGone(state, c)) r = { winnerId: null, puck: 'unchanged', outcome: 'abandoned' };
    else {
      c.stageT += dt;
      r = kindOf(c.kind).update(c, ctx, dt);
    }
    if (r === null) { i++; continue; }
    applyResult(ctx, c, r);
    ctx.emit(contestEndEvent(state, c, r.outcome, r.winnerId, r.puck));
    for (const id of c.participants) { const s = skaterById(state, id); if (s.contestId === c.id) s.contestId = null; }
    state.contests.splice(i, 1);
  }
  if (state.phase !== 'live') return; // a trapped puck was whistled dead

  ctx.memo.clear();
  const kinds = contestKinds();
  const open = openKinds(ctx, kinds);
  for (const s of state.skaters) {
    if (!isFree(s)) continue;
    for (let i = 0; i < kinds.length; i++) {
      if (!open[i]) continue;
      const k = kinds[i]!;
      const ps = k.trigger(ctx, s);
      if (ps === null) continue;
      begin(ctx, k, ps);
      openKinds(ctx, kinds); // a start can change what is possible (e.g. a puck knocked loose)
      break;
    }
  }
}

/** Per kind, whether its trigger could fire for anyone this round (`gate`, or true without one); refilled in place. */
const openScratch: boolean[] = [];
function openKinds(ctx: ContestCtx, kinds: readonly Contest[]): boolean[] {
  openScratch.length = kinds.length;
  for (let i = 0; i < kinds.length; i++) { const g = kinds[i]!.gate; openScratch[i] = g === undefined || g(ctx); }
  return openScratch;
}

/** One of `c`'s players has left the ice or is heading off. */
function anyGone(state: GameState, c: ContestState): boolean {
  for (const id of c.participants) { const s = skaterById(state, id); if (!s.onIce || s.leaving) return true; }
  return false;
}

/** Drops expired contest cooldowns and net-front tie-ups (in place, keeping order). */
function dropExpired(state: GameState): void {
  const tick = state.tick;
  const cd = state.contestCooldowns;
  let n = 0;
  for (let i = 0; i < cd.length; i++) if (tick < cd[i]!.untilTick) cd[n++] = cd[i]!;
  cd.length = n;
  const tu = state.tiedUpUntil;
  n = 0;
  for (let i = 0; i < tu.length; i++) if (tick < tu[i]!.tick) tu[n++] = tu[i]!;
  tu.length = n;
}

/** Starts a contest of kind `k` with `participants`: gives it the next id of this tick, marks its players, emits `contestStart`. */
function begin(ctx: ContestCtx, k: AnyContest, participants: string[]): ContestState {
  const state = ctx.state;
  let n = 0;
  for (const c of state.contests) if (Math.floor(c.id / ID_STRIDE) === state.tick) n++;
  ctx.memo.clear();
  const c = k.start(ctx, participants) as ContestState;
  c.id = state.tick * ID_STRIDE + n;
  for (const id of c.participants) skaterById(state, id).contestId = c.id;
  state.contests.push(c);
  ctx.emit(gameEvent(state, {
    type: 'contestStart', side: null, playerId: c.participants[0] ?? null, otherId: c.participants[1] ?? null, pos: c.spot,
    detail: { contestId: c.id, kind: c.kind, participants: c.participants.slice() },
  }));
  return c;
}

/** What identifies a contest in its events. */
export type ContestRef = Pick<ContestState, 'id' | 'kind' | 'spot'>;

/** The `contestEnd` event of `c` (pos: its spot). */
export function contestEndEvent(
  state: GameState, c: ContestRef, result: ContestOutcome, winnerId: string | null, puck: ContestResult['puck'],
): GameEventOf<'contestEnd'> {
  return gameEvent(state, {
    type: 'contestEnd', side: null, playerId: winnerId, otherId: null, pos: c.spot,
    detail: { contestId: c.id, kind: c.kind, result, winnerId, puck },
  });
}

/**
 * Starts a contest of kind `k` with `participants` (all free) now, without its trigger: for set pieces and tests.
 * contestTick advances it from the next tick.
 */
export function startContest<K extends ContestKind>(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, k: Contest<K>, participants: string[], out: GameEvent[] = [], chemistry: Chemistry = [],
): ContestStateOf<K> {
  return begin({ state, defs, rng, emit: (e) => { out.push(e); }, chemistry, memo: new Map() }, k as unknown as AnyContest, participants) as ContestStateOf<K>;
}

/** Every contest ends at once with no result and its players are free (whistles, period ends). */
export function clearContests(state: GameState): void {
  state.contests = [];
  for (const s of state.skaters) s.contestId = null;
}

/** A GameEvent stamped with the state's tick, period and clock. */
export function contestEvent<T extends GameEventType>(state: GameState, e: EventFields<T>): GameEventOf<T> {
  return gameEvent(state, e);
}
