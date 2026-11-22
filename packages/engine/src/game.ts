import { benchTick } from './bench';
import { resolveBodies } from './bodies';
import { brainTick } from './brain';
import { DT, PERIOD_SECONDS, PERIODS } from './constants';
import { contestTick } from './contests/core';
import { dropPuck, FACEOFF_SETUP_SECONDS, headForLineup, setupFaceoff, snapToLineup } from './faceoff';
import { goalieTick } from './goalie';
import { stepPuck } from './puck';
import { refereeTick } from './referee';
import { FACEOFF_DOTS, RINK, resolveBoards } from './rink';
import { createRng } from './rng';
import { movementOf, stepSkater, type Movement } from './skating';
import { standInPlay } from './stand-in';
import { buildResult } from './stats';
import { assignJobs } from './team-play';
import type {
  GameEvent, GameResult, GameSetup, GameState, GoalieState, PlayerDef, Position, Side, SkaterState, Tactics,
} from './types';
import { validateSetup } from './validate';
import { dist, hypot2 } from './vec';

export type Game = {
  readonly state: GameState;
  readonly done: boolean;
  step(): void;
  /** Events emitted since the last drain; clears that buffer. */
  drainEvents(): GameEvent[];
  result(): GameResult;
};

const SIDES = ['home', 'away'] as const;
const PERIOD_TICKS = Math.round(PERIOD_SECONDS / DT);
const STOPPED_SECONDS = 1.5;
const PICKUP_RADIUS = 0.9;
const PICKUP_MAX_SPEED = 12;
/** After a release (draw, shot), the releasing players cannot pick the puck up again for this long. */
const RELEASE_NO_PICKUP_SECONDS = 0.3;
/** How far ahead of the carrier's centre, along his facing, the puck sits. */
const CARRY_REACH = 0.6;
const PUCK_RADIUS = 0.05;
const EPS = 1e-9;
/** Scratch velocity for clamping the carried puck (its velocity is the carrier's, not bounced). */
const noVel = { x: 0, y: 0 };
/** Where off-ice skaters wait. */
const BENCH: Record<Side, { x: number; y: number }> = { home: { x: -7, y: -12.2 }, away: { x: 7, y: -12.2 } };

const homeDirFor = (period: number): 1 | -1 => (period % 2 === 1 ? 1 : -1);

