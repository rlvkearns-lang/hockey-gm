/**
 * Whether a pass can be made and received, and how (Task 6): the lane (can an opponent get a stick into it before the
 * puck gets there?), the passer's facing (forehand, backhand or behind him: blade.ts handFor), the weight (hard enough
 * to get there, soft enough to take) and the aim (the receiver's blade where he will be when it arrives; a point man is
 * aimed inside the blue line so the puck stays in). Also the chance he handles it, and the chance an opponent picks a
 * pass off with his stick in the lane.
 *
 * The puck's speed on the ice falls as exp(-ICE_DECAY * t) (puck.ts), so a pass let go at v0 has gone
 * (v0 / k) (1 - exp(-k t)) after t seconds and arrives d metres away at v0 - k d.
 */
import { bladePos as bladePos_, handFor as handFor_ } from './blade';
import { planOf as planOf_ } from './commit';
import { dcos as dcos_, dlog as dlog_, dsin as dsin_ } from './dmath';
import { crossesNet as crossesNet_, passLaneWidth as passLaneWidth_ } from './lanes';
import { ICE_DECAY } from './puck';
import { slideStopChance } from './slide';
import { RINK as RINK_ } from './rink';
import { isTiedUp as isTiedUp_, steeredByContest as steeredByContest_ } from './team-play';
import { TUNING } from './tuning';
import type { GameState, PassHand, PlayerDef, SkaterState } from './types';
import { segDistXY as segDistXY_, type Vec2 } from './vec';
// Local bindings of hot imports (a call through an imported binding costs more under the test runner). Not on an
// import cycle: nothing passing.ts imports imports it.
const bladePos = bladePos_;
const handFor = handFor_;
const planOf = planOf_;
const dlog = dlog_;
const dcos = dcos_;
const dsin = dsin_;
const crossesNet = crossesNet_;
const segDist = segDistXY_;
const passLaneWidth = passLaneWidth_;
const RINK = RINK_;
const isTiedUp = isTiedUp_;
const steeredByContest = steeredByContest_;

/**
 * `cover` (0 to 1): how well an opponent can get his stick into the lane before the puck gets there (laneReach of the
 * one who covers it best, between the puck and the receiver): 0 when nobody can, 1 with a stick already in it.
 * `contest` (0 to 1): how closely an opponent can be on the receiver as it arrives (receiverContest); `chance` (the
 * receiver handles it) already counts it.
 */
export type PassPlan = { toId: string; aim: Vec2; speed: number; hand: PassHand; arriveSeconds: number; arriveSpeed: number; lane: number; chance: number; cover: number; contest: number;
  /** Close-out: PASS.checkerCover when the stick of a man level with or behind the puck is in the lane (valued like cover; he tries for it once it is off the blade), else 0. */
  checker: number };

const PASS = TUNING.pass;
const K = ICE_DECAY;
const BLUE = RINK.blueLineX;
/** TUNING.pass.closeSpeed, bodyInLane, contestClose (Task 7 review, Minor 5: moved to tuning.ts). */
const CLOSE_SPEED = PASS.closeSpeed;
const BODY_IN_LANE = PASS.bodyInLane;
const CONTEST_CLOSE = PASS.contestClose;
/** A pass must still be going this fast (m/s) when it gets there. */
const MIN_ARRIVE = 3;
/** The weight: speed = clamp(WEIGHT_BASE + WEIGHT_PER_METRE * distance, WEIGHT_MIN, his passing speed). */
const WEIGHT_BASE = 8;
const WEIGHT_PER_METRE = 0.9;
const WEIGHT_MIN = 10;
/** A defenceman within this far (m) of the offensive blue line is a point man. */
const POINT_NEAR = 3;
/** Receiving: RECEIVE_MAX, less RECEIVE_PER_MS per m/s over RECEIVE_FROM, less RECEIVE_BEHIND from behind him, plus RECEIVE_PER_POINT per point of puckHandling over 70. */
const RECEIVE_MAX = 0.97;
const RECEIVE_FROM = 12;
const RECEIVE_PER_MS = 0.02;
const RECEIVE_BEHIND = 0.15;
const RECEIVE_PER_POINT = 0.002;
/** A puck coming at him more than 120 degrees off his facing comes from behind him: cos(120 degrees). */
const BEHIND_COS = -0.5;

const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * `t` can be passed to: on the ice, not heading off, not down, not steered by a contest, and his stick not tied up by
 * a net-front defender.
 */
export function canReceivePass(state: GameState, t: SkaterState): boolean {
  return t.onIce && !t.leaving && t.downT === 0 && !steeredByContest(state, t) && !isTiedUp(state, t.id);
}

