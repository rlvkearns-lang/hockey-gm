import type { SkaterState } from '@hockey/engine';
import type { BodyDims } from './body';

/**
 * Skating gait and pose maths (pure: no three.js, no DOM).
 *
 * Body frame: x forward (the way he faces), y up, z to his right; the origin is on the ice directly under his pelvis.
 * Angles in radians. Every yaw (footYaw, Pose.yaw, stickAngle, a travel direction) is measured in the ice plane from
 * +x toward +z, so heading h points along (cos h, 0, sin h). Roll is positive leaning toward +z, pitch positive leaning
 * forward (toward +x). Index 0 of legs and arms is his left side (z < 0), index 1 his right.
 *
 * Engine to body frame: engine x is world X and engine y is world Z (up is world Y), so with engine facing f his
 * forward is engine (cos f, sin f) and his right (+z) is engine (-sin f, cos f). A rising facing turns him toward +z.
 */

export type Vec3 = { x: number; y: number; z: number };

/**
 * His motion in his own frame. `forward` and `lateral` are the velocity components along his facing and toward +z
 * (m/s); `accelAlong` is the rate of change of speed (m/s^2); `turnRate` is the rate of change of facing (rad/s,
 * positive turning toward +z); `facing` is the engine facing.
 */
export type Motion = { speed: number; forward: number; lateral: number; accelAlong: number; turnRate: number; facing: number; down: boolean };

export type Style = 'stand' | 'glide' | 'stride' | 'crossover' | 'backward' | 'stop' | 'down';
export const STYLES: readonly Style[] = ['stand', 'glide', 'stride', 'crossover', 'backward', 'stop', 'down'];

/**
 * `phase` counts stride cycles (it is not wrapped; poses use its fractional part). One cycle is a push with each leg
 * (stride), one crossover (crossover), or a C-cut with each leg (backward). `styleT` is seconds in the current style.
 * `lean` (pitch from acceleration) and `roll` (into a turn) ease toward their targets.
 * The optional fields are working values kept by stepGait; poseOf reads them when present:
 * `acc` smoothed accelAlong, `turn` smoothed turnRate, `side` which way a crossover crosses or a stop turns the skates
 * (+1 toward +z), `travel` his smoothed travel direction (body-frame yaw, held while he is
 * nearly still), and `from`/`fromSide` the style he is blending out of over the first BLEND seconds of `style`.
 */
export type GaitState = {
  phase: number;
  style: Style;
  styleT: number;
  lean: number;
  roll: number;
  acc?: number;
  turn?: number;
  travel?: number;
  side?: 1 | -1;
  from?: Style;
  fromSide?: 1 | -1;
};

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
export type Pose = { hipY: number; pitch: number; roll: number; yaw: number; legs: [LegPose, LegPose]; arms: [ArmPose, ArmPose]; stickAngle: number };

/**
 * Tunables. Thresholds come in enter/exit pairs (hysteresis); "off" is the angle between his travel and his facing.
 * See the task 2 report for the reasoning behind each.
 */
export const GAIT = {
  /** Smoothing time constants (s). */
  accTau: 0.4,
  turnTau: 0.3,
  travelTau: 0.15,
  leanTau: 0.25,
  rollTau: 0.2,
  /** Raw acceleration is clamped to this (m/s^2) before smoothing, so one tick of a body shove cannot read as a push. */
  accClamp: 10,
  /** Seconds a style is held before an ordinary change; down, stop and getting up are immediate. */
  minDwell: 0.45,
  /**
   * After the dwell, leaving a stride or a crossover waits up to this many more seconds for a natural break (both
   * skates down in a stride, the outside skate planted in a crossover), so the blend starts from a settled pose.
   */
  maxBreakWait: 0.4,
  /** Seconds to blend from the old style's pose into the new one's. */
  blend: 0.35,
  /** Speed (m/s) above which he is moving rather than standing. */
  moveEnter: 0.9,
  moveExit: 0.5,
  /** Smoothed acceleration (m/s^2) that makes him stride. */
  strideEnter: 2.0,
  strideExit: 0.5,
  /** Travel off facing beyond which he skates backward. */
  backEnter: (115 * Math.PI) / 180,
  backExit: (100 * Math.PI) / 180,
  /** Speed (m/s) he must be doing to start skating backward (slower, travel direction is too noisy to read). */
  backMinSpeed: 1.2,
  /** Braking (m/s^2) for a stop, and the speed he must be doing to start one. */
  stopEnter: -4,
  stopExit: -1.5,
  stopMinSpeed: 1.5,
  /** Travel off facing beyond which he crosses over sideways, unless his speed is bleeding off faster than crossLatMinAcc. */
  crossOffEnter: (55 * Math.PI) / 180,
  crossOffExit: (40 * Math.PI) / 180,
  crossLatMinAcc: -3,
  /** Turn rate (rad/s) above which a turn at speed is taken with crossovers. */
  crossTurnEnter: 1.0,
  crossTurnExit: 0.7,
  crossTurnSpeedEnter: 3,
  crossTurnSpeedExit: 2.5,
  crossTurnMinAcc: -2,
} as const;

