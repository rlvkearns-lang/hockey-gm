import type { BodyDims } from './body';

/**
 * Pose layers and the body fit (pure: no three.js, no DOM). A pose is built in two steps: first a RAW pose (where the
 * pelvis, torso, head, feet, hands and stick want to be, before any limb is solved), which the gait's key poses
 * produce and which overlays (actions, contest stances; animator.ts) may modify and mix; then fitBody solves it onto
 * the body once: the lowest skate on the ice, the hips low enough for the planted legs, the hands within reach and
 * the stick from the top hand to the ice.
 *
 * Body frame: x forward (the way he faces), y up, z to his right; the origin is on the ice directly under his pelvis.
 * Angles in radians. Every yaw (footYaw, Pose.yaw, stickAngle, a travel direction) is measured in the ice plane from
 * +x toward +z, so heading h points along (cos h, 0, sin h). Roll is positive leaning toward +z, pitch positive leaning
 * forward (toward +x). Index 0 of legs and arms is his left side (z < 0), index 1 his right. Poses are those of a left
 * shot (stick blade to his left): mirror z for a right shot (rig.ts mirrorPose).
 */

export type Vec3 = { x: number; y: number; z: number };

/**
 * `foot` is the point where the blade meets the ice (y = 0 when on the ice); the ankle is `skate` straight above it.
 * `footYaw` is the skate's heading relative to his facing.
 */
export type LegPose = { foot: Vec3; footYaw: number; lifted: boolean };
export type ArmPose = { hand: Vec3 };
/**
 * `hipY` is the pelvis (hip joint line) height. `yaw` turns the pelvis and hip sockets (a hockey stop turns the hips);
 * `pitch` then `roll` tilt the torso above the pelvis (see torsoRotate); the torso does not take the pelvis yaw.
 * The stick is held at its butt by the top hand, arms[1] (a left shot; mirror z for a right shot): from that hand the
 * shaft runs at heading `stickAngle` and descends so its end, `stick` metres away, reaches the ice: direction
 * (cos h cos t, -sin t, sin h cos t) with sin t = min(1, hand.y / stick). arms[0] is on the shaft when both hands hold
 * the stick, or swinging free.
 */
export type Pose = {
  hipY: number; pitch: number; roll: number; yaw: number; legs: [LegPose, LegPose]; arms: [ArmPose, ArmPose]; stickAngle: number;
  /** Shoulders turned about the torso's long axis (heading convention), applied before pitch and roll; 0 if absent. */
  twist?: number;
  /** Head turned (heading convention) from the torso toward where he looks; 0 if absent. */
  look?: number;
  /** Head pitched down from its usual eyes-up carriage toward the ice ahead (rad, positive down); 0 if absent. */
  lookDown?: number;
  /**
   * The heel of the stick blade (body frame), where the shaft ends: on the ice (y = 0) unless he carries the stick
   * with the blade up. The shaft runs from the top hand straight to it, so a rig should aim the shaft at this point
   * rather than assume the heel reaches the ice. poseOf always sets it; mirror its z for a right shot.
   */
  blade?: Vec3;
  /**
   * How far down the shaft from the butt the top hand holds it (m); 0 if absent. The shaft then runs from the hand
   * `stick - grip` to the heel, with the butt `grip` back up the shaft behind the hand.
   */
  grip?: number;
};

/** A fitted pose (poseOf, fitBody): always says where the blade is and how far the head is down. */
export type SkaterPose = Pose & { blade: Vec3; lookDown: number };

export type RawLeg = { foot: Vec3; footYaw: number };
/**
 * A pose before it is fitted to the body. The top (stick) hand is placed from the pelvis centre (it rides at the hip
 * on the side away from the blade); the free hand, when it swings, from its own shoulder. `blade` is where on the ice
 * the stick should point (body frame, from the pelvis): the fit aims the shaft from the top hand toward it.
 */
