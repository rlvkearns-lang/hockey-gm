import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';
import { createRng } from '../src/rng';
import { DT } from '../src/constants';
import { FACEOFF_MAX_SECONDS } from '../src/faceoff';
import { RINK } from '../src/rink';
import { bladePos } from '../src/blade';
import { setup as robustSetup } from './helpers';
import { isSkaterOf, runToPeriod, sum } from './helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

const setup = (seed = 1) => ({ home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northgate', 'NGT'), seed, chemistry: [] });

describe('game loop', () => {
  it('plays exactly three 20-minute periods', () => {
    const g = createGame(setup()); let ticks = 0; while (!g.done) { g.step(); ticks++; if (ticks > 2e6) throw new Error('runaway'); }
    expect(g.state.phase).toBe('final'); expect(g.result().events.filter(e => e.type === 'periodEnd').length).toBe(3);
  }, GAME_TIMEOUT);
  it('same seed, same game; different seed, different game', () => {
    expect(simulateGame(setup(5))).toEqual(simulateGame(setup(5)));
    expect(simulateGame(setup(5)).events).not.toEqual(simulateGame(setup(6)).events);
  }, GAME_TIMEOUT * 4);
  it('stepping in irregular bursts with reads between matches simulateGame', () => {
    const g = createGame(setup(5)), r = createRng(99); let seen = 0;
    while (!g.done) { for (let i = r.int(1, 400); i > 0 && !g.done; i--) g.step(); seen += g.drainEvents().length; JSON.stringify(g.state); }
    expect(g.result()).toEqual(simulateGame(setup(5))); expect(seen).toBe(g.result().events.length);
  }, GAME_TIMEOUT * 2);
  it('teams switch ends in the second period', () => { const g = createGame(setup()); const d1 = g.state.attackDir.home; runToPeriod(g, 2); expect(g.state.attackDir.home).toBe(-d1); }, GAME_TIMEOUT);
  it('every skater starts the next period rested', () => {
    const g = createGame(setup()); runToPeriod(g, 2);
    expect(g.state.period).toBe(2); expect(g.state.skaters.every((s) => s.energy === 1)).toBe(true);
  }, GAME_TIMEOUT);
  it('five skaters and a goalie per side, all inside the boards, every tick', () => {
    const g = createGame(setup(3)); const violations: string[] = [];
    while (!g.done) { g.step(); for (const side of ['home', 'away'] as const) if (g.state.onIce[side].length > 5 + 3) violations.push(`tick ${g.state.tick}: ${side} has ${g.state.onIce[side].length} on ice`);   // up to 3 extra mid-change
      for (const s of g.state.skaters) if (s.onIce && !(Math.abs(s.pos.x) <= 30.48 && Math.abs(s.pos.y) <= 12.955 && Number.isFinite(s.pos.x))) violations.push(`tick ${g.state.tick}: ${s.id} at ${s.pos.x},${s.pos.y}`); }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT);
  it('nobody teleports: no on-ice skater moves more than 0.5 m in one tick', () => {
    const g = createGame(setup(3)); const violations: string[] = [];
    let prev = new Map(g.state.skaters.map((s) => [s.id, { ...s.pos }]));
    while (!g.done) {
      g.step();
      for (const s of g.state.skaters) { const p = prev.get(s.id)!; if (s.onIce && Math.hypot(s.pos.x - p.x, s.pos.y - p.y) > 0.5) violations.push(`tick ${g.state.tick}: ${s.id}`); }
      prev = new Map(g.state.skaters.map((s) => [s.id, { ...s.pos }]));
    }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT);
  it('the puck is at rest whenever play is stopped', () => {
    const g = createGame(setup(4)); const violations: number[] = []; let stopped = 0;
    while (!g.done) { g.step(); if (g.state.phase === 'stopped') { stopped++; const p = g.state.puck; if (p.vel.x !== 0 || p.vel.y !== 0 || p.vz !== 0 || p.z !== 0) violations.push(g.state.tick); } }
    expect(stopped).toBeGreaterThan(0); expect(violations).toEqual([]);
  }, GAME_TIMEOUT);
  // Task 13: no 8 s cap any more; a setup lasts until the players are lined up, the 25 s safety limit never reached.
  it('faceoffs wait for the line-up, at least 3 s and never as long as the safety limit', () => {
    const g = createGame(setup(2)); const waits: number[] = []; let setupTicks = 0;
    while (!g.done) {
      const before = g.state.phase; g.step();
      setupTicks = before === 'faceoffSetup' ? setupTicks + 1 : 0;
      if (before === 'faceoffSetup' && g.state.phase === 'live') waits.push(setupTicks * DT);
    }
    expect(waits.length).toBeGreaterThan(10);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(3 - 1e-6); expect(Math.max(...waits)).toBeLessThan(FACEOFF_MAX_SECONDS - 1e-6);
  }, GAME_TIMEOUT);
  it('the players who release the puck are blocked from re-taking it, and the block is in state', () => {
    const g = createGame(setup(1));
    while (g.state.phase !== 'live') g.step();
    const fo = g.drainEvents().find((e) => e.type === 'faceoff')!;
    expect(g.state.pickupBlock?.ids).toEqual([fo.playerId, fo.otherId]);
    expect(g.state.pickupBlock!.untilTick).toBe(g.state.tick + Math.round(0.3 / DT));
  });
  it('a carried puck never sits inside a net', () => {
    const violations: number[] = [];
    for (const seed of [1, 2, 3]) {
      const g = createGame(setup(seed));
      while (!g.done) { g.step(); const p = g.state.puck.pos; if (g.state.carrierId !== null && Math.abs(p.x) > RINK.goalLineX && Math.abs(p.x) < RINK.goalLineX + RINK.netDepth && Math.abs(p.y) < RINK.netHalfWidth) violations.push(g.state.tick); }
    }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT * 3);
  // Task 7 review, Minor 2: the bound is the carry step (0.4 m), a frame push included (it was 0.48 m once at a post).
  it('a continuously carried puck never moves more than its 0.4 m step (no passing through the net frame)', () => {
    const violations: string[] = [];
    for (const seed of [1, 2, 3]) {
      const g = createGame(setup(seed)); let prev: { id: string; x: number; y: number } | null = null;
      while (!g.done) {
        g.step(); const st = g.state;
        if (st.phase === 'live' && st.carrierId !== null) {
          const p = st.puck.pos;
          if (prev && prev.id === st.carrierId && Math.hypot(p.x - prev.x, p.y - prev.y) > 0.4 + 1e-9) violations.push(`seed ${seed} tick ${st.tick}: (${prev.x},${prev.y})->(${p.x},${p.y})`);
          prev = { id: st.carrierId, x: p.x, y: p.y };
        } else prev = null;
      }
    }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT * 3);
  // Task 7: on seed 12 (the robustness set-up) a carried puck stuck behind a net frame while its carrier skated the length
  // of the ice (a step into the frame was stopped there each tick instead of sliding round it).
  // (A hand-over at a draw can start the puck up to about 4 m off; it then comes to his blade at a step a tick, so the
  // check starts after 20 ticks with it.)
  it('a carried puck stays with its carrier: within 1.6 m of his blade once he has had it 20 ticks', () => {
    const g = createGame(robustSetup(12)); let worst = 0, who: string | null = null, since = 0;
    const shoots = new Map([...robustSetup(12).home.players, ...robustSetup(12).away.players].map((p) => [p.id, p.shoots]));
    while (!g.done) {
      g.step(); const st = g.state;
      if (st.phase !== 'live' || st.carrierId === null) { who = null; continue; }
      if (st.carrierId !== who) { who = st.carrierId; since = st.tick; }
      if (st.tick - since < 20) continue;
      const c = st.skaters.find((s) => s.id === st.carrierId)!; const b = bladePos(c.pos, c.facing, shoots.get(c.id)!, { x: 0, y: 0 });
      worst = Math.max(worst, Math.hypot(st.puck.pos.x - b.x, st.puck.pos.y - b.y));
    }
    expect(worst).toBeLessThanOrEqual(1.6);
  }, GAME_TIMEOUT);
  it('no skater body overlaps a net frame', () => {
    const violations: string[] = [];
    const g = createGame(setup(1));
    while (!g.done) { g.step(); for (const s of g.state.skaters) if (s.onIce && Math.abs(s.pos.x) > RINK.goalLineX && Math.abs(s.pos.x) < RINK.goalLineX + RINK.netDepth && Math.abs(s.pos.y) < RINK.netHalfWidth) violations.push(`tick ${g.state.tick}: ${s.id}`); }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT);
  it('time on ice adds up', () => { const r = simulateGame(setup()); const total = sum(r.players.filter(isSkaterOf('home')).map(p => p.toiSeconds)); expect(total).toBeGreaterThan(3600 * 5 * 0.97); expect(total).toBeLessThan(3600 * 5 * 1.06); }, GAME_TIMEOUT);
  it('no -0 anywhere in the state or the result (JSON would drop its sign)', () => {
    const found: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') { if (Object.is(v, -0)) found.push(path); }
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    const g = createGame(setup(42));
    while (!g.done) { g.step(); if (g.state.tick % 5 === 0) walk(g.state, `tick ${g.state.tick}`); }
    walk(g.result(), 'result');
    expect(found.slice(0, 10)).toEqual([]);
  }, GAME_TIMEOUT);
  it('rejects a bad setup before play', () => { const s = setup(); s.home.lines.goalie = 'nobody'; expect(() => createGame(s)).toThrow(/nobody/); });
});
