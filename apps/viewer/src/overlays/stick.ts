import { DT, type GameEventOf } from '@hockey/engine';
import { slotOf, type AnimContext, type Overlay, type SkaterAnim, type SkaterSample } from '../anim-context';
import { CARRY_ON, heelForPuck, STRIKE_SPOT, type IcePoint } from '../carry';
import type { BodyDims } from '../body';
import { bladeAt, fitBody, mixRaw, type RawPose, type Vec3 } from '../pose-mix';
import type { Timeline } from '../timeline';

/**
 * The stick actions (pure: no three.js, no DOM): passes, shots and dumps by the skater who lets the puck go, and the
 * reception by the man a pass is meant for. Everything is read from the recording: the event log says when each
 * `release` happens (the whole game is recorded before it is shown, so a wind-up can start before its release), its
 * kind, its receiver and the puck's velocity off the stick; the engine state says who has the puck, whether a pass is
 * still on its way and who is down.
 *
 * Timing. The engine lets the puck go during the step that ends on the event's tick T: state T - 1 is the last in
 * which he has it, and in state T the puck is already a tick of flight from his stick. So the blade meets the puck at
 * display time T - 1 (the contact), where the drawn puck leaves the blade (carry.ts stepPuckDraw); the wind-up starts
 * `lead` before T, and the follow-through runs on after the contact, then fades. Every phase is a function of the
 * display time and the event's tick only (not of time accumulated while playing), so a seek's pre-roll shows what play
 * shows. What has to be remembered (when he got the puck, when an opponent was last close, the shot's type once the
 * wind-up has begun) lives in the shared slot of `stickTrack`, rebuilt by the pre-roll, and none of it matters for
 * longer than the pre-roll's 1.5 s.
 *
 * Shot types are cosmetic and come only from recorded facts (see classify): a one-timer when he lets it go within
 * ONE_TIMER_SECONDS of getting the puck; a slapshot when the release speed is in the top quarter of the game's shot
 * speeds and he had SLAP_TIME_SECONDS with the puck and no opponent within PRESSURE_RADIUS before the wind-up began;
 * else a wrist shot. A pass is a forehand sweep, or a backhand when the puck goes off to his stick side. A dump is a
 * flip (chipped up) or a hard-around (hard along the boards), from the release velocity's lift and direction.
 *
 * Poses are in the left-shot body frame (x forward, z to his right, blade on his left): world directions are turned
 * into it with his facing and mirrored for a right shot, so every action mirrors with the rig. While an action shows,
 * the blade is placed with pose-mix bladeAt (the hands are solved back from it, both on the stick). The actions give
 * way while he is down (a contest or a hit has him), and a later action blends over an earlier one.
 */

export type StickStyle = 'wrist' | 'slap' | 'oneTimer' | 'forehand' | 'backhand' | 'flip' | 'around';
type ReleaseKind = 'pass' | 'shot' | 'dump';

/**
 * One release as the slot keeps it: its tick, kind and type, its wind-up (ticks before the event), its velocity, and
 * `aim`, the puck's direction off the stick in his body frame (rad), kept continuous from step to step (unwrapped) so
 * it never flips round as he turns.
 */
export type StickAct = {
  tick: number; kind: ReleaseKind; style: StickStyle; lead: number; vx: number; vy: number; vz: number; aim: number;
  /**
   * How far (0..1) the stick goes to meet the puck where it is drawn rather than sweeping it from where it sits on
   * the blade, because it will not have settled there by the contact (a one-timer, a one-touch pass), and that spot
   * (body frame); both kept from the contact on.
   */
  meet: number; mx: number; mz: number;
};
/** The reception of the pass on its way to him (`tick` of the pass, -1 for none). */
export type Reception = {
  tick: number; from: string;
  /** Display time he got the puck, and when the pass stopped coming to him (NaN: not yet; -Infinity: before a fresh start). */
  gotAt: number; lostAt: number;
  /**
   * The direction (body frame, rad, unwrapped: continuous from step to step) the puck was coming from, and how far the
   * blade had gone out to it.
   */
  dir: number; w: number;
};
/**
 * The stick actions' shared state for one skater (stickTrack's slot; plain data, changed in place each step, made
 * afresh when he starts afresh). `t` is the display time in ticks of the last step. `carrier`, `gotAt` (engine tick he
 * got the puck) and `pressedAt` (last engine tick an opponent was within PRESSURE_RADIUS while he had it) are the
 * facts the shot type needs. `acts` holds the releases around now and `around` which of them are, oldest first: the
 * one before the latest (still fading, if close), the latest at or before the current tick (its follow-through) and
 * the first after it (its wind-up), as indices into `acts` (-1 for none). `give` (0..1) is how far the actions have
 * given way because he is down.
 */
