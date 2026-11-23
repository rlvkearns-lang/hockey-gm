import { generateTeam } from '../src/roster-gen';
import { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from '../src/attributes';
import { DT, PERIOD_SECONDS } from '../src/constants';
import { drainEnergy, recoverEnergy } from '../src/bench';
import { stepPuck } from '../src/puck';
import type { Puck, PuckEvent } from '../src/puck';
import type { ContestState, ContestStateOf, GameEvent, GameEventOf, GameEventType, GameResult, GameSetup, GameState, PlayerDef, Side, SkaterState, Tactics, TeamDef } from '../src/types';
import { PLAYER_TYPES } from '../src/player-types';
import { RINK, resolveBoards } from '../src/rink';
import { createRng, type Rng } from '../src/rng';
import { OZONE_SPOTS, ozoneSpotPos, supportTarget } from '../src/team-play';
import { canReceivePass, decideCarrier, type Decision } from '../src/brain';
import { executeDump, executePass, recordTouch, releasePuck, tryIntercept } from '../src/actions';
import { resolveBodies } from '../src/bodies';
import { contestTick, startContest } from '../src/contests/core';
import { hitContest } from '../src/contests/hit';
import { pokeCheckContest } from '../src/contests/poke-check';
import { boardBattleContest } from '../src/contests/board-battle';
import { netFrontContest } from '../src/contests/net-front';
import { looseRaceContest, timeToReach } from '../src/contests/loose-race';
import { assignJobs } from '../src/team-play';
import { createGame, type Game } from '../src/game';
import { resolveOnNet, tryBlock } from '../src/goalie';
import { movementOf, stepSkater } from '../src/skating';
import { refereeTick } from '../src/referee';
import type { Movement } from '../src/skating';
import { availableParallelism } from 'node:os';
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';

export const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Mean of every skater attribute across the team's skaters. */
export function teamMean(team: TeamDef): number {
  const skaters = team.players.filter((p) => p.position !== 'G');
  return avg(skaters.flatMap((p) => SKATER_ATTRS.map((k) => p.attrs[k])));
}

/** A fresh valid GameSetup from two generated teams. */
export function validSetup(): GameSetup {
  return {
    home: generateTeam(1, 'Harbour City', 'HBR'),
    away: generateTeam(2, 'Northern Peaks', 'NPK'),
    seed: 42,
    chemistry: [],
  };
}

export function puckAt(x: number, y: number, vx: number, vy: number, z = 0, vz = 0): Puck {
  return { pos: { x, y }, z, vel: { x: vx, y: vy }, vz };
}

/** Step the puck with DT for the given number of simulated seconds. */
export function run(puck: Puck, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepPuck(puck, DT);
}

/** Step until the first non-boards event; throws after 5 s of sim time. */
export function runUntilEvent(puck: Puck): PuckEvent & Partial<{ y: number; z: number; speed: number }> {
  const n = Math.round(5 / DT);
  for (let i = 0; i < n; i++) {
    for (const ev of stepPuck(puck, DT)) if (ev.kind !== 'boards') return ev;
  }
  throw new Error('no puck event within 5 s');
}

// ---- skating helpers ----

/** A PlayerDef with every attribute 70, overridable (attrs partially, top-level fields directly). */
export function def(overrides: Partial<Omit<PlayerDef, 'attrs'>> & { [K in keyof SkaterAttrs]?: number } = {}): PlayerDef {
  const attrs = {} as SkaterAttrs;
  for (const k of SKATER_ATTRS) attrs[k] = 70;
  const top: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if ((SKATER_ATTRS as readonly string[]).includes(k)) (attrs as Record<string, number>)[k] = v as number;
    else top[k] = v;
  }
  return {
    id: 'p', name: 'P', number: 1, position: 'C', shoots: 'L', heightCm: 185, weightKg: 85,
    type: 'balanced', subType: null, attrs, goalie: null,
    tendencies: { shoot: 0.5, pass: 0.5, carry: 0.5, dump: 0.5, hit: 0.5, forecheck: 0.5, netFront: 0.5, joinRush: 0.5 },
    form: 0, morale: 0, fatigue: 0,
    ...top,
  };
}

let skaterSeq = 0;
/** A stationary skater at (x, y) facing +x, full effort, fresh. */
export function at(x: number, y: number): SkaterState {
  return {
    id: `s${skaterSeq++}`, side: 'home', slot: null, pos: { x, y }, vel: { x: 0, y: 0 }, facing: 0,
    target: { x, y }, faceTarget: null, mode: 'forward', speedCap: 1, energy: 1, onIce: true, leaving: false,
    downT: 0, contestId: null, shiftStart: 0, toiTicks: 0,
  };
}

/** A skater at the origin moving (vx, vy), facing his travel direction. */
export function movingAt(vx: number, vy: number): SkaterState {
  const s = at(0, 0);
  s.vel = { x: vx, y: vy };
  s.facing = Math.atan2(vy, vx);
  return s;
}

export function stepFor(s: SkaterState, seconds: number, m: Movement = movementOf(def({}), 1)): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepSkater(s, m, DT);
}

/** Straight-line top-effort speed after `seconds` from rest. */
export function speedAfter(d: PlayerDef, seconds: number): number {
  const s = at(-29, 0);
  s.target = { x: 1000, y: 0 };
  stepFor(s, seconds, movementOf(d, 1));
  return Math.hypot(s.vel.x, s.vel.y);
}

/** Speed skating backward (facing +x, retreating toward -x) after `seconds` from rest. */
export function backwardSpeedAfter(seconds: number): number {
  const s = at(5, 0);
  s.target = { x: -1000, y: 0 };
  s.faceTarget = { x: 1000, y: 0 };
  stepFor(s, seconds, movementOf(def({}), 1));
  return Math.hypot(s.vel.x, s.vel.y);
}

/** A Movement for a player of the given weight. */
export function mv(weightKg: number): Movement {
  return movementOf(def({ weightKg }), 1);
}

// ---- game helpers ----

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** The two generated teams game tests play with (HBR v NGT). */
export function gameSetup(seed = 1): GameSetup {
  return { home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northgate', 'NGT'), seed, chemistry: [] };
}

/** Filter for result player lines: skaters (not goalies) of the given side in `setup` (default gameSetup()). */
export function isSkaterOf(side: Side, setup: GameSetup = gameSetup()): (p: { id: string }) => boolean {
  const ids = new Set(setup[side].players.filter((p) => p.position !== 'G').map((p) => p.id));
  return (p) => ids.has(p.id);
}

/** Step until the game is in period n (or over). */
export function runToPeriod(game: Game, n: number): void {
  while (!game.done && game.state.period < n) game.step();
}

// ---- team play and brain helpers ----

const SKATER_SLOTS = ['LW', 'C', 'RW', 'LD', 'RD'] as const;
type SkaterSlot = (typeof SKATER_SLOTS)[number];
/** Where stateWith puts each non-carrier, relative to the puck: metres back toward his own net, and to his left. */
const FORMATION: Record<SkaterSlot, { back: number; left: number }> = {
  C: { back: 1.5, left: 0 }, LW: { back: 2, left: 6 }, RW: { back: 2, left: -6 }, LD: { back: 6, left: 3 }, RD: { back: 6, left: -3 },
};

const skaterId = (side: Side, slot: SkaterSlot): string => `${side}-${slot}`;

/** Every attribute 70 for the ten skaters stateWith puts on the ice, keyed by id. */
export const defs: Map<string, PlayerDef> = new Map(
  (['home', 'away'] as const).flatMap((side) => SKATER_SLOTS.map((slot) => {
    const id = skaterId(side, slot);
    return [id, def({ id, position: slot })] as [string, PlayerDef];
  })),
);

export const tactics: Record<Side, Tactics> = {
  home: { forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 50 } },
  away: { forecheck: 'balanced', shiftSeconds: { forwards: 45, defence: 50 } },
};

/**
 * A live period-1 state (home attacks +x) with five skaters a side around a puck at (puckX, puckY).
 * The carrier (default his team's RW) holds the puck facing his attack direction; everyone else stands in a
 * loose formation between the puck and his own net, still, facing up ice.
 */
export function stateWith(o: { carrier: Side | null; puckX: number; puckY?: number; carrierSlot?: SkaterSlot }): GameState {
  const puckY = o.puckY ?? 0;
  const carrierSlot = o.carrierSlot ?? 'RW';
  const attackDir = { home: 1 as const, away: -1 as const };
  const skaters: SkaterState[] = [];
  for (const side of ['home', 'away'] as const) {
    const dir = attackDir[side];
    for (const slot of SKATER_SLOTS) {
      const carrying = o.carrier === side && slot === carrierSlot;
      const f = FORMATION[slot];
      const pos = carrying ? { x: o.puckX - dir * 0.6, y: puckY } : { x: o.puckX - dir * f.back, y: puckY + dir * f.left };
      resolveBoards(pos, { x: 0, y: 0 }, 0.5, 0);
      skaters.push({
        id: skaterId(side, slot), side, slot, pos, vel: { x: 0, y: 0 }, facing: dir === 1 ? 0 : Math.PI,
        target: { x: pos.x, y: pos.y }, faceTarget: null, mode: 'forward', speedCap: 1, energy: 1, onIce: true, leaving: false,
        downT: 0, contestId: null, shiftStart: 0, toiTicks: 0,
      });
    }
  }
  const carrierId = o.carrier === null ? null : skaterId(o.carrier, carrierSlot);
  return {
    tick: 0, period: 1, clock: 1200, phase: 'live', phaseT: 0, attackDir,
    puck: { pos: { x: o.puckX, y: puckY }, z: 0, vel: { x: 0, y: 0 }, vz: 0 },
    carrierId, lastTouch: o.carrier === null ? null : { id: carrierId!, side: o.carrier }, possession: o.carrier, skaters,
    goalies: {
      home: { id: 'home-G', pos: { x: -26.5, y: 0 }, vel: { x: 0, y: 0 }, facing: 0, pose: 'stance', poseT: 0 },
      away: { id: 'away-G', pos: { x: 26.5, y: 0 }, vel: { x: 0, y: 0 }, facing: Math.PI, pose: 'stance', poseT: 0 },
    },
    contests: [], score: { home: 0, away: 0 }, faceoffSpot: { x: 0, y: 0 },
    onIce: { home: SKATER_SLOTS.map((s) => skaterId('home', s)), away: SKATER_SLOTS.map((s) => skaterId('away', s)) },
    pickupBlock: null, pendingPass: null, shotInFlight: null, teamJump: { home: 0, away: 0 }, goalieNight: { home: 0, away: 0 }, screenedUntilTick: { home: 0, away: 0 },
    touches: { side: null, ids: [], ticks: [] }, lastAttackTouch: { home: null, away: null },
    noChange: null, delayedOffside: null, icingWatch: null, lastRelease: null, contestCooldowns: [],
    tiedUpUntil: [], reboundEdge: null, turnoverWatch: null,
    bench: {
      home: { forwards: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0, 0] }, defence: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0] } },
      away: { forwards: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0, 0] }, defence: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0] } },
    },
    seed: 1, rng: [1, 2, 3, 4],
  };
}

