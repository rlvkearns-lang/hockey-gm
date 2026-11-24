import { blockPickup as blockPickup_, recordTouch as recordTouch_, tryIntercept as tryIntercept_ } from './actions';
import { bladePos as bladePos_ } from './blade';
import { comesFromBehind as comesFromBehind_, receiveChance as receiveChance_, receiverContest as receiverContest_ } from './passing';
import { BENCH_DOORS as BENCH_DOORS_, benchTick as benchTick_, finishChanges as finishChanges_, initialBench as initialBench_ } from './bench';
import { resolveBodies as resolveBodies_, resolveGoalies as resolveGoalies_, routeAroundGoalies as routeAroundGoalies_ } from './bodies';
import { brainTick as brainTick_ } from './brain';
import { BRAIN_INTERVAL_TICKS, DT as DT_, PERIOD_SECONDS as PERIOD_SECONDS_, PERIODS as PERIODS_ } from './constants';
import { clearContests as clearContests_, contestEndEvent as contestEndEvent_, contestTick as contestTick_, puckHeldByContest as puckHeldByContest_, type ContestRef } from './contests/core';
import { gameEvent as gameEvent_ } from './events';
import { dropPuck as dropPuck_, FACEOFF_MAX_SECONDS as FACEOFF_MAX_SECONDS_, FACEOFF_MIN_SECONDS as FACEOFF_MIN_SECONDS_, linedUp as linedUp_, restPuck as restPuck_, setupFaceoff as setupFaceoff_, snapToLineup as snapToLineup_ } from './faceoff';
import { goaliePlaysPass as goaliePlaysPass_, goalieTick as goalieTick_, scoreFacedShot as scoreFacedShot_, whistleFacedShot as whistleFacedShot_ } from './goalie';
import { moveLoosePuck as moveLoosePuck_, trackShot as trackShot_ } from './shots';
import type { PuckEvent } from './puck';
import { refereeTick as refereeTick_ } from './referee';
import { clipToNets as clipToNets_, FACEOFF_DOTS as FACEOFF_DOTS_, RINK as RINK_, resolveBoards as resolveBoards_, resolveNets as resolveNets_, routeAroundNets as routeAroundNets_ } from './rink';
import { createRng as createRng_, restoreRng as restoreRng_, type Rng } from './rng';
import { TUNING as TUNING_ } from './tuning';
import { movementOf as movementOf_, stepSkater as stepSkater_, type Drive, type Movement } from './skating';
import { buildResult as buildResult_ } from './stats';
import { confirmTurnover as confirmTurnover_ } from './turnovers';
import { assignJobs as assignJobs_, driveOf as driveOf_, isTiedUp as isTiedUp_, steeredByContest as steeredByContest_ } from './team-play';
import { initialPlans as initialPlans_, initialTeamPhase as initialTeamPhase_ } from './commit';
import type {
  ContestState, GameEvent, GameResult, GameSetup, GameState, GoalieState, PlayerDef, Position, ShotInFlight, Side, SkaterState, Tactics,
} from './types';
import { validateSetup as validateSetup_ } from './validate';
import { dist as dist_, hypot2 as hypot2_, segDistXY as segDistXY_, type Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { PUCK_RADIUS as PUCK_RADIUS_, SIDES as SIDES_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const blockPickup = blockPickup_;
const bladePos = bladePos_;
const comesFromBehind = comesFromBehind_;
const receiveChance = receiveChance_;
const receiverContest = receiverContest_;
const recordTouch = recordTouch_;
const tryIntercept = tryIntercept_;
const BENCH_DOORS = BENCH_DOORS_;
const benchTick = benchTick_;
const finishChanges = finishChanges_;
const initialBench = initialBench_;
const resolveBodies = resolveBodies_;
const resolveGoalies = resolveGoalies_;
const routeAroundGoalies = routeAroundGoalies_;
const brainTick = brainTick_;
const DT = DT_;
const PERIOD_SECONDS = PERIOD_SECONDS_;
const PERIODS = PERIODS_;
const clearContests = clearContests_;
const contestEndEvent = contestEndEvent_;
const contestTick = contestTick_;
const puckHeldByContest = puckHeldByContest_;
const gameEvent = gameEvent_;
const dropPuck = dropPuck_;
const FACEOFF_MAX_SECONDS = FACEOFF_MAX_SECONDS_;
const FACEOFF_MIN_SECONDS = FACEOFF_MIN_SECONDS_;
const linedUp = linedUp_;
const restPuck = restPuck_;
const setupFaceoff = setupFaceoff_;
const snapToLineup = snapToLineup_;
const goalieTick = goalieTick_;
const goaliePlaysPass = goaliePlaysPass_;
const scoreFacedShot = scoreFacedShot_;
const whistleFacedShot = whistleFacedShot_;
const trackShot = trackShot_;
const moveLoosePuck = moveLoosePuck_;
const refereeTick = refereeTick_;
const clipToNets = clipToNets_;
const FACEOFF_DOTS = FACEOFF_DOTS_;
const RINK = RINK_;
const resolveBoards = resolveBoards_;
const resolveNets = resolveNets_;
const routeAroundNets = routeAroundNets_;
const createRng = createRng_;
const restoreRng = restoreRng_;
const TUNING = TUNING_;
const movementOf = movementOf_;
const stepSkater = stepSkater_;
const buildResult = buildResult_;
const confirmTurnover = confirmTurnover_;
const assignJobs = assignJobs_;
const driveOf = driveOf_;
const isTiedUp = isTiedUp_;
const steeredByContest = steeredByContest_;
const initialPlans = initialPlans_;
const initialTeamPhase = initialTeamPhase_;
const validateSetup = validateSetup_;
const dist = dist_;
const hypot2 = hypot2_;
const segDistXY = segDistXY_;
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;
const PUCK_RADIUS = PUCK_RADIUS_;
const SIDES = SIDES_;

export type Game = {
  readonly state: GameState;
  readonly done: boolean;
  step(): void;
  /** Events emitted since the last drain; clears that buffer. */
  drainEvents(): GameEvent[];
  result(): GameResult;
};

const PERIOD_TICKS = Math.round(PERIOD_SECONDS / DT);
const STOPPED_SECONDS = 1.5;
/** While play is stopped a skater in a goalie's way is moved out at most this far (m) a tick (bodies.ts resolveGoalies). */
const STOPPED_PUSH = 0.4;
/** A loose puck is taken with the blade within TUNING.blade.pickupReach (m) of it, or in his feet: his centre within IN_FEET (m). */
const PICKUP_REACH = TUNING_.blade.pickupReach;
const IN_FEET = 0.45;
/** A puck in his feet goes to his stick only from within this far (m) of the blade (the most a pickup moves it). */
const MAX_KICK = 1.2;
/** The carried puck moves at most the carrier's own travel plus CARRY_TURN (m) a tick, and never more than CARRY_STEP (m). */
const CARRY_TURN = 0.2;
const CARRY_STEP = 0.4;
const frameProbe = { x: 0, y: 0 };
const PICKUP_MAX_SPEED = 12;
/** A pass that comes off his stick (a bobble) leaves at BOBBLE_SPEED m/s, turned by up to BOBBLE_TURN rad. */
const BOBBLE_SPEED: [number, number] = [2, 4];
const BOBBLE_TURN = 1;
const EPS = 1e-9;
/** Scratch velocity for clamping the carried puck (its velocity is the carrier's, not bounced). */
const noVel = { x: 0, y: 0 };
/** Scratch: a skater's blade. */
const bladeScratch = { x: 0, y: 0 };
const NO_IDS: string[] = [];
const NO_PUCK_EVENTS: PuckEvent[] = [];
/** A skater routes round a net frame grown by his radius plus ROUTE_SLACK (m), via a corner ROUTE_ROUND (m) further out. */
const ROUTE_SLACK = 0.05;
const ROUTE_ROUND = 0.4;
/** Nobody whose position and target are both nearer centre ice than this (m) can have a net frame in his way. */
const ROUTE_CLEAR_X = RINK.goalLineX - 1;

/**
 * The energy his Movement is built from: 1 at 0.5 and above (where energy does not affect skating), else energy to the
 * nearest 0.005, so tired legs slow him without rebuilding his Movement every tick.
 */
const legs = (energy: number): number => (energy >= 0.5 ? 1 : Math.round(energy * 200) / 200);

const homeDirFor = (period: number): 1 | -1 => (period % 2 === 1 ? 1 : -1);

function goalieAt(id: string, dir: 1 | -1): GoalieState {
  return { id, pos: { x: -dir * (RINK.goalLineX - 0.6), y: 0 }, vel: { x: 0, y: 0 }, facing: dir === 1 ? 0 : Math.PI, pose: 'stance', poseT: 0 };
}

function initialState(setup: GameSetup): GameState {
  const skaters: SkaterState[] = [];
  const onIce = { home: [] as string[], away: [] as string[] };
  for (const side of SIDES) {
    const lines = setup[side].lines;
    const slotOf = new Map<string, Position>();
    const [lw, c, rw] = lines.forwards[0]!;
    const [ld, rd] = lines.defence[0]!;
    slotOf.set(lw, 'LW').set(c, 'C').set(rw, 'RW').set(ld, 'LD').set(rd, 'RD');
    for (const p of setup[side].players) {
      if (p.position === 'G') continue;
      const slot = slotOf.get(p.id) ?? null;
      const b = BENCH_DOORS[side];
      skaters.push({
        id: p.id, side, slot, pos: { x: b.x, y: b.y }, vel: { x: 0, y: 0 }, facing: 0, target: { x: b.x, y: b.y },
        faceTarget: null, mode: 'forward', speedCap: 1, energy: 1, onIce: slot !== null, leaving: false, downT: 0, contestId: null, shiftStart: 0, toiTicks: 0,
      });
      if (slot !== null) onIce[side].push(p.id);
    }
  }
  const dir = homeDirFor(1);
  return {
    tick: 0, period: 1, clock: PERIOD_SECONDS, phase: 'faceoffSetup', phaseT: 0,
    attackDir: { home: dir, away: dir === 1 ? -1 : 1 },
    puck: { pos: { x: 0, y: 0 }, z: 0, vel: { x: 0, y: 0 }, vz: 0 },
    carrierId: null, lastTouch: null, possession: null, skaters,
    goalies: { home: goalieAt(setup.home.lines.goalie, dir), away: goalieAt(setup.away.lines.goalie, dir === 1 ? -1 : 1) },
    contests: [], score: { home: 0, away: 0 }, faceoffSpot: { x: 0, y: 0 }, onIce, pickupBlock: null, pendingPass: null,
    shotInFlight: null, teamJump: { home: 0, away: 0 }, goalieNight: { home: 0, away: 0 }, screenedUntilTick: { home: 0, away: 0 }, touches: { side: null, ids: [], ticks: [] },
    lastAttackTouch: { home: null, away: null }, noChange: null, delayedOffside: null, icingWatch: null,
    lastRelease: null, contestCooldowns: [], tiedUpUntil: [], reboundEdge: null, turnoverWatch: null, lastSave: null,
    bench: initialBench(setup),
    plans: initialPlans(skaters.length),
    carrierPlan: null,
    oneTimerTaken: null,
    teamPhase: initialTeamPhase(),
    seed: setup.seed,
    rng: [0, 0, 0, 1],
  };
}

/** Teams take their ends for `period`, every skater fully rested, and skate to their line-up for the centre-ice draw. */
function startPeriod(state: GameState, period: number): void {
  const dir = homeDirFor(period);
  state.period = period;
  state.clock = PERIOD_SECONDS;
  state.attackDir = { home: dir, away: dir === 1 ? -1 : 1 };
  state.goalies.home = goalieAt(state.goalies.home.id, dir);
  state.goalies.away = goalieAt(state.goalies.away.id, state.attackDir.away);
  state.lastTouch = null;
  state.pickupBlock = null;
  state.pendingPass = null;
  for (const s of state.skaters) s.energy = 1; // rested over the intermission
  restPuck(state);
  setupFaceoff(state, FACEOFF_DOTS.centre);
}

/** x + 0 is x, except that -0 becomes +0. */
const z = (v: { x: number; y: number }): void => { v.x += 0; v.y += 0; };

/**
 * Turns every -0 in the moving parts of the state into +0 (velocities pick up -0 from products like 0 * -0.4). JSON
 * drops the sign of zero, so this keeps a state that has been through JSON identical to the one that has not.
 */
function noNegativeZero(state: GameState): void {
  for (const s of state.skaters) { z(s.pos); z(s.vel); s.facing += 0; }
  const p = state.puck;
  z(p.pos); z(p.vel); p.z += 0; p.vz += 0;
  for (const g of [state.goalies.home, state.goalies.away]) { z(g.pos); z(g.vel); g.facing += 0; }
}

/**
 * Engine-internal options (not exported from index.ts): `lookTicks`, how often the carrier looks for a decision point
 * (default BRAIN_INTERVAL_TICKS). For tests only: it is not in GameState, so a game restored with restoreGame looks at
 * the default interval whatever the game it was saved from used (Task 8 review, Minor 7).
 */
export type GameOptions = { lookTicks?: number };

/** A new game of `setup` (validated first: a bad setup throws a SetupError naming the problem). */
export function createGame(setup: GameSetup): Game {
  return createGameWith(setup, {});
}

/** createGame with engine-internal options (test/play.test.ts: the result does not depend on the look interval). */
export function createGameWith(setup: GameSetup, opts: GameOptions): Game {
  validateSetup(setup);
  const rng = createRng(setup.seed);
  const state = initialState(setup);
  // How each side comes out on the night: a team's jump and its goalie's form (no game is decided by ratings alone).
  state.teamJump = { home: rng.gauss() * TUNING.night.teamJumpSd, away: rng.gauss() * TUNING.night.teamJumpSd };
  state.goalieNight = { home: rng.gauss() * TUNING.night.goalieSd, away: rng.gauss() * TUNING.night.goalieSd };
  startPeriod(state, 1);
  snapToLineup(state); // the opening line-up; later draws wait for players to skate there
  state.rng = rng.getState();
  return run(setup, state, rng, [], opts);
}

/**
 * A game of `setup` that carries on from `state`, a snapshot of `game.state` taken between steps (it may have been
 * through JSON), with `eventsSoFar` the events up to then (`game.result().events`). It plays out exactly as the game
 * it was taken from. The state and events are copied; drainEvents hands out only events after the snapshot.
 * Throws if the setup is invalid or the state is not one of its games.
 */
export function restoreGame(setup: GameSetup, state: GameState, eventsSoFar: readonly GameEvent[]): Game {
  validateSetup(setup);
  const own = JSON.parse(JSON.stringify(state)) as GameState;
  checkStateFits(setup, own);
  const events = JSON.parse(JSON.stringify(eventsSoFar)) as GameEvent[];
  return run(setup, own, restoreRng(own.rng), events);
}

/** Throws unless `state` is a state of a game of `setup`: its seed, and the same skaters and goalies. */
function checkStateFits(setup: GameSetup, state: GameState): void {
  const skaters = [...setup.home.players, ...setup.away.players].filter((p) => p.position !== 'G').map((p) => p.id);
  const ids = Array.isArray(state.skaters) ? state.skaters.map((s) => s.id) : [];
  if (state.seed !== setup.seed) throw new Error(`state is from a game with seed ${String(state.seed)}, not ${setup.seed}`);
  if (ids.length !== skaters.length || ids.some((id, i) => id !== skaters[i])) throw new Error('state does not hold this setup\'s skaters');
  for (const side of SIDES) {
    if (!setup[side].players.some((p) => p.id === state.goalies?.[side]?.id && p.position === 'G')) throw new Error(`state's ${side} goalie is not in this setup`);
  }
  if (!Array.isArray(state.rng) || state.rng.length !== 4) throw new Error('state has no random-number state');
}

function run(setup: GameSetup, state: GameState, rng: Rng, events: GameEvent[], opts: GameOptions = {}): Game {
  const lookTicks = opts.lookTicks ?? BRAIN_INTERVAL_TICKS;
  const defs = new Map<string, PlayerDef>();
  for (const side of SIDES) for (const p of setup[side].players) defs.set(p.id, p);
  const tactics: Record<Side, Tactics> = { home: setup.home.tactics, away: setup.away.tactics };
  let drained = events.length;

  // Per-skater bookkeeping (derived, rebuilt on restore), parallel to state.skaters (whose order never changes).
  // Movement is rebuilt only when the skater's legs change (see legs()).
  const bodies = state.skaters.map((sk) => ({ def: defs.get(sk.id)!, legs: legs(sk.energy), move: movementOf(defs.get(sk.id)!, legs(sk.energy)) }));
  const bodyById = new Map(state.skaters.map((sk, i) => [sk.id, bodies[i]!]));
  const move = (id: string): Movement => bodyById.get(id)!.move;
  /** On-ice skaters, refilled in place each tick, their Movements and their indexes in state.skaters (same order). */
  const onIceList: SkaterState[] = [];
  const onIceMoves: Movement[] = [];
  const onIceIdx: number[] = [];
  /** Loose puck position before this tick's step (scratch). */
  const prevPuck = { x: 0, y: 0 };
  const onIceSkaters = (): SkaterState[] => {
    onIceList.length = 0;
    onIceMoves.length = 0;
    onIceIdx.length = 0;
    const all = state.skaters;
    for (let i = 0; i < all.length; i++) {
      const sk = all[i]!;
      if (!sk.onIce) continue;
      const b = bodies[i]!;
      const l = legs(sk.energy);
      if (b.legs !== l) { b.legs = l; b.move = movementOf(b.def, l); }
      onIceList.push(sk);
      onIceMoves.push(b.move);
      onIceIdx.push(i);
    }
    return onIceList;
  };
  const toiMap = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (const sk of state.skaters) if (sk.toiTicks > 0) m.set(sk.id, sk.toiTicks * DT);
    return m;
  };

  /**
   * Movement (each skater driven as his plan says: driveOf), body separation, boards and net frames for the on-ice
   * skaters (onIceSkaters(), with onIceMoves). The goalies' bodies come after the goalies move (settle).
   */
  function moveSkaters(skaters: SkaterState[]): void {
    for (let i = 0; i < skaters.length; i++) {
      const s = skaters[i]!;
      if (s.downT > 0) s.downT = Math.max(0, s.downT - DT);
      // With a net frame in his way he skates for its corner; his target itself stays what it is.
      const t = s.target;
      const nearNet = s.pos.x >= ROUTE_CLEAR_X || s.pos.x <= -ROUTE_CLEAR_X || t.x >= ROUTE_CLEAR_X || t.x <= -ROUTE_CLEAR_X;
      if (nearNet) {
        routeAroundNets(s.pos, t, onIceMoves[i]!.radius + ROUTE_SLACK, ROUTE_ROUND, waypoint);
        // Against his own goalie's body he goes round it too (else the goalie and the frame can pin him in the crease).
        if (waypoint.x === t.x && waypoint.y === t.y) {
          goaliePair[0] = state.goalies.home; goaliePair[1] = state.goalies.away;
          routeAroundGoalies(s.pos, t, onIceMoves[i]!.radius, goaliePair, waypoint);
        }
      }
      if (!nearNet || (waypoint.x === t.x && waypoint.y === t.y)) stepSkater(s, onIceMoves[i]!, DT, driveOf(state, s, onIceIdx[i]!));
      else {
        const tx = t.x, ty = t.y;
        t.x = waypoint.x; t.y = waypoint.y;
        stepSkater(s, onIceMoves[i]!, DT, routeDrive(driveOf(state, s, onIceIdx[i]!)));
        t.x = tx; t.y = ty;
      }
    }
    resolveBodies(skaters, move, onIceMoves);
    for (let i = 0; i < skaters.length; i++) {
      const s = skaters[i]!;
      const r = onIceMoves[i]!.radius;
      resolveBoards(s.pos, s.vel, r, 0);
      resolveNets(s.pos, s.vel, r);
    }
  }

  const waypoint = { x: 0, y: 0 };
  /** The two goalies, read from the state on every use (a restored or reset state holds new goalie objects). */
  const goaliePair: GoalieState[] = [];
  const routed: Drive = { slow: 'coast', through: true };
  /** On the way round a net he skates through the corner, slowing only as his plan says. */
  const routeDrive = (d: Drive): Drive => { routed.slow = d.slow; return routed; };

  /**
   * After the goalies have moved: keeps the on-ice skaters (moved by moveSkaters) out of the goalies, and anyone a
   * goalie pushed inside the boards and out of the net frames again.
   */
  function settle(skaters: SkaterState[]): void {
    if (resolveGoalies(skaters, onIceMoves, goalieList(), state.phase === 'live' ? Infinity : STOPPED_PUSH) === 0) return;
    for (let i = 0; i < skaters.length; i++) {
      const s = skaters[i]!;
      const r = onIceMoves[i]!.radius;
      resolveBoards(s.pos, s.vel, r, 0);
      resolveNets(s.pos, s.vel, r);
    }
  }
  const goalies: GoalieState[] = [];
  const goalieList = (): GoalieState[] => { goalies.length = 0; goalies.push(state.goalies.home, state.goalies.away); return goalies; };

  /** The carried puck sits on his blade (blade.ts bladePos), on his side of a net frame and inside the boards. */
  function carryPuck(carrier: SkaterState): void {
    const p = state.puck;
    const t = bladePos(carrier.pos, carrier.facing, bodyById.get(carrier.id)!.def.shoots, bladeScratch);
    // On his side of a net frame (his body is kept out of the frame by resolveNets).
    clipToNets(carrier.pos, t, PUCK_RADIUS);
    // The puck follows the blade as he skates and turns, but never jumps: at most his own travel plus CARRY_TURN a tick,
    // and never more than CARRY_STEP (where the blade swings past a post, it slides round it).
    const dx = t.x - p.pos.x, dy = t.y - p.pos.y, l = hypot2(dx, dy);
    const step = Math.min(CARRY_STEP, hypot2(carrier.vel.x, carrier.vel.y) * DT + CARRY_TURN);
    if (l > step) { t.x = p.pos.x + (dx / l) * step; t.y = p.pos.y + (dy / l) * step; }
    // A step that would end inside a frame goes to the frame (the furthest point of it outside) and slides along the face
    // it met for the rest of the step, so it goes round the net toward the blade and never moves further than the step.
    if (!inFrame(p.pos) && inFrame(t)) {
      const x0 = p.pos.x, y0 = p.pos.y, mx = t.x - x0, my = t.y - y0;
      let lo = 0, hi = 1;
      for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; frameProbe.x = x0 + mx * mid; frameProbe.y = y0 + my * mid; if (inFrame(frameProbe)) hi = mid; else lo = mid; }
      const sx = x0 + mx * lo, sy = y0 + my * lo;
      // The face it met: the back or a side (or the goal line, from in front), by where it stands against the frame.
      const end = sx >= 0 ? 1 : -1, ax = sx * end, r = PUCK_RADIUS;
      const back = RINK.goalLineX + RINK.netDepth + r, front = RINK.goalLineX - r, half = RINK.netHalfWidth + r;
      let rx = mx * (1 - lo), ry = my * (1 - lo);
      if (ax >= back - 1e-6 || ax <= front + 1e-6) rx = 0; else if (Math.abs(sy) >= half - 1e-6) ry = 0;
      t.x = sx + rx; t.y = sy + ry;
    }
    p.pos.x = t.x;
    p.pos.y = t.y;
    p.vel.x = carrier.vel.x;
    p.vel.y = carrier.vel.y;
    p.z = 0;
    p.vz = 0;
    // Never inside a frame: out through its back or a side, the nearest (never into the goal mouth). It slides round a
    // frame, a step at a time, toward a blade on his side of it.
    outOfFrame(p.pos);
    noVel.x = 0;
    noVel.y = 0;
    resolveBoards(p.pos, noVel, PUCK_RADIUS, 0);
  }

  /** Whether `q` is inside a net frame grown by the puck's radius. */
  function inFrame(q: { x: number; y: number }): boolean {
    const x = q.x * (q.x >= 0 ? 1 : -1), r = PUCK_RADIUS;
    return x > RINK.goalLineX - r && x < RINK.goalLineX + RINK.netDepth + r && Math.abs(q.y) < RINK.netHalfWidth + r;
  }

  /** Moves `q`, when it is inside a net frame grown by the puck's radius, out through the nearest of its back and sides. */
  function outOfFrame(q: { x: number; y: number }): void {
    const end = q.x >= 0 ? 1 : -1;
    const x = q.x * end, r = PUCK_RADIUS;
    const front = RINK.goalLineX - r, back = RINK.goalLineX + RINK.netDepth + r, half = RINK.netHalfWidth + r;
    if (x <= front || x >= back || q.y <= -half || q.y >= half) return;
    const toBack = back - x, toSide = half - Math.abs(q.y);
    if (toBack <= toSide) q.x = back * end;
    else q.y = (q.y >= 0 ? 1 : -1) * half;
  }

  /**
   * A pass's receiver takes it when it came within TUNING.blade.pickupReach of his blade this tick (from `prev` to now),
   * at any speed, after one draw against receiveChance (passing.ts; contested by the nearest opponent to his blade,
   * receiverContest): on a miss it bobbles off his stick (2 to 4 m/s,
   * turned up to 1 rad), pendingPass.bobbled is set, he cannot touch it for RELEASE_NO_PICKUP_SECONDS, and his next
   * touch takes it with no draw. A loose puck slower than PICKUP_MAX_SPEED goes to the nearest eligible skater whose
   * blade it came within pickupReach of this tick, or whose centre it is within IN_FEET of. Eligible: not down, not
   * leaving, not steered by a contest, not blocked, his stick not tied up. Nobody takes a puck a board battle holds.
   */
  function tryPickup(skaters: SkaterState[], prev: { x: number; y: number }): void {
    if (puckHeldByContest(state)) return;
    const p = state.puck;
    // A puck over or inside a net frame (a shot over the bar coming down on the netting) is nobody's to take until it is
    // out: taken there, the carried puck was pushed out of the frame, a 1.1 m jump (close-out, seed 2).
    if (inFrame(p.pos)) return;
    const block = state.pickupBlock;
    const blocked = block !== null && state.tick < block.untilTick ? block.ids : NO_IDS;
    let best: SkaterState | null = null;
    const pass = state.pendingPass;
    if (pass !== null) {
      for (const s of skaters) {
        if (s.id !== pass.toId) continue;
        if (s.downT > 0 || s.leaving || steeredByContest(state, s) || blocked.includes(s.id) || isTiedUp(state, s.id)) break;
        const d = bodyById.get(s.id)!.def;
        const b = bladePos(s.pos, s.facing, d.shoots, bladeScratch);
        if (segDistXY(b.x, b.y, prev.x, prev.y, p.pos.x, p.pos.y) > PICKUP_REACH) break;
        if (!pass.bobbled) {
          const speed = hypot2(p.vel.x, p.vel.y);
          // An opponent on him as it arrives contests the catch.
          let near = Infinity;
          for (const o of skaters) if (o.side !== s.side && o.downT === 0) { const od = dist(o.pos, b); if (od < near) near = od; }
          if (!rng.chance(receiveChance(d, speed, comesFromBehind(s.facing, p.vel.x, p.vel.y), receiverContest(near, 0)))) {
            // Off his stick: it bobbles away, and he needs a moment to get to it.
            const a = datan2(p.vel.y, p.vel.x) + rng.range(-BOBBLE_TURN, BOBBLE_TURN), v = rng.range(BOBBLE_SPEED[0], BOBBLE_SPEED[1]);
            p.vel.x = dcos(a) * v;
            p.vel.y = dsin(a) * v;
            pass.bobbled = true;
            blockPickup(state, [s.id]);
            return;
          }
        }
        best = s;
        break;
      }
    }
    let passSide: Side | null = null;
    if (pass !== null) for (const k of state.skaters) if (k.id === pass.fromId) passSide = k.side;
    if (!best && hypot2(p.vel.x, p.vel.y) < PICKUP_MAX_SPEED) {
      let bestD = Infinity;
      for (const s of skaters) {
        if (s.downT > 0 || s.leaving || steeredByContest(state, s) || blocked.includes(s.id) || isTiedUp(state, s.id)) continue;
        // A pass's receiver takes it only as a pass (above, with its draw) until it has come off his stick, and an
        // opponent only by picking it off (actions.ts tryIntercept, his one try).
        if (pass !== null && !pass.bobbled && (s.id === pass.toId || s.side !== passSide)) continue;
        const b = bladePos(s.pos, s.facing, bodyById.get(s.id)!.def.shoots, bladeScratch);
        const db = segDistXY(b.x, b.y, prev.x, prev.y, p.pos.x, p.pos.y), dc = dist(s.pos, p.pos);
        // In his feet he kicks it up to his stick: only when the blade is within MAX_KICK of it.
        const d = db <= PICKUP_REACH ? db : dc <= IN_FEET && dist(b, p.pos) <= MAX_KICK ? dc : Infinity;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    if (!best) return;
    // A one-timer pass taken by its receiver: he may shoot it at once (actions.ts shotTypeFor, options.ts).
    if (pass !== null && pass.oneTimer && best.id === pass.toId) state.oneTimerTaken = { id: best.id, tick: state.tick };
    state.pendingPass = null;
    state.carrierId = best.id;
    state.lastTouch = { id: best.id, side: best.side };
    recordTouch(state, best.id, best.side);
    state.possession = best.side;
    carryPuck(best);
  }


  /** A shot cut short by a whistle or the horn ends as a `miss` (Task 7 review: every shot release has one outcome). */
  function missAtWhistle(shot: ShotInFlight): void {
    events.push(gameEvent(state, { type: 'miss', side: shot.side, playerId: shot.tippedBy ?? shot.shooterId, otherId: state.goalies[shot.side === 'home' ? 'away' : 'home'].id, pos: state.puck.pos, detail: { distance: shot.fromDist, releaseTick: shot.tick, tippedFrom: shot.tippedBy !== null ? shot.shooterId : null } }));
  }

  /**
   * state.lastSave lasts while the puck is loose or the attackers have it in that zone, for TUNING.rebound.windowSeconds:
   * cleared when the goalie's side carries the puck or the puck leaves the zone (Task 8).
   */
  function watchLastSave(): void {
    const ls = state.lastSave;
    if (ls === null) return;
    const end = -state.attackDir[ls.side];
    const carrier = state.carrierId !== null ? state.skaters.find((k) => k.id === state.carrierId) : undefined;
    if ((carrier !== undefined && carrier.side === ls.side) || state.puck.pos.x * end < RINK.blueLineX
      || (state.tick - ls.tick) * DT > TUNING.rebound.windowSeconds) state.lastSave = null;
  }

  function liveTick(): void {
    const prevPuckX = state.puck.pos.x;
    if (state.pickupBlock !== null && state.tick >= state.pickupBlock.untilTick) state.pickupBlock = null;
    if (state.pendingPass !== null && state.tick >= state.pendingPass.untilTick) state.pendingPass = null;
    benchTick(state, setup, DT, events);
    assignJobs(state, defs, tactics);
    brainTick(state, defs, rng, events, lookTicks);
    contestTick(state, defs, rng, DT, events, setup.chemistry);

    const skaters = onIceSkaters();
    moveSkaters(skaters);
    goalieTick(state, defs, DT, events);
    settle(skaters);

    if (state.phase === 'live') {
      let carrier: SkaterState | null = null;
      if (state.carrierId !== null) for (const sk of skaters) if (sk.id === state.carrierId) { carrier = sk; break; }
      if (carrier) {
        carryPuck(carrier);
        // A shot still in flight that someone has come away with (a contest's hand-over): it is over.
        if (state.shotInFlight !== null) trackShot(state, NO_PUCK_EVENTS, events, defs);
      } else {
        state.carrierId = null;
        // Tips, blocks, the goalie's save at his plane, the puck's step and the net (shots.ts moveLoosePuck).
        const { puckEvents, onNet } = moveLoosePuck(state, defs, rng, events, prevPuck);
        // A pass through the goalie's crease: he gets one try at it (Task 8b review, Important 2).
        if (!onNet && state.phase === 'live') goaliePlaysPass(state, defs, rng, prevPuck, events);
        if (!onNet && state.phase === 'live') {
          // Nobody touches a shot that is past the goalie on its way in, nor the puck on the tick of a save (it is at the
          // goalie; it comes out next tick).
          const savedNow = state.lastSave !== null && state.lastSave.tick === state.tick;
          if (!savedNow && (state.shotInFlight === null || !state.shotInFlight.faced)) {
            const caught = tryIntercept(state, defs, rng, prevPuck);
            if (caught) {
              events.push(caught.event);
              if (caught.taker) carryPuck(caught.taker);
              else tryPickup(skaters, prevPuck);
            } else tryPickup(skaters, prevPuck);
          }
          trackShot(state, puckEvents, events, defs, rng);
        }
      }
      watchLastSave();
    }
    const flying = state.shotInFlight;
    const call = refereeTick(state, prevPuckX, defs);
    // A whistle while a shot is still on its way ends it as a miss (every shot release has exactly one outcome).
    if (call && flying !== null && state.shotInFlight === null) {
      // One already past the goalie is no goal either: the whistle kills it (goalie.ts whistleFacedShot).
      if (flying.faced) { state.shotInFlight = flying; whistleFacedShot(state, defs, events); } else missAtWhistle(flying);
    }
    if (call) events.push(call);
    const turnover = confirmTurnover(state);
    if (turnover) events.push(turnover);

    for (const s of skaters) s.toiTicks++;
    const liveTicks = Math.round((PERIOD_SECONDS - state.clock) / DT) + 1;
    state.clock = Math.max(0, (PERIOD_TICKS - liveTicks) * DT);

    if (liveTicks >= PERIOD_TICKS) {
      // A shot still on its way at the horn is a miss (Task 7 review: every shot release has exactly one outcome).
      // (A shot already past the goalie is in: it counts.)
      if (state.shotInFlight !== null) { if (state.shotInFlight.faced) scoreFacedShot(state, events); else missAtWhistle(state.shotInFlight); }
      events.push(gameEvent(state, { type: 'periodEnd', side: null, playerId: null, otherId: null, pos: state.puck.pos, detail: { period: state.period } }));
      state.carrierId = null;
      state.carrierPlan = null;
      state.possession = null;
      state.pickupBlock = null;
      state.pendingPass = null;
      state.oneTimerTaken = null;
      state.shotInFlight = null;
      state.lastRelease = null;
      state.tiedUpUntil = [];
      state.reboundEdge = null;
      state.turnoverWatch = null;
      state.lastSave = null;
      clearContests(state);
      restPuck(state);
      state.phase = state.period >= PERIODS ? 'final' : 'intermission';
      state.phaseT = 0;
    }
  }

  function step(): void {
    if (state.phase === 'final') return;
    const before = state.contests.slice();
    const mark = events.length;
    stepOnce();
    endCutContests(before, mark);
    noNegativeZero(state);
    state.rng = rng.getState();
  }

  /**
   * A contest that a whistle or the end of a period cleared this step (it was running, or started this step, and is
   * gone without its own `contestEnd`) gets a `contestEnd` with result `whistle`, so the event log closes every contest.
   */
  function endCutContests(before: readonly ContestState[], mark: number): void {
    const open: ContestRef[] = before.slice();
    const ended = new Set<number>();
    const n = events.length;
    for (let i = mark; i < n; i++) {
      const e = events[i]!;
      if (e.type === 'contestEnd') ended.add(e.detail.contestId);
      else if (e.type === 'contestStart') open.push({ id: e.detail.contestId, kind: e.detail.kind, spot: e.pos });
    }
    for (const c of open) {
      if (ended.has(c.id) || state.contests.some((k) => k.id === c.id)) continue;
      ended.add(c.id);
      events.push(contestEndEvent(state, c, 'whistle', null, 'unchanged'));
    }
  }

  function stepOnce(): void {
    state.tick++;
    state.phaseT += DT;
    switch (state.phase) {
      case 'live':
        liveTick();
        break;
      case 'stopped':
        benchTick(state, setup, DT, events);
        moveSkaters(onIceSkaters());
        goalieTick(state, defs, DT, events);
        settle(onIceList);
        if (state.phaseT >= STOPPED_SECONDS - EPS) setupFaceoff(state, state.faceoffSpot);
        break;
      case 'faceoffSetup':
        benchTick(state, setup, DT, events);
        moveSkaters(onIceSkaters());
        goalieTick(state, defs, DT, events);
        settle(onIceList);
        if (state.phaseT >= FACEOFF_MIN_SECONDS - EPS && (state.phaseT >= FACEOFF_MAX_SECONDS - EPS || linedUp(state))) {
          finishChanges(state, setup); // at the 8 s cap a change may still be under way
          const e = dropPuck(state, defs, rng);
          events.push(e);
          const ids = [e.playerId, e.otherId].filter((id): id is string => id !== null);
          blockPickup(state, ids);
        }
        break;
      case 'intermission':
        startPeriod(state, state.period + 1);
        break;
    }
  }

  return {
    state,
    get done() { return state.phase === 'final'; },
    step,
    drainEvents() {
      const out = events.slice(drained);
      drained = events.length;
      return out;
    },
    result: () => buildResult(setup, events, toiMap()),
  };
}

export function simulateGame(setup: GameSetup): GameResult {
  const game = createGame(setup);
  while (!game.done) game.step();
  return game.result();
}
