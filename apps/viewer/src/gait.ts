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
 * positive turning toward +z); `facing` is the engine facing. Non-finite fields are read as 0.
 */
export type Motion = { speed: number; forward: number; lateral: number; accelAlong: number; turnRate: number; facing: number; down: boolean };

/** `sprint` is a stride flat out: head down, deeper lean, longer harder pushes, the stick in one hand (see stridePose). */
export type Style = 'stand' | 'glide' | 'stride' | 'sprint' | 'crossover' | 'backward' | 'stop' | 'down';
export const STYLES: readonly Style[] = ['stand', 'glide', 'stride', 'sprint', 'crossover', 'backward', 'stop', 'down'];

/** One style (and side) in a blended pose, with its share. */
export type MixPart = { style: Style; side: 1 | -1; w: number };

/**
 * `phase` counts stride cycles (it is not wrapped; poses use its fractional part). One cycle is a push with each leg
 * (stride), one crossover (crossover), or a C-cut with each leg (backward). `styleT` is seconds in the current style.
 * `lean` (pitch from acceleration) and `roll` (into a turn) ease toward their targets.
 * The optional fields are working values kept by stepGait; poseOf reads them when present:
 * `acc` smoothed accelAlong (impulses left out), `speed` smoothed speed (sets how deep a stop or how long a stride
 * is, so a collision's jolt does not jerk the pose), `turn` smoothed turnRate, `travel` his smoothed travel direction
 * (body-frame yaw, held while he is nearly still), `side` which way a crossover crosses or a stop turns the skates
 * (+1 toward +z), `passive` seconds left in which he is being carried by a shove (no effort styles start), `puck` how
 * far his hands and stick have gone over to carrying the puck (0..1, eased by stepGait from its `carrying` argument;
 * absent if it was never given), and the blend: `from` is the pose shown when the style (or side) last changed, as a
 * mix of styles, which fades into the current style over `blendDur` seconds as `blendT` runs (without `blendT`, poseOf uses `styleT`).
 */
