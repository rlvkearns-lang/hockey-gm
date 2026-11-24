import { hasBadge } from '../badges';
import { DT } from '../constants';
import { bodyRadius, movementOf } from '../skating';
import { TUNING } from '../tuning';
import type { ContestStateOf, GameState, HitDegree, PlayerDef, SkaterState } from '../types';
import { hypot2 } from '../vec';
import { datan2, dexp } from '../dmath';
import { wrapAngle } from '../skating';
import {
  applyResult, carrierNow, contestChemistry, contestEvent, dropParticipant, effective, enterStage, isFree, onCooldown, setCooldown, skaterById,
  STAGE_EPS, winProb, type Contest, type ContestCtx,
} from './core';

const KIND = 'hit';
const T = TUNING.hit;
/** Stage lengths (s): no contact within CLOSE_MAX_SECONDS is a miss. */
const CLOSE_MAX_SECONDS = 1.2;
const IMPACT_SECONDS = 0.15;
/** The hitter regathers for this long after contact, and is out of the play this long after a miss. */
const RECOVER_SECONDS = 0.4;
const MISS_RECOVER_SECONDS = 0.8;
/** Bodies are in contact once their centres are within the two radii plus this (m). */
const CONTACT_MARGIN = 0.15;
/** The hitter aims this far (m) through the target, so he does not ease off before contact. */
const THROUGH = 1.5;
/** A landed hit puts the target down for this long (s), longer the bigger the margin. */
const DOWN_SECONDS: [number, number] = [0.6, 1.4];
/** A bounced hitter goes down for this long (s). */
const BOUNCE_DOWN_SECONDS = 0.5;
/** Speed (m/s) a hit can leave the target with, at most. */
const MAX_KNOCKED_SPEED = 10;
/** A puck knocked off a hit carrier keeps this share of his velocity, plus a random push (m/s, one standard deviation). */
const LOOSE_CARRY = 0.6;
const LOOSE_PUSH = 1.5;
/** While regathering the hitter coasts at this fraction of top speed. */
const RECOVER_SPEED_CAP = 0.3;

/** `t` has the puck, or let it go within T.releaseWindowSeconds. */
function isHittable(state: GameState, t: SkaterState): boolean {
  if (state.carrierId === t.id) return true;
  const r = state.lastRelease;
  return r !== null && r.id === t.id && state.tick - r.tick <= Math.round(T.releaseWindowSeconds / DT);
}

/** Speed (m/s) at which `h` closes on `t` along the line between them (negative when parting). */
function closingSpeed(h: SkaterState, t: SkaterState): number {
  const dx = t.pos.x - h.pos.x, dy = t.pos.y - h.pos.y;
  const d = hypot2(dx, dy);
  if (d === 0) return 0;
  return ((h.vel.x - t.vel.x) * dx + (h.vel.y - t.vel.y) * dy) / d;
}

/**
 * Chance that `hitter` (state `h`) lands a hit on `target` (state `t`) at contact, closing at `closing` m/s:
 * winProb of T.attrScale times (hitter (bodyChecking .5, strength .3, balance .2) minus target (balance .45, strength .35, poise .2)) plus
 * (hitterMass * closing - targetMass * T.braceSpeed) / T.momentumScale, masses from Movement. Chemistry is each one's
 * mean with teammates in it; `jumpEdge` is the hitter's team's jump less the target's (GameState.teamJump).
 */
export function hitChance(
  hitter: PlayerDef, h: SkaterState, target: PlayerDef, t: SkaterState, closing: number, hitterChem = 0, targetChem = 0, jumpEdge = 0,
): number {
  // (Task 12: a Big Hitter's rating is TUNING.badges.bigHitterRating higher.)
  const edge = T.attrScale * (effective(hitter, h, T.hitter, hitterChem) + (hasBadge(hitter, 'Big Hitter') ? TUNING.badges.bigHitterRating : 0) - effective(target, t, T.brace, targetChem)) + jumpEdge
    + (movementOf(hitter, 1).mass * closing - movementOf(target, 1).mass * T.braceSpeed) / T.momentumScale;
  return winProb(edge);
}

/** Chance a skater goes for a hit when one is on: tendencies.hit * aggression / 100, within [0.03, 0.97]. */
export function hitAttemptChance(d: PlayerDef): number {
  return Math.max(0.03, Math.min(0.97, (d.tendencies.hit * d.attrs.aggression) / 100));
}

