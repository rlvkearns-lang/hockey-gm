import { describe, it, expect } from 'vitest';
import { executePass, executeShot } from '../src/actions';
import { createGame, restoreGame } from '../src/game';
import { trackShot, tryBlock } from '../src/shots';
import { stepPuck, type Puck } from '../src/puck';
import { distToBoards } from '../src/rink';
import { bodyRadius } from '../src/skating';
import { createRng } from '../src/rng';
import { DT } from '../src/constants';
import { bladePos } from '../src/blade';
import type { GameEvent, GameSetup, GameState, Job, PlayerDef, ShotType, SkaterState } from '../src/types';
import { def, defs, gameSetup, place, puckAt, rate, run, skater, stateWith } from './helpers';

/** Only these skaters stay on the ice (by side and slot, e.g. 'home:C'). */
function only(st: GameState, keep: string[]): void {
  for (const s of st.skaters) if (!keep.includes(`${s.side}:${s.slot}`)) s.onIce = false;
}
/** Gives the skater `id` the job `job` (his held plan). */
function setJob(st: GameState, id: string, job: Job): void {
  const i = st.skaters.findIndex((s) => s.id === id);
  st.plans[i]!.job = job;
}
/** Sends the puck at `speed` m/s along the ice toward `to`. */
function aimAt(p: Puck, to: { x: number; y: number }, speed: number): void {
  const dx = to.x - p.pos.x, dy = to.y - p.pos.y, l = Math.hypot(dx, dy);
  p.vel = { x: (dx / l) * speed, y: (dy / l) * speed };
}

// ---- blocks ----

/**
 * The home LD shoots from the point at (9.5, 6) with the away LD (shotBlocking 100) standing 6 m out from the net centre
 * in its lane, the only other skater on the ice; the shot is stepped (tryBlock, then the puck) until it is blocked or ends.
 */
function blockedShot(seed: number): { block: boolean; puck: { x: number; y: number }; blocker: { x: number; y: number } } {
  const st = stateWith({ carrier: 'home', puckX: 9.5, puckY: 6, carrierSlot: 'LD' });
  only(st, ['home:LD', 'away:LD']);
  const shooter = skater(st, 'home', 'LD');
  st.puck.pos = { x: 9.5, y: 6 };
  const nx = 27.13, l = Math.hypot(nx - 9.5, 6);
  const blocker = skater(st, 'away', 'LD');
  blocker.pos = { x: nx - (6 * (nx - 9.5)) / l, y: (6 * 6) / l };
  const ds = new Map(defs);
  ds.set(blocker.id, { ...def({ shotBlocking: 100 }), id: blocker.id, position: 'LD' });
  const rng = createRng(seed);
  executeShot(st, shooter.id, ds, rng, [], 'wrist');
  for (let t = 0; t < 90 && st.shotInFlight !== null; t++) {
    const out: GameEvent[] = [];
    if (tryBlock(st, ds, rng, out)) return { block: true, puck: { ...st.puck.pos }, blocker: { ...blocker.pos } };
    trackShot(st, stepPuck(st.puck, DT), out);
  }
  return { block: false, puck: { ...st.puck.pos }, blocker: { ...blocker.pos } };
}

let blockSeq = 0;
/** Share of `n` single tryBlock rolls that block: a home shot at 30 m/s along +x from (15, 0), `d` (the away LD) standing on its path 1 m ahead of the puck, 1.6 m from the shooter. */
function blockShare(d: PlayerDef, n: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) {
    const st = stateWith({ carrier: 'home', puckX: 15 });
    only(st, ['home:RW', 'away:LD']);
    const shooter = skater(st, 'home', 'RW');
    st.carrierId = null;
    st.puck.pos = { x: 15, y: 0 };
    st.puck.vel = { x: 30, y: 0 };
    st.shotInFlight = { shooterId: shooter.id, side: 'home', from: { x: 15, y: 0 }, fromDist: 12.13, tick: 0, blockTried: [], shotType: 'wrist' };
    shooter.pos = { x: 14.4, y: 0 };
    skater(st, 'away', 'LD').pos = { x: 16, y: 0 };
    const ds = new Map(defs);
    ds.set('away-LD', { ...d, id: 'away-LD', position: 'LD' });
    if (tryBlock(st, ds, createRng(++blockSeq))) k++;
  }
  return k / n;
}

// ---- one-timers ----