export function skater(state: GameState, side: Side, slot: SkaterSlot): SkaterState {
  const s = state.skaters.find((k) => k.onIce && k.side === side && k.slot === slot);
  if (!s) throw new Error(`no ${side} ${slot} on the ice`);
  return s;
}

export const onIce = (state: GameState, side: Side): SkaterState[] => state.skaters.filter((s) => s.onIce && s.side === side);

/** Which offensive-zone spot (corner, netFront, highSlot, point) the skater's target is nearest to. */
export function spotName(state: GameState, side: Side, slot: SkaterSlot): string {
  const t = skater(state, side, slot).target;
  let best = '', bestD = Infinity;
  for (const spot of OZONE_SPOTS) {
    const p = ozoneSpotPos(state, side, spot, { x: 0, y: 0 });
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestD) { bestD = d; best = spot === 'leftPoint' || spot === 'rightPoint' ? 'point' : spot; }
  }
  return best;
}

/** A shoot-first winger: Sniper tendencies and shooting attributes. */
export const sniper: PlayerDef = def({
  type: 'Sniper', tendencies: PLAYER_TYPES.Sniper!.tendencies, shootingAccuracy: 90, shootingPower: 85, passing: 62, vision: 60,
});
/** A pass-first centre: Playmaker tendencies and passing attributes. */
export const playmaker: PlayerDef = def({
  type: 'Playmaker', tendencies: PLAYER_TYPES.Playmaker!.tendencies, shootingAccuracy: 62, shootingPower: 60, passing: 90, vision: 90,
});

/**
 * Home C with the puck in the slot (about 8 m out), teammates in the corner, at the net and on the points,
 * defenders around the net and covering the points; the nearest defender about 5 m away.
 */
export const slotState: GameState = (() => {
  const st = stateWith({ carrier: 'home', puckX: 19.6, puckY: 1, carrierSlot: 'C' });
  const put = (side: Side, slot: SkaterSlot, x: number, y: number): void => { const s = skater(st, side, slot); s.pos = { x, y }; s.target = { x, y }; };
  put('home', 'LW', 24, 7); put('home', 'RW', 24.5, -1); put('home', 'LD', 9, 8); put('home', 'RD', 9, -8);
  put('away', 'LD', 23.5, -1.5); put('away', 'RD', 22, 6); put('away', 'C', 21, -4); put('away', 'LW', 11, 7); put('away', 'RW', 11, -7);
  return st;
})();

/** Share of `kind` among 2,000 decideCarrier draws (seeds 1..2000) with `d` as the carrier in `state`. */
export function rate(kind: Decision['kind'], d: PlayerDef, state: GameState): number {
  const id = state.carrierId!;
  const carrier = state.skaters.find((s) => s.id === id)!;
  const me = { ...d, id, position: carrier.slot ?? d.position };
  const ds = new Map(defs);
  ds.set(id, me);
  let n = 0;
  for (let seed = 1; seed <= 2000; seed++) if (decideCarrier(state, me, ds, createRng(seed)).kind === kind) n++;
  return n / 2000;
}

/**
 * Mean lateral miss (m) at the receiver of 400 passes (seeds 1..400) by `d` to a still teammate 15 m away,
 * with no opponent near either of them.
 */
export function meanMiss(d: PlayerDef): number {
  let total = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const st = stateWith({ carrier: 'home', puckX: -5, carrierSlot: 'C' });
    for (const s of onIce(st, 'away')) { s.pos = { x: 25, y: s.pos.y }; s.target = { ...s.pos }; }
    const receiver = skater(st, 'home', 'LW');
    receiver.pos = { x: st.puck.pos.x + 15, y: 0 };
    const ds = new Map(defs);
    ds.set('home-C', { ...d, id: 'home-C', position: 'C' });
    const from = { ...st.puck.pos };
    executePass(st, 'home-C', receiver.id, ds, createRng(seed));
    const v = st.puck.vel, sp = Math.hypot(v.x, v.y);
    const rx = receiver.pos.x - from.x, ry = receiver.pos.y - from.y;
    total += Math.abs(rx * v.y - ry * v.x) / sp; // distance from the receiver to the puck's line
  }
  return total / 400;
}

// ---- goalie helpers ----

/** GoalieAttrs with every attribute at `rating`. */
export function g(rating: number): GoalieAttrs {
  const a = {} as GoalieAttrs;
  for (const k of GOALIE_ATTRS) a[k] = rating;
  return a;
}

/** The game tests' setup (HBR v NGT) with the given seed. */
export const setup = (seed = 1): GameSetup => gameSetup(seed);

/** Fraction of `n` calls of `fn` that return true. */
export function share(n: number, fn: () => boolean): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (fn()) k++;
  return k / n;
}

/** Events of `type` in the result, optionally only those with the given side. */
export function count(r: GameResult, type: GameEventType, side?: Side): number {
  return r.events.filter((e) => e.type === type && (side === undefined || e.side === side)).length;
}

/** Steps a game until its first goal event and returns the result so far; throws if the game ends without one. */
export function simulateUntilFirstGoal(s: GameSetup): GameResult {
  const game = createGame(s);
  while (!game.done) {
    game.step();
    if (game.drainEvents().some((e) => e.type === 'goal')) return game.result();
  }
  throw new Error('no goal in the whole game');
}

let blockSeed = 0;
/**
 * One tryBlock roll: a home shot at 30 m/s along +x from (15, 0), with `d` as the only away skater on the ice,
 * standing on the puck's path 1 m ahead (1.6 m from the shooter). Each call uses a fresh seed.
 */
export function blockAttempt(d: PlayerDef): boolean {
  const st = stateWith({ carrier: 'home', puckX: 15 });
  const shooter = skater(st, 'home', 'RW');
  st.carrierId = null;
  st.puck.vel = { x: 30, y: 0 };
  st.shotInFlight = { shooterId: shooter.id, side: 'home', from: { x: 15, y: 0 }, fromDist: 12.13, tick: 0, blockTried: [] };
  const blocker = skater(st, 'away', 'LD');
  for (const s of onIce(st, 'away')) if (s !== blocker) s.onIce = false;
  blocker.pos = { x: 16, y: 0 };
  const ds = new Map(defs);
  ds.set(blocker.id, { ...d, id: blocker.id, position: 'LD' });
  return tryBlock(st, ds, createRng(++blockSeed));
}

// ---- referee helpers ----
//
// A referee harness: a stateWith() state stepped tick by tick with the real skating and puck physics and the real
// refereeTick. Skaters skate to their targets (nobody runs a brain or team play), a carrier carries the puck in front
// of him, a loose puck slides; nobody picks a loose puck up. Each state's referee calls are kept in a log.

type PlayerRef = `${Side}:${SkaterSlot}`;

const calls = new WeakMap<GameState, GameEvent[]>();
const callsOf = (st: GameState): GameEvent[] => { let c = calls.get(st); if (!c) { c = []; calls.set(st, c); } return c; };
const byRef = (st: GameState, ref: PlayerRef): SkaterState => { const [side, slot] = ref.split(':') as [Side, SkaterSlot]; return skater(st, side, slot); };
const harnessMoves = new Map<string, Movement>([...defs].map(([id, d]) => [id, movementOf(d, 1)]));

/** One tick of the referee harness. */
function refereeStep(st: GameState): void {
  const prevX = st.puck.pos.x;
  st.tick++;
  let carrier: SkaterState | null = null;
  for (const s of st.skaters) {
    if (!s.onIce) continue;
    stepSkater(s, harnessMoves.get(s.id)!, DT);
    if (s.id === st.carrierId) carrier = s;
  }
  const p = st.puck;
  if (carrier) {
    p.pos.x = carrier.pos.x + Math.cos(carrier.facing) * 0.6;
    p.pos.y = carrier.pos.y + Math.sin(carrier.facing) * 0.6;
    p.vel.x = carrier.vel.x; p.vel.y = carrier.vel.y;
  } else stepPuck(p, DT);
  const call = refereeTick(st, prevX, defs);
  if (call) callsOf(st).push(call);
}

/** A live period-1 state (home attacks +x): `carrier` (e.g. 'home:C') holds the puck with his body at x = carrierX. */
export function live(o: { carrier: PlayerRef; carrierX: number }): GameState {
  const [side, slot] = o.carrier.split(':') as [Side, SkaterSlot];
  const dir = side === 'home' ? 1 : -1;
  const st = stateWith({ carrier: side, puckX: o.carrierX + dir * 0.6, carrierSlot: slot });
  callsOf(st);
  return st;
}

