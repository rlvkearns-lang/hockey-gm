import type { GoalieAttrs } from './attributes';
import { DT as DT_ } from './constants';
import { gameEvent as gameEvent_ } from './events';
import { stopPlay as stopPlay_ } from './faceoff';
import type { PuckEvent } from './puck';
import { FACEOFF_DOTS as FACEOFF_DOTS_, RINK as RINK_, resolveBoards as resolveBoards_ } from './rink';
import type { Rng } from './rng';
import { wrapAngle as wrapAngle_ } from './skating';
import { TUNING as TUNING_ } from './tuning';
import type { GameEvent, GameState, GoaliePose, GoalieState, PlayerDef, Side } from './types';
import { dist as dist_, hypot2 as hypot2_, type Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dexp as dexp_, dsin as dsin_, dtanh as dtanh_ } from './dmath';
import { clamp as clamp_, findSkater as findSkater_, other as other_, PUCK_RADIUS as PUCK_RADIUS_, SIDES as SIDES_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const DT = DT_;
const gameEvent = gameEvent_;
const stopPlay = stopPlay_;
const FACEOFF_DOTS = FACEOFF_DOTS_;
const RINK = RINK_;
const resolveBoards = resolveBoards_;
const wrapAngle = wrapAngle_;
const TUNING = TUNING_;
const dist = dist_;
const hypot2 = hypot2_;
const datan2 = datan2_;
const dcos = dcos_;
const dexp = dexp_;
const dsin = dsin_;
const dtanh = dtanh_;
const clamp = clamp_;
const findSkater = findSkater_;
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
const POSE_SECONDS = 0.6;
const COVER_SECONDS = 1.2;
/** Rebounds start this far (m) in front of the goalie. */
const RB_START = 0.45;
/** A save above this height (m) is a glove or blocker save; below it, a pad save when this far (m) off his centre, else butterfly. */
const HIGH_SAVE_Z = 0.5;
const PAD_OFFSET = 0.35;

const logistic = (x: number): number => 1 / (1 + dexp(-x));

function goalieAttrs(defs: Map<string, PlayerDef>, id: string): GoalieAttrs {
  const a = defs.get(id)?.goalie;
  if (!a) throw new Error(`no goalie attributes for ${id}`);
  return a;
}


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
};