const TAU = 2 * Math.PI;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const frac = (v: number): number => v - Math.floor(v);
const ease = (v: number, target: number, tau: number, dt: number): number => v + (target - v) * (1 - Math.exp(-dt / tau));
const wrap = (a: number): number => { const w = a - TAU * Math.round(a / TAU); return w <= -Math.PI ? w + TAU : w; };
const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

// ---------------------------------------------------------------------------------------------------------------
// Motion and gait state

export function motionOf(prev: SkaterState, next: SkaterState, dt: number): Motion {
  const vx = next.vel.x, vy = next.vel.y, f = next.facing;
  const speed = Math.hypot(vx, vy);
  const c = Math.cos(f), s = Math.sin(f);
  const ok = dt > 0;
  return {
    speed,
    forward: vx * c + vy * s,
    lateral: -vx * s + vy * c,
    accelAlong: ok ? (speed - Math.hypot(prev.vel.x, prev.vel.y)) / dt : 0,
    turnRate: ok ? wrap(f - prev.facing) / dt : 0,
    facing: f,
    down: next.downT > 0,
  };
}

export function initialGait(): GaitState {
  return { phase: 0, style: 'stand', styleT: 10, lean: 0, roll: 0, acc: 0, turn: 0, side: 1 };
}

/** Angle between his travel and his facing, 0..PI. */
const offOf = (m: Motion): number => (m.speed > 1e-6 ? Math.atan2(Math.abs(m.lateral), m.forward) : 0);
/** His travel direction as a body-frame yaw. */
const travelYawOf = (m: Motion): number => (m.speed > 1e-6 ? Math.atan2(m.lateral, m.forward) : 0);

function classify(cur: Style, m: Motion, acc: number, turn: number): Style {
  const G = GAIT;
  if (m.down) return 'down';
  const sp = m.speed, off = offOf(m);
  const pushing = acc > (cur === 'stride' ? G.strideExit : G.strideEnter);
  const backward = off > (cur === 'backward' ? G.backExit : G.backEnter);
  if (sp <= (cur === 'stand' ? G.moveEnter : G.moveExit)) {
    // Barely moving: he stands, unless he is clearly pushing off (a start from rest).
    if (pushing && sp > 0.25) return backward ? 'backward' : 'stride';
    return 'stand';
  }
  // A stop, once begun, holds through his pivot while he is still braking (until his travel is behind him).
  const notBehind = off < G.backEnter;
  if (cur === 'stop' && acc < G.stopExit && notBehind) return 'stop';
  if (backward && (cur === 'backward' || sp > G.backMinSpeed)) return 'backward';
  if (sp > G.stopMinSpeed && acc < G.stopEnter && notBehind) return 'stop';
  const inCross = cur === 'crossover';
  const sideways = off > (inCross ? G.crossOffExit : G.crossOffEnter) && acc > G.crossLatMinAcc;
  const hardTurn = sp > (inCross ? G.crossTurnSpeedExit : G.crossTurnSpeedEnter)
    && Math.abs(turn) > (inCross ? G.crossTurnExit : G.crossTurnEnter) && acc > G.crossTurnMinAcc;
  if (sideways || hardTurn) return 'crossover';
  return pushing ? 'stride' : 'glide';
}

/** Which way a crossover crosses: toward his sideways travel, else toward the turn. */
function crossSide(m: Motion, turn: number, keep: 1 | -1, entering: boolean): 1 | -1 {
  const latShare = m.speed > 1e-6 ? m.lateral / m.speed : 0;
  if (entering) return Math.abs(latShare) > 0.5 ? sign(latShare) : Math.abs(turn) > 0.05 ? sign(turn) : keep;
  // Already crossing: change sides only on clear evidence.
  if (Math.abs(latShare) > 0.6) return sign(latShare);
  if (Math.abs(latShare) < 0.3 && Math.abs(turn) > GAIT.crossTurnExit) return sign(turn);
  return keep;
}

