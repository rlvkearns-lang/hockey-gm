import { describe, it, expect } from 'vitest';
import { planPass, receiveChance, stickInterceptChance, type PassPlan } from '../src/passing';
import { executePass, tryIntercept } from '../src/actions';
import { bladePos } from '../src/blade';
import { createGame, restoreGame } from '../src/game';
import { stepPuck } from '../src/puck';
import { createRng } from '../src/rng';
import { DT } from '../src/constants';
import type { GameSetup, GameState, PassHand, PlayerDef, SkaterState } from '../src/types';
import { def, defs, gameSetup, place, skater, stateWith } from './helpers';

/** Only these skaters stay on the ice (by side and slot, e.g. 'home:C'). */
function only(st: GameState, keep: string[]): void {
  for (const s of st.skaters) if (!keep.includes(`${s.side}:${s.slot}`)) s.onIce = false;
}
/** The carrier's puck on his blade. */
function puckOnBlade(st: GameState, c: SkaterState, d: PlayerDef): void { bladePos(c.pos, c.facing, d.shoots, st.puck.pos); }

// ---- a point pass in a real game ----

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
 * The passer low on the wall at (22, 11), nobody near (the other side up at the far blue line); his LD holding the
 * point at (8.2, 8.5), facing the puck. The pass is made with seed `seed`; the game is then stepped until someone
 * carries the puck or 3 s pass.
 */
function pointPass(seed: number): { aim: { x: number; y: number }; minPuckX: number; carrier: string | null } {
  const { setup, state } = baseGame();
  const st = JSON.parse(JSON.stringify(state)) as GameState;
  expect(st.attackDir.home).toBe(1);
  const bySlot = (slot: string): SkaterState => st.skaters.find((s) => s.onIce && s.side === 'home' && s.slot === slot)!;
  const put = (s: SkaterState, x: number, y: number, facing: number): void => { s.pos = { x, y }; s.target = { x, y }; s.vel = { x: 0, y: 0 }; s.facing = facing; s.faceTarget = null; };
  const rw = bySlot('RW'), ld = bySlot('LD');
  put(rw, 22, 11, Math.atan2(8.5 - 11, 8.2 - 22));
  put(ld, 8.2, 8.5, Math.atan2(11 - 8.5, 22 - 8.2));
  put(bySlot('C'), 20, 0, 0); put(bySlot('LW'), 18, -6, 0); put(bySlot('RD'), 8.5, -6, 0);
  let k = 0;
  for (const s of st.skaters) if (s.onIce && s.side === 'away') put(s, -8, -8 + 4 * k++, Math.PI);
  for (const s of st.skaters) s.contestId = null;
  st.contests = []; st.carrierId = rw.id; st.possession = 'home'; st.lastTouch = { id: rw.id, side: 'home' }; st.pendingPass = null;
  st.pickupBlock = null; st.shotInFlight = null; st.carrierPlan = null; st.delayedOffside = null; st.icingWatch = null; st.tiedUpUntil = [];
  const ds = new Map<string, PlayerDef>([...setup.home.players, ...setup.away.players].map((p) => [p.id, p]));
  puckOnBlade(st, rw, ds.get(rw.id)!);
  st.puck.vel = { x: 0, y: 0 };
  st.rng = createRng(seed * 7919 + 1).getState();
  const g = restoreGame(setup, st, []);
  executePass(g.state, rw.id, ld.id, ds, createRng(seed));
  const aim = { ...g.state.pendingPass!.aim };
  let minPuckX = g.state.puck.pos.x;
  for (let t = 0; t < Math.round(3 / DT) && g.state.carrierId === null && g.state.phase === 'live'; t++) {
    g.step();
    minPuckX = Math.min(minPuckX, g.state.puck.pos.x);
  }
  return { aim, minPuckX, carrier: g.state.carrierId === ld.id ? 'home-LD' : g.state.carrierId };
}

// ---- passes with a given hand, at a given length ----

const HAND_ANGLE: Record<PassHand, number> = { forehand: 0, backhand: Math.PI / 2, behind: Math.PI };
/** The home RW (shoots L, facing +x) passes 7 m to the home C, who is ahead of him (forehand), to his left (backhand) or behind him. */
function handPass(hand: PassHand, seed: number): { speed: number; miss: number } {
  const st = stateWith({ carrier: 'home', puckX: 0 });
  only(st, ['home:RW', 'home:C']);
  const rw = skater(st, 'home', 'RW');
  puckOnBlade(st, rw, defs.get(rw.id)!);
  const a = HAND_ANGLE[hand];
  place(st, 'home:C', rw.pos.x + 7 * Math.cos(a), rw.pos.y + 7 * Math.sin(a));
  const c = skater(st, 'home', 'C');
  c.facing = a + Math.PI;
  executePass(st, rw.id, c.id, defs, createRng(seed));
  const aim = st.pendingPass!.aim, p = st.puck;
  const want = Math.atan2(aim.y - p.pos.y, aim.x - p.pos.x), got = Math.atan2(p.vel.y, p.vel.x);
  let miss = got - want;
  while (miss > Math.PI) miss -= 2 * Math.PI;
  while (miss < -Math.PI) miss += 2 * Math.PI;
  return { speed: Math.hypot(p.vel.x, p.vel.y), miss: Math.abs(miss) };
}
const passMiss = (hand: PassHand): number => { let s = 0; for (let i = 1; i <= 2000; i++) s += handPass(hand, i).miss; return s / 2000; };
const passSpeed = (hand: PassHand): number => handPass(hand, 1).speed;

