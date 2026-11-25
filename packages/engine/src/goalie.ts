import type { GoalieAttrs } from './attributes';
import { DT as DT_ } from './constants';
import { gameEvent as gameEvent_ } from './events';
import { stopPlay as stopPlay_ } from './faceoff';
import type { PuckEvent } from './puck';
import { FACEOFF_DOTS as FACEOFF_DOTS_, RINK as RINK_ } from './rink';
import type { Rng } from './rng';
import { wrapAngle as wrapAngle_ } from './skating';
import { TUNING as TUNING_ } from './tuning';
import { saveOutcome as saveOutcome_, type SaveFacts } from './rebounds';
import { hasBadge } from './badges';
import { slideStopChance } from './slide';
import type { Crossing, EventDetails, GameEvent, GameState, GoaliePose, GoalieState, PlayerDef, ShotInFlight, Side } from './types';
import { dist as dist_, hypot2 as hypot2_, segDistXY as segDistXY_, type Vec2 } from './vec';
import { datan2 as datan2_, dexp as dexp_, dtanh as dtanh_, hypot3 as hypot3_ } from './dmath';
import { clamp as clamp_, GRAVITY as GRAVITY_, other as other_, PUCK_RADIUS as PUCK_RADIUS_, SIDES as SIDES_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const DT = DT_;
const gameEvent = gameEvent_;
const stopPlay = stopPlay_;
const FACEOFF_DOTS = FACEOFF_DOTS_;
const RINK = RINK_;
const wrapAngle = wrapAngle_;
const TUNING = TUNING_;
const dist = dist_;
const hypot2 = hypot2_;
const segDistXY = segDistXY_;
const datan2 = datan2_;
const hypot3 = hypot3_;
const GRAVITY = GRAVITY_;
const saveOutcome = saveOutcome_;
const dexp = dexp_;
const dtanh = dtanh_;
const clamp = clamp_;
const other = other_;
const PUCK_RADIUS = PUCK_RADIUS_;
const SIDES = SIDES_;

const GOAL = RINK.goalLineX;

const G = TUNING.goalie;
/** He never stands closer than this to the goal line (m), nor wider than POST_Y from the middle (m). */
const LINE_GAP = 0.3;
const POST_Y = 0.75;
/** His top speed is cut to this share while showing a save. */
const POSE_SPEED_FACTOR = 0.4;
/** How long a save pose and a cover are shown (s). */
const POSE_SECONDS = TUNING.goalie.poseSeconds;
const COVER_SECONDS = TUNING.goalie.rebound.coverSeconds;
/** He faces only a shot on its way in clear of the posts (by POST_CLEAR m: the puck and the post's radius, plus TUNING.goalie.face.postClear) and under the bar (by BAR_CLEAR m). */
const POST_CLEAR = PUCK_RADIUS_ + 0.03 + TUNING.goalie.face.postClear;
const BAR_CLEAR = TUNING.goalie.face.barClear;
const POSTS: readonly number[] = [RINK_.netHalfWidth, -RINK_.netHalfWidth];
/** A save needs him within this far (m) of the puck's line (TUNING.goalie.face.reach; Task 8 review, Minor 1). */
const SAVE_REACH = TUNING.goalie.face.reach;
/** An attacker screens him within SCREEN_OFF (m) of a shot's line, SCREEN_NEAR to SCREEN_FAR (m) in front of him (TUNING.goalie.screen). */
const SCREEN_OFF = TUNING.goalie.screen.off;
const SCREEN_NEAR = TUNING.goalie.screen.near;
const SCREEN_FAR = TUNING.goalie.screen.far;
/** A save above this height (m) is a glove or blocker save; below it, a pad save when this far (m) off his centre, else butterfly. */
const HIGH_SAVE_Z = 0.5;
const PAD_OFFSET = 0.35;

const logistic = (x: number): number => 1 / (1 + dexp(-x));

function goalieAttrs(defs: Map<string, PlayerDef>, id: string): GoalieAttrs {
  const a = defs.get(id)?.goalie;
  if (!a) throw new Error(`no goalie attributes for ${id}`);
  return a;
}


/** `f` with the goalie `id`'s badges (Task 12: Rebound Control, Glove Hand). */
function withBadges(defs: Map<string, PlayerDef> | undefined, id: string, f: SaveFacts): SaveFacts {
  const d = defs?.get(id);
  if (d === undefined || d.badges === undefined) return f;
  f.reboundControlBadge = hasBadge(d, 'Rebound Control');
  f.gloveHandBadge = hasBadge(d, 'Glove Hand');
  return f;
}

/** Whether Glove Hand counts on a puck reaching goalie `g` (of `gd`) at (y, z) at net end `end`: he has it and it comes to his catching side above TUNING.badges.gloveHeight (Task 12). */
function gloveSide(gd: PlayerDef | undefined, g: GoalieState, y: number, z: number, end: 1 | -1): boolean {
  if (gd === undefined || !hasBadge(gd, 'Glove Hand') || z <= TUNING.badges.gloveHeight) return false;
  return poseFor(gd.catches ?? 'L', { netEnd: end, dy: y - g.pos.y, z }) === 'glove';
}

/** Whether `shot`'s shooter has Quick Release (a tipped shot is the tipper's: none). */
const quickOf = (defs: Map<string, PlayerDef>, shot: ShotInFlight): boolean => shot.tippedBy === null && hasBadge(defs.get(shot.shooterId)!, 'Quick Release');

/** The side whose net is at `end` (+1 or -1 along x). */
const defenderOf = (state: GameState, end: 1 | -1): Side => (state.attackDir.home === end ? 'away' : 'home');

export type SaveInput = {
  goalie: GoalieAttrs;
  /** How far (m) the shot passes from his centre, plus his squaring error. */
  lateralMiss: number;
  shotSpeed: number;
  /** From the release to the net (m). */
  distance: number;
  screened: boolean;
  goalieMovingSpeed: number;
  /** Height (m) at which the puck reaches the goal line. */
  height: number;
  /** His night (GameState.goalieNight): added to the log-odds. Default 0. */
  night?: number;
  /** A tipped shot (Task 8): G.save.tipped off the log-odds. */
  tipped?: boolean;
  /** 0 to 1: how much of his last save's pose he still has to come out of (his poseT over the pose length): G.save.recovering at 1. */
  recovering?: number;
  /** Task 12: the shooter has Quick Release (the goalie's reaction time times TUNING.badges.quickReleaseReaction). */
  quickRelease?: boolean;
  /** Task 12: the goalie has Glove Hand and the puck comes to his catching side above gloveHeight (+ TUNING.badges.gloveSave log-odds). */
  gloveHand?: boolean;
};

/** Chance that the goalie stops a shot on net. Parity: clamped to [0.03, 0.97]. */
export function saveChance(input: SaveInput): number {
  const a = input.goalie;
  let skill = 0, w = 0;
  for (const [k, wt] of Object.entries(G.saveSkill) as [keyof GoalieAttrs, number][]) { skill += a[k] * wt; w += wt; }
  skill /= w;
  const reaction = Math.min(1, input.distance / Math.max(1, input.shotSpeed)) * (input.quickRelease === true ? TUNING.badges.quickReleaseReaction : 1);
  const lm = input.lateralMiss;
  // Skill counts nearly linearly around 70 (less above it than below) and flattens out toward the extremes.
  const per = skill >= 70 ? G.save.perPointAbove : G.save.perPoint;
  const skillTerm = per * G.save.skillSpan * dtanh((skill - 70) / G.save.skillSpan);
  const logit = G.save.base + G.save.perReactionSecond * reaction + skillTerm + (input.night ?? 0) + (input.gloveHand === true ? TUNING.badges.gloveSave : 0)
    + Math.min(G.save.slowMax, G.save.perSlowSpeed * Math.max(0, G.save.slowFrom - input.shotSpeed)) * clamp(input.distance / G.save.slowFull, 0, 1)
    - (input.screened ? G.save.screened : 0)
    - (input.tipped ? G.save.tipped : 0)
    - G.save.recovering * clamp(input.recovering ?? 0, 0, 1)
    - G.save.perMovingSpeed * input.goalieMovingSpeed
    - G.save.perBodyMetre * Math.max(0, lm - G.save.body)
    - G.save.perStretchMetre * Math.max(0, lm - G.save.stretch)
    - G.save.perHighMetre * Math.max(0, input.height - G.save.highFrom);
  return clamp(logistic(logit), 0.03, 0.97);
}

export { slideStopChance } from './slide';

/**
 * A pass on the ice that slides within G.slide.reach of the goalie defending against its passer this tick (from `prev` to
 * the puck now: a feed through his crease) gets one try from him (pendingPass.tried): slideStopChance by its speed and how
 * far its line passes from his centre (Task 8b review, Important 2). Stopped: the puck goes back to the point of its path
 * nearest him, a `stop` event, and he covers it (`freeze`), steers it away or leaves it loose in front (saveOutcome). No
 * shot on goal. Returns whether he stopped it. Events go into `out`.
 */
export function goaliePlaysPass(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, prev: Vec2, out: GameEvent[]): boolean {
  const pass = state.pendingPass;
  const pk = state.puck;
  if (pass === null || state.shotInFlight !== null || pk.z > G.cover.maxZ) return false;
  let passer: Side | null = null;
  for (const s of state.skaters) if (s.id === pass.fromId) { passer = s.side; break; }
  if (passer === null) return false;
  const defSide = other(passer);
  const g = state.goalies[defSide];
  if (pass.tried.includes(g.id)) return false;
  const off = segDistXY(g.pos.x, g.pos.y, prev.x, prev.y, pk.pos.x, pk.pos.y);
  if (off > G.slide.reach) return false;
  pass.tried.push(g.id);
  const speed = hypot2(pk.vel.x, pk.vel.y);
  if (!rng.chance(slideStopChance(speed, off))) return false;
  // Where its path came nearest him.
  const mx = pk.pos.x - prev.x, my = pk.pos.y - prev.y, m2 = mx * mx + my * my;
  const t = m2 === 0 ? 0 : clamp(((g.pos.x - prev.x) * mx + (g.pos.y - prev.y) * my) / m2, 0, 1);
  pk.pos.x = prev.x + mx * t;
  pk.pos.y = prev.y + my * t;
  const end = (-state.attackDir[defSide]) as 1 | -1;
  const pose = savePose(g, defs.get(g.id)?.catches ?? 'L', pk.pos.y, 0, end);
  g.pose = pose;
  g.poseT = POSE_SECONDS;
  state.pendingPass = null;
  const stop = gameEvent(state, { type: 'stop', side: defSide, playerId: g.id, otherId: pass.fromId, pos: pk.pos, detail: { pose, kind: 'rebound', speed } });
  out.push(stop);
  const cross: Crossing = { side: (pk.pos.y - g.pos.y) * -end, height: 0 };
  stop.detail.kind = saveOutcome(state, defSide, withBadges(defs, g.id, { pose, speed, screened: false, tipped: false, reboundControl: goalieAttrs(defs, g.id).reboundControl }), cross, rng, out, 'cover');
  return true;
}

/** Where `g` (defending the net at `end`) wants to be for the puck at `p`. Writes `out`. */
function goalieSpot(p: Vec2, end: 1 | -1, out: Vec2): Vec2 {
  const nx = end * GOAL;
  const dx = p.x - nx, dy = p.y;
  if (dx * end >= -LINE_GAP) {
    // Puck at or behind the goal line: hug the post on its side.
    out.x = nx - end * LINE_GAP;
    out.y = (dy >= 0 ? 1 : -1) * POST_Y;
    return out;
  }
  const d = hypot2(dx, dy);
  const depth = clamp(G.depth.min + (d - G.depth.near) * G.depth.perMetre, G.depth.min, G.depth.max);
  out.x = nx + (dx / d) * depth;
  out.y = clamp((dy / d) * depth, -POST_Y, POST_Y);
  if ((out.x - nx) * end > -LINE_GAP) out.x = nx - end * LINE_GAP;
  return out;
}

const spot: Vec2 = { x: 0, y: 0 };

function moveGoalie(g: GoalieState, a: GoalieAttrs, p: Vec2, end: 1 | -1, dt: number): void {
  goalieSpot(p, end, spot);
  stepGoalie(g, a, spot, datan2(p.y - g.pos.y, p.x - g.pos.x), dt);
}

/** He skates toward `to` at his top speed (cut while showing a save) and turns toward `want` (rad) at his squaring rate. */
function stepGoalie(g: GoalieState, a: GoalieAttrs, to: Vec2, want: number, dt: number): void {
  if (g.poseT > 0) {
    g.poseT = Math.max(0, g.poseT - dt);
    if (g.poseT === 0) g.pose = 'stance';
  }
  const dx = to.x - g.pos.x, dy = to.y - g.pos.y;
  const d = hypot2(dx, dy);
  const top = (G.speed.base + a.lateral * G.speed.perPoint) * (g.poseT > 0 ? POSE_SPEED_FACTOR : 1);
  const step = Math.min(d, top * dt);
  const k = d > 0 ? step / d : 0;
  g.vel.x = (dx * k) / dt;
  g.vel.y = (dy * k) / dt;
  g.pos.x += dx * k;
  g.pos.y += dy * k;
  const turn = wrapAngle(want - g.facing);
  const maxTurn = (G.squareRate.base + a.positioning * G.squareRate.perPoint) * dt;
  g.facing = wrapAngle(g.facing + clamp(turn, -maxTurn, maxTurn));
}

/** How far out from his goal line (m) he stands in the middle of his crease while play is stopped. */
const CREASE_MIDDLE = LINE_GAP + 0.6;

/**
 * Play stopped: he skates to the middle of his crease and faces straight up ice (phase `stopped`) or the faceoff spot
 * (phase `faceoffSetup`); he never turns to a stopped puck behind him.
 */
function settleGoalie(state: GameState, g: GoalieState, a: GoalieAttrs, end: 1 | -1, dt: number): void {
  spot.x = end * (GOAL - CREASE_MIDDLE);
  spot.y = 0;
  const f = state.faceoffSpot;
  const want = state.phase === 'faceoffSetup' ? datan2(f.y - spot.y, f.x - spot.x) : end === 1 ? Math.PI : 0;
  stepGoalie(g, a, spot, want, dt);
}

/** The end-zone faceoff dot on `end` nearest to `p`. */
function endDotNear(end: 1 | -1, p: Vec2): Vec2 {
  let best = FACEOFF_DOTS.end[0]!, bestD = Infinity;
  for (const d of FACEOFF_DOTS.end) {
    if (d.x * end <= 0) continue;
    const dd = Math.abs(d.y - p.y);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/**
 * True when the goalie of `side` (net at `end`) goes for the puck (Task 13): play live, nobody has it and no shot is on
 * its way, it is slow and on the ice in his crease, and an opponent is within G.cover.threat of it. He skates to it and
 * covers it once it is within his reach (tryCover); a goalie under pressure does not leave a loose puck in his crease.
 */
function goesFor(state: GameState, side: Side, end: 1 | -1): boolean {
  if (state.carrierId !== null || state.shotInFlight !== null) return false;
  const pk = state.puck;
  if (hypot2(pk.vel.x, pk.vel.y) >= G.cover.speed || pk.z > G.cover.maxZ) return false;
  const nx = end * GOAL;
  if ((pk.pos.x - nx) * end > 0 || hypot2(pk.pos.x - nx, pk.pos.y) > RINK.creaseRadius) return false;
  for (const s of state.skaters) if (s.onIce && s.side !== side && s.downT <= 0 && dist(s.pos, pk.pos) <= G.cover.threat) return true;
  return false;
}

/**
 * Under pressure he covers a puck he has (Task 13): a slow loose puck within his reach in front of his goal line, in his
 * crease or, with his body in it, just outside it, when an opponent is close to it: `freeze`, play stops. (The rules let
 * a goalie under pressure smother a puck at the edge of his crease; never behind his line.) Otherwise he leaves it for
 * his skaters.
 */
function tryCover(state: GameState, side: Side, g: GoalieState, end: 1 | -1, out: GameEvent[]): boolean {
  const pk = state.puck;
  if (hypot2(pk.vel.x, pk.vel.y) >= G.cover.speed || pk.z > G.cover.maxZ) return false;
  const nx = end * GOAL;
  if ((pk.pos.x - nx) * end > 0) return false;
  if (hypot2(pk.pos.x - nx, pk.pos.y) > RINK.creaseRadius && hypot2(g.pos.x - nx, g.pos.y) > RINK.creaseRadius) return false;
  if (dist(g.pos, pk.pos) > G.cover.reach) return false;
  let threat = false;
  for (const s of state.skaters) {
    if (!s.onIce || s.side === side || s.downT > 0) continue;
    if (dist(s.pos, pk.pos) <= G.cover.threat) { threat = true; break; }
  }
  if (!threat) return false;
  g.pose = 'cover';
  g.poseT = COVER_SECONDS;
  out.push(gameEvent(state, { type: 'freeze', side, playerId: g.id, otherId: null, pos: pk.pos, detail: { cause: 'cover' } }));
  stopPlay(state, endDotNear(end, pk.pos));
  return true;
}

/**
 * Both goalies: each moves along an arc between the puck and his net centre (deeper the farther the puck), at a top
 * speed from lateral, and turns square to the puck at a rate from positioning. Against a shot in flight he plays its
 * release point instead. Showing a save slows him; the pose returns to `stance` when poseT runs out. While play is live and nobody has the puck, a goalie covers a slow loose
 * puck in his reach at his crease when an opponent is near it (emits `freeze` into `out`, play stops for an end-zone faceoff).
 */
export function goalieTick(state: GameState, defs: Map<string, PlayerDef>, dt: number, out: GameEvent[] = []): void {
  for (const side of SIDES) {
    const g = state.goalies[side];
    const end = (-state.attackDir[side]) as 1 | -1;
    // Against a shot on its way he plays where it was released from, not the puck in flight.
    if (state.phase !== 'live') { settleGoalie(state, g, goalieAttrs(defs, g.id), end, dt); continue; }
    const shot = state.shotInFlight;
    // A slow loose puck in his crease with an attacker on it: he goes for it to cover it (tryCover).
    if (goesFor(state, side, end)) { const pk = state.puck.pos; stepGoalie(g, goalieAttrs(defs, g.id), pk, datan2(pk.y - g.pos.y, pk.x - g.pos.x), dt); continue; }
    const read = shot !== null && shot.side !== side ? shot.from : state.puck.pos;
    moveGoalie(g, goalieAttrs(defs, g.id), read, end, dt);
  }
  if (state.phase !== 'live' || state.carrierId !== null || state.shotInFlight !== null) return;
  for (const side of SIDES) {
    if (tryCover(state, side, state.goalies[side], (-state.attackDir[side]) as 1 | -1, out)) return;
  }
}

/**
 * Pose for a save by a goalie who catches with `catches`, of a puck crossing `dy` (m) across from his centre (in y) at
 * height `z`, in the net at `netEnd` (-1: the net at -x). A high save on his catching side is `glove`, on the other side
 * `blocker`; low, `pad` when more than PAD_OFFSET off his centre, else `butterfly`. His left is the engine's left: facing
 * out of the net at -x (toward +x), his left is +y.
 */
export function poseFor(catches: 'L' | 'R', o: { netEnd: 1 | -1; dy: number; z: number }): Exclude<GoaliePose, 'stance' | 'cover'> {
  // Facing out of the net, his left is +y when the net is at -x (end -1), and -y when it is at +x.
  const left = o.dy * -o.netEnd;
  if (o.z > HIGH_SAVE_Z) return (left >= 0) === (catches === 'L') ? 'glove' : 'blocker';
  return Math.abs(o.dy) > PAD_OFFSET ? 'pad' : 'butterfly';
}

/** Pose for a save by `g` (catching with `catches`) on a puck crossing at (y, z). */
function savePose(g: GoalieState, catches: 'L' | 'R', y: number, z: number, end: 1 | -1): Exclude<GoaliePose, 'stance' | 'cover'> {
  return poseFor(catches, { netEnd: end, dy: y - g.pos.y, z });
}

/**
 * Who is credited with a puck that went in with no shot of `side` in flight and no `side` touch chain (put in by the
 * defenders): the last `side` skater to touch it since the stoppage, else `side`'s on-ice skater nearest the puck.
 */
function creditFor(state: GameState, side: Side): string {
  const last = state.lastAttackTouch[side];
  if (last !== null) return last;
  let best: string | null = null, bestD = Infinity;
  for (const s of state.skaters) {
    if (!s.onIce || s.side !== side) continue;
    const d = dist(s.pos, state.puck.pos);
    if (d < bestD) { bestD = d; best = s.id; }
  }
  if (best === null) throw new Error(`no ${side} skater on the ice to credit`);
  return best;
}

/** The skaters of each side on the ice now (a player skating off for a change is on the ice until he reaches the door). */
function onIceIds(state: GameState): { home: string[]; away: string[] } {
  const ids = { home: [] as string[], away: [] as string[] };
  for (const s of state.skaters) if (s.onIce) ids[s.side].push(s.id);
  return ids;
}

/** A goalie's height (m) on a puck now at height `z` rising at `vz` after `t` s (under gravity, on the ice once it lands). */
function heightAfter(z: number, vz: number, t: number): number {
  if (z === 0 && vz === 0) return 0;
  const h = z + vz * t - 0.5 * GRAVITY * t * t;
  return h > 0 ? h : 0;
}

/** A goalie of `side` showing a save pose: how much of it is left, 0 to 1. */
function recoveringOf(g: GoalieState): number {
  return g.pose === 'stance' || g.pose === 'cover' ? 0 : clamp(g.poseT / POSE_SECONDS, 0, 1);
}

/**
 * Whether an attacker of `att` (other than `shooterId` and the man who tipped it, `tippedBy`: Task 8 review, Minor 2) screens a shot meeting the goalie at (cx, cy) along (ux, uy)
 * (its unit direction): within SCREEN_OFF (0.6 m) of its line, between SCREEN_NEAR (0.8 m) and SCREEN_FAR (4 m) in front
 * of the goalie.
 */
function screenedOnLine(state: GameState, att: Side, shooterId: string, tippedBy: string | null, cx: number, cy: number, ux: number, uy: number): boolean {
  for (const s of state.skaters) {
    if (!s.onIce || s.side !== att || s.downT > 0 || s.id === shooterId || s.id === tippedBy) continue;
    const dx = s.pos.x - cx, dy = s.pos.y - cy;
    const along = -(dx * ux + dy * uy);
    if (along < SCREEN_NEAR || along > SCREEN_FAR) continue;
    if (Math.abs(dx * uy - dy * ux) < SCREEN_OFF) return true;
  }
  return false;
}

/**
 * Saves are made where the goalie is, not on the goal line. While a shot is in flight toward the net he defends and its path this
 * tick crosses his plane (x = his x) on its way to a spot inside the posts (clear of them) and under the bar: the puck is moved to
 * that crossing, `shot` is emitted, and saveChance decides (his squaring and the line's offset from his centre, the shot's speed,
 * the time he had to see it from its release or its tip, a screen, a tip, his movement, the height, his night, and how far he
 * still is in his last save's pose). A save emits `save` and hands the puck to saveOutcome (rebounds.ts) from that point; the
 * puck does not move on this tick. A goal sets shot.faced and lets the puck go on; `goal` is emitted when it crosses the goal
 * line (resolveOnNet, 1 to 3 ticks later, with no second `shot`). Returns true when it faced the shot this tick. A puck that
 * reaches the goal line without having been faced (not a shot, or released from inside his plane) is resolved by resolveOnNet
 * as before.
 */
export function faceShot(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[]): boolean {
  const shot = state.shotInFlight;
  if (shot === null || shot.faced || shot.beat === true || state.carrierId !== null) return false;
  const pk = state.puck;
  const end = state.attackDir[shot.side];
  const vx = pk.vel.x, vy = pk.vel.y;
  if (vx * end <= 0) return false;
  const defSide = other(shot.side);
  const g = state.goalies[defSide];
  const gx = g.pos.x;
  const x0 = pk.pos.x, y0 = pk.pos.y;
  if ((x0 - gx) * end >= 0 || (x0 + vx * DT - gx) * end < 0) return false;
  // Where it reaches the goal line: inside the posts, clear of them, and under the bar, or he does not face it.
  const nx = end * GOAL;
  const tl = (nx - x0) / vx;
  const ly = y0 + vy * tl;
  const lz = heightAfter(pk.z, pk.vz, tl);
  if (Math.abs(ly) >= RINK.netHalfWidth || lz >= RINK.netHeight) return false;
  // Within a post's (or the bar's) reach it may ring off it if he does not stop it: then only his save is decided here.
  // (At a sharp angle the path can meet a post before the line even when it crosses the line inside it.)
  let near = Math.abs(ly) >= RINK.netHalfWidth - POST_CLEAR || lz >= RINK.netHeight - BAR_CLEAR;
  const t = (gx - x0) / vx;
  const cy = y0 + vy * t, cz = heightAfter(pk.z, pk.vz, t);
  // A crossing of his plane beyond his reach (a sharp-angle shot passing wide of him) is not met here: it is played at the
  // goal line (resolveOnNet), where it is a goal unless its line passes within his reach (Task 8 review, Minor 1).
  if (Math.abs(cy - g.pos.y) > SAVE_REACH) return false;
  for (const py of POSTS) if (segDistXY(nx, py, gx, cy, nx, ly) < POST_CLEAR) near = true;
  const cross: Crossing = { side: (cy - g.pos.y) * -end, height: cz };
  const v = hypot2(vx, vy);
  const speed = hypot3(vx, vy, pk.z === 0 && pk.vz === 0 ? 0 : pk.vz - GRAVITY * t);
  const screened = state.screenedUntilTick[defSide] > state.tick || screenedOnLine(state, shot.side, shot.shooterId, shot.tippedBy, gx, cy, vx / v, vy / v);
  const f = shot.from;
  const squareErr = Math.abs(wrapAngle(datan2(f.y - g.pos.y, f.x - g.pos.x) - g.facing));
  const ga = goalieAttrs(defs, g.id);
  const tipped = shot.tippedBy !== null;
  const p = saveChance({
    goalie: ga, lateralMiss: Math.abs(cy - g.pos.y) * Math.abs(vx) / v + squareErr * G.squareMissPerRad, shotSpeed: speed,
    distance: hypot2(nx - f.x, ly - f.y), screened, goalieMovingSpeed: hypot2(g.vel.x, g.vel.y), height: cz,
    night: state.goalieNight[defSide], tipped, recovering: recoveringOf(g),
    quickRelease: quickOf(defs, shot), gloveHand: gloveSide(defs.get(g.id), g, cy, cz, end),
  });
  const shooterId = shot.tippedBy ?? shot.shooterId;
  const at = { x: gx, y: cy };
  const saved = rng.chance(p);
  if (!saved && near) {
    // It beats him on its way to the post: in, it is a shot and a goal at the line; off the post, a `post`.
    shot.beat = true;
    shot.screened = screened;
    return true;
  }
  out.push(gameEvent(state, {
    type: 'shot', side: shot.side, playerId: shooterId, otherId: g.id, pos: at,
    detail: { distance: shot.fromDist, releaseTick: shot.tick, speed, cross, shotType: shot.shotType, tippedFrom: tipped ? shot.shooterId : null, screened, rebound: shot.rebound },
  }));
  shot.screened = screened;
  if (!saved) {
    // It beats him: on into the net (resolveOnNet scores it when it crosses the line).
    shot.faced = true;
    shot.cross = cross;
    return true;
  }
  const pose = savePose(g, defs.get(g.id)?.catches ?? 'L', cy, cz, end);
  g.pose = pose;
  g.poseT = POSE_SECONDS;
  pk.pos.x = gx;
  pk.pos.y = cy;
  state.shotInFlight = null;
  const save = gameEvent(state, { type: 'save', side: defSide, playerId: g.id, otherId: shooterId, pos: at, detail: { pose, kind: 'rebound', cross } });
  out.push(save);
  save.detail.kind = saveOutcome(state, defSide, withBadges(defs, g.id, { pose, speed, screened, tipped, reboundControl: ga.reboundControl }), cross, rng, out);
  return true;
}

/**
 * The goal of a shot that beat the goalie (shot.faced) or of a puck that crossed the line, for `attSide`: `goal` for
 * `shooterId` with up to two previous distinct teammates in the touch chain as assists (only touches within
 * TUNING.scoring.assistWindowSeconds count) and the skaters on the ice (`onIce`); the score goes up and play stops for a
 * centre-ice faceoff.
 */
function scoreGoal(state: GameState, attSide: Side, shooterId: string, detail: EventDetails['goal'], out: GameEvent[]): void {
  const g = state.goalies[other(attSide)];
  const t = state.touches;
  const assists: string[] = [];
  if (t.side === attSide) {
    const since = state.tick - Math.round(TUNING.scoring.assistWindowSeconds / DT);
    for (let i = t.ids.length - 1; i >= 0 && assists.length < 2; i--) {
      const id = t.ids[i]!;
      if (t.ticks[i]! < since) break; // older touches are too long ago to have set up the goal
      if (id !== shooterId && !assists.includes(id)) assists.push(id);
    }
  }
  state.score[attSide]++;
  out.push(gameEvent(state, { type: 'goal', side: attSide, playerId: shooterId, otherId: g.id, assistIds: assists, pos: state.puck.pos, detail, onIce: onIceIds(state) }));
  stopPlay(state, FACEOFF_DOTS.centre);
}

/** The `goal` detail of a shot that beat the goalie at `cross`. */
function shotGoalDetail(shot: ShotInFlight, cross: Crossing): EventDetails['goal'] {
  return { distance: shot.fromDist, releaseTick: shot.tick, cross, shotType: shot.shotType, tippedFrom: shot.tippedBy !== null ? shot.shooterId : null, screened: shot.screened, rebound: shot.rebound };
}

/**
 * A shot that has beaten the goalie (shot.faced) when the horn ends the period before it crosses the line: it is a goal
 * (it is past him and on its way in). At a referee's whistle it is not (whistleFacedShot).
 */
export function scoreFacedShot(state: GameState, out: GameEvent[]): void {
  const shot = state.shotInFlight;
  if (shot === null || !shot.faced) return;
  state.shotInFlight = null;
  scoreGoal(state, shot.side, shot.tippedBy ?? shot.shooterId, shotGoalDetail(shot, shot.cross ?? { side: 0, height: 0 }), out);
}

/**
 * A shot that has beaten the goalie (shot.faced) when a referee's whistle (offside, icing) stops play before it crosses
 * the line: the whistle kills the play, so it is no goal (Task 8 review, Minor 4). Its `shot` is already in the record,
 * and every shot on goal has one save or goal: it ends as a `save` of kind 'held' (play is dead with the puck not in);
 * the score and the call's faceoff spot stand. (No whistle can come in the 1 to 3 ticks a faced shot flies as the rules
 * are today: an offside call needs a carrier, an icing a puck over the goal line outside the net.)
 */
export function whistleFacedShot(state: GameState, defs: Map<string, PlayerDef> | undefined, out: GameEvent[]): void {
  const shot = state.shotInFlight;
  if (shot === null || !shot.faced) return;
  state.shotInFlight = null;
  const defSide = other(shot.side);
  const g = state.goalies[defSide];
  const end = (-state.attackDir[defSide]) as 1 | -1;
  const cross = shot.cross ?? { side: 0, height: 0 };
  const pose = poseFor(defs?.get(g.id)?.catches ?? 'L', { netEnd: end, dy: cross.side * -end, z: cross.height });
  out.push(gameEvent(state, { type: 'save', side: defSide, playerId: g.id, otherId: shot.tippedBy ?? shot.shooterId, pos: state.puck.pos, detail: { pose, kind: 'held', cross } }));
}

/**
 * The puck reached the goal line between the posts under the bar (stepPuck stopped it there).
 * - A shot that beat the goalie at his plane (shot.faced): `goal` (its `shot` came when it met him).
 * - Otherwise (a shot released inside his plane, or a puck that was not shot) he plays it on the line: saveChance from where
 *   he is against its line, how square he is, its speed and distance, a screen, his movement and the height. A shot emits
 *   `shot`, then `save` (and saveOutcome: held, steered or a rebound, from the line) or `goal`. A puck that was not shot is
 *   no shot on goal: he covers it (`freeze`, cause 'cover') or it is a goal with releaseTick null.
 * Events go into `out`.
 */
export function resolveOnNet(
  state: GameState, ev: Extract<PuckEvent, { kind: 'onNet' }>, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = [],
): 'goal' | 'save' {
  const end = ev.end;
  const defSide = defenderOf(state, end);
  const attSide = other(defSide);
  const g = state.goalies[defSide];
  const shot = state.shotInFlight !== null && state.shotInFlight.side === attSide ? state.shotInFlight : null;
  state.shotInFlight = null;
  const cross: Crossing = { side: (ev.y - g.pos.y) * -end, height: ev.z };
  if (shot !== null && shot.faced) {
    scoreGoal(state, attSide, shot.tippedBy ?? shot.shooterId, shotGoalDetail(shot, shot.cross ?? cross), out);
    return 'goal';
  }
  if (shot !== null && shot.beat === true) {
    // It beat him at his plane by the post and went in: its `shot` and `goal` now, at the line.
    const sid = shot.tippedBy ?? shot.shooterId;
    out.push(gameEvent(state, {
      type: 'shot', side: attSide, playerId: sid, otherId: g.id, pos: state.puck.pos,
      detail: { distance: shot.fromDist, releaseTick: shot.tick, speed: ev.speed, cross, shotType: shot.shotType, tippedFrom: shot.tippedBy !== null ? shot.shooterId : null, screened: shot.screened, rebound: shot.rebound },
    }));
    scoreGoal(state, attSide, sid, shotGoalDetail(shot, cross), out);
    return 'goal';
  }
  const ga = goalieAttrs(defs, g.id);
  const t = state.touches;
  const shooterId = shot ? shot.tippedBy ?? shot.shooterId : t.side === attSide ? t.ids[t.ids.length - 1] ?? creditFor(state, attSide) : creditFor(state, attSide);
  const netX = end * GOAL;
  // A puck that was not shot came along its own line (its velocity at the line), else straight in from 3 m out.
  const sv = shot ? 0 : hypot2(ev.vx ?? 0, ev.vy ?? 0);
  const fx = shot ? shot.from.x : sv > 0 ? netX - (ev.vx! / sv) * 3 : netX - end * 3, fy = shot ? shot.from.y : sv > 0 ? ev.y - (ev.vy! / sv) * 3 : ev.y;
  const distance = hypot2(netX - fx, ev.y - fy);
  // A puck that was not shot (a pass or a loose puck sliding in) has been on its way since it was last let go: he has
  // had that long to see it coming.
  const rel = state.lastRelease;
  const reactDistance = shot || rel === null ? distance : Math.max(distance, (state.tick - rel.tick) * DT * ev.speed);

  // How far the shot's line passes from his centre, plus how far he is from square to where it came from.
  const lx = netX - fx, ly = ev.y - fy;
  const ll = hypot2(lx, ly) || 1;
  const offLine = Math.abs((g.pos.x - fx) * ly - (g.pos.y - fy) * lx) / ll;
  const squareErr = Math.abs(wrapAngle(datan2(fy - g.pos.y, fx - g.pos.x) - g.facing));
  // (Task 8 review, Minor 5: a shot played on the line is screened as one met at his plane is: by an attacker on its line.)
  const screened = state.screenedUntilTick[defSide] > state.tick
    || (shot !== null && screenedOnLine(state, attSide, shot.shooterId, shot.tippedBy, netX, ev.y, lx / ll, ly / ll));
  const tipped = shot !== null && shot.tippedBy !== null;
  // A shot whose line passes beyond his reach cannot be saved (Task 8 review, Minor 1): a save needs his body, glove or pad there.
  // A puck that was not shot is played with stick or pad by its speed and how square he is to it (slideStopChance), not as
  // a shot (Task 8b review, Important 2); beyond his reach neither can be stopped.
  const p = offLine > SAVE_REACH ? 0 : !shot ? slideStopChance(ev.speed, offLine + squareErr * G.squareMissPerRad) : saveChance({
    goalie: ga, lateralMiss: offLine + squareErr * G.squareMissPerRad, shotSpeed: ev.speed, distance: reactDistance,
    screened, goalieMovingSpeed: hypot2(g.vel.x, g.vel.y), height: ev.z,
    night: state.goalieNight[defSide], tipped, recovering: recoveringOf(g),
    quickRelease: quickOf(defs, shot), gloveHand: gloveSide(defs.get(g.id), g, ev.y, ev.z, end),
  });
  // Only a shot is a shot on goal (Task 7 review).
  if (shot) {
    out.push(gameEvent(state, {
      type: 'shot', side: attSide, playerId: shooterId, otherId: g.id, pos: state.puck.pos,
      detail: { distance: shot.fromDist, releaseTick: shot.tick, speed: ev.speed, cross, shotType: shot.shotType, tippedFrom: tipped ? shot.shooterId : null, screened, rebound: shot.rebound },
    }));
    shot.screened = screened;
  }

  if (p > 0 && rng.chance(p)) {
    const pose = savePose(g, defs.get(g.id)?.catches ?? 'L', ev.y, ev.z, end);
    if (!shot) {
      // A puck that was not shot: he covers it, steers it away or leaves it loose, as his pose and its speed have it
      // (Task 8 review, Minor 5: every one he stopped was a whistle). No `save`: it was no shot on goal; a `stop` says
      // what he did (Task 8b review, Important 2).
      g.pose = pose;
      g.poseT = POSE_SECONDS;
      const stop = gameEvent(state, { type: 'stop', side: defSide, playerId: g.id, otherId: rel !== null ? rel.id : shooterId, pos: state.puck.pos, detail: { pose, kind: 'rebound', speed: ev.speed } });
      out.push(stop);
      stop.detail.kind = saveOutcome(state, defSide, withBadges(defs, g.id, { pose, speed: ev.speed, screened, tipped: false, reboundControl: ga.reboundControl }), cross, rng, out, 'cover');
      return 'save';
    }
    g.pose = pose;
    g.poseT = POSE_SECONDS;
    const save = gameEvent(state, { type: 'save', side: defSide, playerId: g.id, otherId: shooterId, pos: state.puck.pos, detail: { pose, kind: 'rebound', cross } });
    out.push(save);
    save.detail.kind = saveOutcome(state, defSide, withBadges(defs, g.id, { pose, speed: ev.speed, screened, tipped, reboundControl: ga.reboundControl }), cross, rng, out);
    return 'save';
  }

  scoreGoal(state, attSide, shooterId, shot ? shotGoalDetail(shot, cross)
    : { distance, releaseTick: null, cross, shotType: null, tippedFrom: null, screened: false, rebound: false }, out);
  return 'goal';
}

/**
 * A shot past the goalie (shot.faced) that turned back or stopped short of the line (a fallback the geometry in faceShot
 * should leave unused): he got a piece of it after all. `save` (its `shot` was emitted when it met him), the puck loose
 * where it is (kind 'rebound').
 */
export function lateSave(state: GameState, defs: Map<string, PlayerDef> | undefined, out: GameEvent[], rng?: Rng): void {
  const shot = state.shotInFlight;
  if (shot === null || !shot.faced) return;
  state.shotInFlight = null;
  const defSide = other(shot.side);
  const g = state.goalies[defSide];
  const end = (-state.attackDir[defSide]) as 1 | -1;
  const cross = shot.cross ?? { side: 0, height: 0 };
  const pose = poseFor(defs?.get(g.id)?.catches ?? 'L', { netEnd: end, dy: cross.side * -end, z: cross.height });
  // Task 8 review, Minor 9: it ends as any save does (held, steered or a rebound, from where the puck is), so it cannot
  // slide on over the line as a goal with no shot after its save. (Someone already has it, or the caller has no random
  // stream: a rebound where it is, stopped.)
  const pk = state.puck;
  const save = gameEvent(state, { type: 'save', side: defSide, playerId: g.id, otherId: shot.tippedBy ?? shot.shooterId, pos: pk.pos, detail: { pose, kind: 'rebound', cross } });
  out.push(save);
  if (state.carrierId !== null || rng === undefined) {
    state.lastSave = { side: defSide, tick: state.tick, kind: 'rebound' };
    if (state.carrierId === null) { pk.vel.x = 0; pk.vel.y = 0; pk.vz = 0; }
    return;
  }
  g.pose = pose;
  g.poseT = POSE_SECONDS;
  save.detail.kind = saveOutcome(state, defSide, withBadges(defs, g.id, { pose, speed: hypot2(pk.vel.x, pk.vel.y), screened: shot.screened, tipped: shot.tippedBy !== null, reboundControl: defs ? goalieAttrs(defs, g.id).reboundControl : 70 }), cross, rng, out);
}
