import { BENCH_DOORS, RINK } from '@hockey/engine';
import type { Vec3 } from './gait';

/**
 * The watch page's camera angles (pure: no three.js, no DOM). Each angle is a rule from where the play is to where
 * the camera stands, what it looks at and how wide it sees; the operator (operator.ts) gives it a calm point to watch
 * (the play with a dead zone round it, not the puck's every move) and moves the camera toward the angle's target with
 * limited speed and acceleration. Every angle is calm: the players move, not the frame.
 *
 * World coordinates as everywhere in the viewer: engine x is world x, engine y is world z, up is world y. The benches
 * are on the side of BENCH_DOORS; the broadcast and ice-level cameras are on the other side, so on television the
 * benches are in the background.
 */

export type CameraName = 'broadcast' | 'overhead' | 'overheadWide' | 'netHome' | 'netAway' | 'iceLevel' | 'follow';
/** In the order of the page's buttons and its keys 1 to 7. */
export const CAMERA_NAMES: readonly CameraName[] = ['broadcast', 'overhead', 'overheadWide', 'netHome', 'netAway', 'iceLevel', 'follow'];

export type CameraInput = {
  /** The point to watch: where the puck is drawn (y is its height), or the operator's calm point round it. */
  puck: Vec3;
  /** The puck's velocity (world, m/s), if known: the broadcast camera looks a little ahead of it. */
  puckVel?: Vec3;
  /**
   * The player the follow angle is behind; without one, follow shows the broadcast view. `heading` (the operator's
   * smoothed direction of his travel) is used when given, so the camera does not swing when he turns his body.
   */
  followed?: { pos: Vec3; facing: number; vel: Vec3; heading?: number };
  /** The overhead camera's zone: the x of the middle of the zone it shows (the operator picks it); default from the puck. */
  zoneX?: number;
  /** The home team attacks toward +x (periods 1 and 3); it defends the net at -x. */
  attackingRight: boolean;
  /** How much tighter the broadcast camera frames the play (1 normally; more on a small picture, such as a phone). */
  zoom?: number;
  /** The angle's last target, if it is the same angle: ice level keeps its spot while the view from it stays good. */
  current?: CameraPose;
  /**
   * A board battle under way: its spot (world, on the ice) and how far the camera has eased onto it (0..1, the
   * operator eases it in and out). The broadcast camera closes in on it, and over the near boards climbs and looks down
   * more steeply so the bodies are seen over the boards.
   */
  battle?: { spot: Vec3; k: number };
  /**
   * A goal's hold (0..1): the cameras look right up to the net (the puck, as the operator gives it, is then the net
   * and the scorer), and the broadcast camera frames it a little tighter.
   */
  goal?: { k: number };
};
/** Where the camera is, the point it looks at (world) and its vertical field of view (degrees). */
export type CameraPose = { pos: Vec3; look: Vec3; fov: number };

/** World z of the side the broadcast camera is on: the side opposite the benches. */
const NEAR = -(Math.sign(BENCH_DOORS.home.y) || -1);
/** The side (sign of world z) of the broadcast and ice-level cameras, opposite the benches. */
export const BROADCAST_SIDE: 1 | -1 = NEAR > 0 ? 1 : -1;

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

/**
 * Broadcast: a television camera on a fixed platform high in the stands opposite the benches, at centre ice. It pans
 * (turns) to follow the play and never chases the puck: it looks along the rink at the operator's calm point (no
 * further than `maxLook` toward an end), at a steady height and tilt (`nearBias` m toward its own side of centre, so the
 * near boards are at the bottom of the picture and the far ones well inside it). Only a tight picture (`zoom`, a
 * phone) also tilts to follow the play across the ice.
 */
const BROADCAST = { height: 15.5, back: 29, fov: 29, maxLook: 21, nearBias: 4.5 };
/**
 * On a board battle the broadcast camera frames it `zoom` times tighter and looks at its spot. On the near boards
 * (within `nearFrom` m of them) it climbs `rise` m higher and comes `closer` m in from its rail, so its line of sight
 * clears the boards' top (BOARD_TOP) down to a skater's thigh a step off them.
 */