export type RawPose = {
  /** Pelvis height, torso pitch (forward), roll (toward +z), pelvis yaw, shoulder twist and head turn. */
  hipY: number; pitch: number; roll: number; yaw: number; twist: number; look: number;
  /** Each foot (where its blade meets the ice) and its yaw. */
  legs: [RawLeg, RawLeg];
  /** Top (stick) hand, arms[1], from the pelvis centre; free hand, arms[0], from the left shoulder. */
  top: Vec3; freeRel: Vec3;
  /** 1: the left hand is on the shaft; 0: it swings free at freeRel. */
  twoHands: number;
  /** Where the stick points on the ice (x, z from the pelvis; y unused). */
  blade: Vec3;
  /** Head pitched down toward the ice (Pose.lookDown); 0 if absent. */
  lookDown?: number;
  /** Height of the blade heel off the ice (m); 0 if absent (the shaft reaches the ice). */
  bladeUp?: number;
  /**
   * Put the blade heel exactly here (body frame, y its height above the ice; set by bladeAt): the fit then solves the
   * top hand back from it, within his reach, instead of placing the hand at `top` and aiming the stick at `blade`.
   * `bladeAtW` (0..1, 1 if absent) is how far the hand goes over to that solve, so mixing toward and away from a raw
   * pose with a target eases the hand rather than snapping it.
   */
  bladeAt?: Vec3;
  bladeAtW?: number;
};

/** Height (m) over which a lifting skate stops holding the pelvis down (GAIT.liftFade). */
export const LIFT_FADE = 0.06;
/** Share of the stick between its butt and the top hand. */
const STICK_GRIP = 0.14;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

export const armReach = (d: BodyDims): number => d.upperArm + d.forearm;

/**
 * Rotate a torso-frame vector by the torso's twist (about its own long axis, heading convention), then pitch, then
 * roll: Rx(roll) * Rz(-pitch) * Ry(-twist).
 */
export function torsoRotate(v: Vec3, pitch: number, roll: number, twist = 0): Vec3 {
  const ct = Math.cos(twist), st = Math.sin(twist);
  const tx = v.x * ct - v.z * st, tz = v.x * st + v.z * ct;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const x = tx * cp + v.y * sp, y = -tx * sp + v.y * cp, z = tz;
  return v3(x, y * cr - z * sr, y * sr + z * cr);
}

/** Hip joint (side 0 left, 1 right) in the body frame: on the pelvis line at hipY, turned by the pelvis yaw. */
export function hipJoint(p: Pick<Pose, 'hipY' | 'yaw'>, side: 0 | 1, d: BodyDims): Vec3 {
  const w = ((side === 0 ? -1 : 1) * d.hipWidth) / 2;
  return v3(-w * Math.sin(p.yaw), p.hipY, w * Math.cos(p.yaw));
}

/** Shoulder joint (side 0 left, 1 right): torso up from the pelvis centre, twisted, then tilted by pitch then roll. */
export function shoulderJoint(p: Pick<Pose, 'hipY' | 'pitch' | 'roll'> & { twist?: number }, side: 0 | 1, d: BodyDims): Vec3 {
  const w = ((side === 0 ? -1 : 1) * d.shoulderWidth) / 2;
  return add(v3(0, p.hipY, 0), torsoRotate(v3(0, d.torso, w), p.pitch, p.roll, p.twist ?? 0));
}

/**
 * Weighted mix of raw poses (weights sum to 1), as the gait blends its styles. Every style's yaws are continuous and
 * stay inside (-PI, PI), so they mix as plain numbers (a short-way-round blend would be ambiguous between skate
 * headings far apart). A blade target (bladeAt) is mixed in by its weight.
 */
