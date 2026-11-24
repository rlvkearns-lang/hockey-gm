import { blockPickup, recordTouch, tryIntercept } from './actions';
import { BENCH_DOORS, benchTick, finishChanges, initialBench } from './bench';
import { resolveBodies, resolveGoalies } from './bodies';
import { brainTick } from './brain';
import { DT, PERIOD_SECONDS, PERIODS } from './constants';
import { clearContests, contestEndEvent, contestTick, puckHeldByContest, type ContestRef } from './contests/core';
import { gameEvent } from './events';
import { dropPuck, FACEOFF_MAX_SECONDS, FACEOFF_MIN_SECONDS, linedUp, restPuck, setupFaceoff, snapToLineup } from './faceoff';
import { goalieTick, resolveOnNet, trackShot, tryBlock } from './goalie';
import { stepPuck, type PuckEvent } from './puck';
import { refereeTick } from './referee';
import { clipToNets, FACEOFF_DOTS, RINK, resolveBoards, resolveNets, routeAroundNets } from './rink';
import { createRng, restoreRng, type Rng } from './rng';
import { TUNING } from './tuning';
import { movementOf, stepSkater, type Drive, type Movement } from './skating';
import { buildResult } from './stats';
import { confirmTurnover } from './turnovers';
import { assignJobs, driveOf, isTiedUp, steeredByContest } from './team-play';
import { initialPlans, initialTeamPhase } from './commit';
import type {
  ContestState, GameEvent, GameResult, GameSetup, GameState, GoalieState, PlayerDef, Position, Side, SkaterState, Tactics,
} from './types';
import { validateSetup } from './validate';
import { dist, hypot2, segDistXY } from './vec';
import { dcos, dsin } from './dmath';
import { PUCK_RADIUS, SIDES } from './util';

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
const PICKUP_RADIUS = 0.9;
const PICKUP_MAX_SPEED = 12;
/** How far ahead of the carrier's centre, along his facing, the puck sits. */
const CARRY_REACH = 0.6;
const EPS = 1e-9;
/** Scratch velocity for clamping the carried puck (its velocity is the carrier's, not bounced). */
const noVel = { x: 0, y: 0 };
const NO_IDS: string[] = [];
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
    lastRelease: null, contestCooldowns: [], tiedUpUntil: [], reboundEdge: null, turnoverWatch: null,
    bench: initialBench(setup),
    plans: initialPlans(skaters.length),
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

