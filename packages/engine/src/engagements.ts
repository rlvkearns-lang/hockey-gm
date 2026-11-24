import { DT } from './constants';
import { effective, setCooldown, onCooldown, winProb } from './contests/core';
import { gameEvent } from './events';
import { RINK } from './rink';
import type { Rng } from './rng';
import { bodyRadius } from './skating';
import { TUNING } from './tuning';
import type { Engagement, GameEvent, GameState, PlayerDef, SkaterState } from './types';

export { engagementOf, engageSpeedFactor, tieOf, tiedChance } from './engage-state';

/**
 * Battling for position (Task 10, design A5): two opponents whose bodies come together engage instead of bouncing apart.
 * An engagement is lighter than a staged contest: nobody is steered; both are slowed by how tied up each is, and a tied-up
 * man is limited (pass reception, shot, tip, loose-puck reach; see the callers of tieOf). It is decided by a draw every
 * TUNING.engage.drawSeconds (strength, balance, compete, mass and inside position, inside the parity clamps), and it ends
 * only because someone gets loose, someone gives up (his job changes), they come apart, a staged contest takes one of
 * them, or the whistle (game.ts). Nothing is timed.
 */

const E = TUNING.engage;
const DRAW_TICKS = Math.max(1, Math.round(E.drawSeconds / DT));
const EVENT_TICKS = Math.round(E.eventSeconds / DT);
/**
 * A man who has just got loose from `otherId`, or given him up, is not engaged with him again for LOOSE_SECONDS (so he
 * can skate off: he won his freedom); the cooldown kind in state.contestCooldowns.
 */
const cooldownKind = (otherId: string): string => `engage:${otherId}`;
const LOOSE_SECONDS = 0.6;
function loose(state: GameState, id: string, otherId: string): void { setCooldown(state, id, cooldownKind(otherId), LOOSE_SECONDS); }

const mass = (d: PlayerDef): number => d.weightKg + 9;

/**
 * Chance `a` wins a draw: winProb of the difference in (strength .35, balance .3, compete .35, with energy, form and morale
 * as in `effective`), plus mass difference / TUNING.engage.massPerPoint, plus TUNING.engage.insideEdge for the man inside.
 */
export function engageChance(a: PlayerDef, sa: SkaterState, b: PlayerDef, sb: SkaterState, inside: 'a' | 'b' | null): number {
  const edge = effective(a, sa, E.weights) - effective(b, sb, E.weights) + (mass(a) - mass(b)) / E.massPerPoint
    + (inside === 'a' ? E.insideEdge : inside === 'b' ? -E.insideEdge : 0);
  return winProb(edge);
}

/** Per skater index: whether he is in an engagement this tick (scratch, refilled each call). */
const engaged: boolean[] = [];
/** Per skater index: his body radius (scratch). */
const radii: number[] = [];

const free = (s: SkaterState): boolean => s.onIce && !s.leaving && s.downT === 0 && s.contestId === null;

/** What the pair is doing: a ride with the puck, a box-out near a net, a tie-up by a defender on his man, else a lean. */
function kindOf(state: GameState, a: SkaterState, b: SkaterState): Engagement['kind'] {
  if (state.carrierId === a.id || state.carrierId === b.id) return 'ride';
  const mx = (a.pos.x + b.pos.x) / 2, my = (a.pos.y + b.pos.y) / 2;
  const gx = RINK.goalLineX - (mx >= 0 ? mx : -mx);
  if (gx * gx + my * my <= E.netRange * E.netRange) return 'boxOut';
  const plans = state.plans, sk = state.skaters;
  for (let i = 0; i < sk.length; i++) {
    const s = sk[i]!;
    if (s === a && plans[i]!.markId === b.id) return 'tieUp';
    if (s === b && plans[i]!.markId === a.id) return 'tieUp';
  }
  return 'lean';
}