let base: { setup: GameSetup; state: GameState } | null = null;
function baseGame(): { setup: GameSetup; state: GameState } {
  if (base) return base;
  const setup = gameSetup(1);
  const g = createGame(setup);
  while (g.state.phase !== 'live') g.step();
  base = { setup, state: JSON.parse(JSON.stringify(g.state)) as GameState };
  return base;
}

/**
 * The home LW low on the left wall at (22, 8) passes across the slot to the home RW at (21, -3.5), both facing each other;
 * two away defencemen goal-side by the net, the other three far up ice. Played out with seed `seed` until the RW lets it
 * go (or 3 s). Returns whether the pass was flagged a one-timer, whether he took it, and his first release.
 */
function crossSlot(seed: number): { flagged: boolean; took: boolean; release: GameEvent | null } {
  const { setup, state } = baseGame();
  const st = JSON.parse(JSON.stringify(state)) as GameState;
  const bySlot = (side: 'home' | 'away', slot: string): SkaterState => st.skaters.find((s) => s.onIce && s.side === side && s.slot === slot)!;
  const put = (s: SkaterState, x: number, y: number, facing: number): void => { s.pos = { x, y }; s.target = { x, y }; s.vel = { x: 0, y: 0 }; s.facing = facing; s.faceTarget = null; };
  const dir = st.attackDir.home;
  const lw = bySlot('home', 'LW'), rw = bySlot('home', 'RW');
  put(lw, 22 * dir, 8 * dir, Math.atan2((-3.5 - 8) * dir, (21 - 22) * dir));
  put(rw, 21 * dir, -3.5 * dir, Math.atan2((8 + 3.5) * dir, (22 - 21) * dir));
  put(bySlot('home', 'C'), 14 * dir, 2 * dir, 0); put(bySlot('home', 'LD'), 9 * dir, 7 * dir, 0); put(bySlot('home', 'RD'), 9 * dir, -7 * dir, 0);
  put(bySlot('away', 'LD'), 25.5 * dir, 1.5 * dir, Math.PI); put(bySlot('away', 'RD'), 25.5 * dir, -6 * dir, Math.PI);
  put(bySlot('away', 'C'), -5 * dir, 0, Math.PI); put(bySlot('away', 'LW'), -5 * dir, 6 * dir, Math.PI); put(bySlot('away', 'RW'), -5 * dir, -6 * dir, Math.PI);
  for (const s of st.skaters) s.contestId = null;
  st.contests = []; st.carrierId = lw.id; st.possession = 'home'; st.lastTouch = { id: lw.id, side: 'home' }; st.pendingPass = null;
  st.pickupBlock = null; st.shotInFlight = null; st.carrierPlan = null; st.delayedOffside = null; st.icingWatch = null; st.tiedUpUntil = [];
  const ds = new Map<string, PlayerDef>([...setup.home.players, ...setup.away.players].map((p) => [p.id, p]));
  bladePos(lw.pos, lw.facing, ds.get(lw.id)!.shoots, st.puck.pos);
  st.puck.vel = { x: 0, y: 0 };
  st.rng = createRng(seed * 7919 + 3).getState();
  const g = restoreGame(setup, st, []);
  executePass(g.state, lw.id, rw.id, ds, createRng(seed));
  const flagged = g.state.pendingPass?.oneTimer === true;
  let took = false;
  g.drainEvents();
  for (let t = 0; t < Math.round(3 / DT) && g.state.phase === 'live'; t++) {
    g.step();
    if (g.state.carrierId === rw.id) took = true;
    for (const e of g.drainEvents()) if (e.type === 'release' && e.playerId === rw.id) return { flagged, took, release: e };
    if (g.state.carrierId !== null && g.state.carrierId !== rw.id) break;
  }
  return { flagged, took, release: null };
}

/** Of `n` crossSlot passes he took, the share he one-timed (his first release a shot of type oneTimer). */
const oneTimerCache = new Map<number, number>();
function oneTimerShare(n: number): number {
  const c = oneTimerCache.get(n);
  if (c !== undefined) return c;
  let took = 0, oneTimed = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = crossSlot(seed);
    expect(r.flagged).toBe(true);
    if (!r.took) continue;
    took++;
    if (r.release !== null && r.release.type === 'release' && r.release.detail.kind === 'shot' && r.release.detail.shotType === 'oneTimer') oneTimed++;
  }
  expect(took).toBeGreaterThan(n / 2);
  const share = oneTimed / took;
  oneTimerCache.set(n, share);
  return share;
}

// ---- shot types ----