/** A new game of `setup` (validated first: a bad setup throws a SetupError naming the problem). */
export function createGame(setup: GameSetup): Game {
  validateSetup(setup);
  const rng = createRng(setup.seed);
  const state = initialState(setup);
  // How each side comes out on the night: a team's jump and its goalie's form (no game is decided by ratings alone).
  state.teamJump = { home: rng.gauss() * TUNING.night.teamJumpSd, away: rng.gauss() * TUNING.night.teamJumpSd };
  state.goalieNight = { home: rng.gauss() * TUNING.night.goalieSd, away: rng.gauss() * TUNING.night.goalieSd };
  startPeriod(state, 1);
  snapToLineup(state); // the opening line-up; later draws wait for players to skate there
  state.rng = rng.getState();
  return run(setup, state, rng, []);
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

function run(setup: GameSetup, state: GameState, rng: Rng, events: GameEvent[]): Game {
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
      if (nearNet) routeAroundNets(s.pos, t, onIceMoves[i]!.radius + ROUTE_SLACK, ROUTE_ROUND, waypoint);
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
  const routed: Drive = { slow: 'coast', through: true };
  /** On the way round a net he skates through the corner, slowing only as his plan says. */
  const routeDrive = (d: Drive): Drive => { routed.slow = d.slow; return routed; };

  /**
   * After the goalies have moved: keeps the on-ice skaters (moved by moveSkaters) out of the goalies, and anyone a
   * goalie pushed inside the boards and out of the net frames again.
   */
  function settle(skaters: SkaterState[]): void {
    if (resolveGoalies(skaters, onIceMoves, goalieList()) === 0) return;
    for (let i = 0; i < skaters.length; i++) {
      const s = skaters[i]!;
      const r = onIceMoves[i]!.radius;
      resolveBoards(s.pos, s.vel, r, 0);
      resolveNets(s.pos, s.vel, r);
    }
  }
  const goalies: GoalieState[] = [];
  const goalieList = (): GoalieState[] => { goalies.length = 0; goalies.push(state.goalies.home, state.goalies.away); return goalies; };

  function carryPuck(carrier: SkaterState): void {
    const p = state.puck;
    p.pos.x = carrier.pos.x + dcos(carrier.facing) * CARRY_REACH;
    p.pos.y = carrier.pos.y + dsin(carrier.facing) * CARRY_REACH;
    p.vel.x = carrier.vel.x;
    p.vel.y = carrier.vel.y;
    p.z = 0;
    p.vz = 0;
    // The puck stays on the carrier's side of a net frame (his body is kept out of the frame by resolveNets).
    clipToNets(carrier.pos, p.pos, PUCK_RADIUS);
    noVel.x = 0;
    noVel.y = 0;
    resolveBoards(p.pos, noVel, PUCK_RADIUS, 0);
  }

  /**
   * A loose puck slower than PICKUP_MAX_SPEED goes to the nearest eligible skater (not down, not leaving, not steered
   * by a contest, not blocked, his stick not tied up) within PICKUP_RADIUS. A pass's intended receiver takes it at any
   * speed if it came within PICKUP_RADIUS of him this tick (from `prev` to now). Nobody takes a puck a board battle holds.
   */
  function tryPickup(skaters: SkaterState[], prev: { x: number; y: number }): void {
    if (puckHeldByContest(state)) return;
    const p = state.puck;
    const block = state.pickupBlock;
    const blocked = block !== null && state.tick < block.untilTick ? block.ids : NO_IDS;
    let best: SkaterState | null = null;
    const pass = state.pendingPass;
    if (pass !== null) {
      for (const s of skaters) {
        if (s.id !== pass.toId) continue;
        if (s.downT === 0 && !s.leaving && !steeredByContest(state, s) && !blocked.includes(s.id) && !isTiedUp(state, s.id) && segDistXY(s.pos.x, s.pos.y, prev.x, prev.y, p.pos.x, p.pos.y) <= PICKUP_RADIUS) best = s;
        break;
      }
    }
    if (!best && hypot2(p.vel.x, p.vel.y) < PICKUP_MAX_SPEED) {
      let bestD = PICKUP_RADIUS;
      for (const s of skaters) {
        if (s.downT > 0 || s.leaving || steeredByContest(state, s) || blocked.includes(s.id) || isTiedUp(state, s.id)) continue;
        const d = dist(s.pos, p.pos);
        if (d <= bestD) { bestD = d; best = s; }
      }
    }
    if (!best) return;
    state.pendingPass = null;
    state.carrierId = best.id;
    state.lastTouch = { id: best.id, side: best.side };
    recordTouch(state, best.id, best.side);
    state.possession = best.side;
    carryPuck(best);
  }

  function liveTick(): void {
    const prevPuckX = state.puck.pos.x;
    if (state.pickupBlock !== null && state.tick >= state.pickupBlock.untilTick) state.pickupBlock = null;
    if (state.pendingPass !== null && state.tick >= state.pendingPass.untilTick) state.pendingPass = null;
    benchTick(state, setup, DT, events);
    assignJobs(state, defs, tactics);
    brainTick(state, defs, rng, events);
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
      } else {
        state.carrierId = null;
        tryBlock(state, defs, rng, events);
        prevPuck.x = state.puck.pos.x;
        prevPuck.y = state.puck.pos.y;
        const puckEvents = stepPuck(state.puck, DT);
        let onNet: Extract<PuckEvent, { kind: 'onNet' }> | null = null;
        for (const ev of puckEvents) if (ev.kind === 'onNet') onNet = ev;
        if (onNet) resolveOnNet(state, onNet, defs, rng, events);
        else {
          const caught = tryIntercept(state, defs, rng, prevPuck);
          if (caught) {
            events.push(caught.event);
            if (caught.taker) carryPuck(caught.taker);
            else tryPickup(skaters, prevPuck);
          } else tryPickup(skaters, prevPuck);
          trackShot(state, puckEvents, events);
        }
      }
    }
    const call = refereeTick(state, prevPuckX, defs);
    if (call) events.push(call);
    const turnover = confirmTurnover(state);
    if (turnover) events.push(turnover);

    for (const s of skaters) s.toiTicks++;
    const liveTicks = Math.round((PERIOD_SECONDS - state.clock) / DT) + 1;
    state.clock = Math.max(0, (PERIOD_TICKS - liveTicks) * DT);

    if (liveTicks >= PERIOD_TICKS) {
      events.push(gameEvent(state, { type: 'periodEnd', side: null, playerId: null, otherId: null, pos: state.puck.pos, detail: { period: state.period } }));
      state.carrierId = null;
      state.possession = null;
      state.pickupBlock = null;
      state.pendingPass = null;
      state.shotInFlight = null;
      state.lastRelease = null;
      state.tiedUpUntil = [];
      state.reboundEdge = null;
      state.turnoverWatch = null;
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
