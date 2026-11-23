import { DT, RINK, type ContestStateOf, type GameEventOf } from '@hockey/engine';
import { motionOfSample, slotOf, toBodyFrame, type AnimContext, type BodyPass, type DrawnBody, type Overlay, type SkaterAnim, type SkaterSample } from '../anim-context';
import type { BodyDims } from '../body';
import { rawPose, styleShare } from '../gait';
import { addRawDelta, armReach, bladeAt, fitBody, lerp3, mixRaw, shoulderJoint, type RawPose, type Vec3 } from '../pose-mix';

/**
 * Contact (pure: no three.js, no DOM): poke checks, body checks, falls and getting up, and the body pass that keeps
 * drawn figures out of each other and inside the boards. Everything is read from the engine: each contest's kind,
 * stage, stage time and roles (`ctx.contests`), the `hit` event's result (from the timeline, which lets the impact
 * show the result the engine is about to roll; from the contest's `data.result` once it is rolled when there is no
 * timeline), each skater's `downT`, the velocities and the players' weights. Weight and closing speed only scale how
 * big a reaction looks (`sev`); they never change who won.
 *
 * - contactTrack (id `contact`) shows nothing (weight 0). It keeps one slot per skater (ContactSlot, plain data,
 *   changed in place) that the other overlays read: the poke check he is in (role, stage starts, the point the
 *   checker reaches for), the hit he is in (role, impact start I, the hit's tick T, result, contact direction, `sev`),
 *   and his fall (the hit that put him down, the tick downT reaches 0, which way he goes down). On a fresh start the
 *   slot is rebuilt from the contests under way, `downT` and the timeline, so a seek's pre-roll gives the pose play
 *   gives (a fall plus its getting up can outlast the pre-roll).
 * - pokeOverlay: the checker reaches one-handed with his blade on the carrier's puck through `reach` (starting
 *   POKE_LEAD ticks ahead of it when the timeline shows it coming); on a win his blade stays on the puck as it comes off
 *   the carrier's; `beaten`: caught reaching, off balance, as the carrier goes by. The carrier turns his near shoulder
 *   in and pulls the puck to his far side. The blade follows the puck at a limited speed, swings round in front of
 *   him, stays within 90% of his reach, and does not reach for a puck right under him or directly behind his top hand.
 * - hitOverlay: the hitter lowers and turns his lead shoulder in as he closes, and drives it through `impact`; the
 *   target braces when he can see it coming. `landed`: the target's upper body is thrown away from the hitter (then
 *   the fall). `absorbed`: a jolt, both stay up. `bounced`: the hitter is thrown back (then his fall).
 * - knockOverlay: the drawn offset a hit asks for (the target knocked off his line; a bounced hitter thrown back),
 *   held while he is down and eased back as he gets up.
 * - fallOverlay: a man a hit puts down goes down the way the hit sends him (onto his back, onto his side, or forward
 *   to his hands and knees), lies there and gets up through one knee timed to `downT` reaching 0, then hands over to
 *   his skating. It replaces the gait's plain `down` pose for these falls only (it takes the gait's down share out
 *   and puts its own pose in), so any other fall keeps the plain pose.
 * - contactBodyPass: pairs of drawn figures (skaters and goalies) closer than their two body radii are pushed apart
 *   along the line between them, the lighter more, a carrier or a goalie only when the other cannot take it all,
 *   each at most MAX_OFFSET from his engine place (overlays' offsets included); figures are kept inside the boards.
 *   Its push follows a growing overlap at once and eases away over PUSH_OUT. Allocation-free per frame.
 */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const TICK = (s: number): number => s / DT;

/** The most a body is drawn from its engine place for contact (m). */
export const MAX_OFFSET = 0.35;

// ---------------------------------------------------------------------------------------------------------------
// Weights and sizes

/**
 * His weight (kg) from his body dims (body.ts bodyDims is a closed form of height and weight; this is its inverse,
 * so the animator needs nothing more than the dims it already has).
 */
export function weightOfDims(d: BodyDims): number {
  const h = d.thigh / 0.245;
  const girth = (d.hipWidth / (0.1 * h) - 0.9) / 0.1;
  return Math.max(40, (girth * girth * h * 90) / 1.85);
}
/** The engine's body radius (skating.ts bodyRadius) and mass (movementOf: weight plus gear). */
export const radiusOfWeight = (kg: number): number => 0.38 + (kg - 85) * 0.002;
const massOfWeight = (kg: number): number => kg + 9;

// ---------------------------------------------------------------------------------------------------------------
// The tracker

type PokeRole = 'checker' | 'carrier';
export type PokeTrack = {
  cid: number; role: PokeRole | null; other: string;
  stage: 'reach' | 'resolve' | 'beaten'; outcome: string;
  /** Ticks (state ticks) each stage began; -1 not seen. `end`: the tick it was last seen in the state (-1: under way). */
  reachAt: number; resolveAt: number; beatenAt: number; end: number;
  /**
   * Where the checker's blade goes, in his body frame (left-shot frame): the drawn puck while he reaches for it (and
   * while he knocks it off on a win), then held where it was relative to him as the stick comes back.
   */
  bx: number; bz: number;
  /** The carrier left it (dropped at `beaten`) at this tick (-1: still in it). */
  left: number;
  /** Ticks the stick goes out ahead of the reach stage: POKE_LEAD when the timeline shows it coming, else 0. */
  lead: number;
  /**
   * How far over to the puck his stick may go (0..1), from where the puck is round him (reachGeom), eased at a rate
   * that is slower the further round the stick has to swing.
   */
  reachK: number;
  /** The blade target last drawn (body frame) and when (game seconds; -1 none): the blade moves at most BLADE_SPEED. */
  tx: number; tz: number; tt: number;
};
type HitResult = 'pending' | 'landed' | 'absorbed' | 'bounced' | 'missed';
export type HitTrack = {
  cid: number; role: 'hitter' | 'target' | null; other: string;
  /** Impact start and the hit's tick (state ticks; -1 not yet), the contest last seen (-1: under way). */
  I: number; T: number; end: number;
  result: HitResult;
  /** World direction (unit, engine x, y) from the hitter to the target at contact. */
  ux: number; uy: number;
  /** How hard it looks (0..1), from the engine's own push (closing speed times the hitter's mass share). */
  sev: number;
  /** For the hitter's recoil: the target's mass share of that closing speed. */
  sevBack: number;
  /**
   * How far the hitter has lowered into it, or the target braced for it (0..1), as he closes (held from contact on),
   * and the tick the result became known (the impact's start with the timeline, the hit's tick without one).
   */
  close: number; known: number;
};
export type FallTrack = {
  /** The tick of the hit that put him down (-1: not falling), and the tick downT reaches 0. */
  T: number; endT: number;
  /** The way he goes down, in his body frame (left-shot frame), unit. */
  dx: number; dz: number;
  sev: number;
  /** The world direction he is knocked (unit), for the drawn offset. */
  wx: number; wy: number;
};
/** `pokePrev`: the poke check before the current one, while it may still be fading (a checker poked straight back). */
export type ContactSlot = { poke: PokeTrack; pokePrev: PokeTrack; hit: HitTrack; fall: FallTrack };

