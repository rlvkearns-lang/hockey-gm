import { DT, type GameEventOf } from '@hockey/engine';
import { toBodyFrame, type AnimContext, type GoalieOverlay, type Overlay, type SkaterSample } from '../anim-context';
import { styleShare } from '../gait';
import { mixRaw, type RawPose } from '../pose-mix';

/**
 * Blocked shots and goal reactions (pure: no three.js, no DOM). Each is a function of the display time, the timeline
 * and the engine state of the frame, so a seek shows what play shows however long ago its event was. Positions stay
 * the engine's: only the upper body, the arms, the stick and the head move (a blocker also drops his hips).
 *
 * - blockOverlay: a skater who blocks a shot (`block`, playerId) reads the shot coming (from the shooter's wind-up,
 *   at most BLOCK_READ before the release) and drops to a knee square to the shooter, his stick laid in the lane at the
 *   spot where the engine turns the puck back (its place at display time T - 1, T the block's tick: the engine blocks
 *   a shot within 0.9 m of a skater's centre and turns the puck back from where it is, often a metre or two short of
 *   him), so the puck is drawn coming off his stick. He holds it, then gives way to a fall (the gait's down share).
 * - celebrateOverlay: after a `goal`, the scorer raises his arms with his stick up; his teammates on the ice raise their
 *   sticks and turn toward him. All fade by CELEBRATE_END after the goal, before the next draw (the stoppage after a
 *   goal is 1.5 s and the faceoff setup at least 3 s more).
 * - beatenGoalie: the goalie scored on slumps: head and shoulders down, hands low; the same timing.
 */

const TICKS = (s: number): number => s / DT;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };

/** A blocker reads the shot at most this long (s) before the release, and is down at least this long before the puck reaches him. */
const BLOCK_READ = 0.3, BLOCK_DROP = 0.33, BLOCK_LONGEST = 0.6;
/** He stays down this long after the puck comes off him, then gets up over BLOCK_UP (ticks). */
const BLOCK_HOLD = 9, BLOCK_UP = 15;
/** His hips drop to this share of his standing hip height. */
const BLOCK_HIP = 0.62;
/** The furthest (m) from his centre he lays his stick blade. */
const BLOCK_REACH = 1.55;

/** The celebration is full from this long (ticks) after the goal's tick... */
const CELEBRATE_RISE = 9;
/** ...holds to CELEBRATE_HOLD and has faded out by CELEBRATE_END (ticks after the goal). */
const CELEBRATE_HOLD = TICKS(3), CELEBRATE_END = TICKS(4);

type Block = { e: GameEventOf<'block'> | null; begin: number; contact: number; w: number };
/**
 * The blocks he is reacting to at display time now, into `out` (made once): the latest begun first, then the one before
 * it if it still shows (`e` null for none), each with its timing (ticks: the drop begins, the puck comes off him) and
 * its own weight.
 */
function blocksOf(sample: SkaterSample, ctx: AnimContext, now: number, out: [Block, Block]): void {
  const tl = ctx.timeline, base = Math.floor(now);
  out[0].e = null; out[1].e = null;
  let e = tl.last('block', base + TICKS(BLOCK_LONGEST + BLOCK_READ) + 2, TICKS(BLOCK_LONGEST + BLOCK_READ) + 2 + BLOCK_HOLD + BLOCK_UP + 2, sample.id);
  for (let i = 0; i < 4 && e && !out[1].e; i++) {
    const contact = e.tick - 1;
    const begin = Math.min(contact - TICKS(BLOCK_DROP), Math.max(e.detail.releaseTick - 1 - TICKS(BLOCK_READ), contact - TICKS(BLOCK_LONGEST)));
    if (begin <= now && now <= contact + BLOCK_HOLD + BLOCK_UP) {
      const b = out[out[0].e ? 1 : 0];
      b.e = e; b.begin = begin; b.contact = contact;
      b.w = smooth((now - begin) / (contact - begin)) * (1 - smooth((now - contact - BLOCK_HOLD) / BLOCK_UP));
    }
    e = tl.last('block', e.tick - 1, e.tick - 1 - (base - BLOCK_HOLD - BLOCK_UP - 2), sample.id);
  }
}

const newBlock = (): Block => ({ e: null, begin: 0, contact: 0, w: 0 });
const blocks: [Block, Block] = [newBlock(), newBlock()];