/**
 * How well an opponent whose body is `off` m from a pass's path gets his stick to it with `seconds` to reach for it: 1 when
 * it is within TUNING.pass.stickReach of him (his stick is in the lane), falling linearly to 0 at stickReach plus the
 * 4 m/s he closes at times `seconds`.
 */
export function laneReach(off: number, seconds: number): number {
  const over = off - PASS.stickReach;
  if (over <= 0) return 1;
  const can = CLOSE_SPEED * seconds;
  return over >= can ? 0 : 1 - over / can;
}

/** Seconds a puck let go at `v0` m/s takes to slide `d` m (Infinity if it stops first). */
export function slideSeconds(d: number, v0: number): number {
  const r = 1 - (K * d) / v0;
  return r <= 0 ? Infinity : -dlog(r) / K;
}

/**
 * Chance an opponent `d` intercepts a pass going `speed` m/s that comes within reach of his body:
 * base + stickChecking * perStick + defensivePositioning * perPositioning (TUNING.pass.intercept), scaled down for
 * fast passes, then clamped to [0.03, 0.97].
 */
export function interceptChance(d: PlayerDef, speed: number): number {
  const base = PASS.intercept.base + d.attrs.stickChecking * PASS.intercept.perStick + d.attrs.defensivePositioning * PASS.intercept.perPositioning;
  const [lo, hi] = PASS.interceptSpeed;
  // Slower than lo it is easier still (Task 7 review): up to PASS.slowFactor times as likely for a dead puck.
  const slow = speed < lo ? 1 + (PASS.slowFactor - 1) * (1 - Math.max(0, speed) / lo) : 1;
  return clamp(base * slow * (1 - 0.5 * clamp((speed - lo) / (hi - lo), 0, 1)), 0.03, 0.97);
}

/** Interception chance for an opponent whose stick blade is within TUNING.pass.stickLane (0.75 m) of the path: interceptChance * TUNING.pass.stickFactor (1.5), clamped to [0.03, 0.97]. A body within interceptRange but no stick in the lane keeps interceptChance. */
export function stickInterceptChance(d: PlayerDef, speed: number): number {
  return clamp(interceptChance(d, speed) * PASS.stickFactor, 0.03, 0.97);
}

/**
 * Chance the receiver handles it: 0.97, less 0.02 per m/s over 12, less 0.15 arriving from behind him (over 120 degrees
 * off his facing), plus 0.002 per point of puckHandling over 70, less TUNING.pass.contested times `contested` (0 to 1: an
 * opponent on him as it arrives, receiverContest); clamped to [0.03, 0.97].
 */
export function receiveChance(receiver: PlayerDef, arriveSpeed: number, fromBehind: boolean, contested = 0): number {
  return clamp(RECEIVE_MAX - RECEIVE_PER_MS * Math.max(0, arriveSpeed - RECEIVE_FROM) - (fromBehind ? RECEIVE_BEHIND : 0)
    + RECEIVE_PER_POINT * (receiver.attrs.puckHandling - 70) - PASS.contested * contested, 0.03, 0.97);
}

/**
 * How much an opponent `d` m from where the pass is taken contests the catch, with `seconds` to close on it at 1 m/s:
 * 1 within TUNING.pass.stickReach, falling linearly to 0 over TUNING.pass.contestRange beyond what he can close.
 */
export function receiverContest(d: number, seconds: number): number {
  const over = d - PASS.stickReach - CONTEST_CLOSE * seconds;
  return over <= 0 ? 1 : over >= PASS.contestRange ? 0 : 1 - over / PASS.contestRange;
}

/** Whether a puck travelling (vx, vy) comes at a man facing `facing` from behind him (over 120 degrees off his facing). */
export function comesFromBehind(facing: number, vx: number, vy: number): boolean {
  const v = hyp(vx, vy);
  return v > 0 && (-vx * dcos(facing) - vy * dsin(facing)) / v < BEHIND_COS;
}

/** Whether `m` is a point man: job pointStrong or pointWeak, or a defenceman within POINT_NEAR (m) of the blue line he attacks. */
function isPointMan(state: GameState, m: SkaterState): boolean {
  const j = planOf(state, m.id).job;
  if (j === 'pointStrong' || j === 'pointWeak') return true;
  return (m.slot === 'LD' || m.slot === 'RD') && Math.abs(m.pos.x * state.attackDir[m.side] - BLUE) <= POINT_NEAR;
}

const HAND_SPEED: Record<PassHand, number> = { forehand: 1, backhand: PASS.backhand.speed, behind: PASS.behind.speed };
const HAND_RANGE: Record<PassHand, number> = { forehand: TUNING.brain.passRange[1], backhand: PASS.backhand.range, behind: PASS.behind.range };
/** Direction error, as a multiple of a forehand's. */
export const HAND_ERROR: Record<PassHand, number> = { forehand: 1, backhand: PASS.backhand.error, behind: PASS.behind.error };