export type StickSlot = {
  t: number; give: number;
  carrier: boolean; gotAt: number; pressedAt: number;
  acts: [StickAct, StickAct, StickAct]; around: [number, number, number];
  recv: Reception;
};

/** The shared slot's id (stickTrack). */
export const STICK_ID = 'stick';

/** A release this soon after he got the puck (s) is a one-timer. */
export const ONE_TIMER_SECONDS = 0.25;
/** A hard shot (top quarter of the game's shot speeds) is a slapshot if he had this long (s) with the puck, unpressured. */
export const SLAP_TIME_SECONDS = 0.5;
/**
 * A slapshot or a one-timer is shot about the way he faces: the puck off within this (rad) of his facing (the engine
 * often lets the puck go well off it; those shots are drawn as wrist shots, which turn his upper body to it).
 */
export const SLAP_FACING = 0.6, ONE_TIMER_FACING = 1.0;
/**
 * How far (rad) a wrist shot (TURN_MAX.shot), a pass or a dump turns his upper body toward where the puck goes (the
 * feet stay); a pass or a dump has less time to turn.
 */
export const TURN_MAX = { shot: 1.4, pass: 0.9, dump: 0.9 } as const;
/** An opponent this close (m, engine positions) pressures him (the engine's pressure is half-way at 3 m). */
export const PRESSURE_RADIUS = 3;
/** Wind-up before the release event (s) by shot type. */
export const SHOT_LEAD = { wrist: 0.4, slap: 0.55, oneTimer: 0.35 } as const;
/** A pass's wind-up (s): PASS_LEAD[0] at PASS_SPEED[0] m/s and slower, PASS_LEAD[1] at PASS_SPEED[1] and faster. */
export const PASS_LEAD = [0.12, 0.3] as const, PASS_SPEED = [13, 22] as const;
/** A dump's wind-up (s). */
export const DUMP_LEAD = { flip: 0.25, around: 0.35 } as const;
/** Seconds to give way when he goes down. */
const GIVE_SECONDS = 0.12;
/** The engine's pick-up reach (m): a pass is taken once it comes this near him. */
const PICKUP_REACH = 0.9;

const LOOK_TICKS = Math.ceil(SHOT_LEAD.slap / DT) + 1;
const FOLLOW_TICKS = 24;
const ONE_TIMER_TICKS = ONE_TIMER_SECONDS / DT, SLAP_TIME_TICKS = SLAP_TIME_SECONDS / DT;
/** A pass older than this (ticks) is no longer on its way. */
const RECV_TICKS = Math.round(4 / DT);

// ---------------------------------------------------------------------------------------------------------------
// Each type's path: the blade's heel at the set, at the back of the wind-up, at the contact and at the end of the
// follow-through (body frame of a left shot), when each comes (ticks), and how the body turns with it.

