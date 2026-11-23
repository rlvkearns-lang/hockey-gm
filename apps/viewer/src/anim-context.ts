import type { ContestState, GameState, GoalieState, RINK, Side, SkaterState } from '@hockey/engine';
import type { BodyDims } from './body';
import type { GaitState, Motion } from './gait';
import type { RawPose, Vec3 } from './pose-mix';
import type { Timeline } from './timeline';

/**
 * What the animator and its overlays work with (pure, types and small helpers only; animator.ts re-exports all of it):
 * a figure's sample for the frame, the frame's context, a skater's animation state and the overlay contract.
 * Overlays (overlays/*.ts) import from here, so they and animator.ts do not import each other.
 */

type Vec2 = { x: number; y: number };

/**
 * One skater as the engine has him for this frame, blended between the frame's two ticks (engine coordinates: x, y
 * on the ice; facing in engine radians). `accelAlong` (m/s^2, change of speed) and `turnRate` (rad/s, rising facing)
 * are over the frame's tick, 0 when only one tick is drawn. `state` is his engine state at the later tick drawn (the
 * earlier one across an engine cut, or when the engine takes him off the ice at the later one). `dims` is his body.
 */
export type SkaterSample = {
  id: string; side: Side; right: boolean; dims: BodyDims;
  onIce: boolean;
  pos: Vec2; vel: Vec2; facing: number;
  accelAlong: number; turnRate: number;
  down: boolean; carrying: boolean;
  state: Readonly<SkaterState>;
};
/** A goalie for this frame: his place and facing blended between the ticks, and his engine state at the later one. */
export type GoalieSample = { id: string; side: Side; dims: BodyDims; pos: Vec2; facing: number; state: Readonly<GoalieState> };

/**
 * What every pose can read about the frame, built once per frame by the scene (no allocation per figure).
 * `tick` and `alpha` are the frame's display time (tick rounded down, and how far toward the next); `time` is that in
 * game seconds. `state` is the engine state drawn as the frame's later tick. `skaters` and `goalies` hold this frame's
 * samples by id (a skater off the ice has `onIce` false). `puck.engine` is the engine's puck blended between the ticks
 * (world: x, z on the ice, y its height); `puck.drawn` where the puck was drawn on the previous frame (the puck is
 * stepped after the poses, from the blades they put it on). `contests` are the engine's contests under way.
 * `defends` is the x sign of the net each team defends (home defends -x while it attacks toward +x).
 */
export type AnimContext = {
  tick: number; alpha: number; time: number;
  state: Readonly<GameState>;
  skaters: ReadonlyMap<string, SkaterSample>;
  goalies: ReadonlyMap<string, GoalieSample>;
  puck: { engine: Vec3; drawn: Vec3; carrierId: string | null };
  contests: readonly ContestState[];
  timeline: Timeline;
  rink: typeof RINK;
  defends: Record<Side, 1 | -1>;
};

/**
 * An overlay: an action or a stance layered over the skating base. `step` (optional) advances its own state for one
 * skater (`slot` is undefined when he starts afresh: a reset, a seek, an engine cut, stepping on); it is kept in
 * SkaterAnim.slots[id]. `weight` says how much of it shows (0..1; ease it in and out); `apply` returns the raw pose
 * with it fully on (the animator mixes by the weight). `offset` (optional) is where it wants his body drawn relative to
 * the engine position (world metres, x and z), at full weight.
 */
export type Overlay<S = unknown> = {
  id: string;
  step?(slot: S | undefined, sample: SkaterSample, ctx: AnimContext, dt: number): S;
  weight(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext): number;
  apply(raw: RawPose, anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose;
  offset?(anim: SkaterAnim, sample: SkaterSample, ctx: AnimContext): { x: number; z: number };
};

/**
 * A skater's animation state: his gait, whether he had the puck at the last step, each overlay's own state by its id,
 * and `fresh`: the next step starts everything afresh (his gait in the style his motion shows, every overlay slot
 * empty).
 */
export type SkaterAnim = { gait: GaitState; fresh: boolean; carrying: boolean; slots: Readonly<Record<string, unknown>> };

/** An overlay's state for this skater (undefined before its first step, or after he starts afresh). */
export const slotOf = <S>(anim: SkaterAnim, id: string): S | undefined => anim.slots[id] as S | undefined;

/**
 * His motion in his own frame from a sample, mirrored for a right shot (motion in, pose out): velocity along and
 * across his facing, the change of speed and the turn over the frame's tick.
 */
export function motionOfSample(s: SkaterSample): Motion {
  const vx = s.vel.x, vy = s.vel.y, c = Math.cos(s.facing), n = Math.sin(s.facing), m = s.right ? -1 : 1;
  return {
    speed: Math.hypot(vx, vy),
    forward: vx * c + vy * n,
    lateral: m * (-vx * n + vy * c),
    accelAlong: s.accelAlong,
    turnRate: m * s.turnRate,
    facing: m * s.facing,
    down: s.down,
  };
}

/**
 * A point on the ice (engine x, y) in his body frame as a pose sees it (x forward, z to his right; mirrored for a
 * right shot), from his engine place and facing at the later tick (`at: 'tick'`, as the faceoff crouch reads the dot)
 * or his blended place and facing (`at: 'frame'`, the default).
 */
export function toBodyFrame(s: SkaterSample, p: Vec2, at: 'frame' | 'tick' = 'frame'): Vec3 {
  const o = at === 'tick' ? s.state.pos : s.pos, f = at === 'tick' ? s.state.facing : s.facing;
  const dx = p.x - o.x, dy = p.y - o.y, c = Math.cos(f), n = Math.sin(f);
  return { x: dx * c + dy * n, y: 0, z: (s.right ? -1 : 1) * (-dx * n + dy * c) };
}

