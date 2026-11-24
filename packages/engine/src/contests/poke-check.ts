import { hasBadge } from '../badges';
import { planOf } from '../commit';
import { recordTouch } from '../actions';
import { DT } from '../constants';
import { bladePos } from '../blade';
import { movementOf } from '../skating';
import { sitBack } from '../team-play';
import { TUNING } from '../tuning';
import { heldSeconds, watchTurnover } from '../turnovers';
import type { ContestStateOf, GameState, PlayerDef, SkaterState } from '../types';
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
/** The stick is far enough out to poke from REACH_MIN_SECONDS (s): from then to REACH_SECONDS he pokes as soon as the puck is a stick length away. */
const REACH_MIN_SECONDS = 0.15;
const RESOLVE_SECONDS = 0.1;
/** A badly beaten defender loses a step: his speedCap is halved for this long. */
const BEATEN_SECONDS = 0.7;
const BEATEN_SPEED_CAP = 0.5;
/**
 * How fast the checker moves while the stick is out (fraction of top speed): REACH_SPEED_CAP, or as fast as the carrier
 * skates (Task 9: from a stick length he keeps with him) plus REACH_KEEP. He makes for the stand-off point from where the
 * puck will be LEAD_SECONDS on.
 */
const REACH_SPEED_CAP = 0.5;
const REACH_KEEP = 0.15;
const LEAD_SECONDS = 0.2;

function setTarget(s: SkaterState, x: number, y: number): void {
  s.target.x = x;
  s.target.y = y;
}

/**
 * The checker reaches for the puck from a stick length, facing it: he makes for the point T.standOff from it on his side
 * of it (Task 9: he was skating onto it). (The carrier is in `freeIds`: he keeps playing his own way.)
 */
function steerReach(ctx: ContestCtx, checker: SkaterState): void {
  const pk = ctx.state.puck;
  const p = pk.pos;
  // Where the puck will be a moment on (a carrier skating away is followed, not lost).
  const px = p.x + pk.vel.x * LEAD_SECONDS, py = p.y + pk.vel.y * LEAD_SECONDS;
  const dx = checker.pos.x - px, dy = checker.pos.y - py, d = hypot2(dx, dy);
  if (d > 1e-9) setTarget(checker, px + (dx / d) * T.standOff, py + (dy / d) * T.standOff);
  else setTarget(checker, checker.pos.x, checker.pos.y);
  if (checker.faceTarget) { checker.faceTarget.x = p.x; checker.faceTarget.y = p.y; } else checker.faceTarget = { x: p.x, y: p.y };
  const v = hypot2(pk.vel.x, pk.vel.y), top = ctx.defs.has(checker.id) ? movementOf(ctx.defs.get(checker.id)!, 1).topSpeed : 9;
  checker.speedCap = Math.min(1, Math.max(REACH_SPEED_CAP, v / top + REACH_KEEP));
}

/**
 * Poke check, stages `reach` (the stick goes out: he pokes from REACH_MIN_SECONDS on, as soon as the puck is a stick
 * length away, and at REACH_SECONDS at the latest; a won poke, take or loose, ends it there and then, the puck moving that
 * tick: Task 9 review), `resolve` (RESOLVE_SECONDS, a failed poke: `leader` is the carrier) and, after a failure by a wide margin, `beaten` (the checker alone, a step behind). Participants: the
 * checker, then the carrier (in `freeIds`: only the checker is steered). The carrier letting the puck go before it
 * resolves, or the checker not a stick length from the puck when the reach ends (T.minReach to T.stickReach), ends it
 * with no result. A `take` gives the checker the puck: it goes to his blade (applyResult).
 * Roles: `checker`, `carrier`. `data.outcome`: undecided, the checker takes it, knocks it loose, the carrier keeps it,
 * or keeps it and the checker is beaten.
 */
