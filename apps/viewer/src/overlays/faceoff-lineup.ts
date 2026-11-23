import { DT } from '@hockey/engine';
import { motionOfSample, slotOf, toBodyFrame, type AnimContext, type Overlay, type SkaterSample } from '../anim-context';
import { rawPose, styleShare } from '../gait';
import { addRawDelta, bladeAt, mixRaw, type RawPose, type Vec3 } from '../pose-mix';
import { stickAim } from './faceoff';

/**
 * The faceoff line-up (pure). While a faceoff is set up (the engine's `faceoffSetup` phase: play is dead) every man on
 * the ice is drawn in his part of the line-up, at the engine's place:
 * - the two centres face each other squarely across the dot, low, blades on the ice beside the dot;
 * - the wingers face the dot from the circle's edge, knees bent, sticks down;
 * - the defencemen stand behind, upright, facing the dot, sticks down.
 *
 * The engine leaves each man facing whichever way he last skated (measured over the first period of seeds 5 and 42:
 * a median of about 90 degrees off the dot for every role), so this overlay turns his whole drawn figure toward the
 * dot (Overlay.turn), the ruled exception for faceoff setups. The turn eases in (TURN_TAU) and, from the moment the
 * setup ends (the drop), eases back to nothing over DROP_EASE seconds: in live play the drawn facing is the engine's
 * exactly. His skating stays the engine's (stepped in the engine's frame: stepping it in the turned frame made the
 * skating after the drop depend on the setup's history, so a seek no longer matched play), so a man still coasting to
 * his spot at the drop is drawn gliding a little sideways.
 *
 * At the drop the centres' blades go to the dot and the winner's (the `faceoff` event's playerId) follows the puck
 * back as the engine slides it to his defenceman: a sweep, for DRAW_SECONDS.
 *
 * State: the stance level (0..1, eased like the faceoff crouch), the turn, and when the setup ended with the turn it
 * had then. A seek's pre-roll (1.5 s) rebuilds it: the drop comes at least 3 s into a setup, and the turn is gone 0.4 s
 * after it.
 */

/**
 * Seconds the line-up stance takes to come on, and the turn (time constants): TURN_TAU as he first turns to the dot,
 * then TURN_FOLLOW once TURN_SETTLE seconds in, so he keeps square to a centre who shuffles about across the dot.
 */
export const LINEUP_TAU = 0.35, TURN_TAU = 0.25, TURN_FOLLOW = 0.05, TURN_SETTLE = 0.6;
/** The fastest (rad/s) his drawn facing turns in a setup (two centres a hand apart swing round each other quickly). */
export const TURN_RATE = 4;
/** Seconds after the setup ends over which the turn eases back to the engine facing (then it is exactly 0). */
export const DROP_EASE = 0.4;
/** Seconds of the draw after the drop: the centres' blades on the dot, the winner's sweeping back with the puck. */
export const DRAW_SECONDS = 0.55;
/** Seconds the draw takes to come on, from the moment play is live. */
const DRAW_IN = 0.15, DRAW_OUT = 0.3;
/** How far in front of his pelvis (m) the draw keeps his blade at least. */
const DRAW_MIN_X = 0.35;
/** The winner's sweep: seconds, and where it ends (left-shot body frame: beside his stick-side skate). */
const DRAW_SWEEP = 0.25, SWEEP_TO = { x: 0.4, z: -0.6 };
/** A level below this is left off. */
const LEVEL_OFF = 1e-3;

export type LineupRole = 'C' | 'W' | 'D';
export type LineupSlot = {
  /** The stance's level (0..1) and its role (null: no part in a line-up). */
  level: number; role: LineupRole | null;
  /** The figure's drawn turn from the engine facing (rad), and his drawn facing in a setup (eased toward the line-up's). */
  turn: number; drawn: number;
  /** Seconds he has been turned in this setup. */
  age: number;
  /** When the setup ended (game seconds) and the turn then; null during a setup or once it has eased away. */
  ended: { time: number; turn: number } | null;
  /**
   * A centre's blade place by the dot (his drawn body frame, centreAim), as of the setup's last frame: after the drop
   * his stance and the draw keep to it (it moves with him), so the stick never swings as he skates off. Null for others.
   */
  aim: Vec3 | null;
};

