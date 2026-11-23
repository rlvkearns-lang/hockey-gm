import type { GoaliePose, GoalieState } from '@hockey/engine';
import type { BodyDims } from './body';
import { torsoRotate, type Vec3 } from './gait';

/**
 * Goalie pose maths (pure: no three.js, no DOM).
 *
 * Body frame as gait.ts: x forward (the way he faces), y up, z to his right, origin on the ice under his pelvis. Index 0
 * of legs and shoulders is his left side (z < 0), index 1 his right. The key poses are built for a goalie who catches
 * with his left hand (glove on the left, blocker and stick on the right; the engine's goalies all do) and are mirrored
 * across his centre plane for one who catches with his right.
 *
 * A pose is a mix of the six key poses (stance, butterfly, glove, blocker, pad, cover). A change of pose fades from the
 * mix shown at that moment into the new pose over INTO_SAVE seconds (a save or a cover) or TO_STANCE seconds (back to
 * the stance), so an interrupted fade never jumps. Sideways movement in the stance plays small shuffles of the pads
 * (lead skate first, then the trailing one, each lifted a few centimetres), turning into T-pushes at speed.
 */

/**
 * `pose` is the pose being faded into and `t` how far (0..1) the fade has got; `from` the pose it fades out of (or,
 * when `fromMix` is set, the exact mix shown when the fade began). `shuffle` counts shuffle cycles (signed: it runs
 * backward while he moves to his left). `lat` is his smoothed sideways speed (m/s, toward +z); `side` is the side
 * (+1 his right) of a pad save.
 */
export type GoalieGait = {
  pose: GoaliePose;
  t: number;
  from: GoaliePose;
  shuffle: number;
  fromMix?: Partial<Record<GoaliePose, number>>;
  lat?: number;
  side?: 1 | -1;
};

/**
 * What stepGoalie needs from the engine: his pose and poseT, his speed toward his right (`lateral`, m/s) and his speed.
 * `side` (optional) is which side of him the puck is (+1 his right, -1 his left), to pick the pad a pad save kicks
 * out; without it the pad goes to the side he is moving. `speed` is accepted but not used yet: gliding straight in or
 * out of his crease keeps the pads planted.
 */
export type GoalieInput = { pose: GoaliePose; poseT: number; lateral: number; speed: number; side?: number };

/** `up` is the skate's up axis (sole to ankle), `toe` its forward hint, `padFace` the way the leg pad's front faces. */
export type GoalieLegPose = { hip: Vec3; knee: Vec3; ankle: Vec3; foot: Vec3; up: Vec3; toe: Vec3; padFace: Vec3 };

/**
 * A goalie's figure in the body frame. `pitch` (forward) then `roll` (toward +z) tilt the torso about the pelvis as
 * torsoRotate does; `look` is the head's pitch down from level. `glove` and `blocker` are the hand centres, with the
 * way the glove's pocket and the blocker's board face. `blade.heel` is the stick's heel (on the ice unless a save lifts
 * it) and `blade.dir` the way the blade runs from it; the shaft runs from the heel up through the blocker hand.
 */
export type GoalieFigurePose = {
  catches: 'L' | 'R';
  hipY: number; pitch: number; roll: number; look: number;
  legs: [GoalieLegPose, GoalieLegPose];
  shoulders: [Vec3, Vec3];
  glove: Vec3; gloveFace: Vec3;
  blocker: Vec3; blockerFace: Vec3;
  blade: { heel: Vec3; dir: Vec3 };
};

export const GOALIE = {
  /** Fade times (s): into a save, into a cover, and back to the stance. */
  intoSave: 0.12,
  intoCover: 0.2,
  toStance: 0.3,
  /** Smoothing of his sideways speed (s). */
  latTau: 0.1,
  /** Length of one shuffle cycle (m of sideways travel): longer as he moves faster (T-pushes). */
  shuffleLen: 0.3,
  shufflePerSpeed: 0.12,
  /** Sideways speed (m/s) at which the shuffle is at full size; and where T-pushes start and are full. */
  shuffleFull: 0.5,
  tPushFrom: 1.8,
  tPushSpan: 1.2,
  /** Shuffle size: how far each skate moves either way (m) and how high it lifts (m), for a 1.88 m goalie. */
  shuffleReach: 0.07,
  shuffleLift: 0.035,
} as const;