/** His block pose for one block: down on a knee square to the shooter, the stick in the lane. */
function blockRaw(raw: RawPose, b: Block & { e: GameEventOf<'block'> }, sample: SkaterSample, ctx: AnimContext, dims: SkaterSample['dims']): RawPose {
  // The shot: where it was let go, and where the engine turns it back off him (on its path at display time T - 1).
  const rel = ctx.timeline.last('release', b.e.detail.releaseTick, 0, b.e.otherId ?? undefined);
  const tau = Math.max(0, b.contact - (b.e.detail.releaseTick - 1)) * DT;
  const from = rel ? rel.pos : b.e.pos;
  const turn = rel ? { x: rel.pos.x + rel.detail.vel.x * tau, y: rel.pos.y + rel.detail.vel.y * tau } : b.e.pos;
  // The way the puck comes from: back along the shot's line (a world direction, so it turns only as he turns).
  const vx = rel ? rel.detail.vel.x : from.x - sample.pos.x, vy = rel ? rel.detail.vel.y : from.y - sample.pos.y, vl = Math.hypot(vx, vy) || 1;
  const back = rel ? -1 : 1;
  const shooter = toBodyFrame(sample, { x: sample.pos.x + (back * vx * 3) / vl, y: sample.pos.y + (back * vy * 3) / vl }), spot = toBodyFrame(sample, turn);
  // Square to the shooter (shoulders turned toward him, within reason; not at all for a shot from behind, so the turn
  // never flips from one side to the other), down on a knee: the far skate back.
  const toShooter = frontTurn(shooter, 1.1);
  const hipY = BLOCK_HIP * dims.hipHeight;
  // The stick laid low in the lane, out toward the shooter, on the side of him the puck comes (the engine turns it
  // back from its place at T - 1, about this far out along the shot's line).
  // (Faded out as he skates over that spot or it goes round behind the line to the shooter, so it never swings.)
  const lane = Math.atan2(spot.z, spot.x) - Math.atan2(shooter.z, shooter.x), cl = Math.cos(lane);
  const side = clamp(Math.atan2(Math.sin(lane), Math.cos(lane)), -0.35, 0.35) * smooth((Math.hypot(spot.x, spot.z) - 0.4) / 0.8) * smooth((cl + 0.2) / 0.6);
  const aim = frontTurn(shooter, 1.3) + side * smooth((shooter.x + 0.5) / 1.5);
  return {
    ...raw, hipY, pitch: 0.3, roll: 0, twist: toShooter, look: toShooter * 0.4, lookDown: 0.25,
    legs: [{ foot: { x: -0.55, y: 0, z: -0.16 }, footYaw: 0.4 }, { foot: { x: 0.32, y: 0, z: 0.2 }, footYaw: 0.2 }],
    twoHands: 1, top: { x: 0.2, y: -0.12, z: 0.12 }, bladeUp: 0,
    blade: { x: BLOCK_REACH * Math.cos(aim), y: 0, z: BLOCK_REACH * Math.sin(aim) }, bladeAt: undefined, bladeAtW: 0,
  };
}

export const blockOverlay: Overlay = {
  id: 'block',
  weight(anim, sample, ctx) {
    if (!sample.onIce) return 0;
    blocksOf(sample, ctx, ctx.tick + ctx.alpha, blocks);
    const w = Math.max(blocks[0].e ? blocks[0].w : 0, blocks[1].e ? blocks[1].w : 0) * (1 - styleShare(anim.gait, 'down'));
    return w > 1e-4 ? w : 0;
  },
  apply(raw, _anim, sample, ctx, dims) {
    blocksOf(sample, ctx, ctx.tick + ctx.alpha, blocks);
    const [a, b] = blocks;
    if (!a.e) return raw;
    const pa = blockRaw(raw, a as Block & { e: GameEventOf<'block'> }, sample, ctx, dims);
    if (!b.e) return pa;
    // A block coming while he is still down from the one before: from that one's pose into this one's.
    return mixRaw(blockRaw(raw, b as Block & { e: GameEventOf<'block'> }, sample, ctx, dims), pa, a.w / Math.max(1e-9, Math.max(a.w, b.w)));
  },
};

/**
 * The heading of a body-frame point, clamped to `max` either way, and eased to straight ahead for a point behind him
 * (so it is continuous wherever the point goes).
 */
function frontTurn(p: { x: number; z: number }, max: number): number {
  const a = Math.atan2(p.z, p.x);
  return clamp(a, -max, max) * smooth((Math.cos(a) + 0.6) / 0.6);
}

