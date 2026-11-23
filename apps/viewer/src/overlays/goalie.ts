import { DT, type GameEvent, type SavePose } from '@hockey/engine';
import { goalieSlotOf, type AnimContext, type GoalieAnim, type GoalieOverlay, type GoalieSample } from '../anim-context';
import type { BodyDims } from '../body';
import { glovePocket, goalieKeyRaw, mixGoalieRaw, type GoalieFigurePose, type GoalieRaw } from '../goalie-pose';
import type { Vec3 } from '../pose-mix';
import { lastSinceDrop } from '../timeline';

/**
 * Saves that reach the puck (pure: no three.js, no DOM). For a shot on its way to his net (a `release` of kind `shot`
 * whose shot ends in a `save`, `goal`, `miss` or `post` against him, from the timeline), the goalie gets set as the
 * shooter lets it go, then moves the part the engine's save names (glove, blocker, pad, or his body in the butterfly)
 * to where the puck crosses the plane just in front of him, arriving as the puck does. On a goal he reaches exactly as
 * for a save until a tick before the puck gets there, then comes up short of it, and is beaten. Holding the puck after a frozen save or a cover, the puck is drawn in his glove or under it
 * (goalieHeldPuck, which the scene gives the puck machine).
 *
 * The puck's path is the engine's own: from where the release event let it go, at display time R - 1 (the last moment
 * the shooter had it; R the event's tick), along the release velocity and falling under gravity, which is exactly the
 * engine's puck at every tick of its flight. The engine decides the save when the puck reaches the goal line, behind
 * him, during the step that ends on the save's tick T; so the contact is the moment the path crosses the plane a
 * part's reach in front of his centre, between T - 2 and T. Everything here is a function of the display time and the
 * timeline (and the engine state of the frame), so a seek's pre-roll shows what play shows; the only remembered thing
 * is the path of a puck that reached him without a release (a pass or a loose puck sliding in), read from the engine
 * state on its way.
 *
 * Which hand catches: the engine's goalies catch with their left as the engine reckons sides (its x and y axes with y
 * to the left of +x), and its glove saves are on that side. The viewer draws engine y as world Z, which turns that side
 * into the figure's right (rig.ts: z to his right); so the glove is drawn on the hand the engine's glove saves come
 * to, GOALIE_CATCHES, which the animator passes to the goalie pose.
 */

/** The hand the viewer's goalies catch with, as the figure is drawn (see above: the engine's left is drawn on his right). */
export const GOALIE_CATCHES: 'L' | 'R' = 'R';
/** A body-frame z (to his right) in the left-catching raw frame of the goalie pose. */
const RAW_Z = GOALIE_CATCHES === 'R' ? -1 : 1;

const GRAVITY = 9.81;
const TICKS = (s: number): number => s / DT;
/** How far ahead (ticks) a shot's end is looked for, and how long after it (the longest hold) a plan lasts. */
const AHEAD = Math.round(TICKS(3.5)), AFTER = Math.round(TICKS(2));
/** He gets set over this long (ticks) up to the release. */
const SET = TICKS(0.3);
/** The reach takes this long, scaled by the shot's flight time (LEAD_SHARE of it), within these bounds (s), never before the release. */
const LEAD_MIN = 0.15, LEAD_MAX = 0.3, LEAD_SHARE = 0.75;
/** After a save that rebounds: the part stays at the contact this long, then lets go over this long (ticks). */
const REB_HOLD = 4.5, REB_FADE = 10.5;
/** After a save that is held but not in the glove: the part stays this long, then gives way to the engine's cover. */
const COVER_HOLD = 3.6, COVER_FADE = 7.5;
/** The rebound leaves the saving part and joins the engine's puck over at least this long (ticks), and by the save's tick. */
const REB_LEAVE = 4.5;
/**
 * The ruled exception for a stopped puck in live play (the fifth exception to "a loose puck is drawn at the engine's
 * puck"): from the moment it reaches his plane it is drawn at the saving part until it rejoins the engine's puck, at
 * most SAVE_HOLD_AFTER ticks after the save's tick (the contact is at or before the save's tick, and REB_LEAVE is
 * shorter), and never more than SAVE_HOLD_REACH m from the engine's puck (the scene holds it to that in live play).
 */
export const SAVE_HOLD_AFTER = 6, SAVE_HOLD_REACH = 1.6;
/** A saving hand meets the puck this far (m) in front of its middle (the face of the blocker or the glove). */
export const HAND_FACE = 0.1;
/** On a goal the reach is a save's until this long (ticks) before the contact, and has given way to being beaten by it. */
const BEATEN_FROM = 1;
/** On a goal the part ends this far short (m) of where the puck crossed. */
const BEATEN_SHORT = 0.42;
/** On a low goal the pad kick is this much (m) short along the leg as the puck goes by. */
const BEATEN_PAD_SHORT = 0.55;
/** After the puck has gone by him on a goal, the part reaches for where it went: from this long after (s), over this long. */
const LATE_START = 0.0, LATE_TIME = 0.2;

/** The plane (m in front of his centre) where each part meets the puck. */
export const CONTACT_PLANE: Record<SavePose, number> = { glove: 0.42, blocker: 0.42, pad: 0.2, butterfly: 0.25 };

type Kind = 'save' | 'goal' | 'miss' | 'post' | 'cover';
/** The events that end a shot on him (or a cover). */
type ShotEnd = Extract<GameEvent, { type: 'save' | 'goal' | 'miss' | 'post' | 'freeze' }>;
type Path = { t0: number; px: number; py: number; pz: number; vx: number; vy: number; vz: number; grav: boolean };