export const CONTACT_ID = 'contact';
export const contactSlotOf = (anim: SkaterAnim): ContactSlot | undefined => slotOf<ContactSlot>(anim, CONTACT_ID);

const newPoke = (): PokeTrack => ({ cid: -1, role: null, other: '', stage: 'reach', outcome: 'undecided', reachAt: -1, resolveAt: -1, beatenAt: -1, end: -1, bx: 1, bz: 0, left: -1, lead: 0, reachK: 0, tx: 0, tz: 0, tt: -1 });
const newHit = (): HitTrack => ({ cid: -1, role: null, other: '', I: -1, T: -1, end: -1, result: 'pending', ux: 1, uy: 0, sev: 0.5, sevBack: 0.5, close: 0, known: -1 });
const newFall = (): FallTrack => ({ T: -1, endT: -1, dx: -1, dz: 0, sev: 0.5, wx: 1, wy: 0 });

/** The tick (state ticks) a contest's current stage began. */
const stageStart = (ctx: AnimContext, stageT: number): number => ctx.state.tick - Math.round(stageT / DT);

/** How long after the end a contest's trace is kept (ticks): every overlay has faded by then. */
const KEEP_TICKS = TICK(1.2);
/** The gait blends out of its down pose over GAIT.blendDown (0.65 s): a fall is kept a little longer than that. */
const GAIT_DOWN_BLEND = 0.7;
/** The engine's impact lasts this many ticks (contests/hit.ts IMPACT_SECONDS 0.15, stepped per tick). */
const IMPACT_TICKS = 5;

/** The hit's severity (0..1) from the engine's push: closing speed (m/s) times a mass share. */
const sevOf = (closing: number, share: number): number => clamp((Math.max(0, closing) * share - 0.4) / 3.2, 0.15, 1);

/** Start tracking poke check `cid` (keeping the one before while it fades). */
function startPoke(p: PokeTrack, prev: PokeTrack, ctx: AnimContext, cid: number, checker: string, carrier: string, me: string): void {
  if (p.cid >= 0) { Object.assign(prev, p); if (prev.end < 0) prev.end = ctx.state.tick - 1; }
  Object.assign(p, newPoke(), { cid, role: checker === me ? 'checker' : 'carrier', other: checker === me ? carrier : checker, lead: ctx.timeline.contest(cid) ? POKE_LEAD : 0 });
}

/** Move the checker's blade target toward the drawn puck (body frame), at most AIM_SPEED (m/s) when not starting afresh. */
function aimAt(p: PokeTrack, s: SkaterSample, ctx: AnimContext, dt: number, fresh: boolean): void {
  const t = toBodyFrame(s, { x: ctx.puck.drawn.x, y: ctx.puck.drawn.z });
  const dx = t.x - p.bx, dz = t.z - p.bz, l = Math.hypot(dx, dz), max = AIM_SPEED * dt;
  if (fresh || l <= max) { p.bx = t.x; p.bz = t.z; } else { p.bx += (dx / l) * max; p.bz += (dz / l) * max; }
}
/** Ease the stick's reach toward what the puck's place round him allows. */
function easeReach(p: PokeTrack, dt: number): void {
  const g = reachGeom(p.bx, p.bz, geom);
  const rate = 1 / (0.14 + 0.08 * Math.abs(g.hd - SKATE_HEADING));
  p.reachK += clamp(g.factor - p.reachK, -rate * dt, rate * dt);
}
/** The skating blade's usual heading (left-shot body frame), from which the poke's swing is reckoned. */
const SKATE_HEADING = -0.5;
type ReachGeom = { hd: number; rd: number; h0: number; factor: number };
const geom: ReachGeom = { hd: 0, rd: 0, h0: 0, factor: 0 };
/**
 * Where the checker reaches for a puck at (bx, bz) in his body frame: the heading (within those a one-handed poke can
 * take, from well round on his blade side to a little across his body) and distance (within his stick's length), and
 * how far he reaches at all: not for a puck right under him (nearer than a blade on the ice comes; across his body,
 * on his top hand's side, nearer than about a metre would stand the stick on end), nor round the cut directly behind
 * his right, where the reach fades to nothing either side so the stick never swings through it.
 */
function reachGeom(bx: number, bz: number, o: ReachGeom): ReachGeom {
  let h0 = Math.atan2(bz, bx);
  if (h0 > REACH_CUT) h0 -= 2 * Math.PI;
  o.h0 = h0;
  o.hd = clamp(h0, REACH_LEFT, REACH_RIGHT);
  o.rd = clamp(Math.hypot(bx, bz), 0, REACH_MAX);
  const near = REACH_NEAR + 0.65 * smooth((o.hd - 0.3) / 0.8);
  o.factor = smooth((o.rd - near) / 0.25) * smooth((REACH_CUT - h0) / 0.6) * smooth((h0 - (REACH_CUT - 2 * Math.PI)) / 0.6);
  return o;
}

function trackPoke(p: PokeTrack, prev: PokeTrack, s: SkaterSample, ctx: AnimContext, dt: number): void {
  // His poke check under way (the one being tracked, if it is; else the newest).
  let c: ContestStateOf<'pokeCheck'> | null = null;
  for (const k of ctx.contests) {
    if (k.kind !== 'pokeCheck' || (k.roles.checker !== s.id && k.roles.carrier !== s.id) || k.id === prev.cid) continue;
    if (!c || k.id === p.cid) c = k;
  }
  // The timeline shows a poke check of his about to start (even while he is still in another): the stick starts out
  // a little ahead of it, and the one he is in gives way to it.
  const end = ctx.state.tick + POKE_LEAD + 1;
  let e = ctx.timeline.next('contestStart', ctx.state.tick - 1, POKE_LEAD + 2, s.id, 'either');
  for (let i = 0; i < 4 && e && e.detail.kind !== 'pokeCheck'; i++) e = ctx.timeline.next('contestStart', e.tick, end - e.tick, s.id, 'either');
  if (e && e.detail.kind === 'pokeCheck' && e.tick > ctx.state.tick && (!c || c.id !== e.detail.contestId)) {
    const fresh = p.cid !== e.detail.contestId;
    if (fresh) startPoke(p, prev, ctx, e.detail.contestId, e.detail.participants[0]!, e.detail.participants[1]!, s.id);
    p.reachAt = e.tick; p.stage = 'reach';
    aimAt(p, s, ctx, dt, fresh);
    easeReach(p, dt);
    return;
  }
  if (c) {
    const fresh = p.cid !== c.id;
    if (fresh) startPoke(p, prev, ctx, c.id, c.roles.checker, c.roles.carrier, s.id);
    const at = stageStart(ctx, c.stageT);
    p.stage = c.stage; p.outcome = c.data.outcome; p.end = -1;
    if (c.stage === 'reach') p.reachAt = at;
    else if (c.stage === 'resolve') { p.resolveAt = at; if (p.reachAt < 0) p.reachAt = at - Math.round(TICK(0.25)); }
    else {
      p.beatenAt = at;
      if (p.resolveAt < 0) p.resolveAt = at - Math.round(TICK(0.1));
      if (p.reachAt < 0) p.reachAt = p.resolveAt - Math.round(TICK(0.25));
    }
    const live = c.stage === 'reach' || (c.stage === 'resolve' && (p.outcome === 'take' || p.outcome === 'loose'));
    if (live || fresh) aimAt(p, s, ctx, dt, fresh);
    easeReach(p, dt);
    if (p.role === 'carrier' && !c.participants.includes(s.id) && p.left < 0) p.left = ctx.state.tick - 1;
    return;
  }
  if (p.cid >= 0 && p.end < 0) p.end = ctx.state.tick - 1;
  if (p.cid >= 0 && ctx.tick - p.end > KEEP_TICKS) Object.assign(p, newPoke());
  if (prev.cid >= 0 && ctx.tick - prev.end > KEEP_TICKS) Object.assign(prev, newPoke());
}