/**
 * Once per live tick after contests. Ends engagements that are over (see below), draws for those due a draw, then starts
 * an engagement for two opponents in body contact (centres within their radii plus TUNING.engage.contact) moving at under
 * TUNING.engage.maxRelSpeed one against the other, each on the
 * ice, standing, not leaving, in no contest, in no other engagement and not just loose (ENGAGE_COOLDOWN); each starts
 * tied up by TUNING.engage.startTie.
 * Every TUNING.engage.drawSeconds one draw: the loser's tie rises by tieUp (at most 1), the winner's falls by tieDown (at
 * least 0); two wins in a row take inside position. Each man's speed cap is multiplied by 1 - slow * his tie (game.ts).
 * It ends: `contest` when a staged contest takes either man; `released` when either leaves the ice, heads off or goes
 * down, or they are more than contact + releaseGap apart; `heldPosition` when the inside man's opponent gives up (his job
 * changes; with nobody inside, or the inside man giving up, `released`); `foughtThrough` / `spunOff` when a man with tie
 * freeAt or less whose target is over breakAway m from the other wins a draw (fought through if he is then nearer the
 * puck or the net he attacks than the other, else spun off). An engagement of 0.3 s or more emits `engagement` when it
 * ends (into `out`).
 */
export function engagementTick(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out?: GameEvent[]): void {
  if (state.phase !== 'live') return;
  const sk = state.skaters, n = sk.length, es = state.engagements;
  engaged.length = n;
  for (let i = 0; i < n; i++) engaged[i] = false;
  let k = 0;
  for (let i = 0; i < es.length; i++) {
    const e = es[i]!;
    const ia = indexIn(sk, e.a), ib = indexIn(sk, e.b);
    const a = sk[ia]!, b = sk[ib]!;
    const end = stepEngagement(state, defs, rng, e, a, b, ia, ib);
    if (end === null) { es[k++] = e; engaged[ia] = true; engaged[ib] = true; continue; }
    if (out !== undefined && state.tick - e.sinceTick >= EVENT_TICKS) out.push(engagementEvent(state, e, a, b, end));
  }
  es.length = k;

  // New engagements: opposing pairs in body contact (a cheap broad phase on squared distances).
  radii.length = n;
  for (let i = 0; i < n; i++) { const s = sk[i]!; radii[i] = s.onIce ? bodyRadius(defs.get(s.id)!.weightKg) : 0; }
  for (let i = 0; i < n; i++) {
    const a = sk[i]!;
    if (engaged[i] || !free(a)) continue;
    for (let j = i + 1; j < n; j++) {
      const b = sk[j]!;
      if (engaged[j] || b.side === a.side || !free(b)) continue;
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, r = radii[i]! + radii[j]! + E.contact;
      if (dx * dx + dy * dy > r * r) continue;
      // Glancing past each other at speed is no battle for position.
      // (Across the line between them: one going by the other; into or apart along it is a man leaning in or pushing off.)
      const vx = b.vel.x - a.vel.x, vy = b.vel.y - a.vel.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const across = (vx * dy - vy * dx) / d;
      if (across > E.maxRelSpeed || across < -E.maxRelSpeed) continue;
      if (onCooldown(state, a.id, cooldownKind(b.id)) || onCooldown(state, b.id, cooldownKind(a.id))) continue;
      es.push({ a: a.id, b: b.id, sinceTick: state.tick, kind: kindOf(state, a, b), inside: null, tieA: E.startTie, tieB: E.startTie, lastWon: null, nextDrawTick: state.tick + DRAW_TICKS });
      engaged[i] = true;
      engaged[j] = true;
      break;
    }
  }
}

function indexIn(sk: readonly SkaterState[], id: string): number {
  for (let i = 0; i < sk.length; i++) if (sk[i]!.id === id) return i;
  return -1;
}

type EndResult = Exclude<EngagementResult, 'whistle'>;