/**
 * One reaction: to a shot that ends at tick `end` (its kind, and on a save whether it is held), or to a cover. World
 * points are x and z on the ice (engine x, y) and y the height, as AnimContext.puck has them. `part` is the saving
 * part, `path` the puck's path and `release` its start (display time; -Infinity without a release), `tc` the contact
 * (the path crossing his plane) and `c` the puck there (`rc` in his raw frame, kept from the contact on). `set` is how set he is, `reach` how far the part has gone to
 * its target (both already faded out after the contact), `w` the larger, `hold` whether he has the puck this frame,
 * `since` seconds since the contact.
 */
export type ReachPlan = {
  active: boolean;
  kind: Kind; end: number; part: SavePose; freeze: boolean;
  path: Path; release: number; tc: number; c: Vec3; rc: Vec3;
  w: number; set: number; reach: number; hold: boolean; since: number;
  /** On a goal, how far he has given way from the save he reached for to being beaten (0 until a tick before the contact, 1 from it). */
  beat: number;
};
/**
 * The reach's state for one goalie (plain data, made once per goalie and refilled every step from the timeline and the
 * frame): the reaction under way (`cur`) and the one before it while it still shows (`prev`: a save whose rebound is
 * covered a moment later fades out under the cover). `memo` keeps the path read from the engine state for a puck that
 * reached him without a release (the event tick it is for, and the path), for the last two such events.
 */
export type ReachSlot = { now: number; cur: ReachPlan; prev: ReachPlan; memo: (Path & { end: number })[]; locks: Lock[] };
/**
 * The contact of a shot (ending at tick `end`) as it was when the puck got there: its time, the puck there (world) and
 * the part, kept from then on (he moves and turns after the save; the contact does not).
 */
type Lock = { end: number; tc: number; x: number; y: number; z: number; part: SavePose; raw: Vec3 };

export const REACH_ID = 'goalieReach';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const easeOut = (t: number): number => { const u = clamp01(t); return 1 - (1 - u) * (1 - u); };
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);

const newPath = (): Path => ({ t0: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, grav: false });
const newPlan = (): ReachPlan => ({
  active: false, kind: 'save', end: -1, part: 'butterfly', freeze: false, path: newPath(), release: -Infinity, tc: 0,
  c: { x: 0, y: 0, z: 0 }, rc: { x: 0, y: 0, z: 0 }, w: 0, set: 0, reach: 0, hold: false, since: 0, beat: 0,
});
function newSlot(): ReachSlot {
  const lock = (): Lock => ({ end: -1, tc: 0, x: 0, y: 0, z: 0, part: 'butterfly', raw: { x: 0, y: 0, z: 0 } });
  return { now: 0, cur: newPlan(), prev: newPlan(), memo: [{ ...newPath(), end: -1 }, { ...newPath(), end: -1 }], locks: [lock(), lock()] };
}

/** The puck on a path at display time t (ticks), into `out` (world). */
function pathAt(p: Path, t: number, out: Vec3): Vec3 {
  const tau = (t - p.t0) * DT;
  out.x = p.px + p.vx * tau;
  out.y = Math.max(0, p.py + p.vy * tau - (p.grav ? (GRAVITY / 2) * tau * tau : 0));
  out.z = p.pz + p.vz * tau;
  return out;
}

/** A world point in his raw (left-catching) body frame, from his place and facing this frame. */
export function toGoalieRaw(s: GoalieSample, w: Vec3): Vec3 {
  const dx = w.x - s.pos.x, dz = w.z - s.pos.y, c = Math.cos(s.facing), n = Math.sin(s.facing);
  return { x: dx * c + dz * n, y: w.y, z: RAW_Z * (-dx * n + dz * c) };
}
/** A point of his fitted figure (body frame, as drawn: turned `turn` from the engine facing) in the world. */
export function goalieWorld(s: GoalieSample, p: Vec3, out: Vec3, turn = 0): Vec3 {
  const c = Math.cos(s.facing + turn), n = Math.sin(s.facing + turn);
  out.x = s.pos.x + p.x * c - p.z * n; out.y = p.y; out.z = s.pos.y + p.x * n + p.z * c;
  return out;
}

/** The part the engine would name for a puck crossing at `c` (raw frame): high is glove or blocker by side, low is pad or butterfly. */
const partFor = (c: Vec3): SavePose => (c.y > 0.5 ? (c.z < 0 ? 'glove' : 'blocker') : Math.abs(c.z) > 0.35 ? 'pad' : 'butterfly');

/**
 * The time (ticks) the path crosses the plane `plane` m in front of him, between its start and `end`. The plane is
 * square to the shot's line (he squares to it; and so a turn of his after the shot does not move the crossing).
 */
function crossing(s: GoalieSample, p: Path, plane: number, end: number): number {
  const sp = Math.hypot(p.vx, p.vz);
  const tauEnd = (end - p.t0) * DT;
  if (sp < 1e-3) return p.t0 + Math.max(0, tauEnd) / DT;
  const c = -p.vx / sp, n = -p.vz / sp;
  const f0 = (p.px - s.pos.x) * c + (p.pz - s.pos.y) * n;
  return p.t0 + clamp(fin((f0 - plane) / sp), 0, Math.max(0, tauEnd)) / DT;
}

type Found = { e: ShotEnd | null; kind: Kind; rel: number | null };
const newFound = (): Found => ({ e: null, kind: 'save', rel: null });