export function mixRawParts(parts: readonly { raw: RawPose; w: number }[]): RawPose {
  const sum = (f: (r: RawPose) => number): number => parts.reduce((t, p) => t + f(p.raw) * p.w, 0);
  const sum3 = (f: (r: RawPose) => Vec3): Vec3 => v3(sum((r) => f(r).x), sum((r) => f(r).y), sum((r) => f(r).z));
  const leg = (i: 0 | 1): RawLeg => ({ foot: sum3((r) => r.legs[i].foot), footYaw: sum((r) => r.legs[i].footYaw) });
  const out: RawPose = {
    hipY: sum((r) => r.hipY), pitch: sum((r) => r.pitch), roll: sum((r) => r.roll), yaw: sum((r) => r.yaw),
    twist: sum((r) => r.twist), look: sum((r) => r.look), lookDown: sum((r) => r.lookDown ?? 0),
    legs: [leg(0), leg(1)],
    top: sum3((r) => r.top), freeRel: sum3((r) => r.freeRel), twoHands: sum((r) => r.twoHands),
    blade: sum3((r) => r.blade), bladeUp: sum((r) => r.bladeUp ?? 0),
  };
  // Blade targets: their own weighted mean, and the share of the mix that has one.
  let tw = 0;
  for (const p of parts) if (p.raw.bladeAt) tw += p.w * clamp01(fin(p.raw.bladeAtW ?? 1));
  if (tw > 0) {
    const at = v3(0, 0, 0);
    for (const p of parts) {
      if (!p.raw.bladeAt) continue;
      const k = (p.w * clamp01(fin(p.raw.bladeAtW ?? 1))) / tw;
      at.x += p.raw.bladeAt.x * k; at.y += p.raw.bladeAt.y * k; at.z += p.raw.bladeAt.z * k;
    }
    out.bladeAt = at;
    out.bladeAtW = Math.min(1, tw);
  }
  return out;
}

/** `a` and `b` mixed: `a` itself at w <= 0, `b` itself at w >= 1, continuous between. */
export function mixRaw(a: RawPose, b: RawPose, w: number): RawPose {
  const k = fin(w);
  if (k <= 0) return a;
  if (k >= 1) return b;
  return mixRawParts([{ raw: a, w: 1 - k }, { raw: b, w: k }]);
}

/**
 * `raw` with its blade heel put at `target` (body frame, y its height above the ice, clamped to the ice): the fit then
 * solves the top hand back from the blade, within his reach, and aims the stick at it. The target may be above his
 * hands (a back-swing, a high finish): the shaft then rises from the top hand to it. Set `raw.top` too (from the
 * pelvis) to say where the top hand should go when there is a choice (in front of his chest for a stick raised
 * behind him, so the shaft passes outside his shoulder). Out of reach, the blade is put
 * as near the target as his arm and stick allow (the arm reaching straight toward it).
 */
export function bladeAt(raw: RawPose, target: Vec3, _dims?: BodyDims): RawPose {
  const t = v3(fin(target.x), Math.max(0, fin(target.y)), fin(target.z));
  return { ...raw, blade: v3(t.x, 0, t.z), bladeUp: t.y, bladeAt: t, bladeAtW: 1 };
}

/** Pull `p` to within `r` of `c`. */
const within = (p: Vec3, c: Vec3, r: number): Vec3 => { const v = sub(p, c), l = len(v); return l > r ? add(c, mul(v, r / l)) : p; };

/**
 * The top hand for a blade heel at `t` with `below` metres of shaft between them: on the sphere of that radius round
 * `t`, within `reach` of the shoulder `sh`, as near the hand `want` as that allows. With no such point, the hand is at
 * full reach straight toward the blade (or away from it, if the blade is too near the shoulder).
 */