const POSES: readonly GoaliePose[] = ['stance', 'butterfly', 'glove', 'blocker', 'pad', 'cover'];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const frac = (v: number): number => v - Math.floor(v);
const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
const ease = (v: number, target: number, tau: number, dt: number): number => v + (target - v) * (1 - Math.exp(-dt / tau));
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3, fallback: Vec3 = v3(0, 1, 0)): Vec3 => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : fallback; };

/**
 * Two-bone solve: from `a` toward `b` with bones l1 and l2, the middle joint bent toward `pole`. Returns the middle
 * joint and the end (which is `b` when it is in reach). (Copied from rig.ts, where it is private; the goalie rig uses
 * this one for the arms.)
 */
export function twoBone(a: Vec3, b: Vec3, l1: number, l2: number, pole: Vec3): { mid: Vec3; end: Vec3 } {
  const d = sub(b, a), raw = len(d);
  const u = raw > 1e-9 ? mul(d, 1 / raw) : v3(0, -1, 0);
  const dist = Math.min(Math.max(raw, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = sub(pole, mul(u, dot(pole, u)));
  if (len(p) < 1e-6) p = Math.abs(u.y) < 0.9 ? sub(v3(0, 1, 0), mul(u, u.y)) : sub(v3(1, 0, 0), mul(u, u.x));
  p = mul(p, 1 / len(p));
  return { mid: add(add(a, mul(u, x)), mul(p, h)), end: add(a, mul(u, dist)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Stepping

export function initialGoalieGait(): GoalieGait {
  return { pose: 'stance', t: 1, from: 'stance', shuffle: 0, lat: 0, side: 1 };
}

/** What stepGoalie needs, read from his engine state. */
export function goalieMotion(s: GoalieState): GoalieInput {
  const c = Math.cos(s.facing), n = Math.sin(s.facing);
  return { pose: s.pose, poseT: s.poseT, lateral: -s.vel.x * n + s.vel.y * c, speed: Math.hypot(s.vel.x, s.vel.y) };
}

const fadeTime = (to: GoaliePose): number => (to === 'stance' ? GOALIE.toStance : to === 'cover' ? GOALIE.intoCover : GOALIE.intoSave);

/** The mix of key poses shown for a gait (weights sum to 1). */
function mixOf(g: GoalieGait): Map<GoaliePose, number> {
  const w = smooth(g.t), m = new Map<GoaliePose, number>();
  const put = (p: GoaliePose, share: number): void => { if (share > 1e-6) m.set(p, (m.get(p) ?? 0) + share); };
  if (w < 1) {
    if (g.fromMix) for (const p of POSES) put(p, (g.fromMix[p] ?? 0) * (1 - w));
    else put(g.from, 1 - w);
  }
  put(g.pose, w);
  return m;
}

export function stepGoalie(g: GoalieGait, s: GoalieInput, dt: number): GoalieGait {
  const h = clamp(fin(dt), 0, 0.25);
  const want: GoaliePose = s.poseT > 0 && POSES.includes(s.pose) ? s.pose : 'stance';
  const lateral = fin(s.lateral);
  const lat = ease(fin(g.lat ?? 0), lateral, GOALIE.latTau, h);
  const shuffle = fin(g.shuffle) + (lateral * h) / (GOALIE.shuffleLen + GOALIE.shufflePerSpeed * Math.min(Math.abs(lat), 4));
  let side = g.side ?? 1;
  if (want === g.pose) {
    const t = Math.min(1, fin(g.t) + h / fadeTime(want));
    const next: GoalieGait = { pose: want, t, from: t >= 1 ? want : g.from, shuffle, lat, side };
    if (t < 1 && g.fromMix) next.fromMix = g.fromMix;
    return next;
  }
  const shown = mixOf(g);
  // A pad save goes to the puck's side, else the way he is moving; not while a pad is still showing (no jump).
  if (want === 'pad' && (shown.get('pad') ?? 0) < 0.01) {
    const puck = fin(s.side ?? 0);
    side = puck !== 0 ? (puck > 0 ? 1 : -1) : Math.abs(lateral) > 0.05 ? (lateral > 0 ? 1 : -1) : side;
  }
  let from: GoaliePose = g.pose, best = -1;
  const fromMix: Partial<Record<GoaliePose, number>> = {};
  for (const [p, w] of shown) { fromMix[p] = w; if (w > best) { best = w; from = p; } }
  return { pose: want, t: Math.min(1, h / fadeTime(want)), from, fromMix, shuffle, lat, side };
}

// ---------------------------------------------------------------------------------------------------------------
// Key poses (catching with the left hand)

type KeyLeg = { knee: Vec3; ankle: Vec3; up: Vec3; toe: Vec3; face: Vec3 };
type Key = {
  hipY: number; pitch: number; roll: number; look: number;
  legs: [KeyLeg, KeyLeg];
  glove: Vec3; gloveFace: Vec3; blocker: Vec3; blockerFace: Vec3; heel: Vec3; bladeDir: Vec3;
};

const UPV = v3(0, 1, 0);
/** Half the distance between his hip joints (a goalie sits wide). */
const hipHalf = (d: BodyDims): number => (d.hipWidth / 2) * 1.1;
/** His height scale: 1 for a 1.88 m goalie. */
const scaleOf = (d: BodyDims): number => d.torso / 0.288 / 1.88;
const sideZ = (i: 0 | 1): number => (i === 0 ? -1 : 1);

/**
 * The stance legs: knees bent deep and in, pads together at the knees, skates wide and turned out a little (an A). The
 * hips sit at the height that puts both skates on the ice.
 */
function stanceLegs(d: BodyDims): { hipY: number; legs: [KeyLeg, KeyLeg] } {
  const hw = hipHalf(d);
  const tn = norm(v3(0.7, -0.68, 0.08)), sn = norm(v3(-0.6, -0.72, 0.35));
  const hipY = d.skate - (d.thigh * tn.y + d.shin * sn.y);
  const leg = (i: 0 | 1): KeyLeg => {
    const z = sideZ(i);
    const hip = v3(0, hipY, z * hw);
    const knee = add(hip, mul(v3(tn.x, tn.y, z * tn.z), d.thigh));
    const ankle = add(knee, mul(v3(sn.x, sn.y, z * sn.z), d.shin));
    return { knee, ankle, up: UPV, toe: v3(Math.cos(0.35), 0, z * Math.sin(0.35)), face: v3(1, 0, 0) };
  };
  return { hipY, legs: [leg(0), leg(1)] };
}

/** Knee height of a knee on the ice (the knee pad's thickness). */
const KNEE_DOWN = 0.1;

/** The butterfly hips: the height that puts a knee on the ice with the thigh nearly upright. */
const butterflyHipY = (d: BodyDims): number => {
  const k = scaleOf(d), dx = 0.1 * k, dz = 0.13 * k - hipHalf(d);
  return KNEE_DOWN + Math.sqrt(Math.max(0, d.thigh * d.thigh - dx * dx - dz * dz));
};

/** A butterfly leg: knee down in front of him, shin flat on the ice flared out to the side, pad face square ahead. */
function butterflyLeg(d: BodyDims, i: 0 | 1): KeyLeg {
  const k = scaleOf(d), z = sideZ(i);
  const knee = v3(0.1 * k, KNEE_DOWN, z * 0.13 * k);
  const sn = norm(v3(-0.3, 0.03, z * 0.95));
  const ankle = add(knee, mul(sn, d.shin));
  return { knee, ankle, up: mul(sn, -1), toe: v3(-1, 0.3, z * 0.2), face: v3(1, 0.15, 0) };
}

/** A leg kicked straight out to side `s` along the ice (a pad save), toe up, pad face square ahead. */
function kickLeg(d: BodyDims, hipY: number, s: 1 | -1): KeyLeg {
  const k = scaleOf(d);
  const hip = v3(0, hipY, s * hipHalf(d));
  const { mid: knee, end: ankle } = twoBone(hip, v3(0.15 * k, 0.13, s * 0.88 * k), d.thigh, d.shin, v3(0.4, 1, 0));
  return { knee, ankle, up: norm(sub(knee, ankle)), toe: UPV, face: v3(1, 0.1, 0) };
}

function keyPose(p: GoaliePose, d: BodyDims, side: 1 | -1): Key {
  const k = scaleOf(d);
  const s = (x: number, y: number, z: number): Vec3 => v3(x * k, y * k, z * k);
  const stance = stanceLegs(d);
  const base: Key = {
    hipY: stance.hipY, pitch: 0.32, roll: 0, look: 0.15, legs: stance.legs,
    glove: s(0.45, 0.92, -0.45), gloveFace: norm(v3(1, 0, -0.15)),
    blocker: s(0.46, 0.76, 0.32), blockerFace: norm(v3(1, 0, 0.15)),
    heel: s(0.68, 0, 0.1), bladeDir: norm(v3(0.25, 0, -1)),
  };
  const bfY = butterflyHipY(d);
  const bfLegs: [KeyLeg, KeyLeg] = [butterflyLeg(d, 0), butterflyLeg(d, 1)];
  switch (p) {
    case 'stance':
      return base;
    case 'glove':
      // The glove flashes up and out to his catching side; the body stays square, leaning a little into it.
      return { ...base, pitch: 0.24, roll: -0.18, look: 0, glove: s(0.3, 1.38, -0.78), gloveFace: norm(v3(1, 0.1, 0.1)) };
    case 'blocker': {
      // The blocker punches out to his stick side, the stick swinging with it off the ice.
      const blocker = s(0.32, 1.0, 0.75);
      return { ...base, pitch: 0.24, roll: 0.18, look: 0.05, blocker, blockerFace: norm(v3(1, 0, 0.3)), heel: add(blocker, s(0.16, -0.86, 0.12)), bladeDir: norm(v3(0.3, 0, -1)) };
    }
    case 'butterfly':
      return {
        hipY: bfY, pitch: 0.1, roll: 0, look: 0.1, legs: bfLegs,
        glove: s(0.48, 0.8, -0.5), gloveFace: norm(v3(1, 0, -0.1)),
        blocker: s(0.42, 0.58, 0.38), blockerFace: norm(v3(1, 0, 0.15)),
        heel: s(0.62, 0, 0.08), bladeDir: norm(v3(0.15, 0, -1)),
      };
    case 'pad': {
      // Half butterfly: the far knee down, the save leg kicked out along the ice to the puck's side.
      const out: 0 | 1 = side > 0 ? 1 : 0;
      const legs: [KeyLeg, KeyLeg] = [bfLegs[0], bfLegs[1]];
      legs[out] = kickLeg(d, bfY, side);
      return {
        hipY: bfY, pitch: 0.18, roll: 0.22 * side, look: 0.15, legs,
        glove: side < 0 ? s(0.5, 0.62, -0.62) : s(0.45, 0.82, -0.5), gloveFace: norm(v3(1, 0, -0.2)),
        blocker: s(0.42, 0.55, 0.45), blockerFace: norm(v3(1, 0, 0.2)),
        heel: s(0.62, 0, 0.25), bladeDir: norm(v3(0.3, 0, -1)),
      };
    }
    case 'cover': {
      // Down over the puck: knees down, chest forward over the pads, glove flat on the ice in front, blocker beside it.
      const blocker = v3(0.72 * k, 0.15, 0.25 * k);
      return {
        hipY: bfY, pitch: 1.3, roll: 0, look: 0.55, legs: bfLegs,
        glove: v3(0.82 * k, 0.12, -0.12 * k), gloveFace: v3(0, -1, 0),
        blocker, blockerFace: v3(0, 1, 0),
        heel: v3(0.78 * k, 0, 1.02 * k), bladeDir: norm(v3(1, 0, 0.1)),
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The figure

/** One skate's part in a shuffle: a quick lifted step over `span` of the cycle from `start`, then a slow slide back. */
function shuffleFoot(q: number, start: number, span: number): { off: number; lift: number } {
  const u = frac(q - start);
  if (u < span) { const v = u / span; return { off: -1 + 2 * smooth(v), lift: Math.sin(Math.PI * v) }; }
  return { off: 1 - (2 * (u - span)) / (1 - span), lift: 0 };
}

const mirror = (v: Vec3): Vec3 => v3(v.x, v.y, -v.z);

function mirrorFigure(p: GoalieFigurePose): GoalieFigurePose {
  const leg = (l: GoalieLegPose): GoalieLegPose => ({
    hip: mirror(l.hip), knee: mirror(l.knee), ankle: mirror(l.ankle), foot: mirror(l.foot), up: mirror(l.up), toe: mirror(l.toe), padFace: mirror(l.padFace),
  });
  return {
    catches: 'R', hipY: p.hipY, pitch: p.pitch, roll: -p.roll, look: p.look,
    legs: [leg(p.legs[1]), leg(p.legs[0])],
    shoulders: [mirror(p.shoulders[1]), mirror(p.shoulders[0])],
    glove: mirror(p.glove), gloveFace: mirror(p.gloveFace), blocker: mirror(p.blocker), blockerFace: mirror(p.blockerFace),
    blade: { heel: mirror(p.blade.heel), dir: mirror(p.blade.dir) },
  };
}

/** Pull `hand` in toward `shoulder` so it is within `reach`. */
function inReach(hand: Vec3, shoulder: Vec3, reach: number): Vec3 {
  const r = sub(hand, shoulder), l = len(r);
  return l > reach ? add(shoulder, mul(r, reach / l)) : hand;
}

/**
 * A goalie's pose before its limbs are solved (the left-catching frame: goaliePoseOf mirrors the fitted figure for a
 * right-catching goalie). The key poses shown are mixed into it; overlays (animator.ts GoalieOverlay) may then move
 * its targets: the pelvis and torso, each leg's knee hint and ankle (where the pad goes), the glove and the blocker
 * (pulled into reach by the fit), the stick heel and the way the blade runs. `shuffle` is how much of the skates'
 * sideways shuffle is shown (`move`, 0..1), the lead skate's T-push turn (`tPush`, 0..1), the shuffle cycle (`q`) and
 * his sideways speed (`lat`, its sign picks the lead skate); fitGoalie adds the steps to the ankles.
 */
export type GoalieRawLeg = { knee: Vec3; ankle: Vec3; up: Vec3; toe: Vec3; face: Vec3 };
export type GoalieRaw = {
  hipY: number; pitch: number; roll: number; look: number;
  legs: [GoalieRawLeg, GoalieRawLeg];
  glove: Vec3; gloveFace: Vec3; blocker: Vec3; blockerFace: Vec3; heel: Vec3; bladeDir: Vec3;
  shuffle: { move: number; tPush: number; q: number; lat: number };
};

/** The side a pad save kicks out to, in the left-catching frame of the raw pose. */
const rawSide = (g: GoalieGait, catches: 'L' | 'R'): 1 | -1 => ((g.side ?? 1) > 0 ? 1 : -1) * (catches === 'R' ? -1 : 1) as 1 | -1;

/** One key pose as a raw pose (no shuffle): for an overlay that blends toward a pose the engine is not showing. */
export function goalieKeyRaw(p: GoaliePose, d: BodyDims, side: 1 | -1): GoalieRaw {
  const key = keyPose(p, d, side);
  return {
    hipY: key.hipY, pitch: key.pitch, roll: key.roll, look: key.look,
    legs: [{ ...key.legs[0] }, { ...key.legs[1] }],
    glove: key.glove, gloveFace: key.gloveFace, blocker: key.blocker, blockerFace: key.blockerFace, heel: key.heel, bladeDir: key.bladeDir,
    shuffle: { move: 0, tPush: 0, q: 0, lat: 0 },
  };
}

/** The raw pose a gait shows: its key poses mixed by their shares, with the shuffle it calls for. */
export function goalieRaw(g: GoalieGait, d: BodyDims, catches: 'L' | 'R'): GoalieRaw {
  // Worked out catching left; a right-catching goalie is the mirror image, so his pad save to his right is a left one here.
  const side = rawSide(g, catches);
  const mix = mixOf(g);
  let hipY = 0, pitch = 0, roll = 0, look = 0;
  const zero = (): Vec3 => v3(0, 0, 0);
  const legAcc = [0, 1].map(() => ({ knee: zero(), ankle: zero(), up: zero(), toe: zero(), face: zero() }));
  let glove = zero(), gloveFace = zero(), blocker = zero(), blockerFace = zero(), heel = zero(), bladeDir = zero();
  for (const [p, w] of mix) {
    const key = keyPose(p, d, side);
    hipY += key.hipY * w; pitch += key.pitch * w; roll += key.roll * w; look += key.look * w;
    for (const i of [0, 1] as const) {
      const a = legAcc[i]!, l = key.legs[i];
      a.knee = add(a.knee, mul(l.knee, w)); a.ankle = add(a.ankle, mul(l.ankle, w));
      a.up = add(a.up, mul(l.up, w)); a.toe = add(a.toe, mul(l.toe, w)); a.face = add(a.face, mul(l.face, w));
    }
    glove = add(glove, mul(key.glove, w)); gloveFace = add(gloveFace, mul(key.gloveFace, w));
    blocker = add(blocker, mul(key.blocker, w)); blockerFace = add(blockerFace, mul(key.blockerFace, w));
    heel = add(heel, mul(key.heel, w)); bladeDir = add(bladeDir, mul(key.bladeDir, w));
  }
  // Shuffle: on his feet (stance, glove, blocker) sideways movement steps the skates, lead skate first.
  const standing = (mix.get('stance') ?? 0) + (mix.get('glove') ?? 0) + (mix.get('blocker') ?? 0);
  const lat = fin(g.lat ?? 0);
  const move = clamp01(Math.abs(lat) / GOALIE.shuffleFull) * standing;
  const tPush = clamp01((Math.abs(lat) - GOALIE.tPushFrom) / GOALIE.tPushSpan) * standing;
  return {
    hipY, pitch, roll, look, legs: [legAcc[0]!, legAcc[1]!],
    glove, gloveFace, blocker, blockerFace, heel, bladeDir,
    shuffle: { move, tPush, q: frac(fin(g.shuffle)), lat },
  };
}

const mixV = (a: Vec3, b: Vec3, w: number): Vec3 => v3(a.x + (b.x - a.x) * w, a.y + (b.y - a.y) * w, a.z + (b.z - a.z) * w);
/** `a` and `b` mixed: `a` itself at w <= 0, `b` itself at w >= 1 (the shuffle cycle and lead are `a`'s). */
export function mixGoalieRaw(a: GoalieRaw, b: GoalieRaw, w: number): GoalieRaw {
  const k = fin(w);
  if (k <= 0) return a;
  if (k >= 1) return b;
  const n = (x: number, y: number): number => x + (y - x) * k;
  const leg = (i: 0 | 1): GoalieRawLeg => {
    const p = a.legs[i], q = b.legs[i];
    return { knee: mixV(p.knee, q.knee, k), ankle: mixV(p.ankle, q.ankle, k), up: mixV(p.up, q.up, k), toe: mixV(p.toe, q.toe, k), face: mixV(p.face, q.face, k) };
  };
  return {
    hipY: n(a.hipY, b.hipY), pitch: n(a.pitch, b.pitch), roll: n(a.roll, b.roll), look: n(a.look, b.look),
    legs: [leg(0), leg(1)],
    glove: mixV(a.glove, b.glove, k), gloveFace: mixV(a.gloveFace, b.gloveFace, k), blocker: mixV(a.blocker, b.blocker, k),
    blockerFace: mixV(a.blockerFace, b.blockerFace, k), heel: mixV(a.heel, b.heel, k), bladeDir: mixV(a.bladeDir, b.bladeDir, k),
    shuffle: { move: n(a.shuffle.move, b.shuffle.move), tPush: n(a.shuffle.tPush, b.shuffle.tPush), q: a.shuffle.q, lat: a.shuffle.lat },
  };
}

/**
 * Solve a raw pose onto his body: the shuffle's steps added to the ankles (never through the ice), each leg a two-bone
 * solve from the hip to the ankle bending toward its knee hint, the shoulders from the torso, the hands pulled into
 * reach, the blade heel on or above the ice; mirrored for a right-catching goalie.
 */
export function fitGoalie(raw: GoalieRaw, d: BodyDims, catches: 'L' | 'R'): GoalieFigurePose {
  const { hipY, pitch, roll, look } = raw;
  const k = scaleOf(d);
  const { move, tPush, q, lat } = raw.shuffle;
  const steps = [shuffleFoot(q, 0.2, 0.35), shuffleFoot(q, 0, 0.35)];
  const lead: 0 | 1 = lat >= 0 ? 1 : 0;

  const hw = hipHalf(d);
  const legs = ([0, 1] as const).map((i): GoalieLegPose => {
    const a = raw.legs[i];
    const hip = v3(0, hipY, sideZ(i) * hw);
    const up = norm(a.up);
    let toe = norm(a.toe, v3(1, 0, 0));
    if (i === lead && tPush > 0) {
      // T-push: the lead skate turns toward where he is going.
      const yaw = (lat >= 0 ? 1 : -1) * 1.1 * tPush, c = Math.cos(yaw), sn = Math.sin(yaw);
      toe = v3(toe.x * c - toe.z * sn, toe.y, toe.x * sn + toe.z * c);
    }
    const st = steps[i]!;
    let ankleWant = add(a.ankle, v3(0, GOALIE.shuffleLift * k * move * st.lift, GOALIE.shuffleReach * k * move * st.off));
    // Never put the skate through the ice.
    const sole = ankleWant.y - up.y * d.skate;
    if (sole < 0) ankleWant = add(ankleWant, v3(0, -sole, 0));
    const { mid, end } = twoBone(hip, ankleWant, d.thigh, d.shin, sub(a.knee, hip));
    const knee = v3(mid.x, Math.max(0, mid.y), mid.z);
    const foot = sub(end, mul(up, d.skate));
    return { hip, knee, ankle: end, foot: v3(foot.x, Math.max(0, foot.y), foot.z), up, toe, padFace: norm(a.face, v3(1, 0, 0)) };
  }) as [GoalieLegPose, GoalieLegPose];

  const shoulders = ([0, 1] as const).map((i) => add(v3(0, hipY, 0), torsoRotate(v3(0, d.torso, (sideZ(i) * d.shoulderWidth) / 2), pitch, roll))) as [Vec3, Vec3];
  const reach = (d.upperArm + d.forearm) * 0.995;
  const { glove, gloveFace, blocker, blockerFace, heel, bladeDir } = raw;
  const out: GoalieFigurePose = {
    catches: 'L', hipY, pitch, roll, look, legs, shoulders,
    glove: inReach(glove, shoulders[0], reach), gloveFace: norm(gloveFace, v3(1, 0, 0)),
    blocker: inReach(blocker, shoulders[1], reach), blockerFace: norm(blockerFace, v3(1, 0, 0)),
    blade: { heel: v3(heel.x, Math.max(0, heel.y), heel.z), dir: norm(bladeDir, v3(0, 0, -1)) },
  };
  return catches === 'R' ? mirrorFigure(out) : out;
}

/** A goalie's figure: the gait's raw pose, solved (goalieRaw then fitGoalie). */
export function goaliePoseOf(g: GoalieGait, d: BodyDims, catches: 'L' | 'R'): GoalieFigurePose {
  return fitGoalie(goalieRaw(g, d, catches), d, catches);
}