/** The goal being celebrated at display time now (before the next draw), if any. */
function goalOf(ctx: AnimContext, now: number): GameEventOf<'goal'> | undefined {
  const g = ctx.timeline.last('goal', Math.floor(now) + 1, CELEBRATE_END + 1);
  if (!g || now < g.tick - 1 || now > g.tick + CELEBRATE_END) return undefined;
  // Never past the draw that follows.
  if (ctx.timeline.next('faceoff', g.tick, Math.max(0, Math.floor(now) - g.tick))) return undefined;
  return g;
}
const celebrateLevel = (g: GameEventOf<'goal'>, now: number, delay: number, rise = CELEBRATE_RISE): number =>
  smooth((now - (g.tick - 1 + delay)) / rise) * (1 - smooth((now - g.tick - CELEBRATE_HOLD) / (CELEBRATE_END - CELEBRATE_HOLD)));
/**
 * The scorer raises his arms once his shot's follow-through is over (overlays/stick.ts runs it FOLLOW_TICKS, 24, after
 * the release, and has let it go by this many ticks after the release), over SCORER_RISE ticks: within a second of the
 * goal whatever the shot's flight.
 */
const SCORER_AFTER_RELEASE = 23, SCORER_RISE = 10;
const scorerDelay = (g: GameEventOf<'goal'>): number => (g.detail.releaseTick === null ? 0 : Math.max(0, g.detail.releaseTick + SCORER_AFTER_RELEASE - (g.tick - 1)));

export const celebrateOverlay: Overlay = {
  id: 'celebrate',
  weight(anim, sample, ctx) {
    if (!sample.onIce) return 0;
    const now = ctx.tick + ctx.alpha, g = goalOf(ctx, now);
    if (!g || g.side !== sample.side) return 0;
    const scorer = g.playerId === sample.id;
    if (!scorer && !g.onIce?.[sample.side].includes(sample.id)) return 0;
    const w = (scorer ? celebrateLevel(g, now, scorerDelay(g), SCORER_RISE) : 0.85 * celebrateLevel(g, now, 4)) * (1 - styleShare(anim.gait, 'down'));
    return w > 1e-4 ? w : 0;
  },
  apply(raw, _anim, sample, ctx, dims) {
    const g = goalOf(ctx, ctx.tick + ctx.alpha);
    if (!g) return raw;
    if (g.playerId === sample.id) {
      // Both arms up, the stick held high, head up, leaning back a little.
      // The stick held up level with his hand (the shaft runs level from it), out in front on his stick side.
      return {
        ...raw, pitch: -0.08, roll: 0, twist: 0, look: 0, lookDown: -0.25, twoHands: 0,
        top: { x: 0.12, y: dims.torso + 0.42, z: 0.2 }, freeRel: { x: 0.08, y: 0.5, z: -0.12 },
        bladeUp: raw.hipY + dims.torso + 0.42, blade: { x: 0.9, y: 0, z: -0.5 }, bladeAt: undefined, bladeAtW: 0,
      };
    }
    // A teammate: stick raised, turned toward the scorer.
    const sc = ctx.skaters.get(g.playerId ?? '');
    const at = sc && sc.onIce ? toBodyFrame(sample, sc.pos) : { x: 1, y: 0, z: 0 };
    const turn = frontTurn(at, 0.9);
    return {
      ...raw, pitch: 0.05, twist: turn, look: turn * 0.6, lookDown: 0, twoHands: 0, top: { x: 0.3, y: dims.torso * 0.85, z: 0.22 },
      freeRel: { x: 0.1, y: 0.35, z: -0.1 }, bladeUp: (raw.hipY + dims.torso * 0.85) * 0.85, blade: { x: 1.2, y: 0, z: 0.5 }, bladeAt: undefined, bladeAtW: 0,
    };
  },
};

/** The goalie scored on: head and shoulders down, hands low, from just after the puck goes by until the celebration ends. */
export const beatenGoalie: GoalieOverlay = {
  id: 'beaten',
  weight(_anim, sample, ctx) {
    const now = ctx.tick + ctx.alpha, g = goalOf(ctx, now);
    if (!g || g.otherId !== sample.id) return 0;
    const w = celebrateLevel(g, now, 6);
    return w > 1e-4 ? w : 0;
  },
  apply(raw, _anim, _sample, _ctx, dims) {
    const k = dims.torso / 0.288 / 1.88;
    return {
      ...raw, pitch: raw.pitch + 0.3, look: 0.75, hipY: raw.hipY + 0.04 * k,
      glove: { x: 0.3 * k, y: 0.6 * k, z: -0.38 * k }, blocker: { x: 0.3 * k, y: 0.55 * k, z: 0.34 * k },
      heel: { x: 0.55 * k, y: 0, z: 0.25 * k },
    };
  },
};