/** The release tick of the shot an event ends (null: none, or a cover). */
function releaseOf(tl: AnimContext['timeline'], e: ShotEnd, id: string): number | null {
  if (e.type === 'save') return tl.last('shot', e.tick, 0, id, 'other')?.detail.releaseTick ?? null;
  if (e.type === 'goal' || e.type === 'miss' || e.type === 'post') return e.detail.releaseTick;
  return null;
}

/** Keep `e` in `out` (latest first, at most two) if his reaction to it has begun by `now` and not long ended. */
function consider(out: [Found, Found], e: ShotEnd, kind: Kind, rel: number | null, now: number): boolean {
  const begin = kind === 'cover' ? e.tick - 1 : rel !== null ? rel - 1 - SET : e.tick - 1 - TICKS(0.4);
  if (begin > now || now > e.tick + AFTER) return false;
  const [a, b] = out;
  if (!a.e || e.tick > a.e.tick) { b.e = a.e; b.kind = a.kind; b.rel = a.rel; a.e = e; a.kind = kind; a.rel = rel; }
  else if (!b.e || e.tick > b.e.tick) { b.e = e; b.kind = kind; b.rel = rel; }
  return true;
}

/** The latest two events of `type` for him whose reaction has begun (a later shot may already be in the log). */
function lookFor(out: [Found, Found], ctx: AnimContext, id: string, now: number, type: 'save' | 'goal' | 'miss' | 'post' | 'freeze', role: 'player' | 'other'): void {
  const tl = ctx.timeline, base = Math.floor(now);
  let e = tl.last(type, base + AHEAD, AHEAD + AFTER, id, role) as ShotEnd | undefined;
  let got = 0;
  for (let i = 0; i < 8 && e && got < 2; i++) {
    const kind: Kind | null = e.type === 'freeze' ? (e.detail.cause === 'cover' ? 'cover' : null) : e.type;
    if (kind && consider(out, e, kind, releaseOf(tl, e, id), now)) got++;
    e = tl.last(type, e.tick - 1, e.tick - 1 - (base - AFTER), id, role) as ShotEnd | undefined;
  }
}

/**
 * The two latest shots or covers he is reacting to at display time `now` (their reaction begun: a shot from the set
 * before its release, a cover from the tick before it), latest first, into `out` (made once; nothing allocated here).
 */
function findEvents(ctx: AnimContext, id: string, now: number, out: [Found, Found]): void {
  out[0].e = null; out[1].e = null;
  lookFor(out, ctx, id, now, 'save', 'player');
  lookFor(out, ctx, id, now, 'goal', 'other');
  lookFor(out, ctx, id, now, 'miss', 'other');
  lookFor(out, ctx, id, now, 'post', 'other');
  lookFor(out, ctx, id, now, 'freeze', 'player');
}

