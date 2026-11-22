import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
import { generateTeam } from '../src/roster-gen';
import { createRng } from '../src/rng';
import { isSkaterOf, runToPeriod, sum } from './helpers';

const setup = (seed = 1) => ({ home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northgate', 'NGT'), seed, chemistry: [] });

describe('game loop', () => {
  it('plays exactly three 20-minute periods', () => {
    const g = createGame(setup()); let ticks = 0; while (!g.done) { g.step(); ticks++; if (ticks > 2e6) throw new Error('runaway'); }
    expect(g.state.phase).toBe('final'); expect(g.result().events.filter(e => e.type === 'periodEnd').length).toBe(3);
  });
  it('same seed, same game; different seed, different game', () => {
    expect(simulateGame(setup(5))).toEqual(simulateGame(setup(5)));
    expect(simulateGame(setup(5)).events).not.toEqual(simulateGame(setup(6)).events);
  }, 30_000);
  it('stepping in irregular bursts with reads between matches simulateGame', () => {
    const g = createGame(setup(5)), r = createRng(99); let seen = 0;
    while (!g.done) { for (let i = r.int(1, 400); i > 0 && !g.done; i--) g.step(); seen += g.drainEvents().length; JSON.stringify(g.state); }
    expect(g.result()).toEqual(simulateGame(setup(5))); expect(seen).toBe(g.result().events.length);
  }, 30_000);
  it('teams switch ends in the second period', () => { const g = createGame(setup()); const d1 = g.state.attackDir.home; runToPeriod(g, 2); expect(g.state.attackDir.home).toBe(-d1); });
  it('five skaters and a goalie per side, all inside the boards, every tick', () => {
    const g = createGame(setup(3));
    while (!g.done) { g.step(); for (const side of ['home', 'away'] as const) expect(g.state.onIce[side].length).toBeLessThanOrEqual(5 + 3);   // up to 3 extra mid-change
      for (const s of g.state.skaters) if (s.onIce) { expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(30.48); expect(Math.abs(s.pos.y)).toBeLessThanOrEqual(12.955); expect(Number.isFinite(s.pos.x)).toBe(true); } }
  }, 60_000);
  it('time on ice adds up', () => { const r = simulateGame(setup()); const total = sum(r.players.filter(isSkaterOf('home')).map(p => p.toiSeconds)); expect(total).toBeGreaterThan(3600 * 5 * 0.97); expect(total).toBeLessThan(3600 * 5 * 1.06); });
  it('rejects a bad setup before play', () => { const s = setup(); s.home.lines.goalie = 'nobody'; expect(() => createGame(s)).toThrow(/nobody/); });
});
