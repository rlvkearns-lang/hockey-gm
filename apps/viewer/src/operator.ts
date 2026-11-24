import { BROADCAST_PLACE, broadcastBaseFov, cameraPivot, cameraTarget, easePoint, FOLLOW_TURN_SPEED, OVERHEAD_ZONES, overheadZoneX, type CameraInput, type CameraName, type CameraPose } from './cameras';
import type { CutKind } from './cuts';
import type { Vec3 } from './pose-mix';

/**
 * The camera operator (pure: no three.js, no DOM): from the play each frame to where the camera is. Its job is to be
 * calm: the players move, not the frame.
 *
 * - It watches a calm point, not the puck: the point moves only when the puck (or, on a goal, the net) leaves a dead zone
 *   round it (CALM[angle].dead, m along and across the ice), so small moves of the puck do not move the camera, and a
 *   quick pass back and forth inside the zone moves it not at all (no pan reversals: the puck must cross the whole zone
 *   before the camera turns back).
 * - It moves the camera toward the angle's target (cameras.ts) with limited speed and acceleration (CALM[angle].look
 *   for the point it looks at, .pos for where it stands, .fovRate for its zoom, degrees a second), never past it.
 * - The overhead camera shows one zone at a time (cameras.ts overheadZoneX) and moves to another only when the play has
 *   clearly gone there (ZONE_MARGIN past the blue line) and stayed ZONE_DWELL seconds; then it slides there slowly.
 *   The whole-rink overhead never moves.
 * - The follow camera follows the player's travel: its heading turns toward his direction of travel at most
 *   FOLLOW_TURN_RATE a second, and holds while he stands, so turning his body does not swing it.
 *
 * It cuts (jumps straight to the target) on a seek or a new game (`snap`), a new angle (withCamera), the scene's cut
 * when play restarts at a faceoff or the teams change ends (`cut` 'restart' or 'ends'), the followed player stepping
 * on or off while following him, and when the angle's own target jumps further than a camera can move (ice level
 * changing spot): more than CUT_JUMP within one engine tick of game time. Across the scene's other cuts ('jump': the
 * engine moving the puck in the middle of play) it eases.
 *
 * After a goal (input `goal`, from goal-show.ts: weight 1 for GOAL_HOLD_SECONDS, then easing to 0, gone by the next drop
 * of the puck) it holds on the net scored on and the scorer instead of the play: the dead zone closes and the camera
 * may move faster (a real event), the broadcast camera tightens a little, and the engine's restart (the puck put on the
 * centre dot) does not cut the camera while it holds (a change of ends does). As the hold lets go after such a restart,
 * the camera cuts to the restart (as a director would) rather than swinging across the rink. A board battle eases the
 * broadcast camera onto it over BATTLE_EASE (never a cut).
 */

/** How the camera may move (per angle): its look point and its place (m/s, m/s^2, and the time constant toward the target, s). */
export type Limit = { v: number; a: number; tau: number };
/**
 * `dead`: the dead zone along and across the ice (m), for an angle that does not turn from a pivot; `turn` and `range`:
 * the dead zone for one that does (cameras.ts cameraPivot), in its turn (as a share of the picture's half width, at
 * 16:9) and as a share of the distance from it; `tilt` (broadcast, from its platform up in the stands): the dead zone
 * in its tilt instead of the distance, as a share of the picture's half height.
 */