/** `t` is an opponent of `h` he could hit now: free, hittable, within T.triggerRange and being closed on fast enough. */
function inReach(state: GameState, h: SkaterState, t: SkaterState | null): t is SkaterState {
  return t !== null && t.side !== h.side && isFree(t) && isHittable(state, t)
    && hypot2(t.pos.x - h.pos.x, t.pos.y - h.pos.y) <= T.triggerRange && closingSpeed(h, t) > T.minClosing;
}

type Hittable = { carrier: SkaterState | null; released: SkaterState | null };
const HITTABLE = 'hit.hittable';

/**
 * Who could be hit now: the carrier, and the skater who let the puck go within T.releaseWindowSeconds (if he is not the
 * carrier). Worked out once per round of triggers (kept in `ctx.memo`, emptied whenever a contest starts).
 */
function hittable(ctx: ContestCtx): Hittable {
  const memo = ctx.memo.get(HITTABLE) as Hittable | undefined;
  if (memo !== undefined) return memo;
  const state = ctx.state;
  const carrier = carrierNow(ctx);
  const r = state.lastRelease;
  const released = r !== null && r.id !== state.carrierId && state.tick - r.tick <= Math.round(T.releaseWindowSeconds / DT) ? skaterById(state, r.id) : null;
  const out: Hittable = { carrier, released };
  ctx.memo.set(HITTABLE, out);
  return out;
}

/** The hitter drives through the target, facing him. */
function steerHitter(h: SkaterState, t: SkaterState): void {
  const dx = t.pos.x - h.pos.x, dy = t.pos.y - h.pos.y;
  const d = hypot2(dx, dy) || 1;
  h.target.x = t.pos.x + t.vel.x * 0.1 + (dx / d) * THROUGH;
  h.target.y = t.pos.y + t.vel.y * 0.1 + (dy / d) * THROUGH;
  if (h.faceTarget) { h.faceTarget.x = t.pos.x; h.faceTarget.y = t.pos.y; } else h.faceTarget = { x: t.pos.x, y: t.pos.y };
  h.speedCap = 1;
}

/**
 * Body check, stages `close` (until contact, at most CLOSE_MAX_SECONDS), `impact` (IMPACT_SECONDS; `leader` is the
 * favourite) and `recover` (the hitter alone; `leader` is who won). Participants: the hitter, then the target, who is
 * in `freeIds` (keeps playing) during `close` and steered by the hit from contact on. Roles: `hitter`, `target`.
 * `data.p` is the hitter's chance once contact is made; `data.result` how it went, once known.
 */
export const hitContest: Contest<'hit'> = {
  kind: KIND,

  gate(ctx) {
    const { carrier, released } = hittable(ctx);
    return carrier !== null || released !== null;
  },

  trigger(ctx, h) {
    const state = ctx.state;
    if (onCooldown(state, h.id, KIND)) return null;
    const { carrier, released } = hittable(ctx);
    if (carrier === null && released === null) return null;
    const t = inReach(state, h, carrier) ? carrier : inReach(state, h, released) ? released : null;
    if (t === null) return null;
    setCooldown(state, h.id, KIND, T.decideSeconds);
    return ctx.rng.next() < hitAttemptChance(ctx.defs.get(h.id)!) ? [h.id, t.id] : null;
  },

  start(ctx, participants) {
    const state = ctx.state;
    const h = skaterById(state, participants[0]!), t = skaterById(state, participants[1]!);
    steerHitter(h, t);
    return {
      id: -1, kind: KIND, stage: 'close', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: t.pos.x, y: t.pos.y }, freeIds: [t.id], roles: { hitter: h.id, target: t.id }, data: { p: 0, recover: 0, result: 'pending', degree: null },
    };
  },

  update(c, ctx) {
    const state = ctx.state;
    const h = skaterById(state, c.roles.hitter);
    if (c.stage === 'recover') {
      h.target.x = h.pos.x + h.vel.x * 0.4;
      h.target.y = h.pos.y + h.vel.y * 0.4;
      h.faceTarget = null;
      h.speedCap = RECOVER_SPEED_CAP;
      if (c.stageT < c.data.recover - STAGE_EPS || h.downT !== 0) return null;
      return { winnerId: c.leader, puck: 'unchanged', outcome: c.data.result === 'pending' ? 'missed' : c.data.result };
    }
    const t = skaterById(state, c.roles.target);
    if (c.stage === 'close') {
      if (t.downT > 0 || !isHittable(state, t) || c.stageT >= CLOSE_MAX_SECONDS - STAGE_EPS) {
        c.data.result = 'missed';
        toRecover(state, c, t.id, MISS_RECOVER_SECONDS);
        return null;
      }
      steerHitter(h, t);
      c.spot.x = t.pos.x;
      c.spot.y = t.pos.y;
      const dh = ctx.defs.get(h.id)!, tDef = ctx.defs.get(t.id)!;
      if (hypot2(t.pos.x - h.pos.x, t.pos.y - h.pos.y) > bodyRadius(dh.weightKg) + bodyRadius(tDef.weightKg) + CONTACT_MARGIN) return null;
      c.data.p = hitChance(dh, h, tDef, t, Math.max(0, closingSpeed(h, t)), contestChemistry(ctx, c, h.id), contestChemistry(ctx, c, t.id),
        state.teamJump[h.side] - state.teamJump[t.side]);
      c.leader = c.data.p >= 0.5 ? h.id : t.id;
      c.spot.x = (h.pos.x + t.pos.x) / 2;
      c.spot.y = (h.pos.y + t.pos.y) / 2;
      c.freeIds.length = 0; // from contact on, the hit decides what happens to him
      enterStage(c, 'impact');
      return null;
    }
    // impact
    steerHitter(h, t);
    if (c.stageT < IMPACT_SECONDS - STAGE_EPS) return null;
    resolveImpact(c, ctx, h, t);
    return null;
  },
};