const smooth = (t: number): number => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * (3 - 2 * u); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** His part in a line-up, from his engine slot. */
export function roleOf(s: SkaterSample): LineupRole | null {
  const slot = s.state.slot;
  return slot === 'C' ? 'C' : slot === 'LW' || slot === 'RW' ? 'W' : slot === 'LD' || slot === 'RD' ? 'D' : null;
}

/** The centre facing him in the line-up (the other side's on-ice centre), if any. */
function otherCentre(s: SkaterSample, ctx: AnimContext): SkaterSample | undefined {
  for (const o of ctx.skaters.values()) if (o.onIce && o.side !== s.side && o.state.slot === 'C') return o;
  return undefined;
}

/** The facing (engine radians) his line-up part wants: at the other centre for a centre, at the dot for the rest. */
export function lineupFacing(s: SkaterSample, ctx: AnimContext, role: LineupRole): number {
  const spot = ctx.state.faceoffSpot;
  const o = role === 'C' ? otherCentre(s, ctx) : undefined;
  const tx = o ? o.pos.x : spot.x, ty = o ? o.pos.y : spot.y;
  const dx = tx - s.pos.x, dy = ty - s.pos.y;
  return dx * dx + dy * dy > 1e-6 ? Math.atan2(dy, dx) : s.facing;
}

export const faceoffLineup: Overlay<LineupSlot> = {
  id: 'faceoffLineup',
  step(slot, sample, ctx, dt) {
    const h = Math.max(0, dt);
    const setup = ctx.state.phase === 'faceoffSetup';
    const role = roleOf(sample);
    if (setup && role) {
      // His drawn facing eases toward the line-up's (not the engine's, which spins as he settles on his spot).
      const want = lineupFacing(sample, ctx, role);
      const from = slot === undefined ? want : slot.role === null ? sample.facing + slot.turn : slot.drawn;
      const age = slot === undefined ? TURN_SETTLE : slot.role === null ? 0 : slot.age + h;
      const tau = TURN_TAU + (TURN_FOLLOW - TURN_TAU) * smooth(age / TURN_SETTLE);
      const step = wrap(want - from) * (slot === undefined ? 1 : 1 - Math.exp(-h / tau)), most = TURN_RATE * h;
      const drawn = from + (slot === undefined ? step : Math.max(-most, Math.min(most, step)));
      const level = slot === undefined ? 1 : slot.level + (1 - slot.level) * (1 - Math.exp(-h / LINEUP_TAU));
      const turn = wrap(drawn - sample.facing);
      const aim = role === 'C' ? centreAim(toBodyFrame(sample, ctx.state.faceoffSpot, 'frame', turn)) : null;
      return { level, role, turn, drawn: wrap(drawn), age, ended: null, aim };
    }
    if (slot === undefined) return { level: 0, role: null, turn: 0, drawn: sample.facing, age: 0, ended: null, aim: null };
    const level = slot.level * Math.exp(-h / LINEUP_TAU);
    // The setup is over (the drop): the turn eases back to the engine facing, then is exactly 0.
    const ended = slot.ended ?? (slot.turn !== 0 ? { time: ctx.time, turn: slot.turn } : null);
    const t = ended ? ctx.time - ended.time : Infinity;
    const turn = ended && t < DROP_EASE ? ended.turn * (1 - smooth(t / DROP_EASE)) : 0;
    return { level: level > LEVEL_OFF ? level : 0, role: level > LEVEL_OFF ? slot.role : null, turn, drawn: sample.facing + turn, age: 0, ended: ended && t < Math.max(DROP_EASE, DRAW_SECONDS) ? ended : null, aim: level > LEVEL_OFF ? slot.aim : null };
  },
  weight(anim, sample, ctx) {
    const s = slotOf<LineupSlot>(anim, 'faceoffLineup');
    const stance = s && s.role ? s.level : 0;
    return Math.max(stance, drawWeight(sample, ctx));
  },
  turn: (anim) => slotOf<LineupSlot>(anim, 'faceoffLineup')?.turn ?? 0,
  apply(raw, anim, sample, ctx, dims) {
    const s = slotOf<LineupSlot>(anim, 'faceoffLineup');
    const turn = s?.turn ?? 0;
    let out = raw;
    const stance = s && s.role ? s.level : 0, draw = drawWeight(sample, ctx);
    if (s && s.role && stance > 0) out = stancePose(raw, anim, sample, ctx, dims, s.role, turn, s.aim);
    if (draw > 0) {
      // The draw mixes over the stance by its own share of the overlay's weight.
      const k = draw >= stance ? 1 : draw / Math.max(stance, 1e-9);
      // (Its places are taken in the frame he was drawn in at the drop, so the stick turns with him as he turns back
      // to the engine's facing rather than staying put in the world while he turns under it.)
      out = mixRaw(out, drawPose(out, sample, ctx, s?.ended ? s.ended.turn : turn, s?.aim ?? null), k);
    }
    return out;
  },
};

