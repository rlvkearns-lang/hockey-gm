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
 * changing spot, the follow camera swinging round as he turns about): further than CUT_SPEED allows over the frame's
 * game time, plus CUT_SLACK. Across the scene's other cuts ('jump': the engine moving the puck in the middle of play)
 * it eases.
 */

/** Time constant (s) of the point the cameras watch, chasing the drawn puck: smooths passes and rebounds. */
export const FOCUS_TAU = 0.22;
/**
 * A camera target faster than this (m/s of game time) has jumped: no camera place or look point moves that fast in
 * play (the puck the cameras chase flies at under 50 m/s, and they follow it at most one for one).
 */
export const CUT_SPEED = 60;
/**
 * Slack (m) on top of that: what a target can move within one engine tick of play without having jumped (the
 * broadcast camera's lead turning round with the puck off the boards moves it about 4.4 m in one tick). At 60 frames
 * a second at normal speed the two together allow the 6 m a frame the page used to allow at any rate.
 */
export const CUT_SLACK = 5;

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
  /** The next step cuts (a new angle or a new operator). */
  pending: boolean;
};

/**
 * One frame for the operator: where the puck is drawn and its velocity, which way the home team attacks, how much
 * tighter the broadcast camera should frame (a small picture), the player followed (when he is on the ice), the
 * scene's cut on this frame, if any, and `snap` for a seek or a new game.
 */
export type OperatorInput = Omit<CameraInput, 'current'> & { cut?: CutKind | null | undefined; snap?: boolean };

export function initialOperator(camera: CameraName): CameraOperator {
  return { camera, cam: { pos: { x: 0, y: 15, z: 29 }, look: { x: 0, y: 0, z: 0 }, fov: 30 }, focus: { x: 0, y: 0, z: 0 }, lastTarget: null, followOn: false, pending: true };
}

/** The operator on angle `name`: its next step cuts to it. */
export function withCamera(op: CameraOperator, name: CameraName): CameraOperator {
  return { ...op, camera: name, lastTarget: name === op.camera ? op.lastTarget : null, pending: true };
}

/** The operator with no memory of its angle's last target (a new game: ice level picks its spot afresh). */
export function forgetTarget(op: CameraOperator): CameraOperator {
  return { ...op, lastTarget: null };
}

/** Point the camera for one frame; `dt` is the game time just played (0 when paused). */
export function stepOperator(op: CameraOperator, input: OperatorInput, dt: number): { state: CameraOperator; pose: CameraPose; cut: boolean } {
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  let snap = op.pending || input.snap === true || input.cut === 'restart' || input.cut === 'ends';
  const focus = snap ? { ...input.puck } : easePoint(op.focus, input.puck, h, FOCUS_TAU);
  const camInput: CameraInput = {
    puck: focus, attackingRight: input.attackingRight,
    current: op.lastTarget ?? undefined,
  };
  if (input.puckVel) camInput.puckVel = input.puckVel;
  if (input.zoom !== undefined) camInput.zoom = input.zoom;
  if (input.followed) camInput.followed = input.followed;
  const followOn = input.followed !== undefined;
  if (op.camera === 'follow' && followOn !== op.followOn) snap = true;
  const target = cameraTarget(op.camera, camInput);
  // An angle that jumps to the other side of the play (ice level as the puck crosses centre along its boards) cuts
  // there, as a director would, rather than swinging the camera through the players.
  const last = op.lastTarget;
  if (last && Math.hypot(target.pos.x - last.pos.x, target.pos.z - last.pos.z) > CUT_SPEED * h + CUT_SLACK) snap = true;
  const anchor = op.camera === 'follow' ? camInput.followed?.pos : undefined;
  let cam: CameraPose;
  if (anchor && !snap) {
    // Behind a skater at full speed: ease the camera's place relative to him, so it keeps up instead of trailing.
    const rel = (p: CameraPose, s: number): CameraPose => ({
      pos: { x: p.pos.x + s * anchor.x, y: p.pos.y, z: p.pos.z + s * anchor.z },
      look: { x: p.look.x + s * anchor.x, y: p.look.y, z: p.look.z + s * anchor.z }, fov: p.fov,
    });
    cam = rel(easeCamera(rel(op.cam, -1), rel(target, -1), h, false), 1);
  } else cam = easeCamera(op.cam, target, h, snap);
  return { state: { camera: op.camera, cam, focus, lastTarget: target, followOn, pending: false }, pose: cam, cut: snap };
}