/** Fill a plan's path for its event: from the release, or (no release) from the engine state on the puck's way in. */
function readPath(plan: ReachPlan, memo: ReachSlot['memo'], ctx: AnimContext, f: Found, e: ShotEnd): boolean {
  const p = plan.path;
  if (f.rel !== null) {
    const shooter = e.type === 'save' ? e.otherId : e.playerId;
    const r = shooter ? ctx.timeline.last('release', f.rel, 0, shooter) : undefined;
    if (r && r.detail.kind === 'shot') {
      p.t0 = f.rel - 1; p.px = r.pos.x; p.py = 0; p.pz = r.pos.y; p.vx = r.detail.vel.x; p.vy = r.detail.vel.z; p.vz = r.detail.vel.y; p.grav = true;
      // A shot that reached the net runs straight from the release to where the save or the goal has it on the goal
      // line (the same line as the release velocity's: the event's place says it).
      if (e.type === 'save' || e.type === 'goal') {
        const dx = e.pos.x - r.pos.x, dz = e.pos.y - r.pos.y, l = Math.hypot(dx, dz), v = Math.hypot(p.vx, p.vz);
        if (l > 1e-6) { p.vx = (dx / l) * v; p.vz = (dz / l) * v; }
      }
      plan.release = f.rel - 1;
      return true;
    }
  }
  plan.release = -Infinity;
  const st = ctx.state;
  let m = memo[0]!.end === e.tick ? memo[0]! : memo[1]!.end === e.tick ? memo[1]! : null;
  if (st.tick < e.tick && st.tick >= e.tick - 30) {
    if (!m) { m = memo[1]!; memo[1] = memo[0]!; memo[0] = m; }
    const k = st.puck;
    m.end = e.tick; m.t0 = st.tick; m.px = k.pos.x; m.py = k.z; m.pz = k.pos.y; m.vx = k.vel.x; m.vy = k.vz; m.vz = k.vel.y; m.grav = k.z > 0 || k.vz > 0;
  }
  if (!m) return false;
  p.t0 = m.t0; p.px = m.px; p.py = m.py; p.pz = m.pz; p.vx = m.vx; p.vy = m.vy; p.vz = m.vz; p.grav = m.grav;
  return true;
}

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/** Work out one reaction for this frame into `plan`. */
function fill(plan: ReachPlan, slot: ReachSlot, f: Found, s: GoalieSample, ctx: AnimContext, now: number): void {
  plan.active = false; plan.w = 0; plan.set = 0; plan.reach = 0; plan.hold = false; plan.beat = 0;
  const e = f.e;
  if (!e) return;
  const kind = f.kind, T = e.tick;
  plan.kind = kind; plan.end = T;
  plan.freeze = kind === 'save' && ctx.timeline.last('freeze', T, 0, s.id)?.detail.cause === 'save';
  // Holding the puck until the engine moves it: the whistle's stoppage (the faceoff setup puts the puck on the dot).
  const holding = (plan.freeze || kind === 'cover') && ctx.state.phase === 'stopped' && ctx.timeline.last('freeze', ctx.state.tick, ctx.state.tick - T, s.id)?.tick === T;
  if (kind === 'cover') {
    if (e.type !== 'freeze') return;
    plan.part = 'glove'; plan.release = -Infinity;
    plan.tc = T - 1;
    plan.c.x = e.pos.x; plan.c.y = 0; plan.c.z = e.pos.y;
    const r = smooth((now - (T - 1)) / 6) * (1 - smooth((now - T - 36) / 9));
    plan.reach = r; plan.w = r; plan.hold = holding; plan.active = r > 1e-4 || plan.hold;
    return;
  }
  if (!readPath(plan, slot.memo, ctx, f, e)) return;
  // Where the puck crosses his plane: the part the engine names (its save pose; else the one it would name there).
  // Kept from the contact on (see Lock).
  const locks = slot.locks;
  let lock = locks[0]!.end === T ? locks[0]! : locks[1]!.end === T ? locks[1]! : null;
  let part: SavePose, tc: number;
  if (lock) {
    part = lock.part; tc = lock.tc; plan.c.x = lock.x; plan.c.y = lock.y; plan.c.z = lock.z;
  } else {
    part = e.type === 'save' ? e.detail.pose : partFor(toGoalieRaw(s, pathAt(plan.path, crossing(s, plan.path, 0.3, T), scratch)));
    tc = crossing(s, plan.path, CONTACT_PLANE[part], T);
    pathAt(plan.path, tc, plan.c);
    // A puck already past his plane (one that reached him without a release, read late): nothing to reach for. Nor is
    // there, past the contact, for one without a release whose contact was not seen (its path is read on its way in).
    if (toGoalieRaw(s, plan.c).x < 0 || (now >= tc && plan.release === -Infinity && now > tc + 1)) return;
    if (now >= tc) {
      lock = locks[1]!; locks[1] = locks[0]!; locks[0] = lock;
      lock.end = T; lock.tc = tc; lock.x = plan.c.x; lock.y = plan.c.y; lock.z = plan.c.z; lock.part = part;
      const r = toGoalieRaw(s, plan.c); lock.raw.x = r.x; lock.raw.y = r.y; lock.raw.z = r.z;
    }
  }
  // The contact in his raw frame: as it is now until the contact, then as it was then (a beaten goalie turning to
  // look at his net keeps the pose he was beaten in).
  const rc = lock ? lock.raw : toGoalieRaw(s, plan.c);
  plan.rc.x = rc.x; plan.rc.y = rc.y; plan.rc.z = rc.z;
  plan.part = part;
  plan.tc = tc;
  const flight = tc - plan.path.t0;
  const lead = Math.min(flight, TICKS(clamp(LEAD_SHARE * flight * DT, LEAD_MIN, LEAD_MAX)));
  const set = plan.release > -Infinity ? smooth((now - (plan.release - SET)) / SET) : 0;
  let reach: number, after: number;
  const gloveHeld = plan.freeze && part === 'glove';
  if (kind === 'goal') {
    // The same reach as a save's, to where the puck will cross (nothing gives the goal away before it gets there); from a
    // tick before the contact he gives way to being beaten (see beatenRaw: short of it as it goes by, then after it),
    // then to the slump (reactions.ts beatenGoalie).
    reach = lead > 0 ? (now < tc - lead ? 0 : easeOut((now - (tc - lead)) / lead)) : now >= tc ? 1 : 0;
    after = 1 - smooth((now - tc - 9) / 18);
    plan.beat = smooth((now - (tc - BEATEN_FROM)) / BEATEN_FROM);
  } else {
    reach = lead > 0 ? (now < tc - lead ? 0 : easeOut((now - (tc - lead)) / lead)) : now >= tc ? 1 : 0;
    if (kind === 'miss' || kind === 'post') { reach *= kind === 'post' ? 1 : 0.7; after = 1 - smooth((now - tc) / 12); }
    else if (gloveHeld) after = holding || now < T ? 1 : 0;
    else if (plan.freeze) after = 1 - smooth((now - tc - COVER_HOLD) / COVER_FADE);
    else after = 1 - smooth((now - tc - REB_HOLD) / REB_FADE);
  }
  plan.set = set * after;
  plan.reach = gloveHeld && now >= tc ? after : reach * after;
  plan.since = Math.max(0, (now - tc) * DT);
  plan.w = Math.max(plan.set, plan.reach);
  // The puck is his from the moment it reaches his plane (never before: until then it is the engine's), until a
  // rebound has joined the engine's puck (by REB_LEAVE after the contact, at most SAVE_HOLD_AFTER ticks after the
  // save's tick) or a held puck is put on the dot.
  // (From a tick before the contact plane it may be his: a hand drawn out in front of the plane meets it a moment
  // sooner; goalieHeldPuck decides that from the hand as drawn.)
  if (kind === 'save') plan.hold = now >= tc - 1 && (plan.freeze ? holding || now < T : now < Math.max(T, tc + REB_LEAVE));
  plan.active = plan.w > 1e-4 || plan.hold;
}

const found: [Found, Found] = [newFound(), newFound()];