function handForBlade(t: Vec3, below: number, sh: Vec3, reach: number, want: Vec3): Vec3 {
  const toWant = sub(want, t), lw = len(toWant);
  const onSphere = lw > 1e-9 ? add(t, mul(toWant, below / lw)) : add(t, v3(0, below, 0));
  if (len(sub(onSphere, sh)) <= reach) return onSphere;
  const axis = sub(sh, t), D = len(axis);
  if (D < 1e-9) return onSphere;
  const u = mul(axis, 1 / D);
  if (D >= below + reach) return add(sh, mul(u, -reach)); // too far: reach straight at it
  if (below >= D + reach) return add(sh, mul(u, reach)); // too near: as far from it as the arm goes
  // The circle where the two spheres meet; the hand goes to its point nearest the wanted one.
  const a = (D * D + below * below - reach * reach) / (2 * D);
  const rho = Math.sqrt(Math.max(0, below * below - a * a));
  const c = add(t, mul(u, a));
  const off = sub(onSphere, c), perp = sub(off, mul(u, dot(off, u))), lp = len(perp);
  const dir = lp > 1e-9 ? mul(perp, 1 / lp) : Math.abs(u.y) < 0.9 ? norm(sub(v3(0, 1, 0), mul(u, u.y))) : norm(sub(v3(1, 0, 0), mul(u, u.x)));
  return add(c, mul(dir, rho));
}
const norm = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : v3(0, 1, 0); };

/** Fit a raw pose to the body: lowest skate on the ice, hips low enough for the planted legs, hands within reach. */
export function fitBody(raw: RawPose, d: BodyDims): SkaterPose {
  const maxLeg = 0.985 * (d.thigh + d.shin);
  const feet = raw.legs.map((l) => ({ ...l.foot }));
  const minY = Math.min(feet[0]!.y, feet[1]!.y);
  for (const f of feet) f.y = Math.max(0, f.y - minY);
  const yaw = raw.yaw;
  const want = Math.max(0.1, raw.hipY);
  // Each skate on the ice holds the pelvis down to where its ankle is in reach (one further out than a leg can reach
  // is drawn in toward the hip). A lifting skate lets go gradually over its first liftFade of height, so the pelvis
  // rises smoothly as the weight comes off it.
  let hipY = want;
  for (const i of [0, 1] as const) {
    const f = feet[i]!, hip = hipJoint({ hipY: want, yaw }, i, d);
    const hx = f.x - hip.x, hz = f.z - hip.z, h = Math.hypot(hx, hz);
    const ankleY = f.y + d.skate;
    let limit: number;
    if (h >= maxLeg * 0.999) {
      if (f.y === 0) { const k = (maxLeg * 0.999) / h; f.x = hip.x + hx * k; f.z = hip.z + hz * k; }
      limit = ankleY;
    } else limit = ankleY + Math.sqrt(maxLeg * maxLeg - h * h);
    hipY = Math.min(hipY, lerp(limit, want, smooth(f.y / LIFT_FADE)));
  }
  hipY = Math.max(0.1, hipY);
  // Skates still out of reach (only lifted ones can be) are drawn in toward the hip.
  for (const i of [0, 1] as const) {
    const hip = hipJoint({ hipY, yaw }, i, d);
    const ankle = within(add(feet[i]!, v3(0, d.skate, 0)), hip, maxLeg);
    feet[i] = v3(ankle.x, Math.max(0, ankle.y - d.skate), ankle.z);
  }
  // Hands: the top hand holds the stick butt at the hip; the other is on the shaft or swinging free.
  const body = { hipY, pitch: raw.pitch, roll: raw.roll, twist: raw.twist };
  const reach = armReach(d) * 0.98;
  const lift = (p: Vec3, sh: Vec3): Vec3 => within(p.y < 0.03 ? v3(p.x, 0.03, p.z) : p, sh, reach);
  const sl = shoulderJoint(body, 0, d), sr = shoulderJoint(body, 1, d);
  let top = lift(add(v3(0, hipY, 0), raw.top), sr);
  // The top hand chokes up a little, so the blade is carried about a metre in front rather than at full stick length.
  // The shaft descends from it to the heel, on the ice or raised by bladeUp.
  const grip = STICK_GRIP * d.stick, below = d.stick - grip;
  const aim = raw.blade; // bladeAt sets it to the target, and mixes it with the rest
  if (raw.bladeAt) {
    // A blade put at a point: the hand is solved back from it (as far over as bladeAtW says).
    const t = raw.bladeAt, k = clamp01(fin(raw.bladeAtW ?? 1));
    const hand = handForBlade(t, below, sr, reach, top);
    top = k >= 1 ? hand : within(lerp3(top, hand, k), sr, reach);
  }
  const stickAngle = Math.atan2(aim.z - top.z, aim.x - top.x);
  // The blade no higher than the top hand, except where a blade target asks for it (a back-swing or a high finish):
  // then, as far over as bladeAtW says, up to almost a stick's length above the hand, the shaft rising to it.
  const over = raw.bladeAt ? clamp01(fin(raw.bladeAtW ?? 1)) * 0.98 * below : 0;
  const up = clamp(fin(raw.bladeUp ?? 0), 0, Math.max(0, top.y) + over);
  const sinT = clamp((top.y - up) / below, -1, 1), cosT = Math.sqrt(1 - sinT * sinT);
  const shaft = v3(Math.cos(stickAngle) * cosT, -sinT, Math.sin(stickAngle) * cosT);
  const heel = add(top, mul(shaft, below));
  const onShaft = add(top, mul(shaft, shaftGrip(top, shaft, sl, reach, 0.36 * d.stick)));
  const free = add(sl, raw.freeRel);
  const bottom = lift(lerp3(free, onShaft, clamp01(raw.twoHands)), sl);
  const leg = (i: 0 | 1): LegPose => ({ foot: feet[i]!, footYaw: raw.legs[i].footYaw, lifted: feet[i]!.y > 0.01 });
  return {
    hipY, pitch: raw.pitch, roll: raw.roll, yaw, twist: raw.twist, look: raw.look, lookDown: fin(raw.lookDown ?? 0),
    legs: [leg(0), leg(1)], arms: [{ hand: bottom }, { hand: top }], stickAngle, grip,
    blade: v3(heel.x, Math.max(0, heel.y), heel.z),
  };
}

