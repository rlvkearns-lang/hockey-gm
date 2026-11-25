import { describe, it, expect } from 'vitest';
import { DT } from '../src/constants';
import { createGame, restoreGame, simulateGame } from '../src/game';
import { FACEOFF_MAX_SECONDS, FACEOFF_MIN_SECONDS, faceoffFacing, faceoffPosition, linedUp, setupFaceoff } from '../src/faceoff';
import { FACEOFF_DOTS, RINK } from '../src/rink';
import { wrapAngle } from '../src/skating';
import { bladePos } from '../src/blade';
import type { GameEvent, GameSetup, GameState, Position, Side } from '../src/types';
import type { Vec2 } from '../src/vec';
import { gameSetup } from './helpers';

const GAME_TIMEOUT = 30_000;
const DEG = Math.PI / 180;
/** Radius of a faceoff circle (15 ft). */
const CIRCLE = 4.57;
const SLOTS = ['C', 'LW', 'RW', 'LD', 'RD'] as const;
const upIce = (dir: 1 | -1): number => (dir === 1 ? 0 : Math.PI);

/**
 * A game of `setup` stopped for a draw at `dot` with home attacking `dir` (the goalies in their creases for it), stepped
 * until the puck drops. Returns the state at the drop and how long the setup took (s).
 */
function drawAt(setup: GameSetup, dot: Vec2, dir: 1 | -1): { state: GameState; seconds: number } {
  const g = createGame(setup);
  const s = g.state;
  s.attackDir = { home: dir, away: dir === 1 ? -1 : 1 };
  for (const side of ['home', 'away'] as const) {
    const gl = s.goalies[side];
    gl.pos = { x: -s.attackDir[side] * (RINK.goalLineX - 0.9), y: 0 };
    gl.facing = upIce(s.attackDir[side]);
  }
  setupFaceoff(s, dot);
  let t = 0;
  while (g.state.phase === 'faceoffSetup') { g.step(); t += DT; }
  return { state: g.state, seconds: t };
}

/** gameSetup(seed) with both teams' centres shooting `home` and `away`. */
function withCentres(seed: number, home: 'L' | 'R', away: 'L' | 'R'): GameSetup {
  const s = gameSetup(seed);
  for (const [side, hand] of [['home', home], ['away', away]] as const) {
    const cs = new Set(s[side].lines.forwards.map((l) => l[1]));
    s[side].players = s[side].players.map((p) => (cs.has(p.id) ? { ...p, shoots: hand } : p));
  }
  return s;
}