/** Work out the reactions for this frame into the slot. */
function plan(slot: ReachSlot, s: GoalieSample, ctx: AnimContext): void {
  const now = ctx.tick + ctx.alpha;
  slot.now = now;
  findEvents(ctx, s.id, now, found);
  fill(slot.cur, slot, found[0], s, ctx, now);
  fill(slot.prev, slot, found[1], s, ctx, now);
}

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const addV = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const subV = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? v3(a.x / l, a.y / l, a.z / l) : v3(0, 1, 0); };
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
/** `to` pulled `short` metres back toward `from`. */
const shortOf = (from: Vec3, to: Vec3, short: number): Vec3 => {
  const d = subV(to, from), l = Math.hypot(d.x, d.y, d.z);
  return l > short ? lerpV(from, to, (l - short) / l) : from;
};
const scaleOf = (d: BodyDims): number => d.torso / 0.288 / 1.88;
/**
 * Where the glove's pocket is from the middle of the hand (as goalie-rig.ts draws it: out along the way the pocket faces
 * and up toward the fingers), for a pocket facing `face`.
 */
function pocketOffset(face: Vec3, k: number): Vec3 {
  const f = norm(face), up = norm(v3(-f.x * f.y, 1 - f.y * f.y, -f.z * f.y));
  return v3(f.x * POCKET_OUT * k + up.x * POCKET_UP * k, f.y * POCKET_OUT * k + up.y * POCKET_UP * k, f.z * POCKET_OUT * k + up.z * POCKET_UP * k);
}
/** The pocket's open face from the hand (out, up; goalie-rig.ts gPocket) and the drawn puck's half thickness. */
const POCKET_OUT = 0.08, POCKET_UP = 0.14, PUCK_HALF = 0.019;

/**
 * The key pose of `part` with that part put at `c` (raw frame): the glove or the blocker (its stick with it) at the
 * puck, the other hand where it was (`base`, ready); for a puck low on the glove or blocker side he drops toward the
 * butterfly and leans into it so the hand reaches down to it; the save leg's pad out along the ice under it; the
 * butterfly's near pad toward it. `beaten`: the part stops short of it.
 */
function placed(part: SavePose, c: Vec3, d: BodyDims, beaten: boolean, base: GoalieRaw): GoalieRaw {
  const side: 1 | -1 = c.z >= 0 ? 1 : -1;
  let key = goalieKeyRaw(part, d, side);
  const k = scaleOf(d);
  if (part === 'glove' || part === 'blocker') {
    // A hand save: the lower the puck, the more he drops toward the butterfly and leans forward over it.
    const low = smooth((0.95 * k - c.y) / (0.5 * k));
    if (low > 0) {
      const bf = goalieKeyRaw('butterfly', d, side);
      key = { ...mixGoalieRaw(key, bf, low * 0.85), glove: key.glove, gloveFace: key.gloveFace, blocker: key.blocker, blockerFace: key.blockerFace, heel: key.heel, bladeDir: key.bladeDir };
      key.pitch += 0.35 * low;
    }
    key.look = clamp(0.15 + (1.3 - c.y) * 0.4, -0.3, 0.8);
  }
  if (part === 'glove') {
    // The pocket (not the middle of the glove) to the puck.
    key.glove = beaten ? shortOf(key.glove, c, BEATEN_SHORT) : subV(c, pocketOffset(key.gloveFace, k));
    key.roll = -0.18 - 0.3 * clamp01((-c.z - 0.5) / 0.4);
    key.blocker = base.blocker; key.blockerFace = base.blockerFace; key.heel = base.heel; key.bladeDir = base.bladeDir;
  } else if (part === 'blocker') {
    const heel = subV(key.heel, key.blocker);
    key.blocker = beaten ? shortOf(key.blocker, c, BEATEN_SHORT) : c;
    key.heel = addV(key.blocker, heel);
    if (key.heel.y < 0) key.heel = v3(key.heel.x, 0, key.heel.z);
    key.roll = 0.18 + 0.3 * clamp01((c.z - 0.5) / 0.4);
    key.glove = base.glove; key.gloveFace = base.gloveFace;
  } else if (part === 'pad') {
    // The save leg's ankle beyond the puck, so the pad lies along the ice through it.
    // A wide puck: the save leg kicked out along the ice, its ankle beyond the puck. One nearer his middle: the knee
    // down in front just inside it and the pad flared out along the ice across it. The other leg's pad tucked in no
    // further out than the save leg's.
    const i = side > 0 ? 1 : 0, leg = key.legs[i], other = key.legs[1 - i]!;
    const az = Math.abs(c.z), y0 = clamp(c.y - 0.12, 0.12, 0.4), wide = smooth((az - 0.45 * k) / (0.3 * k));
    const nearKnee = v3(c.x, clamp(c.y - 0.18, 0.1, 0.32), side * Math.max(0.16 * k, az - 0.2 * k)), nearAnkle = v3(c.x - 0.1 * k, y0, side * (az + 0.4 * k));
    const want = lerpV(nearAnkle, v3(c.x - 0.05 * k, y0, c.z + side * 0.14 * k), wide);
    leg.ankle = beaten ? shortOf(v3(0.12 * k, 0.13, side * 0.45 * k), want, BEATEN_SHORT) : want;
    leg.knee = lerpV(nearKnee, leg.knee, wide);
    leg.up = norm(subV(leg.knee, leg.ankle));
    const reachOut = Math.abs(leg.ankle.z) - 0.25 * k;
    if (Math.abs(other.ankle.z) > reachOut) {
      const tuck = Math.abs(other.ankle.z) - Math.max(0.15 * k, reachOut);
      other.ankle = v3(other.ankle.x - tuck * 0.8, other.ankle.y, other.ankle.z + side * tuck);
    }
    key.look = 0.45;
  } else {
    // Butterfly: the pads flare along the ice; the near knee and pad turn toward the puck, the hands come in front.
    const i = side > 0 ? 1 : 0, leg = key.legs[i];
    const toward = clamp(c.z * side - 0.13 * k, 0, 0.25);
    if (!beaten) leg.knee = addV(leg.knee, v3(0, 0, side * toward));
    key.look = 0.4;
  }
  return key;
}