/** Put a skater, still, at (x, y). */
export function place(st: GameState, ref: PlayerRef, x: number, y: number): void {
  const s = byRef(st, ref);
  s.pos = { x, y }; s.target = { x, y }; s.vel = { x: 0, y: 0 };
}

/** The carrier skates straight up ice (refereed every tick) until the puck is at x; then he lets up. */
export function carryTo(st: GameState, x: number): void {
  const c = st.skaters.find((s) => s.id === st.carrierId)!;
  const dir = st.attackDir[c.side];
  c.target = { x: dir * 40, y: c.pos.y };
  for (let i = 0; i < 300 && st.puck.pos.x * dir < x * dir && st.phase === 'live'; i++) refereeStep(st);
  c.target = { x: c.pos.x, y: c.pos.y };
}

/**
 * The first offside or icing call on this state: one already made (during carryTo or a set-up), else the first in
 * up to `ticks` more refereed ticks (stopping once play is stopped). Null if there is none.
 */
export function refereeUntilCall(st: GameState, ticks = 150): GameEvent | null {
  const log = callsOf(st);
  for (let i = 0; i < ticks && log.length === 0 && st.phase === 'live'; i++) refereeStep(st);
  return log[0] ?? null;
}

/** The home left winger, waiting wholly inside the offensive zone. */
export const offsideWinger = (): { ref: PlayerRef; x: number; y: number } => ({ ref: 'home:LW', x: 12, y: 7 });

/**
 * Home C dumps the puck in from the neutral zone (x 3) with `w` standing in the zone; refereed until the puck is fully
 * over the blue line (so the delayed offside is on).
 */
export function dumpedInWith(w: { ref: PlayerRef; x: number; y: number }): GameState {
  const st = live({ carrier: 'home:C', carrierX: 3 });
  place(st, w.ref, w.x, w.y);
  executeDump(st, st.carrierId!, defs, createRng(3));
  for (let i = 0; i < 60 && st.puck.pos.x < RINK.blueLineX + 0.05; i++) refereeStep(st);
  return st;
}

/** The skater heads straight back out over the blue line (to 3 m outside it). */
export function moveOut(st: GameState, ref: PlayerRef): void {
  const s = byRef(st, ref);
  const dir = st.attackDir[s.side];
  s.target = { x: dir * (RINK.blueLineX - 3), y: s.pos.y };
  s.faceTarget = null;
  s.speedCap = 1;
}

/** The carrier dumps the puck down the ice (the real executeDump). */
export function shootDownIce(st: GameState): void {
  executeDump(st, st.carrierId!, defs, createRng(1));
}

/**
 * Home LD fires the puck from x at 25 m/s toward the far goal line: at the middle of the net (`onNet`) or 6 m wide of it.
 * Everyone else stands in stateWith's formation.
 */
export function shotFrom(x: number, o: { onNet?: boolean } = {}): GameState {
  const st = live({ carrier: 'home:LD', carrierX: x });
  const p = st.puck.pos;
  const tx = RINK.goalLineX, ty = o.onNet ? 0 : 6;
  const l = Math.hypot(tx - p.x, ty - p.y);
  releasePuck(st, st.carrierId!, ((tx - p.x) / l) * 25, ((ty - p.y) / l) * 25, 0);
  return st;
}

/**
 * The icing call (or null) as the shot in `st` plays out. With `attackerAhead`, a home forward is already racing
 * for the puck deep in the zone (at x 19, skating for the end boards) when it goes.
 */
export function icingAfter(st: GameState, o: { attackerAhead?: boolean } = {}): GameEvent | null {
  if (o.attackerAhead) {
    place(st, 'home:LW', 19, 6);
    const lw = byRef(st, 'home:LW');
    lw.vel = { x: 7, y: 0 }; lw.facing = 0; lw.target = { x: 28, y: 6 };
  }
  const call = refereeUntilCall(st);
  return call !== null && call.type === 'icing' ? call : null;
}

// ---- bench helpers ----

/** Energy of `d` after `seconds` of skating flat out from fresh (effort 1 every tick). */
export function energyAfterShift(d: PlayerDef, seconds: number): number {
  let e = 1;
  for (let i = Math.round(seconds / DT); i > 0; i--) e = drainEnergy(e, d.attrs.stamina, 1, DT);
  return e;
}

