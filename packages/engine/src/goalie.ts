import { recordTouch } from './actions';
import type { GoalieAttrs } from './attributes';
import { DT } from './constants';
import { stopPlay } from './faceoff';
import type { PuckEvent } from './puck';
import { FACEOFF_DOTS, RINK, resolveBoards } from './rink';
import type { Rng } from './rng';
import type { GameEvent, GameState, GoaliePose, GoalieState, PlayerDef, Side, SkaterState } from './types';
import { dist, hypot2, segDistXY, type Vec2 } from './vec';

const GOAL = RINK.goalLineX;
const SIDES = ['home', 'away'] as const;

/** Top speed along his arc (m/s): base plus per point of lateral. Cut to POSE_SPEED_FACTOR while showing a save. */
const GOALIE_SPEED = { base: 1.5, perPoint: 0.035 };
const POSE_SPEED_FACTOR = 0.4;
/** How fast he turns square to the puck (rad/s): base plus per point of positioning. */
const SQUARE_RATE = { base: 2, perPoint: 0.06 };
/** Depth out from the goal line (m): DEPTH.min with the puck DEPTH.near m away or closer, growing DEPTH.perMetre per metre, at most DEPTH.max. */
const DEPTH = { min: 0.4, max: 1.3, near: 2, perMetre: 0.06 };
/** He never stands closer than this to the goal line (m), nor wider than POST_Y from the middle (m). */
const LINE_GAP = 0.3;
const POST_Y = 0.75;
/** He covers a loose puck slower than COVER.speed (m/s), within COVER.reach (m) of him and in his crease, when an opponent is within COVER.threat (m) of it. */
const COVER = { speed: 3, reach: 1.0, threat: 2.5, maxZ: 0.3 };
/** How long a save pose and a cover are shown (s). */
const POSE_SECONDS = 0.6;
const COVER_SECONDS = 1.2;

/**
 * Save chance, as a logistic: SAVE.base, plus SAVE.perReactionSecond per second the puck takes to arrive (at most
 * 1 s counted), plus SAVE.perPoint per point of goalie skill over 70, less the penalties below. Clamped to [0.03, 0.97].
 */
const SAVE = {
  base: 0.4,
  perReactionSecond: 5,
  perPoint: 0.04,
  screened: 0.6,
  /** Per m/s he is still moving when the puck arrives. */
  perMovingSpeed: 0.25,
  /** Per metre the shot passes wide of his centre beyond his body's reach, and again (steeper) beyond his stretch. */
  body: 0.45, perBodyMetre: 2,
  stretch: 1, perStretchMetre: 4,
  /** Per metre the shot arrives above `highFrom` (just under the bar is hardest). */
  highFrom: 0.9, perHighMetre: 1.5,
};
/** Goalie skill for the save: weights of his attributes. */
const SAVE_SKILL: Partial<Record<keyof GoalieAttrs, number>> = { reflexes: 0.35, positioning: 0.25, glove: 0.1, blocker: 0.1, lateral: 0.1, poise: 0.1 };
/** How much of his facing error (rad) counts as extra lateral miss (m). */
const SQUARE_MISS_PER_RAD = 0.4;
/** A save is held (frozen) with chance base + perPoint * reboundControl, by pose, clamped to [0.03, 0.97]. */
const FREEZE: Record<Exclude<GoaliePose, 'stance' | 'cover'>, { base: number; perPoint: number }> = {
  glove: { base: 0.45, perPoint: 0.004 },
  blocker: { base: 0.05, perPoint: 0.002 },
  pad: { base: 0.15, perPoint: 0.003 },
  butterfly: { base: 0.25, perPoint: 0.004 },
};
/** Rebound speed as a share of the shot's: base less perPoint * reboundControl, within [min, max], times the pose's factor. */
const REBOUND_SPEED = { base: 0.3, perPoint: 0.0018, min: 0.08, max: 0.4 };
const REBOUND_POSE_SPEED: Record<Exclude<GoaliePose, 'stance' | 'cover'>, number> = { glove: 0.4, blocker: 1, pad: 1, butterfly: 0.7 };
/** Rebound direction: angular spread (rad, one sd) of base + perPoint * (100 - reboundControl); blocker saves turn RB_BLOCKER_TURN rad to his right, pad saves RB_PAD_TURN rad wide. */
const REBOUND_SPREAD = { base: 0.2, perPoint: 0.008 };
const RB_BLOCKER_TURN = 0.7;
const RB_PAD_TURN = 0.4;
/** Rebounds go out at most this far (rad) off straight out from the net, and start this far (m) in front of the goalie. */
const RB_MAX_ANGLE = 1.35;
const RB_START = 0.45;
/** A save above this height (m) is a glove or blocker save; below it, a pad save when this far (m) off his centre, else butterfly. */
const HIGH_SAVE_Z = 0.5;
const PAD_OFFSET = 0.35;