const BATTLE_VIEW = { zoom: 2.3, rise: 3, closer: 6.5, nearFrom: 4 };
/** Height (m) of the boards' top edge (arena.ts BOARD_H). */
export const BOARD_TOP = 1.07;
/** On a goal's hold the broadcast and overhead cameras may look this much further toward the end (m), and the broadcast one frames this many times tighter. */
const GOAL_VIEW = { reach: 4.5, overheadReach: 7, zoom: 1.35 };
/**
 * Overhead: under the roof lights, straight down on one zone at a time: the defensive, neutral or offensive third, with
 * overlap (a 16:9 picture shows the whole width of the ice and about 48 m of its length). The zones' middles are at
 * -zoneX, 0 and zoneX (the end ones reach just past the end boards); the operator picks one and slides between them.
 * Never turned: the near side always at the bottom of the picture, +x always to the right.
 */
const OVERHEAD = { height: 28, fov: 52, zoneX: 7.7 };
/** Overhead, whole rink: still, high over centre ice (under the roof lights), the whole rink in a 16:9 picture. */
const OVERHEAD_WIDE = { height: 28.5, fov: 64 };
/**
 * Behind a net: inside the end boards, above and behind the net (the glass is behind it, the net below its line of
 * sight). It aims at the play and zooms with its distance: wide with the net, goalie and crease in front when play is
 * near, tight on the play when it is at the other end. It never looks less than `minOut` up the ice from the goal line.
 */
const NET = { fromGoalLine: 3.05, height: 6, farRise: 5, farLift: 0.08, minOut: 2.5, halfView: 6.5, minFov: 16, maxFov: 58 };
/**
 * Ice level: rinkside cameras at a few fixed spots just inside the near boards, at the eye height of a fan by the
 * glass. It takes the spot whose distance to the puck is nearest `ideal` (never under `minDist`) and keeps it while
 * the puck stays between `keepMin` and `keepMax` from it, so it cuts between spots now and then rather than sliding.
 */
const ICE = { inset: 2.2, height: 1.8, spots: [-19, -6.5, 6.5, 19], minDist: 8, ideal: 12, maxDist: 25, keepMin: 7.5, keepMax: 32, halfView: 5 };
/** Follow: behind and above him along his travel (the operator's smoothed heading of it), a little higher to see the play round him. */
const FOLLOW = { back: 6, height: 3.1, ahead: 2.5, lookY: 0.8, fov: 50, turnSpeed: 1.2 };
/** Below this speed (m/s) a skater's travel has no direction: the follow camera keeps the heading it had. */
export const FOLLOW_TURN_SPEED = FOLLOW.turnSpeed;

function broadcast(input: CameraInput): CameraPose {
  const { puck } = input;
  const gk = clamp(input.goal?.k ?? 0, 0, 1), maxLook = BROADCAST.maxLook + GOAL_VIEW.reach * gk;
  const lx = clamp(puck.x, -maxLook, maxLook);
  const zoom = Math.max(1, input.zoom ?? 1) * (1 + (GOAL_VIEW.zoom - 1) * gk);
  // A steady tilt in the wide view; a tight view (zoom) follows the play across the ice, or a puck on the near boards
  // would drop out of the bottom of the picture.
  const lz = zoom > 1 ? clamp(puck.z * 0.8, -10, 11) : NEAR * BROADCAST.nearBias;
  // On a goal's hold it looks at the net itself.
  const pose = { pos: v3(0, BROADCAST.height, NEAR * BROADCAST.back), look: v3(lx, 0, toward(lz, puck.z, gk)), fov: BROADCAST.fov / zoom };
  const b = input.battle;
  if (!b || !(b.k > 0)) return pose;
  // A board battle: closer in on its spot; on the near boards, higher and steeper over them.
  const k = clamp(b.k, 0, 1), sx = clamp(b.spot.x, -BROADCAST.maxLook - 4, BROADCAST.maxLook + 4);
  const near = k * clamp((NEAR * b.spot.z - (halfWidthAt(b.spot.x) - BATTLE_VIEW.nearFrom)) / 2, 0, 1);
  pose.look = v3(toward(pose.look.x, sx, k), toward(0, 0.9, k), toward(pose.look.z, b.spot.z, k));
  // (Square on to it along the rail, so the boards run across the picture.)
  pose.pos = v3(toward(pose.pos.x, sx, k), pose.pos.y + BATTLE_VIEW.rise * near, pose.pos.z - NEAR * BATTLE_VIEW.closer * near);
  pose.fov = pose.fov / (1 + (BATTLE_VIEW.zoom - 1) * k);
  return pose;
}