/** Energy after `seconds` on the bench from `energy`. */
export function energyAfterRest(energy: number, seconds: number): number {
  let e = energy;
  for (let i = Math.round(seconds / DT); i > 0; i--) e = recoverEnergy(e, DT);
  return e;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** `lineChange` events of the result, optionally only those of one kind (`onTheFly` or `stoppage`). */
export function lineChangeEvents(r: GameResult, kind?: 'onTheFly' | 'stoppage'): GameEvent[] {
  return r.events.filter((e) => e.type === 'lineChange' && (kind === undefined || e.detail.onTheFly === (kind === 'onTheFly')));
}

/** Game seconds elapsed (clock time) at an event. */
const gameSecondsAt = (e: GameEvent): number => (e.period - 1) * PERIOD_SECONDS + (PERIOD_SECONDS - e.clock);

/**
 * Shift lengths (clock seconds) of both teams' forward lines and defence pairs: the time between one change of a unit
 * and the next (the first from the opening faceoff). The last shift of each unit (ended by the final buzzer) is left out.
 */
export function shiftLengths(r: GameResult): { forwards: number[]; defence: number[] } {
  const out = { forwards: [] as number[], defence: [] as number[] };
  for (const side of ['home', 'away'] as const) {
    for (const unit of ['forwards', 'defence'] as const) {
      let last = 0;
      for (const e of lineChangeEvents(r)) {
        if (e.type !== 'lineChange' || e.side !== side || e.detail.unit !== unit) continue;
        const t = gameSecondsAt(e);
        out[unit].push(t - last);
        last = t;
      }
    }
  }
  return out;
}

const gamesByState = new WeakMap<GameState, Game>();

/**
 * A real game (setup(1), then other seeds) stopped by an icing by `side`, the whistle just blown, neither team in the
 * middle of a change. Both teams' units are made due for a change (their shifts started long ago), so only the
 * icing rule can keep them on. Step it on with runThroughFaceoff.
 */
export function afterIcingBy(side: Side): GameState {
  for (let seed = 1; seed <= 20; seed++) {
    const g = createGame(setup(seed));
    while (!g.done) {
      g.step();
      const icing = g.drainEvents().find((e) => e.type === 'icing' && e.side === side);
      if (!icing || g.state.skaters.some((s) => s.leaving)) continue;
      for (const t of ['home', 'away'] as const) for (const u of ['forwards', 'defence'] as const) g.state.bench[t][u].shiftStart -= 1000;
      gamesByState.set(g.state, g);
      return g.state;
    }
  }
  throw new Error(`no clean icing by ${side} in seeds 1-20`);
}

/** Steps the game behind `st` (from afterIcingBy) until the puck has been dropped. */
export function runThroughFaceoff(st: GameState): void {
  const g = gamesByState.get(st);
  if (!g) throw new Error('not a state from afterIcingBy');
  for (let i = 0; i < 30 * 20 && st.phase !== 'live'; i++) g.step();
  if (st.phase !== 'live') throw new Error('the puck was not dropped within 20 s');
}

// ---- contest helpers ----
//
// A contest harness: a stateWith() state with only the home C (carrying the puck at x -0.6, facing +x) and the away C
// on the ice, stepped tick by tick with the real contestTick, skating and body contact. A carrier carries the puck in
// front of him; nobody runs a brain or team play, so nobody passes or picks a loose puck up. Each call gets a new seed.

/** Every attribute 70. */
export const d: PlayerDef = def();

/** A fresh skater (see `at`) with the given fields overridden. */
export function st(o: Partial<SkaterState>): SkaterState {
  return { ...at(0, 0), ...o };
}

type Duel = { st: GameState; ds: Map<string, PlayerDef>; rng: Rng; events: GameEvent[]; moves: Map<string, Movement> };
const duels = new WeakMap<GameState, Duel>();
const contestDuel = new WeakMap<ContestState, Duel>();
let duelSeed = 0;

/** Home C (carrier, `carrierDef`) at x -0.6 facing +x; away C (`otherDef`) at (x, 0) moving (vx, 0); nobody else on. */
function duel(otherDef: PlayerDef, carrierDef: PlayerDef, x: number, vx: number): Duel {
  const state = stateWith({ carrier: 'home', puckX: 0, carrierSlot: 'C' });
  for (const s of state.skaters) if (s.slot !== 'C') s.onIce = false;
  state.onIce = { home: ['home-C'], away: ['away-C'] };
  const other = skater(state, 'away', 'C');
  other.pos = { x, y: 0 }; other.target = { x, y: 0 }; other.vel = { x: vx, y: 0 }; other.facing = Math.PI;
  const ds = new Map(defs);
  ds.set('home-C', { ...carrierDef, id: 'home-C', position: 'C' });
  ds.set('away-C', { ...otherDef, id: 'away-C', position: 'C' });
  const moves = new Map([...ds].map(([id, p]) => [id, movementOf(p, 1)]));
  const h: Duel = { st: state, ds, rng: createRng(++duelSeed), events: [], moves };
  duels.set(state, h);
  return h;
}

/** One tick of the contest harness. */
function duelStep(h: Duel): void {
  const s = h.st;
  s.tick++;
  contestTick(s, h.ds, h.rng, DT, h.events);
  const on = s.skaters.filter((k) => k.onIce);
  for (const k of on) { if (k.downT > 0) k.downT = Math.max(0, k.downT - DT); stepSkater(k, h.moves.get(k.id)!, DT); }
  resolveBodies(on, (id) => h.moves.get(id)!);
  const c = on.find((k) => k.id === s.carrierId);
  if (c) {
    s.puck.pos = { x: c.pos.x + Math.cos(c.facing) * 0.6, y: c.pos.y + Math.sin(c.facing) * 0.6 };
    s.puck.vel = { x: c.vel.x, y: c.vel.y };
  } else stepPuck(s.puck, DT);
}

/** Steps the harness until its first contest (already running, or the first to start) has ended (at most 6 s). */
function duelToEnd(h: Duel): void {
  let first: ContestState | null = h.st.contests[0] ?? null;
  for (let i = 0; i < 180; i++) {
    duelStep(h);
    first ??= h.st.contests[0] ?? null;
    if (first !== null && !h.st.contests.includes(first)) return;
  }
  throw new Error('no contest started and finished within 6 s');
}

/** `defender` (away C) standing 1.2 m in front of the still carrier `carrier` (home C), with a poke check started on him (startContest, not the trigger's draw). */
function pokeDuel(defender: PlayerDef, carrier: PlayerDef): Duel {
  const h = duel(defender, carrier, 0.6, 0);
  startContest(h.st, h.ds, h.rng, pokeCheckContest, ['away-C', 'home-C'], h.events);
  return h;
}

/** A poke check by `defender` (standing 1.2 m in front of him) on the still carrier `carrier`: true when the defender wins it. */
export function runPoke(defender: PlayerDef, carrier: PlayerDef): boolean {
  const h = pokeDuel(defender, carrier);
  duelToEnd(h);
  return h.events.some((e) => e.type === 'turnover' && e.playerId === 'away-C');
}

/** The contest state of a poke check one tick after it starts (every attribute 70). */
export function startPoke(): ContestState {
  const h = pokeDuel(d, d);
  duelStep(h);
  const c = h.st.contests[0];
  if (!c) throw new Error('no poke check started');
  contestDuel.set(c, h);
  return c;
}

/** The GameState a contest from startPoke runs in. */
export function stateOf(c: ContestState): GameState {
  return contestDuel.get(c)!.st;
}

/** Ticks until the contest from startPoke is over (no longer in state.contests). */
export function stepsUntilDone(c: ContestState): number {
  const h = contestDuel.get(c)!;
  for (let n = 1; n <= 300; n++) { duelStep(h); if (!h.st.contests.includes(c)) return n; }
  throw new Error('contest still running after 10 s');
}

/** A poke check during which the carrier passes the puck away (to nobody) 0.1 s in, played out. */
export function pokeReleased(): { contests: number; takeaways: number; contestIds: number } {
  const c = startPoke(), h = contestDuel.get(c)!;
  for (let i = 0; i < 3; i++) duelStep(h);
  releasePuck(h.st, 'home-C', -15, 0, 0);
  for (let i = 0; i < 30; i++) duelStep(h);
  return {
    contests: h.st.contests.length,
    takeaways: h.events.filter((e) => e.type === 'takeaway' || e.type === 'turnover').length,
    contestIds: h.st.skaters.filter((k) => k.contestId !== null).length,
  };
}

/**
 * `hitter` (away C) skating at `closing` m/s from 1.5 m in front of the still carrier `tgt`, with the hit already
 * started on him (startContest, not the random trigger).
 */
function hitDuelStart(hitter: PlayerDef, tgt: PlayerDef, closing: number): Duel {
  const h = duel(hitter, tgt, -0.6 + 1.5, -closing);
  startContest(h.st, h.ds, h.rng, hitContest, ['away-C', 'home-C'], h.events);
  return h;
}

/** The hit of hitDuelStart played out; the harness after it. */
function hitDuel(hitter: PlayerDef, tgt: PlayerDef, closing: number): Duel {
  const h = hitDuelStart(hitter, tgt, closing);
  duelToEnd(h);
  return h;
}

/** One hit as in hitDuel: true when it lands (the target goes down). */
export function runHit(hitter: PlayerDef, tgt: PlayerDef, closing: number): boolean {
  return hitDuel(hitter, tgt, closing).events.some((e) => e.type === 'hit' && e.detail.result === 'landed');
}

/** A big hitter's check on a smaller carrier, stopped on the tick it lands (seeds tried in turn). */
export function hitThatLands(): GameState {
  for (let i = 0; i < 50; i++) {
    const h = hitDuelStart(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6);
    for (let k = 0; k < 90; k++) {
      duelStep(h);
      if (h.events.some((e) => e.type === 'hit' && e.detail.result === 'landed')) return h.st;
    }
  }
  throw new Error('no hit landed in 50 tries');
}

/** The skater who was hit in a hitThatLands state (the home carrier). */
export function target(state: GameState): SkaterState {
  return skater(state, 'home', 'C');
}

/** Hits per 60 minutes of ice time by the skaters of the given types (both teams of setup(r.seed)). */
export function hitsPer60(r: GameResult, ...types: string[]): number {
  const s = setup(r.seed);
  const ids = new Set([...s.home.players, ...s.away.players].filter((p) => types.includes(p.type)).map((p) => p.id));
  const lines = r.players.filter((p) => ids.has(p.id));
  return (sum(lines.map((p) => p.hits)) / sum(lines.map((p) => p.toiSeconds))) * 3600;
}

let interceptSeed = 0;
/**
 * Share of `n` passes intercepted (taken or deflected) by `defender`, the only away skater, standing 0.3 m off the
 * lane halfway along a 16 m pass from home C to a still home LW. Each pass is played out with the real puck physics
 * and tryIntercept until it is intercepted or passes him.
 */
export function interceptShare(defender: PlayerDef, n: number): number {
  return interceptedPasses(defender, n).length / n;
}

/** The events of the interceptions among `n` passes set up as in interceptShare. */
export function interceptedPasses(defender: PlayerDef, n: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const state = stateWith({ carrier: 'home', puckX: -5, carrierSlot: 'C' });
    for (const s of state.skaters) if (!(s.side === 'home' && (s.slot === 'C' || s.slot === 'LW')) && !(s.side === 'away' && s.slot === 'LD')) s.onIce = false;
    const recv = skater(state, 'home', 'LW');
    recv.pos = { x: 11, y: 0 }; recv.target = { x: 11, y: 0 };
    const def0 = skater(state, 'away', 'LD');
    def0.pos = { x: 3, y: 0.3 }; def0.target = { x: 3, y: 0.3 };
    const ds = new Map(defs);
    ds.set(def0.id, { ...defender, id: def0.id, position: 'LD' });
    const rng = createRng(++interceptSeed);
    executePass(state, 'home-C', recv.id, ds, rng);
    for (let t = 0; t < 30 && state.pendingPass !== null; t++) {
      state.tick++;
      const prev = { x: state.puck.pos.x, y: state.puck.pos.y };
      stepPuck(state.puck, DT);
      const caught = tryIntercept(state, ds, rng, prev);
      if (caught) { out.push(caught.event); break; }
      if (state.puck.pos.x > 5) break;
    }
  }
  return out;
}

/** A poke check whose checker is moved out of stick reach (3.4 m away) just before the reach ends, played out. */
export function pokeOutOfReach(): { c: ContestState; events: GameEvent[]; carrierId: string | null; contestIds: number } {
  const c = startPoke(), h = contestDuel.get(c)!;
  while (c.stageT < 0.2) duelStep(h);
  const checker = skater(h.st, 'away', 'C');
  checker.pos = { x: 2.8, y: 0 }; checker.vel = { x: 0, y: 0 };
  for (let i = 0; i < 30 && h.st.contests.includes(c); i++) duelStep(h);
  return { c, events: h.events, carrierId: h.st.carrierId, contestIds: h.st.skaters.filter((k) => k.contestId !== null).length };
}

/**
 * Home RW passes to home C; away LW, 2.9 m off and closing at 3 m/s, starts a hit on him (startContest). Then three
 * live ticks of team play, contests and skating: the RW's `target` after each assignJobs, and the hit's stage then.
 */
export function targetsDuringHitClose(): { targets: { x: number; y: number }[]; stages: string[]; freeIds: string[][] } {
  const state = stateWith({ carrier: 'home', puckX: 0 });
  const rw = skater(state, 'home', 'RW'), lw = skater(state, 'away', 'LW');
  lw.pos = { x: rw.pos.x + 2.9, y: rw.pos.y }; lw.vel = { x: -3, y: 0 }; lw.facing = Math.PI;
  const rng = createRng(7);
  executePass(state, rw.id, 'home-C', defs, rng);
  const c = startContest(state, defs, rng, hitContest, [lw.id, rw.id]);
  const out = { targets: [] as { x: number; y: number }[], stages: [] as string[], freeIds: [] as string[][] };
  for (let i = 0; i < 3; i++) {
    state.tick++;
    assignJobs(state, defs, tactics);
    out.targets.push({ ...rw.target });
    contestTick(state, defs, rng, DT);
    out.stages.push(c.stage);
    out.freeIds.push(c.freeIds.slice());
    for (const s of state.skaters) if (s.onIce) stepSkater(s, harnessMoves.get(s.id)!, DT);
    stepPuck(state.puck, DT);
  }
  return out;
}

// ---- board battle, net-front and loose-race helpers ----
//
// The same kind of harness: a stateWith() state with only the skaters a contest needs on the ice, stepped tick by tick
// with the real contestTick, skating and body contact; a carrier carries the puck in front of him, a loose puck slides
// (a board battle holds it still). Nobody runs a brain or team play unless a helper says so, and nobody picks a loose
// puck up. Each call gets a new seed.

/** Every attribute 70. */
export const even: PlayerDef = def();

/** Fraction of `xs` for which `pred` holds (0 for an empty list). */
export function shareOf<T>(xs: T[], pred: (x: T) => boolean): number {
  return xs.length === 0 ? 0 : xs.filter(pred).length / xs.length;
}