/** Blocks: a shot below BLOCK.maxZ (m) can be blocked by a defender within BLOCK.path (m) of its path, more than BLOCK.clearOfShooter (m) from the shooter. */
const BLOCK = { maxZ: 1.1, path: 0.5, clearOfShooter: 1.5, base: 0.12, perPoint: 0.004 };
/** A blocked puck keeps this share of its speed, turned back by up to this spread (rad, one sd). */
const BLOCK_SPEED: [number, number] = [0.1, 0.3];
const BLOCK_SPREAD = 1.2;

/** A shot that slows below this (m/s), or is still going after this long (s), has missed. */
const MISS_SPEED = 3;
const SHOT_MAX_SECONDS = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
/** Wrap an angle to (-pi, pi]. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function goalieAttrs(defs: Map<string, PlayerDef>, id: string): GoalieAttrs {
  const a = defs.get(id)?.goalie;
  if (!a) throw new Error(`no goalie attributes for ${id}`);
  return a;
}

const event = (state: GameState, e: Omit<GameEvent, 'tick' | 'period' | 'clock'>): GameEvent =>
  ({ tick: state.tick, period: state.period, clock: state.clock, ...e });

/** The side whose net is at `end` (+1 or -1 along x). */
const defenderOf = (state: GameState, end: 1 | -1): Side => (state.attackDir.home === end ? 'away' : 'home');

function skaterById(state: GameState, id: string): SkaterState | null {
  for (const s of state.skaters) if (s.id === id) return s;
  return null;
}

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
};

/** Chance that the goalie stops a shot on net. Parity: clamped to [0.03, 0.97]. */
export function saveChance(input: SaveInput): number {
  const a = input.goalie;
  let skill = 0, w = 0;
  for (const [k, wt] of Object.entries(SAVE_SKILL) as [keyof GoalieAttrs, number][]) { skill += a[k] * wt; w += wt; }
  skill /= w;
  const reaction = Math.min(1, input.distance / Math.max(1, input.shotSpeed));
  const lm = input.lateralMiss;
  const logit = SAVE.base + SAVE.perReactionSecond * reaction + SAVE.perPoint * (skill - 70)
    - (input.screened ? SAVE.screened : 0)
    - SAVE.perMovingSpeed * input.goalieMovingSpeed
    - SAVE.perBodyMetre * Math.max(0, lm - SAVE.body)
    - SAVE.perStretchMetre * Math.max(0, lm - SAVE.stretch)
    - SAVE.perHighMetre * Math.max(0, input.height - SAVE.highFrom);
  return clamp(logistic(logit), 0.03, 0.97);
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
  const depth = clamp(DEPTH.min + (d - DEPTH.near) * DEPTH.perMetre, DEPTH.min, DEPTH.max);
  out.x = nx + (dx / d) * depth;
  out.y = clamp((dy / d) * depth, -POST_Y, POST_Y);
  if ((out.x - nx) * end > -LINE_GAP) out.x = nx - end * LINE_GAP;
  return out;
}

const spot: Vec2 = { x: 0, y: 0 };