type StyleDef = {
  /** Where the blade is drawn back to, and when: `beta` of the wind-up before the contact. */
  back: Vec3; beta: number;
  /** The follow-through: the blade `r` from his centre toward the target at height `y`, at `fp` ticks after the contact,
   * held until `fh`, faded out by `fe`; the target direction is clamped to [lo, hi] (rad, body frame). */
  r: number; y: number; fp: number; fh: number; fe: number; lo: number; hi: number;
  /** The puck spot at the contact (heel found by heelForPuck). */
  spot: IcePoint;
  /** Shoulder twist at the back and at the end of the follow-through (per radian of target direction), torso pitch
   * and pelvis height changes at the back and at the follow-through. */
  twistBack: number; twistFollow: number; pitchBack: number; pitchFollow: number; hipBack: number; hipFollow: number;
};
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const STYLES: Record<StickStyle, StyleDef> = {
  wrist: { back: v3(-0.5, 0.03, -0.64), beta: 0.45, r: 1.2, y: 0.55, fp: 4, fh: 8, fe: 24, lo: -1.2, hi: 0.8, spot: STRIKE_SPOT,
    twistBack: -0.35, twistFollow: 0.35, pitchBack: -0.04, pitchFollow: 0.12, hipBack: -0.03, hipFollow: -0.03 },
  slap: { back: v3(-0.75, 1.05, -0.45), beta: 0.35, r: 1.25, y: 0.85, fp: 4, fh: 9, fe: 25, lo: -1.2, hi: 0.8, spot: STRIKE_SPOT,
    twistBack: -0.6, twistFollow: 0.45, pitchBack: -0.15, pitchFollow: 0.18, hipBack: -0.02, hipFollow: -0.06 },
  oneTimer: { back: v3(-0.55, 0.8, -0.55), beta: 0.45, r: 1.2, y: 0.7, fp: 4, fh: 8, fe: 24, lo: -1.2, hi: 0.8, spot: STRIKE_SPOT,
    twistBack: -0.5, twistFollow: 0.4, pitchBack: -0.1, pitchFollow: 0.15, hipBack: -0.02, hipFollow: -0.05 },
  forehand: { back: v3(0.3, 0.0, -0.7), beta: 0.5, r: 1.05, y: 0.08, fp: 5, fh: 6, fe: 22, lo: -1.0, hi: 1.1, spot: { x: 0.7, z: -0.3 },
    twistBack: -0.2, twistFollow: 0.4, pitchBack: 0, pitchFollow: 0.06, hipBack: -0.02, hipFollow: -0.02 },
  backhand: { back: v3(0.55, 0.0, -0.05), beta: 0.5, r: 1.0, y: 0.12, fp: 5, fh: 6, fe: 22, lo: -2.6, hi: -0.8, spot: { x: 0.65, z: -0.15 },
    twistBack: 0.25, twistFollow: 0.3, pitchBack: 0, pitchFollow: 0.06, hipBack: -0.02, hipFollow: -0.02 },
  flip: { back: v3(0.35, 0.0, -0.62), beta: 0.5, r: 1.0, y: 0.75, fp: 5, fh: 6, fe: 22, lo: -1.1, hi: 0.9, spot: { x: 0.7, z: -0.3 },
    twistBack: -0.2, twistFollow: 0.3, pitchBack: 0, pitchFollow: -0.04, hipBack: -0.02, hipFollow: 0 },
  around: { back: v3(-0.3, 0.02, -0.75), beta: 0.45, r: 1.2, y: 0.18, fp: 4, fh: 7, fe: 23, lo: -1.1, hi: 0.9, spot: STRIKE_SPOT,
    twistBack: -0.4, twistFollow: 0.4, pitchBack: -0.03, pitchFollow: 0.12, hipBack: -0.03, hipFollow: -0.04 },
};
/** How a turn toward the puck's way is shared: the shoulders turn this much of it, the hips this much. */
const TURN_TWIST = 1, TURN_YAW = 0.3;
/** About where the top hand is (x, z), for the heel that puts the puck on a spot. */
const TOP: IcePoint = { x: 0.2, z: 0.1 };
/** The receiver's blade: this far out (m) toward the puck coming, the direction clamped to [lo, hi]; then cushioned to CUSHION. */
const RECV_REACH = 0.85, RECV_LO = -1.5, RECV_HI = 0.5, RECV_MID = (RECV_LO + RECV_HI) / 2, CUSHION: IcePoint = { x: 0.5, z: -0.4 };
/** How much a reception shows for a puck coming from `dir` (body frame): all of it within about 85 degrees of his
 * stick side's front, none from more than 120 degrees round (behind him on his other side). */
const recvFacing = (dir: number): number => smooth((Math.cos(dir - RECV_MID) + 0.5) / 0.6);
/** Receiving (ticks): the blade goes out over RECV_RAMP, cushions over RECV_CUSHION after the pick-up, then fades over RECV_FADE (or RECV_LOST once the pass is not his). */
const RECV_RAMP = 5, RECV_CUSHION = 5, RECV_FADE = 8, RECV_LOST = 6;
/** How fast (rad/s) the receiver's blade turns to follow the puck coming. */
const RECV_TURN = 6;
/** A reception shows fully from this share of its amount on (below, its blade is also nearer the skating pose's). */
const RECV_FULL = 0.35;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Heading `a` taken the way round nearest `near` (so a direction followed step by step never jumps by a turn). */
const unwrap = (a: number, near: number): number => near + wrap(a - near);

// ---------------------------------------------------------------------------------------------------------------
// Facts and types

/** The shot speed (m/s, along the ice) from which a shot is in the top quarter of the game's, per timeline. */
const hardShots = new WeakMap<Timeline, number>();
export function hardShotSpeed(tl: Timeline): number {
  let v = hardShots.get(tl);
  if (v !== undefined) return v;
  const speeds: number[] = [];
  for (let t = -1, e = tl.next('release', t, Infinity); e; t = e.tick, e = tl.next('release', t, Infinity)) {
    if (e.detail.kind === 'shot') speeds.push(Math.hypot(e.detail.vel.x, e.detail.vel.y));
  }
  speeds.sort((a, b) => a - b);
  v = speeds.length > 0 ? speeds[Math.floor(speeds.length * 0.75)]! : Infinity;
  hardShots.set(tl, v);
  return v;
}

/** A world direction (engine x, y) as a heading in his body frame (left-shot frame: mirrored for a right shot). */
function bodyHeading(s: SkaterSample, x: number, y: number): number {
  const c = Math.cos(s.facing), n = Math.sin(s.facing);
  return Math.atan2((s.right ? -1 : 1) * (-x * n + y * c), x * c + y * n);
}

