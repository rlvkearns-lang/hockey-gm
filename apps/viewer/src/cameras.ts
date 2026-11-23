import { BENCH_DOORS, RINK } from '@hockey/engine';
import type { Vec3 } from './gait';

/**
 * The watch page's camera angles (pure: no three.js, no DOM). Each angle is a rule from where the play is to where
 * the camera stands, what it looks at and how wide it sees; easeCamera moves a camera toward its target smoothly.
 *
 * World coordinates as everywhere in the viewer: engine x is world x, engine y is world z, up is world y. The benches
 * are on the side of BENCH_DOORS; the broadcast and ice-level cameras are on the other side, so on television the
 * benches are in the background.
 */

export type CameraName = 'broadcast' | 'overhead' | 'netHome' | 'netAway' | 'iceLevel' | 'follow';
export const CAMERA_NAMES: readonly CameraName[] = ['broadcast', 'overhead', 'netHome', 'netAway', 'iceLevel', 'follow'];

export type CameraInput = {
  /** Where the puck is drawn (y is its height). */
  puck: Vec3;
  /** The puck's velocity (world, m/s), if known: the broadcast camera looks a little ahead of it. */
  puckVel?: Vec3;
  /** The player the follow angle is behind; without one, follow shows the broadcast view. */
  followed?: { pos: Vec3; facing: number; vel: Vec3 };
  /** The home team attacks toward +x (periods 1 and 3); it defends the net at -x. */
  attackingRight: boolean;
  /** How much tighter the broadcast camera frames the play (1 normally; more on a small picture, such as a phone). */
  zoom?: number;
  /** The angle's last target, if it is the same angle: ice level keeps its spot while the view from it stays good. */
  current?: CameraPose;
};
/** Where the camera is, the point it looks at (world) and its vertical field of view (degrees). */
export type CameraPose = { pos: Vec3; look: Vec3; fov: number };

/** World z of the side the broadcast camera is on: the side opposite the benches. */
const NEAR = -(Math.sign(BENCH_DOORS.home.y) || -1);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Half-width of the ice at x (the corners narrow it near the ends). */
function halfWidthAt(x: number): number {
  const R = RINK.cornerRadius, cx = RINK.halfLength - R, cy = RINK.halfWidth - R;
  const ax = Math.abs(x);
  if (ax <= cx) return RINK.halfWidth;
  if (ax >= RINK.halfLength) return cy;
  return cy + Math.sqrt(Math.max(0, R * R - (ax - cx) ** 2));
}

/** Pull (x, z) inside the boards, `inset` metres in from them. */
function insideBoards(x: number, z: number, inset: number): { x: number; z: number } {
  const R = RINK.cornerRadius, cx = RINK.halfLength - R, cy = RINK.halfWidth - R;
  let px = clamp(x, -(RINK.halfLength - inset), RINK.halfLength - inset);
  let pz = clamp(z, -(RINK.halfWidth - inset), RINK.halfWidth - inset);
  const dx = Math.abs(px) - cx, dz = Math.abs(pz) - cy;
  if (dx > 0 && dz > 0) {
    const d = Math.hypot(dx, dz), r = R - inset;
    if (d > r) { px = Math.sign(px) * (cx + (dx / d) * r); pz = Math.sign(pz) * (cy + (dz / d) * r); }
  }
  return { x: px, z: pz };
}

// ---- The angles. Distances in metres, fields of view in degrees (vertical).

/** Broadcast: high in the stands opposite the benches; it pans along the rink with the puck and stops short of the ends. */
const BROADCAST = { height: 15.5, back: 29, fov: 29, maxLook: 21, follow: 0.55, lead: 0.45, maxLead: 4, zFollow: 0.35, nearBias: 1.2 };
/** Overhead: under the roof lights, over the puck's half; it stops where the end boards are still in the picture. */
const OVERHEAD = { height: 28, maxLook: 18.5, zFollow: 0.45, fov: 62 };
/**
 * Behind a net: inside the end boards, above and behind the net (the glass is behind it, the net below its line of
 * sight). It aims at the play and zooms with its distance: wide with the net, goalie and crease in front when play is
 * near, tight on the play when it is at the other end. It never looks less than `minOut` up the ice from the goal line.
 */