/** The plan for a pass from the home RW (facing +x, at x = -15) to the home C `d` m straight ahead of the puck, facing back at him, nobody else on the ice. */
function planAt(d: number): PassPlan | null {
  const st = stateWith({ carrier: 'home', puckX: -15 });
  only(st, ['home:RW', 'home:C']);
  const rw = skater(st, 'home', 'RW');
  puckOnBlade(st, rw, defs.get(rw.id)!);
  place(st, 'home:C', st.puck.pos.x + d, st.puck.pos.y);
  skater(st, 'home', 'C').facing = Math.PI;
  return planPass(st, rw, skater(st, 'home', 'C'), defs, {} as PassPlan);
}

// ---- interceptions ----

let seedSeq = 0;
/**
 * Share of `n` passes intercepted (taken or deflected) by the away LD, the only opponent, half way along a 16 m pass
 * along y = 0 from the home C to a still home LW (whose blade is at (11.1, 0)), with his blade `bladeOffLane` m and his
 * body `bodyOffLane` m (default 0.4 further) off the lane. Each pass is played out with the puck physics and tryIntercept.
 */
function interceptShareWith(o: { bladeOffLane: number; bodyOffLane?: number }, n: number): number {
  const body = o.bodyOffLane ?? o.bladeOffLane + 0.4;
  // His facing: the one that puts his (left-shot) blade bladeOffLane off the lane with his body bodyOffLane off it.
  let facing = 0, err = Infinity;
  for (let k = 0; k < 3600; k++) {
    const f = -Math.PI + (k / 3600) * 2 * Math.PI;
    const e = Math.abs(body + 0.9 * Math.sin(f) + 0.4 * Math.cos(f) - o.bladeOffLane);
    if (e < err) { err = e; facing = f; }
  }
  expect(err).toBeLessThan(0.01);
  let caught = 0;
  for (let i = 0; i < n; i++) {
    const st = stateWith({ carrier: 'home', puckX: -5, carrierSlot: 'C' });
    only(st, ['home:C', 'home:LW', 'away:LD']);
    st.puck.pos = { x: -5, y: 0 };
    place(st, 'home:LW', 12, 0.4); skater(st, 'home', 'LW').facing = Math.PI;
    place(st, 'away:LD', 3, body); skater(st, 'away', 'LD').facing = facing;
    const rng = createRng(++seedSeq);
    executePass(st, 'home-C', 'home-LW', defs, rng);
    for (let t = 0; t < 30 && st.pendingPass !== null; t++) {
      st.tick++;
      const prev = { x: st.puck.pos.x, y: st.puck.pos.y };
      stepPuck(st.puck, DT);
      if (tryIntercept(st, defs, rng, prev)) { caught++; break; }
      if (st.puck.pos.x > 5) break;
    }
  }
  return caught / n;
}

/**
 * Share of `n` passes (the interceptShareWith set-up) picked off or deflected by the away LD standing half way along the
 * lane, his body `off` m to its side and facing away from it (his blade further off): with `off` 1.6 m he can get his stick
 * into the lane before the puck gets there (the lane is covered), with 4 m he cannot.
 */
function reachShare(off: number, n: number): { share: number; cover: number } {
  let caught = 0, cover = 0;
  for (let i = 0; i < n; i++) {
    const st = stateWith({ carrier: 'home', puckX: -5, carrierSlot: 'C' });
    only(st, ['home:C', 'home:LW', 'away:LD']);
    st.puck.pos = { x: -5, y: 0 };
    place(st, 'home:LW', 12, 0.4); skater(st, 'home', 'LW').facing = Math.PI;
    place(st, 'away:LD', 3, off); skater(st, 'away', 'LD').facing = Math.PI / 2;
    const rng = createRng(++seedSeq);
    executePass(st, 'home-C', 'home-LW', defs, rng);
    cover += st.pendingPass!.cover;
    for (let t = 0; t < 30 && st.pendingPass !== null; t++) {
      st.tick++;
      const prev = { x: st.puck.pos.x, y: st.puck.pos.y };
      stepPuck(st.puck, DT);
      if (tryIntercept(st, defs, rng, prev)) { caught++; break; }
      if (st.puck.pos.x > 5) break;
    }
  }
  return { share: caught / n, cover: cover / n };
}