/**
 * The type of a release, fixed when the slot first sees it (normally LOOK_TICKS before it, before any wind-up), from
 * the release and what the slot knows then. A shot: a one-timer if he gets the puck within ONE_TIMER_SECONDS of the
 * release (when he has not got it yet, from where the pass on its way to him is and how fast it comes); a slapshot if
 * it is hard (hardShotSpeed) and he had SLAP_TIME_SECONDS with it, unpressured, before the wind-up; a wrist shot
 * otherwise. A pass: a backhand when it goes off more than 50 degrees to his stick side, else a forehand. A dump: a
 * hard-around when it leaves flat (lift under 1 m/s) or runs along the boards (within 25 degrees of them, from within
 * 6 m of them), else a flip.
 */
function classify(act: StickAct, e: GameEventOf<'release'>, s: SkaterSample, ctx: AnimContext, slot: StickSlot): void {
  const v = e.detail.vel, speed = Math.hypot(v.x, v.y);
  act.tick = e.tick; act.kind = e.detail.kind; act.vx = v.x; act.vy = v.y; act.vz = v.z;
  const heading = bodyHeading(s, v.x, v.y);
  if (act.kind === 'shot') {
    // When he got the puck, or (if he has not yet) will get it.
    const got = receivedAt(slot, s, ctx);
    const quiet = act.tick - Math.max(got, slot.carrier ? slot.pressedAt : -Infinity), facing = Math.abs(heading);
    act.style = act.tick - got <= ONE_TIMER_TICKS && facing <= ONE_TIMER_FACING ? 'oneTimer'
      : speed >= hardShotSpeed(ctx.timeline) && quiet >= SHOT_LEAD.slap / DT + SLAP_TIME_TICKS && facing <= SLAP_FACING ? 'slap' : 'wrist';
    act.lead = SHOT_LEAD[act.style as 'wrist' | 'slap' | 'oneTimer'] / DT;
  } else if (act.kind === 'pass') {
    act.style = heading < -0.9 ? 'backhand' : 'forehand';
    act.lead = (PASS_LEAD[0] + (PASS_LEAD[1] - PASS_LEAD[0]) * clamp01((speed - PASS_SPEED[0]) / (PASS_SPEED[1] - PASS_SPEED[0]))) / DT;
  } else {
    const y = e.pos.y, boards = ctx.rink.halfWidth;
    const along = Math.abs(v.y) < Math.sin(25 * Math.PI / 180) * speed && Math.abs(y) > boards - 6;
    act.style = v.z < 1 || along ? 'around' : 'flip';
    act.lead = DUMP_LEAD[act.style as 'flip' | 'around'] / DT;
  }
  const def = STYLES[act.style];
  act.aim = unwrap(heading, (def.lo + def.hi) / 2);
}

const newAct = (): StickAct => ({ tick: -1, kind: 'pass', style: 'forehand', lead: 0, vx: 0, vy: 0, vz: 0, aim: 0, meet: 0, mx: 0, mz: 0 });
function newSlot(): StickSlot {
  return {
    t: 0, give: 0, carrier: false, gotAt: -Infinity, pressedAt: -Infinity, acts: [newAct(), newAct(), newAct()], around: [-1, -1, -1],
    recv: { tick: -1, from: '', gotAt: NaN, lostAt: NaN, dir: 0, w: 0 },
  };
}

/** The index in slot.acts holding release `e`, or -1. */
function actIndex(slot: StickSlot, e: GameEventOf<'release'> | undefined): number {
  if (!e) return -1;
  for (let i = 0; i < 3; i++) if (slot.acts[i]!.tick === e.tick) return i;
  return -1;
}
/** Put release `e` (classified now, as first seen) in a record of slot.acts that is neither `a` nor `b`. */
function newActFor(slot: StickSlot, e: GameEventOf<'release'>, a: number, b: number, s: SkaterSample, ctx: AnimContext): number {
  const i = a !== 0 && b !== 0 ? 0 : a !== 1 && b !== 1 ? 1 : 2;
  classify(slot.acts[i]!, e, s, ctx, slot);
  return i;
}

/**
 * The tracker every stick action reads (register it before them): each step it notes whether he has the puck and
 * since when, whether he is pressured, how far he has given way for being down, which releases of his are around now,
 * and the pass on its way to him. It shows nothing itself.
 */
