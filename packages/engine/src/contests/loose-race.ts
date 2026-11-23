import { blockPickup } from '../actions';
import { DT } from '../constants';
import { distToBoards } from '../rink';
import { movementOf, type Movement } from '../skating';
import { isTiedUp, steeredByContest } from '../team-play';
import { TUNING } from '../tuning';
import type { ContestState, GameState, PlayerDef, SkaterState } from '../types';
import { dist, hypot2, type Vec2 } from '../vec';
import {
  contestRating, enterStage, isFree, onCooldown, puckHeldByContest, setCooldown, skaterById, STAGE_EPS, winProb,
  type Contest, type ContestCtx,
} from './core';

const KIND = 'looseRace';
const T = TUNING.looseRace;
/** A man this close (m) to the puck has reached it (the pickup radius). */
const REACH = 0.9;
/** `resolve` shows the outcome this long (s); a race not reached within RACE_MAX_SECONDS is off. */
const RESOLVE_SECONDS = 0.1;
const RACE_MAX_SECONDS = 2;
/** A bounce leaves the puck at this speed (m/s), any direction. */
const BOUNCE_SPEED: [number, number] = [1, 3];
/** Racers lead a moving puck by at most this long (s). */
const MAX_LEAD_SECONDS = 1;
/** `data.outcome` codes. */
const OUTCOME = { undecided: 0, a: 1, b: 2, bounce: 3 } as const;

/**
 * Seconds `s` (skating `m`) needs to get within REACH of `p`: the turn from his facing toward it (at `m.turnRate`),
 * then straight there from his speed toward it, accelerating at `m.accel` up to `m.topSpeed`. 0 if he is already there.
 */
export function timeToReach(s: SkaterState, m: Movement, p: Vec2): number {
  const dx = p.x - s.pos.x, dy = p.y - s.pos.y;
  const l = hypot2(dx, dy);
  const d = l - REACH;
  if (d <= 0) return 0;
  const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - s.facing), Math.cos(Math.atan2(dy, dx) - s.facing))) / m.turnRate;
  const top = m.topSpeed, a = m.accel;
  const v0 = Math.max(-top, Math.min(top, (s.vel.x * dx + s.vel.y * dy) / l));
  const dAccel = (top * top - v0 * v0) / (2 * a);
  if (d <= dAccel) return turn + (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
  return turn + (top - v0) / a + (d - dAccel) / top;
}

/** Each player's Movement, rebuilt only when his legs change (energy matters to it only below 0.5). */
const moves = new WeakMap<PlayerDef, { legs: number; m: Movement }>();

function etaOf(ctx: ContestCtx, s: SkaterState): number {
  const d = ctx.defs.get(s.id)!;
  const legs = s.energy >= 0.5 ? 1 : s.energy;
  let e = moves.get(d);
  if (e === undefined || e.legs !== legs) { e = { legs, m: movementOf(d, legs) }; moves.set(d, e); }
  return timeToReach(s, e.m, ctx.state.puck.pos);
}

/** The puck is loose and raceable: nobody has it, no pass or shot on its way, flat, slow enough, clear of the boards. */
function raceable(state: GameState): boolean {
  const p = state.puck;
  return state.carrierId === null && state.pendingPass === null && state.shotInFlight === null && p.z <= 0.3
    && hypot2(p.vel.x, p.vel.y) < T.maxPuckSpeed && distToBoards(p.pos) > T.boardsClear && !puckHeldByContest(state);
}

const RACEABLE = 'looseRace.raceable';

/** raceable, worked out once per round of triggers (`ctx.memo`). */
function raceableNow(ctx: ContestCtx): boolean {
  const m = ctx.memo.get(RACEABLE) as boolean | undefined;
  if (m !== undefined) return m;
  const ok = raceable(ctx.state);
  ctx.memo.set(RACEABLE, ok);
  return ok;
}

/** A skater busy in a contest that steers him is counted this much (s) later to the puck. */
const BUSY_SECONDS = 0.3;

/**
 * When `s` could have the puck (s from now), or Infinity if he cannot take it at all (off, heading off, his stick tied
 * up): his time to reach it, but no earlier than his pickup block or knock-down ends, and later while a contest
 * steers him.
 */
function takeTime(ctx: ContestCtx, s: SkaterState): number {
  const state = ctx.state;
  if (!s.onIce || s.leaving || isTiedUp(state, s.id)) return Infinity;
  let t = etaOf(ctx, s);
  const b = state.pickupBlock;
  if (b !== null && state.tick < b.untilTick && b.ids.includes(s.id)) t = Math.max(t, (b.untilTick - state.tick) * DT);
  if (s.downT > 0) t = Math.max(t, s.downT);
  if (steeredByContest(state, s)) t += BUSY_SECONDS;
  return t;
}

/** `s` can race now: in no other contest, not tied up, and has not just raced. */
const eligible = (state: GameState, s: SkaterState): boolean => isFree(s) && !isTiedUp(state, s.id) && !onCooldown(state, s.id, KIND);

type FirstMen = [{ id: string | null; eta: number }, { id: string | null; eta: number }];
const FIRST_MEN = 'looseRace.firstMen';

/**
 * Each side's first man to the puck (by takeTime) right now: [home, away]. Worked out once per round of triggers and
 * kept in `ctx.memo`, which is emptied whenever a contest starts, so it always reflects who is free at that moment.
 */