function goalieAt(id: string, dir: 1 | -1): GoalieState {
  return { id, pos: { x: -dir * (RINK.goalLineX - 0.6), y: 0 }, facing: dir === 1 ? 0 : Math.PI, pose: 'stance', poseT: 0 };
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
      const b = BENCH[side];
      skaters.push({
        id: p.id, side, slot, pos: { x: b.x, y: b.y }, vel: { x: 0, y: 0 }, facing: 0, target: { x: b.x, y: b.y },
        faceTarget: null, speedCap: 1, energy: 1, onIce: slot !== null, leaving: false, downT: 0, contestId: null, shiftStart: 0,
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
    contests: [], score: { home: 0, away: 0 }, faceoffSpot: { x: 0, y: 0 }, onIce,
  };
}

/** Teams take their ends for `period` and line up for the centre-ice draw. */
function startPeriod(state: GameState, period: number): void {
  const dir = homeDirFor(period);
  state.period = period;
  state.clock = PERIOD_SECONDS;
  state.attackDir = { home: dir, away: dir === 1 ? -1 : 1 };
  state.goalies.home = goalieAt(state.goalies.home.id, dir);
  state.goalies.away = goalieAt(state.goalies.away.id, state.attackDir.away);
  state.lastTouch = null;
  setupFaceoff(state, FACEOFF_DOTS.centre);
  snapToLineup(state);
}

export function createGame(setup: GameSetup): Game {
  validateSetup(setup);
  const rng = createRng(setup.seed);
  const defs = new Map<string, PlayerDef>();
  for (const side of SIDES) for (const p of setup[side].players) defs.set(p.id, p);
  const tactics: Record<Side, Tactics> = { home: setup.home.tactics, away: setup.away.tactics };
  const events: GameEvent[] = [];
  let drained = 0;
  /** Players who just released the puck and may not pick it up before tick `until`. */
  let noPickup: { ids: string[]; until: number } = { ids: [], until: 0 };

  const state = initialState(setup);
  startPeriod(state, 1);

  // Per-skater bookkeeping, parallel to state.skaters (whose order never changes).
  // Movement is rebuilt only when the skater's energy changes.
  const bodies = state.skaters.map((sk) => ({ def: defs.get(sk.id)!, energy: sk.energy, move: movementOf(defs.get(sk.id)!, sk.energy), toi: 0 }));
  const bodyById = new Map(state.skaters.map((sk, i) => [sk.id, bodies[i]!]));
  const move = (id: string): Movement => bodyById.get(id)!.move;
  /** On-ice skaters, refilled in place each tick. */
  const onIceList: SkaterState[] = [];
  const onIceSkaters = (): SkaterState[] => {
    onIceList.length = 0;
    const all = state.skaters;
    for (let i = 0; i < all.length; i++) {
      const sk = all[i]!;
      if (!sk.onIce) continue;
      onIceList.push(sk);
      const b = bodies[i]!;
      if (b.energy !== sk.energy) { b.energy = sk.energy; b.move = movementOf(b.def, sk.energy); }
    }
    return onIceList;
  };
  const toiMap = (): Map<string, number> => {
    const m = new Map<string, number>();
    state.skaters.forEach((sk, i) => { if (bodies[i]!.toi > 0) m.set(sk.id, bodies[i]!.toi); });
    return m;
  };

  const emit = (e: Omit<GameEvent, 'tick' | 'period' | 'clock'>): void => {
    events.push({ tick: state.tick, period: state.period, clock: state.clock, ...e });
  };
  const blockPickup = (ids: string[]): void => {
    noPickup = { ids, until: state.tick + Math.round(RELEASE_NO_PICKUP_SECONDS / DT) };
  };

  /** Movement, body separation and boards for every on-ice skater. */
  function moveSkaters(skaters: SkaterState[]): void {
    stepSkaters(skaters);
    resolveBodies(skaters, move);
    for (const s of skaters) resolveBoards(s.pos, s.vel, move(s.id).radius, 0);
  }

  function stepSkaters(skaters: SkaterState[]): void {
    for (const s of skaters) {
      if (s.downT > 0) s.downT = Math.max(0, s.downT - DT);
      stepSkater(s, move(s.id), DT);
    }
  }

  function carryPuck(carrier: SkaterState): void {
    const p = state.puck;
    p.pos.x = carrier.pos.x + Math.cos(carrier.facing) * CARRY_REACH;
    p.pos.y = carrier.pos.y + Math.sin(carrier.facing) * CARRY_REACH;
    p.vel.x = carrier.vel.x;
    p.vel.y = carrier.vel.y;
    p.z = 0;
    p.vz = 0;
    noVel.x = 0;
    noVel.y = 0;
    resolveBoards(p.pos, noVel, PUCK_RADIUS, 0);
  }

  function tryPickup(skaters: SkaterState[]): void {
    const p = state.puck;
    if (hypot2(p.vel.x, p.vel.y) >= PICKUP_MAX_SPEED) return;
    const blocked = state.tick < noPickup.until ? noPickup.ids : [];
    let best: SkaterState | null = null;
    let bestD = PICKUP_RADIUS;
    for (const s of skaters) {
      if (s.downT > 0 || blocked.includes(s.id)) continue;
      const d = dist(s.pos, p.pos);
      if (d <= bestD) { bestD = d; best = s; }
    }
    if (!best) return;
    state.carrierId = best.id;
    state.lastTouch = { id: best.id, side: best.side };
    state.possession = best.side;
    carryPuck(best);
  }

  function stopPlay(): void {
    state.phase = 'stopped';
    state.phaseT = 0;
    state.carrierId = null;
    state.possession = null;
    state.faceoffSpot = { ...FACEOFF_DOTS.centre };
    headForLineup(state);
  }

  function liveTick(): void {
    const prevPuckX = state.puck.pos.x;
    benchTick(state, setup, rng, DT);
    assignJobs(state, defs, tactics);
    brainTick(state, defs, rng);
    const shooter = standInPlay(state, rng);
    if (shooter !== null) blockPickup([shooter]);
    contestTick(state, defs, rng, DT);

    const skaters = onIceSkaters();
    moveSkaters(skaters);
    goalieTick(state, defs, rng, DT);

    let carrier: SkaterState | null = null;
    if (state.carrierId !== null) for (const sk of skaters) if (sk.id === state.carrierId) { carrier = sk; break; }
    let onNet = false;
    if (carrier) {
      carryPuck(carrier);
    } else {
      state.carrierId = null;
      for (const ev of stepPuck(state.puck, DT)) if (ev.kind === 'onNet') onNet = true;
      // Task 7 turns onNet into a save or a goal; until then it is a whistle with a centre-ice draw.
      if (!onNet) tryPickup(skaters);
    }
    const call = refereeTick(state, prevPuckX);
    if (call) events.push(call);

    for (const sk of skaters) bodyById.get(sk.id)!.toi += DT;
    const liveTicks = Math.round((PERIOD_SECONDS - state.clock) / DT) + 1;
    state.clock = Math.max(0, (PERIOD_TICKS - liveTicks) * DT);

    if (liveTicks >= PERIOD_TICKS) {
      emit({ type: 'periodEnd', side: 'home', playerId: null, otherId: null, assistIds: [], detail: `period ${state.period}` });
      state.carrierId = null;
      state.possession = null;
      state.phase = state.period >= PERIODS ? 'final' : 'intermission';
      state.phaseT = 0;
    } else if (onNet && state.phase === 'live') {
      stopPlay();
    }
  }

  function step(): void {
    if (state.phase === 'final') return;
    state.tick++;
    state.phaseT += DT;
    switch (state.phase) {
      case 'live':
        liveTick();
        break;
      case 'stopped':
        moveSkaters(onIceSkaters());
        if (state.phaseT >= STOPPED_SECONDS - EPS) setupFaceoff(state, state.faceoffSpot);
        break;
      case 'faceoffSetup':
        moveSkaters(onIceSkaters());
        if (state.phaseT >= FACEOFF_SETUP_SECONDS - EPS) {
          const e = dropPuck(state, defs, rng);
          events.push(e);
          const ids = [e.playerId, e.otherId].filter((id): id is string => id !== null);
          blockPickup(ids);
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