/** The centre at the drop: how much of the draw shows (1 from the drop, gone by DRAW_SECONDS after it). */
function drawWeight(s: SkaterSample, ctx: AnimContext): number {
  if (s.state.slot !== 'C' || ctx.state.phase !== 'live') return 0;
  const fo = ctx.timeline.last('faceoff', ctx.tick + 1, Math.ceil(DRAW_SECONDS / DT) + 1);
  if (!fo || (fo.playerId !== s.id && fo.otherId !== s.id)) return 0;
  const t = (ctx.tick + ctx.alpha - fo.tick) * DT;
  // In over the tick of the drop (play is live from the tick before it is drawn), out over the last DRAW_OUT.
  return t > DRAW_SECONDS ? 0 : smooth((t + DT) / DRAW_IN) * (1 - smooth((t - (DRAW_SECONDS - DRAW_OUT)) / DRAW_OUT));
}

/** His line-up stance in place of the standing share of his pose (the faceoff crouch's own stance taken out). */
function stancePose(raw: RawPose, anim: Parameters<NonNullable<Overlay['apply']>>[1], s: SkaterSample, ctx: AnimContext, dims: Parameters<NonNullable<Overlay['apply']>>[4], role: LineupRole, turn: number, aim: Vec3 | null): RawPose {
  const share = styleShare(anim.gait, 'stand');
  const m = motionOfSample(s);
  // The stance the faceoff crouch has put in (its level and its stick aim), to be replaced.
  const crouch = slotOf<number>(anim, 'faceoffCrouch') ?? 0;
  const now = rawPose('stand', anim.gait, 1, m, dims, { crouch, dot: stickAim(toBodyFrame(s, ctx.state.faceoffSpot)) });
  // The dot as he is drawn (turned toward it).
  const dot = toBodyFrame(s, ctx.state.faceoffSpot, 'frame', turn);
  let want: RawPose;
  if (role === 'C') {
    // Low, square, the stick pointed at the dot (as the faceoff crouch points it, from the frame he is drawn in: it
    // never swings round, wherever the dot is while he turns to it).
    const at = aim && ctx.state.phase !== 'faceoffSetup' ? aim : centreAim(dot);
    want = bladeAt(rawPose('stand', anim.gait, 1, m, dims, { crouch: 1, dot: at }), at, dims);
  } else if (role === 'W') {
    want = rawPose('stand', anim.gait, 1, m, dims, { crouch: 0.45, dot: { x: 0.95, y: 0, z: -0.3 } });
  } else {
    want = { ...rawPose('stand', anim.gait, 1, m, dims, { crouch: 0, dot: { x: 0.95, y: 0, z: -0.25 } }), pitch: 0.22 };
  }
  const out = share > 0 ? addRawDelta(raw, now, want, share) : raw;
  // A centre's blade goes by the dot whether he is standing or still shuffling onto his spot.
  return want.bladeAt ? bladeAt(out, want.bladeAt, dims) : out;
}