/** The middle (x) of the overhead camera's zone for a point at x: the defensive, neutral or offensive third. */
export function overheadZoneX(x: number): number {
  return x < -RINK.blueLineX ? -OVERHEAD.zoneX : x > RINK.blueLineX ? OVERHEAD.zoneX : 0;
}
/** The middles of the overhead camera's three zones. */
export const OVERHEAD_ZONES: readonly number[] = [-OVERHEAD.zoneX, 0, OVERHEAD.zoneX];

function overhead(input: CameraInput): CameraPose {
  const lx = input.zoneX ?? overheadZoneX(input.puck.x);
  // A hair toward the broadcast side, so "up" in the picture is the far side (as from the broadcast camera).
  return { pos: v3(lx, OVERHEAD.height, NEAR * 0.6), look: v3(lx, 0, 0), fov: OVERHEAD.fov };
}

function overheadWide(): CameraPose {
  return { pos: v3(0, OVERHEAD_WIDE.height, NEAR * 0.6), look: v3(0, 0, 0), fov: OVERHEAD_WIDE.fov };
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
  // (Square behind the net: it turns to the play, it does not slide.)
  const pos = v3(goal + end * NET.fromGoalLine, NET.height + NET.farRise * far, 0);
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
  // (On a goal's hold it keeps its spot: no cut in the celebration; every spot sees both nets from over 7.5 m.)
  if (cur && Math.abs(cur.z - zb) < 1e-6 && ICE.spots.includes(cur.x) && ((input.goal?.k ?? 0) > 0 || (dist(cur.x) >= ICE.keepMin && dist(cur.x) <= ICE.keepMax))) cx = cur.x;
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
  const heading = f.heading ?? (sp > FOLLOW.turnSpeed ? Math.atan2(f.vel.z, f.vel.x) : f.facing);
  const c = Math.cos(heading), s = Math.sin(heading);
  const at = insideBoards(f.pos.x - c * FOLLOW.back, f.pos.z - s * FOLLOW.back, 0.4);
  return { pos: v3(at.x, FOLLOW.height, at.z), look: v3(f.pos.x + c * FOLLOW.ahead, FOLLOW.lookY, f.pos.z + s * FOLLOW.ahead), fov: FOLLOW.fov };
}

/**
 * Where an angle turns from (world x, z on the ice), for the operator's dead zone (which is in turn and distance from
 * there): the broadcast platform, the camera behind a net, ice level's spot (`current`, its last place); null for an
 * angle that does not turn to follow the play (overhead, follow).
 */
export function cameraPivot(name: CameraName, attackingRight: boolean, current?: CameraPose): { x: number; z: number } | null {
  switch (name) {
    case 'broadcast': return { x: 0, z: NEAR * BROADCAST.back };
    case 'netHome': case 'netAway': {
      const end = (name === 'netHome') === attackingRight ? -1 : 1;
      return { x: end * (RINK.goalLineX + NET.fromGoalLine), z: 0 };
    }
    case 'iceLevel': return current ? { x: current.pos.x, z: current.pos.z } : null;
    default: return null;
  }
}

/** Where angle `name` wants the camera for this moment of play. */
export function cameraTarget(name: CameraName, input: CameraInput): CameraPose {
  switch (name) {
    case 'broadcast': return broadcast(input);
    case 'overhead': return overhead(input);
    case 'overheadWide': return overheadWide();
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
 * target), or straight to it when `snap` (a new angle, a seek, a new game); `quick` scales its time constants.
 */
export function easeCamera(current: CameraPose, target: CameraPose, dt: number, snap: boolean, quick = 1): CameraPose {
  if (snap) return { pos: { ...target.pos }, look: { ...target.look }, fov: target.fov };
  // `quick` (0..1] shortens every time constant (a goal's hold swings straight onto the net).
  const q = quick > 0 && quick <= 1 ? quick : 1;
  const k = (tau: number): number => (dt > 0 ? 1 - Math.exp(-dt / (tau * q)) : 0);
  return { pos: easeVec(current.pos, target.pos, k(TAU.pos)), look: easeVec(current.look, target.look, k(TAU.look)), fov: toward(current.fov, target.fov, k(TAU.fov)) };
}