describe('passing: a pass the receiver can take (Task 6)', () => {
  it('a point pass is aimed at least 1.5 m inside the line and stays in: 500 seeds, 95% reach the defenceman in the zone', () => {
    let kept = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const h = pointPass(seed);
      expect(h.aim.x).toBeGreaterThanOrEqual(7.62 + 1.5 - 1e-9);
      if (h.minPuckX > 7.57 && h.carrier === 'home-LD') kept++;
    }
    expect(kept / 500).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
  // Task 7 step 0: a lane a defender can close is covered (riskier), not removed; a body in the lane still stops it.
  it('a pass he cannot make is not an option: a lane a body stands in, a 20 m backhand, a 12 m pass behind him', () => {
    const out = {} as PassPlan; const st = stateWith({ carrier: 'home', puckX: 0 }); const from = skater(st, 'home', 'RW');
    // stateWith stands the away C 1.5 m in front of the puck, his body in the lane: he starts out of it.
    place(st, 'away:C', 6, 8);
    place(st, 'home:C', 12, 0); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)).not.toBeNull();
    place(st, 'away:C', 6, 1.5); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)?.cover).toBeGreaterThan(0.8); // a stick in the lane: covered
    place(st, 'away:C', 6, 0.3); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)).toBeNull();
    place(st, 'away:C', -20, 0); place(st, 'home:C', -12, 0); expect(planPass(st, from, skater(st, 'home', 'C'), defs, out)).toBeNull(); // 12 m straight behind
  });
  it('a 20 m backhand is out of range and a 12 m one is not', () => {
    const st = stateWith({ carrier: 'home', puckX: 0, puckY: -10 });
    only(st, ['home:RW', 'home:C']);
    const rw = skater(st, 'home', 'RW'); puckOnBlade(st, rw, defs.get(rw.id)!);
    const out = {} as PassPlan;
    place(st, 'home:C', rw.pos.x, rw.pos.y + 20); skater(st, 'home', 'C').facing = -Math.PI / 2;
    expect(planPass(st, rw, skater(st, 'home', 'C'), defs, out)).toBeNull();
    place(st, 'home:C', rw.pos.x, rw.pos.y + 12);
    expect(planPass(st, rw, skater(st, 'home', 'C'), defs, out)?.hand).toBe('backhand');
  });
  it('backhand and behind-the-back passes are slower and wilder', () => {
    expect(passMiss('backhand')).toBeGreaterThan(passMiss('forehand') * 1.3); expect(passMiss('behind')).toBeGreaterThan(passMiss('backhand') * 1.2);
    expect(passSpeed('backhand')).toBeLessThan(passSpeed('forehand') * 0.8);
  });
  it('the right weight: a pass arrives at 6 to 16 m/s whatever its length', () => {
    for (const d of [4, 10, 20, 30]) { const p = planAt(d)!; expect(p.arriveSpeed).toBeGreaterThan(6); expect(p.arriveSpeed).toBeLessThanOrEqual(16); }
  });
  // The brief's formula (0.97, less 0.02 per m/s over 12, less 0.15 from behind, 0.002 per point of puckHandling over
  // 70) gives 0.122 at puckHandling 1, 40 m/s, from behind: the clamp at 0.03 is checked at 80 m/s (see task-6-report.md).
  it('receiving is never certain and never hopeless', () => {
    expect(receiveChance(def({ puckHandling: 100 }), 8, false)).toBe(0.97); expect(receiveChance(def({ puckHandling: 30 }), 16, true)).toBeGreaterThan(0.5);
    expect(receiveChance(def({ puckHandling: 1 }), 40, true)).toBeGreaterThanOrEqual(0.03); expect(receiveChance(def({ puckHandling: 1 }), 80, true)).toBe(0.03);
  });
  it('a stick in the lane picks off or deflects more passes than a body near it, inside the clamps', () => {
    const stick = interceptShareWith({ bladeOffLane: 0.3 }, 2000), body = interceptShareWith({ bladeOffLane: 1.5, bodyOffLane: 0.85 }, 2000);
    expect(stick).toBeGreaterThan(body * 1.3); expect(stick).toBeLessThanOrEqual(0.97); expect(body).toBeGreaterThanOrEqual(0.03);
    expect(stickInterceptChance(def({ stickChecking: 100, defensivePositioning: 100 }), 12)).toBeLessThanOrEqual(0.97);
  }, 60_000);
  // Task 7 step 0: a covered lane is riskier, not removed.
  it('a pass into a covered lane is picked off or deflected clearly more often than one into an open lane', () => {
    const covered = reachShare(1.6, 2000), open = reachShare(4, 2000);
    expect(covered.cover).toBeGreaterThan(0.3); expect(open.cover).toBe(0);
    expect(covered.share).toBeGreaterThan(0.05); expect(covered.share).toBeGreaterThan(open.share * 3 + 0.02); expect(covered.share).toBeLessThanOrEqual(0.97);
  }, 60_000);
});