type Harness = { st: GameState; ds: Map<string, PlayerDef>; rng: Rng; events: GameEvent[]; moves: Map<string, Movement> };
let harnessSeed = 0;

/** A live state with only `on` (ids like 'home-C') on the ice; `with` gives the defs of some of them. */
function harness(on: string[], withDefs: Record<string, PlayerDef>, o: { carrier?: Side | null; puckX?: number; puckY?: number; carrierSlot?: SkaterSlot } = {}): Harness {
  const state = stateWith({ carrier: o.carrier ?? null, puckX: o.puckX ?? 0, puckY: o.puckY ?? 0, carrierSlot: o.carrierSlot });
  for (const s of state.skaters) if (!on.includes(s.id)) s.onIce = false;
  state.onIce = { home: on.filter((id) => id.startsWith('home')), away: on.filter((id) => id.startsWith('away')) };
  const ds = new Map(defs);
  for (const [id, p] of Object.entries(withDefs)) ds.set(id, { ...p, id, position: ds.get(id)!.position });
  const moves = new Map([...ds].map(([id, p]) => [id, movementOf(p, 1)]));
  return { st: state, ds, rng: createRng(++harnessSeed), events: [], moves };
}

function harnessStep(h: Harness, beforeContests?: () => void): void {
  const s = h.st;
  s.tick++;
  beforeContests?.();
  contestTick(s, h.ds, h.rng, DT, h.events);
  const on = s.skaters.filter((k) => k.onIce);
  for (const k of on) { if (k.downT > 0) k.downT = Math.max(0, k.downT - DT); stepSkater(k, h.moves.get(k.id)!, DT); }
  resolveBodies(on, (id) => h.moves.get(id)!);
  const c = on.find((k) => k.id === s.carrierId);
  if (c) {
    s.puck.pos = { x: c.pos.x + Math.cos(c.facing) * 0.6, y: c.pos.y + Math.sin(c.facing) * 0.6 };
    s.puck.vel = { x: c.vel.x, y: c.vel.y };
  } else if (s.phase === 'live') stepPuck(s.puck, DT);
}

const place2 = (st: GameState, id: string, x: number, y: number, facing: number): void => {
  const s = st.skaters.find((k) => k.id === id)!;
  s.pos = { x, y }; s.target = { x, y }; s.vel = { x: 0, y: 0 }; s.facing = facing;
};

/** Where the harness board battles happen: 0.95 m off the +y side boards, inside home's attacking blue line. */
const BATTLE_SPOT = { x: 12, y: 12 };

export type BattleOpts = { supportFor?: 'a' | 'b'; firstIn?: 'a' | 'b' };
export type BattleTick = { stage: string; stageT: number; leader: string | null; pinned: string | null };
export type BattleOutcome = {
  /** 'a' (home C, the first def), 'b' (away C), or null when the puck was trapped. */
  winner: 'a' | 'b' | null;
  /** The battle event's detail, or 'trapped'. */
  detail: string;
  /** Where the puck went: the winner's stick, his supporting teammate's, or loose. */
  puckTo: 'winner' | 'support' | 'loose' | null;
  log: BattleTick[];
  h: Harness;
};

/**
 * A board battle at BATTLE_SPOT between `a` (home C) and `b` (away C), started with startContest and played out.
 * By default both stand 0.78 m from the puck, level, so neither is first in; `firstIn` puts that one 0.5 m from it and
 * the other 1.9 m away. `supportFor` puts a free teammate (that side's LW) 2.3 m from it, who joins after the arrival.
 */