/**
 * Where a centre puts his blade heel for the dot at `dot` (his drawn body frame): as the faceoff crouch aims it
 * (faceoff.ts stickAim: turned toward the dot within limits, never behind him), but reaching out to the dot itself, a
 * little short of it, when it is in front of him and within reach.
 */
export function centreAim(dot: Vec3): Vec3 {
  const aim = stickAim(dot), dist = Math.hypot(dot.x, dot.z), front = smooth((dot.x / Math.max(dist, 1e-9) - 0.5) / 0.4);
  const reach = 0.9 + (Math.min(1.45, Math.max(0.5, dist - 0.08)) - 0.9) * front, l = Math.hypot(aim.x, aim.z);
  return { x: (aim.x / l) * reach, y: 0, z: (aim.z / l) * reach };
}

/**
 * A centre at the drop: his blade on the dot (in the frame he was drawn in at the drop); the winner's (the `faceoff`
 * event's playerId) then sweeps back along the ice to beside his stick-side skate, pulling the puck to his defenceman
 * as the engine slides it there.
 */
function drawPose(raw: RawPose, s: SkaterSample, ctx: AnimContext, turn: number, aim: Vec3 | null): RawPose {
  const fo = ctx.timeline.last('faceoff', ctx.tick + 1, Math.ceil(DRAW_SECONDS / DT) + 1)!;
  const d = aim ?? toBodyFrame(s, fo.detail.spot, 'frame', turn);
  const dot = { x: Math.max(DRAW_MIN_X, d.x), y: 0, z: d.z };
  if (fo.playerId !== s.id) return bladeAt(raw, dot);
  const k = smooth(((ctx.tick + ctx.alpha - fo.tick) * DT) / DRAW_SWEEP);
  return bladeAt(raw, { x: dot.x + (SWEEP_TO.x - dot.x) * k, y: 0, z: dot.z + (SWEEP_TO.z - dot.z) * k });
}

/** Seconds before the drop up to which a centre's blade is held by the dot over any stick action (a shot off the draw). */
export const HOLD_TO_DROP = 0.2;

/**
 * A centre's blade held by the dot through the setup, over the stick actions (registered after them): a centre who
 * shoots straight off the draw would otherwise start his wind-up (overlays/stick.ts, from the event log) before the puck
 * is dropped. It lets go over the last HOLD_TO_DROP seconds before the drop (the next `faceoff` event), so a shot's
 * wind-up starts no earlier than that.
 */
export const faceoffStickHold: Overlay = {
  id: 'faceoffStickHold',
  weight(anim, sample, ctx) {
    if (ctx.state.phase !== 'faceoffSetup' || sample.state.slot !== 'C') return 0;
    const s = slotOf<LineupSlot>(anim, 'faceoffLineup');
    if (!s || s.role !== 'C' || !s.aim) return 0;
    const fo = ctx.timeline.next('faceoff', ctx.tick - 1, Math.ceil(10 / DT));
    const left = fo ? (fo.tick - (ctx.tick + ctx.alpha)) * DT : Infinity;
    return s.level * smooth(left / HOLD_TO_DROP);
  },
  apply(raw, anim, _sample, _ctx, dims) {
    const s = slotOf<LineupSlot>(anim, 'faceoffLineup')!;
    return bladeAt(raw, s.aim!, dims);
  },
};
