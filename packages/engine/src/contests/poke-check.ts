import { recordTouch } from '../actions';
import type { ContestState, SkaterState } from '../types';
import { dist, hypot2 } from '../vec';
import {
  carrierOf, contestEvent, contestRating, dropParticipant, enterStage, isFree, onCooldown, setCooldown, skaterById, STAGE_EPS,
  winProb, type Contest, type ContestCtx, type ContestResult,
} from './core';

const KIND = 'pokeCheck';
/** A defender this close (m) to the carrier, in front of him or beside him, pokes at the puck... */
const TRIGGER_RANGE = 1.6;
/** ...where "beside" reaches this far behind square: the cosine of the angle off the carrier's facing is at least this. */
const FRONT_COS = -0.2;
/** ...at most once per this many seconds. */
const COOLDOWN_SECONDS = 1.5;
/** Stage lengths (s): the stick goes out, then the outcome shows before the puck moves. */
const REACH_SECONDS = 0.25;
const RESOLVE_SECONDS = 0.1;
/** A badly beaten defender loses a step: his speedCap is halved for this long. */
const BEATEN_SECONDS = 0.7;
const BEATEN_SPEED_CAP = 0.5;
/** Rolls in this bottom share are a failure by a wide margin. */
const BEATEN_ROLL = 0.15;
/** Beyond this distance (m) at the end of the reach the stick cannot get there: the poke misses outright. */
const STICK_REACH = 2.2;
/** The carrier is favoured by this many rating points. */
const CARRIER_EDGE = 12;
/** A won poke check gives the checker the puck this often; otherwise it is knocked loose. */
const TAKE_SHARE = 0.5;
/** A knocked-loose puck leaves at this speed range (m/s), away from the checker, plus half the carrier's velocity. */
const LOOSE_SPEED: [number, number] = [3, 6];
const LOOSE_SPREAD = 0.8;
/** How fast each of them moves while the stick is out (fractions of top speed). */
const REACH_SPEED_CAP = 0.5;
const CARRIER_SPEED_CAP = 0.85;
/** `data.outcome` codes (numbers, so the state stays plain numeric data). */
const OUTCOME = { undecided: 0, take: 1, loose: 2, kept: 3, beaten: 4 } as const;
const STICK = { stickChecking: 0.6, defensivePositioning: 0.25, iq: 0.15 };
const HANDS = { puckHandling: 0.6, poise: 0.25, balance: 0.15 };

function setTarget(s: SkaterState, x: number, y: number): void {
  s.target.x = x;
  s.target.y = y;
}

/** The checker reaches for the puck, facing it; the carrier keeps going his way, a little slower, shielding it. */
function steerReach(ctx: ContestCtx, checker: SkaterState, carrier: SkaterState): void {
  const p = ctx.state.puck.pos;
  setTarget(checker, p.x, p.y);
  if (checker.faceTarget) { checker.faceTarget.x = p.x; checker.faceTarget.y = p.y; } else checker.faceTarget = { x: p.x, y: p.y };
  checker.speedCap = REACH_SPEED_CAP;
  carrier.faceTarget = null;
  carrier.speedCap = CARRIER_SPEED_CAP;
}

/**
 * Poke check, stages `reach` (REACH_SECONDS: the stick goes out), `resolve` (RESOLVE_SECONDS: `leader` is the
 * winner) and, after a failure by a wide margin, `beaten` (the checker alone, a step behind). Participants: the
 * checker, then the carrier. The carrier letting the puck go before it resolves ends it with no result.
 * `data.outcome` is one of OUTCOME: undecided, the checker takes it, knocks it loose, the carrier keeps it, or keeps it
 * and the checker is beaten.
 */