function firstMen(ctx: ContestCtx): FirstMen {
  const memo = ctx.memo.get(FIRST_MEN) as FirstMen | undefined;
  if (memo !== undefined) return memo;
  const out: FirstMen = [{ id: null, eta: Infinity }, { id: null, eta: Infinity }];
  for (const s of ctx.state.skaters) {
    if (!s.onIce) continue;
    const t = takeTime(ctx, s);
    const f = out[s.side === 'home' ? 0 : 1];
    if (t < f.eta) { f.eta = t; f.id = s.id; }
  }
  ctx.memo.set(FIRST_MEN, out);
  return out;
}

/**
 * Loose-puck race. Participants: one man of each team, both steered at the puck. `race` until one is within reach of
 * it (`leader`: the one who would get there first), then `resolve` (0.1 s; `leader`: the winner, null for a bounce).
 * The draw: winProb of the arrival-time difference times 130 per second, plus compete .4, agility .3,
 * balance .3, plus 10 for the man who just won the net-front battle. The winner takes it; a roll within 0.08 of the
 * threshold is a bounce that stays loose. Someone else getting to it, a pass, or the puck speeding up or reaching the
 * boards ends it with no result.
 */
export const looseRaceContest: Contest = {
  kind: KIND,

  trigger(ctx, s) {
    const state = ctx.state;
    if (!raceableNow(ctx) || !eligible(state, s)) return null;
    const first = firstMen(ctx);
    const mine = first[s.side === 'home' ? 0 : 1], theirs = first[s.side === 'home' ? 1 : 0];
    if (mine.id !== s.id || theirs.id === null) return null;
    if (Math.max(mine.eta, theirs.eta) > T.raceHorizon || Math.abs(mine.eta - theirs.eta) > T.raceWindow) return null;
    const o = skaterById(state, theirs.id);
    return eligible(state, o) ? [s.id, o.id] : null;
  },

  start(ctx, participants) {
    const state = ctx.state;
    const c: ContestState = {
      id: -1, kind: KIND, stage: 'race', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: state.puck.pos.x, y: state.puck.pos.y }, freeIds: [], data: { outcome: OUTCOME.undecided, gap: 0 },
    };
    steer(c, ctx);
    return c;
  },

  update(c, ctx) {
    const state = ctx.state;
    const a = skaterById(state, c.participants[0]!), b = skaterById(state, c.participants[1]!);
    const p = state.puck;
    c.spot.x = p.pos.x;
    c.spot.y = p.pos.y;
    if (state.carrierId !== null || state.pendingPass !== null) return end(c, ctx, null); // someone else got there
    if (c.stage === 'race') {
      if (!raceable(state) || c.stageT >= RACE_MAX_SECONDS - STAGE_EPS) return end(c, ctx, null);
      const ta = etaOf(ctx, a), tb = etaOf(ctx, b);
      c.leader = ta <= tb ? a.id : b.id;
      if (dist(a.pos, p.pos) <= REACH || dist(b.pos, p.pos) <= REACH) {
        decide(c, ctx, a, b, ta, tb);
        enterStage(c, 'resolve');
      }
      steer(c, ctx);
      return null;
    }
    steer(c, ctx);
    if (c.stageT < RESOLVE_SECONDS - STAGE_EPS) return null;
    const o = c.data.outcome;
    if (o === OUTCOME.a || o === OUTCOME.b) {
      const w = o === OUTCOME.a ? a : b;
      for (const id of c.participants) setCooldown(state, id, KIND, T.cooldownSeconds);
      return { winnerId: w.id, puck: 'toWinner' };
    }
    // A bounce: off both sticks, it stays loose.
    const ang = ctx.rng.range(-Math.PI, Math.PI), v = ctx.rng.range(BOUNCE_SPEED[0], BOUNCE_SPEED[1]);
    p.vel.x = Math.cos(ang) * v;
    p.vel.y = Math.sin(ang) * v;
    blockPickup(state, c.participants.slice());
    return end(c, ctx, null);
  },
};

function end(c: ContestState, ctx: ContestCtx, winnerId: string | null): { winnerId: string | null; puck: 'unchanged' } {
  for (const id of c.participants) setCooldown(ctx.state, id, KIND, T.cooldownSeconds);
  return { winnerId, puck: 'unchanged' };
}

/** The draw when the first man reaches the puck; `ta`, `tb` are each man's time to it now. */
function decide(c: ContestState, ctx: ContestCtx, a: SkaterState, b: SkaterState, ta: number, tb: number): void {
  const state = ctx.state;
  const rb = state.reboundEdge !== null && state.tick < state.reboundEdge.untilTick ? state.reboundEdge.id : null;
  const edge = (tb - ta) * T.edgePerSecond + contestRating(ctx, c, a.id, T.race) - contestRating(ctx, c, b.id, T.race)
    + (rb === a.id ? T.reboundEdge : 0) - (rb === b.id ? T.reboundEdge : 0);
  const threshold = 1 - winProb(edge);
  const u = ctx.rng.next();
  c.data.gap = tb - ta;
  c.data.outcome = Math.abs(u - threshold) < T.bounceBand ? OUTCOME.bounce : u >= threshold ? OUTCOME.a : OUTCOME.b;
  c.leader = c.data.outcome === OUTCOME.a ? a.id : c.data.outcome === OUTCOME.b ? b.id : null;
}

/** Both skate flat out to where the puck will be. */
function steer(c: ContestState, ctx: ContestCtx): void {
  const state = ctx.state;
  const p = state.puck;
  for (const id of c.participants) {
    const s = skaterById(state, id);
    const t = Math.min(MAX_LEAD_SECONDS, dist(s.pos, p.pos) / 8);
    s.target.x = p.pos.x + p.vel.x * t;
    s.target.y = p.pos.y + p.vel.y * t;
    s.faceTarget = null;
    s.speedCap = 1;
  }
}