/**
 * Beaten by a shot crossing at `c` (raw frame, as at the contact): he commits to it, the part the engine's save would
 * use going for it, but late or short, and the puck goes past it; then (`late`, 0..1 after the crossing) the part
 * carries on to where the puck went, behind it.
 * - high (glove or blocker): the hand comes up from below it and is still short as it goes by; if it is at his middle,
 *   chest high, he is also leaning off its line, down toward a butterfly on the far side, so it passes beside him;
 * - low and wide (pad): the kick goes out toward it but is short, and trails it;
 * - low between his pads: his legs open as he goes down (the five-hole), and close after it has gone through.
 * Each is blended by where it crossed, so a crossing near a boundary never switches pose.
 */
function beatenRaw(c: Vec3, d: BodyDims, late: number): GoalieRaw {
  const k = scaleOf(d), side: 1 | -1 = c.z >= 0 ? 1 : -1;
  const hi = smooth((c.y - 0.45 * k) / (0.2 * k)), mid = 1 - smooth((Math.abs(c.z) - 0.22 * k) / (0.16 * k));
  const base = goalieKeyRaw('stance', d, 1);
  // High: the hand on its side, from below and short of it toward it.
  const hand: SavePose = side < 0 ? 'glove' : 'blocker';
  const below = v3(c.x - 0.05 * k, c.y - 0.42 * k, c.z - side * 0.08 * k);
  let high = placed(hand, lerpV(below, v3(c.x, c.y + 0.08 * k, c.z), late), d, false, base);
  if (mid > 0) {
    // Chest high at his middle: leaning off its line, toward a butterfly on the far side.
    const lean = goalieKeyRaw('butterfly', d, side);
    const off = { ...mixGoalieRaw(high, lean, 0.7 * mid), glove: high.glove, gloveFace: high.gloveFace, blocker: high.blocker, blockerFace: high.blockerFace, heel: high.heel, bladeDir: high.bladeDir };
    off.roll = high.roll * (1 - mid) - side * 0.55 * mid; off.pitch = high.pitch + 0.1 * mid;
    high = off;
  }
  // Low and wide: the pad kicked toward it but short (the save leg's ankle drawn back toward his hip), then trailing it.
  const lowSide = placed('pad', c, d, false, base), kick = lowSide.legs[side > 0 ? 1 : 0];
  kick.ankle = shortOf(v3(0, lowSide.hipY, side * 0.1 * k), kick.ankle, BEATEN_PAD_SHORT * k * (1 - late));
  kick.knee = lerpV(kick.knee, v3(0.25 * k, 0.3, side * 0.2 * k), 0.6 * (1 - late));
  // Low at his middle: going down with the legs open, closing into the butterfly once it is through.
  const split = goalieKeyRaw('stance', d, 1);
  for (const i of [0, 1] as const) {
    const z = i === 0 ? -1 : 1, leg = split.legs[i];
    leg.ankle = v3(0.05 * k, 0.12, z * 0.66 * k); leg.knee = v3(0.3 * k, 0.45 * k, z * 0.4 * k);
  }
  split.hipY -= 0.12 * k; split.pitch = 0.4; split.look = 0.5;
  split.heel = v3(0.55 * k, 0.05, 0.62 * k); split.bladeDir = v3(0.6, 0, 0.8);
  split.blocker = v3(0.4 * k, 0.6 * k, 0.5 * k);
  const lowMid = mixGoalieRaw(split, goalieKeyRaw('butterfly', d, side), late);
  return mixGoalieRaw(mixGoalieRaw(lowSide, lowMid, mid), high, hi);
}

/** Getting set as the shot comes: hands a little forward, the hips a touch lower. */
function setRaw(raw: GoalieRaw, d: BodyDims, s: number): GoalieRaw {
  const k = scaleOf(d) * s;
  return {
    ...raw, hipY: raw.hipY - 0.03 * k, pitch: raw.pitch + 0.05 * s,
    glove: addV(raw.glove, v3(0.1 * k, 0.03 * k, -0.03 * k)), blocker: addV(raw.blocker, v3(0.12 * k, -0.02 * k, 0.02 * k)),
    heel: addV(raw.heel, v3(0.06 * k, 0, 0)),
  };
}

/**
 * After a frozen glove save (the engine shows a cover; he has it in his glove): the glove stays at the catch, comes in
 * to his chest, then down to its place in the stance, the puck in it; his body rises out of the glove save into the
 * stance.
 */
function gloveHold(c: Vec3, d: BodyDims, since: number): GoalieRaw {
  const k = scaleOf(d);
  const stance0 = goalieKeyRaw('stance', d, 1), save = placed('glove', c, d, false, stance0), stance = goalieKeyRaw('stance', d, 1);
  const chest = v3(0.36 * k, 1.02 * k, -0.22 * k);
  const toChest = smooth((since - 0.2) / 0.35), down = smooth((since - 0.85) / 0.5);
  const glove = lerpV(lerpV(c, chest, toChest), stance.glove, down);
  const body = mixGoalieRaw(save, stance, smooth((since - 0.2) / 0.6));
  return { ...body, glove, gloveFace: lerpV(save.gloveFace, stance.gloveFace, down), look: body.look + 0.3 * toChest * (1 - down) };
}