function battle(a: PlayerDef, b: PlayerDef, o: BattleOpts = {}): BattleOutcome {
  const on = ['home-C', 'away-C'];
  if (o.supportFor === 'a') on.push('home-LW');
  if (o.supportFor === 'b') on.push('away-LW');
  const h = harness(on, { 'home-C': a, 'away-C': b });
  const st = h.st, S = BATTLE_SPOT;
  st.puck = { pos: { x: S.x, y: S.y }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  if (o.firstIn === 'a') { place2(st, 'home-C', S.x - 0.5, S.y - 0.1, 0); place2(st, 'away-C', S.x + 1.6, S.y - 1, Math.PI); }
  else if (o.firstIn === 'b') { place2(st, 'home-C', S.x - 1.6, S.y - 1, 0); place2(st, 'away-C', S.x + 0.5, S.y - 0.1, Math.PI); }
  else { place2(st, 'home-C', S.x - 0.6, S.y - 0.5, 0); place2(st, 'away-C', S.x + 0.6, S.y - 0.5, Math.PI); }
  if (o.supportFor === 'a') place2(st, 'home-LW', S.x - 1.5, S.y - 1.75, 0);
  if (o.supportFor === 'b') place2(st, 'away-LW', S.x + 1.5, S.y - 1.75, Math.PI);
  const c = startContest(st, h.ds, h.rng, boardBattleContest, ['home-C', 'away-C'], h.events);
  const log: BattleTick[] = [];
  const snap = (): void => { log.push({ stage: c.stage, stageT: c.stageT, leader: c.leader, pinned: c.roles.pinned }); };
  snap();
  for (let i = 0; i < 300 && st.contests.includes(c); i++) {
    harnessStep(h);
    if (st.contests.includes(c)) snap();
  }
  if (st.contests.includes(c)) throw new Error('board battle still running after 10 s');
  const e = h.events.find((x): x is GameEventOf<'battle'> | GameEventOf<'freeze'> => x.type === 'battle' || (x.type === 'freeze' && x.detail.cause === 'trapped'));
  if (!e) throw new Error('board battle ended without a result');
  if (e.type === 'freeze') return { winner: null, detail: 'trapped', puckTo: null, log, h };
  const supporter = e.side === 'home' ? 'home-LW' : 'away-LW';
  const puckTo = st.carrierId === null ? 'loose' : st.carrierId === e.playerId ? 'winner' : st.carrierId === supporter ? 'support' : null;
  return { winner: e.side === 'home' ? 'a' : 'b', detail: e.detail.how, puckTo, log, h };
}

/** One board battle (see battle()): its winner, the event's detail and where the puck went. */
export const runBattle = (a: PlayerDef, b: PlayerDef, o: BattleOpts = {}): BattleOutcome => battle(a, b, o);

/** The first of up to 200 board battles that `a` wins and his side comes away with clean (the puck not squirting loose). */
export function runBattleWon(a: PlayerDef, b: PlayerDef, o: BattleOpts = {}): BattleOutcome {
  for (let i = 0; i < 200; i++) { const r = battle(a, b, o); if (r.winner === 'a' && r.puckTo !== 'loose') return r; }
  throw new Error('a never won in 200 battles');
}

/** One board battle's contest state on every tick it ran: stage, stageT, leader and who is pinned. */
export const runBattleLogged = (a: PlayerDef, b: PlayerDef, o: BattleOpts = {}): BattleTick[] => battle(a, b, o).log;

/** The stages of a logged battle in order, each with how long it lasted (s). */
export function stagesOf(log: BattleTick[]): { stage: string; seconds: number }[] {
  const out: { stage: string; seconds: number }[] = [];
  for (const l of log) {
    const last = out[out.length - 1];
    if (last && last.stage === l.stage) last.seconds += DT;
    else out.push({ stage: l.stage, seconds: DT });
  }
  return out;
}

export const totalSeconds = (stages: { seconds: number }[]): number => sum(stages.map((s) => s.seconds));

/** Even battles played out until one is trapped; the state just after the whistle. */
export function trappedBattle(): { phase: string; freeze: GameEvent | undefined; faceoffSpot: { x: number; y: number }; contests: number } {
  for (let i = 0; i < 3000; i++) {
    const r = battle(even, even);
    if (r.winner !== null) continue;
    const st = r.h.st;
    return { phase: st.phase, freeze: r.h.events.find((e) => e.type === 'freeze'), faceoffSpot: st.faceoffSpot, contests: st.contests.length };
  }
  throw new Error('no trapped puck in 3000 battles');
}

/**
 * A board battle at BATTLE_SPOT between home C and away C, with away LW free 7 m away and team play (the real
 * assignJobs) run every tick. Where supportTarget sent him at the start, how far his target was from it, and whether he
 * joined the battle.
 */
export function battleWithThirdMan(): { supportSpot: { x: number; y: number } | null; distToSupportSpot: number; joined: boolean } {
  const h = harness(['home-C', 'away-C', 'away-LW'], {});
  const st = h.st, S = BATTLE_SPOT;
  st.puck = { pos: { x: S.x, y: S.y }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  place2(st, 'home-C', S.x - 0.6, S.y - 0.5, 0); place2(st, 'away-C', S.x + 0.6, S.y - 0.5, Math.PI);
  place2(st, 'away-LW', S.x + 5, S.y - 5, Math.PI);
  const c = startContest(st, h.ds, h.rng, boardBattleContest, ['home-C', 'away-C'], h.events);
  const lw = st.skaters.find((k) => k.id === 'away-LW')!;
  const supportSpot = supportTarget(st, 'away');
  assignJobs(st, h.ds, tactics);
  const distToSupportSpot = supportSpot ? Math.hypot(lw.target.x - supportSpot.x, lw.target.y - supportSpot.y) : Infinity;
  let joined = false;
  for (let i = 0; i < 150 && st.contests.includes(c); i++) {
    harnessStep(h, () => assignJobs(st, h.ds, tactics));
    if (c.participants.includes('away-LW')) joined = true;
  }
  return { supportSpot, distToSupportSpot, joined };
}

/**
 * A real game stepped tick by tick: over every tick a board battle holds the puck still (after its arrive, before its
 * resolve; not while a carrier shields it), how many such
 * ticks, on how many someone was carrying the puck, the largest move of the puck in one of them (m), and how many
 * battles had a supporting player join.
 */
export function heldPuckInGame(s: GameSetup): { ticks: number; carried: number; maxStep: number; supported: number } {
  const g = createGame(s);
  let ticks = 0, carried = 0, maxStep = 0;
  const supported = new Set<number>();
  let prev: { x: number; y: number } | null = null;
  while (!g.done) {
    g.step();
    const b = g.state.contests.find((c) => c.kind === 'boardBattle' && c.stage !== 'resolve' && c.stage !== 'arrive' && c.stage !== 'protect');
    if (!b || g.state.phase !== 'live') { prev = null; continue; }
    ticks++;
    if (g.state.carrierId !== null) carried++;
    const p = g.state.puck.pos;
    if (prev) maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = { x: p.x, y: p.y };
    if (b.participants.length > 2) supported.add(b.id);
  }
  return { ticks, carried, maxStep, supported: supported.size };
}

// Net-front: home attacks +x with home LD carrying the puck at the left point; home C (the attacker) on his net-front
// spot; away LD (the defender) right on him, goal-side.

/** The net-front attacker in the net-front helpers. */
export const attackerId = 'home-C';

type NetFront = { h: Harness; c: ContestStateOf<'netFront'> };
function netFrontStart(att: PlayerDef = even, dfn: PlayerDef = even): NetFront {
  const h = harness(['home-LD', 'home-C', 'away-LD'], { 'home-C': att, 'away-LD': dfn }, { carrier: 'home', puckX: 9.8, puckY: 8.5, carrierSlot: 'LD' });
  const st = h.st;
  place2(st, 'home-LD', 9.2, 8.5, 0);
  const spot = ozoneSpotPos(st, 'home', 'netFront', { x: 0, y: 0 });
  place2(st, 'home-C', spot.x, spot.y, Math.PI);
  place2(st, 'away-LD', spot.x + 0.8, spot.y, Math.PI);
  const c = startContest(st, h.ds, h.rng, netFrontContest, ['home-C', 'away-LD'], h.events);
  return { h, c };
}

/** A net-front battle played until a round goes the `want` stage's way ('free': the attacker's, 'tied': the defender's). */
function netFrontUntil(want: 'free' | 'tied'): GameState {
  for (let tries = 0; tries < 50; tries++) {
    const { h, c } = netFrontStart();
    for (let i = 0; i < 300 && h.st.contests.includes(c); i++) {
      harnessStep(h);
      if (c.stage === want && c.stageT === 0) return h.st;
    }
  }
  throw new Error(`no net-front round went ${want}`);
}

export const netFrontWonByAttacker = (): GameState => netFrontUntil('free');
export const netFrontWonByDefender = (): GameState => netFrontUntil('tied');

/** The defending (away) goalie is screened now: what resolveOnNet reads. */
export const isScreened = (st: GameState): boolean => st.screenedUntilTick.away > st.tick;

/** The brain would consider `id` as a pass target now. */
export const canReceive = (st: GameState, id: string): boolean => canReceivePass(st, st.skaters.find((k) => k.id === id)!);

/**
 * An even net-front battle run for `seconds`: its first stage, the time (s) of each round, and at each round the stage
 * and leader it set and how far (m) the attacker's target then is from where he stood.
 */
export function netFrontRounds(seconds: number): {
  stages: string[]; roundTimes: number[]; rounds: { stage: string; leader: string | null; attackerTarget: number }[];
} {
  const { h, c } = netFrontStart();
  const st = h.st;
  const att = st.skaters.find((k) => k.id === attackerId)!;
  const out = { stages: [c.stage], roundTimes: [] as number[], rounds: [] as { stage: string; leader: string | null; attackerTarget: number }[] };
  let rounds = 0;
  for (let i = 0; i < Math.round(seconds / DT) && st.contests.includes(c); i++) {
    const before = { x: att.pos.x, y: att.pos.y };
    harnessStep(h);
    if (c.data.rounds > rounds) {
      rounds = c.data.rounds;
      out.roundTimes.push(st.tick * DT);
      out.rounds.push({ stage: c.stage, leader: c.leader, attackerTarget: Math.hypot(att.target.x - before.x, att.target.y - before.y) });
    }
  }
  return out;
}

// Loose-puck races: the puck still at centre ice, home C coming from -x and away C from +x, both from rest.

export type RaceOpts = { aLead: number; a?: PlayerDef; b?: PlayerDef; reboundFor?: 'a' };
export type RaceOutcome = { winner: 'a' | 'b' | null; stages: string[]; seconds: number; raceLeaders: (string | null)[] };

/** Distance (m) from which a still skater `d` needs `t` s to reach a still puck (timeToReach inverted by bisection). */
function distanceFor(d: PlayerDef, t: number): number {
  const m = movementOf(d, 1);
  let lo = 0.9, hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (timeToReach(at(-mid, 0), m, { x: 0, y: 0 }) < t) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * A loose-puck race started with startContest and played out: `a` (home C) 3 m from the puck, `b` (away C) where he
 * needs `aLead` s longer to get there. With `reboundFor: 'a'`, home C has just won a net-front round (the rebound edge).
 * Winner: whoever has the puck at the end (null: it bounced loose).
 */
export function runRace(o: RaceOpts): RaceOutcome {
  const a = o.a ?? even, b = o.b ?? even;
  const h = harness(['home-C', 'away-C'], { 'home-C': a, 'away-C': b });
  const st = h.st;
  st.puck = { pos: { x: 0, y: 0 }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  const da = 3, tb = timeToReach(at(-da, 0), movementOf(a, 1), { x: 0, y: 0 }) + o.aLead;
  place2(st, 'home-C', -da, 0, 0);
  place2(st, 'away-C', distanceFor(b, tb), 0, Math.PI);
  if (o.reboundFor === 'a') st.reboundEdge = { id: 'home-C', untilTick: st.tick + 60 };
  const c = startContest(st, h.ds, h.rng, looseRaceContest, ['home-C', 'away-C'], h.events);
  const stages = [c.stage];
  const raceLeaders: (string | null)[] = [];
  let ticks = 0;
  for (; ticks < 150 && st.contests.includes(c); ticks++) {
    harnessStep(h);
    if (!st.contests.includes(c)) break;
    if (stages[stages.length - 1] !== c.stage) stages.push(c.stage);
    if (c.stage === 'race') raceLeaders.push(c.leader);
  }
  if (st.contests.includes(c)) throw new Error('race still running after 5 s');
  const winner = st.carrierId === 'home-C' ? 'a' : st.carrierId === 'away-C' ? 'b' : null;
  return { winner, stages, seconds: (ticks + 1) * DT, raceLeaders };
}

/** A dead-heat race in which home C has just won the net-front battle. */
export const raceWithRebound = (): RaceOutcome => runRace({ aLead: 0, reboundFor: 'a' });

// ---- side outcomes, shielding along the boards, assists, offside over icing (Task 12) ----

/** How `n` hits by `hitter` on the still carrier `tgt` at `closing` m/s ended: counts of the hit event's detail. */
export function hitOutcomes(hitter: PlayerDef, tgt: PlayerDef, closing: number, n: number): Record<string, number> {
  const out: Record<string, number> = { landed: 0, absorbed: 0, bounced: 0 };
  for (let i = 0; i < n; i++) {
    const e = hitDuel(hitter, tgt, closing).events.find((x) => x.type === 'hit');
    if (e?.type === 'hit') out[e.detail.result] = (out[e.detail.result] ?? 0) + 1;
  }
  return out;
}

/** How `n` poke checks by `defender` on the still carrier `carrier` (as in runPoke) ended: won, kept, or kept with the checker beaten. */
export function pokeOutcomes(defender: PlayerDef, carrier: PlayerDef, n: number): { won: number; kept: number; beaten: number } {
  const out = { won: 0, kept: 0, beaten: 0 };
  for (let i = 0; i < n; i++) {
    const h = pokeDuel(defender, carrier);
    let c: ContestState | null = null;
    for (let k = 0; k < 180 && (c === null || h.st.contests.includes(c)); k++) { duelStep(h); c ??= h.st.contests[0] ?? null; }
    const o = c?.kind === 'pokeCheck' ? c.data.outcome : undefined;
    if (o === 'take' || o === 'loose') out.won++;
    else if (o === 'kept') out.kept++;
    else if (o === 'beaten') out.beaten++;
  }
  return out;
}

/**
 * Home C carrying the puck along the +y boards at BATTLE_SPOT, skating slowly up ice, with away C on his shoulder when
 * the board battle starts on him (startContest, as its trigger would). 'kept': he shielded it and skated out; 'lost':
 * it was knocked into their feet and the battle went on; 'none': it ended without either.
 */
export function shieldAlongBoards(carrier: PlayerDef, opp: PlayerDef): 'kept' | 'lost' | 'none' {
  const h = harness(['home-C', 'away-C'], { 'home-C': carrier, 'away-C': opp }, { carrier: 'home', puckX: BATTLE_SPOT.x + 0.6, puckY: BATTLE_SPOT.y, carrierSlot: 'C' });
  const st = h.st, S = BATTLE_SPOT;
  place2(st, 'home-C', S.x, S.y - 0.1, 0);
  const c0 = st.skaters.find((k) => k.id === 'home-C')!;
  c0.vel = { x: 2, y: 0 }; c0.target = { x: S.x + 20, y: S.y - 0.1 }; c0.speedCap = 0.3;
  place2(st, 'away-C', S.x + 0.3, S.y - 1, Math.PI / 2);
  st.puck.pos = { x: S.x + 0.6, y: S.y - 0.1 };
  const c = startContest(st, h.ds, h.rng, boardBattleContest, ['away-C', 'home-C'], h.events);
  for (let i = 0; i < 60 && st.contests.includes(c) && c.stage === 'protect'; i++) harnessStep(h);
  if (c.stage === 'arrive' || c.stage === 'pin') return 'lost';
  return h.events.some((e) => e.type === 'battle' && e.detail.how === 'protect') ? 'kept' : 'none';
}

/** The events of the first hit (of up to 50, as in hitThatLands) that lands on the carrier. */
export function landedHitEvents(): GameEvent[] {
  for (let i = 0; i < 50; i++) {
    const h = hitDuel(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6);
    if (h.events.some((e) => e.type === 'hit' && e.detail.result === 'landed')) return h.events;
  }
  throw new Error('no hit landed in 50 tries');
}

/**
 * The events of the first board battle on a carrier along the boards (as in shieldAlongBoards, home C carrying, `opp`
 * as away C) that away C wins after knocking the puck into their feet (up to 200 tries).
 */
export function battleWonOffCarrier(carrier: PlayerDef, opp: PlayerDef): GameEvent[] {
  for (let i = 0; i < 200; i++) {
    const h = harness(['home-C', 'away-C'], { 'home-C': carrier, 'away-C': opp }, { carrier: 'home', puckX: BATTLE_SPOT.x + 0.6, puckY: BATTLE_SPOT.y, carrierSlot: 'C' });
    const st = h.st, S = BATTLE_SPOT;
    place2(st, 'home-C', S.x, S.y - 0.1, 0);
    place2(st, 'away-C', S.x + 0.3, S.y - 1, Math.PI / 2);
    st.puck.pos = { x: S.x + 0.6, y: S.y - 0.1 };
    const c = startContest(st, h.ds, h.rng, boardBattleContest, ['away-C', 'home-C'], h.events);
    for (let k = 0; k < 300 && st.contests.includes(c); k++) harnessStep(h);
    if (h.events.some((e) => e.type === 'battle' && e.playerId === 'away-C' && e.detail.how !== 'protect')) return h.events;
  }
  throw new Error('away C never won the puck off the carrier');
}

/**
 * A loose puck sliding along the +y boards at 4 m/s when a board battle starts on it (both men 0.8 m away): how far it
 * moves on each of the first 12 ticks, and how far from the battle's spot it is after them.
 */
export function puckIntoFeet(): { steps: number[]; offSpot: number } {
  const h = harness(['home-C', 'away-C'], {});
  const st = h.st, S = BATTLE_SPOT;
  st.puck = { pos: { x: S.x, y: S.y }, z: 0, vel: { x: 4, y: 0 }, vz: 0 };
  place2(st, 'home-C', S.x - 0.6, S.y - 0.5, 0); place2(st, 'away-C', S.x + 0.6, S.y - 0.5, Math.PI);
  const c = startContest(st, h.ds, h.rng, boardBattleContest, ['home-C', 'away-C'], h.events);
  const steps: number[] = [];
  for (let i = 0; i < 12; i++) {
    const p0 = { ...st.puck.pos };
    harnessStep(h);
    steps.push(Math.hypot(st.puck.pos.x - p0.x, st.puck.pos.y - p0.y));
  }
  return { steps, offSpot: Math.hypot(st.puck.pos.x - c.spot.x, st.puck.pos.y - c.spot.y) };
}

/**
 * Home LW touched the puck `lwSecondsAgo` s before home C scores from the slot (C's touch is fresh). The goal's
 * assists, from the real resolveOnNet (seeds tried until the shot goes in).
 */
export function assistsWhenTouched(lwSecondsAgo: number): string[] {
  for (let seed = 1; seed <= 500; seed++) {
    const st = stateWith({ carrier: 'home', puckX: 20, puckY: 2, carrierSlot: 'C' });
    st.tick = 3000;
    st.carrierId = null;
    st.touches = { side: null, ids: [], ticks: [] };
    const now = st.tick;
    st.tick = now - Math.round(lwSecondsAgo / DT);
    recordTouch(st, 'home-LW', 'home');
    st.tick = now - 15;
    recordTouch(st, 'home-C', 'home');
    st.tick = now;
    st.shotInFlight = { shooterId: 'home-C', side: 'home', from: { x: 20, y: 2 }, fromDist: 6.4, tick: now - 6, blockTried: [] };
    const ds = new Map(defs);
    const gId = st.goalies.away.id;
    ds.set(gId, { ...def({ id: gId, position: 'G' }), goalie: g(30) });
    const events: GameEvent[] = [];
    const r = resolveOnNet(st, { kind: 'onNet', end: 1, y: 0.8, z: 0.85, speed: 35 }, ds, createRng(seed), events);
    if (r === 'goal') return events.find((e) => e.type === 'goal')!.assistIds;
  }
  throw new Error('no goal in 500 tries');
}

/**
 * Home LD fires the puck down the ice from his own half (x -5) with home LW standing offside in the zone and away LD
 * deep in his own zone (so he wins the icing race): the call.
 */
export function icedWithWingerOffside(): GameEvent | null {
  const st = live({ carrier: 'home:LD', carrierX: -5 });
  const w = offsideWinger();
  place(st, w.ref, w.x, w.y);
  place(st, 'away:LD', 21, 6);
  shootDownIce(st);
  return refereeUntilCall(st);
}

/**
 * A rush: home C carries the puck up ice at 8 m/s from the neutral zone (x -7) to the blue line while home LW, 2.5 m
 * ahead of him and flying, keeps the shape team play gives him (the real assignJobs and skating every tick). How far
 * past the blue line (m) the winger's centre got while the puck was still outside the zone, less his body radius
 * (> 0: offside).
 */
export function wingerAheadOnRush(): number {
  const st = stateWith({ carrier: 'home', puckX: -7, carrierSlot: 'C' });
  for (const k of st.skaters) if (!(k.side === 'home' && (k.slot === 'C' || k.slot === 'LW'))) k.onIce = false;
  const c = skater(st, 'home', 'C'), lw = skater(st, 'home', 'LW');
  lw.pos = { x: -4.5, y: 8 }; lw.vel = { x: 8.5, y: 0 };
  let worst = -Infinity;
  for (let t = 0; t < 30 * 4 && st.puck.pos.x < RINK.blueLineX; t++) {
    st.tick++;
    c.pos.x += 8 * DT; c.vel = { x: 8, y: 0 };
    st.puck.pos = { x: c.pos.x + 0.6, y: c.pos.y };
    assignJobs(st, defs, tactics);
    stepSkater(lw, harnessMoves.get(lw.id)!, DT);
    worst = Math.max(worst, lw.pos.x - RINK.blueLineX - harnessMoves.get(lw.id)!.radius);
  }
  return worst;
}

/** A copy of `state` with the score set (home, away). */
export function withScore(state: GameState, home: number, away: number): GameState {
  const st = structuredClone(state);
  st.score = { home, away };
  return st;
}

/** A copy of `state` in which its carrier has had the puck for `seconds` (his touch in the chain is that old). */
export function heldFor(state: GameState, seconds: number): GameState {
  const st = structuredClone(state);
  const c = st.skaters.find((k) => k.id === st.carrierId)!;
  st.tick = 3000;
  st.touches = { side: c.side, ids: [c.id], ticks: [st.tick - Math.round(seconds / DT)] };
  return st;
}

/** A net-front battle run for `seconds`, then ended by the puck coming loose: its last leader and the events it emitted. */
export function netFrontEnded(seconds: number): { leader: string | null; battles: GameEvent[] } {
  const { h, c } = netFrontStart();
  for (let i = 0; i < Math.round(seconds / DT) && h.st.contests.includes(c); i++) harnessStep(h);
  const leader = c.leader;
  releasePuck(h.st, h.st.carrierId!, 0, -5, 0);
  h.st.pendingPass = null;
  for (let i = 0; i < 3 && h.st.contests.includes(c); i++) harnessStep(h);
  return { leader, battles: h.events.filter((e) => e.type === 'battle') };
}

// ---- calibration (Task 12) ----

/** What one calibration game leaves behind: its box score without the event log, event counts and contest starts. */
export type GameRecord = {
  index: number;
  ms: number;
  score: { home: number; away: number };
  team: GameResult['team'];
  players: GameResult['players'];
  /** Player type of every player id in the game. */
  types: Record<string, string>;
  /** Events by type, and by `type:detail` for the kinds whose detail says how it happened. */
  counts: Record<string, number>;
  /** Contests started, by kind. */
  contests: Record<string, number>;
};

export type CalibrationOpts = { homeOverall?: number; awayOverall?: number };

/** The one word that says how an event happened (e.g. `landed` for a hit, `trapped` for a freeze), for counting. */
export function detailKey(e: GameEvent): string {
  switch (e.type) {
    case 'hit': return e.detail.result;
    case 'freeze': return e.detail.cause;
    case 'takeaway': case 'giveaway': case 'turnover': return e.detail.how;
    case 'battle': return e.detail.how;
    case 'save': return e.detail.pose;
    case 'pass': return e.detail.kind;
    case 'lineChange': return e.detail.onTheFly ? 'onTheFly' : 'stoppage';
    case 'contestEnd': return e.detail.result;
    default: return '';
  }
}

/** Event types whose detail is counted too (e.g. `hit:landed`, `freeze:trapped`, `takeaway:poke`). */
const DETAILED = new Set(['hit', 'freeze', 'takeaway', 'giveaway', 'turnover', 'battle', 'save', 'pass', 'lineChange']);

/**
 * Calibration game `i`: two generated teams (home roster seed 2i + 1 at `homeOverall`, away 2i + 2 at `awayOverall`,
 * both 70 by default), game seed i + 1, played to the end with every new contest counted.
 */
export function playRecord(i: number, o: CalibrationOpts = {}): GameRecord {
  const s: GameSetup = {
    home: generateTeam(2 * i + 1, `Home ${i}`, 'H', o.homeOverall ?? 70),
    away: generateTeam(2 * i + 2, `Away ${i}`, 'A', o.awayOverall ?? 70),
    seed: i + 1,
    chemistry: [],
  };
  const t0 = performance.now();
  const game = createGame(s);
  const contests: Record<string, number> = {};
  const seen = new Set<number>();
  while (!game.done) {
    game.step();
    for (const c of game.state.contests) if (!seen.has(c.id)) { seen.add(c.id); contests[c.kind] = (contests[c.kind] ?? 0) + 1; }
  }
  const r = game.result();
  const ms = performance.now() - t0;
  const counts: Record<string, number> = {};
  for (const e of r.events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (DETAILED.has(e.type)) {
      const k = `${e.type}:${detailKey(e)}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const types: Record<string, string> = {};
  for (const p of [...s.home.players, ...s.away.players]) types[p.id] = p.type;
  return { index: i, ms, score: r.score, team: r.team, players: r.players, types, counts, contests };
}

const recordCache = new Map<string, GameRecord[]>();

/**
 * `n` calibration games (playRecord 0 .. n-1), played on worker threads (one per core, at most 8) while this thread
 * waits, so the call stays synchronous. Results are cached per (n, opts) for the life of the test file.
 */
export function runGames(n: number, o: CalibrationOpts = {}): GameRecord[] {
  const key = JSON.stringify([n, o.homeOverall ?? 70, o.awayOverall ?? 70]);
  const hit = recordCache.get(key);
  if (hit) return hit;
  const nWorkers = Math.max(1, Math.min(8, availableParallelism(), n));
  const done = new Int32Array(new SharedArrayBuffer(4));
  const jobs = Array.from({ length: nWorkers }, (_, w) => Array.from({ length: n }, (_, i) => i).filter((i) => i % nWorkers === w));
  const ports: MessagePort[] = [];
  const workers: Worker[] = [];
  for (const indices of jobs) {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1);
    workers.push(new Worker(new URL('./calibration-worker.ts', import.meta.url), {
      execArgv: ['--import', 'tsx'], workerData: { indices, opts: o, port: port2, done }, transferList: [port2],
    }));
  }
  const out: GameRecord[] = [];
  try {
    for (const port of ports) {
      let msg: ReturnType<typeof receiveMessageOnPort>;
      while ((msg = receiveMessageOnPort(port)) === undefined) {
        const now = Atomics.load(done, 0);
        if (now < 0) {
          for (const q of ports) { const m = receiveMessageOnPort(q)?.message as { error?: string } | undefined; if (m?.error !== undefined) throw new Error(`calibration worker: ${m.error}`); }
          throw new Error('a calibration worker failed');
        }
        Atomics.wait(done, 0, now, 1000);
      }
      const m = msg.message as { records?: GameRecord[]; error?: string };
      if (m.error !== undefined) throw new Error(`calibration worker: ${m.error}`);
      out.push(...m.records!);
    }
  } finally {
    for (const w of workers) void w.terminate();
  }
  out.sort((a, b) => a.index - b.index);
  recordCache.set(key, out);
  return out;
}

const total = (rs: GameRecord[], f: (r: GameRecord) => number): number => rs.reduce((a, r) => a + f(r), 0);
const countOf = (r: GameRecord, k: string): number => r.counts[k] ?? 0;

export type Summary = {
  games: number;
  /** Per team per game. */
  goals: number; shots: number; hits: number; blocks: number; giveaways: number; takeaways: number; battles: number;
  faceoffs: number; offsides: number; icings: number;
  /** Per game, both teams. */
  faceoffsTotal: number; offsidesTotal: number; icingsTotal: number;
  /** Share of games in which the home side's faceoff share is outside 35% to 65%. */
  faceoffShareOutside: number;
  /** Saves over shots on goal. */
  savePct: number;
  homeWinShare: number; tieShare: number;
  msPerGame: number;
};

/** Per-team-per-game means (and per-game totals for the whistles) over the records. */
export function summarise(rs: GameRecord[]): Summary {
  const g = rs.length, perTeam = (x: number): number => x / (2 * g);
  const shots = total(rs, (r) => r.team.home.shots + r.team.away.shots);
  const goals = total(rs, (r) => r.score.home + r.score.away);
  return {
    games: g,
    goals: perTeam(goals),
    shots: perTeam(shots),
    hits: perTeam(total(rs, (r) => r.team.home.hits + r.team.away.hits)),
    blocks: perTeam(total(rs, (r) => r.team.home.blocks + r.team.away.blocks)),
    giveaways: perTeam(total(rs, (r) => r.team.home.giveaways + r.team.away.giveaways)),
    takeaways: perTeam(total(rs, (r) => r.team.home.takeaways + r.team.away.takeaways)),
    battles: perTeam(total(rs, (r) => countOf(r, 'battle'))),
    faceoffs: perTeam(total(rs, (r) => countOf(r, 'faceoff'))),
    offsides: perTeam(total(rs, (r) => countOf(r, 'offside'))),
    icings: perTeam(total(rs, (r) => countOf(r, 'icing'))),
    faceoffsTotal: total(rs, (r) => countOf(r, 'faceoff')) / g,
    faceoffShareOutside: rs.filter((r) => { const n = r.team.home.faceoffsWon + r.team.away.faceoffsWon; const sh = n === 0 ? 0.5 : r.team.home.faceoffsWon / n; return sh < 0.35 || sh > 0.65; }).length / g,
    offsidesTotal: total(rs, (r) => countOf(r, 'offside')) / g,
    icingsTotal: total(rs, (r) => countOf(r, 'icing')) / g,
    savePct: shots === 0 ? 0 : total(rs, (r) => countOf(r, 'save')) / shots,
    homeWinShare: rs.filter((r) => r.score.home > r.score.away).length / g,
    tieShare: rs.filter((r) => r.score.home === r.score.away).length / g,
    msPerGame: total(rs, (r) => r.ms) / g,
  };
}

/** Share of games won by each side, and tied. */
export function winShare(rs: GameRecord[]): { home: number; away: number; tie: number } {
  const g = rs.length;
  return {
    home: rs.filter((r) => r.score.home > r.score.away).length / g,
    away: rs.filter((r) => r.score.away > r.score.home).length / g,
    tie: rs.filter((r) => r.score.home === r.score.away).length / g,
  };
}

/** Sum of `f` and of time on ice over every player line of each player type. */
function byType(rs: GameRecord[], f: (p: GameResult['players'][number]) => [number, number]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const r of rs) for (const p of r.players) {
    if (r.types[p.id] === 'Goalie') continue;
    const t = r.types[p.id]!;
    const [a, b] = f(p);
    const acc = (out[t] ??= [0, 0]);
    acc[0] += a;
    acc[1] += b;
  }
  return out;
}

/** Goals per 60 minutes of ice time, by player type. */
export function goalsPer60ByType(rs: GameRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, [goals, toi]] of Object.entries(byType(rs, (p) => [p.goals, p.toiSeconds]))) out[t] = toi > 0 ? (goals / toi) * 3600 : 0;
  return out;
}

/** Share of board battles won, by player type. */
export function battleWinShareByType(rs: GameRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, [won, n]] of Object.entries(byType(rs, (p) => [p.battlesWon, p.battlesWon + p.battlesLost]))) out[t] = n > 0 ? won / n : 0;
  return out;
}

/** Player lines of `side`'s players in a result of two generated teams: their ids start with the team's abbr. */
export function playersOf(r: GameResult, side: Side): GameResult['players'] {
  const abbrOf = (id: string): string => id.slice(0, id.lastIndexOf('-'));
  const home = abbrOf(r.players[0]!.id);
  return r.players.filter((p) => (abbrOf(p.id) === home) === (side === 'home'));
}

// ---- skating measures (final review I2) ----

export type RetreatMeasure = { samples: number; facingPuck: number; movingBackward: number; modes: Record<string, number> };

/**
 * The final review's measure of retreating defencemen, over whole games: every live tick, each on-ice defenceman of
 * the side without the puck (the other side has possession), not down, moving toward his own net faster than 1.5 m/s,
 * with the puck up-ice of him. `facingPuck`: share facing the puck within 60 degrees; `movingBackward`: share whose
 * velocity points behind his facing; `modes`: share in each SkaterState mode.
 */
export function retreatMeasure(seeds: number[]): RetreatMeasure {
  let n = 0, facing = 0, back = 0;
  const modes: Record<string, number> = {};
  for (const seed of seeds) {
    const g = createGame(gameSetup(seed));
    while (!g.done) {
      g.step();
      const st = g.state;
      if (st.phase !== 'live' || st.possession === null) continue;
      for (const s of st.skaters) {
        if (!s.onIce || s.downT > 0 || (s.slot !== 'LD' && s.slot !== 'RD') || s.side === st.possession) continue;
        const dir = st.attackDir[s.side];
        const nx = -dir * RINK.goalLineX - s.pos.x, ny = -s.pos.y;
        const nl = Math.hypot(nx, ny) || 1;
        if ((s.vel.x * nx + s.vel.y * ny) / nl <= 1.5) continue;
        if (st.puck.pos.x * dir <= s.pos.x * dir) continue;
        n++;
        const toPuck = Math.atan2(st.puck.pos.y - s.pos.y, st.puck.pos.x - s.pos.x);
        let off = Math.abs(toPuck - s.facing) % (2 * Math.PI);
        if (off > Math.PI) off = 2 * Math.PI - off;
        if (off <= Math.PI / 3) facing++;
        if (s.vel.x * Math.cos(s.facing) + s.vel.y * Math.sin(s.facing) < 0) back++;
        const m = (s as { mode?: string }).mode ?? 'none';
        modes[m] = (modes[m] ?? 0) + 1;
      }
    }
  }
  for (const k of Object.keys(modes)) modes[k] = modes[k]! / Math.max(1, n);
  return { samples: n, facingPuck: facing / Math.max(1, n), movingBackward: back / Math.max(1, n), modes };
}
