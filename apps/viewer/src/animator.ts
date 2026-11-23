import { DT } from '@hockey/engine';
import { motionOfSample, type AnimContext, type BodyPass, type GoalieAnim, type GoalieOverlay, type GoalieSample, type Overlay, type SkaterAnim, type SkaterSample } from './anim-context';
import type { BodyDims } from './body';
import { stickhandle } from './carry';
import { gaitRaw, initialGait, stepGait, type GaitState, type Motion } from './gait';
import { fitGoalie, goalieMotion, goalieRaw, initialGoalieGait, mixGoalieRaw, stepGoalie, type GoalieFigurePose, type GoalieGait } from './goalie-pose';
import { faceoffCrouch } from './overlays/faceoff';
import { fitBody, mixRaw, type SkaterPose } from './pose-mix';

export * from './anim-context';

/**
 * The animator (pure: no three.js, no DOM): turns each figure's engine sample, the frame's context and the event
 * timeline into a pose. The scene samples every figure, steps every figure's animation state (stepSkater,
 * stepGoalieAnim), and only then poses them (poseSkater, poseGoalie), so a pose can read the other figures' samples
 * of the same frame.
 *
 * A skater's pose is layered: the gait gives the RAW skating pose (gait.ts gaitRaw, before the body fit); the
 * registered overlays (OVERLAYS, in order) then modify that raw pose, each mixed in by its own weight (0..1), which
 * eases in and out and may depend on the timeline and on contests; then pose-mix.ts fitBody solves the limbs and
 * ground contact once. An overlay may also ask for the body to be drawn offset from the engine position (weighted the
 * same way). Overlays keep their per-skater state in SkaterAnim.slots (plain data), so a pre-roll or a seek rebuilds it
 * by stepping, as it rebuilds the gait.
 *
 * Poses are in the body frame of a left shot (pose-mix.ts): an overlay that places something in the world converts it
 * with toBodyFrame, which mirrors for a right shot.
 */

/** The registered overlays, in the order they are applied (later ones see the earlier ones' result). */
export const OVERLAYS: readonly Overlay[] = [faceoffCrouch as Overlay];

export function initialSkaterAnim(): SkaterAnim {
  return { gait: initialGait(), fresh: true, carrying: false, slots: {} };
}

/** The same animation, to start afresh at its next step (an engine cut moved him). */
export const refreshSkater = (a: SkaterAnim): SkaterAnim => (a.fresh ? a : { ...a, fresh: true });

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The turn rate a sample reports for two engine facings one tick apart. */
export const turnRateOf = (from: number, to: number): number => wrapAngle(to - from) / DT;

/**
 * A gait started afresh on the motion he has now, in the style that motion shows at once: no blend in from the
 * standing pose (a man who is down is drawn down, a skater moving is drawn moving).
 */
function freshGait(m: Motion, carrying: boolean): GaitState {
  const g: GaitState = { ...stepGait(initialGait(), m, 0, carrying) };
  delete g.from; delete g.blendT; delete g.blendDur;
  return g;
}

/**
 * Advance a skater's animation by `dt` seconds of game time (0 when paused). Off the ice nothing moves and he starts
 * afresh when he steps on. A fresh start settles his gait on the motion he has now (without a turn-rate or
 * acceleration spike from the cut) and starts every overlay's state afresh.
 */
export function stepSkater(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, dt: number, overlays: readonly Overlay[] = OVERLAYS): SkaterAnim {
  if (!sample.onIce) return refreshSkater(anim);
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const m = motionOfSample(sample);
  const fresh = anim.fresh;
  let gait: GaitState;
  if (fresh) {
    m.accelAlong = 0; m.turnRate = 0;
    gait = freshGait(m, sample.carrying);
  } else gait = h > 0 ? stepGait(anim.gait, m, h, sample.carrying) : anim.gait;
  let slots = fresh ? {} : anim.slots;
  for (const ov of overlays) {
    if (!ov.step) continue;
    const next = ov.step(fresh ? undefined : anim.slots[ov.id], sample, ctx, h);
    if (slots === anim.slots) slots = { ...anim.slots };
    (slots as Record<string, unknown>)[ov.id] = next;
  }
  return { gait, fresh: false, carrying: sample.carrying, slots };
}

/**
 * His pose for this frame (body frame of a left shot; mirror for a right shot) and the offset (world x, z) at which
 * to draw his body from the engine position: the gait's raw pose, each overlay mixed in by its weight, fitted once.
 */