const futScratch: Vec2 = { x: 0, y: 0 };
const bladeScratch2: Vec2 = { x: 0, y: 0 };
/** Only a man within this far (m) of the puck, level with or behind it, can have his stick in the lane ahead of it. */
const CHECKER_NEAR = 2.5;

/**
 * Fills `out` with the pass from the puck (on `from`'s blade) to `to`: aimed at his blade where he will be when it
 * arrives (a point man no nearer the line than TUNING.pass.pointInside), with the weight for its length and hand.
 * With `check`, returns null for a pass that is not an option (see planPass); without, always fills it in (a forced pass).
 */
function planInto(state: GameState, from: SkaterState, to: SkaterState, defs: Map<string, PlayerDef>, out: PassPlan, check: boolean): PassPlan | null {
  if (check && !canReceivePass(state, to)) return null;
  const fd = defs.get(from.id), td = defs.get(to.id);
  const fromShoots = fd ? fd.shoots : 'L', toShoots = td ? td.shoots : 'L';
  const cap = PASS.speed.base + (fd ? fd.attrs.passing : 50) * PASS.speed.perPoint;
  const p = state.puck.pos;
  const dir = state.attackDir[to.side];
  const point = isPointMan(state, to);
  const aim = out.aim ?? (out.aim = { x: 0, y: 0 });
  let t = 0, d = 0, speed = 0;
  let hand: PassHand = 'forehand';
  for (let k = 0; k < 3; k++) {
    futScratch.x = to.pos.x + to.vel.x * t;
    futScratch.y = to.pos.y + to.vel.y * t;
    bladePos(futScratch, to.facing, toShoots, aim);
    // A point man: aimed inside the line, so that a pass he cannot quite reach stays in.
    if (point && aim.x * dir < BLUE + PASS.pointInside) aim.x = (BLUE + PASS.pointInside) * dir;
    d = hyp(aim.x - p.x, aim.y - p.y);
    hand = check ? handFor(from.pos, from.facing, fromShoots, aim) : 'forehand';
    // The weight: hard enough to get there, never arriving faster than he can take it.
    speed = Math.min(clamp(WEIGHT_BASE + WEIGHT_PER_METRE * d, WEIGHT_MIN, cap), PASS.maxReceiveSpeed + K * d) * HAND_SPEED[hand];
    if (!check) speed = Math.max(speed, K * d + MIN_ARRIVE);
    t = slideSeconds(d, speed);
    if (t === Infinity) { if (check) return null; t = d / speed; }
  }
  const arriveSpeed = speed - K * d;
  if (check) {
    if (d < TUNING.brain.passRange[0] || d > HAND_RANGE[hand] || arriveSpeed < MIN_ARRIVE || arriveSpeed > PASS.maxReceiveSpeed + 1e-9) return null;
    if (crossesNet(p, aim)) return null;
    // Task 8b close-out (no-shot goals traced on seeds 1-16). A pass is never aimed so that, missed, it slides on into his
    // own net: its line, carried on up to PASS.netBeyond m past the aim, does not reach his own goal line inside the posts
    // (with PASS.netCone m of margin per metre travelled: its direction error). And a backhand or blind pass is not thrown
    // across the front of his own net (within PASS.ownNetClear m of its centre): two own goals came that way.
    // (Task 8b review, Important 2: the net he attacks is no reason to refuse a pass: a lead pass to a man driving it is
    // a real play, and the goalie plays a puck that slides at him, goalie.ts slideStopChance.)
    {
      const end = -dir;
      const gx = end * RINK.goalLineX, vx = aim.x - p.x;
      if (vx * end > 0) {
        const u = (gx - p.x) / vx;
        const l = u * d;
        // (Before the aim too: a pass from in front to a man behind the goal line goes by the post, not through the mouth.)
        if (l - d < PASS.netBeyond && Math.abs(p.y + (aim.y - p.y) * u) < RINK.netHalfWidth + PASS.netCone * l) return null;
      }
    }
    if (hand !== 'forehand' && segDist(-dir * RINK.goalLineX, 0, p.x, p.y, aim.x, aim.y) < PASS.ownNetClear) return null;
    // A body standing in the lane stops the pass (no option); an opponent who can get a stick into it before the puck
    // gets there covers it (`cover`, the best of them): the pass is riskier, not impossible.
    const ax = aim.x - p.x, ay = aim.y - p.y, l2 = d * d;
    // A man at or beyond the receiver is not in the lane: he contests the catch (receiverContest).
    let cover = 0, contest = 0, checker = 0;
    for (const o of state.skaters) {
      if (!o.onIce || o.side === from.side || o.downT > 0) continue;
      const c = receiverContest(hyp(o.pos.x - aim.x, o.pos.y - aim.y), t);
      if (c > contest) contest = c;
      const u = l2 === 0 ? 0 : ((o.pos.x - p.x) * ax + (o.pos.y - p.y) * ay) / l2;
      // A man behind the puck (or level with it) harries the passer; the lane is ahead of it. But his stick may be in
      // it (close-out: since the Task 8 review fix the passer's checker tries for the pass once it is off the blade, 21
      // picked off a game; the passer now sees that stick as cover).
      if (u <= 0) {
        if (hyp(o.pos.x - p.x, o.pos.y - p.y) > CHECKER_NEAR) continue;
        const od = defs.get(o.id);
        const ob = bladePos(o.pos, o.facing, od ? od.shoots : 'L', bladeScratch2);
        const ub = l2 === 0 ? 0 : ((ob.x - p.x) * ax + (ob.y - p.y) * ay) / l2;
        if (ub > 0 && ub < 1 && hyp(ob.x - (p.x + ax * ub), ob.y - (p.y + ay * ub)) < PASS.stickLane) checker = PASS.checkerCover;
        continue;
      }
      if (u >= 1) continue;
      const off = hyp(o.pos.x - (p.x + ax * u), o.pos.y - (p.y + ay * u));
      if (off < BODY_IN_LANE) return null;
      const r = laneReach(off, slideSeconds(u * d, speed));
      if (r > cover) cover = r;
    }
    // The goalie defending against the passer: a lane through his reach (a feed across his crease) is covered by his stick,
    // as goalie.ts goaliePlaysPass plays it (Task 8b review, Important 2).
    {
      const gl = state.goalies[from.side === 'home' ? 'away' : 'home'].pos;
      const u = l2 === 0 ? 0 : ((gl.x - p.x) * ax + (gl.y - p.y) * ay) / l2;
      if (u > 0 && u < 1) {
        const off = hyp(gl.x - (p.x + ax * u), gl.y - (p.y + ay * u));
        if (off <= TUNING.goalie.slide.reach) { const r = slideStopChance(speed - K * u * d, off); if (r > cover) cover = r; }
      }
    }
    out.cover = cover;
    out.contest = contest;
    out.checker = checker;
  } else { out.cover = 0; out.contest = 0; out.checker = 0; }
  out.toId = to.id;
  out.speed = speed;
  out.hand = hand;
  out.arriveSeconds = t;
  out.arriveSpeed = arriveSpeed;
  out.lane = passLaneWidth(state, from.side, p, aim);
  // From behind him: the puck comes at him from more than 120 degrees off his facing.
  const rx = p.x - aim.x, ry = p.y - aim.y, rl = hyp(rx, ry) || 1;
  const behind = (rx * dcos(to.facing) + ry * dsin(to.facing)) / rl < BEHIND_COS;
  out.chance = td ? receiveChance(td, arriveSpeed, behind, out.contest) : RECEIVE_MAX;
  return out;
}