/** Which way a stop turns the skates: the short way to sideways-on to his travel `ty`. */
function stopSide(ty: number, turn: number): 1 | -1 {
  if (Math.abs(ty) > 0.35) return ty > 0 ? -1 : 1;
  return Math.abs(turn) > 0.3 ? sign(turn) : 1;
}

/** Stride amplitude 0..1: longer strides at speed and under effort. */
const strideAmp = (speed: number, acc: number): number => clamp(0.45 + 0.4 * clamp01(speed / 8) + 0.15 * clamp01(acc / 4), 0.3, 1);
/** Backward C-cut effort 0..1: a gentle cut when holding speed, none when slowing (e.g. pushed backward). */
const backEffort = (acc: number): number => clamp01(0.2 + (0.8 * acc) / 3);

/** Cycles per second of the stride phase in a style. */
function phaseRate(style: Style, m: Motion, acc: number): number {
  switch (style) {
    case 'stride': {
      // Pushes (strides) per second: about 1.8 to 2.4 when sprinting; one cycle is two pushes.
      const pushes = clamp(1.2 + 0.11 * m.speed + 0.06 * Math.max(0, acc), 1.2, 2.4);
      return pushes / 2;
    }
    case 'glide': return 0.2; // slow weight shifts
    case 'crossover': return clamp(0.8 + 0.1 * m.speed, 0.8, 1.7);
    case 'backward': return (0.5 + 0.05 * m.speed) * backEffort(acc);
    default: return 0;
  }
}

/** Whether a style's cycle is at a natural point to leave it. */
function atBreak(style: Style, phase: number): boolean {
  const q = frac(phase);
  if (style === 'stride') return q < 0.1 || (q >= 0.5 && q < 0.6);
  if (style === 'crossover') return q >= 0.45 && q < 0.85;
  return true;
}