/** The home C shoots `type` from (15, 4) at the net, alone on the ice: puck speeds and where 2,000 shots would cross the goal line. */
function shotSample(type: ShotType): { speed: number; spread: number } {
  let speed = 0;
  const ys: number[] = [];
  for (let seed = 1; seed <= 2000; seed++) {
    const st = stateWith({ carrier: 'home', puckX: 15, puckY: 4, carrierSlot: 'C' });
    only(st, ['home:C']);
    st.puck.pos = { x: 15, y: 4 };
    executeShot(st, 'home-C', defs, createRng(seed), [], type);
    const v = st.puck.vel;
    speed += Math.hypot(v.x, v.y);
    ys.push(st.puck.pos.y + (v.y * (27.13 - st.puck.pos.x)) / v.x);
  }
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  return { speed: speed / 2000, spread: Math.sqrt(ys.reduce((a, y) => a + (y - mean) * (y - mean), 0) / ys.length) };
}
const shotSpeed = (t: ShotType): number => shotSample(t).speed;
const shotSpread = (t: ShotType): number => shotSample(t).spread;

describe('shots (Task 7)', () => {
  it('a blocked shot stops at the blocker: within his body radius plus 0.3 m, every time', () => {
    let blocks = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const b = blockedShot(seed);
      if (!b.block) continue;
      blocks++;
      expect(Math.hypot(b.puck.x - b.blocker.x, b.puck.y - b.blocker.y)).toBeLessThanOrEqual(bodyRadius(85) + 0.3);
    }
    expect(blocks).toBeGreaterThan(30);
    expect(blockShare(def({ shotBlocking: 100 }), 600)).toBeLessThanOrEqual(0.97); expect(blockShare(def({ shotBlocking: 1 }), 600)).toBeGreaterThanOrEqual(0.03);
  });
  // The brief counts from tick 13, but from (9, 6) at 35 m/s the puck reaches the end boards only at tick 20 (it is still
  // 8 m off them in flight): it is measured from when it first reaches the boards.
  it('a missed shot rings round the boards and stays in play', () => {
    for (const y of [-1.9, 1.6, 2.5]) {
      const p = puckAt(9, 6, 0, 0); aimAt(p, { x: 27.13, y }, 35); let maxOff = 0, reached = false;
      for (let t = 0; t < 45; t++) { run(p, DT); if (distToBoards(p.pos) < 0.5) reached = true; if (reached) maxOff = Math.max(maxOff, distToBoards(p.pos)); }
      expect(reached).toBe(true);
      expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(30.48); expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(12.955);
      expect(maxOff).toBeLessThan(4.5); // it follows the boards; it does not come back out through the slot
      expect(Math.hypot(p.vel.x, p.vel.y)).toBeGreaterThan(3);
    }
  });
  it('a lifted puck that hits the boards keeps its height and falls back in', () => {
    const p = puckAt(25, 0, 0, 30, 1.0, 2); run(p, 1);
    expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(12.955); expect(p.z).toBe(0);
  });
  it('a defenceman at the point shoots when there is traffic and a lane, and holds it when there is neither', () => {
    const st = stateWith({ carrier: 'home', puckX: 9.5, puckY: 6, carrierSlot: 'LD' }); for (const s of st.skaters) if (s.side === 'away') s.pos = { x: 20, y: -9 };
    place(st, 'home:C', 25.4, 0.2); setJob(st, 'home-C', 'netFront');
    const withTraffic = rate('shoot', def({}), st);
    place(st, 'home:C', 15, -9); setJob(st, 'home-C', 'highForward'); place(st, 'away:LD', 14, 4.5); // nobody in front, a defender in the lane
    expect(withTraffic).toBeGreaterThan(0.12); expect(rate('shoot', def({}), st)).toBeLessThan(withTraffic * 0.4);
  });
  it('a pass across the slot to a man in a scoring area is one-timed more often than not', () => {
    expect(oneTimerShare(600)).toBeGreaterThan(0.5); expect(oneTimerShare(600)).toBeLessThanOrEqual(0.97);
  }, 120_000);
  it('shot types: a slapshot is harder and wilder than a wrist shot, a backhand softer', () => {
    expect(shotSpeed('slap')).toBeGreaterThan(shotSpeed('wrist') * 1.08); expect(shotSpread('slap')).toBeGreaterThan(shotSpread('wrist')); expect(shotSpeed('backhand')).toBeLessThan(shotSpeed('wrist') * 0.8);
  });
});