export type Calm = { dead: { x: number; z: number }; turn?: number; range?: number; tilt?: number; look: Limit; pos: Limit; fovRate: number };
export const CALM: Record<CameraName, Calm> = {
  broadcast: { dead: { x: 6, z: 2.5 }, turn: 0.2, tilt: 0.2, look: { v: 45, a: 120, tau: 0.35 }, pos: { v: 1, a: 1, tau: 1 }, fovRate: 10 },
  overhead: { dead: { x: 0, z: 0 }, look: { v: 8, a: 7, tau: 0.9 }, pos: { v: 8, a: 7, tau: 0.9 }, fovRate: 4 },
  overheadWide: { dead: { x: 0, z: 0 }, look: { v: 7, a: 4, tau: 0.9 }, pos: { v: 7, a: 4, tau: 0.9 }, fovRate: 4 },
  netHome: { dead: { x: 3, z: 1.5 }, turn: 0.35, range: 0.15, look: { v: 28, a: 20, tau: 0.4 }, pos: { v: 2, a: 2, tau: 1 }, fovRate: 8 },
  netAway: { dead: { x: 3, z: 1.5 }, turn: 0.35, range: 0.15, look: { v: 28, a: 20, tau: 0.4 }, pos: { v: 2, a: 2, tau: 1 }, fovRate: 8 },
  iceLevel: { dead: { x: 2, z: 1.5 }, turn: 0.3, range: 0.12, look: { v: 28, a: 20, tau: 0.4 }, pos: { v: 4, a: 4, tau: 0.8 }, fovRate: 12 },
  follow: { dead: { x: 0, z: 0 }, look: { v: 10, a: 12, tau: 0.3 }, pos: { v: 10, a: 12, tau: 0.3 }, fovRate: 5 },
};
/** The overhead camera changes zone only once the play is this far (m) past the blue line, and has stayed there this long (s). */
export const ZONE_MARGIN = 2, ZONE_DWELL = 1;
/** The follow camera's heading turns at most this fast (rad/s) toward the player's direction of travel. */
export const FOLLOW_TURN_RATE = 1.2;
/** On a goal's hold the camera's limits are this many times higher (at full hold): a real event, it is on the net at once. */
export const HOLD_QUICK = 10;
/**
 * However quick the hold, the look point moves at most HOLD_MAX.v m/s and accelerates at most HOLD_MAX.a m/s^2: a fast
 * pan onto the net that arrives in about 0.6 to 0.8 s, not a whip.
 */
export const HOLD_MAX = { v: 30, a: 70 };
/** The broadcast camera's distance zoom changes only once it is this share off (hysteresis), at CALM.broadcast.fovRate. */
export const ZOOM_STEP = 0.15;
/**
 * The broadcast camera leads the play, as a television operator does: it watches where the puck will be `base` s on
 * (to `base + rush` s at `rushFrom + rushSpan` m/s and over), `across` as much across the ice as along it, at most
 * `max` m ahead, from the puck's velocity smoothed over `tau` s (a quick pass back and forth averages out); so on a zone entry the end and its net come into the picture before the puck does (with END_BIAS).
 */
export const LEAD = { base: 0.55, rush: 0.25, rushFrom: 8, rushSpan: 10, across: 0.5, max: 14, tau: 0.25 };
/**
 * And it looks toward the end the play is in or coming to: up to END_BIAS.m metres further toward that end, growing from
 * END_BIAS.from m from centre ice over END_BIAS.span m, so at a blue line the zone and its net are already in the picture.
 */
export const END_BIAS = { m: 6, from: 2, span: 6 };
/** How fast a zoom slows as it arrives (degrees a second squared). */
export const FOV_BRAKE = 20;

/**
 * The jump rule. A camera place that moves more than CUT_JUMP metres within CUT_WINDOW seconds of game time (one
 * engine tick) has jumped: 150 m/s held over a tick, far faster than any camera follows play. The move is measured
 * against where the target was a window ago, not the frame before, so a jump spread over a tick's frames and one made
 * in a single frame are judged alike at every frame rate. A frame longer than the window (fast playback on a slow
 * machine) adds CUT_SPEED m/s for the excess.
 */
export const CUT_JUMP = 5, CUT_WINDOW = 1 / 30, CUT_SPEED = 60;