export const pokeCheckContest: Contest = {
  kind: KIND,

  trigger(ctx, s) {
    const state = ctx.state;
    const carrier = carrierOf(state);
    if (!carrier || carrier.side === s.side || !isFree(carrier) || state.puck.z > 0) return null;
    const dx = s.pos.x - carrier.pos.x, dy = s.pos.y - carrier.pos.y;
    const d = hypot2(dx, dy);
    if (d > TRIGGER_RANGE) return null;
    if (d > 0 && (Math.cos(carrier.facing) * dx + Math.sin(carrier.facing) * dy) / d < FRONT_COS) return null;
    if (onCooldown(state, s.id, KIND)) return null;
    return [s.id, carrier.id];
  },

  start(ctx, participants) {
    const [checkerId, carrierId] = participants as [string, string];
    const state = ctx.state;
    setCooldown(state, checkerId, KIND, COOLDOWN_SECONDS);
    steerReach(ctx, skaterById(state, checkerId), skaterById(state, carrierId));
    return {
      id: -1, kind: KIND, stage: 'reach', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: state.puck.pos.x, y: state.puck.pos.y }, data: { outcome: OUTCOME.undecided },
    };
  },

  update(c, ctx) {
    const state = ctx.state;
    const checker = skaterById(state, c.participants[0]!);
    if (c.stage === 'beaten') {
      const carrier = carrierOf(state);
      setTarget(checker, carrier ? carrier.pos.x : checker.pos.x, carrier ? carrier.pos.y : checker.pos.y);
      checker.faceTarget = null;
      checker.speedCap = BEATEN_SPEED_CAP;
      return c.stageT >= BEATEN_SECONDS - STAGE_EPS ? { winnerId: c.leader, puck: 'unchanged' } : null;
    }
    const carrierId = c.participants[1]!;
    if (state.carrierId !== carrierId) return { winnerId: null, puck: 'unchanged' }; // he got rid of it in time
    const carrier = skaterById(state, carrierId);
    steerReach(ctx, checker, carrier);
    c.spot.x = state.puck.pos.x;
    c.spot.y = state.puck.pos.y;

    if (c.stage === 'reach') {
      if (c.stageT < REACH_SECONDS - STAGE_EPS) return null;
      c.data.outcome = roll(c, ctx, checker, carrier);
      c.leader = c.data.outcome === OUTCOME.take || c.data.outcome === OUTCOME.loose ? checker.id : carrier.id;
      enterStage(c, 'resolve');
      return null;
    }
    if (c.stageT < RESOLVE_SECONDS - STAGE_EPS) return null;
    return finish(c, ctx, checker, carrier);
  },
};

/** The poke itself: one roll against winProb of the checker's edge. Returns the `data.outcome` code. */
function roll(c: ContestState, ctx: ContestCtx, checker: SkaterState, carrier: SkaterState): number {
  if (dist(checker.pos, carrier.pos) > STICK_REACH) return OUTCOME.kept;
  const edge = contestRating(ctx, c, checker.id, STICK) - contestRating(ctx, c, carrier.id, HANDS) - CARRIER_EDGE;
  const u = ctx.rng.next();
  if (u >= 1 - winProb(edge)) return ctx.rng.chance(TAKE_SHARE) ? OUTCOME.take : OUTCOME.loose;
  return u < BEATEN_ROLL ? OUTCOME.beaten : OUTCOME.kept;
}

function finish(c: ContestState, ctx: ContestCtx, checker: SkaterState, carrier: SkaterState): ContestResult | null {
  const state = ctx.state;
  const outcome = c.data.outcome;
  if (outcome === OUTCOME.beaten) {
    dropParticipant(state, c, carrier.id);
    enterStage(c, 'beaten');
    return null;
  }
  if (outcome === OUTCOME.kept) return { winnerId: carrier.id, puck: 'unchanged' };
  ctx.emit(contestEvent(state, {
    type: 'takeaway', side: checker.side, playerId: checker.id, otherId: carrier.id, assistIds: [], detail: outcome === OUTCOME.take ? 'poke' : 'pokeLoose',
  }));
  if (outcome === OUTCOME.take) return { winnerId: checker.id, puck: 'toWinner' };
  // His stick knocks it off the carrier's: a touch, and the puck squirts away from him.
  const p = state.puck.pos;
  state.lastTouch = { id: checker.id, side: checker.side };
  state.possession = checker.side;
  recordTouch(state, checker.id, checker.side);
  const a = Math.atan2(p.y - checker.pos.y, p.x - checker.pos.x) + ctx.rng.gauss() * LOOSE_SPREAD;
  const v = ctx.rng.range(LOOSE_SPEED[0], LOOSE_SPEED[1]);
  return {
    winnerId: checker.id, puck: 'loose',
    looseVel: { x: Math.cos(a) * v + carrier.vel.x * 0.5, y: Math.sin(a) * v + carrier.vel.y * 0.5 },
  };
}