export type GaitState = {
  phase: number;
  style: Style;
  styleT: number;
  lean: number;
  roll: number;
  acc?: number;
  speed?: number;
  turn?: number;
  travel?: number;
  side?: 1 | -1;
  passive?: number;
  puck?: number;
  from?: readonly MixPart[];
  blendT?: number;
  blendDur?: number;
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

/**
 * Tunables. Thresholds come in enter/exit pairs (hysteresis); "off" is the angle between his travel and his facing.
 * "Raw" acceleration is this frame's accelAlong (not lagged); "smoothed" is GaitState.acc. See the task 2 report.
 */
export const GAIT = {
  /** Smoothing time constants (s). */
  accTau: 0.4,
  turnTau: 0.3,
  travelTau: 0.15,
  speedTau: 0.15,
  /** Fastest the travel direction his skates follow may turn (rad/s): a skater turns his feet only so fast. */
  travelMaxRate: 4,
  leanTau: 0.25,
  rollTau: 0.2,
  /** Raw acceleration is clamped to this (m/s^2) before smoothing. */
  accClamp: 10,
  /**
   * Raw acceleration above this (m/s^2) is an impulse from another body, not effort (the engine's own skating tops out
   * near 10): it is left out of the smoothed value, and for `passiveT` seconds (or until he accelerates by himself,
   * raw above `effortAccel`) no stride, crossover or stop starts.
   */
  impulseAccel: 14,
  passiveT: 0.6,
  effortAccel: 1,
  /** Seconds a style is held before an ordinary change; down, stop and getting up are immediate. */
  minDwell: 0.45,
  /**
   * After the dwell, leaving a stride or a crossover waits up to this many more seconds for a natural break (both
   * skates down in a stride, the outside skate planted in a crossover), so the blend starts from a settled pose.
   */
  maxBreakWait: 0.4,
  /** Seconds to blend from the pose shown into a new style's; falling and getting up take `blendDown`. */
  blend: 0.35,
  blendDown: 0.65,
  /** Blend out of a sprint into anything but a stride (its long pushes are far from every other style's feet). */
  blendSprint: 0.5,
  /** Speed (m/s) above which he is moving rather than standing. */
  moveEnter: 0.9,
  moveExit: 0.5,
  /** Smoothed acceleration (m/s^2) that makes him stride; starting also needs raw above strideRawMin. */
  strideEnter: 1.8,
  strideExit: 0.5,
  strideRawMin: -0.5,
  /**
   * A stride becomes a sprint at speed (m/s) and smoothed acceleration (m/s^2) above the enter pair (not while
   * shoved). The engine's top speeds are 7.6 to 9.2 m/s and a skater holding his top speed has no acceleration (the
   * engine has no friction on an upright skater: he slows only by easing off toward a lower speed, at up to his full
   * acceleration), so once flat out he stays in the sprint while he holds speed: it ends when his speed falls below
   * sprintSpeedExit (to a stride if he still drives, else a glide), when his smoothed acceleration falls below
   * sprintAccExit (he has eased off: about 1 m/s shed at the engine's 8 m/s^2 takes it there), when he is shoved, or when
   * a stop, crossover or fall takes over. Braking hard holds it until the stop starts. See the task 1 report.
   */
  sprintSpeedEnter: 7.0,
  sprintSpeedExit: 6.5,
  sprintAccEnter: 2.0,
  sprintAccExit: -0.8,
  /** Height (m) of the blade heel when he sprints with the stick in his top hand only. */
  sprintBladeUp: 0.22,
  /** Seconds for his hands and stick to go over to carrying the puck, or back. */
  puckBlend: 0.4,
  /** Travel off facing beyond which he skates backward. */
  backEnter: (115 * Math.PI) / 180,
  backExit: (100 * Math.PI) / 180,
  /** Speed (m/s) he must be doing to start skating backward (slower, travel direction is too noisy to read). */
  backMinSpeed: 1.2,
  /** Smoothed braking (m/s^2) for a stop (raw also below stopRawMax), and the speed he must be doing to start one. */
  stopEnter: -4,
  stopExit: -1.5,
  stopRawMax: -2,
  stopMinSpeed: 1.5,
  /** Travel off facing beyond which he crosses over sideways. */
  crossOffEnter: (55 * Math.PI) / 180,
  crossOffExit: (40 * Math.PI) / 180,
  /** Starting a crossover needs raw acceleration above this (his speed is held, not bleeding off as after a shove). */
  crossRawMin: -2,
  /** Starting a turning crossover needs smoothed acceleration above crossTurnMinAcc; one holds until a stop takes over. */
  crossTurnMinAcc: -2,
  /** Turn rate (rad/s) above which a turn at speed is taken with crossovers. */
  crossTurnEnter: 1.0,
  crossTurnExit: 0.7,
  crossTurnSpeedEnter: 3,
  crossTurnSpeedExit: 2.5,
  /**
   * The skates follow his line of travel exactly while it is within this angle (rad) of his facing (hips opening by
   * half of it), then turn smoothly back toward his facing as it swings further round (forward styles), or the same
   * about his reversed travel (backward).
   */
  skateFollow: 1.75,
  /** Height (m) over which a lifting skate stops holding the pelvis down. */
  liftFade: 0.06,
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
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
/** Turn a body-frame point by heading h about the vertical (x toward +z). */
const turn = (v: Vec3, h: number): Vec3 => { const c = Math.cos(h), s = Math.sin(h); return v3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); };

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

/** Motion with every non-finite field read as 0. */
function sane(m: Motion): Motion {
  return {
    speed: Math.abs(fin(m.speed)), forward: fin(m.forward), lateral: fin(m.lateral), accelAlong: fin(m.accelAlong),
    turnRate: fin(m.turnRate), facing: fin(m.facing), down: m.down === true,
  };
}

export function initialGait(): GaitState {
  return { phase: 0, style: 'stand', styleT: 10, lean: 0, roll: 0, acc: 0, turn: 0, side: 1 };
}

/** Angle between his travel and his facing, 0..PI. */
const offOf = (m: Motion): number => (m.speed > 1e-6 ? Math.atan2(Math.abs(m.lateral), m.forward) : 0);
/** His travel direction as a body-frame yaw. */
const travelYawOf = (m: Motion): number => (m.speed > 1e-6 ? Math.atan2(m.lateral, m.forward) : 0);

/** Follow r exactly within skateFollow, then turn smoothly back to 0 at r = +-PI (continuous all the way round). */
function follow(r: number): number {
  const a = GAIT.skateFollow;
  return r * (1 - smooth((Math.abs(r) - a) / (Math.PI - a)));
}
/** Heading of his skates for travel `ty` in the forward styles (along travel), and backward (along reversed travel). */
export const forwardHeading = (ty: number): number => follow(wrap(ty));
export const backwardHeading = (ty: number): number => follow(wrap(ty + Math.PI));

function classify(cur: Style, m: Motion, acc: number, turn: number, passive: boolean): Style {
  const G = GAIT;
  if (m.down) return 'down';
  const sp = m.speed, off = offOf(m), raw = m.accelAlong;
  const pushing = cur === 'stride' || cur === 'sprint' ? acc > G.strideExit : acc > G.strideEnter && raw > G.strideRawMin && !passive;
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
  if (!passive && sp > G.stopMinSpeed && acc < G.stopEnter && raw < G.stopRawMax && notBehind) return 'stop';
  const inCross = cur === 'crossover';
  const canStart = !passive && raw > G.crossRawMin && raw < G.impulseAccel;
  const sideways = off > (inCross ? G.crossOffExit : G.crossOffEnter) && (inCross || canStart);
  const hardTurn = sp > (inCross ? G.crossTurnSpeedExit : G.crossTurnSpeedEnter)
    && Math.abs(turn) > (inCross ? G.crossTurnExit : G.crossTurnEnter) && (inCross || (canStart && acc > G.crossTurnMinAcc));
  if (sideways || hardTurn) return 'crossover';
  if (cur === 'sprint') {
    // Flat out for as long as he holds his speed. Braking hard holds it until the stop takes over, rather than blending
    // through a glide; easing off goes straight to a glide (a stride for a moment between would be one more change).
    const fast = sp > G.sprintSpeedExit;
    if (fast && !passive && (acc > G.sprintAccExit || raw < G.stopRawMax)) return 'sprint';
    return !passive && acc > G.strideEnter && !fast ? 'stride' : 'glide';
  }
  if (!pushing) return 'glide';
  // Flat out: only from a stride, and never while carried along by a shove.
  return cur === 'stride' && !passive && raw > G.strideRawMin && sp > G.sprintSpeedEnter && acc > G.sprintAccEnter ? 'sprint' : 'stride';
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
    case 'sprint': {
      // Longer pushes at a little less than the stride's rate at the same speed: about 1.8 to 2.1 a second.
      const pushes = clamp(1.0 + 0.09 * m.speed + 0.04 * Math.max(0, acc), 1.2, 2.1);
      return pushes / 2;
    }
    case 'glide': return 0.2; // slow weight shifts
    case 'crossover': return clamp(0.8 + 0.07 * m.speed, 0.8, 1.4);
    case 'backward': return (0.5 + 0.05 * m.speed) * backEffort(acc);
    default: return 0;
  }
}