export const pokeCheckContest: Contest<'pokeCheck'> = {
  kind: KIND,

  gate(ctx) {
    const carrier = carrierNow(ctx);
    return carrier !== null && isFree(carrier) && ctx.state.puck.z <= 0;
  },

  trigger(ctx, s) {
    const state = ctx.state;
    const carrier = carrierNow(ctx);
    if (!carrier || carrier.side === s.side || !isFree(carrier) || state.puck.z > 0) return null;
    // In range of the puck (on the carrier's blade), and in front of the carrier or beside him.
    const pk = state.puck.pos;
    // A stick length away (Task 9): on top of the puck he has no poke at it, nor when, as he and it are going, it will be
    // on top of him or out of his reach when the stick gets there (REACH_SECONDS on: he cannot stop or turn in that time).
    const dp = hypot2(s.pos.x - pk.x, s.pos.y - pk.y);
    if (dp > T.triggerRange || dp < T.minReach) return null;
    const vel = state.puck.vel;
    const ahead = hypot2(pk.x - s.pos.x + (vel.x - s.vel.x) * REACH_SECONDS, pk.y - s.pos.y + (vel.y - s.vel.y) * REACH_SECONDS);
    if (ahead < T.minReach || ahead > T.stickReach) return null;
    const dx = s.pos.x - carrier.pos.x, dy = s.pos.y - carrier.pos.y;
    const d = hypot2(dx, dy);
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
      spot: { x: state.puck.pos.x, y: state.puck.pos.y }, freeIds: [carrierId], roles: { checker: checkerId, carrier: carrierId },
      data: { outcome: 'undecided' },
    };
  },

  update(c, ctx) {
    const state = ctx.state;
    const checker = skaterById(state, c.roles.checker);
    if (c.stage === 'beaten') {
      const carrier = carrierOf(state);
      setTarget(checker, carrier ? carrier.pos.x : checker.pos.x, carrier ? carrier.pos.y : checker.pos.y);
      checker.faceTarget = null;
      checker.speedCap = BEATEN_SPEED_CAP;
      return c.stageT >= BEATEN_SECONDS - STAGE_EPS ? { winnerId: c.leader, puck: 'unchanged', outcome: 'beaten' } : null;
    }
    const carrierId = c.roles.carrier;
    if (state.carrierId !== carrierId) return { winnerId: null, puck: 'unchanged', outcome: 'released' }; // he got rid of it in time
    const carrier = skaterById(state, carrierId);
    steerReach(ctx, checker);
    c.spot.x = state.puck.pos.x;
    c.spot.y = state.puck.pos.y;

    if (c.stage === 'reach') {
      if (c.stageT < REACH_MIN_SECONDS - STAGE_EPS) return null;
      // From a stick length only: too far, the stick cannot get there; too close, he is on top of it (Task 9). Once the
      // stick is most of the way out he pokes as the puck comes into that window; still outside it when the reach ends,
      // nothing comes of it.
      const reach = dist(checker.pos, state.puck.pos);
      const inWindow = reach <= T.stickReach && reach >= T.minReach;
      if (!inWindow && c.stageT < REACH_SECONDS - STAGE_EPS) return null;
      if (!inWindow) return { winnerId: null, puck: 'unchanged', outcome: 'outOfReach' };
      c.data.outcome = roll(c, ctx, checker, carrier);
      c.leader = c.data.outcome === 'take' || c.data.outcome === 'loose' ? checker.id : carrier.id;
      // Task 9 review, Important 2: a won poke moves the puck the moment it is won (the carrier no longer skates on with
      // it for the 0.1 s the result shows, which turned about 44% of won takes into loose pucks).
      if (c.leader === checker.id) return finish(c, ctx, checker, carrier);
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
 * either way). Returns the `data.outcome`.
 */
function roll(c: ContestStateOf<'pokeCheck'>, ctx: ContestCtx, checker: SkaterState, carrier: SkaterState): 'take' | 'loose' | 'kept' | 'beaten' {
  const edge = contestRating(ctx, c, checker.id, T.stick) - contestRating(ctx, c, carrier.id, T.hands) - T.carrierEdge + pokeBadgeEdge(ctx.state, ctx.defs.get(checker.id)!, checker, ctx.defs.get(carrier.id)!, carrier);
  const p = winProb(edge);
  if (ctx.rng.next() < p) return ctx.rng.chance(T.takeShare) ? 'take' : 'loose';
  return ctx.rng.chance(beatenChance(p)) ? 'beaten' : 'kept';
}

/**
 * Badges in a poke check (Task 12, TUNING.badges), in the checker's rating points: a Stick Checker's stick rating
 * +stickCheckerStick; a Shutdown man's +shutdownRating against the man he marks; a Stickhandler's hands rating
 * +stickhandlerHands and an Elusive carrier's edge +elusivePokeEdge count against him.
 */
export function pokeBadgeEdge(state: GameState, checker: PlayerDef, cs: SkaterState, carrier: PlayerDef, ks: SkaterState): number {
  const B = TUNING.badges;
  return (hasBadge(checker, 'Stick Checker') ? B.stickCheckerStick : 0)
    + (hasBadge(checker, 'Shutdown') && planOf(state, cs.id).markId === ks.id ? B.shutdownRating : 0)
    - (hasBadge(carrier, 'Stickhandler') ? B.stickhandlerHands : 0)
    - (hasBadge(carrier, 'Elusive') ? B.elusivePokeEdge : 0);
}

/** Chance that a failed poke leaves the checker beaten, from his chance `p` of winning it: within [0.03, 0.97]. */
export function beatenChance(p: number): number {
  return Math.max(0.03, Math.min(0.97, T.beatenChance * 2 * (1 - p)));
}

/** A take puts the puck on his blade only from this close (m) to it (the most a pickup moves it); further, it is raked loose toward him. */
const TAKE_REACH = 1.2;
const bladeScratch = { x: 0, y: 0 };

function finish(c: ContestStateOf<'pokeCheck'>, ctx: ContestCtx, checker: SkaterState, carrier: SkaterState): ContestResult | null {
  const state = ctx.state;
  let outcome = c.data.outcome;
  // A take goes to his blade (Task 9), decided the tick the poke is won; with his blade over TAKE_REACH from the puck then,
  // it was no take: it is raked loose toward him.
  const pk = state.puck.pos;
  const blade = bladePos(checker.pos, checker.facing, ctx.defs.get(checker.id)!.shoots, bladeScratch);
  // (Task 12 close-out: less how far he moves this tick, as the hand-over is read after it: a take decided at 1.19 m on
  // seed 12 ended over 1.2 m from his blade, a jump.)
  const reach = TAKE_REACH - hypot2(checker.vel.x, checker.vel.y) * DT;
  const far = outcome === 'take' && hypot2(blade.x - pk.x, blade.y - pk.y) > reach;
  if (far) { outcome = 'loose'; c.data.outcome = 'loose'; }
  if (outcome === 'beaten') {
    dropParticipant(state, c, carrier.id);
    enterStage(c, 'beaten');
    return null;
  }
  if (outcome === 'kept') return { winnerId: carrier.id, puck: 'unchanged', outcome: 'kept' };
  ctx.emit(contestEvent(state, {
    type: 'turnover', side: checker.side, playerId: checker.id, otherId: carrier.id, pos: state.puck.pos, detail: { how: outcome === 'take' ? 'poke' : 'pokeLoose' },
  }));
  if (outcome === 'take') {
    watchTurnover(state, checker.side, checker.id, carrier.id, 'poke', { held: heldSeconds(state, carrier.id) });
    return { winnerId: checker.id, puck: 'toWinner', outcome: 'take' };
  }
  // His stick knocks it off the carrier's: a touch, and the puck squirts away from him (raked toward his blade: see above).
  const p = state.puck.pos;
  state.lastTouch = { id: checker.id, side: checker.side };
  state.possession = checker.side;
  recordTouch(state, checker.id, checker.side);
  const a = far ? datan2(blade.y - p.y, blade.x - p.x) : datan2(p.y - checker.pos.y, p.x - checker.pos.x) + ctx.rng.gauss() * T.looseSpread;
  const v = ctx.rng.range(T.looseSpeed[0], T.looseSpeed[1]);
  return {
    winnerId: checker.id, puck: 'loose', outcome: 'loose',
    looseVel: { x: dcos(a) * v + carrier.vel.x * 0.5, y: dsin(a) * v + carrier.vel.y * 0.5 },
  };
}