function moveGoalie(g: GoalieState, a: GoalieAttrs, p: Vec2, end: 1 | -1, dt: number): void {
  if (g.poseT > 0) {
    g.poseT = Math.max(0, g.poseT - dt);
    if (g.poseT === 0) g.pose = 'stance';
  }
  goalieSpot(p, end, spot);
  const dx = spot.x - g.pos.x, dy = spot.y - g.pos.y;
  const d = hypot2(dx, dy);
  const top = (GOALIE_SPEED.base + a.lateral * GOALIE_SPEED.perPoint) * (g.poseT > 0 ? POSE_SPEED_FACTOR : 1);
  const step = Math.min(d, top * dt);
  const k = d > 0 ? step / d : 0;
  g.vel.x = (dx * k) / dt;
  g.vel.y = (dy * k) / dt;
  g.pos.x += dx * k;
  g.pos.y += dy * k;
  const want = Math.atan2(p.y - g.pos.y, p.x - g.pos.x);
  const turn = wrap(want - g.facing);
  const maxTurn = (SQUARE_RATE.base + a.positioning * SQUARE_RATE.perPoint) * dt;
  g.facing = wrap(g.facing + clamp(turn, -maxTurn, maxTurn));
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

/** He covers a slow loose puck in his crease when an opponent is close to it: `freeze`, play stops. Otherwise he leaves it for his skaters. */
function tryCover(state: GameState, side: Side, g: GoalieState, end: 1 | -1, out: GameEvent[]): boolean {
  const pk = state.puck;
  if (hypot2(pk.vel.x, pk.vel.y) >= COVER.speed || pk.z > COVER.maxZ) return false;
  const nx = end * GOAL;
  if ((pk.pos.x - nx) * end > 0 || hypot2(pk.pos.x - nx, pk.pos.y) > RINK.creaseRadius) return false;
  if (dist(g.pos, pk.pos) > COVER.reach) return false;
  let threat = false;
  for (const s of state.skaters) {
    if (!s.onIce || s.side === side || s.downT > 0) continue;
    if (dist(s.pos, pk.pos) <= COVER.threat) { threat = true; break; }
  }
  if (!threat) return false;
  g.pose = 'cover';
  g.poseT = COVER_SECONDS;
  out.push(event(state, { type: 'freeze', side, playerId: g.id, otherId: null, assistIds: [], detail: 'cover' }));
  stopPlay(state, endDotNear(end, pk.pos));
  return true;
}

/**
 * Both goalies: each moves along an arc between the puck and his net centre (deeper the farther the puck), at a top
 * speed from lateral, and turns square to the puck at a rate from positioning. Against a shot in flight he plays its
 * release point instead. Showing a save slows him; the pose returns to `stance` when poseT runs out. While play is live and nobody has the puck, a goalie covers a slow loose
 * puck in his crease when an opponent is near it (emits `freeze` into `out`, play stops for an end-zone faceoff).
 */
export function goalieTick(state: GameState, defs: Map<string, PlayerDef>, _rng: Rng, dt: number, out: GameEvent[] = []): void {
  for (const side of SIDES) {
    const g = state.goalies[side];
    const end = (-state.attackDir[side]) as 1 | -1;
    // Against a shot on its way he plays where it was released from, not the puck in flight.
    const shot = state.shotInFlight;
    const read = shot !== null && shot.side !== side ? shot.from : state.puck.pos;
    moveGoalie(g, goalieAttrs(defs, g.id), read, end, dt);
  }
  if (state.phase !== 'live' || state.carrierId !== null || state.shotInFlight !== null) return;
  for (const side of SIDES) {
    if (tryCover(state, side, state.goalies[side], (-state.attackDir[side]) as 1 | -1, out)) return;
  }
}

/**
 * While a shot is in flight below 1.1 m: each defending skater within 0.5 m of the puck's path this tick, and more
 * than 1.5 m from the shooter, gets one chance per shot to block it, `clamp(0.12 + shotBlocking * 0.004, 0.03, 0.97)`.
 * A block emits `block` into `out`, ends the shot and leaves the puck loose, slowed and turned back.
 */
export function tryBlock(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): boolean {
  const shot = state.shotInFlight;
  const pk = state.puck;
  if (shot === null || pk.z >= BLOCK.maxZ) return false;
  const shooter = skaterById(state, shot.shooterId);
  const ax = pk.pos.x, ay = pk.pos.y, bx = ax + pk.vel.x * DT, by = ay + pk.vel.y * DT;
  for (const s of state.skaters) {
    if (!s.onIce || s.side === shot.side || s.downT > 0 || shot.blockTried.includes(s.id)) continue;
    if (segDistXY(s.pos.x, s.pos.y, ax, ay, bx, by) > BLOCK.path) continue;
    if (shooter && dist(s.pos, shooter.pos) <= BLOCK.clearOfShooter) continue;
    shot.blockTried.push(s.id);
    if (!rng.chance(clamp(BLOCK.base + defs.get(s.id)!.attrs.shotBlocking * BLOCK.perPoint, 0.03, 0.97))) continue;
    const speed = hypot2(pk.vel.x, pk.vel.y) * rng.range(BLOCK_SPEED[0], BLOCK_SPEED[1]);
    const angle = Math.atan2(pk.vel.y, pk.vel.x) + Math.PI + rng.gauss() * BLOCK_SPREAD;
    pk.vel.x = Math.cos(angle) * speed;
    pk.vel.y = Math.sin(angle) * speed;
    pk.z = 0;
    pk.vz = 0;
    state.shotInFlight = null;
    state.lastTouch = { id: s.id, side: s.side };
    recordTouch(state, s.id, s.side);
    out.push(event(state, { type: 'block', side: s.side, playerId: s.id, otherId: shot.shooterId, assistIds: [], detail: `${shot.fromDist.toFixed(1)}m` }));
    return true;
  }
  return false;
}

/**
 * Ends a shot in flight that did not reach the net this tick: `post` when it hit a post of the attacked net, `miss`
 * when it went wide or over, hit the boards, turned away from the net, slowed below 3 m/s, was picked up, or is still
 * going after 3 s. Call after the puck step and pickup (an `onNet` goes to resolveOnNet instead).
 */
export function trackShot(state: GameState, puckEvents: PuckEvent[], out: GameEvent[] = []): void {
  const shot = state.shotInFlight;
  if (shot === null) return;
  const end = state.attackDir[shot.side];
  const pk = state.puck;
  let post = false, gone = false;
  for (const ev of puckEvents) {
    if (ev.kind === 'post' && ev.end === end) post = true;
    else if (ev.kind === 'boards' || ev.kind === 'overNet') gone = true;
  }
  if (!post) {
    gone = gone || state.carrierId !== null || pk.pos.x * end > GOAL || pk.vel.x * end <= 0
      || hypot2(pk.vel.x, pk.vel.y) < MISS_SPEED || (state.tick - shot.tick) * DT > SHOT_MAX_SECONDS;
    if (!gone) return;
  }
  state.shotInFlight = null;
  out.push(event(state, {
    type: post ? 'post' : 'miss', side: shot.side, playerId: shot.shooterId, otherId: state.goalies[other(shot.side)].id,
    assistIds: [], detail: `${shot.fromDist.toFixed(1)}m`,
  }));
}

/** Pose for a save on a puck crossing at (y, z), from where it is against the goalie (his glove is on his left). */
function savePose(g: GoalieState, y: number, z: number, end: 1 | -1): Exclude<GoaliePose, 'stance' | 'cover'> {
  // Facing out of the net, his left is +y when the net is at -x (end -1), and -y when it is at +x.
  const left = (y - g.pos.y) * -end;
  if (z > HIGH_SAVE_Z) return left >= 0 ? 'glove' : 'blocker';
  return Math.abs(y - g.pos.y) > PAD_OFFSET ? 'pad' : 'butterfly';
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

/** The skaters of each side on the ice now (not those leaving). */
function onIceIds(state: GameState): { home: string[]; away: string[] } {
  const ids = { home: [] as string[], away: [] as string[] };
  for (const s of state.skaters) if (s.onIce && !s.leaving) ids[s.side].push(s.id);
  return ids;
}

/**
 * The puck reached the goal line between the posts under the bar (stepPuck stopped it there). Emits `shot` for the
 * attacking side, then decides it with saveChance from where the goalie is against the shot's line, how square he is,
 * the shot's speed and distance, a screen, his movement and the height.
 * - Save: `save` (side and playerId the goalie's), a pose from where it crossed, then he holds it (`freeze`, play
 *   stops for the end-zone dot nearest the puck) or it rebounds loose in front of him, slower and straighter the
 *   better his reboundControl.
 * - Goal: `goal` for the shooter, with up to two previous distinct teammates in the touch chain as assists and the
 *   skaters on the ice (`onIce`); the score goes up and play stops for a centre-ice faceoff.
 * Events go into `out`.
 */
export function resolveOnNet(
  state: GameState, ev: Extract<PuckEvent, { kind: 'onNet' }>, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = [],
): 'goal' | 'save' {
  const end = ev.end;
  const defSide = defenderOf(state, end);
  const attSide = other(defSide);
  const g = state.goalies[defSide];
  const ga = goalieAttrs(defs, g.id);
  const shot = state.shotInFlight !== null && state.shotInFlight.side === attSide ? state.shotInFlight : null;
  state.shotInFlight = null;
  const t = state.touches;
  const shooterId = shot ? shot.shooterId : t.side === attSide ? t.ids[t.ids.length - 1] ?? creditFor(state, attSide) : creditFor(state, attSide);
  const netX = end * GOAL;
  const fx = shot ? shot.from.x : netX - end * 3, fy = shot ? shot.from.y : ev.y;
  const distance = hypot2(netX - fx, ev.y - fy);

  // How far the shot's line passes from his centre, plus how far he is from square to where it came from.
  const lx = netX - fx, ly = ev.y - fy;
  const ll = hypot2(lx, ly) || 1;
  const offLine = Math.abs((g.pos.x - fx) * ly - (g.pos.y - fy) * lx) / ll;
  const squareErr = Math.abs(wrap(Math.atan2(fy - g.pos.y, fx - g.pos.x) - g.facing));
  const p = saveChance({
    goalie: ga, lateralMiss: offLine + squareErr * SQUARE_MISS_PER_RAD, shotSpeed: ev.speed, distance,
    screened: state.screenedUntilTick[defSide] > state.tick, goalieMovingSpeed: hypot2(g.vel.x, g.vel.y), height: ev.z,
  });
  const detail = `${distance.toFixed(1)}m`;
  out.push(event(state, { type: 'shot', side: attSide, playerId: shooterId, otherId: g.id, assistIds: [], detail }));

  if (rng.chance(p)) {
    const pose = savePose(g, ev.y, ev.z, end);
    g.pose = pose;
    g.poseT = POSE_SECONDS;
    out.push(event(state, { type: 'save', side: defSide, playerId: g.id, otherId: shooterId, assistIds: [], detail: pose }));
    const rc = ga.reboundControl;
    const pk = state.puck;
    if (rng.chance(clamp(FREEZE[pose].base + FREEZE[pose].perPoint * rc, 0.03, 0.97))) {
      g.pose = 'cover';
      g.poseT = COVER_SECONDS;
      out.push(event(state, { type: 'freeze', side: defSide, playerId: g.id, otherId: null, assistIds: [], detail: 'save' }));
      stopPlay(state, endDotNear(end, pk.pos));
      return 'save';
    }
    // Rebound: off the reflected line of the shot, turned by the pose and spread by poor rebound control.
    const out0 = end === 1 ? Math.PI : 0;
    let rel = wrap(Math.atan2(ly / ll, (-lx / ll)) - out0);
    if (pose === 'blocker') rel -= RB_BLOCKER_TURN;
    else if (pose === 'pad') rel += (ev.y - g.pos.y) * -end >= 0 ? RB_PAD_TURN : -RB_PAD_TURN;
    rel = clamp(rel + rng.gauss() * (REBOUND_SPREAD.base + REBOUND_SPREAD.perPoint * (100 - rc)), -RB_MAX_ANGLE, RB_MAX_ANGLE);
    const angle = out0 + rel;
    const speed = ev.speed * clamp(REBOUND_SPEED.base - REBOUND_SPEED.perPoint * rc, REBOUND_SPEED.min, REBOUND_SPEED.max) * REBOUND_POSE_SPEED[pose];
    pk.pos.x = g.pos.x + Math.cos(angle) * RB_START;
    pk.pos.y = g.pos.y + Math.sin(angle) * RB_START;
    if (pk.pos.x * end > GOAL - 0.1) pk.pos.x = end * (GOAL - 0.1);
    pk.vel.x = Math.cos(angle) * speed;
    pk.vel.y = Math.sin(angle) * speed;
    pk.z = 0;
    pk.vz = 0;
    resolveBoards(pk.pos, pk.vel, 0.05, 0);
    state.carrierId = null;
    state.lastTouch = { id: g.id, side: defSide };
    state.icingWatch = null; // the goalie played it
    return 'save';
  }

  // Goal.
  const assists: string[] = [];
  if (t.side === attSide) {
    for (let i = t.ids.length - 1; i >= 0 && assists.length < 2; i--) {
      const id = t.ids[i]!;
      if (id !== shooterId && !assists.includes(id)) assists.push(id);
    }
  }
  state.score[attSide]++;
  out.push(event(state, { type: 'goal', side: attSide, playerId: shooterId, otherId: g.id, assistIds: assists, detail, onIce: onIceIds(state) }));
  stopPlay(state, FACEOFF_DOTS.centre);
  return 'goal';
}
