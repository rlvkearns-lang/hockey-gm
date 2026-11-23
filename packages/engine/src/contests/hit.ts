import { DT } from '../constants';
import { bodyRadius, movementOf } from '../skating';
import { TUNING } from '../tuning';
import type { ContestState, GameState, PlayerDef, SkaterState } from '../types';
import { hypot2 } from '../vec';
import {
  applyResult, carrierOf, contestChemistry, contestEvent, dropParticipant, effective, enterStage, isFree, onCooldown, setCooldown, skaterById,
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
 * winProb of hitter (bodyChecking .5, strength .3, balance .2) minus target (balance .45, strength .35, poise .2) plus
 * (hitterMass * closing - targetMass * 2) / 12, masses from Movement. Chemistry is each one's mean with teammates in it.
 */
export function hitChance(
  hitter: PlayerDef, h: SkaterState, target: PlayerDef, t: SkaterState, closing: number, hitterChem = 0, targetChem = 0,
): number {
  const edge = effective(hitter, h, T.hitter, hitterChem) - effective(target, t, T.brace, targetChem)
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
  const carrier = carrierOf(state);
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
 * in `freeIds` (keeps playing) during `close` and steered by the hit from contact on.
 * `data.p` is the hitter's chance once contact is made.
 */
export const hitContest: Contest = {
  kind: KIND,

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
      spot: { x: t.pos.x, y: t.pos.y }, freeIds: [t.id], data: { p: 0, recover: 0 },
    };
  },

  update(c, ctx) {
    const state = ctx.state;
    const h = skaterById(state, c.participants[0]!);
    if (c.stage === 'recover') {
      h.target.x = h.pos.x + h.vel.x * 0.4;
      h.target.y = h.pos.y + h.vel.y * 0.4;
      h.faceTarget = null;
      h.speedCap = RECOVER_SPEED_CAP;
      return c.stageT >= c.data.recover! - STAGE_EPS && h.downT === 0 ? { winnerId: c.leader, puck: 'unchanged' } : null;
    }
    const t = skaterById(state, c.participants[1]!);
    if (c.stage === 'close') {
      if (t.downT > 0 || !isHittable(state, t) || c.stageT >= CLOSE_MAX_SECONDS - STAGE_EPS) {
        toRecover(state, c, t.id, MISS_RECOVER_SECONDS);
        return null;
      }
      steerHitter(h, t);
      c.spot.x = t.pos.x;
      c.spot.y = t.pos.y;
      const dh = ctx.defs.get(h.id)!, tDef = ctx.defs.get(t.id)!;
      if (hypot2(t.pos.x - h.pos.x, t.pos.y - h.pos.y) > bodyRadius(dh.weightKg) + bodyRadius(tDef.weightKg) + CONTACT_MARGIN) return null;
      c.data.p = hitChance(dh, h, tDef, t, Math.max(0, closingSpeed(h, t)), contestChemistry(ctx, c, h.id), contestChemistry(ctx, c, t.id));
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
function toRecover(state: GameState, c: ContestState, tId: string, seconds: number): void {
  if (c.leader === null) c.leader = tId;
  dropParticipant(state, c, tId);
  c.data.recover = seconds;
  enterStage(c, 'recover');
}

/** The roll at the end of the impact, and what it does to both bodies and the puck. */
function resolveImpact(c: ContestState, ctx: ContestCtx, h: SkaterState, t: SkaterState): void {
  const state = ctx.state;
  const p = c.data.p!;
  const u = ctx.rng.next();
  const won = u < p;
  const dx = t.pos.x - h.pos.x, dy = t.pos.y - h.pos.y;
  const d = hypot2(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const mh = movementOf(ctx.defs.get(h.id)!, 1).mass, mt = movementOf(ctx.defs.get(t.id)!, 1).mass;
  const push = Math.max(0, closingSpeed(h, t)) * (mh / (mh + mt));
  let detail: string;
  if (won) {
    t.downT = DOWN_SECONDS[0] + (DOWN_SECONDS[1] - DOWN_SECONDS[0]) * (1 - u / p);
    knock(t, ux * push, uy * push);
    h.vel.x *= 0.4;
    h.vel.y *= 0.4;
    detail = 'landed';
    if (state.carrierId === t.id) {
      const vx = t.vel.x * LOOSE_CARRY + ctx.rng.gauss() * LOOSE_PUSH, vy = t.vel.y * LOOSE_CARRY + ctx.rng.gauss() * LOOSE_PUSH;
      applyResult(ctx, c, { winnerId: h.id, puck: 'loose', looseVel: { x: vx, y: vy } });
    }
  } else {
    knock(t, ux * push * 0.3, uy * push * 0.3);
    if (ctx.rng.chance(bounceChance(p))) {
      h.downT = BOUNCE_DOWN_SECONDS;
      h.vel.x = -ux;
      h.vel.y = -uy;
      detail = 'bounced';
    } else {
      h.vel.x *= 0.3;
      h.vel.y *= 0.3;
      detail = 'absorbed';
    }
  }
  ctx.emit(contestEvent(state, { type: 'hit', side: h.side, playerId: h.id, otherId: t.id, assistIds: [], detail }));
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