/** Whether a style's cycle is at a natural point to leave it. */
function atBreak(style: Style, phase: number): boolean {
  const q = frac(phase);
  if (style === 'stride' || style === 'sprint') return q < 0.1 || (q >= 0.5 && q < 0.6);
  if (style === 'crossover') return q >= 0.45 && q < 0.75;
  return true;
}

/** Share of the current style in the pose shown (the rest is `from`). */
function blendWeight(g: GaitState): number {
  if (!g.from || g.from.length === 0) return 1;
  return smooth((g.blendT ?? g.styleT) / (g.blendDur ?? GAIT.blend));
}

/** The pose shown now, as a mix of styles: `from` faded by the blend, plus the current style. */
function shownMix(g: GaitState): MixPart[] {
  const w = blendWeight(g), parts: MixPart[] = [];
  const put = (style: Style, side: 1 | -1, share: number): void => {
    if (share <= 1e-6) return;
    const same = parts.find((p) => p.style === style && p.side === side);
    if (same) same.w += share; else parts.push({ style, side, w: share });
  };
  if (w < 1) for (const p of g.from!) put(p.style, p.side, p.w * (1 - w));
  put(g.style, g.side ?? 1, w);
  return parts;
}

/**
 * Advance the gait by `dt` seconds of motion. `carrying`, when given, says whether he has the puck: his hands and
 * stick then go over to (or back from) carrying it over GAIT.puckBlend seconds (GaitState.puck), which poseOf uses in
 * place of its `hasPuck` option, so picking the puck up or losing it never snaps the arms or the stick.
 */