describe('faceoff line-up', () => {
  it('everyone lines up on his own side of the dot: centres over it, wingers on the circle, defencemen behind', () => {
    for (const dot of [FACEOFF_DOTS.centre, ...FACEOFF_DOTS.neutral, ...FACEOFF_DOTS.end]) for (const dir of [1, -1] as const) {
      const at = (slot: Position): Vec2 => faceoffPosition(dot, slot, dir);
      for (const slot of SLOTS) expect((at(slot).x - dot.x) * dir).toBeLessThan(0);
      expect(Math.hypot(at('C').x - dot.x, at('C').y - dot.y)).toBeLessThan(0.8);
      // (Task 13b, item 7: at a circle the wingers stand far enough out that a man within the line-up tolerance, 0.6 m, of
      // his spot is still outside it.)
      if (Math.abs(dot.y) < 1) { expect(Math.hypot(at('LW').x - dot.x, at('LW').y - dot.y)).toBeGreaterThan(CIRCLE + 0.6); expect(Math.hypot(at('LW').x - dot.x, at('LW').y - dot.y)).toBeLessThan(5.6); }
      expect((dot.x - at('LD').x) * dir).toBeGreaterThan(Math.abs(dot.x) > RINK.blueLineX ? 2.5 : 4);
    }
  });

  // Task 13 review, Minor 1 (Task 13b item 7a): an end-zone draw has its own line-up. Attacking: defencemen at the points
  // (just inside the blue line, one near the boards on the draw's side, one toward the middle), wingers on the hash marks
  // (one toward the boards, one toward the slot). Defending: wingers on the hash marks, one defenceman in front of the net,
  // one behind the boards-side winger, neither near the goal line in the corner. Neutral-zone dots keep their table.
  it('an end-zone draw lines up as in hockey: attacking defencemen at the points, wingers on the hash marks, a defender at the net front (four dots, both ways)', () => {
    const BLUE = RINK.blueLineX, GOAL = RINK.goalLineX;
    for (const dot of FACEOFF_DOTS.end) for (const dir of [1, -1] as const) {
      const at = (slot: Position): Vec2 => faceoffPosition(dot, slot, dir);
      const rx = (p: Vec2): number => p.x * dir;
      const toBoards = Math.sign(dot.y);
      const ds = [at('LD'), at('RD')], ws = [at('LW'), at('RW')];
      for (const w of ws) { const r = Math.hypot(w.x - dot.x, w.y - dot.y); expect(r).toBeGreaterThan(CIRCLE + 0.6); expect(r).toBeLessThan(5.6); expect(Math.abs(w.x - dot.x)).toBeLessThan(1.2); }
      expect(ws.filter((w) => Math.sign(w.y - dot.y) === toBoards).length).toBe(1);
      if (dot.x * dir > 0) {
        for (const d of ds) { expect(rx(d)).toBeGreaterThan(BLUE + 0.3); expect(rx(d)).toBeLessThan(BLUE + 2.5); }
        expect(ds.filter((d) => Math.sign(d.y) === toBoards && Math.abs(d.y) > 9).length).toBe(1);
        expect(ds.filter((d) => Math.abs(d.y) < 2.5).length).toBe(1);
      } else {
        for (const d of ds) { expect(rx(d)).toBeLessThan(-(GOAL - 6)); expect(rx(d)).toBeGreaterThan(-(GOAL - 2.5)); expect(Math.hypot(d.x - dot.x, d.y - dot.y)).toBeGreaterThan(CIRCLE + 0.6); }
        expect(ds.filter((d) => Math.hypot(rx(d) + GOAL, d.y) < 4.5 && Math.abs(d.y) < 3).length).toBe(1);
        expect(ds.filter((d) => Math.sign(d.y) === toBoards && Math.abs(d.y) > 9).length).toBe(1);
      }
    }
  });
  it('neutral-zone dots keep their line-up: wingers 4.6 m to the sides, defencemen 5 m behind', () => {
    for (const dot of FACEOFF_DOTS.neutral) for (const dir of [1, -1] as const) {
      expect(faceoffPosition(dot, 'LW', dir)).toEqual({ x: dot.x - dir * 0.9, y: dot.y + dir * 4.6 });
      expect(faceoffPosition(dot, 'RD', dir)).toEqual({ x: dot.x - dir * 5, y: dot.y - dir * 2.5 });
    }
  });

  it('a centre faces the dot; everyone else faces straight up ice', () => {
    const dot = FACEOFF_DOTS.end[2]!;
    for (const dir of [1, -1] as const) {
      const c = faceoffPosition(dot, 'C', dir);
      expect(Math.abs(wrapAngle(faceoffFacing(dot, 'C', dir, c) - upIce(dir)))).toBeLessThan(1e-9);
      const off = { x: c.x, y: c.y + 0.5 };
      expect(faceoffFacing(dot, 'C', dir, off)).toBeCloseTo(Math.atan2(dot.y - off.y, dot.x - off.x), 9);
      for (const slot of ['LW', 'RW', 'LD', 'RD'] as const) expect(faceoffFacing(dot, slot, dir, faceoffPosition(dot, slot, dir))).toBe(upIce(dir));
    }
  });

  // Controller's carried requirement: every skater's facing at the drop, nine dots, both attack directions, left- and
  // right-handed centres (a centre squares up over the dot whichever hand he shoots).
  it('at the drop on every dot, both ways, with left- and right-handed centres: centres square across the dot, the rest face up ice, all on their own side and outside the circle', () => {
    const bad: string[] = [];
    let worstCentres = 0, worstOthers = 0, nearestCircle = Infinity;
    const dots: [string, Vec2, boolean][] = [
      ['centre', FACEOFF_DOTS.centre, true], ...FACEOFF_DOTS.neutral.map((d, i): [string, Vec2, boolean] => [`neutral ${i}`, d, false]),
      ...FACEOFF_DOTS.end.map((d, i): [string, Vec2, boolean] => [`end ${i}`, d, true]),
    ];
    for (const [name, dot, circle] of dots) for (const dir of [1, -1] as const) for (const [hh, ah] of [['L', 'R'], ['R', 'L']] as const) {
      const { state: s, seconds } = drawAt(withCentres(3, hh, ah), dot, dir);
      const at = `${name} dir ${dir} centres ${hh}/${ah}`;
      if (seconds >= FACEOFF_MAX_SECONDS - 1e-6) bad.push(`${at}: setup ran to the limit`);
      const centre = (side: Side) => s.skaters.find((k) => k.onIce && k.side === side && k.slot === 'C')!;
      const square = Math.abs(wrapAngle(centre('home').facing - centre('away').facing - Math.PI));
      worstCentres = Math.max(worstCentres, square);
      if (square > 10 * DEG) bad.push(`${at}: centres ${(square / DEG).toFixed(1)} deg off square`);
      for (const k of s.skaters) {
        if (!k.onIce) continue;
        const d = s.attackDir[k.side];
        if ((k.pos.x - dot.x) * d >= 0) bad.push(`${at}: ${k.slot} of ${k.side} offside of the dot`);
        if (k.slot === 'C') {
          const toDot = Math.abs(wrapAngle(k.facing - Math.atan2(dot.y - k.pos.y, dot.x - k.pos.x)));
          if (toDot > 10 * DEG) bad.push(`${at}: ${k.side} centre ${(toDot / DEG).toFixed(1)} deg off the dot`);
          continue;
        }
        const off = Math.abs(wrapAngle(k.facing - upIce(d)));
        worstOthers = Math.max(worstOthers, off);
        if (off > 20 * DEG) bad.push(`${at}: ${k.slot} of ${k.side} ${(off / DEG).toFixed(1)} deg off up ice`);
        const r = Math.hypot(k.pos.x - dot.x, k.pos.y - dot.y);
        if (circle) { nearestCircle = Math.min(nearestCircle, r); if (r < CIRCLE) bad.push(`${at}: ${k.slot} of ${k.side} inside the circle (${r.toFixed(2)} m)`); }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
    // The numbers (Task 13 report): centres within 10 degrees of square, everyone else within 20 of up ice.
    expect(worstCentres).toBeLessThan(10 * DEG);
    expect(worstOthers).toBeLessThan(20 * DEG);
    // Task 13 review, Minor 7: outside means outside (it was CIRCLE - 0.3).
    expect(nearestCircle).toBeGreaterThan(CIRCLE);
  }, GAME_TIMEOUT);

  it('at every drop of a game, every skater faces the right way: within 20 degrees of up ice, the centres at the dot', () => {
    const bad: string[] = []; const g = createGame(gameSetup(4)); let prev = g.state.phase;
    while (!g.done) { g.step(); const s = g.state;
      if (prev === 'faceoffSetup' && s.phase === 'live') for (const k of s.skaters) { if (!k.onIce) continue; const dir = s.attackDir[k.side];
        const off = Math.abs(wrapAngle(k.facing - (dir === 1 ? 0 : Math.PI))); if (off > (20 * Math.PI) / 180) bad.push(`${k.id} at tick ${s.tick}: ${off.toFixed(2)} rad`); }
      prev = s.phase; }
    expect(bad.slice(0, 5)).toEqual([]);
  }, GAME_TIMEOUT);

  it('at every drop of a game the two centres are within 10 degrees of square to each other (seeds 4 and 5)', () => {
    let worst = 0;
    for (const seed of [4, 5]) {
      const g = createGame(gameSetup(seed)); let prev = g.state.phase;
      while (!g.done) { g.step(); const s = g.state;
        if (prev === 'faceoffSetup' && s.phase === 'live') {
          const c = (side: Side) => s.skaters.find((k) => k.onIce && k.side === side && k.slot === 'C')!;
          worst = Math.max(worst, Math.abs(wrapAngle(c('home').facing - c('away').facing - Math.PI)));
        }
        prev = s.phase; }
    }
    expect(worst).toBeLessThan(10 * DEG);
  }, GAME_TIMEOUT * 2);

  it('setup takes as long as the players take to arrive: nobody is moved by force, and it is over within 20 s', () => {
    const g = createGame(gameSetup(5)); let setup = 0, longest = 0, forced = 0, n = 0, total = 0; let before = new Map<string, Vec2>();
    while (!g.done) { const was = g.state.phase; if (was === 'faceoffSetup') before = new Map(g.state.skaters.map((k) => [k.id, { ...k.pos }]));
      g.step(); const s = g.state;
      if (was === 'faceoffSetup' && s.phase === 'live') { n++; total += setup; longest = Math.max(longest, setup); setup = 0;
        for (const k of s.skaters) { const b = before.get(k.id)!; if (k.onIce && Math.hypot(k.pos.x - b.x, k.pos.y - b.y) > 0.5) forced++; } }
      else if (s.phase === 'faceoffSetup') setup += DT; }
    expect(forced).toBe(0); expect(longest).toBeLessThan(20); expect(total / n).toBeLessThan(9);
  }, GAME_TIMEOUT);

  it('the puck drops only once everyone is lined up (after the 3 s minimum), and the safety limit ends none of them (seeds 1-4)', () => {
    let drops = 0, capped = 0, early = 0;
    for (const seed of [1, 2, 3, 4]) {
      const g = createGame(gameSetup(seed));
      while (!g.done) {
        const was = g.state.phase, t = g.state.phaseT + DT;
        g.step();
        // The drop changes nobody's place, speed or facing: the line-up rule is read on the state it leaves.
        if (was === 'faceoffSetup' && g.state.phase === 'live') { drops++; if (t >= FACEOFF_MAX_SECONDS - 1e-6) capped++; else if (t < FACEOFF_MIN_SECONDS - 1e-6 || !linedUp(g.state)) early++; }
      }
    }
    expect(early).toBe(0);
    // Task 13 review, Minor 4: the limit is never what drops the puck (0 of 722 setups on seeds 1-16 at Task 13; read on
    // seeds 1-16 in play.test.ts too).
    expect(drops).toBeGreaterThan(100); expect(capped).toBe(0);
  }, GAME_TIMEOUT * 4);

  it('a line change still under way holds up the drop', () => {
    const g = createGame(gameSetup(2));
    let held = 0;
    while (!g.done) {
      g.step(); const s = g.state;
      if (s.phase === 'faceoffSetup' && s.phaseT > FACEOFF_MIN_SECONDS && (['home', 'away'] as const).some((side) => s.bench[side].forwards.changing || s.bench[side].defence.changing)) {
        held++; expect(linedUp(s)).toBe(false);
      }
      if (held > 0 && s.phase === 'live') break;
    }
    expect(held).toBeGreaterThan(0);
  }, GAME_TIMEOUT);

  it('restored mid-setup (players still skating to their spots), the game plays out exactly as the straight run', () => {
    const seed = 7, straight = simulateGame(gameSetup(seed));
    const g = createGame(gameSetup(seed));
    while (!(g.state.tick > 20_000 && g.state.phase === 'faceoffSetup' && g.state.phaseT > 1 && !linedUp(g.state))) g.step();
    const snap = JSON.parse(JSON.stringify({ state: g.state, events: g.result().events })) as { state: GameState; events: GameEvent[] };
    const resumed = restoreGame(gameSetup(seed), snap.state, snap.events);
    while (!resumed.done) resumed.step();
    expect(resumed.result()).toEqual(straight);
  }, GAME_TIMEOUT * 2);
});

// Controller's carried requirement (from Task 7): a won draw is a real moving puck, pulled back from the dot; whoever
// takes it first takes it on his blade (within 1.2 m of it, the whole-game hand-over bar), never from metres away.
describe('a won draw', () => {
  it('the puck slides back from the dot by its speed and the first man to take it has it within 1.2 m of his blade (seeds 1-2)', () => {
    let draws = 0, worstMove = 0, worstTake = 0;
    for (const seed of [1, 2]) {
      const setup = gameSetup(seed);
      const hand = new Map([...setup.home.players, ...setup.away.players].map((p) => [p.id, p.shoots]));
      const g = createGame(setup);
      let following = false, prev = { x: 0, y: 0, speed: 0 };
      while (!g.done) {
        const was = g.state.phase;
        g.step();
        const s = g.state, p = s.puck;
        if (was === 'faceoffSetup' && s.phase === 'live') {
          draws++; following = true;
          expect(Math.hypot(p.pos.x - s.faceoffSpot.x, p.pos.y - s.faceoffSpot.y)).toBeLessThan(1e-9);
        } else if (following) {
          if (s.phase !== 'live' || s.contests.length > 0) { following = false; continue; }
          const move = Math.hypot(p.pos.x - prev.x, p.pos.y - prev.y) - prev.speed * DT;
          if (s.carrierId === null) worstMove = Math.max(worstMove, move);
          else {
            const c = s.skaters.find((k) => k.id === s.carrierId)!;
            const b = bladePos(c.pos, c.facing, hand.get(c.id)!, { x: 0, y: 0 });
            worstTake = Math.max(worstTake, Math.max(0, move) + Math.hypot(b.x - p.pos.x, b.y - p.pos.y));
            following = false;
          }
        }
        prev = { x: p.pos.x, y: p.pos.y, speed: Math.hypot(p.vel.x, p.vel.y) };
      }
    }
    expect(draws).toBeGreaterThan(60);
    expect(worstMove).toBeLessThan(0.05);
    expect(worstTake).toBeLessThan(1.2);
  }, GAME_TIMEOUT * 2);
});

describe('the goalie at a stoppage', () => {
  it('after a frozen puck or a goal the goalie faces up ice, never the puck behind him', () => {
    const g = createGame(gameSetup(6)); let worst = 0;
    while (!g.done) { g.step(); const s = g.state; if (s.phase !== 'stopped' || s.phaseT < 0.6) continue;
      for (const side of ['home', 'away'] as const) worst = Math.max(worst, Math.abs(wrapAngle(s.goalies[side].facing - (s.attackDir[side] === 1 ? 0 : Math.PI)))); }
    expect(worst).toBeLessThan(0.2);
  }, GAME_TIMEOUT);

  it('while a draw is set up he stands in the middle of his crease and faces the dot', () => {
    const g = createGame(gameSetup(6)); let worstFace = 0, worstSpot = 0, n = 0;
    while (!g.done) { g.step(); const s = g.state; if (s.phase !== 'faceoffSetup' || s.phaseT < 2.5) continue;
      for (const side of ['home', 'away'] as const) {
        const gl = s.goalies[side], end = -s.attackDir[side], x = end * (RINK.goalLineX - 0.9);
        const f = s.faceoffSpot;
        worstFace = Math.max(worstFace, Math.abs(wrapAngle(gl.facing - Math.atan2(f.y - gl.pos.y, f.x - gl.pos.x))));
        worstSpot = Math.max(worstSpot, Math.hypot(gl.pos.x - x, gl.pos.y)); n++;
      } }
    expect(n).toBeGreaterThan(100); expect(worstFace).toBeLessThan(0.1); expect(worstSpot).toBeLessThan(0.05);
  }, GAME_TIMEOUT);
});

describe('stoppages', () => {
  it('the puck goes out of play now and then (seeds 1-4), and each time play stops for a faceoff at the spot named', () => {
    let outs = 0; const bad: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const g = createGame(gameSetup(seed)); let pending: { spot: Vec2; tick: number } | null = null;
      while (!g.done) {
        g.step();
        for (const e of g.drainEvents()) {
          if (e.type === 'outOfPlay') { outs++; pending = { spot: e.detail.spot, tick: e.tick }; if (g.state.phase !== 'stopped') bad.push(`seed ${seed} tick ${e.tick}: play not stopped`); }
          else if (e.type === 'faceoff' && pending) { if (e.detail.spot.x !== pending.spot.x || e.detail.spot.y !== pending.spot.y) bad.push(`seed ${seed} tick ${pending.tick}: faceoff elsewhere`); pending = null; }
        }
      }
    }
    expect(bad).toEqual([]); expect(outs).toBeGreaterThan(2);
  }, GAME_TIMEOUT * 4);
});

