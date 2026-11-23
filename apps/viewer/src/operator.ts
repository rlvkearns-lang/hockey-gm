import { cameraTarget, easeCamera, easePoint, type CameraInput, type CameraName, type CameraPose } from './cameras';
import type { CutKind } from './cuts';
import type { Vec3 } from './pose-mix';

/**
 * The camera operator (pure: no three.js, no DOM): from the play each frame to where the camera is. It holds what the
 * watch page's aimCamera held: the point the cameras watch (chasing the drawn puck, so passes and rebounds pan rather
 * than jerk), the cut rules, and the follow camera's anchoring on the skater it follows. The angles themselves are
 * cameras.ts.
 *
 * It cuts (jumps straight to the target) on a seek or a new game (`snap`), a new angle (withCamera), the scene's cut
 * when play restarts at a faceoff or the teams change ends (`cut` 'restart' or 'ends'), the followed player stepping
 * on or off while following him, and when the angle's own target jumps further than a camera can move (ice level
 * changing spot, the follow camera swinging round as he turns about): more than CUT_JUMP within one engine tick of
 * game time. Across the scene's other cuts ('jump': the engine moving the puck in the middle of play)
 * it eases.
 *
 * After a goal (input `goal`, from goal-show.ts: weight 1 for GOAL_HOLD_SECONDS, then easing to 0) it holds on the net
 * scored on and the scorer instead of the puck: the engine's restart (the puck put on the centre dot) does not cut the
 * camera while it holds, and as the hold lets go the camera eases to the play (an angle may still cut once by its
 * own rule, as ice level changing spot). The broadcast camera tightens a little on the goal.
 */

/** Time constant (s) of the point the cameras watch, chasing the drawn puck: smooths passes and rebounds. */
export const FOCUS_TAU = 0.22;
/**
 * The jump rule. A camera place that moves more than CUT_JUMP metres within CUT_WINDOW seconds of game time (one
 * engine tick) has jumped: 150 m/s held over a tick, far faster than any camera follows play (the puck the cameras
 * chase flies at under 50 m/s; the broadcast lead turning round with a puck off the boards moves the camera about
 * 4.4 m within one tick, by the lead's clamp). The move is measured against where the target was a window ago, not
 * the frame before, so a jump spread over a tick's frames and one made in a single frame are judged alike at every
 * frame rate. A frame longer than the window (fast playback on a slow machine) adds CUT_SPEED m/s for the excess.
 */
export const CUT_JUMP = 5, CUT_WINDOW = 1 / 30, CUT_SPEED = 60;