/** A world vector (engine x, y) in his body frame (left-shot frame: mirrored for a right shot), from his facing now. */
function vecToBody(s: SkaterSample, vx: number, vy: number, out: { x: number; z: number }): { x: number; z: number } {
  const c = Math.cos(s.facing), n = Math.sin(s.facing);
  out.x = vx * c + vy * n;
  out.z = (s.right ? -1 : 1) * (-vx * n + vy * c);
  return out;
}

function trackHit(h: HitTrack, s: SkaterSample, ctx: AnimContext, dt: number): void {
  let c: ContestStateOf<'hit'> | null = null;
  for (const k of ctx.contests) if (k.kind === 'hit' && (k.roles.hitter === s.id || k.roles.target === s.id)) { c = k; break; }
  if (c) {
    if (h.cid !== c.id) Object.assign(h, newHit(), { cid: c.id, role: c.roles.hitter === s.id ? 'hitter' : 'target', other: c.roles.hitter === s.id ? c.roles.target : c.roles.hitter });
    h.end = -1;
    const at = stageStart(ctx, c.stageT);
    if (c.stage === 'impact' && h.I < 0) h.I = at;
    if (c.stage === 'recover') {
      h.T = at; h.result = c.data.result;
      if (h.I < 0 && h.result !== 'missed') h.I = at - IMPACT_TICKS;
      if (h.known < 0) h.known = at;
    }
    // Until contact: the line between them now. From contact on it is held.
    const hitter = ctx.skaters.get(c.roles.hitter), target = ctx.skaters.get(c.roles.target);
    if (hitter && target && (h.I < 0 || h.I >= ctx.state.tick - 1)) {
      const dx = target.pos.x - hitter.pos.x, dy = target.pos.y - hitter.pos.y, l = Math.hypot(dx, dy);
      if (l > 1e-6) { h.ux = dx / l; h.uy = dy / l; }
      const closing = (hitter.vel.x - target.vel.x) * h.ux + (hitter.vel.y - target.vel.y) * h.uy;
      const mh = massOfWeight(weightOfDims(hitter.dims)), mt = massOfWeight(weightOfDims(target.dims));
      h.sev = sevOf(closing, mh / (mh + mt));
      h.sevBack = sevOf(closing, mt / (mh + mt));
    }
    // As he closes: the hitter lowers into it, the target braces when he can see it coming.
    if (h.I < 0 && hitter && target) {
      const me = h.role === 'hitter' ? hitter : target, other = h.role === 'hitter' ? target : hitter;
      const d = Math.hypot(other.pos.x - me.pos.x, other.pos.y - me.pos.y);
      let want: number;
      if (h.role === 'hitter') want = smooth((HIT_FROM - d) / (HIT_FROM - HIT_FULL));
      else {
        const hb = toBodyFrame(me, other.pos), l = Math.hypot(hb.x, hb.z) || 1;
        want = smooth((BRACE_FROM - d) / (BRACE_FROM - BRACE_FULL)) * smooth((hb.x / l - BRACE_SEE) / 0.4);
      }
      // Eased: a hit that starts with them already close still takes a moment to set.
      h.close += clamp(want - h.close, -dt / CLOSE_EASE, dt / CLOSE_EASE);
    }
  } else {
    if (h.cid >= 0 && h.end < 0) h.end = ctx.state.tick - 1;
    if (h.cid >= 0 && ctx.tick - h.end > KEEP_TICKS) Object.assign(h, newHit());
  }
  // The timeline knows the result as the impact begins (the engine rolls it at its end).
  if (h.cid >= 0 && h.result === 'pending' && h.I >= 0) {
    const e = ctx.timeline.next('hit', h.I, IMPACT_TICKS + 2, h.role === 'hitter' ? s.id : h.other);
    if (e && e.detail.contestId === h.cid) { h.result = e.detail.result; h.T = e.tick; h.known = h.I; }
  }
}

/** The hit event that put him down (him the landed-on target, or the bounced hitter), within `within` ticks. */
function hitThatDowned(s: SkaterSample, ctx: AnimContext, within: number): GameEventOf<'hit'> | undefined {
  const e = ctx.timeline.last('hit', ctx.state.tick, within, s.id, 'either');
  if (!e) return undefined;
  if (e.otherId === s.id && e.detail.result === 'landed') return e;
  if (e.playerId === s.id && e.detail.result === 'bounced') return e;
  return undefined;
}

function trackFall(f: FallTrack, h: HitTrack, s: SkaterSample, ctx: AnimContext, fresh: boolean): void {
  const down = s.state.downT;
  if (down > 0) {
    const endT = ctx.state.tick + Math.ceil(down / DT - 1e-6);
    if (f.T >= 0 && endT <= f.endT + 1) { f.endT = endT; return; }
    // A new fall: from the hit he is in, else the timeline's hit event.
    let T = -1, wx = 0, wy = 0, sev = 0.5;
    const mine = h.cid >= 0 && ((h.role === 'target' && h.result === 'landed') || (h.role === 'hitter' && h.result === 'bounced'));
    if (mine) {
      T = h.T >= 0 ? h.T : ctx.state.tick;
      const k = h.role === 'target' ? 1 : -1;
      wx = k * h.ux; wy = k * h.uy; sev = h.role === 'target' ? h.sev : h.sevBack;
    } else {
      const e = hitThatDowned(s, ctx, Math.round(TICK(1.6)));
      if (!e) { f.T = -1; return; } // not a contact fall: the gait's plain down pose
      T = e.tick;
      // The way he was knocked: from the contact point to where he is now (he slides on along it), else from the
      // other man to him.
      const other = ctx.skaters.get((e.playerId === s.id ? e.otherId : e.playerId) ?? '');
      let dx = s.pos.x - e.pos.x, dy = s.pos.y - e.pos.y;
      if (Math.hypot(dx, dy) < 0.2 && other) { dx = s.pos.x - other.pos.x; dy = s.pos.y - other.pos.y; }
      const l = Math.hypot(dx, dy) || 1;
      wx = dx / l; wy = dy / l;
      if (other) {
        const me = massOfWeight(weightOfDims(s.dims)), them = massOfWeight(weightOfDims(other.dims));
        sev = sevOf(4, them / (me + them));
      }
    }
    if (!fresh && f.T >= 0 && T <= f.T) T = f.T;
    const b = vecToBody(s, wx, wy, { x: 0, z: 0 });
    const l = Math.hypot(b.x, b.z) || 1;
    Object.assign(f, { T, endT, dx: b.x / l, dz: b.z / l, sev, wx, wy });
    return;
  }
  if (f.T < 0) return;
  // Up again: kept until the gait has blended out of its down pose (fallOverlay takes that out until then).
  if (ctx.tick > f.endT + 2 + TICK(GAIT_DOWN_BLEND)) Object.assign(f, newFall());
}