export function stepGait(g: GaitState, m: Motion, dt: number): GaitState {
  const h = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
  const acc = ease(g.acc ?? 0, clamp(m.accelAlong, -GAIT.accClamp, GAIT.accClamp), GAIT.accTau, h);
  const turn = ease(g.turn ?? 0, m.turnRate, GAIT.turnTau, h);
  const side = g.side ?? 1;
  const ty = travelYawOf(m);
  const travel = m.speed > GAIT.moveExit ? (g.travel ?? ty) + wrap(ty - (g.travel ?? ty)) * (1 - Math.exp(-h / GAIT.travelTau)) : g.travel ?? 0;

  let want = classify(g.style, m, acc, turn);
  const urgent = want === 'down' || g.style === 'down' || want === 'stop';
  if (want !== g.style && !urgent && (g.styleT < GAIT.minDwell || (!atBreak(g.style, g.phase) && g.styleT < GAIT.minDwell + GAIT.maxBreakWait))) want = g.style;

  let wantSide = side;
  if (want === 'crossover') wantSide = crossSide(m, turn, side, g.style !== 'crossover');
  else if (want === 'stop' && g.style !== 'stop') wantSide = stopSide(travel, turn);
  else if (want === 'stop' && Math.abs(travel) > 1.2 && sign(travel) === side) {
    // His travel has swung well round to the side his toes point: turn the skates the other way.
    wantSide = stopSide(travel, turn);
  }
  if (want === 'crossover' && g.style === 'crossover' && wantSide !== side && g.styleT < GAIT.minDwell) wantSide = side;

  const changed = want !== g.style || wantSide !== side;
  const next: GaitState = {
    phase: g.phase + phaseRate(want, m, acc) * h,
    style: want,
    styleT: changed ? 0 : g.styleT + h,
    lean: ease(g.lean, want === 'down' ? 0 : clamp(0.045 * acc, -0.25, 0.35), GAIT.leanTau, h),
    roll: ease(g.roll, want === 'down' || m.speed < GAIT.moveExit ? 0 : clamp(0.85 * Math.atan((m.speed * turn) / 9.81), -0.6, 0.6), GAIT.rollTau, h),
    acc,
    turn,
    travel: wrap(travel),
    side: wantSide,
  };
  if (changed) {
    // A blend interrupted before it is half done keeps blending from the style it started from.
    const early = g.from !== undefined && smooth(g.styleT / GAIT.blend) < 0.5;
    next.from = early ? g.from : g.style;
    next.fromSide = early ? g.fromSide ?? side : side;
  }
  else if (g.from !== undefined && next.styleT < GAIT.blend) { next.from = g.from; next.fromSide = g.fromSide ?? side; }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Pose

/** A style's pose before it is fitted to the body: hands are offsets from their shoulders. */
type RawLeg = { foot: Vec3; footYaw: number };
type RawPose = {
  hipY: number; pitch: number; roll: number; yaw: number;
  legs: [RawLeg, RawLeg];
  /** Top (stick) hand, arms[1], from the right shoulder; free hand, arms[0], from the left shoulder. */
  topRel: Vec3; freeRel: Vec3;
  /** 1: the left hand is on the shaft; 0: it swings free at freeRel. */
  twoHands: number;
  stickAngle: number;
};

const armReach = (d: BodyDims): number => d.upperArm + d.forearm;

/** Rotate a torso-frame vector by the torso's pitch then roll: Rx(roll) * Rz(-pitch). */
export function torsoRotate(v: Vec3, pitch: number, roll: number): Vec3 {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const x = v.x * cp + v.y * sp, y = -v.x * sp + v.y * cp, z = v.z;
  return v3(x, y * cr - z * sr, y * sr + z * cr);
}

/** Hip joint (side 0 left, 1 right) in the body frame: on the pelvis line at hipY, turned by the pelvis yaw. */
export function hipJoint(p: Pick<Pose, 'hipY' | 'yaw'>, side: 0 | 1, d: BodyDims): Vec3 {
  const w = ((side === 0 ? -1 : 1) * d.hipWidth) / 2;
  return v3(-w * Math.sin(p.yaw), p.hipY, w * Math.cos(p.yaw));
}

/** Shoulder joint (side 0 left, 1 right): torso up from the pelvis centre, tilted by pitch then roll. */
export function shoulderJoint(p: Pick<Pose, 'hipY' | 'pitch' | 'roll'>, side: 0 | 1, d: BodyDims): Vec3 {
  const w = ((side === 0 ? -1 : 1) * d.shoulderWidth) / 2;
  return add(v3(0, p.hipY, 0), torsoRotate(v3(0, d.torso, w), p.pitch, p.roll));
}

/** An arm hanging at angle `a` from straight down (forward positive), `k` of full reach, `out` sideways share. */
const swingArm = (a: number, k: number, out: number, R: number): Vec3 => v3(R * k * Math.sin(a), -R * k * Math.cos(a), R * out);

function standPose(d: BodyDims, lean: number): RawPose {
  const R = armReach(d), half = d.shoulderWidth / 2;
  return {
    hipY: d.hipHeight * 1.04, pitch: 0.22 + 0.2 * lean, roll: 0, yaw: 0,
    legs: [{ foot: v3(0.03, 0, -half), footYaw: -0.1 }, { foot: v3(0.03, 0, half), footYaw: 0.1 }],
    topRel: v3(0.3 * R, -0.62 * R, -0.05 * R), freeRel: swingArm(0.1, 0.95, -0.1, R), twoHands: 1, stickAngle: -0.3,
  };
}

function glidePose(d: BodyDims, ph: number, lean: number): RawPose {
  const R = armReach(d), half = d.shoulderWidth / 2;
  const shift = 0.03 * Math.sin(TAU * ph); // small weight shifts from skate to skate
  return {
    hipY: d.hipHeight * 0.98, pitch: 0.35 + 0.6 * lean, roll: 0.04 * Math.sin(TAU * ph), yaw: 0,
    legs: [{ foot: v3(0.06, 0, -half - shift), footYaw: -0.05 }, { foot: v3(0.02, 0, half - shift), footYaw: 0.05 }],
    topRel: v3(0.35 * R, -0.6 * R, -0.05 * R), freeRel: swingArm(0.3, 0.95, -0.1, R), twoHands: 1,
    stickAngle: -0.25 + 0.03 * Math.sin(TAU * ph),
  };
}

/**
 * Forward stride. Each leg (left at phase q = ph, right half a cycle later): on the ice for q in [0, 0.6) (a short
 * glide under the body, then a push back and out at 45 degrees with the skate turned out), then lifted and recovered
 * under the body to set down pointing along travel. Double support around q = 0 and 0.5, so one skate is always down.
 */
function stridePose(d: BodyDims, ph: number, m: Motion, acc: number, lean: number): RawPose {
  const R = armReach(d);
  const amp = strideAmp(m.speed, acc);
  const reach = 0.62 * (d.thigh + d.shin) * amp;
  const diag = reach * Math.SQRT1_2;
  const baseZ = d.hipWidth / 2 + 0.02;
  const setX = 0.1;
  // Weight over the gliding skate: the pelvis moves toward the leg that has just set down.
  const shiftZ = -0.06 * amp * Math.cos(TAU * (ph - 0.2));
  const back: number[] = [];
  const legs = ([-1, 1] as const).map((sg, i): RawLeg => {
    const q = frac(ph + (i === 0 ? 0 : 0.5));
    const endX = setX - 0.06 - diag, endZ = sg * (baseZ + diag), endYaw = sg * 0.63;
    let foot: Vec3, yaw: number, e: number;
    if (q < 0.6) {
      e = smooth((q - 0.15) / 0.45);
      const x = setX - 0.06 * clamp01(q / 0.15) - diag * e;
      foot = v3(x, 0, sg * (baseZ + diag * e));
      yaw = sg * (0.08 + 0.55 * e);
    } else {
      const u = (q - 0.6) / 0.4, s = smooth(u);
      e = 1 - s;
      foot = v3(lerp(endX, setX, s), 0.13 * amp * Math.sin(Math.PI * u), lerp(endZ, sg * baseZ, s) - sg * 0.04 * Math.sin(Math.PI * u));
      yaw = lerp(endYaw, sg * 0.03, smooth(u * 1.4));
    }
    back.push(e);
    foot.z -= shiftZ;
    return { foot, footYaw: yaw };
  }) as [RawLeg, RawLeg];
  // Arms swing opposite the legs: a skate pushed back brings that side's arm forward. The free (left) arm swings big;
  // the stick hand stays low in front with a small swing.
  const s = (back[0]! - back[1]!) * amp;
  return {
    hipY: d.hipHeight * (0.96 - 0.04 * amp), pitch: 0.4 + 0.12 * amp + lean, roll: shiftZ * 0.8, yaw: -0.08 * s,
    legs,
    topRel: swingArm(0.75 - 0.3 * s, 0.85, -0.15, R), freeRel: swingArm(0.2 + 0.95 * s, 0.93, -0.08 - 0.12 * Math.max(0, -s), R),
    twoHands: 0, stickAngle: -0.35 - 0.15 * s,
  };
}

/**
 * Crossover toward side `dir` (+1: +z). The outside leg lifts and crosses over in front of the inside one
 * (ph 0 to 0.45), then rides back out under the body while the inside leg pushes under and out behind it
 * (0.45 to 0.85) and recovers (0.85 to 1). The body rolls into the turn, so the skates sit outward of the pelvis.
 */
function crossoverPose(d: BodyDims, ph: number, travel: number, dir: 1 | -1, lean: number, roll: number): RawPose {
  const R = armReach(d), u = d.shoulderWidth / 2;
  const p = frac(ph);
  const hipY = d.hipHeight * 0.93;
  const bodyRoll = roll + dir * 0.12;
  const outShift = -Math.sign(bodyRoll) * hipY * Math.sin(Math.min(0.6, Math.abs(bodyRoll))) * 0.4;
  // Skates turned partly toward his travel (sin: continuous however his travel swings).
  const yawBase = 0.5 * Math.sin(travel) + dir * 0.1;
  // Outside leg.
  let o: Vec3, oYaw = yawBase;
  if (p < 0.45) {
    const t = p / 0.45, s = smooth(t);
    o = v3(lerp(-0.08, 0.15, s), 0.12 * Math.sin(Math.PI * t), dir * lerp(-1.3 * u, 1.0 * u, s));
    oYaw += dir * 0.15 * Math.sin(Math.PI * t);
  } else {
    const s = smooth((p - 0.45) / 0.55);
    o = v3(lerp(0.15, -0.08, s), 0, dir * lerp(1.0 * u, -1.3 * u, s));
  }
  // Inside leg.
  let iFoot: Vec3, iYaw = yawBase;
  if (p < 0.45) {
    const s = smooth(p / 0.45);
    iFoot = v3(lerp(0, -0.03, s), 0, dir * lerp(1.1 * u, 0.85 * u, s));
  } else if (p < 0.85) {
    const s = smooth((p - 0.45) / 0.4);
    iFoot = v3(lerp(-0.03, -0.18, s), 0, dir * lerp(0.85 * u, -0.3 * u, s));
    iYaw += dir * 0.15 * s;
  } else {
    const t = (p - 0.85) / 0.15, s = smooth(t);
    iFoot = v3(lerp(-0.18, 0, s), 0.08 * Math.sin(Math.PI * t), dir * lerp(-0.3 * u, 1.1 * u, s));
    iYaw += dir * 0.15 * (1 - s);
  }
  o.z += outShift; iFoot.z += outShift;
  const outLeg: RawLeg = { foot: o, footYaw: oYaw }, inLeg: RawLeg = { foot: iFoot, footYaw: iYaw };
  return {
    hipY, pitch: 0.4 + 0.8 * lean, roll: bodyRoll, yaw: dir * 0.1,
    legs: dir > 0 ? [outLeg, inLeg] : [inLeg, outLeg],
    topRel: v3(0.3 * R, -0.65 * R, -0.05 * R), freeRel: swingArm(0.4, 0.9, -0.1, R), twoHands: 1, stickAngle: -0.2 + 0.3 * dir,
  };
}

/**
 * Backward: seated, torso upright, both skates always on the ice. Each leg in turn (left ph 0 to 0.5, right 0.5 to 1)
 * sweeps a C-cut: out to the side and forward in a half circle with the toe turned in, then rides back under the body.
 */
function backwardPose(d: BodyDims, ph: number, acc: number, lean: number): RawPose {
  const R = armReach(d), half = d.shoulderWidth / 2 + 0.02;
  const eff = backEffort(acc), A = 0.22 * eff * (d.thigh + d.shin) / 0.9;
  const p = frac(ph);
  const legs = ([-1, 1] as const).map((sg, i): RawLeg => {
    const q = frac(p + (i === 0 ? 0 : 0.5));
    let x = 0.05, z = sg * half, yaw = sg * 0.08;
    if (q < 0.5) {
      const t = Math.PI * (q / 0.5);
      x += 0.6 * A * (1 - Math.cos(t)) / 2;
      z += sg * A * Math.sin(t);
      yaw -= sg * 0.5 * eff * Math.sin(t); // toe in, heel out
    } else {
      x += 0.6 * A * (1 - smooth((q - 0.5) / 0.5));
    }
    return { foot: v3(x, 0, z), footYaw: yaw };
  }) as [RawLeg, RawLeg];
  // Weight on the skate that is not cutting.
  const shift = 0.05 * eff * Math.sin(TAU * p);
  for (const l of legs) l.foot.z += shift;
  return {
    hipY: d.hipHeight * 0.9, pitch: 0.18 + 0.3 * lean, roll: -0.6 * shift, yaw: 0,
    legs,
    topRel: v3(0.35 * R, -0.65 * R, 0), freeRel: swingArm(0.3, 0.9, -0.1, R), twoHands: 1, stickAngle: -0.15,
  };
}

/**
 * Hockey stop: hips and both skates turn sideways to travel (the short way, side `s`), feet out ahead of him along
 * travel so he leans back against the stop, knees deeply bent; it eases out as his speed drops.
 */
function stopPose(d: BodyDims, m: Motion, travel: number, s: 1 | -1, lean: number): RawPose {
  const R = armReach(d), half = (d.shoulderWidth / 2) * 1.1;
  const k = clamp01((m.speed - 0.5) / 3);
  // The hips turn most of the way sideways and follow his travel a little; sin keeps that continuous (and within
  // about 1.4 rad of his facing) however far round his travel swings while he pivots.
  const ty = travel;
  const pelvis = s * (Math.PI / 2) * (0.55 + 0.25 * k) + 0.6 * Math.sin(ty);
  // Skates a little further round than the hips: about square to travel, never pointing back past ~130 degrees.
  const skate = pelvis + s * 0.4;
  const ahead = 0.22 * k;
  const ax = Math.cos(ty) * ahead, az = Math.sin(ty) * ahead;
  const legs = ([-1, 1] as const).map((sg): RawLeg => ({
    foot: v3(-sg * half * Math.sin(pelvis) + ax, 0, sg * half * Math.cos(pelvis) + az),
    footYaw: skate,
  })) as [RawLeg, RawLeg];
  return {
    hipY: d.hipHeight * (1 - 0.17 * k), pitch: 0.1 + 0.6 * lean, roll: 0, yaw: pelvis,
    legs,
    topRel: v3(0.3 * R, -0.6 * R, 0), freeRel: swingArm(0.3, 0.9, -0.1, R), twoHands: 1, stickAngle: -0.3,
  };
}

/** Down: sitting on the ice leaning back on his hands, legs out in front. */
function downPose(d: BodyDims): RawPose {
  const R = armReach(d), half = d.hipWidth / 2 + 0.08;
  const out = (d.thigh + d.shin) * 0.72;
  return {
    hipY: 0.2, pitch: -0.4, roll: 0, yaw: 0,
    legs: [{ foot: v3(out, 0, -half), footYaw: -0.3 }, { foot: v3(out, 0, half), footYaw: 0.3 }],
    topRel: v3(-0.15 * R, -1.1 * R, 0.25 * R), freeRel: v3(-0.15 * R, -1.1 * R, -0.25 * R), twoHands: 0, stickAngle: 0.4,
  };
}

function rawPose(style: Style, g: GaitState, side: 1 | -1, m: Motion, d: BodyDims): RawPose {
  const acc = g.acc ?? m.accelAlong;
  const travel = g.travel ?? travelYawOf(m);
  switch (style) {
    case 'stand': return standPose(d, g.lean);
    case 'glide': return glidePose(d, g.phase, g.lean);
    case 'stride': return stridePose(d, g.phase, m, acc, g.lean);
    case 'crossover': return crossoverPose(d, g.phase, travel, side, g.lean, g.roll);
    case 'backward': return backwardPose(d, g.phase, acc, g.lean);
    case 'stop': return stopPose(d, m, travel, side, g.lean);
    case 'down': return downPose(d);
  }
}

/**
 * Every style's yaws are continuous and stay well inside (-PI, PI), so they blend as plain numbers (a short-way-round
 * blend would be ambiguous between skate headings far apart, such as a stop turning the other way).
 */
function mixRaw(a: RawPose, b: RawPose, w: number): RawPose {
  const leg = (i: 0 | 1): RawLeg => ({ foot: lerp3(a.legs[i].foot, b.legs[i].foot, w), footYaw: lerp(a.legs[i].footYaw, b.legs[i].footYaw, w) });
  return {
    hipY: lerp(a.hipY, b.hipY, w), pitch: lerp(a.pitch, b.pitch, w), roll: lerp(a.roll, b.roll, w), yaw: lerp(a.yaw, b.yaw, w),
    legs: [leg(0), leg(1)],
    topRel: lerp3(a.topRel, b.topRel, w), freeRel: lerp3(a.freeRel, b.freeRel, w), twoHands: lerp(a.twoHands, b.twoHands, w),
    stickAngle: lerp(a.stickAngle, b.stickAngle, w),
  };
}

/** Pull `p` to within `r` of `c`. */
const within = (p: Vec3, c: Vec3, r: number): Vec3 => { const v = sub(p, c), l = len(v); return l > r ? add(c, mul(v, r / l)) : p; };

/** Fit a raw pose to the body: lowest skate on the ice, hips low enough for the planted legs, hands within reach. */
function fit(raw: RawPose, d: BodyDims): Pose {
  const maxLeg = 0.985 * (d.thigh + d.shin);
  const feet = raw.legs.map((l) => ({ ...l.foot }));
  const minY = Math.min(feet[0]!.y, feet[1]!.y);
  for (const f of feet) f.y = Math.max(0, f.y - minY);
  const lifted = feet.map((f) => f.y > 0.01);
  let hipY = Math.max(0.1, raw.hipY);
  const yaw = raw.yaw;
  // Planted legs: the pelvis comes down until each planted ankle is in reach (a planted skate further out than a leg
  // can reach is drawn in toward the hip).
  for (const i of [0, 1] as const) {
    if (lifted[i]) continue;
    const f = feet[i]!, hip = hipJoint({ hipY, yaw }, i, d);
    const hx = f.x - hip.x, hz = f.z - hip.z, h = Math.hypot(hx, hz);
    const ankleY = f.y + d.skate;
    if (h >= maxLeg * 0.999) {
      const k = (maxLeg * 0.999) / h;
      f.x = hip.x + hx * k; f.z = hip.z + hz * k;
      hipY = Math.min(hipY, ankleY);
    } else hipY = Math.min(hipY, ankleY + Math.sqrt(maxLeg * maxLeg - h * h));
  }
  // Lifted legs: draw a skate that is out of reach in toward the hip.
  for (const i of [0, 1] as const) {
    if (!lifted[i]) continue;
    const hip = hipJoint({ hipY, yaw }, i, d);
    const ankle = within(add(feet[i]!, v3(0, d.skate, 0)), hip, maxLeg);
    feet[i] = v3(ankle.x, Math.max(0, ankle.y - d.skate), ankle.z);
  }
  // Hands: the top hand holds the stick butt; the other is on the shaft or swinging free.
  const body = { hipY, pitch: raw.pitch, roll: raw.roll };
  const reach = armReach(d) * 0.98;
  const lift = (p: Vec3, sh: Vec3): Vec3 => within(p.y < 0.03 ? v3(p.x, 0.03, p.z) : p, sh, reach);
  const sl = shoulderJoint(body, 0, d), sr = shoulderJoint(body, 1, d);
  const top = lift(add(sr, raw.topRel), sr);
  const sinT = Math.min(1, top.y / d.stick), cosT = Math.sqrt(1 - sinT * sinT);
  const shaft = v3(Math.cos(raw.stickAngle) * cosT, -sinT, Math.sin(raw.stickAngle) * cosT);
  const onShaft = add(top, mul(shaft, shaftGrip(top, shaft, sl, reach, 0.36 * d.stick)));
  const free = add(sl, raw.freeRel);
  const bottom = lift(lerp3(free, onShaft, clamp01(raw.twoHands)), sl);
  const leg = (i: 0 | 1): LegPose => ({ foot: feet[i]!, footYaw: raw.legs[i].footYaw, lifted: lifted[i]! });
  return { hipY, pitch: raw.pitch, roll: raw.roll, yaw, legs: [leg(0), leg(1)], arms: [{ hand: bottom }, { hand: top }], stickAngle: raw.stickAngle };
}

/** Distance down the shaft for the lower hand: as near `want` as the arm (shoulder `sh`, reach `r`) allows. */
function shaftGrip(top: Vec3, dir: Vec3, sh: Vec3, r: number, want: number): number {
  const toSh = sub(sh, top);
  const tc = toSh.x * dir.x + toSh.y * dir.y + toSh.z * dir.z;
  const d2 = len(toSh) ** 2 - tc * tc;
  if (d2 >= r * r) return Math.max(0, tc);
  const half = Math.sqrt(r * r - d2);
  return clamp(want, Math.max(0, tc - half), tc + half);
}

export function poseOf(g: GaitState, m: Motion, d: BodyDims): Pose {
  const side = g.side ?? 1;
  let raw = rawPose(g.style, g, side, m, d);
  const w = smooth(g.styleT / GAIT.blend);
  if (g.from !== undefined && w < 1) raw = mixRaw(rawPose(g.from, g, g.fromSide ?? side, m, d), raw, w);
  return fit(raw, d);
}

/**
 * Two-bone leg solve with the knee bending forward (+x). From hip to ankle: hipRoll swings the leg's plane out toward
 * +z (about x), hipPitch swings the thigh forward within that plane, kneeAngle bends the shin back (0 straight). So
 * the thigh points along (sin a, -cos a cos r, cos a sin r) with a = hipPitch, r = hipRoll, and the shin along the same
 * with a = hipPitch - kneeAngle. A foot out of reach gives a straight leg pointing at it; never NaN.
 */
export function solveLeg(hip: Vec3, foot: Vec3, thigh: number, shin: number): { kneeAngle: number; hipPitch: number; hipRoll: number } {
  const dx = foot.x - hip.x, dy = foot.y - hip.y, dz = foot.z - hip.z;
  const raw = Math.hypot(dx, dy, dz);
  const lo = Math.abs(thigh - shin) + 1e-9, hi = thigh + shin;
  const dist = clamp(raw, lo, hi);
  const hipRoll = Math.atan2(dz, -dy);
  const down = Math.hypot(dy, dz);
  const toFoot = raw > 1e-12 ? Math.atan2(dx, down) : 0;
  const cosKnee = clamp((thigh * thigh + shin * shin - dist * dist) / (2 * thigh * shin), -1, 1);
  const cosHip = clamp((thigh * thigh + dist * dist - shin * shin) / (2 * thigh * dist), -1, 1);
  return { kneeAngle: Math.PI - Math.acos(cosKnee), hipPitch: toFoot + Math.acos(cosHip), hipRoll };
}
