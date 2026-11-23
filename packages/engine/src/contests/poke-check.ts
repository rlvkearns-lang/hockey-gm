import { recordTouch } from '../actions';
import { sitBack } from '../team-play';
import { TUNING } from '../tuning';
import type { ContestState, PlayerDef, SkaterState } from '../types';
import { dist, hypot2 } from '../vec';
import {
  carrierNow, carrierOf, contestEvent, contestRating, dropParticipant, enterStage, isFree, onCooldown, setCooldown, skaterById, STAGE_EPS,
  winProb, type Contest, type ContestCtx, type ContestResult,
} from './core';
import { datan2, dcos, dsin } from '../dmath';

const KIND = 'pokeCheck';
const T = TUNING.poke;
/** Stage lengths (s): the stick goes out, then the outcome shows before the puck moves. */
const REACH_SECONDS = 0.25;
const RESOLVE_SECONDS = 0.1;
/** A badly beaten defender loses a step: his speedCap is halved for this long. */
const BEATEN_SECONDS = 0.7;
const BEATEN_SPEED_CAP = 0.5;
/** How fast the checker moves while the stick is out (fraction of top speed). */
const REACH_SPEED_CAP = 0.5;
/** `data.outcome` codes (numbers, so the state stays plain numeric data). */
const OUTCOME = { undecided: 0, take: 1, loose: 2, kept: 3, beaten: 4 } as const;

function setTarget(s: SkaterState, x: number, y: number): void {
  s.target.x = x;
  s.target.y = y;
}

/** The checker reaches for the puck, facing it. (The carrier is in `freeIds`: he keeps playing his own way.) */
function steerReach(ctx: ContestCtx, checker: SkaterState): void {
  const p = ctx.state.puck.pos;
  setTarget(checker, p.x, p.y);
  if (checker.faceTarget) { checker.faceTarget.x = p.x; checker.faceTarget.y = p.y; } else checker.faceTarget = { x: p.x, y: p.y };
  checker.speedCap = REACH_SPEED_CAP;
}

/**
 * Poke check, stages `reach` (REACH_SECONDS: the stick goes out), `resolve` (RESOLVE_SECONDS: `leader` is the
 * winner) and, after a failure by a wide margin, `beaten` (the checker alone, a step behind). Participants: the
 * checker, then the carrier (in `freeIds`: only the checker is steered). The carrier letting the puck go before it
 * resolves, or being out of the checker's reach when the reach ends, ends it with no result.
 * `data.outcome` is one of OUTCOME: undecided, the checker takes it, knocks it loose, the carrier keeps it, or keeps it
 * and the checker is beaten.
 */
export const pokeCheckContest: Contest = {
  kind: KIND,

  gate(ctx) {
    const carrier = carrierNow(ctx);
    return carrier !== null && isFree(carrier) && ctx.state.puck.z <= 0;
  },

  trigger(ctx, s) {
    const state = ctx.state;
    const carrier = carrierNow(ctx);
    if (!carrier || carrier.side === s.side || !isFree(carrier) || state.puck.z > 0) return null;
    const dx = s.pos.x - carrier.pos.x, dy = s.pos.y - carrier.pos.y;
    const d = hypot2(dx, dy);
    if (d > T.triggerRange) return null;
    if (d > 0 && (dcos(carrier.facing) * dx + dsin(carrier.facing) * dy) / d < T.frontCos) return null;
    if (onCooldown(state, s.id, KIND)) return null;
    // He makes up his mind once per cooldown: poke now, or keep his position.
    setCooldown(state, s.id, KIND, T.cooldownSeconds);
    // A team comfortably ahead (sitBack) gambles for the puck a little less; never always or never.
    const p = Math.max(0.03, Math.min(0.97, pokeAttemptChance(ctx.defs.get(s.id)!) * sitBack(state, s.side)));
    return ctx.rng.next() < p ? [s.id, carrier.id] : null;
  },

  start(ctx, participants) {
    const [checkerId, carrierId] = participants as [string, string];
    const state = ctx.state;
    setCooldown(state, checkerId, KIND, T.cooldownSeconds);
    steerReach(ctx, skaterById(state, checkerId));
    return {
      id: -1, kind: KIND, stage: 'reach', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: state.puck.pos.x, y: state.puck.pos.y }, freeIds: [carrierId], data: { outcome: OUTCOME.undecided },
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
    steerReach(ctx, checker);
    c.spot.x = state.puck.pos.x;
    c.spot.y = state.puck.pos.y;

    if (c.stage === 'reach') {
      if (c.stageT < REACH_SECONDS - STAGE_EPS) return null;
      if (dist(checker.pos, carrier.pos) > T.stickReach) return { winnerId: null, puck: 'unchanged' }; // the stick cannot get there
      c.data.outcome = roll(c, ctx, checker, carrier);
      c.leader = c.data.outcome === OUTCOME.take || c.data.outcome === OUTCOME.loose ? checker.id : carrier.id;
      enterStage(c, 'resolve');
      return null;
    }
    if (c.stageT < RESOLVE_SECONDS - STAGE_EPS) return null;
    return finish(c, ctx, checker, carrier);
  },
};

/** Chance a defender in range goes for the puck when he makes up his mind: attemptBase + attemptPerPoint * (stickChecking - 50), within [0.03, 0.97]. */
export function pokeAttemptChance(d: PlayerDef): number {
  return Math.max(0.03, Math.min(0.97, T.attemptBase + T.attemptPerPoint * (d.attrs.stickChecking - 50)));
}

/**
 * The poke itself: one roll against winProb of the checker's edge. A failed poke then leaves him beaten with its own
 * chance, T.beatenChance at an even contest, more when he was the underdog, less when he was favoured (never certain
 * either way). Returns the `data.outcome` code.
 */
function roll(c: ContestState, ctx: ContestCtx, checker: SkaterState, carrier: SkaterState): number {
  const edge = contestRating(ctx, c, checker.id, T.stick) - contestRating(ctx, c, carrier.id, T.hands) - T.carrierEdge;
  const p = winProb(edge);
  if (ctx.rng.next() < p) return ctx.rng.chance(T.takeShare) ? OUTCOME.take : OUTCOME.loose;
  return ctx.rng.chance(beatenChance(p)) ? OUTCOME.beaten : OUTCOME.kept;
}

/** Chance that a failed poke leaves the checker beaten, from his chance `p` of winning it: within [0.03, 0.97]. */
export function beatenChance(p: number): number {
  return Math.max(0.03, Math.min(0.97, T.beatenChance * 2 * (1 - p)));
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
  const a = datan2(p.y - checker.pos.y, p.x - checker.pos.x) + ctx.rng.gauss() * T.looseSpread;
  const v = ctx.rng.range(T.looseSpeed[0], T.looseSpeed[1]);
  return {
    winnerId: checker.id, puck: 'loose',
    looseVel: { x: dcos(a) * v + carrier.vel.x * 0.5, y: dsin(a) * v + carrier.vel.y * 0.5 },
  };
}
