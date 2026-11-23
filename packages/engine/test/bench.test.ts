import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
import { BENCH_DOORS, iceShares } from '../src/bench';
import {
  afterIcingBy, def, energyAfterRest, energyAfterShift, lineChangeEvents, median, runThroughFaceoff, setup, shiftLengths,
} from './helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

describe('fatigue and line changes', () => {
  it('skating hard drains energy; stamina slows the drain', () => { expect(energyAfterShift(def({ stamina: 50 }), 45)).toBeLessThan(0.65); expect(energyAfterShift(def({ stamina: 95 }), 45)).toBeGreaterThan(energyAfterShift(def({ stamina: 50 }), 45) + 0.05); });
  it('the bench restores energy', () => { expect(energyAfterRest(0.5, 90)).toBeGreaterThan(0.85); });
  it('ice time follows the line order', () => {
    const r = simulateGame(setup(2)), toi = (id: string) => r.players.find(p => p.id === id)!.toiSeconds, L = setup(2).home.lines;
    expect(toi(L.forwards[0]![1])).toBeGreaterThan(toi(L.forwards[3]![1]) + 240);
    expect(toi(L.forwards[0]![1])).toBeGreaterThan(15 * 60); expect(toi(L.forwards[0]![1])).toBeLessThan(23 * 60);
    expect(toi(L.defence[0]![0])).toBeGreaterThan(20 * 60); expect(toi(L.defence[0]![0])).toBeLessThan(27 * 60);
  }, GAME_TIMEOUT);
  it('shifts are a sensible length', () => { const s = shiftLengths(simulateGame(setup(2))); expect(median(s.forwards)).toBeGreaterThan(30); expect(median(s.forwards)).toBeLessThan(60); }, GAME_TIMEOUT);
  it('no change for the team that iced it', () => { const st = afterIcingBy('home'); const before = [...st.onIce.home]; runThroughFaceoff(st); expect(st.onIce.home).toEqual(before); }, GAME_TIMEOUT);
  it('never changes while defending in its own zone', () => { for (const c of lineChangeEvents(simulateGame(setup(6)), 'onTheFly')) expect(c.type === 'lineChange' && c.detail.phase).not.toBe('dzone'); }, GAME_TIMEOUT);

  // Beyond the brief: the pieces behind those.
  it('the other team may change at that stoppage', () => {
    const st = afterIcingBy('away'); const before = [...st.onIce.home]; runThroughFaceoff(st);
    expect(st.onIce.home).not.toEqual(before);
  }, GAME_TIMEOUT);
  it('tired legs are slower in the game', () => {
    const topSpeed = (tired: boolean): number => {
      const g = createGame(setup(5)); let top = 0;
      for (let t = 0; t < 30 * 300; t++) {
        if (tired) for (const s of g.state.skaters) if (s.side === 'home') s.energy = 0.05;
        g.step();
        for (const s of g.state.skaters) if (s.onIce && s.side === 'home') top = Math.max(top, Math.hypot(s.vel.x, s.vel.y));
      }
      return top;
    };
    expect(topSpeed(true)).toBeLessThan(topSpeed(false) * 0.92);
  }, GAME_TIMEOUT);
  it('target shares, rescaled for a short bench', () => {
    expect(iceShares('forwards', 4)).toEqual([0.36, 0.3, 0.21, 0.13]);
    expect(iceShares('defence', 3)).toEqual([0.41, 0.34, 0.25]);
    const f3 = iceShares('forwards', 3), d2 = iceShares('defence', 2);
    expect(f3.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9); expect(f3[0]! / f3[2]!).toBeCloseTo(36 / 21, 9);
    expect(d2.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9); expect(d2[0]! / d2[1]!).toBeCloseTo(41 / 34, 9);
  });
  it('a short bench plays its lines', () => {
    const s = setup(3); s.home.lines.forwards.length = 3; s.home.lines.defence.length = 2;
    const r = simulateGame(s), toi = (id: string) => r.players.find(p => p.id === id)!.toiSeconds;
    for (const line of s.home.lines.forwards) expect(toi(line[1])).toBeGreaterThan(10 * 60);
    for (const pair of s.home.lines.defence) expect(toi(pair[0])).toBeGreaterThan(20 * 60);
  }, GAME_TIMEOUT);
  it('changes go through the bench door, a stoppage change is done before the drop, and everyone tires and recovers', () => {
    const g = createGame(setup(4)); const violations: string[] = []; let minEnergy = 1, changes = 0;
    const was = new Map(g.state.skaters.map((s) => [s.id, s.onIce]));
    while (!g.done) {
      const before = g.state.phase; g.step(); const st = g.state;
      if (before !== 'live' && st.phase === 'live' && st.skaters.some((s) => s.leaving)) violations.push(`tick ${st.tick}: drop with a change on`);
      for (const s of st.skaters) {
        minEnergy = Math.min(minEnergy, s.energy);
        if (s.onIce !== was.get(s.id)) {
          changes++;
          const door = BENCH_DOORS[s.side];
          if (Math.hypot(s.pos.x - door.x, s.pos.y - door.y) > 1.5 + 1e-9) violations.push(`tick ${st.tick}: ${s.id} on/off away from the door`);
          was.set(s.id, s.onIce);
        }
        if (s.onIce && s.leaving && st.carrierId === s.id) violations.push(`tick ${st.tick}: ${s.id} carries while leaving`);
      }
      for (const side of ['home', 'away'] as const) if (st.onIce[side].length > 5 || st.onIce[side].length !== st.skaters.filter((s) => s.onIce && s.side === side).length) violations.push(`tick ${st.tick}: ${side} on-ice count`);
    }
    expect(violations).toEqual([]); expect(changes).toBeGreaterThan(100);
    expect(minEnergy).toBeLessThan(0.8); expect(minEnergy).toBeGreaterThan(0);
  }, GAME_TIMEOUT);
});