/** One tick of engagement `e` between `a` and `b` (skater indexes ia, ib): its end, or null while it goes on. */
function stepEngagement(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, e: Engagement, a: SkaterState, b: SkaterState, ia: number, ib: number,
): EndResult | null {
  if (a.contestId !== null || b.contestId !== null) return 'contest';
  if (!a.onIce || !b.onIce || a.leaving || b.leaving || a.downT > 0 || b.downT > 0) return 'released';
  const da = defs.get(a.id)!, db = defs.get(b.id)!;
  const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dd = dx * dx + dy * dy;
  const touch = bodyRadius(da.weightKg) + bodyRadius(db.weightKg) + E.contact, apart = touch + E.releaseGap;
  if (dd > apart * apart) return 'released';
  // Giving up: his job changed since it began (he has somewhere else to be). He is out of it once he has pushed off (out
  // of body contact); until then the battle goes on and his tie holds him.
  const ga = state.plans[ia]!.jobTick > e.sinceTick, gb = state.plans[ib]!.jobTick > e.sinceTick;
  if ((ga || gb) && dd > touch * touch) {
    const quitter = ga ? a : b;
    loose(state, quitter.id, quitter === a ? b.id : a.id);
    return e.inside !== null && e.inside !== quitter.id ? 'heldPosition' : 'released';
  }
  e.kind = kindOf(state, a, b);
  if (state.tick < e.nextDrawTick) return null;
  e.nextDrawTick += DRAW_TICKS;
  const p = engageChance(da, a, db, b, e.inside === a.id ? 'a' : e.inside === b.id ? 'b' : null);
  const aWins = rng.next() < p;
  const w = aWins ? a : b, l = aWins ? b : a;
  if (e.lastWon === w.id) e.inside = w.id;
  e.lastWon = w.id;
  if (aWins) { e.tieB = Math.min(1, e.tieB + E.tieUp); e.tieA = Math.max(0, e.tieA - E.tieDown); }
  else { e.tieA = Math.min(1, e.tieA + E.tieUp); e.tieB = Math.max(0, e.tieB - E.tieDown); }
  // Getting loose: a free-enough man who wants to be elsewhere wins a draw.
  const wTie = aWins ? e.tieA : e.tieB;
  const tx = w.target.x - l.pos.x, ty = w.target.y - l.pos.y;
  if (wTie <= E.freeAt + 1e-9 && tx * tx + ty * ty > E.breakAway * E.breakAway) {
    loose(state, w.id, l.id);
    const pk = state.puck.pos;
    const nx = state.attackDir[w.side] * RINK.goalLineX;
    const nearerPuck = d2(w.pos.x, w.pos.y, pk.x, pk.y) < d2(l.pos.x, l.pos.y, pk.x, pk.y);
    const nearerNet = d2(w.pos.x, w.pos.y, nx, 0) < d2(l.pos.x, l.pos.y, nx, 0);
    if (nearerPuck || nearerNet) e.inside = w.id;
    return nearerPuck || nearerNet ? 'foughtThrough' : 'spunOff';
  }
  return null;
}

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

function engagementEvent(state: GameState, e: Engagement, a: SkaterState, b: SkaterState, result: EngagementResult): GameEvent {
  const inside = e.inside === a.id ? a : e.inside === b.id ? b : null;
  const other = inside === null ? null : inside === a ? b : a;
  return gameEvent(state, {
    type: 'engagement', side: (inside ?? a).side, playerId: inside?.id ?? null, otherId: other?.id ?? null,
    pos: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
    detail: { kind: e.kind, seconds: (state.tick - e.sinceTick) * DT, result, a: e.a, b: e.b },
  });
}

export type EngagementResult = 'heldPosition' | 'foughtThrough' | 'spunOff' | 'released' | 'contest' | 'whistle';

/**
 * The `engagement` events (result `whistle`) for engagements a whistle or the end of a period has just cleared (game.ts
 * step: `cut` is the list as it was before the step, `state.engagements` a new list). Only those that lasted 0.3 s or more.
 */
export function whistleEngagements(state: GameState, cut: readonly Engagement[], out: GameEvent[]): void {
  for (const e of cut) {
    if (state.tick - e.sinceTick < EVENT_TICKS) continue;
    const a = state.skaters[indexIn(state.skaters, e.a)]!, b = state.skaters[indexIn(state.skaters, e.b)]!;
    out.push(engagementEvent(state, e, a, b, 'whistle'));
  }
}