export type CameraOperator = {
  camera: CameraName;
  /** Where the camera is now, and how fast its look point, its place and its field of view are moving. */
  cam: CameraPose;
  lookV: Vec3; posV: Vec3;
  /** The calm point the camera watches (the play, with the dead zone round it). */
  aim: Vec3;
  /** The angle's last target (for the jump rule, and so ice level keeps its spot), or null after a new angle or game. */
  lastTarget: CameraPose | null;
  /** Whether the followed player was on the ice at the last step, and the follow camera's heading (rad; null: none yet). */
  followOn: boolean; heading: number | null;
  /** The overhead camera's zone (its middle, x), the zone the play is in if that differs, and for how long (s). */
  zone: number; zoneNext: number; zoneFor: number;
  /** Game time (s) stepped, and the target's place at the recent steps (within CUT_WINDOW, and the last one). */
  clock: number;
  trail: readonly { t: number; x: number; z: number }[];
  /** The next step cuts (a new angle or a new operator). */
  pending: boolean;
  /** How far the camera has eased onto a board battle (0..1), and the battle spot it watches (eased). */
  battleK: number; battleSpot: Vec3;
  /**
   * A goal's hold at the last step (0..1), whether the engine restarted play while it held (cut when it lets go), and
   * whether that cut has been made (the rest of the hold is then not shown).
   */
  holdK: number; restartHeld: boolean; holdCut: boolean;
  /** The puck's velocity, smoothed, that the broadcast camera leads by. */
  leadV: Vec3;
  /** The broadcast camera's distance zoom (its field of view before event zoom), or 0 before the first step. */
  zoomBase: number;
};

/**
 * One frame for the operator: where the puck is drawn and its velocity, which way the home team attacks, how much
 * tighter the broadcast camera should frame (a small picture), the player followed (when he is on the ice), the
 * scene's cut on this frame, if any, and `snap` for a seek or a new game.
 */
export type OperatorInput = Omit<CameraInput, 'current' | 'battle' | 'goal'> & {
  cut?: CutKind | null | undefined; snap?: boolean; battle?: Vec3 | null;
  /** A goal's hold (goal-show.ts GoalShow.hold): the net scored on (world), the scorer if on the ice, and its weight. */
  goal?: { net: Vec3; scorer?: Vec3 | null; k: number } | null;
};

/** On a goal the camera watches the net, moved toward the scorer by half his distance from it, at most HOLD_REACH m. */
export const HOLD_REACH = 1.5;

/** The point a goal's hold watches: the net, toward the scorer (if any) by half his distance, at most HOLD_REACH. */
export function holdPoint(net: Vec3, scorer: Vec3 | null | undefined): Vec3 {
  if (!scorer) return { x: net.x, y: 0, z: net.z };
  const dx = (scorer.x - net.x) / 2, dz = (scorer.z - net.z) / 2, d = Math.hypot(dx, dz), k = d > HOLD_REACH ? HOLD_REACH / d : 1;
  return { x: net.x + dx * k, y: 0, z: net.z + dz * k };
}

/** Seconds the camera takes to ease onto a board battle (and off it when it ends), and to follow its spot. */
export const BATTLE_EASE = 1, BATTLE_SPOT_TAU = 0.8;

const zero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
export function initialOperator(camera: CameraName): CameraOperator {
  return {
    camera, cam: { pos: { x: 0, y: 15, z: 29 }, look: zero(), fov: 30 }, lookV: zero(), posV: zero(), aim: zero(), lastTarget: null,
    followOn: false, heading: null, zone: 0, zoneNext: 0, zoneFor: 0, pending: true, clock: 0, trail: [], battleK: 0, battleSpot: zero(), holdK: 0, restartHeld: false, holdCut: false, zoomBase: 0, leadV: zero(),
  };
}

/** The operator on angle `name`: its next step cuts to it. */
export function withCamera(op: CameraOperator, name: CameraName): CameraOperator {
  return { ...op, camera: name, lastTarget: name === op.camera ? op.lastTarget : null, pending: true, trail: [] };
}

