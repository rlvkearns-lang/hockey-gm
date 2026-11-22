import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';
import { createRng } from '../src/rng';
import { DT } from '../src/constants';
import { RINK } from '../src/rink';
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
  it('faceoffs wait for the line-up, at least 3 s and at most 8 s', () => {
    const g = createGame(setup(2)); const waits: number[] = []; let setupTicks = 0;
    while (!g.done) {
      const before = g.state.phase; g.step();
      setupTicks = before === 'faceoffSetup' ? setupTicks + 1 : 0;
      if (before === 'faceoffSetup' && g.state.phase === 'live') waits.push(setupTicks * DT);
    }
    expect(waits.length).toBeGreaterThan(10);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(3 - 1e-6); expect(Math.max(...waits)).toBeLessThanOrEqual(8 + 1e-6);
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
  it('a continuously carried puck never jumps (no passing through the net frame)', () => {
    const violations: string[] = [];
    for (const seed of [1, 2, 3]) {
      const g = createGame(setup(seed)); let prev: { id: string; x: number; y: number } | null = null;
      while (!g.done) {
        g.step(); const st = g.state;
        if (st.phase === 'live' && st.carrierId !== null) {
          const p = st.puck.pos;
          if (prev && prev.id === st.carrierId && Math.hypot(p.x - prev.x, p.y - prev.y) > 0.5) violations.push(`seed ${seed} tick ${st.tick}: (${prev.x},${prev.y})->(${p.x},${p.y})`);
          prev = { id: st.carrierId, x: p.x, y: p.y };
        } else prev = null;
      }
    }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT * 3);
  it('no skater body overlaps a net frame', () => {
    const violations: string[] = [];
    const g = createGame(setup(1));
    while (!g.done) { g.step(); for (const s of g.state.skaters) if (s.onIce && Math.abs(s.pos.x) > RINK.goalLineX && Math.abs(s.pos.x) < RINK.goalLineX + RINK.netDepth && Math.abs(s.pos.y) < RINK.netHalfWidth) violations.push(`tick ${g.state.tick}: ${s.id}`); }
    expect(violations).toEqual([]);
  }, GAME_TIMEOUT);
  it('time on ice adds up', () => { const r = simulateGame(setup()); const total = sum(r.players.filter(isSkaterOf('home')).map(p => p.toiSeconds)); expect(total).toBeGreaterThan(3600 * 5 * 0.97); expect(total).toBeLessThan(3600 * 5 * 1.06); }, GAME_TIMEOUT);
  it('rejects a bad setup before play', () => { const s = setup(); s.home.lines.goalie = 'nobody'; expect(() => createGame(s)).toThrow(/nobody/); });
});