/** Distance down the shaft for the lower hand: as near `want` as the arm (shoulder `sh`, reach `r`) allows. */
function shaftGrip(top: Vec3, dir: Vec3, sh: Vec3, r: number, want: number): number {
  const toSh = sub(sh, top);
  const tc = toSh.x * dir.x + toSh.y * dir.y + toSh.z * dir.z;
  const d2 = len(toSh) ** 2 - tc * tc;
  if (d2 >= r * r) return Math.max(0, tc);
  const half = Math.sqrt(r * r - d2);
  const lo = Math.max(0, tc - half);
  return clamp(want, lo, Math.max(lo, tc + half)); // never above the butt: continuous with the branch above
}

/** `raw` moved by `k` times the difference from pose `from` to pose `to` (every number; `from`, `to` keep their legs' order). */
export function addRawDelta(raw: RawPose, from: RawPose, to: RawPose, k: number): RawPose {
  const d = (f: (r: RawPose) => number): number => (f(to) - f(from)) * k;
  const d3 = (a: Vec3, f: (r: RawPose) => Vec3): Vec3 => v3(a.x + (f(to).x - f(from).x) * k, a.y + (f(to).y - f(from).y) * k, a.z + (f(to).z - f(from).z) * k);
  const leg = (i: 0 | 1): RawLeg => ({ foot: d3(raw.legs[i].foot, (r) => r.legs[i].foot), footYaw: raw.legs[i].footYaw + d((r) => r.legs[i].footYaw) });
  const out: RawPose = {
    ...raw,
    hipY: raw.hipY + d((r) => r.hipY), pitch: raw.pitch + d((r) => r.pitch), roll: raw.roll + d((r) => r.roll), yaw: raw.yaw + d((r) => r.yaw),
    twist: raw.twist + d((r) => r.twist), look: raw.look + d((r) => r.look),
    legs: [leg(0), leg(1)],
    top: d3(raw.top, (r) => r.top), freeRel: d3(raw.freeRel, (r) => r.freeRel), twoHands: raw.twoHands + d((r) => r.twoHands),
    blade: d3(raw.blade, (r) => r.blade),
    lookDown: (raw.lookDown ?? 0) + d((r) => r.lookDown ?? 0), bladeUp: (raw.bladeUp ?? 0) + d((r) => r.bladeUp ?? 0),
  };
  return out;
}