export function poseSkater(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, dims: BodyDims, overlays: readonly Overlay[] = OVERLAYS): { pose: SkaterPose; offset: { x: number; z: number } } {
  const m = motionOfSample(sample);
  const handle = sample.carrying || (anim.gait.puck ?? 0) > 0 ? stickhandle(ctx.time, m.speed) : undefined;
  let raw = gaitRaw(anim.gait, m, dims, handle ? { hasPuck: sample.carrying, handle } : { hasPuck: sample.carrying });
  let ox = 0, oz = 0;
  for (const ov of overlays) {
    const w = ov.weight(anim, sample, ctx);
    if (!(w > 0)) continue;
    const k = Math.min(1, w);
    raw = mixRaw(raw, ov.apply(raw, anim, sample, ctx, dims), k);
    if (ov.offset) { const o = ov.offset(anim, sample, ctx); ox += o.x * k; oz += o.z * k; }
  }
  return { pose: fitBody(raw, dims), offset: { x: ox, z: oz } };
}

// ---------------------------------------------------------------------------------------------------------------
// Goalies

/** The registered goalie overlays, in the order they are applied (none yet). */
export const GOALIE_OVERLAYS: readonly GoalieOverlay[] = [];

/**
 * The pass over all drawn bodies between posing and drawing (Task 4 pushes overlapping bodies apart here). For now
 * the identity: every body is drawn where its overlays asked.
 */
export const BODY_PASS: BodyPass = () => {};

export function initialGoalieAnim(): GoalieAnim {
  return { gait: initialGoalieGait(), fresh: true, slots: {} };
}

/** The same goalie animation, to start afresh at its next step. */
export const refreshGoalie = (a: GoalieAnim): GoalieAnim => (a.fresh ? a : { ...a, fresh: true });

/** A save event older than this (s) no longer says which side a pad save goes to. */
export const SAVE_SIDE_SECONDS = 1.5;
const SAVE_SIDE_TICKS = Math.round(SAVE_SIDE_SECONDS / DT);

/**
 * Advance a goalie's animation: his gait, then each goalie overlay's state. A pad save kicks out the pad on the side
 * the engine's own `save` event (from the timeline, if recent) puts the puck, else the side the engine's puck is on. A
 * fresh start shows the engine's pose at once and starts every overlay's state afresh.
 */
export function stepGoalieAnim(anim: GoalieAnim, sample: GoalieSample, ctx: AnimContext, dt: number, overlays: readonly GoalieOverlay[] = GOALIE_OVERLAYS): GoalieAnim {
  const n = sample.state;
  const input = goalieMotion(n);
  // Which side of him the puck is (+1 his right): a pad save kicks out the pad on that side.
  const save = ctx.timeline.last('save', ctx.state.tick, SAVE_SIDE_TICKS, sample.id);
  const sx = save ? save.pos.x : ctx.puck.engine.x, sz = save ? save.pos.y : ctx.puck.engine.z;
  const toRight = (sx - sample.pos.x) * -Math.sin(sample.facing) + (sz - sample.pos.y) * Math.cos(sample.facing);
  input.side = toRight >= 0 ? 1 : -1;
  const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const fresh = anim.fresh;
  let gait: GoalieGait;
  if (fresh) {
    const pose = n.poseT > 0 ? n.pose : 'stance';
    gait = { ...initialGoalieGait(), pose, from: pose, t: 1, side: input.side >= 0 ? 1 : -1 };
  } else gait = h > 0 ? stepGoalie(anim.gait, input, h) : anim.gait;
  let slots = fresh ? {} : anim.slots;
  for (const ov of overlays) {
    if (!ov.step) continue;
    const next = ov.step(fresh ? undefined : anim.slots[ov.id], sample, ctx, h);
    if (slots === anim.slots) slots = { ...anim.slots };
    (slots as Record<string, unknown>)[ov.id] = next;
  }
  return gait === anim.gait && slots === anim.slots && !fresh ? anim : { gait, fresh: false, slots };
}

/**
 * A goalie's pose: the gait's raw pose, each goalie overlay mixed in by its weight, solved once. The engine's goalies
 * all catch with the left hand.
 */
export function poseGoalie(anim: GoalieAnim, sample: GoalieSample, ctx: AnimContext, dims: BodyDims, overlays: readonly GoalieOverlay[] = GOALIE_OVERLAYS): GoalieFigurePose {
  let raw = goalieRaw(anim.gait, dims, 'L');
  for (const ov of overlays) {
    const w = ov.weight(anim, sample, ctx);
    if (!(w > 0)) continue;
    raw = mixGoalieRaw(raw, ov.apply(raw, anim, sample, ctx, dims), Math.min(1, w));
  }
  return fitGoalie(raw, dims, 'L');
}