export const stickTrack: Overlay<StickSlot> = {
  id: STICK_ID,
  step(slot, s, ctx, dt) {
    const fresh = slot === undefined;
    const sl = slot ?? newSlot();
    const st = ctx.state, k = st.tick, me = s.id;
    const carrier = st.carrierId === me;
    if (carrier && !sl.carrier) sl.gotAt = fresh ? -Infinity : k;
    sl.carrier = carrier;
    if (carrier) {
      const p = s.state.pos;
      for (const o of st.skaters) {
        if (o.onIce && o.side !== s.side && Math.hypot(o.pos.x - p.x, o.pos.y - p.y) < PRESSURE_RADIUS) { sl.pressedAt = k; break; }
      }
    }
    const down = s.state.downT > 0 || s.down ? 1 : 0;
    sl.give = fresh ? down : clamp01(sl.give + Math.sign(down - sl.give) * Math.max(0, dt) / GIVE_SECONDS);
    if (Math.abs(sl.give - down) < 1e-9) sl.give = down;
    const t = ctx.tick + ctx.alpha;
    sl.t = t;
    // The releases around now: the latest at or before this tick (its follow-through), the one before it (if it may
    // still be fading) and the first after it (its wind-up).
    const tl = ctx.timeline;
    const after = tl.next('release', ctx.tick, LOOK_TICKS, me), before = tl.last('release', ctx.tick, FOLLOW_TICKS, me);
    const older = before ? tl.last('release', before.tick - 1, FOLLOW_TICKS - (ctx.tick - before.tick), me) : undefined;
    let io = actIndex(sl, older), ia = actIndex(sl, before), ib = actIndex(sl, after);
    if (older && io < 0) io = newActFor(sl, older, ia, ib, s, ctx);
    if (before && ia < 0) ia = newActFor(sl, before, io, ib, s, ctx);
    if (after && ib < 0) ib = newActFor(sl, after, io, ia, s, ctx);
    const ar = sl.around;
    ar[0] = io; ar[1] = ia; ar[2] = ib;
    // Until the contact the action follows the puck's way round as he turns, and the stick goes to meet a puck that
    // has not settled on the blade; from the contact, the follow-through stays where it went in his frame (the stick
    // turns with him).
    for (let j = 0; j < 3; j++) {
      const i = ar[j]!;
      if (i < 0) continue;
      const a = sl.acts[i]!;
      if (ctx.state.tick >= a.tick || t > a.tick - 1) continue; // from the contact (the engine has let it go) on, kept
      a.aim = unwrap(bodyHeading(s, a.vx, a.vy), a.aim);
      a.meet = 1 - smooth((a.tick - 1 - receivedAt(sl, s, ctx)) / SETTLE_TICKS);
      if (a.meet > 0) meetSpot(a, s, ctx);
    }
    trackReception(sl, s, ctx, t, fresh, dt);
    return sl;
  },
  weight: () => 0,
  apply: (raw) => raw,
};

/** Follow the pass on its way to him: coming, taken (and when), or gone elsewhere (and when). */
function trackReception(sl: StickSlot, s: SkaterSample, ctx: AnimContext, t: number, fresh: boolean, dt: number): void {
  const r = sl.recv, st = ctx.state;
  const pass = ctx.timeline.last('pass', ctx.tick, RECV_TICKS, s.id, 'other');
  if (!pass || pass.detail.kind !== 'pass') { r.tick = -1; return; }
  if (r.tick !== pass.tick) { r.tick = pass.tick; r.from = pass.playerId ?? ''; r.gotAt = NaN; r.lostAt = NaN; r.w = 0; r.dir = RECV_MID; }
  if (!Number.isNaN(r.gotAt) || !Number.isNaN(r.lostAt)) return;
  if (sl.carrier && sl.gotAt >= pass.tick) { r.gotAt = fresh ? -Infinity : t; return; }
  const pp = st.pendingPass, p = ctx.puck.engine, me = s.pos;
  const dx = me.x - p.x, dz = me.y - p.z, d = Math.hypot(dx, dz);
  const closing = st.puck.vel.x * dx + st.puck.vel.y * dz > 0 || d < 1.2;
  if (pp && pp.toId === s.id && pp.fromId === r.from && st.carrierId === null && closing) {
    // The blade follows the puck round (no faster than RECV_TURN), so a puck coming close past him does not whip it.
    const to = unwrap(bodyHeading(s, -dx, -dz), r.dir);
    r.dir = r.w === 0 ? to : r.dir + clamp(to - r.dir, -RECV_TURN * Math.max(0, dt), RECV_TURN * Math.max(0, dt));
    r.w = Math.max(1e-9, smooth((t - pass.tick) / RECV_RAMP));
  } else r.lostAt = fresh ? -Infinity : t;
}

// ---------------------------------------------------------------------------------------------------------------
// The actions' timing and poses

/**
 * How much of an action shows at display time `t` (ticks): eased in over the first part of the draw-back (while the
 * blade is still near where the skating pose has it), held, and after the follow-through, once the blade has gone back
 * to where the skating pose has it (actPose), faded out.
 */
function actWeight(a: StickAct, t: number): number {
  const def = STYLES[a.style], c = a.tick - 1, d = Math.max(1, a.lead - 1), u = t - c;
  if (u < -d || u > def.fe) return 0;
  if (u < 0) return smooth((u + d) / (RAMP * (1 - def.beta) * d));
  const fm = fadeMid(def);
  return u <= fm ? 1 : 1 - smooth((u - fm) / (def.fe - fm));
}
/** An action shows fully from this amount on (see releaseOverlay's weight). */
const ACT_FULL = 0.35;
/** Ticks over which a follow-through gives way once he has the puck again. */
const REGAIN_TICKS = 12;
/** The share of the draw-back over which an action eases in. */
const RAMP = 0.3;
/** When (ticks after the contact) the blade is back where the skating pose has it, and the fade starts. */
const fadeMid = (def: StyleDef): number => def.fh + 0.6 * (def.fe - def.fh);