/**
 * The pass from `from` to `to`, or null when it is not an option: the receiver cannot take a pass (canReceivePass), it is out of
 * range for the hand (forehand TUNING.brain.passRange; backhand 15 m; behind 8 m), it would go through an opponent's body
 * (one within 0.3 m of the lane ahead of the puck), or it would arrive faster than TUNING.pass.maxReceiveSpeed (16 m/s).
 * Also null through a net frame or too soft to get there. An opponent between the puck and the receiver who can get his
 * stick into the lane before the puck gets there (his distance to the path less TUNING.pass.stickReach 1.2 m, at 4 m/s, against the puck's time to that point:
 * laneReach) does not remove it: he covers it (`cover`), which makes it riskier (options.ts values it lower, and
 * actions.ts tryIntercept gives him his reach at it). A man behind the puck, level with or behind its start, harries the
 * passer instead and does not count; one at or beyond the receiver contests the catch (`contest`, a lower `chance`).
 * Aim: the receiver's blade where he will be when it arrives. A point man (job pointStrong / pointWeak, or a defenceman within
 * 3 m of the offensive blue line) is aimed at no nearer the line than TUNING.pass.pointInside (1.5 m).
 * Weight: speed = clamp(8 + 0.9 * distance, 10, TUNING.pass.speed for his passing), times 0.75 backhand, 0.6 behind (and never
 * so hard that it would arrive over maxReceiveSpeed).
 */
export function planPass(state: GameState, from: SkaterState, to: SkaterState, defs: Map<string, PlayerDef>, out: PassPlan): PassPlan | null {
  return planInto(state, from, to, defs, out, true);
}

/** A forehand pass to `to` whatever the lane, range or receiver (for a pass he has decided on that planPass would not offer). */
export function forcedPass(state: GameState, from: SkaterState, to: SkaterState, defs: Map<string, PlayerDef>, out: PassPlan): PassPlan {
  return planInto(state, from, to, defs, out, false)!;
}
