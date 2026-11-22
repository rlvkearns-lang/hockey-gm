import { generateTeam } from '../src/roster-gen';
import { GOALIE_ATTRS, SKATER_ATTRS, type GoalieAttrs, type SkaterAttrs } from '../src/attributes';
import { DT } from '../src/constants';
import { stepPuck } from '../src/puck';
import type { Puck, PuckEvent } from '../src/puck';
import type { GameEvent, GameEventType, GameResult, GameSetup, GameState, PlayerDef, Side, SkaterState, Tactics, TeamDef } from '../src/types';
import { PLAYER_TYPES } from '../src/player-types';
import { RINK, resolveBoards } from '../src/rink';
import { createRng } from '../src/rng';
import { OZONE_SPOTS, ozoneSpotPos } from '../src/team-play';
import { decideCarrier, type Decision } from '../src/brain';
import { executeDump, executePass, releasePuck } from '../src/actions';
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
    noChange: null, delayedOffside: null, icingWatch: null,
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