export type CameraOperator = {
  camera: CameraName;
  /** Where the camera is now. */
  cam: CameraPose;
  /** The point the cameras watch. */
  focus: Vec3;
  /** The angle's last target (for the jump rule, and so ice level keeps its spot), or null after a new angle or game. */
  lastTarget: CameraPose | null;
  /** Whether the followed player was on the ice at the last step. */
  followOn: boolean;
  /** Game time (s) stepped, and the target's place at the recent steps (within CUT_WINDOW, and the last one). */
  clock: number;
  trail: readonly { t: number; x: number; z: number }[];
  /** The next step cuts (a new angle or a new operator). */
  pending: boolean;
  /** How far the camera has eased onto a board battle (0..1), and the battle spot it watches (eased). */
  battleK: number; battleSpot: Vec3;
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
/** On a goal's hold the camera's own time constants are this much shorter (at full hold), so it is on the net at once. */
export const HOLD_QUICK = 0.75;

/** The point a goal's hold watches: the net, toward the scorer (if any) by half his distance, at most HOLD_REACH. */
export function holdPoint(net: Vec3, scorer: Vec3 | null | undefined): Vec3 {
  if (!scorer) return { x: net.x, y: 0, z: net.z };
  const dx = (scorer.x - net.x) / 2, dz = (scorer.z - net.z) / 2, d = Math.hypot(dx, dz), k = d > HOLD_REACH ? HOLD_REACH / d : 1;
  return { x: net.x + dx * k, y: 0, z: net.z + dz * k };
}

/** Seconds the camera takes to ease onto a board battle (and off it when it ends), and to follow its spot. */
export const BATTLE_EASE = 0.6, BATTLE_SPOT_TAU = 0.4;

export function initialOperator(camera: CameraName): CameraOperator {
  return { camera, cam: { pos: { x: 0, y: 15, z: 29 }, look: { x: 0, y: 0, z: 0 }, fov: 30 }, focus: { x: 0, y: 0, z: 0 }, lastTarget: null, followOn: false, pending: true, clock: 0, trail: [], battleK: 0, battleSpot: { x: 0, y: 0, z: 0 } };
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

/** Point the camera for one frame; `dt` is the game time just played (0 when paused). */
export function stepOperator(op: CameraOperator, input: OperatorInput, dt: number): { state: CameraOperator; pose: CameraPose; cut: boolean } {
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  // A goal's hold: the camera watches the net (and the scorer) and does not cut to the engine's restart.
  const gl = input.goal, holdK = gl && gl.k > 0 ? Math.min(1, gl.k) : 0;
  let snap = op.pending || input.snap === true || (holdK === 0 && (input.cut === 'restart' || input.cut === 'ends'));
  let watch = input.puck;
  if (gl && holdK > 0) {
    const p = holdPoint(gl.net, gl.scorer);
    watch = { x: input.puck.x + (p.x - input.puck.x) * holdK, y: input.puck.y * (1 - holdK), z: input.puck.z + (p.z - input.puck.z) * holdK };
  }
  // (The hold's own ease is smooth, so the watched point follows it closely as it comes on.)
  const focus = snap ? { ...watch } : easePoint(op.focus, watch, h, Math.max(0.02, FOCUS_TAU * (1 - holdK)));
  // A board battle: eased on and off (never a cut), its spot followed smoothly.
  const bt = input.battle ?? null, want = bt ? 1 : 0;
  const battleK = snap ? want : Math.min(1, Math.max(0, op.battleK + Math.max(-h / BATTLE_EASE, Math.min(h / BATTLE_EASE, want - op.battleK))));
  const battleSpot = bt ? (snap || op.battleK <= 0 ? { ...bt } : easePoint(op.battleSpot, bt, h, BATTLE_SPOT_TAU)) : op.battleSpot;
  const camInput: CameraInput = {
    puck: focus, attackingRight: input.attackingRight,
    current: op.lastTarget ?? undefined,
  };
  if (battleK > 0) camInput.battle = { spot: battleSpot, k: battleK * battleK * (3 - 2 * battleK) };
  if (holdK > 0) camInput.goal = { k: holdK };
  if (input.puckVel) camInput.puckVel = holdK > 0 ? { x: input.puckVel.x * (1 - holdK), y: 0, z: input.puckVel.z * (1 - holdK) } : input.puckVel;
  if (input.zoom !== undefined) camInput.zoom = input.zoom;
  if (input.followed) camInput.followed = input.followed;
  const followOn = input.followed !== undefined;
  if (op.camera === 'follow' && followOn !== op.followOn) snap = true;
  const target = cameraTarget(op.camera, camInput);
  // An angle that jumps to the other side of the play (ice level as the puck crosses centre along its boards) cuts
  // there, as a director would, rather than swinging the camera through the players.
  const clock = op.clock + h;
  const ref = placeAgo(op.trail, clock - CUT_WINDOW);
  if (ref && Math.hypot(target.pos.x - ref.x, target.pos.z - ref.z) > CUT_JUMP + CUT_SPEED * Math.max(0, ref.late)) snap = true;
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
  const anchor = op.camera === 'follow' ? camInput.followed?.pos : undefined;
  let cam: CameraPose;
  if (anchor && !snap) {
    // Behind a skater at full speed: ease the camera's place relative to him, so it keeps up instead of trailing.
    const rel = (p: CameraPose, s: number): CameraPose => ({
      pos: { x: p.pos.x + s * anchor.x, y: p.pos.y, z: p.pos.z + s * anchor.z },
      look: { x: p.look.x + s * anchor.x, y: p.look.y, z: p.look.z + s * anchor.z }, fov: p.fov,
    });
    cam = rel(easeCamera(rel(op.cam, -1), rel(target, -1), h, false), 1);
  } else cam = easeCamera(op.cam, target, h, snap, 1 - HOLD_QUICK * holdK);
  return { state: { camera: op.camera, cam, focus, lastTarget: target, followOn, pending: false, clock, trail, battleK, battleSpot }, pose: cam, cut: snap };
}