const NET = { fromGoalLine: 3.05, height: 6, farRise: 5, farLift: 0.08, minOut: 2.5, halfView: 6.5, minFov: 16, maxFov: 58 };
/**
 * Ice level: rinkside cameras at a few fixed spots just inside the near boards, at the eye height of a fan by the
 * glass. It takes the spot whose distance to the puck is nearest `ideal` (never under `minDist`) and keeps it while
 * the puck stays between `minDist` and `maxDist` from it, so it cuts between spots now and then rather than sliding.
 */
const ICE = { inset: 2.2, height: 1.8, spots: [-19, -6.5, 6.5, 19], minDist: 8, ideal: 12, maxDist: 25, halfView: 5 };
/** Follow: behind and above him along his travel, as in the skating test, a little higher to see the play round him. */
const FOLLOW = { back: 6, height: 3.1, ahead: 2.5, lookY: 0.8, fov: 50, turnSpeed: 1.2 };

function broadcast(input: CameraInput): CameraPose {
  const { puck, puckVel } = input;
  const lead = puckVel ? clamp(puckVel.x * BROADCAST.lead, -BROADCAST.maxLead, BROADCAST.maxLead) : 0;
  const lx = clamp(puck.x + lead, -BROADCAST.maxLook, BROADCAST.maxLook);
  const zoom = Math.max(1, input.zoom ?? 1);
  // Toward the near boards only a little in the wide view (the near stands would fill the bottom); a tight view
  // (zoom) follows the puck across the ice, or a puck on the near boards would drop out of the bottom of the picture.
  const lz = zoom > 1 ? clamp(puck.z * 0.8, -10, 11) : NEAR * BROADCAST.nearBias + clamp(NEAR * puck.z * BROADCAST.zFollow, -4, 1.8) * NEAR;
  return { pos: v3(lx * BROADCAST.follow, BROADCAST.height, NEAR * BROADCAST.back), look: v3(lx, 0, lz), fov: BROADCAST.fov / zoom };
}

function overhead(input: CameraInput): CameraPose {
  const lx = clamp(input.puck.x, -OVERHEAD.maxLook, OVERHEAD.maxLook);
  const lz = input.puck.z * OVERHEAD.zFollow;
  // A hair toward the broadcast side, so "up" in the picture is the far side (as from the broadcast camera).
  return { pos: v3(lx, OVERHEAD.height, lz + NEAR * 0.6), look: v3(lx, 0, lz), fov: OVERHEAD.fov };
}

const fovFor = (halfView: number, dist: number, lo: number, hi: number): number =>
  clamp((2 * Math.atan(halfView / Math.max(dist, 0.5)) * 180) / Math.PI, lo, hi);

function behindNet(input: CameraInput, home: boolean): CameraPose {
  // The net a team defends: home defends -x while it attacks toward +x.
  const end = (home === input.attackingRight ? -1 : 1);
  const goal = end * RINK.goalLineX;
  const { puck } = input;
  const out = Math.max(NET.minOut, (goal - puck.x) * end);
  // Far play: a little higher, and the play put in the lower part of the picture, so the long stretch of empty ice
  // between this net and the play does not fill the bottom half.
  const far = clamp((out - 10) / 30, 0, 1);
  const pos = v3(goal + end * NET.fromGoalLine, NET.height + NET.farRise * far, clamp(puck.z * 0.15, -2, 2));
  const flat = Math.hypot(out + NET.fromGoalLine, puck.z - pos.z);
  const fov = fovFor(NET.halfView, Math.hypot(flat, pos.y), NET.minFov, NET.maxFov);
  const lift = flat * Math.tan((fov * NET.farLift * far * Math.PI) / 180);
  return { pos, look: v3(goal - end * out, 0.6 + lift, puck.z), fov };
}