const scratch = { k0: v3(0, 0, 0), k1: v3(0, 0, 0), k2: v3(0, 0, 0), k3: v3(0, 0, 0), m: v3(0, 0, 0), out: v3(0, 0, 0) };

/** Cubic Hermite from p0 (tangent m0) to p1 (tangent m1) over `h` ticks, at fraction `s`, into `o`. */
function hermite(o: Vec3, p0: Vec3, m0: Vec3 | null, p1: Vec3, m1: Vec3 | null, h: number, s: number): void {
  const s2 = s * s, s3 = s2 * s;
  const a = 2 * s3 - 3 * s2 + 1, b = s3 - 2 * s2 + s, c = -2 * s3 + 3 * s2, e = s3 - s2;
  o.x = a * p0.x + c * p1.x + h * (b * (m0?.x ?? 0) + e * (m1?.x ?? 0));
  o.y = a * p0.y + c * p1.y + h * (b * (m0?.y ?? 0) + e * (m1?.y ?? 0));
  o.z = a * p0.z + c * p1.z + h * (b * (m0?.z ?? 0) + e * (m1?.z ?? 0));
}

/** Piecewise smooth: `a` before -d, to `b` at -beta d, back to 0 at the contact, to `f` at fp; held after. */
function curve(u: number, d: number, beta: number, fp: number, a: number, b: number, f: number): number {
  if (u <= -d) return a;
  if (u < -beta * d) return a + (b - a) * smooth((u + d) / ((1 - beta) * d));
  if (u < 0) return b * (1 - smooth((u + beta * d) / (beta * d)));
  return f * smooth(u / fp);
}

/** The stick meets the puck where it is drawn (body frame), within this (m) of where the action would strike it. */
const MEET_REACH = 0.9;
/** Ticks for a puck picked up to settle on the blade (carry.ts CARRY_ON, 0.15 s). */
const SETTLE_TICKS = Math.ceil(CARRY_ON / DT);

/**
 * The engine tick he got (or, before he has it, will get) the puck: when the pass on its way to him reaches him, from
 * its distance and speed, else at the next tick.
 */
function receivedAt(sl: StickSlot, s: SkaterSample, ctx: AnimContext): number {
  if (sl.carrier) return sl.gotAt;
  const st = ctx.state, pp = st.pendingPass, p = st.puck;
  if (pp && pp.toId === s.id && st.carrierId === null) {
    const d = Math.hypot(p.pos.x - s.state.pos.x, p.pos.y - s.state.pos.y) - PICKUP_REACH;
    return st.tick + Math.max(0, d) / Math.max(1, Math.hypot(p.vel.x, p.vel.y)) / DT;
  }
  return st.tick + 1;
}

/** How far (rad) action `a` turns his upper body toward the puck's way (none for a slapshot or a one-timer). */
function turnOf(a: StickAct): number {
  const def = STYLES[a.style];
  return a.style === 'slap' || a.style === 'oneTimer' ? 0 : clamp(a.aim - (def.lo + def.hi) / 2, -TURN_MAX[a.kind], TURN_MAX[a.kind]);
}

/** Where the stick meets the puck for action `a`: the drawn puck in his body frame, near the action's strike spot. */
function meetSpot(a: StickAct, s: SkaterSample, ctx: AnimContext): void {
  const def = STYLES[a.style], sx = def.spot.x, sz = def.spot.z;
  const px = ctx.puck.drawn.x - s.pos.x, pz = ctx.puck.drawn.z - s.pos.y, f = s.facing;
  const bx = px * Math.cos(f) + pz * Math.sin(f), bz = (s.right ? -1 : 1) * (-px * Math.sin(f) + pz * Math.cos(f));
  const ox = bx - sx, oz = bz - sz, l = Math.hypot(ox, oz), q = l > MEET_REACH ? MEET_REACH / l : 1;
  a.mx = sx + fin(ox * q); a.mz = sz + fin(oz * q);
}

/**
 * The raw pose with action `a` fully on at display time `t`: the blade from where the skating pose (`raw`, fitted)
 * has it, back, through the contact and out on the follow-through, then back to where the skating pose has it.
 */