/** `t` leaves the contest; the hitter regathers for `seconds`. */
function toRecover(state: GameState, c: ContestStateOf<'hit'>, tId: string, seconds: number): void {
  if (c.leader === null) c.leader = tId;
  dropParticipant(state, c, tId);
  c.data.recover = seconds;
  enterStage(c, 'recover');
}

const D = T.degree;
const logistic = (x: number): number => 1 / (1 + dexp(-x));

/**
 * How hard a landed hit is. x = (closing - 6) * 0.25 + (hitterMass - targetMass) / 8 - (target balance - 70) / 20 - (sawIt ? 0.8 : 0) + margin
 * (margin 0..1: how clearly the roll was won) + `bonus` (a Big Hitter's TUNING.badges.bigHitterDegree, Task 12). knockdown with chance clamp(logistic(x - 0.2), 0.03, 0.97); otherwise stagger with
 * chance clamp(logistic(x + 1.2), 0.03, 0.97); otherwise a bump. `sawIt`: the hitter is within 100 degrees of the target's facing at contact.
 * (The numbers are TUNING.hit.degree's.)
 */
export function hitDegreeChances(closing: number, hitterMass: number, targetMass: number, targetBalance: number, sawIt: boolean, margin: number, bonus = 0): { knockdown: number; stagger: number } {
  const x = (closing - D.closingFrom) * D.perClosing + (hitterMass - targetMass) / D.kgPerPoint - (targetBalance - D.balanceFrom) / D.balancePer
    - (sawIt ? D.sawIt : 0) + margin + bonus;
  const c = (v: number): number => Math.max(0.03, Math.min(0.97, v));
  return { knockdown: c(logistic(x + D.knockdown)), stagger: c(logistic(x + D.stagger)) };
}

/** The most of his top speed `id` may skate at now: TUNING.hit.degree.staggerCap while staggered by a hit, else 1. */
export function staggerCap(state: GameState, id: string): number {
  for (const s of state.staggered) if (s.id === id && state.tick < s.untilTick) return D.staggerCap;
  return 1;
}

/** `t` saw `h` coming: `h` is within TUNING.hit.degree.sawAngle of his facing. */
function sawIt(h: SkaterState, t: SkaterState): boolean {
  return Math.abs(wrapAngle(datan2(h.pos.y - t.pos.y, h.pos.x - t.pos.x) - t.facing)) <= D.sawAngle;
}

