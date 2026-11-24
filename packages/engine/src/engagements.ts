import { hasBadge } from './badges';
import { DT } from './constants';
import { effective as effective_, setCooldown as setCooldown_, onCooldown as onCooldown_, winProb as winProb_ } from './contests/core';
import { gameEvent } from './events';
import { RINK as RINK_ } from './rink';
import type { Rng } from './rng';
import { bodyRadius as bodyRadius_ } from './skating';
import { TUNING } from './tuning';
import type { Engagement, GameEvent, GameState, PlayerDef, SkaterState } from './types';

export { engagementOf, engageSpeedFactor, tieOf, tiedChance } from './engage-state';
// Local bindings of the imports used every tick (a call through an imported binding costs more under the test runner).
const effective = effective_;
const setCooldown = setCooldown_;
const onCooldown = onCooldown_;
const winProb = winProb_;
const RINK = RINK_;
const bodyRadius = bodyRadius_;


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

/** A Net-Front Presence's TUNING.badges.netFrontEngage within netFrontRange m of either net's centre (Task 12). */
function nearNetEdge(d: PlayerDef, s: SkaterState): number {
  if (!hasBadge(d, 'Net-Front Presence')) return 0;
  const B = TUNING.badges;
  const dx = Math.abs(s.pos.x) - RINK.goalLineX;
  return dx * dx + s.pos.y * s.pos.y <= B.netFrontRange * B.netFrontRange ? B.netFrontEngage : 0;
}

/**
 * Chance `a` wins a draw: winProb of the difference in (strength .35, balance .3, compete .35, with energy, form and morale
 * as in `effective`), plus mass difference / TUNING.engage.massPerPoint, plus TUNING.engage.insideEdge for the man inside.
 */
export function engageChance(a: PlayerDef, sa: SkaterState, b: PlayerDef, sb: SkaterState, inside: 'a' | 'b' | null): number {
  const edge = effective(a, sa, E.weights) + nearNetEdge(a, sa) - effective(b, sb, E.weights) - nearNetEdge(b, sb) + (mass(a) - mass(b)) / E.massPerPoint
    + (inside === 'a' ? E.insideEdge : inside === 'b' ? -E.insideEdge : 0);
  return winProb(edge);
}


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
  const sk = state.skaters, es = state.engagements, tick = state.tick, mark = ++stamp;
  const ix = indexes(sk, defs);
  let k = 0;
  for (let i = 0; i < es.length; i++) {
    const e = es[i]!;
    const ia = ix.index.get(e.a)!, ib = ix.index.get(e.b)!;
    const a = sk[ia]!, b = sk[ib]!;
    const end = stepEngagement(state, defs, rng, e, a, b, ia, ib, ix.radius[ia]!, ix.radius[ib]!);
    if (end === null) { es[k++] = e; engagedAt[ia] = mark; engagedAt[ib] = mark; continue; }
    if (out !== undefined && tick - e.sinceTick >= EVENT_TICKS) out.push(engagementEvent(state, e, a, b, end));
  }
  es.length = k;

  // New engagements: opposing pairs in body contact, home man against away man among the free on-ice men (a cheap broad
  // phase on squared distances).
  const home = state.onIce.home, away = state.onIce.away;
  for (let hi = 0; hi < home.length; hi++) {
    const ih = ix.index.get(home[hi]!);
    if (ih === undefined || engagedAt[ih] === mark) continue;
    const h = sk[ih]!;
    if (!free(h)) continue;
    for (let ai = 0; ai < away.length; ai++) {
      const ia = ix.index.get(away[ai]!);
      if (ia === undefined || engagedAt[ia] === mark) continue;
      const w = sk[ia]!;
      if (!free(w)) continue;
      const dx = w.pos.x - h.pos.x, dy = w.pos.y - h.pos.y, r = ix.radius[ih]! + ix.radius[ia]! + E.contact;
      if (dx * dx + dy * dy > r * r) continue;
      // Glancing past each other at speed is no battle for position.
      // (Across the line between them: one going by the other; into or apart along it is a man leaning in or pushing off.)
      const vx = w.vel.x - h.vel.x, vy = w.vel.y - h.vel.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const across = (vx * dy - vy * dx) / d;
      if (across > E.maxRelSpeed || across < -E.maxRelSpeed) continue;
      if (onCooldown(state, h.id, cooldownKind(w.id)) || onCooldown(state, w.id, cooldownKind(h.id))) continue;
      // `a` is the one first in state.skaters.
      const [a, b] = ih < ia ? [h, w] : [w, h];
      es.push({ a: a.id, b: b.id, sinceTick: tick, kind: kindOf(state, a, b), inside: null, tieA: E.startTie, tieB: E.startTie, lastWon: null, nextDrawTick: tick + DRAW_TICKS });
      engagedAt[ih] = mark;
      engagedAt[ia] = mark;
      break;
    }
  }
}

/**
 * Per skater index: the call (`stamp`, counted up on every call, so two games stepped in turn never share one) on which he
 * was last found in an engagement. Scratch, never reset.
 */
const engagedAt: number[] = [];
let stamp = 0;

/** Each skater list's index by id and body radius by index (derived: the list's order never changes in a game; a restored state has a new list). */
type Indexes = { index: Map<string, number>; radius: number[] };
const indexCache = new WeakMap<readonly SkaterState[], Indexes>();
function indexes(sk: readonly SkaterState[], defs: Map<string, PlayerDef>): Indexes {
  let m = indexCache.get(sk);
  if (m === undefined) {
    m = { index: new Map(), radius: [] };
    for (let i = 0; i < sk.length; i++) { m.index.set(sk[i]!.id, i); m.radius.push(bodyRadius(defs.get(sk[i]!.id)!.weightKg)); }
    indexCache.set(sk, m);
    engagedAt.length = Math.max(engagedAt.length, sk.length);
    for (let i = 0; i < engagedAt.length; i++) engagedAt[i] ??= -1;
  }
  return m;
}
function indexIn(sk: readonly SkaterState[], id: string): number {
  for (let i = 0; i < sk.length; i++) if (sk[i]!.id === id) return i;
  return -1;
}

type EndResult = Exclude<EngagementResult, 'whistle'>;

/** One tick of engagement `e` between `a` and `b` (skater indexes ia, ib): its end, or null while it goes on. */
function stepEngagement(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, e: Engagement, a: SkaterState, b: SkaterState, ia: number, ib: number, ra: number, rb: number,
): EndResult | null {
  if (a.contestId !== null || b.contestId !== null) return 'contest';
  if (!a.onIce || !b.onIce || a.leaving || b.leaving || a.downT > 0 || b.downT > 0) return 'released';
  const da = defs.get(a.id)!, db = defs.get(b.id)!;
  const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dd = dx * dx + dy * dy;
  const touch = ra + rb + E.contact, apart = touch + E.releaseGap;
  if (dd > apart * apart) return 'released';
  // Giving up: his job changed since it began (he has somewhere else to be). He is out of it once he has pushed off (out
  // of body contact); until then the battle goes on and his tie holds him.
  const ga = state.plans[ia]!.jobTick > e.sinceTick, gb = state.plans[ib]!.jobTick > e.sinceTick;
  if ((ga || gb) && dd > touch * touch) {
    const quitter = ga ? a : b;
    loose(state, quitter.id, quitter === a ? b.id : a.id);
    return e.inside !== null && e.inside !== quitter.id ? 'heldPosition' : 'released';
  }
  if (state.tick < e.nextDrawTick) return null;
  e.kind = kindOf(state, a, b);
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
