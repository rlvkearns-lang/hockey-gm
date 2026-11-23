import { motionOfSample, slotOf, toBodyFrame, type Overlay } from '../anim-context';
import { rawPose, styleShare } from '../gait';
import { addRawDelta } from '../pose-mix';

/**
 * The faceoff crouch (moved out of scene.ts): while a faceoff is being set up, a skater standing at the dot sinks into
 * a centre's crouch with his stick pointing at the dot, and comes back up once play starts. Its state is the crouch
 * level (0..1), eased with CROUCH_TAU, which is also its weight; a fresh start takes the level at once. Fully on, it
 * lowers the share of his pose that is the standing stance (gait.ts standPose at crouch 1 against crouch 0).
 */

/** A skater at the faceoff dot crouches when he is this close to it (m) while the faceoff is being set up. */
export const CROUCH_DOT = 1.3;
/** Seconds to sink into (or come out of) the faceoff crouch. */
export const CROUCH_TAU = 0.35;
/** A crouch level below this is left off (it moves nothing by as much as a micrometre's millionth). */
const CROUCH_OFF = 1e-12;

export const faceoffCrouch: Overlay<number> = {
  id: 'faceoffCrouch',
  step(level, sample, ctx, dt) {
    const spot = ctx.state.faceoffSpot, n = sample.state;
    const speed = Math.hypot(sample.vel.x, sample.vel.y);
    const atDot = ctx.state.phase === 'faceoffSetup' && Math.hypot(n.pos.x - spot.x, n.pos.y - spot.y) < CROUCH_DOT && speed < 0.5;
    const target = atDot ? 1 : 0;
    return level === undefined ? target : level + (target - level) * (1 - Math.exp(-Math.max(dt, 0) / CROUCH_TAU));
  },
  // A level that has eased out to nothing (it never reaches 0 exactly) costs nothing to leave off.
  weight: (anim) => { const w = slotOf<number>(anim, 'faceoffCrouch') ?? 0; return w > CROUCH_OFF ? w : 0; },
  apply(raw, anim, sample, ctx, dims) {
    const share = styleShare(anim.gait, 'stand');
    if (share <= 0) return raw;
    // Where the stick points: toward the dot (in his left-shot body frame, from where he is drawn), at
    // a fixed reach in front of him, turned no further than DOT_TURN either way. As the dot comes very near him, or goes
    // round behind him, the stick goes back to straight ahead, so it never swings round as he skates over the dot.
    const dot = stickAim(toBodyFrame(sample, ctx.state.faceoffSpot));
    const m = motionOfSample(sample);
    const up = rawPose('stand', anim.gait, 1, m, dims, { crouch: 0, dot }), down = rawPose('stand', anim.gait, 1, m, dims, { crouch: 1, dot });
    return addRawDelta(raw, up, down, share);
  },
};

/** The faceoff stick's reach in front of him (m) and how far it turns toward the dot (rad, either way). */
const DOT_REACH = 0.9, DOT_LEFT = -1.0, DOT_RIGHT = 0.6;
/** How near the dot (m) the stick still points at it fully, and how it fades below that. */
const DOT_NEAR = 1.0;

/** The point the faceoff stick aims at for a dot at `dot` (body frame), continuous wherever the dot is. */
export function stickAim(dot: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const dist = Math.hypot(dot.x, dot.z), a = Math.atan2(dot.z, dot.x);
  const s = (t: number): number => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * (3 - 2 * u); };
  const k = s(dist / DOT_NEAR) * s((Math.cos(a) + 0.2) / 0.5);
  const h = (a < DOT_LEFT ? DOT_LEFT : a > DOT_RIGHT ? DOT_RIGHT : a) * k;
  return { x: DOT_REACH * Math.cos(h), y: 0, z: DOT_REACH * Math.sin(h) };
}