/** The roll at the end of the impact, and what it does to both bodies and the puck. */
function resolveImpact(c: ContestStateOf<'hit'>, ctx: ContestCtx, h: SkaterState, t: SkaterState): void {
  const state = ctx.state;
  const p = c.data.p;
  const u = ctx.rng.next();
  const won = u < p;
  const dx = t.pos.x - h.pos.x, dy = t.pos.y - h.pos.y;
  const d = hypot2(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const mh = movementOf(ctx.defs.get(h.id)!, 1).mass, mt = movementOf(ctx.defs.get(t.id)!, 1).mass;
  const push = Math.max(0, closingSpeed(h, t)) * (mh / (mh + mt));
  let result: 'landed' | 'absorbed' | 'bounced';
  let separated = false;
  let degree: HitDegree | null = null;
  if (won) {
    // How hard it was (Task 9): by the closing speed, the weights, his balance, whether he saw it and the margin of the roll.
    const td = ctx.defs.get(t.id)!;
    const ch = hitDegreeChances(Math.max(0, closingSpeed(h, t)), mh, mt, td.attrs.balance, sawIt(h, t), p - u, hasBadge(ctx.defs.get(h.id)!, 'Big Hitter') ? TUNING.badges.bigHitterDegree : 0);
    degree = ctx.rng.chance(ch.knockdown) ? 'knockdown' : ctx.rng.chance(ch.stagger) ? 'stagger' : 'bump';
    if (degree === 'knockdown') {
      t.downT = DOWN_SECONDS[0] + (DOWN_SECONDS[1] - DOWN_SECONDS[0]) * (1 - u / p);
      knock(t, ux * push, uy * push);
    } else if (degree === 'stagger') {
      // He keeps his feet and loses a step.
      t.vel.x *= D.staggerKeep;
      t.vel.y *= D.staggerKeep;
      const until = state.tick + Math.round(D.staggerSeconds / DT);
      let had = false;
      for (const s of state.staggered) if (s.id === t.id) { s.untilTick = until; had = true; }
      if (!had) state.staggered.push({ id: t.id, untilTick: until });
    } else knock(t, ux * push * D.bumpPush, uy * push * D.bumpPush);
    h.vel.x *= 0.4;
    h.vel.y *= 0.4;
    result = 'landed';
    separated = state.carrierId === t.id
      && (degree === 'knockdown' || ctx.rng.chance(degree === 'stagger' ? D.staggerLoose : D.bumpLoose));
    if (separated) {
      const vx = t.vel.x * LOOSE_CARRY + ctx.rng.gauss() * LOOSE_PUSH, vy = t.vel.y * LOOSE_CARRY + ctx.rng.gauss() * LOOSE_PUSH;
      applyResult(ctx, c, { winnerId: h.id, puck: 'loose', looseVel: { x: vx, y: vy }, outcome: 'landed' });
    }
  } else {
    knock(t, ux * push * 0.3, uy * push * 0.3);
    if (ctx.rng.chance(bounceChance(p))) {
      h.downT = BOUNCE_DOWN_SECONDS;
      h.vel.x = -ux;
      h.vel.y = -uy;
      result = 'bounced';
    } else {
      h.vel.x *= 0.3;
      h.vel.y *= 0.3;
      result = 'absorbed';
    }
  }
  c.data.result = result;
  c.data.degree = degree;
  ctx.emit(contestEvent(state, { type: 'hit', side: h.side, playerId: h.id, otherId: t.id, pos: c.spot, detail: { result, contestId: c.id, degree } }));
  // A hit that knocks the puck off the carrier is a turnover (loose: not a box-score takeaway, see turnovers.ts).
  if (separated) ctx.emit(contestEvent(state, { type: 'turnover', side: h.side, playerId: h.id, otherId: t.id, pos: state.puck.pos, detail: { how: 'hit' } }));
  c.leader = won ? h.id : t.id;
  toRecover(state, c, t.id, RECOVER_SECONDS);
}

/** Chance that a failed hit bounces the hitter off, from his chance `p` of landing it: within [0.03, 0.97]. */
export function bounceChance(p: number): number {
  return Math.max(0.03, Math.min(0.97, T.bounceChance * 2 * (1 - p)));
}

/** Adds (vx, vy) to `s`'s velocity, capped at MAX_KNOCKED_SPEED. */
function knock(s: SkaterState, vx: number, vy: number): void {
  s.vel.x += vx;
  s.vel.y += vy;
  const v = hypot2(s.vel.x, s.vel.y);
  if (v > MAX_KNOCKED_SPEED) { s.vel.x *= MAX_KNOCKED_SPEED / v; s.vel.y *= MAX_KNOCKED_SPEED / v; }
}