export const contactTrack: Overlay<ContactSlot> = {
  id: CONTACT_ID,
  step(slot, sample, ctx, dt) {
    const fresh = slot === undefined;
    const sl = slot ?? { poke: newPoke(), pokePrev: newPoke(), hit: newHit(), fall: newFall() };
    if (!sample.onIce) return sl;
    trackPoke(sl.poke, sl.pokePrev, sample, ctx, dt);
    trackHit(sl.hit, sample, ctx, dt);
    // A fresh start mid-fall rebuilds it from downT and the timeline (or the hit still under way).
    trackFall(sl.fall, sl.hit, sample, ctx, fresh);
    return sl;
  },
  weight: () => 0,
  apply: (raw) => raw,
};

// ---------------------------------------------------------------------------------------------------------------
// Poke checks

/** The checker's stick goes out over this long (s), from a tick before the reach stage shows. */
const POKE_OUT = 0.32;
/** Ticks ahead of the reach stage the stick starts out when the timeline shows the poke coming. */
const POKE_LEAD = 6;
/** The checker's blade follows the puck at no more than this (m/s): the engine hands a puck over metres in a tick. */
const AIM_SPEED = 18;
/** The checker's blade target moves at most this fast (m/s) in his body frame. */
const BLADE_SPEED = 12;
/** After the poke ends his stick comes back over this long (s); a beaten checker recovers over BEATEN_BACK. */
const POKE_BACK = 0.45, BEATEN_HOLD = 8, BEATEN_BACK = 12;
/** The poke overlay's weight is full from this amount on (its poses carry the amount themselves). */
const POKE_FULL = 0.35;

/** Where the checker wants his top hand (from the pelvis) as he reaches one-handed, and his free arm for balance. */
const REACH_TOP = v3(0.42, 0.2, 0.14), REACH_FREE = v3(-0.25, -0.32, -0.32);
/** The headings (left-shot body frame) and distances (m) the checker reaches for the puck within. */
const REACH_LEFT = -3.0, REACH_RIGHT = 1.6, REACH_CUT = 2.5, REACH_MAX = 2.4, REACH_NEAR = 0.35;


/** The checker's reach amount, and how far he is caught off balance (0..1), at display time `now` (ticks). */
function checkerAmounts(p: PokeTrack, now: number): { reach: number; off: number } {
  let reach = smooth((now - (p.reachAt - 1 - p.lead)) / TICK(POKE_OUT));
  let off = 0;
  if (p.beatenAt >= 0) {
    off = smooth((now - p.beatenAt + 1) / 4) * (1 - smooth((now - p.beatenAt - BEATEN_HOLD) / BEATEN_BACK));
    reach *= 1 - smooth((now - p.beatenAt - BEATEN_HOLD) / BEATEN_BACK);
  }
  if (p.end >= 0) {
    const k = 1 - smooth((now - p.end) / TICK(POKE_BACK));
    reach *= k; off *= k;
  }
  return { reach, off };
}
/** The carrier's shield amount (0..1). */
function carrierAmount(p: PokeTrack, now: number): number {
  let a = smooth((now - (p.reachAt - 1 - p.lead)) / TICK(POKE_OUT));
  const stop = p.left >= 0 ? p.left : p.end;
  if (stop >= 0) a *= 1 - smooth((now - stop) / TICK(0.25));
  return a;
}

/** The poke check's weight on him now (0..1). */
/** One poke check's amount on him now (0..1). */
function pokeAmount(p: PokeTrack, now: number): number {
  if (p.cid < 0 || p.reachAt < 0) return 0;
  if (p.role === 'checker') { const a = checkerAmounts(p, now); return Math.max(a.reach, a.off); }
  return carrierAmount(p, now);
}

/** The poke checks' weight on him now (0..1): the current one's, or the one before while it fades out. */
function pokeWeight(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext): number {
  if (!sample.onIce) return 0;
  const sl = contactSlotOf(anim);
  if (!sl) return 0;
  const now = ctx.tick + ctx.alpha;
  // Full as soon as a third of the way in: each pose moves from the skating one by its own amount (so the blade target
  // is never far from the skating blade while the mix is partial).
  const w = smooth(Math.max(pokeAmount(sl.poke, now), pokeAmount(sl.pokePrev, now)) / POKE_FULL) * (1 - styleShare(anim.gait, 'down'));
  return w > 1e-4 ? w : 0;
}

