import { generateTeam } from '../src/roster-gen';
import { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from '../src/attributes';
import { DT, PERIOD_SECONDS } from '../src/constants';
import { drainEnergy, recoverEnergy } from '../src/bench';
import { stepPuck } from '../src/puck';
import type { Puck, PuckEvent } from '../src/puck';
import type { ContestState, GameEvent, GameEventType, GameResult, GameSetup, GameState, PlayerDef, Side, SkaterState, Tactics, TeamDef } from '../src/types';
import { PLAYER_TYPES } from '../src/player-types';
import { RINK, resolveBoards } from '../src/rink';
import { createRng, type Rng } from '../src/rng';
import { OZONE_SPOTS, ozoneSpotPos } from '../src/team-play';
import { decideCarrier, type Decision } from '../src/brain';
import { executeDump, executePass, releasePuck, tryIntercept } from '../src/actions';
import { resolveBodies } from '../src/bodies';
import { contestTick, startContest } from '../src/contests/core';
import { hitContest } from '../src/contests/hit';
import { assignJobs } from '../src/team-play';
import { createGame, type Game } from '../src/game';
import { tryBlock } from '../src/goalie';
import { movementOf, stepSkater } from '../src/skating';
import { refereeTick } from '../src/referee';
import type { Movement } from '../src/skating';

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
    target: { x, y }, faceTarget: null, speedCap: 1, energy: 1, onIce: true, leaving: false,
    downT: 0, contestId: null, shiftStart: 0,
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
        target: { x: pos.x, y: pos.y }, faceTarget: null, speedCap: 1, energy: 1, onIce: true, leaving: false,
        downT: 0, contestId: null, shiftStart: 0,
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
    pickupBlock: null, pendingPass: null, shotInFlight: null, screenedUntilTick: { home: 0, away: 0 },
    touches: { side: null, ids: [] }, lastAttackTouch: { home: null, away: null },
    noChange: null, delayedOffside: null, icingWatch: null, lastRelease: null, contestCooldowns: [],
    bench: {
      home: { forwards: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0, 0] }, defence: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0] } },
      away: { forwards: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0, 0] }, defence: { cur: 0, changing: false, shiftStart: 0, toi: [0, 0, 0] } },
    },
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
  return r.events.filter((e) => e.type === 'lineChange' && (kind === undefined || e.detail.split(' ').includes(kind)));
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
        if (e.side !== side || !e.detail.startsWith(unit)) continue;
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

/** A poke check by `defender` (standing 1.2 m in front of him) on the still carrier `carrier`: true when the defender wins it. */
export function runPoke(defender: PlayerDef, carrier: PlayerDef): boolean {
  const h = duel(defender, carrier, 0.6, 0);
  duelToEnd(h);
  return h.events.some((e) => e.type === 'takeaway' && e.playerId === 'away-C');
}

/** The contest state of a poke check one tick after it starts (every attribute 70). */
export function startPoke(): ContestState {
  const h = duel(d, d, 0.6, 0);
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
    takeaways: h.events.filter((e) => e.type === 'takeaway').length,
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
  return hitDuel(hitter, tgt, closing).events.some((e) => e.type === 'hit' && e.detail === 'landed');
}

/** A big hitter's check on a smaller carrier, stopped on the tick it lands (seeds tried in turn). */
export function hitThatLands(): GameState {
  for (let i = 0; i < 50; i++) {
    const h = hitDuelStart(def({ bodyChecking: 88, strength: 90, weightKg: 104 }), def({ balance: 62, strength: 60, weightKg: 80 }), 6);
    for (let k = 0; k < 90; k++) {
      duelStep(h);
      if (h.events.some((e) => e.type === 'hit' && e.detail === 'landed')) return h.st;
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
  let k = 0;
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
      if (tryIntercept(state, ds, rng, prev)) { k++; break; }
      if (state.puck.pos.x > 5) break;
    }
  }
  return k / n;
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