/** Chance that the goalie stops a shot on net. Parity: clamped to [0.03, 0.97]. */
export function saveChance(input: SaveInput): number {
  const a = input.goalie;
  let skill = 0, w = 0;
  for (const [k, wt] of Object.entries(G.saveSkill) as [keyof GoalieAttrs, number][]) { skill += a[k] * wt; w += wt; }
  skill /= w;
  const reaction = Math.min(1, input.distance / Math.max(1, input.shotSpeed));
  const lm = input.lateralMiss;
  // Skill counts nearly linearly around 70 (less above it than below) and flattens out toward the extremes.
  const per = skill >= 70 ? G.save.perPointAbove : G.save.perPoint;
  const skillTerm = per * G.save.skillSpan * dtanh((skill - 70) / G.save.skillSpan);
  const logit = G.save.base + G.save.perReactionSecond * reaction + skillTerm + (input.night ?? 0)
    - (input.screened ? G.save.screened : 0)
    - G.save.perMovingSpeed * input.goalieMovingSpeed
    - G.save.perBodyMetre * Math.max(0, lm - G.save.body)
    - G.save.perStretchMetre * Math.max(0, lm - G.save.stretch)
    - G.save.perHighMetre * Math.max(0, input.height - G.save.highFrom);
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
  const depth = clamp(G.depth.min + (d - G.depth.near) * G.depth.perMetre, G.depth.min, G.depth.max);
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
  const top = (G.speed.base + a.lateral * G.speed.perPoint) * (g.poseT > 0 ? POSE_SPEED_FACTOR : 1);
  const step = Math.min(d, top * dt);
  const k = d > 0 ? step / d : 0;
  g.vel.x = (dx * k) / dt;
  g.vel.y = (dy * k) / dt;
  g.pos.x += dx * k;
  g.pos.y += dy * k;
  const want = datan2(p.y - g.pos.y, p.x - g.pos.x);
  const turn = wrapAngle(want - g.facing);
  const maxTurn = (G.squareRate.base + a.positioning * G.squareRate.perPoint) * dt;
  g.facing = wrapAngle(g.facing + clamp(turn, -maxTurn, maxTurn));
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
  if (hypot2(pk.vel.x, pk.vel.y) >= G.cover.speed || pk.z > G.cover.maxZ) return false;
  const nx = end * GOAL;
  if ((pk.pos.x - nx) * end > 0 || hypot2(pk.pos.x - nx, pk.pos.y) > RINK.creaseRadius) return false;
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
 * puck in his crease when an opponent is near it (emits `freeze` into `out`, play stops for an end-zone faceoff).
 */
export function goalieTick(state: GameState, defs: Map<string, PlayerDef>, dt: number, out: GameEvent[] = []): void {
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

/**
 * The puck reached the goal line between the posts under the bar (stepPuck stopped it there). Emits `shot` for the
 * attacking side, then decides it with saveChance from where the goalie is against the shot's line, how square he is,
 * the shot's speed and distance, a screen, his movement and the height.
 * - Save: `save` (side and playerId the goalie's), a pose from where it crossed, then he holds it (`freeze`, play
 *   stops for the end-zone dot nearest the puck) or it rebounds loose in front of him, slower and straighter the
 *   better his reboundControl.
 * - Goal: `goal` for the shooter, with up to two previous distinct teammates in the touch chain as assists (only
 *   touches within TUNING.scoring.assistWindowSeconds of the goal count) and the
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
  // A puck that was not shot (a pass or a loose puck sliding in) has been on its way since it was last let go: he has
  // had that long to see it coming.
  const rel = state.lastRelease;
  const reactDistance = shot || rel === null ? distance : Math.max(distance, (state.tick - rel.tick) * DT * ev.speed);

  // How far the shot's line passes from his centre, plus how far he is from square to where it came from.
  const lx = netX - fx, ly = ev.y - fy;
  const ll = hypot2(lx, ly) || 1;
  const offLine = Math.abs((g.pos.x - fx) * ly - (g.pos.y - fy) * lx) / ll;
  const squareErr = Math.abs(wrapAngle(datan2(fy - g.pos.y, fx - g.pos.x) - g.facing));
  const p = saveChance({
    goalie: ga, lateralMiss: offLine + squareErr * G.squareMissPerRad, shotSpeed: ev.speed, distance: reactDistance,
    screened: state.screenedUntilTick[defSide] > state.tick, goalieMovingSpeed: hypot2(g.vel.x, g.vel.y), height: ev.z,
    night: state.goalieNight[defSide],
  });
  const releaseTick = shot ? shot.tick : null;
  out.push(gameEvent(state, { type: 'shot', side: attSide, playerId: shooterId, otherId: g.id, pos: state.puck.pos, detail: { distance, releaseTick, speed: ev.speed } }));

  if (rng.chance(p)) {
    const pose = savePose(g, defs.get(g.id)?.catches ?? 'L', ev.y, ev.z, end);
    g.pose = pose;
    g.poseT = POSE_SECONDS;
    out.push(gameEvent(state, { type: 'save', side: defSide, playerId: g.id, otherId: shooterId, pos: state.puck.pos, detail: { pose } }));
    const rc = ga.reboundControl;
    const pk = state.puck;
    if (rng.chance(clamp(G.freeze[pose].base + G.freeze[pose].perPoint * rc, 0.03, 0.97))) {
      g.pose = 'cover';
      g.poseT = COVER_SECONDS;
      out.push(gameEvent(state, { type: 'freeze', side: defSide, playerId: g.id, otherId: null, pos: pk.pos, detail: { cause: 'save' } }));
      stopPlay(state, endDotNear(end, pk.pos));
      return 'save';
    }
    // Rebound: off the reflected line of the shot, turned by the pose and spread by poor rebound control.
    const out0 = end === 1 ? Math.PI : 0;
    let rel = wrapAngle(datan2(ly / ll, (-lx / ll)) - out0);
    if (pose === 'blocker') rel -= G.blockerTurn;
    else if (pose === 'pad') rel += (ev.y - g.pos.y) * -end >= 0 ? G.padTurn : -G.padTurn;
    rel = clamp(rel + rng.gauss() * (G.reboundSpread.base + G.reboundSpread.perPoint * (100 - rc)), -G.reboundMaxAngle, G.reboundMaxAngle);
    const angle = out0 + rel;
    const speed = ev.speed * clamp(G.reboundSpeed.base - G.reboundSpeed.perPoint * rc, G.reboundSpeed.min, G.reboundSpeed.max) * G.reboundPoseSpeed[pose];
    pk.pos.x = g.pos.x + dcos(angle) * RB_START;
    pk.pos.y = g.pos.y + dsin(angle) * RB_START;
    if (pk.pos.x * end > GOAL - 0.1) pk.pos.x = end * (GOAL - 0.1);
    pk.vel.x = dcos(angle) * speed;
    pk.vel.y = dsin(angle) * speed;
    pk.z = 0;
    pk.vz = 0;
    resolveBoards(pk.pos, pk.vel, PUCK_RADIUS, 0);
    state.carrierId = null;
    state.lastTouch = { id: g.id, side: defSide };
    state.icingWatch = null; // the goalie played it
    return 'save';
  }

  // Goal.
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
  out.push(gameEvent(state, { type: 'goal', side: attSide, playerId: shooterId, otherId: g.id, assistIds: assists, pos: state.puck.pos, detail: { distance, releaseTick }, onIce: onIceIds(state) }));
  stopPlay(state, FACEOFF_DOTS.centre);
  return 'goal';
}