function pokeApply(raw: RawPose, anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose {
  const sl = contactSlotOf(anim);
  if (!sl) return raw;
  const now = ctx.tick + ctx.alpha;
  const a = pokeAmount(sl.poke, now), b = pokeAmount(sl.pokePrev, now);
  if (!(b > 0)) return pokePose(raw, sl.poke, sample, ctx, dims, now);
  if (!(a > 0)) return pokePose(raw, sl.pokePrev, sample, ctx, dims, now);
  // A new one while the one before still shows: from that one's pose into this one's.
  return mixRaw(pokePose(raw, sl.pokePrev, sample, ctx, dims, now), pokePose(raw, sl.poke, sample, ctx, dims, now), a / Math.max(a, b));
}

function pokePose(raw: RawPose, p: PokeTrack, sample: SkaterSample, ctx: AnimContext, dims: BodyDims, now: number): RawPose {
  if (p.role === 'carrier') {
    // Near shoulder in, the puck pulled to the far side of him.
    const k = carrierAmount(p, now);
    const other = ctx.skaters.get(p.other);
    const ob = other ? toBodyFrame(sample, other.pos) : v3(1, 0, 0);
    const side = clamp(ob.z / 0.5, -1, 1) * k;
    return {
      ...raw, twist: raw.twist - side * 0.32, roll: raw.roll + side * 0.1, hipY: raw.hipY - 0.04 * k * dims.hipHeight, pitch: raw.pitch + 0.06 * k,
      blade: v3(raw.blade.x - 0.05 * k, raw.blade.y, raw.blade.z - side * 0.3), look: raw.look + side * 0.4,
      // (A blade an action has put at a point moves with it.)
      bladeAt: raw.bladeAt ? v3(raw.bladeAt.x - 0.05 * k, raw.bladeAt.y, raw.bladeAt.z - side * 0.3) : undefined,
    };
  }
  const { reach, off } = checkerAmounts(p, now);
  const k = Math.max(reach, off);
  // Where he reaches: the puck (body frame, followed at a limited speed), within the headings a one-handed poke can
  // take (from well round on his blade side to a little across his body) and his stick's length. The blade goes
  // there from where his skating has it, straight across, by how far the reach is out; a puck right under him (nearer
  // than a blade on the ice can come) is not reached for.
  const plain = fitBody(raw, dims).blade;
  const g = reachGeom(p.bx, p.bz, geom), hd = g.hd, rd = g.rd;
  const kr = k * p.reachK;
  const a1 = hd;
  // Round about his centre (so the blade never passes over his top hand, where the stick's heading is unsteady), or
  // straight across while the skating blade is itself near his centre.
  const pr = Math.hypot(plain.x, plain.z);
  let ph = Math.atan2(plain.z, plain.x);
  if (ph > REACH_CUT) ph -= 2 * Math.PI;
  const ah = lerp(ph, hd, kr), ar = lerp(pr, rd, kr), round = smooth((pr - 0.4) / 0.3);
  const target = v3(
    lerp(lerp(plain.x, rd * Math.cos(hd), kr), ar * Math.cos(ah), round), plain.y * (1 - kr),
    lerp(lerp(plain.z, rd * Math.sin(hd), kr), ar * Math.sin(ah), round));
  // The blade moves no faster than BLADE_SPEED from where it was last drawn (the puck it goes to can be handed over a
  // metre or two in a tick, and pass right under him).
  const dtT = ctx.time - p.tt;
  if (p.tt >= 0 && dtT >= 0 && dtT < 0.1) {
    const dx = target.x - p.tx, dz = target.z - p.tz, l = Math.hypot(dx, dz), max = BLADE_SPEED * dtT;
    if (l > max) { target.x = p.tx + (dx / l) * max; target.z = p.tz + (dz / l) * max; }
  }
  p.tx = target.x; p.tz = target.z; p.tt = ctx.time;
  const lunge = clamp01((rd - 0.8) / 1.2) * kr;
  const offB = off * Math.sign(a1 || 1);
  // Shoulders and the top hand turned toward the reach, the free arm out behind for balance; caught reaching, off
  // balance toward the reach.
  const turn = clamp(a1, -1.4, 1.3) * kr;
  const out: RawPose = {
    ...raw,
    hipY: raw.hipY - (0.06 * k + 0.12 * lunge + 0.08 * off) * dims.hipHeight,
    pitch: raw.pitch + 0.18 * k + 0.3 * lunge * Math.max(0, Math.cos(a1)) + 0.3 * off,
    roll: raw.roll + 0.22 * offB + 0.3 * lunge * Math.sin(a1),
    twist: lerp(raw.twist, 0.9 * turn - 0.2, k),
    look: lerp(raw.look, clamp(a1, -1, 1) * 0.6, kr), lookDown: lerp(raw.lookDown ?? 0, 0.35, k),
    top: lerp3(raw.top, v3(REACH_TOP.x * Math.cos(0.8 * turn), REACH_TOP.y, REACH_TOP.z + REACH_TOP.x * Math.sin(0.8 * turn)), kr),
    freeRel: lerp3(raw.freeRel, v3(REACH_FREE.x - 0.1 * off, REACH_FREE.y + 0.25 * off, REACH_FREE.z - 0.15 * off), k),
    twoHands: raw.twoHands * (1 - kr),
  };
  // The stick goes out as far as he reaches for the puck (kr); the body leans into it as far as the poke is on (k).
  // Within 90% of what his arm and the shaft below his top hand reach from his shoulder (at full stretch the hand's
  // solution turns steeply, and a blade at the edge of his reach would whip the hand).
  const sh = shoulderJoint(out, 1, dims), maxR = 0.9 * (armReach(dims) * 0.98 + 0.86 * dims.stick);
  const vx = target.x - sh.x, vy = target.y - sh.y, vz = target.z - sh.z, vl = Math.hypot(vx, vy, vz);
  if (vl > maxR) {
    // Keep the height (the blade stays on the ice): pull it in across the ice to that distance.
    const hz = Math.sqrt(Math.max(0, maxR * maxR - vy * vy)), hl = Math.hypot(vx, vz) || 1;
    target.x = sh.x + (vx / hl) * hz; target.z = sh.z + (vz / hl) * hz;
  }
  return bladeAt(out, target, dims);
}

/** The poke overlay as registered: weight and pose from the tracker's poke. */
export const pokeOverlay: Overlay = { id: 'poke', weight: pokeWeight, apply: pokeApply };

// ---------------------------------------------------------------------------------------------------------------
// Hits

/** The hitter starts lowering into the check this far from the target (m), fully in at HIT_FULL. */
const HIT_FROM = 2.6, HIT_FULL = 1.1;
/** Seconds (at the least) for the hitter to lower into it or the target to brace. */
const CLOSE_EASE = 0.2;
/** The target braces from this far (m) when he can see it coming (the hitter no further behind square than BRACE_SEE). */
const BRACE_FROM = 2.0, BRACE_FULL = 1.0, BRACE_SEE = -0.3;
/** Ticks the hit poses take to fade after the hit: a jolt, the hitter's follow-through, a landed target into his fall. */
/** Ticks over which a hit's result comes through. */
const SPAN = 6;
const JOLT_FADE = 10, DRIVE_HOLD = 3, DRIVE_FADE = 10, LANDED_HOLD = 6, LANDED_FADE = 8;

type HitAmounts = { close: number; drive: number; knock: number; recoil: number };
const hitAmt: HitAmounts = { close: 0, drive: 0, knock: 0, recoil: 0 };

/** How far into each part of the hit he is at display time `now` (ticks), into `o`. */
function hitAmounts(h: HitTrack, now: number, o: HitAmounts): HitAmounts {
  o.close = 0; o.drive = 0; o.knock = 0; o.recoil = 0;
  if (h.cid < 0 || h.role === null) return o;
  const fade = h.end >= 0 ? 1 - smooth((now - h.end) / 6) : 1;
  if (h.I < 0 || h.result === 'missed') { o.close = h.close * fade; return o; }
  const T = h.T >= 0 ? h.T : h.I + IMPACT_TICKS;
  // The result shows from the impact's start when the timeline knows it, else from the hit's tick, over SPAN ticks.
  const from = Math.max(h.I, h.known >= 0 ? h.known : T) - 1;
  const span = h.result === 'pending' ? 0 : smooth((now - from) / SPAN);
  if (h.role === 'hitter') {
    o.close = h.close * (1 - smooth((now - T) / DRIVE_FADE));
    const into = smooth((now - (h.I - 1)) / 4);
    o.drive = h.result === 'bounced' ? into * (1 - span) : into * (1 - smooth((now - T - DRIVE_HOLD) / DRIVE_FADE));
    if (h.result === 'bounced') o.recoil = span * (1 - smooth((now - T - 4) / 10));
  } else {
    o.close = h.close * (1 - smooth((now - (h.I - 1)) / 6));
    if (h.result === 'landed') o.knock = span * (1 - smooth((now - T - LANDED_HOLD) / LANDED_FADE));
    else if (h.result === 'absorbed') o.knock = 0.5 * span * (1 - smooth((now - T) / JOLT_FADE));
    else if (h.result === 'bounced') o.knock = -0.15 * span * (1 - smooth((now - T) / JOLT_FADE));
  }
  o.close *= fade; o.drive *= fade; o.knock *= fade; o.recoil *= fade;
  return o;
}

const hb2 = { x: 0, z: 0 };
function hitApply(raw: RawPose, anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose {
  const sl = contactSlotOf(anim);
  if (!sl) return raw;
  const h = sl.hit, now = ctx.tick + ctx.alpha;
  const a = hitAmounts(h, now, hitAmt);
  const other = ctx.skaters.get(h.other);
  // The other man in his body frame: live while closing, along the contact line from contact on.
  let ox: number, oz: number;
  if (h.I < 0 && other) { const p = toBodyFrame(sample, other.pos); const l = Math.hypot(p.x, p.z) || 1; ox = p.x / l; oz = p.z / l; }
  else { const k = h.role === 'hitter' ? 1 : -1; vecToBody(sample, k * h.ux, k * h.uy, hb2); ox = hb2.x; oz = hb2.z; }
  const ahead = smooth((ox + 0.6) / 0.6); // turning toward him only while he is not behind
  const toward = Math.atan2(oz, ox) * ahead;
  const lead = clamp(oz / 0.35, -1, 1); // the shoulder nearer him
  const sz = dims.hipHeight;
  if (h.role === 'hitter') {
    const sev = 0.6 + 0.4 * h.sev, c = a.close, d = a.drive, r = a.recoil * (0.5 + 0.5 * h.sevBack), fh = Math.max(0.6 * c, d);
    return {
      ...raw,
      hipY: raw.hipY - (0.07 * c + 0.06 * d) * sz,
      pitch: raw.pitch + (0.18 * c + 0.4 * d) * sev * ahead - 0.55 * r,
      roll: raw.roll + lead * (0.08 * c + 0.3 * d) * sev,
      twist: raw.twist + clamp(toward, -0.8, 0.8) * 0.4 * c - lead * (0.4 * c + 0.5 * d) * ahead,
      look: raw.look + clamp(toward, -1, 1) * 0.5 * c,
      lookDown: (raw.lookDown ?? 0) - 0.1 * c - 0.3 * r,
      twoHands: Math.min(raw.twoHands, 1 - 0.6 * d - r),
      // Elbows in: the top hand tucked to the hip, the free one up across the chest for the drive (thrown up on a recoil).
      top: v3(lerp(raw.top.x, 0.12, 0.5 * c), lerp(raw.top.y, -0.02, 0.5 * c), lerp(raw.top.z, 0.2, 0.5 * c)),
      freeRel: v3(lerp(raw.freeRel.x, 0.3, fh) - 0.25 * r, lerp(raw.freeRel.y, 0.05, fh) + 0.35 * r, lerp(raw.freeRel.z, 0.15, fh) - 0.25 * r),
    };
  }
  // Target: braced toward him, or thrown away from him.
  const b = a.close, kn = a.knock;
  const away = (0.4 + 0.5 * h.sev) * kn; // radians of lean away from the hitter
  return {
    ...raw,
    hipY: raw.hipY - 0.05 * b * sz - 0.05 * Math.abs(kn) * sz,
    pitch: raw.pitch + 0.14 * b * ox - away * ox,
    roll: raw.roll + 0.14 * b * oz - away * oz,
    twist: raw.twist - lead * 0.22 * b + clamp(-toward, -0.6, 0.6) * 0.3 * Math.abs(kn),
    look: raw.look + clamp(toward, -1, 1) * 0.4 * b - 0.6 * lead * kn,
    lookDown: (raw.lookDown ?? 0) - 0.35 * kn,
    twoHands: Math.min(raw.twoHands, 1 - Math.max(0, kn)),
    freeRel: v3(raw.freeRel.x - 0.15 * Math.max(0, kn), raw.freeRel.y + 0.4 * Math.max(0, kn), raw.freeRel.z - 0.25 * Math.max(0, kn)),
  };
}
function hitWeight(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext): number {
  if (!sample.onIce) return 0;
  const sl = contactSlotOf(anim);
  if (!sl || sl.hit.cid < 0) return 0;
  const a = hitAmounts(sl.hit, ctx.tick + ctx.alpha, hitAmt);
  const w = Math.max(a.close, a.drive, Math.abs(a.knock), a.recoil);
  return w > 1e-4 ? 1 : 0;
}
/** The hit overlay: its pose carries its own amounts, so it is applied at weight 1 whenever any of them is on. */
export const hitOverlay: Overlay = { id: 'hit', weight: hitWeight, apply: hitApply };

// ---------------------------------------------------------------------------------------------------------------
// Falls and getting up

type FallStyle = 'back' | 'side' | 'front';
/** The fall's style from the way he is knocked (body frame). */
export const fallStyleOf = (dx: number): FallStyle => (dx < -0.45 ? 'back' : dx > 0.45 ? 'front' : 'side');

/** Ticks the fall takes (harder hits faster), and the getting up (a share of the time down, within limits). */
const fallTicks = (sev: number): number => 12 - 2 * sev;
/** Getting up: onto one knee, then standing up off it over its last RISE_TICKS (the hips stay low till then). */
const RISE_TICKS = 7;
const getUpTicks = (downTicks: number): number => clamp(0.55 * downTicks, 14, 22);

/** The fall at display time `now`: how far down (0..1) and how far up again (0..1, through the knee). */
export function fallPhase(f: FallTrack, now: number): { down: number; up: number } {
  if (f.T < 0) return { down: 0, up: 0 };
  const down = smooth((now - (f.T - 1.5)) / fallTicks(f.sev));
  const G = getUpTicks(f.endT - f.T + 1);
  const up = clamp01((now - (f.endT - G)) / G);
  return { down, up };
}

/** Lying where the hit put him: on his back, on his side (toward +z for side 1) or forward on his hands and knees. */
function lyingRaw(style: FallStyle, side: 1 | -1, dims: BodyDims, sev: number): RawPose {
  let r: RawPose;
  if (style === 'back') {
    const hipY = 0.16;
    r = {
      hipY, pitch: -1.15 - 0.15 * sev, roll: 0.15 * side, yaw: 0, twist: 0.1 * side, look: 0, lookDown: 0.5,
      legs: [{ foot: v3(0.55, 0, -0.17), footYaw: -0.25 }, { foot: v3(0.82, 0, 0.14), footYaw: 0.25 }],
      top: v3(-0.22, 0.03 - hipY, 0.45), freeRel: v3(0, 0, 0), twoHands: 0,
      blade: v3(0.6, 0, 1.4), bladeUp: 0,
    };
    r.freeRel = handFrom(r, dims, v3(-0.3, 0.03, -0.48));
  } else if (style === 'front') {
    const hipY = 0.4;
    r = {
      hipY, pitch: 1.25, roll: 0.06 * side, yaw: 0, twist: 0, look: 0, lookDown: -0.35,
      legs: [{ foot: v3(-0.5, 0, -0.14), footYaw: -0.1 }, { foot: v3(-0.47, 0, 0.14), footYaw: 0.1 }],
      top: v3(0.6, 0.03 - hipY, 0.22), freeRel: v3(0, 0, 0), twoHands: 0,
      blade: v3(1.5, 0, -0.5), bladeUp: 0,
    };
    r.freeRel = handFrom(r, dims, v3(0.6, 0.03, -0.24));
  } else {
    const hipY = 0.22;
    r = {
      hipY, pitch: 0.1, roll: 1.15 * side, yaw: -0.15 * side, twist: 0.1 * side, look: 0.3 * side, lookDown: 0.2,
      legs: [{ foot: v3(0.25, 0, -0.62 * side - 0.08), footYaw: -0.6 * side }, { foot: v3(-0.05, 0, -0.62 * side + 0.08), footYaw: -0.6 * side }],
      top: v3(0, 0, 0), freeRel: v3(0, 0, 0), twoHands: 0,
      blade: v3(1.2, 0, 0.3 * side), bladeUp: 0,
    };
    // The hand on the side he falls to braces on the ice; the other comes over in front of him.
    const brace = v3(0.15, 0.03, 0.58 * side), over = v3(0.35, 0.12, 0.25 * side);
    if (side > 0) { r.top = v3(brace.x, brace.y - hipY, brace.z); r.freeRel = handFrom(r, dims, over); }
    else { r.top = v3(over.x, over.y - hipY, over.z + 0.15); r.freeRel = handFrom(r, dims, brace); }
  }
  return r;
}
/** The free hand's offset from his left shoulder for a hand at `p` (body frame). */
function handFrom(r: RawPose, dims: BodyDims, p: Vec3): Vec3 {
  const sh = shoulderJoint({ hipY: r.hipY, pitch: r.pitch, roll: r.roll, twist: r.twist }, 0, dims);
  return v3(p.x - sh.x, p.y - sh.y, p.z - sh.z);
}
/** On one knee, about to stand: the right skate planted in front, the left knee on the ice, both hands on the stick. */
function kneelRaw(dims: BodyDims): RawPose {
  const hipY = 0.92 * dims.thigh;
  return {
    hipY, pitch: 0.35, roll: 0, yaw: 0.1, twist: 0.1, look: 0, lookDown: 0.15,
    legs: [{ foot: v3(-0.5, 0, -0.14), footYaw: -0.2 }, { foot: v3(0.36, 0, 0.16), footYaw: 0.1 }],
    top: v3(0.25, -0.05, 0.2), freeRel: v3(0.3, -0.45, 0.1), twoHands: 1,
    blade: v3(1.05, 0, -0.35), bladeUp: 0,
  };
}

function fallActive(sl: ContactSlot | undefined): sl is ContactSlot { return !!sl && sl.fall.T >= 0; }

function fallWeight(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext): number {
  if (!sample.onIce) return 0;
  const sl = contactSlotOf(anim);
  if (!fallActive(sl)) return 0;
  const ph = fallPhase(sl.fall, ctx.tick + ctx.alpha);
  return ph.down > 0 || styleShare(anim.gait, 'down') > 0 ? 1 : 0;
}

function fallApply(raw: RawPose, anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose {
  const sl = contactSlotOf(anim);
  if (!fallActive(sl)) return raw;
  const f = sl.fall, now = ctx.tick + ctx.alpha;
  const m = motionOfSample(sample);
  const g = anim.gait;
  // Take the gait's own down share out and put his standing pose in its place: once he has his skates again the gait
  // blends from its down pose into his skating over GAIT.blendDown, so he goes from standing into his skating.
  const s = styleShare(g, 'down');
  const base = s > 0 ? addRawDelta(raw, rawPose('down', g, 1, m, dims, {}), rawPose('stand', g, 1, m, dims, {}), s) : raw;
  const { down, up } = fallPhase(f, now);
  if (down <= 0) return base;
  const style = fallStyleOf(f.dx);
  const lying = lyingRaw(style, f.dz >= 0 ? 1 : -1, dims, f.sev);
  // Down, then up through the knee: lying -> one knee over the first part, one knee -> standing over the rest.
  let pose = mixRaw(base, lying, down);
  if (up > 0) {
    const G = getUpTicks(f.endT - f.T + 1), riseFrom = 1 - RISE_TICKS / G;
    pose = mixRaw(pose, kneelRaw(dims), smooth(up / (0.85 * riseFrom)));
    pose = mixRaw(pose, base, smooth((up - riseFrom) / (1 - riseFrom)));
  }
  return pose;
}
/** The fall: weight 1 while it or the gait's down pose shows (its pose equals the input at both ends). */
export const fallOverlay: Overlay = { id: 'fall', weight: fallWeight, apply: fallApply };

// ---------------------------------------------------------------------------------------------------------------
// The drawn offset of a hit

/** A landed hit moves the target's drawn body this far (m) along the hit at full severity; a bounced hitter is thrown back this far. */
const KNOCK_OFFSET = 0.3, RECOIL_OFFSET = 0.2;
const knockOut = { x: 0, z: 0 };

function knockOffset(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, out: { x: number; z: number }): boolean {
  out.x = 0; out.z = 0;
  const sl = contactSlotOf(anim);
  if (!sl || !sample.onIce) return false;
  const now = ctx.tick + ctx.alpha, h = sl.hit, f = sl.fall;
  let amt = 0, wx = 0, wy = 0;
  if (h.cid >= 0 && h.I >= 0) {
    const a = hitAmounts(h, now, hitAmt);
    if (h.role === 'target') { amt = KNOCK_OFFSET * h.sev * a.knock; wx = h.ux; wy = h.uy; }
    else if (h.result === 'bounced') { amt = RECOIL_OFFSET * h.sevBack * a.recoil; wx = -h.ux; wy = -h.uy; }
  }
  if (f.T >= 0) {
    const ph = fallPhase(f, now);
    const k = (f.wx * wx + f.wy * wy > 0.5 || amt === 0) ? 1 : 0;
    const fa = (sl.hit.role === 'hitter' ? RECOIL_OFFSET : KNOCK_OFFSET) * f.sev * ph.down * (1 - smooth(ph.up / 0.8));
    if (k && fa > amt) { amt = fa; wx = f.wx; wy = f.wy; }
  }
  if (!(Math.abs(amt) > 1e-5)) return false;
  out.x = wx * amt; out.z = wy * amt;
  return true;
}
export const knockOverlay: Overlay = {
  id: 'knock',
  weight: (anim, sample, ctx) => (knockOffset(anim, sample, ctx, knockOut) ? 1 : 0),
  apply: (raw) => raw,
  offset: (anim, sample, ctx) => { knockOffset(anim, sample, ctx, knockOut); return knockOut; },
};

/** The contact overlays in the order they are registered (after the stick actions, blocks and celebrations). */
export const CONTACT_OVERLAYS: readonly Overlay[] = [contactTrack as Overlay, pokeOverlay, hitOverlay, fallOverlay, knockOverlay];

// ---------------------------------------------------------------------------------------------------------------
// The body pass

/** The pass's push follows a growing overlap at once, and eases away over this many seconds once it goes. */
const PUSH_OUT = 0.15;
/** A goalie or a carrier is moved only for what the other man cannot take (puck and net stay where they are). */
const STIFF = 1e6;

type PassScratch = { n: number; px: Float64Array; pz: Float64Array; tx: Float64Array; tz: Float64Array; r: Float64Array; m: Float64Array; ox: Float64Array; oz: Float64Array };
const pass: PassScratch = { n: 0, px: new Float64Array(0), pz: new Float64Array(0), tx: new Float64Array(0), tz: new Float64Array(0), r: new Float64Array(0), m: new Float64Array(0), ox: new Float64Array(0), oz: new Float64Array(0) };
function grow(n: number): void {
  if (pass.n >= n) return;
  pass.n = n;
  for (const k of ['px', 'pz', 'tx', 'tz', 'r', 'm', 'ox', 'oz'] as const) pass[k] = new Float64Array(n);
}

/** Distance (m) from a point inside the rink to the boards, and the outward normal there (into `n`). */
export function boardsGap(x: number, z: number, n: { x: number; z: number }): number {
  const R = RINK.cornerRadius, cx = RINK.halfLength - R, cz = RINK.halfWidth - R;
  const ax = Math.abs(x), az = Math.abs(z), sx = x >= 0 ? 1 : -1, sz = z >= 0 ? 1 : -1;
  if (ax > cx && az > cz) {
    const dx = ax - cx, dz = az - cz, d = Math.hypot(dx, dz) || 1;
    n.x = (sx * dx) / d; n.z = (sz * dz) / d;
    return R - d;
  }
  if (RINK.halfLength - ax < RINK.halfWidth - az) { n.x = sx; n.z = 0; return RINK.halfLength - ax; }
  n.x = 0; n.z = sz;
  return RINK.halfWidth - az;
}
const nrm = { x: 0, z: 0 };

/** Limit the vector (x, z) of body i (overlay offset + push) to MAX_OFFSET, scaling the push only. */
function budget(i: number): void {
  const ox = pass.ox[i]!, oz = pass.oz[i]!;
  let x = ox + pass.tx[i]!, z = oz + pass.tz[i]!;
  const l = Math.hypot(x, z);
  if (l > MAX_OFFSET) { x *= MAX_OFFSET / l; z *= MAX_OFFSET / l; pass.tx[i] = x - ox; pass.tz[i] = z - oz; }
}

export const contactBodyPass: BodyPass = (bodies: readonly DrawnBody[], ctx: AnimContext, dt: number): void => {
  const n = bodies.length;
  grow(n);
  const carrier = ctx.puck.carrierId;
  for (let i = 0; i < n; i++) {
    const b = bodies[i]!;
    // The overlays' own offset, within the limit.
    let ox = fin(b.offset.x), oz = fin(b.offset.z);
    const l = Math.hypot(ox, oz);
    if (l > MAX_OFFSET) { ox *= MAX_OFFSET / l; oz *= MAX_OFFSET / l; }
    pass.ox[i] = ox; pass.oz[i] = oz; pass.tx[i] = 0; pass.tz[i] = 0;
    pass.px[i] = b.pos.x + ox; pass.pz[i] = b.pos.y + oz;
    const dims = b.kind === 'skater' ? ctx.skaters.get(b.id)?.dims : ctx.goalies.get(b.id)?.dims;
    const kg = dims ? weightOfDims(dims) : 85;
    pass.r[i] = radiusOfWeight(kg);
    pass.m[i] = b.kind === 'goalie' || b.id === carrier ? STIFF : massOfWeight(kg);
  }
  // Pairs: a few rounds of pushing overlapping bodies apart, each within his limit.
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < n; i++) {
      const a = bodies[i]!;
      if (!a.onIce) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j]!;
        if (!b.onIce) continue;
        const ax = pass.px[i]! + pass.tx[i]!, az = pass.pz[i]! + pass.tz[i]!, bx = pass.px[j]! + pass.tx[j]!, bz = pass.pz[j]! + pass.tz[j]!;
        const min = pass.r[i]! + pass.r[j]!;
        if ((bx - ax) * (bx - ax) + (bz - az) * (bz - az) >= min * min) continue;
        // Pushed apart along the line between them as last drawn (with last frame's push), so the push keeps its side
        // when one skates right through the other's place.
        let dx = bx + b.eased.x - ax - a.eased.x, dz = bz + b.eased.z - az - a.eased.z;
        const dl = Math.hypot(dx, dz);
        if (dl < 1e-6) { dx = Math.cos(a.facing); dz = Math.sin(a.facing); } else { dx /= dl; dz /= dl; }
        const o = min - ((bx - ax) * dx + (bz - az) * dz), ma = pass.m[i]!, mb = pass.m[j]!;
        if (!(o > 0)) continue;
        const shareA = mb / (ma + mb);
        // Each side's share, then whatever one cannot take (his limit) goes to the other.
        const ta0x = pass.tx[i]!, ta0z = pass.tz[i]!;
        pass.tx[i] = ta0x - dx * o * shareA; pass.tz[i] = ta0z - dz * o * shareA; budget(i);
        const gotA = (ta0x - pass.tx[i]!) * dx + (ta0z - pass.tz[i]!) * dz;
        const tb0x = pass.tx[j]!, tb0z = pass.tz[j]!;
        const wantB = o - gotA;
        pass.tx[j] = tb0x + dx * wantB; pass.tz[j] = tb0z + dz * wantB; budget(j);
        const gotB = (pass.tx[j]! - tb0x) * dx + (pass.tz[j]! - tb0z) * dz;
        const rest = o - gotA - gotB;
        if (rest > 1e-6) { pass.tx[i] = pass.tx[i]! - dx * rest; pass.tz[i] = pass.tz[i]! - dz * rest; budget(i); }
      }
    }
  }
  // Into a growing push at once, away from it slowly, then the boards and the limit on the total.
  const kIn = dt > 0 ? 1 : 0, kOut = dt > 0 ? 1 - Math.exp(-dt / PUSH_OUT) : 0;
  for (let i = 0; i < n; i++) {
    const b = bodies[i]!;
    if (!b.onIce) { b.eased.x = 0; b.eased.z = 0; continue; }
    const tx = pass.tx[i]!, tz = pass.tz[i]!, ex = b.eased.x, ez = b.eased.z;
    // Toward a push that is growing or turning: at once; toward a smaller one: slowly.
    const k = tx * tx + tz * tz - (ex * tx + ez * tz) > 1e-9 ? kIn : kOut;
    b.eased.x = ex + (tx - ex) * k; b.eased.z = ez + (tz - ez) * k;
    let x = pass.ox[i]! + b.eased.x, z = pass.oz[i]! + b.eased.z;
    const l = Math.hypot(x, z);
    if (l > MAX_OFFSET) { x *= MAX_OFFSET / l; z *= MAX_OFFSET / l; }
    // Inside the boards: never nearer them than his radius (the engine keeps his place there; only an offset can
    // take him nearer, and it is taken back along the boards' normal).
    const gap = boardsGap(b.pos.x + x, b.pos.y + z, nrm), need = pass.r[i]! - gap;
    if (need > 0) { x -= nrm.x * need; z -= nrm.z * need; }
    b.offset.x = x; b.offset.z = z;
  }
};