/** One reaction applied to `raw` (fully on: its own set and reach factors blend it in). */
function applyPlan(p: ReachPlan, raw: GoalieRaw, sample: GoalieSample, dims: BodyDims): GoalieRaw {
  // The contact in his frame (as it was at the contact, from then on: the part stays where it met the puck as he moves).
  const c = p.kind === 'cover' ? toGoalieRaw(sample, p.c) : p.rc;
  if (p.kind === 'cover') {
    // Down over the loose puck (the engine shows the cover): the glove onto it.
    return { ...raw, glove: lerpV(raw.glove, v3(c.x, 0.12, c.z), p.reach) };
  }
  if (p.kind === 'save' && p.freeze && p.part === 'glove' && p.since > 0) return mixGoalieRaw(raw, gloveHold(c, dims, p.since), p.reach);
  const base = p.set > 0 ? setRaw(raw, dims, p.set) : raw;
  if (p.reach <= 0) return base;
  const save = p.beat < 1 ? placed(p.part, c, dims, false, base) : null;
  if (p.kind !== 'goal' || p.beat <= 0) return mixGoalieRaw(base, save!, p.reach);
  // Beaten: the save he reached for gives way, from a tick before the contact, to being short of it as it goes by and
  // too late after it (beatenRaw).
  const beaten = beatenRaw(p.rc, dims, smooth((p.since - LATE_START) / LATE_TIME));
  return mixGoalieRaw(base, save ? mixGoalieRaw(save, beaten, p.beat) : beaten, p.reach);
}

export const goalieReach: GoalieOverlay<ReachSlot> = {
  id: REACH_ID,
  step(slot, sample, ctx) {
    const s = slot ?? newSlot();
    plan(s, sample, ctx);
    return s;
  },
  // Each reaction blends itself in by its own factors; the overlay is on while either shows.
  // Each reaction blends itself in by its own factors; the overlay is on while either shows, or while he is held facing
  // the shot in dead play (deadFacingOf).
  weight(anim, sample, ctx) {
    const s = goalieSlotOf<ReachSlot>(anim, REACH_ID);
    if (s && ((s.cur.active && s.cur.w > 1e-4) || (s.prev.active && s.prev.w > 1e-4))) return 1;
    const f = deadFacingOf(sample, ctx);
    return f && f.w > 1e-4 ? 1 : 0;
  },
  apply(raw, anim, sample, ctx, dims) {
    const s = goalieSlotOf<ReachSlot>(anim, REACH_ID);
    let out = raw;
    if (s && s.prev.active && s.prev.w > 1e-4) out = applyPlan(s.prev, out, sample, dims);
    if (s && s.cur.active && s.cur.w > 1e-4) out = applyPlan(s.cur, out, sample, dims);
    const f = deadFacingOf(sample, ctx);
    if (f && f.w > 1e-4) {
      const d = f.facing - sample.facing;
      out = { ...out, turn: Math.atan2(Math.sin(d), Math.cos(d)) * f.w };
    }
    return out;
  },
};

/** Head tracking: his head pitched to look at the puck (the engine turns him square to it). */
export const goalieTrack: GoalieOverlay = {
  id: 'goalieTrack',
  weight: (_a, _s, ctx) => (ctx.state.phase === 'live' ? 0.8 : 0),
  apply(raw, _anim, sample, ctx) {
    const p = ctx.puck.engine, h = Math.max(0.6, Math.hypot(p.x - sample.pos.x, p.z - sample.pos.y));
    return { ...raw, look: clamp(Math.atan2(1.35 - p.y, h) - 0.05, -0.3, 0.85) };
  },
};

/**
 * While play is dead after a frozen save or a goal against him, the engine squares him to the puck, which rests on the
 * goal line behind him: he would turn round to face his own net. He is drawn still facing the way he faced the shot
 * (toward where it was let go, as the engine squares him to it in flight) until the faceoff setup, and turns back to the
 * engine's facing over its first FACING_BACK seconds (a ruled exception to drawing the engine's facing, for stopped play
 * only: during play the drawn facing is exactly the engine's). The turn is the figure's `turn` (goalie-rig.ts), set by
 * goalieReach.
 */
export const FACING_BACK = 1.5;

const facingScratch = { w: 0, facing: 0 };
/** The facing he is held at and how much of it shows, or null (play is live, or nothing to hold). */
function deadFacingOf(s: GoalieSample, ctx: AnimContext): { w: number; facing: number } | null {
  const st = ctx.state;
  if (st.phase !== 'stopped' && st.phase !== 'faceoffSetup') return null;
  const tl = ctx.timeline, tick = st.tick;
  // The goal against him or his held save that stopped this play: the latest with no faceoff (nor period end) since,
  // however long the engine's stoppage and setup last.
  const goal = lastSinceDrop(tl, 'goal', tick, s.id, 'other');
  const freeze = lastSinceDrop(tl, 'freeze', tick, s.id);
  const held = freeze && freeze.detail.cause === 'save' ? freeze : undefined;
  const e = goal && (!held || goal.tick >= held.tick) ? goal : held;
  if (!e) return null;
  // Where the shot was let go from.
  const relTick = e.type === 'goal' ? e.detail.releaseTick : tl.last('shot', e.tick, 0, s.id, 'other')?.detail.releaseTick ?? null;
  const shooter = e.type === 'goal' ? e.playerId : tl.last('save', e.tick, 0, s.id)?.otherId ?? null;
  if (relTick === null || !shooter) return null;
  const rel = tl.last('release', relTick, 0, shooter);
  if (!rel) return null;
  const now = ctx.tick + ctx.alpha;
  facingScratch.facing = Math.atan2(rel.pos.y - s.pos.y, rel.pos.x - s.pos.x);
  facingScratch.w = smooth((now - (e.tick - 1)) / 6) * (st.phase === 'faceoffSetup' ? 1 - smooth(st.phaseT / FACING_BACK) : 1);
  return facingScratch;
}