function actPose(raw: RawPose, a: StickAct, t: number, s: SkaterSample, ctx: AnimContext, dims: BodyDims, amount: number): RawPose {
  const def = STYLES[a.style], c = a.tick - 1, d = Math.max(1, a.lead - 1), u = t - c;
  // The action is turned toward where the puck goes, as far as his upper body turns (not for a slapshot or a
  // one-timer, shot the way he faces), and aimed within its own range from there.
  const turn = turnOf(a);
  const aim = turn + clamp(a.aim - turn, def.lo, def.hi);
  const ct = Math.cos(turn), st = Math.sin(turn);
  const { k0, k1, k2, k3, m, out } = scratch;
  const plain = fitBody(raw, dims).blade;
  k0.x = plain.x; k0.y = plain.y; k0.z = plain.z;
  k1.x = def.back.x * ct - def.back.z * st; k1.y = def.back.y; k1.z = def.back.x * st + def.back.z * ct;
  {
    // Where it strikes the puck: in front of him, near where the engine lets the puck go (straight ahead of him,
    // whichever way it goes), so the puck's flight from the blade starts near the engine's; or, as far as the puck will
    // not have settled on the blade by then (a one-timer, a one-touch pass), where the puck is drawn: the stick meets it.
    const heel = heelForPuck(def.spot, TOP);
    k2.x = heel.x; k2.y = 0; k2.z = heel.z;
    if (a.meet > 0) {
      const mh = heelForPuck({ x: a.mx, z: a.mz }, TOP);
      k2.x += (mh.x - k2.x) * a.meet; k2.z += (mh.z - k2.z) * a.meet;
    }
  }
  k3.x = def.r * Math.cos(aim); k3.y = def.y; k3.z = def.r * Math.sin(aim);
  // Through the contact at speed: its tangent runs from the back of the wind-up to the end of the follow-through.
  const h = def.beta * d, span = def.fp + h;
  m.x = (k3.x - k1.x) / span; m.y = (k3.y - k1.y) / span; m.z = (k3.z - k1.z) / span;
  if (u <= -d) { out.x = k0.x; out.y = k0.y; out.z = k0.z; }
  else if (u < -h) hermite(out, k0, null, k1, null, d - h, (u + d) / (d - h));
  else if (u < 0) hermite(out, k1, null, k2, m, h, (u + h) / h);
  else if (u < def.fp) hermite(out, k2, m, k3, null, def.fp, u / def.fp);
  else {
    // Held, then back to where the skating pose has the blade.
    const back = u <= def.fh ? 0 : smooth((u - def.fh) / (fadeMid(def) - def.fh));
    out.x = k3.x + (k0.x - k3.x) * back; out.y = k3.y + (k0.y - k3.y) * back; out.z = k3.z + (k0.z - k3.z) * back;
  }
  // Only `amount` of it (it is giving way: he is down, or has the puck again): the blade that much of the way from
  // where skating has it, and the body that much turned.
  const keep = (u <= def.fh ? 1 : 1 - smooth((u - def.fh) / (fadeMid(def) - def.fh))) * amount;
  if (amount < 1) { out.x = k0.x + (out.x - k0.x) * amount; out.y = k0.y + (out.y - k0.y) * amount; out.z = k0.z + (out.z - k0.z) * amount; }
  const r = bladeAt(raw, out);
  // His free hand comes onto the stick as he draws it back.
  r.twoHands = raw.twoHands + (1 - raw.twoHands) * keep * smooth((u + d) / ((1 - def.beta) * d));
  r.twist = raw.twist + keep * (TURN_TWIST * turn * smooth((u + d) / ((1 - def.beta) * d)) + curve(u, d, def.beta, def.fp, 0, def.twistBack, clamp(def.twistFollow * (aim - turn), -0.5, 0.5)));
  r.yaw = raw.yaw + keep * TURN_YAW * turn * smooth((u + d) / ((1 - def.beta) * d));
  r.pitch = raw.pitch + keep * curve(u, d, def.beta, def.fp, 0, def.pitchBack, def.pitchFollow);
  r.hipY = raw.hipY + keep * curve(u, d, def.beta, def.fp, 0, def.hipBack, def.hipFollow);
  r.look = raw.look + keep * (clamp(aim - r.twist, -1, 1) - raw.look);
  return r;
}

/** How much release `j` of the slot's `around` (0 older, 1 latest, 2 next) shows, if it is of `kind` (0 if not). */
function aroundAmount(sl: StickSlot, j: number, kind: ReleaseKind): number {
  const i = sl.around[j]!;
  if (i < 0) return 0;
  const a = sl.acts[i]!;
  if (a.kind !== kind) return 0;
  // He has the puck again after letting it go (a rebound, a pass back): the follow-through gives way to carrying it.
  const regain = sl.carrier && sl.gotAt > a.tick ? 1 - smooth((sl.t - (sl.gotAt - 1)) / REGAIN_TICKS) : 1;
  return actWeight(a, sl.t) * regain * (1 - sl.give);
}