/** The operator with no memory of its angle's last target (a new game: ice level picks its spot afresh). */
export function forgetTarget(op: CameraOperator): CameraOperator {
  return { ...op, lastTarget: null, trail: [] };
}

/**
 * Where the target was at game time `t`, from the trail: between the two steps either side of it (straight between
 * them), or the oldest step if the trail does not go back that far, with `late` the seconds that step is older than
 * `t` (positive only for a frame longer than the window). Undefined for an empty trail.
 */
function placeAgo(trail: readonly { t: number; x: number; z: number }[], t: number): { x: number; z: number; late: number } | undefined {
  if (trail.length === 0) return undefined;
  const first = trail[0]!;
  if (first.t >= t - 1e-9) return { x: first.x, z: first.z, late: 0 };
  for (let i = 1; i < trail.length; i++) {
    const b = trail[i]!;
    if (b.t >= t) {
      const a = trail[i - 1]!, k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, late: 0 };
    }
  }
  const last = trail[trail.length - 1]!;
  return { x: last.x, z: last.z, late: t - last.t };
}

/**
 * `p` moved toward `target` over `dt` seconds with velocity `v` under `lim`: toward it at (distance / tau), at most
 * lim.v, changing velocity by at most lim.a a second; never past the target (it stops there); `scale` makes it that
 * much quicker (all three). Returns the new place and velocity.
 */
export function limitedMove(p: Vec3, v: Vec3, target: Vec3, dt: number, lim: Limit, scale = 1): { p: Vec3; v: Vec3 } {
  if (!(dt > 0)) return { p: { ...p }, v: { ...v } };
  const ex = target.x - p.x, ey = target.y - p.y, ez = target.z - p.z, e = Math.hypot(ex, ey, ez);
  if (e < 1e-9) return { p: { ...target }, v: zero() };
  const vmax = lim.v * scale, amax = lim.a * scale;
  // (No faster than it can still stop in: it brakes in time rather than running past.)
  const want = Math.min((e * scale) / lim.tau, vmax, Math.sqrt(2 * amax * e)) / e;
  let dvx = ex * want - v.x, dvy = ey * want - v.y, dvz = ez * want - v.z;
  const dv = Math.hypot(dvx, dvy, dvz), cap = amax * dt;
  if (dv > cap) { dvx *= cap / dv; dvy *= cap / dv; dvz *= cap / dv; }
  const nv = { x: v.x + dvx, y: v.y + dvy, z: v.z + dvz };
  const sx = nv.x * dt, sy = nv.y * dt, sz = nv.z * dt;
  // Never past it: a step that reaches the target along its way stops there.
  if ((sx * ex + sy * ey + sz * ez) >= e * e) return { p: { ...target }, v: zero() };
  return { p: { x: p.x + sx, y: p.y + sy, z: p.z + sz }, v: nv };
}

const clampNear = (a: number, w: number, d: number): number => (a < w - d ? w - d : a > w + d ? w + d : a);
/**
 * The calm point: `aim` moved only as far as keeps `watch` within the dead zone of it: along x and z (`calm.dead`), or,
 * for an angle that turns from `pivot`, within `calm.turn` of its turn and `calm.range` of its distance from there (so
 * the zone is as wide in the picture near the camera as far from it). `open` (0..1) scales the zone.
 */