const tmp: Vec3 = { x: 0, y: 0, z: 0 }, tmp2: Vec3 = { x: 0, y: 0, z: 0 }, tmp3: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * One reaction's hold (see goalieHeldPuck) into `out`; `from` is where the puck was had he not had it (the engine's
 * puck, or the previous reaction's hold). False when he does not have it under this reaction.
 */
function heldBy(p: ReachPlan, now: number, sample: GoalieSample, ctx: AnimContext, pose: GoalieFigurePose, from: Vec3, out: Vec3): boolean {
  if (!p.active || !p.hold) return false;
  const T = p.end;
  const turn = pose.turn ?? 0;
  const glove = goalieWorld(sample, pose.glove, tmp, turn);
  // The pocket's open face as the rig draws it (goalie-pose.ts glovePocket), the puck's middle there; on the ice under
  // the glove while it covers the puck (low), in the pocket once it is off the ice.
  const pk = glovePocket(pose, sample.dims), pw = goalieWorld(sample, pk.at, tmp3, turn);
  const lift = smooth((glove.y - 0.15) / 0.5);
  const px = glove.x + (pw.x - glove.x) * lift, pz = glove.z + (pw.z - glove.z) * lift;
  const py = Math.max(0, glove.y + (pw.y - PUCK_HALF - glove.y) * lift - 0.12 * (1 - lift));
  const pocket = (k: number): void => {
    out.x += (px - out.x) * k; out.y += (py - out.y) * k; out.z += (pz - out.z) * k;
  };
  if (p.kind === 'cover') {
    out.x = from.x; out.y = from.y; out.z = from.z;
    pocket(smooth((now - (T - 1)) / 7.5));
    return true;
  }
  // The saving part as drawn: a hand, or for a pad or the butterfly the spot where the puck met it.
  const part = p.part === 'glove' ? v3(px, py, pz) : p.part === 'blocker' ? goalieWorld(sample, pose.blocker, tmp2, turn) : p.c;
  if (now <= p.tc) {
    // On its way to the contact: on its path once it has reached his plane, the plane the part meets it in (the contact
    // plane, or a saving hand drawn out in front of it); until then the engine's.
    pathAt(p.path, now, out);
    if (now >= p.tc) return true;
    const sp = Math.hypot(p.path.vx, p.path.vz);
    if (sp < 1e-6 || (p.part !== 'glove' && p.part !== 'blocker')) return false;
    const ahead = (q: Vec3): number => -((q.x - sample.pos.x) * p.path.vx + (q.z - sample.pos.y) * p.path.vz) / sp;
    return ahead(out) <= ahead(part) + HAND_FACE;
  }
  if (p.freeze) {
    // In the glove at once (it reached the puck), or from the part under the glove as he covers it.
    const at = p.part === 'glove' ? p.c : part;
    out.x = at.x; out.y = at.y; out.z = at.z;
    pocket(p.part === 'glove' ? smooth((now - p.tc) / 2) : smooth((now - p.tc - 3) / 9));
    return true;
  }
  // A rebound: from the part toward the engine's puck (in flight from the save's tick), there by `until`.
  const until = Math.max(T, p.tc + REB_LEAVE), k = smooth((now - p.tc) / (until - p.tc));
  let tx = part.x, ty = part.y, tz = part.z;
  const st = ctx.state;
  if (now >= T) { tx = ctx.puck.engine.x; ty = ctx.puck.engine.y; tz = ctx.puck.engine.z; }
  else if (st.tick === T) { const back = (now - T) * DT; tx = st.puck.pos.x + st.puck.vel.x * back; ty = st.puck.z; tz = st.puck.pos.y + st.puck.vel.y * back; }
  out.x = part.x + (tx - part.x) * k; out.y = part.y + (ty - part.y) * k; out.z = part.z + (tz - part.z) * k;
  return true;
}

const prevHeld: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Where the goalie holds the puck this frame (world: x, z on the ice, y its height), into `out`; false when he does not
 * (the puck is then drawn at the engine's). From the moment a saved shot crosses his plane: on its path until it
 * reaches the part, then on the part; a rebound leaves the part and joins the engine's puck by the save's tick (at the
 * earliest REB_LEAVE ticks after the contact); a frozen glove save keeps it in the glove, any other frozen save or a
 * cover under the glove on the ice (rising with the glove when he stands up), until the engine puts it on the dot.
 * `pose` is his figure as drawn this frame.
 */
export function goalieHeldPuck(anim: GoalieAnim, sample: GoalieSample, ctx: AnimContext, pose: GoalieFigurePose, out: Vec3): boolean {
  const s = goalieSlotOf<ReachSlot>(anim, REACH_ID);
  if (!s) return false;
  const from = ctx.puck.engine;
  const before = heldBy(s.prev, s.now, sample, ctx, pose, from, prevHeld);
  if (heldBy(s.cur, s.now, sample, ctx, pose, before ? prevHeld : from, out)) return true;
  if (!before) return false;
  out.x = prevHeld.x; out.y = prevHeld.y; out.z = prevHeld.z;
  return true;
}

/** The reach's slot on a goalie (for tests and the image script). */
export const reachSlotOf = (anim: GoalieAnim): ReachSlot | undefined => goalieSlotOf<ReachSlot>(anim, REACH_ID);