function releaseOverlay(id: string, kind: ReleaseKind): Overlay<never> {
  return {
    id,
    // Shown fully once it is a little way on (ACT_FULL); below that its blade is also nearer where skating has it
    // (actPose), so mixing a far-off blade target in by a small weight never swings the stick round.
    weight(anim) {
      const sl = slotOf<StickSlot>(anim, STICK_ID);
      if (!sl) return 0;
      return smooth(Math.max(aroundAmount(sl, 0, kind), aroundAmount(sl, 1, kind), aroundAmount(sl, 2, kind)) / ACT_FULL);
    },
    apply(raw, anim, s, ctx, dims) {
      const sl = slotOf<StickSlot>(anim, STICK_ID);
      if (!sl) return raw;
      // His releases of this kind that show, oldest first, each mixed over the earlier ones by its share of their
      // weights (a later one takes over as it eases in, an earlier one fades under it).
      let out: RawPose | null = null, sum = 0;
      for (let j = 0; j < 3; j++) {
        const w = aroundAmount(sl, j, kind);
        if (!(w > 0)) continue;
        const p = actPose(raw, sl.acts[sl.around[j]!]!, sl.t, s, ctx, dims, w);
        sum += w;
        out = out ? mixRaw(out, p, w / sum) : p;
      }
      return out ?? raw;
    },
  };
}

/** The passer: the blade drawn back on the forehand (or across for a backhand), swept through, following through at him. */
export const passOverlay = releaseOverlay('pass', 'pass');
/** The shooter: a wrist shot, a slapshot or a one-timer, following through at the net. */
export const shotOverlay = releaseOverlay('shot', 'shot');
/** The dump: a flip (chipped up) or a hard-around. */
export const dumpOverlay = releaseOverlay('dump', 'dump');

/** How far the reception is on at display time `t` (0..1). */
function recvAmount(sl: StickSlot): number {
  const r = sl.recv, t = sl.t;
  if (r.tick < 0) return 0;
  let w: number;
  if (!Number.isNaN(r.gotAt)) w = r.w * (1 - smooth((t - r.gotAt - RECV_CUSHION) / RECV_FADE));
  else if (!Number.isNaN(r.lostAt)) w = r.w * (1 - smooth((t - r.lostAt) / RECV_LOST));
  else w = r.w;
  return fin(w) * recvFacing(r.dir) * (1 - sl.give);
}

/**
 * The receiver: while the pass is on its way to him he puts his blade out toward the puck coming (both hands on the
 * stick); when he takes it he gives with it (the blade comes back toward him) and goes back to skating; if the pass is
 * picked off, missed or runs past him, it fades.
 */
export const receiveOverlay: Overlay<never> = {
  id: 'receive',
  // Shown fully once it is a little way on; until then (and as it goes) the blade is also nearer where skating has it.
  weight(anim) {
    const sl = slotOf<StickSlot>(anim, STICK_ID);
    return sl ? smooth(recvAmount(sl) / RECV_FULL) : 0;
  },
  apply(raw, anim, _s, _ctx, dims) {
    const sl = slotOf<StickSlot>(anim, STICK_ID);
    if (!sl || sl.recv.tick < 0) return raw;
    const r = sl.recv, a = recvAmount(sl);
    const out = scratch.out, plain = fitBody(raw, dims).blade;
    const c = Number.isNaN(r.gotAt) ? 0 : smooth((sl.t - r.gotAt) / RECV_CUSHION);
    const dir = clamp(r.dir, RECV_LO, RECV_HI), sx = RECV_REACH * Math.cos(dir), sz = RECV_REACH * Math.sin(dir);
    const heel = heelForPuck({ x: sx + (CUSHION.x - sx) * c, z: sz + (CUSHION.z - sz) * c }, TOP);
    out.x = plain.x + (heel.x - plain.x) * a; out.y = plain.y * (1 - a); out.z = plain.z + (heel.z - plain.z) * a;
    const p = bladeAt(raw, out);
    p.twoHands = raw.twoHands + (1 - raw.twoHands) * a;
    p.look = raw.look + (clamp(dir * 0.7, -1, 1) - raw.look) * a;
    return p;
  },
};

/** Every stick overlay, in the order to register them (the tracker first; an action blends over a reception). */
export const STICK_OVERLAYS: readonly Overlay[] = [stickTrack as Overlay, receiveOverlay as Overlay, passOverlay as Overlay, dumpOverlay as Overlay, shotOverlay as Overlay];

/** The stick actions' shared state for a skater (tests and the shot measurements). */
export const stickSlotOf = (anim: SkaterAnim): StickSlot | undefined => slotOf<StickSlot>(anim, STICK_ID);

/** For tests: the total weight the stick overlays show for a skater (each counted once, at most 1 each). */
export function stickWeight(anim: SkaterAnim, s: SkaterSample, ctx: AnimContext): number {
  let w = 0;
  for (const ov of STICK_OVERLAYS) w += Math.min(1, ov.weight(anim, s, ctx));
  return w;
}