function deadZone(aim: Vec3, watch: Vec3, calm: Calm, pivot: { x: number; z: number } | null, open: number, fov: number, height = 0): Vec3 {
  const halfWidth = Math.atan(Math.tan((fov * Math.PI) / 360) * (16 / 9));
  if (pivot && calm.tilt !== undefined && height > 0) {
    // Turn and tilt from a camera `height` m above the pivot.
    const wa = Math.atan2(watch.z - pivot.z, watch.x - pivot.x), aa = Math.atan2(aim.z - pivot.z, aim.x - pivot.x);
    const wp = Math.atan2(height, Math.hypot(watch.x - pivot.x, watch.z - pivot.z)), ap = Math.atan2(height, Math.hypot(aim.x - pivot.x, aim.z - pivot.z));
    const t = wa + clampNear(wrap(aa - wa), 0, (calm.turn ?? 0) * halfWidth * open);
    const pt = clampNear(ap, wp, calm.tilt * ((fov * Math.PI) / 360) * open), r = height / Math.tan(Math.max(0.02, pt));
    return { x: pivot.x + r * Math.cos(t), y: watch.y, z: pivot.z + r * Math.sin(t) };
  }
  if (!pivot || calm.turn === undefined) return { x: clampNear(aim.x, watch.x, calm.dead.x * open), y: watch.y, z: clampNear(aim.z, watch.z, calm.dead.z * open) };
  const wa = Math.atan2(watch.z - pivot.z, watch.x - pivot.x), wr = Math.hypot(watch.x - pivot.x, watch.z - pivot.z);
  const aa = Math.atan2(aim.z - pivot.z, aim.x - pivot.x), ar = Math.hypot(aim.x - pivot.x, aim.z - pivot.z);
  const t = wa + clampNear(wrap(aa - wa), 0, calm.turn * halfWidth * open), r = clampNear(ar, wr, wr * (calm.range ?? 0) * open);
  return { x: pivot.x + r * Math.cos(t), y: watch.y, z: pivot.z + r * Math.sin(t) };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Point the camera for one frame; `dt` is the game time just played (0 when paused). */
export function stepOperator(op: CameraOperator, input: OperatorInput, dt: number): { state: CameraOperator; pose: CameraPose; cut: boolean } {
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  // (The follow camera with nobody to follow shows the broadcast view, and moves as the broadcast camera does.)
  const as: CameraName = op.camera === 'follow' && input.followed === undefined ? 'broadcast' : op.camera;
  const calm = CALM[as];
  // A goal's hold: the camera watches the net (and the scorer) and does not cut to the engine's restart; once the hold
  // lets go after one, it cuts to it.
  const gl = input.goal, given = gl && gl.k > 0 ? Math.min(1, gl.k) : 0;
  // (After the cut to the restart the rest of the hold's ease is not shown.)
  let holdCut = given > 0 ? op.holdCut : false;
  let holdK = holdCut ? 0 : given;
  const restartNow = input.cut === 'restart';
  let restartHeld = holdK > 0 ? op.restartHeld || restartNow : false;
  let snap = op.pending || input.snap === true || input.cut === 'ends' || (holdK === 0 && restartNow);
  if (op.restartHeld && !holdCut && given < 0.999) { snap = true; restartHeld = false; holdCut = given > 0; holdK = 0; }
  let watch = input.puck;
  if (gl && holdK > 0) {
    const p = holdPoint(gl.net, gl.scorer);
    watch = { x: input.puck.x + (p.x - input.puck.x) * holdK, y: input.puck.y * (1 - holdK), z: input.puck.z + (p.z - input.puck.z) * holdK };
  }
  // The broadcast camera leads the play (LEAD), not on a goal's hold.
  const pv = input.puckVel ?? { x: 0, y: 0, z: 0 };
  const leadV = snap ? { x: pv.x, y: 0, z: pv.z } : easePoint(op.leadV, { x: pv.x, y: 0, z: pv.z }, h, LEAD.tau);
  if (as === 'broadcast' && input.puckVel && holdK < 1) {
    const v = leadV, sp = Math.hypot(v.x, v.z), u = Math.min(1, Math.max(0, (sp - LEAD.rushFrom) / LEAD.rushSpan));
    const lt = LEAD.base + LEAD.rush * u * u * (3 - 2 * u);
    let lx = v.x * lt, lz = v.z * lt * LEAD.across;
    const ll = Math.hypot(lx, lz);
    if (ll > LEAD.max) { lx *= LEAD.max / ll; lz *= LEAD.max / ll; }
    const ax = Math.abs(input.puck.x), e = Math.min(1, Math.max(0, (ax - END_BIAS.from) / END_BIAS.span));
    const bias = Math.sign(input.puck.x) * END_BIAS.m * e * e * (3 - 2 * e);
    watch = { x: watch.x + (lx + bias) * (1 - holdK), y: watch.y, z: watch.z + lz * (1 - holdK) };
  }
  // The calm point: it moves only as the play leaves the dead zone round it (which closes on a goal's hold).
  const aim = snap ? { ...watch } : deadZone(op.aim, watch, calm, cameraPivot(as, input.attackingRight, op.lastTarget ?? undefined), 1 - holdK, op.cam.fov, as === 'broadcast' ? BROADCAST_PLACE.y : 0);
  // A board battle: eased on and off (never a cut), its spot followed smoothly.
  const bt = input.battle ?? null, want = bt ? 1 : 0;
  const battleK = snap ? want : Math.min(1, Math.max(0, op.battleK + Math.max(-h / BATTLE_EASE, Math.min(h / BATTLE_EASE, want - op.battleK))));
  const battleSpot = bt ? (snap || op.battleK <= 0 ? { ...bt } : easePoint(op.battleSpot, bt, h, BATTLE_SPOT_TAU)) : op.battleSpot;
  // The overhead camera's zone: changed once the play has clearly gone to another and stayed ZONE_DWELL seconds.
  let zone = op.zone, zoneNext = op.zoneNext, zoneFor = op.zoneFor;
  // The zone the play is clearly in: ZONE_MARGIN inside it from either blue line (null on the lines).
  const clear = overheadZoneX(watch.x - ZONE_MARGIN) === overheadZoneX(watch.x + ZONE_MARGIN) ? overheadZoneX(watch.x) : null;
  if (snap) { zone = overheadZoneX(watch.x); zoneNext = zone; zoneFor = 0; }
  else if (clear !== null && clear !== zone) {
    zoneFor = zoneNext === clear ? zoneFor + h : h;
    zoneNext = clear;
    // (On a goal's hold, a real event, at once.)
    if (zoneFor >= ZONE_DWELL || holdK > 0) { zone = clear; zoneFor = 0; }
  } else { zoneNext = zone; zoneFor = 0; }
  // The follow camera's heading: toward his direction of travel at a limited rate; kept while he stands.
  const fl = input.followed;
  let heading = op.heading;
  if (fl) {
    const sp = Math.hypot(fl.vel.x, fl.vel.z), travel = sp > FOLLOW_TURN_SPEED ? Math.atan2(fl.vel.z, fl.vel.x) : null;
    if (heading === null || snap || !op.followOn) heading = travel ?? fl.facing;
    else if (travel !== null) { const d = wrap(travel - heading), m = FOLLOW_TURN_RATE * h * Math.min(1, sp / (2 * FOLLOW_TURN_SPEED)); heading = wrap(heading + Math.max(-m, Math.min(m, d))); }
  }
  const camInput: CameraInput = {
    puck: aim, attackingRight: input.attackingRight,
    current: op.lastTarget ?? undefined,
  };
  if (OVERHEAD_ZONES.includes(zone)) camInput.zoneX = zone;
  if (battleK > 0) camInput.battle = { spot: battleSpot, k: battleK * battleK * (3 - 2 * battleK) };
  if (holdK > 0) camInput.goal = { k: holdK };
  if (input.puckVel) camInput.puckVel = input.puckVel;
  if (input.zoom !== undefined) camInput.zoom = input.zoom;
  if (fl) camInput.followed = { ...fl, heading: heading ?? fl.facing };
  // The broadcast camera's distance zoom: steady until the play is ZOOM_STEP further or nearer than it was set for.
  let zoomBase = op.zoomBase;
  const wantBase = broadcastBaseFov({ x: aim.x, y: 0, z: aim.z });
  if (snap || zoomBase <= 0 || Math.abs(wantBase - zoomBase) > ZOOM_STEP * zoomBase) zoomBase = wantBase;
  if (as === 'broadcast') camInput.baseFov = zoomBase;
  const followOn = fl !== undefined;
  if (op.camera === 'follow' && followOn !== op.followOn) snap = true;
  const target = cameraTarget(op.camera, camInput);
  // An angle that jumps to the other side of the play (ice level changing spot) cuts there, as a director would,
  // rather than swinging the camera through the players.
  const clock = op.clock + h;
  const ref = placeAgo(op.trail, clock - CUT_WINDOW);
  // (Not the overhead camera's change of zone: that is a slow slide.)
  if (ref && op.camera !== 'overhead' && Math.hypot(target.pos.x - ref.x, target.pos.z - ref.z) > CUT_JUMP + CUT_SPEED * Math.max(0, ref.late)) snap = true;
  const here = { t: clock, x: target.pos.x, z: target.pos.z };
  let trail: { t: number; x: number; z: number }[];
  if (snap) trail = [here];
  else {
    // Keep the steps within the window, the newest one before it (to measure from the window's start), and this one.
    trail = [];
    const old = op.trail.filter((e) => e.t < clock);
    for (let i = 0; i < old.length; i++) if (old[i]!.t >= clock - CUT_WINDOW - 1e-9 || (i + 1 < old.length && old[i + 1]!.t > clock - CUT_WINDOW)) trail.push(old[i]!);
    if (trail.length === 0 && old.length > 0) trail.push(old[old.length - 1]!);
    trail.push(here);
  }
  let cam: CameraPose, lookV: Vec3, posV: Vec3;
  if (snap) { cam = { pos: { ...target.pos }, look: { ...target.look }, fov: target.fov }; lookV = zero(); posV = zero(); }
  else {
    // A real event (a goal's hold) may move it faster.
    const quick = 1 + (HOLD_QUICK - 1) * holdK;
    // Behind a skater: the camera's place and look point move relative to him (so it keeps up instead of trailing),
    // within the limits there.
    const anchor = op.camera === 'follow' ? fl?.pos : undefined;
    const ax = anchor ? anchor.x : 0, az = anchor ? anchor.z : 0;
    const rel = (p: Vec3, sgn: number): Vec3 => ({ x: p.x + sgn * ax, y: p.y, z: p.z + sgn * az });
    const holdLook: Limit = { v: Math.max(calm.look.v, Math.min(calm.look.v * quick, HOLD_MAX.v)) / quick, a: Math.max(calm.look.a, Math.min(calm.look.a * quick, HOLD_MAX.a)) / quick, tau: calm.look.tau };
    const lk = limitedMove(rel(op.cam.look, -1), op.lookV, rel(target.look, -1), h, holdLook, quick);
    const ps = limitedMove(rel(op.cam.pos, -1), op.posV, rel(target.pos, -1), h, calm.pos, quick);
    // (The zoom moves toward its target at most fovRate degrees a second, slowing as it arrives (FOV_BRAKE degrees a
    // second squared) and stopping on it.)
    const df = target.fov - op.cam.fov, ad = Math.abs(df);
    const step = Math.min(ad, Math.max(Math.min(calm.fovRate * quick, Math.sqrt(2 * FOV_BRAKE * quick * ad)) * h, 0.01));
    cam = { pos: rel(ps.p, 1), look: rel(lk.p, 1), fov: op.cam.fov + Math.sign(df) * step };
    lookV = lk.v; posV = ps.v;
  }
  return {
    state: { camera: op.camera, cam, lookV, posV, aim, lastTarget: target, followOn, heading, zone, zoneNext, zoneFor, pending: false, clock, trail, battleK, battleSpot, holdK, restartHeld, holdCut, zoomBase, leadV },
    pose: cam, cut: snap,
  };
}