export function stepGait(g: GaitState, motion: Motion, dt: number, carrying?: boolean): GaitState {
  const m = sane(motion);
  const h = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
  const raw = m.accelAlong;
  const impulse = raw > GAIT.impulseAccel;
  let passive = Math.max(0, (g.passive ?? 0) - h);
  if (impulse) passive = GAIT.passiveT;
  else if (raw > GAIT.effortAccel) passive = 0;
  const acc = ease(fin(g.acc ?? 0), impulse ? 0 : clamp(raw, -GAIT.accClamp, GAIT.accClamp), GAIT.accTau, h);
  const turnRate = ease(fin(g.turn ?? 0), m.turnRate, GAIT.turnTau, h);
  const side = g.side ?? 1;
  const ty = travelYawOf(m);
  const held = fin(g.travel ?? ty);
  const step = clamp(wrap(ty - held) * (1 - Math.exp(-h / GAIT.travelTau)), -GAIT.travelMaxRate * h, GAIT.travelMaxRate * h);
  const travel = m.speed > GAIT.moveExit ? held + step : held;

  let want = classify(g.style, m, acc, turnRate, passive > 0);
  const urgent = want === 'down' || g.style === 'down' || want === 'stop';
  // Times are taken at the end of this step, so a change lands on the first frame at or after its moment.
  const inStyle = g.styleT + h;
  if (want !== g.style && !urgent && (inStyle < GAIT.minDwell || (!atBreak(g.style, g.phase) && inStyle < GAIT.minDwell + GAIT.maxBreakWait))) want = g.style;

  let wantSide = side;
  if (want === 'crossover') wantSide = crossSide(m, turnRate, side, g.style !== 'crossover');
  else if (want === 'stop' && g.style !== 'stop') wantSide = stopSide(travel, turnRate);
  else if (want === 'stop' && Math.abs(travel) > 1.2 && sign(travel) === side) {
    // His travel has swung well round to the side his toes point: turn the skates the other way.
    wantSide = stopSide(travel, turnRate);
  }
  if (want === g.style && wantSide !== side && inStyle < GAIT.minDwell) wantSide = side;

  const styleChanged = want !== g.style;
  const changed = styleChanged || wantSide !== side;
  const next: GaitState = {
    phase: g.phase + phaseRate(want, m, acc) * h,
    style: want,
    // A side change keeps the style's clock (and so its dwell) running; only the blend restarts.
    styleT: styleChanged ? 0 : g.styleT + h,
    lean: ease(fin(g.lean), want === 'down' ? 0 : clamp(0.045 * acc, -0.25, 0.35), GAIT.leanTau, h),
    roll: ease(fin(g.roll), want === 'down' || m.speed < GAIT.moveExit ? 0 : clamp(0.85 * Math.atan((m.speed * turnRate) / 9.81), -0.6, 0.6), GAIT.rollTau, h),
    acc,
    speed: ease(fin(g.speed ?? m.speed), m.speed, GAIT.speedTau, h),
    turn: turnRate,
    travel: wrap(travel),
    side: wantSide,
  };
  if (passive > 0) next.passive = passive;
  if (typeof carrying === 'boolean') {
    const k = clamp01(fin(g.puck ?? (carrying ? 1 : 0)));
    next.puck = carrying ? Math.min(1, k + h / GAIT.puckBlend) : Math.max(0, k - h / GAIT.puckBlend);
  } else if (g.puck !== undefined) next.puck = g.puck;
  if (changed) {
    // Blend from exactly the pose shown at this moment, whatever blend was under way.
    const from = shownMix(g);
    next.from = from;
    next.blendT = 0;
    next.blendDur = want === 'down' || from.some((p) => p.style === 'down') ? GAIT.blendDown
      : want !== 'stride' && from.some((p) => p.style === 'sprint' && p.w > 0.05) ? GAIT.blendSprint : GAIT.blend;
  } else if (g.from && blendWeight(g) < 1) {
    next.from = g.from;
    next.blendT = (g.blendT ?? g.styleT) + h;
    next.blendDur = g.blendDur ?? GAIT.blend;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Pose

/**
 * A style's pose before it is fitted to the body. The top (stick) hand is placed from the pelvis centre (it rides at
 * the hip on the side away from the blade); the free hand, when it swings, from its own shoulder. `blade` is where on
 * the ice the stick should point (body frame, from the pelvis): the fit aims the shaft from the top hand toward it.
 */
type RawLeg = { foot: Vec3; footYaw: number };
type RawPose = {
  hipY: number; pitch: number; roll: number; yaw: number; twist: number; look: number;
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
};

const armReach = (d: BodyDims): number => d.upperArm + d.forearm;
/** Share of the stick between its butt and the top hand. */
const STICK_GRIP = 0.14;

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

/** An arm hanging at angle `a` from straight down (forward positive), `k` of full reach, `out` sideways share. */
const swingArm = (a: number, k: number, out: number, R: number): Vec3 => v3(R * k * Math.sin(a), -R * k * Math.cos(a), R * out);

/** Turn a leg pattern built facing along travel to heading H (feet and skates), hips opening by half of it. */
function headed(legs: [RawLeg, RawLeg], H: number): [RawLeg, RawLeg] {
  return legs.map((l) => ({ foot: turn(l.foot, H), footYaw: l.footYaw + H })) as [RawLeg, RawLeg];
}

/** Head turned toward where he is going (forward styles), within a comfortable neck turn. */
const lookAt = (H: number): number => clamp(0.8 * H, -0.8, 0.8);

/** The top hand at the right hip, in front of the pelvis (scaled to his size). */
const hipHand = (d: BodyDims, x: number, y: number, z: number): Vec3 => { const s = d.torso / 0.533; return v3(x * s, y * s, z * s); };

/**
 * Athletic stance: knees bent, hips back over the heels, torso forward, both hands on the stick with its blade on the
 * ice in front and out to his forehand side. `crouch` (0..1) lowers it into a centre's faceoff stance.
 */
function standPose(d: BodyDims, lean: number, crouch: number, dot: Vec3 | undefined): RawPose {
  const half = (d.shoulderWidth / 2) * (1.15 + 0.25 * crouch);
  const blade = v3(0.85, 0, -0.65);
  return {
    hipY: d.hipHeight * (0.89 - 0.17 * crouch), pitch: 0.36 + 0.4 * crouch + 0.2 * lean, roll: 0, yaw: 0, twist: 0, look: 0,
    legs: [{ foot: v3(0.16 + 0.04 * crouch, 0, -half), footYaw: -0.18 }, { foot: v3(0.16 + 0.04 * crouch, 0, half), footYaw: 0.18 }],
    top: hipHand(d, 0.22 + 0.04 * crouch, -0.12 * crouch, 0.1 - 0.06 * crouch), freeRel: swingArm(0.3, 0.95, -0.1, armReach(d)), twoHands: 1,
    // In the faceoff crouch the stick points at the dot.
    blade: dot ? lerp3(blade, v3(dot.x, 0, dot.z), crouch) : lerp3(blade, v3(0.9, 0, -0.2), crouch),
  };
}

function glidePose(d: BodyDims, ph: number, H: number, lean: number): RawPose {
  const R = armReach(d), half = d.shoulderWidth / 2;
  const shift = 0.03 * Math.sin(TAU * ph); // small weight shifts from skate to skate
  return {
    hipY: d.hipHeight * 0.94, pitch: 0.45 + 0.6 * lean, roll: 0.04 * Math.sin(TAU * ph), yaw: 0.5 * H, twist: 0, look: lookAt(H),
    legs: headed([{ foot: v3(0.08, 0, -half - shift), footYaw: -0.05 }, { foot: v3(0.04, 0, half - shift), footYaw: 0.05 }], H),
    top: hipHand(d, 0.28, 0.04, 0.1), freeRel: swingArm(0.3, 0.95, -0.1, R), twoHands: 1,
    blade: add(turn(v3(0.95, 0, -0.5), 0.3 * H), v3(0, 0, 0.05 * Math.sin(TAU * ph))),
  };
}

/** Stride: share of the cycle each leg spends on the ice (glide then push), and where the push starts. */
const STRIDE_STANCE = 0.6, STRIDE_PUSH = 0.15, STRIDE_SET_YAW = 0.08;

/**
 * Forward stride (power 0) or sprint (power 1). Each leg (left at phase q = ph, right half a cycle later): on the ice
 * for q in [0, 0.6) (a short glide under the body, then a push back and out at 45 degrees to his travel with the skate turned out), then lifted
 * and recovered under the body to set down pointing along travel. Double support around q = 0 and 0.5, so one skate
 * is always down. Built facing along travel, then turned to heading H. The shoulders counter-rotate against the legs;
 * at full effort the free hand lets go of the stick and swings, at an easy pace both hands stay on it.
 * The sprint is the same pattern driven harder: head down, deeper lean and knees, longer pushes, a bigger arm drive, and
 * the stick carried in the top hand only with the blade off the ice. Sharing the pattern keeps the two in step, so a
 * blend between them at the same phase is smooth.
 */
function stridePose(d: BodyDims, ph: number, speed: number, acc: number, H: number, lean: number, power = 0): RawPose {
  const R = armReach(d);
  const amp = lerp(strideAmp(speed, acc), 1, power);
  // Striding well off his facing (squared up, moving at an angle) takes shorter pushes, not a wide split.
  const offFacing = 1 - 0.5 * smooth((Math.abs(H) - 0.4) / 0.8);
  const reach = (0.62 + 0.05 * power) * (d.thigh + d.shin) * amp * offFacing;
  const diag = reach * Math.SQRT1_2;
  const baseZ = d.hipWidth / 2 + 0.02;
  const setX = 0.1;
  // Weight over the gliding skate: the pelvis moves toward the leg that has just set down.
  const shiftZ = -0.06 * amp * Math.cos(TAU * (ph - 0.2));
  const legs = ([-1, 1] as const).map((sg, i): RawLeg => {
    const q = frac(ph + (i === 0 ? 0 : 0.5));
    const endX = setX - 0.06 - diag, endZ = sg * (baseZ + diag), endYaw = sg * (STRIDE_SET_YAW + 0.55);
    let foot: Vec3, yaw: number;
    if (q < STRIDE_STANCE) {
      const e = smooth((q - STRIDE_PUSH) / (STRIDE_STANCE - STRIDE_PUSH));
      const x = setX - 0.06 * clamp01(q / STRIDE_PUSH) - diag * e;
      foot = v3(x, 0, sg * (baseZ + diag * e));
      yaw = sg * (STRIDE_SET_YAW + 0.55 * e);
    } else {
      const u = (q - STRIDE_STANCE) / (1 - STRIDE_STANCE), s = smooth(u);
      foot = v3(lerp(endX, setX, s), 0.13 * amp * Math.sin(Math.PI * u), lerp(endZ, sg * baseZ, s) - sg * 0.04 * Math.sin(Math.PI * u));
      // Toe turns back from the push to set down exactly as the next glide starts.
      yaw = lerp(endYaw, sg * STRIDE_SET_YAW, s);
    }
    foot.z -= shiftZ;
    return { foot, footYaw: yaw };
  }) as [RawLeg, RawLeg];
  // Arms swing opposite the legs, evenly: a skate pushed back brings that side's arm forward (the left arm is furthest
  // forward as the left push ends, q = 0.6). The free (left) arm swings big; the stick hand rides at the hip.
  const s = amp * Math.sin(TAU * (ph - 0.35));
  const drive = 0.55 + 0.1 * power; // free arm swing
  return {
    hipY: d.hipHeight * (0.92 - 0.02 * amp - 0.035 * power), pitch: 0.4 + 0.12 * amp + 0.17 * power + lean, roll: shiftZ * 0.8,
    yaw: 0.5 * H - 0.08 * s, twist: (0.14 + 0.06 * power) * s, look: lookAt(H), lookDown: 0.4 * power,
    legs: headed(legs, H),
    // Sprinting, the stick hand pumps too, forward and back beside the hip.
    top: hipHand(d, 0.22 - (0.04 + 0.08 * power) * s, 0.04, 0.12), freeRel: swingArm(0.2 + drive * s, 0.93, -0.08 - 0.12 * Math.max(0, -s), R),
    twoHands: clamp01((0.75 - amp) / 0.2) * (1 - power),
    blade: turn(v3(0.95, 0, -0.5 - 0.04 * s), 0.3 * H),
    bladeUp: GAIT.sprintBladeUp * power,
  };
}

/** Crossover windows: outside skate lifted [0, CROSS_LAND); inside pushes [CROSS_LAND, CROSS_LIFT), lifted after. */
const CROSS_LAND = 0.45, CROSS_LIFT = 0.75;

/**
 * Crossover toward side `dir` (+1: +z of the pattern). The outside leg lifts and crosses over in front of the inside
 * one (ph 0 to 0.45), then rides back out under the body while the inside leg pushes under and out behind it (0.45 to
 * 0.75) and recovers (0.75 to 1). Built facing along travel and turned to heading H; the body rolls into the turn, so
 * the skates sit outward of the pelvis.
 */
function crossoverPose(d: BodyDims, ph: number, H: number, dir: 1 | -1, lean: number, roll: number, speed: number): RawPose {
  // A slow crossover is a short, narrow step; the full width comes with speed.
  const wide = 0.55 + 0.45 * clamp01((speed - 2.5) / 4.5);
  const R = armReach(d), u = (d.shoulderWidth / 2) * wide;
  const p = frac(ph);
  const hipY = d.hipHeight * 0.9;
  const bodyRoll = roll + dir * 0.12;
  const inYaw = dir * 0.06; // skates slightly into the turn
  // Outside leg.
  let o: Vec3, oYaw = inYaw;
  if (p < CROSS_LAND) {
    const t = p / CROSS_LAND, s = smooth(t);
    o = v3(lerp(-0.08, 0.15, s), 0.12 * Math.sin(Math.PI * t), dir * lerp(-1.3 * u, 1.0 * u, s));
    oYaw += dir * 0.15 * Math.sin(Math.PI * t);
  } else {
    const s = smooth((p - CROSS_LAND) / (1 - CROSS_LAND));
    o = v3(lerp(0.15, -0.08, s), 0, dir * lerp(1.0 * u, -1.3 * u, s));
  }
  // Inside leg.
  let iFoot: Vec3, iYaw = inYaw;
  if (p < CROSS_LAND) {
    const s = smooth(p / CROSS_LAND);
    iFoot = v3(lerp(0, -0.03, s), 0, dir * lerp(1.1 * u, 0.85 * u, s));
  } else if (p < CROSS_LIFT) {
    const s = smooth((p - CROSS_LAND) / (CROSS_LIFT - CROSS_LAND));
    iFoot = v3(lerp(-0.03, -0.18, s), 0, dir * lerp(0.85 * u, -0.3 * u, s));
    iYaw += dir * 0.15 * s;
  } else {
    const t = (p - CROSS_LIFT) / (1 - CROSS_LIFT), s = smooth(t);
    iFoot = v3(lerp(-0.18, 0, s), 0.08 * Math.sin(Math.PI * t), dir * lerp(-0.3 * u, 1.1 * u, s));
    iYaw += dir * 0.15 * (1 - s);
  }
  const pattern: [RawLeg, RawLeg] = dir > 0
    ? [{ foot: o, footYaw: oYaw }, { foot: iFoot, footYaw: iYaw }]
    : [{ foot: iFoot, footYaw: iYaw }, { foot: o, footYaw: oYaw }];
  const legs = headed(pattern, H);
  const outShift = -Math.sign(bodyRoll) * hipY * Math.sin(Math.min(0.6, Math.abs(bodyRoll))) * 0.4 * wide;
  for (const l of legs) l.foot.z += outShift;
  return {
    hipY, pitch: 0.45 + 0.8 * lean, roll: bodyRoll, yaw: 0.5 * H + dir * 0.1, twist: dir * 0.12, look: clamp(lookAt(H) + dir * 0.25, -0.9, 0.9),
    legs,
    top: hipHand(d, 0.24, 0.02, 0.1), freeRel: swingArm(0.4, 0.9, -0.1, R), twoHands: 1,
    blade: turn(v3(0.9, 0, -0.5 + 0.15 * dir), 0.3 * H),
  };
}

/**
 * Backward: seated (hips low and back, torso fairly upright), squared to the way he faces, feet a little wider than
 * his shoulders, both skates always on the ice. Each leg in turn (left ph 0 to 0.5, right 0.5 to 1) sweeps a C-cut: out
 * to the side and forward in a half circle with the toe turned in, then rides back under the body. Built for
 * straight-backward travel and turned to heading H (along his reversed travel).
 */
function backwardPose(d: BodyDims, ph: number, acc: number, H: number, lean: number): RawPose {
  const R = armReach(d), half = d.shoulderWidth * 0.5 + 0.03;
  const eff = backEffort(acc), A = 0.24 * eff * (d.thigh + d.shin) / 0.9;
  const p = frac(ph);
  const legs = ([-1, 1] as const).map((sg, i): RawLeg => {
    const q = frac(p + (i === 0 ? 0 : 0.5));
    let x = 0.06, z = sg * half, yaw = sg * 0.08;
    if (q < 0.5) {
      const t = Math.PI * (q / 0.5);
      x += 0.6 * A * (1 - Math.cos(t)) / 2;
      z += sg * A * Math.sin(t);
      yaw -= sg * 0.55 * eff * Math.sin(t); // toe in, heel out
    } else {
      x += 0.6 * A * (1 - smooth((q - 0.5) / 0.5));
    }
    return { foot: v3(x, 0, z), footYaw: yaw };
  }) as [RawLeg, RawLeg];
  // Weight on the skate that is not cutting.
  const shift = 0.05 * eff * Math.sin(TAU * p);
  for (const l of legs) l.foot.z += shift;
  return {
    hipY: d.hipHeight * 0.86, pitch: 0.25 + 0.3 * lean, roll: -0.6 * shift, yaw: 0.5 * H, twist: 0, look: 0,
    legs: headed(legs, H),
    top: hipHand(d, 0.24, 0.05, 0.1), freeRel: swingArm(0.3, 0.9, -0.1, R), twoHands: 1,
    blade: v3(0.9, 0, -0.5),
  };
}

/**
 * Hockey stop: hips and both skates turn sideways to travel (the short way, side `s`), skates dug in well ahead of the
 * hips along travel, knees deeply bent and the hips low, the body leaning back against the way he is going; it eases
 * upright as his speed drops.
 */
function stopPose(d: BodyDims, speed: number, travel: number, s: 1 | -1, lean: number): RawPose {
  const R = armReach(d), half = (d.shoulderWidth / 2) * 1.1;
  const k = clamp01((speed - 0.5) / 3);
  // The hips turn most of the way sideways and follow his travel a little; sin keeps that continuous (and within
  // about 1.4 rad of his facing) however far round his travel swings while he pivots.
  const ty = travel;
  const pelvis = s * (Math.PI / 2) * (0.55 + 0.25 * k) + 0.6 * Math.sin(ty);
  // Skates a little further round than the hips: about square to travel, never pointing back past ~130 degrees.
  const skate = pelvis + s * 0.4;
  const ahead = 0.38 * k * (d.thigh + d.shin) / 0.9;
  const ax = Math.cos(ty) * ahead, az = Math.sin(ty) * ahead;
  const legs = ([-1, 1] as const).map((sg): RawLeg => ({
    foot: v3(-sg * half * Math.sin(pelvis) + ax, 0, sg * half * Math.cos(pelvis) + az),
    footYaw: skate,
  })) as [RawLeg, RawLeg];
  // Lean back against travel: pitch back along it, roll away from its sideways part.
  const back = 0.3 * k - 0.4 * Math.min(0, lean);
  return {
    hipY: d.hipHeight * (1 - 0.25 * k), pitch: 0.25 - back * Math.cos(ty), roll: -back * Math.sin(ty), yaw: pelvis, twist: 0, look: 0,
    legs,
    top: hipHand(d, 0.22, 0.04, 0.1), freeRel: swingArm(0.3, 0.9, -0.1, R), twoHands: 1,
    blade: v3(0.9, 0, -0.6),
  };
}

/**
 * Down: sitting on the ice leaning back on his hands, knees up, skates flat in front of his hips (each foot straight
 * ahead of its hip joint and below it, so the leg solve bends the knee up and forward, never splayed).
 */
function downPose(d: BodyDims): RawPose {
  const R = armReach(d), w = d.hipWidth / 2;
  const hipY = d.skate + 0.12;
  const reachOut = 0.66 * (d.thigh + d.shin);
  const out = Math.sqrt(Math.max(0, reachOut * reachOut - (hipY - d.skate) ** 2));
  return {
    hipY, pitch: -0.4, roll: 0, yaw: 0, twist: 0, look: 0,
    legs: [{ foot: v3(out, 0, -w), footYaw: -0.15 }, { foot: v3(out, 0, w), footYaw: 0.15 }],
    top: v3(-0.17 * R, -0.36 * R, 0.55 * R), freeRel: v3(-0.15 * R, -1.1 * R, -0.25 * R), twoHands: 0,
    blade: v3(0.5, 0, 1.4),
  };
}

/**
 * Extra pose inputs the gait cannot see: `crouch` (0..1) lowers the stance, e.g. a centre at the faceoff dot; `dot` is
 * that dot in his body frame (left-shot frame: mirror z for a right shot), where the crouched stance points the stick.
 */
export type PoseOptions = {
  crouch?: number; dot?: Vec3;
  /**
   * He has the puck: both hands on the stick and the blade on the ice (where carry.ts's carryPoint puts the puck). A
   * gait stepped with `carrying` uses its eased GaitState.puck instead, so the change does not snap.
   */
  hasPuck?: boolean;
  /** Stickhandling (carry.ts stickhandle): moves where the blade is aimed (forward, toward +z) while he has the puck. */
  handle?: { dx: number; dz: number };
};

function rawPose(style: Style, g: GaitState, side: 1 | -1, m: Motion, d: BodyDims, o: PoseOptions): RawPose {
  const acc = fin(g.acc ?? m.accelAlong);
  const travel = fin(g.travel ?? travelYawOf(m));
  const phase = fin(g.phase), lean = fin(g.lean), roll = fin(g.roll), speed = fin(g.speed ?? m.speed);
  switch (style) {
    case 'stand': return standPose(d, lean, clamp01(fin(o.crouch ?? 0)), o.dot && Number.isFinite(o.dot.x) && Number.isFinite(o.dot.z) ? o.dot : undefined);
    case 'glide': return glidePose(d, phase, forwardHeading(travel), lean);
    case 'stride': return stridePose(d, phase, speed, acc, forwardHeading(travel), lean);
    case 'sprint': return stridePose(d, phase, speed, acc, forwardHeading(travel), lean, 1);
    case 'crossover': return crossoverPose(d, phase, forwardHeading(travel), side, lean, roll, speed);
    case 'backward': return backwardPose(d, phase, acc, backwardHeading(travel), lean);
    case 'stop': return stopPose(d, speed, travel, side, lean);
    case 'down': return downPose(d);
  }
}

/**
 * Weighted mix of raw poses (weights sum to 1). Every style's yaws are continuous and stay inside (-PI, PI), so they
 * mix as plain numbers (a short-way-round blend would be ambiguous between skate headings far apart).
 */
function mixRaw(parts: { raw: RawPose; w: number }[]): RawPose {
  const sum = (f: (r: RawPose) => number): number => parts.reduce((t, p) => t + f(p.raw) * p.w, 0);
  const sum3 = (f: (r: RawPose) => Vec3): Vec3 => v3(sum((r) => f(r).x), sum((r) => f(r).y), sum((r) => f(r).z));
  const leg = (i: 0 | 1): RawLeg => ({ foot: sum3((r) => r.legs[i].foot), footYaw: sum((r) => r.legs[i].footYaw) });
  return {
    hipY: sum((r) => r.hipY), pitch: sum((r) => r.pitch), roll: sum((r) => r.roll), yaw: sum((r) => r.yaw),
    twist: sum((r) => r.twist), look: sum((r) => r.look), lookDown: sum((r) => r.lookDown ?? 0),
    legs: [leg(0), leg(1)],
    top: sum3((r) => r.top), freeRel: sum3((r) => r.freeRel), twoHands: sum((r) => r.twoHands),
    blade: sum3((r) => r.blade), bladeUp: sum((r) => r.bladeUp ?? 0),
  };
}

/** Pull `p` to within `r` of `c`. */
const within = (p: Vec3, c: Vec3, r: number): Vec3 => { const v = sub(p, c), l = len(v); return l > r ? add(c, mul(v, r / l)) : p; };

/** Fit a raw pose to the body: lowest skate on the ice, hips low enough for the planted legs, hands within reach. */
function fit(raw: RawPose, d: BodyDims): SkaterPose {
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
    hipY = Math.min(hipY, lerp(limit, want, smooth(f.y / GAIT.liftFade)));
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
  const top = lift(add(v3(0, hipY, 0), raw.top), sr);
  const stickAngle = Math.atan2(raw.blade.z - top.z, raw.blade.x - top.x);
  // The top hand chokes up a little, so the blade is carried about a metre in front rather than at full stick length.
  // The shaft descends from it to the heel, on the ice or raised by bladeUp.
  const grip = STICK_GRIP * d.stick, below = d.stick - grip;
  const up = clamp(fin(raw.bladeUp ?? 0), 0, Math.max(0, top.y));
  const sinT = Math.min(1, (top.y - up) / below), cosT = Math.sqrt(1 - sinT * sinT);
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

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

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

/** A pose from poseOf: always says where the blade is and how far the head is down. */
export type SkaterPose = Pose & { blade: Vec3; lookDown: number };

/**
 * With the puck (share k, 0..1): both hands on the stick, the blade on the ice, and the stickhandle moving the blade.
 */
function withPuck(raw: RawPose, k: number, handle: PoseOptions['handle']): RawPose {
  if (k <= 0) return raw;
  const hx = clamp(fin(handle?.dx ?? 0), -0.2, 0.2), hz = clamp(fin(handle?.dz ?? 0), -0.2, 0.2);
  return {
    ...raw,
    twoHands: lerp(raw.twoHands, 1, k), bladeUp: (raw.bladeUp ?? 0) * (1 - k),
    blade: add(raw.blade, v3(hx * k, 0, hz * k)),
  };
}

export function poseOf(g: GaitState, motion: Motion, d: BodyDims, opts: PoseOptions = {}): SkaterPose {
  const m = sane(motion);
  const parts = shownMix(g).map((p) => ({ raw: rawPose(p.style, g, p.side, m, d, opts), w: p.w }));
  const k = smooth(g.puck !== undefined ? fin(g.puck) : opts.hasPuck === true ? 1 : 0);
  return fit(withPuck(parts.length === 1 ? parts[0]!.raw : mixRaw(parts), k, opts.handle), d);
}

/**
 * Two-bone leg solve with the knee bending forward (+x). From hip to ankle: hipRoll swings the leg's plane out toward
 * +z (about x), hipPitch swings the thigh forward within that plane, kneeAngle bends the shin back (0 straight). So
 * the thigh points along (sin a, -cos a cos r, cos a sin r) with a = hipPitch, r = hipRoll, and the shin along the same
 * with a = hipPitch - kneeAngle. hipRoll stays within +-PI/2 (a foot level with or above the hip is reached by
 * pitching the thigh past horizontal, not by flipping the leg over). A foot out of reach gives a straight leg pointing
 * at it; never NaN.
 */
export function solveLeg(hip: Vec3, foot: Vec3, thigh: number, shin: number): { kneeAngle: number; hipPitch: number; hipRoll: number } {
  const dx = foot.x - hip.x, dy = foot.y - hip.y, dz = foot.z - hip.z;
  const raw = Math.hypot(dx, dy, dz);
  const lo = Math.abs(thigh - shin) + 1e-9, hi = thigh + shin;
  const dist = clamp(raw, lo, hi);
  // The leg's plane through the x axis containing the foot, taken with its "down" direction below horizontal.
  const below = -dy;
  const hipRoll = below > 1e-9 ? Math.atan(dz / below) : below < -1e-9 ? Math.atan(dz / below) : dz === 0 ? 0 : sign(dz) * (Math.PI / 2);
  const down = below * Math.cos(hipRoll) + dz * Math.sin(hipRoll); // foot's coordinate along the plane's down direction
  const toFoot = raw > 1e-12 ? Math.atan2(dx, down) : 0;
  const cosKnee = clamp((thigh * thigh + shin * shin - dist * dist) / (2 * thigh * shin), -1, 1);
  const cosHip = clamp((thigh * thigh + dist * dist - shin * shin) / (2 * thigh * dist), -1, 1);
  return { kneeAngle: Math.PI - Math.acos(cosKnee), hipPitch: toFoot + Math.acos(cosHip), hipRoll };
}