function iceLevel(input: CameraInput): CameraPose {
  const { puck } = input;
  const zb = NEAR * (RINK.halfWidth - ICE.inset);
  const dist = (sx: number): number => Math.hypot(puck.x - sx, puck.z - zb);
  const cur = input.current?.pos;
  let cx: number;
  if (cur && Math.abs(cur.z - zb) < 1e-6 && ICE.spots.includes(cur.x) && dist(cur.x) >= ICE.minDist && dist(cur.x) <= ICE.maxDist) cx = cur.x;
  else {
    const ok = ICE.spots.filter((sx) => dist(sx) >= ICE.minDist);
    const pool = ok.length > 0 ? ok : ICE.spots;
    cx = pool.reduce((best, sx) => (Math.abs(dist(sx) - ICE.ideal) < Math.abs(dist(best) - ICE.ideal) ? sx : best), pool[0]!);
  }
  // Zoom in so the play round the puck fills about 10 m of the picture's height.
  return { pos: v3(cx, ICE.height, zb), look: v3(puck.x, 1.0, puck.z), fov: fovFor(ICE.halfView, dist(cx), 24, 52) };
}

function follow(input: CameraInput): CameraPose {
  const f = input.followed;
  if (!f) return broadcast(input);
  const sp = Math.hypot(f.vel.x, f.vel.z);
  const heading = sp > FOLLOW.turnSpeed ? Math.atan2(f.vel.z, f.vel.x) : f.facing;
  const c = Math.cos(heading), s = Math.sin(heading);
  const at = insideBoards(f.pos.x - c * FOLLOW.back, f.pos.z - s * FOLLOW.back, 0.4);
  return { pos: v3(at.x, FOLLOW.height, at.z), look: v3(f.pos.x + c * FOLLOW.ahead, FOLLOW.lookY, f.pos.z + s * FOLLOW.ahead), fov: FOLLOW.fov };
}

/** Where angle `name` wants the camera for this moment of play. */
export function cameraTarget(name: CameraName, input: CameraInput): CameraPose {
  switch (name) {
    case 'broadcast': return broadcast(input);
    case 'overhead': return overhead(input);
    case 'netHome': return behindNet(input, true);
    case 'netAway': return behindNet(input, false);
    case 'iceLevel': return iceLevel(input);
    case 'follow': return follow(input);
  }
}

/** Seconds for the camera to cover about 63% of the way to its target (position, look point, field of view). */
const TAU = { pos: 0.45, look: 0.3, fov: 0.6 };

const toward = (a: number, b: number, k: number): number => a + (b - a) * k;
const easeVec = (a: Vec3, b: Vec3, k: number): Vec3 => v3(toward(a.x, b.x, k), toward(a.y, b.y, k), toward(a.z, b.z, k));

/** `p` moved toward `target` over `dt` seconds with time constant `tau` (never past it). */
export function easePoint(p: Vec3, target: Vec3, dt: number, tau: number): Vec3 {
  return easeVec(p, target, dt > 0 ? 1 - Math.exp(-dt / tau) : 0);
}

/**
 * The camera moved toward `target` over `dt` seconds: an exponential ease (frame-rate independent, never past the
 * target), or straight to it when `snap` (a new angle, a seek, a new game).
 */
export function easeCamera(current: CameraPose, target: CameraPose, dt: number, snap: boolean): CameraPose {
  if (snap) return { pos: { ...target.pos }, look: { ...target.look }, fov: target.fov };
  const k = (tau: number): number => (dt > 0 ? 1 - Math.exp(-dt / tau) : 0);
  return { pos: easeVec(current.pos, target.pos, k(TAU.pos)), look: easeVec(current.look, target.look, k(TAU.look)), fov: toward(current.fov, target.fov, k(TAU.fov)) };
}
