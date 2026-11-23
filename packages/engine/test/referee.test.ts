import { describe, it, expect } from 'vitest';
import { createGame, simulateGame } from '../src/game';
import { assignJobs } from '../src/team-play';
import { drawChance, dropPuck } from '../src/faceoff';
import { createRng } from '../src/rng';
import { RINK } from '../src/rink';
import {
  carryTo, count, def, defs, dumpedInWith, icedWithWingerOffside, icingAfter, live, moveOut, offsideWinger, onIce, place, refereeUntilCall, setup,
  shootDownIce, shotFrom, skater, stateWith, tactics,
} from './helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

describe('referee', () => {
  it('calls offside when an attacker is in the zone before the puck', () => {
    const st = live({ carrier: 'home:C', carrierX: 7.0 }); place(st, 'home:LW', 10, 5); carryTo(st, 8.5);
    expect(refereeUntilCall(st)).toMatchObject({ type: 'offside', side: 'home' }); expect(Math.abs(st.faceoffSpot.x)).toBeCloseTo(6.1, 1);
  });
  it('no offside when everyone trails the puck', () => { const st = live({ carrier: 'home:C', carrierX: 7.0 }); carryTo(st, 9); expect(refereeUntilCall(st, 60)).toBeNull(); });
  it('delayed offside is waved off if they clear the zone', () => { const st = dumpedInWith(offsideWinger()); moveOut(st, 'home:LW'); expect(refereeUntilCall(st, 90)).toBeNull(); });
  it('icing from behind centre, faceoff back in the shooters zone, no change allowed', () => {
    const st = live({ carrier: 'home:LD', carrierX: -5 }); shootDownIce(st);
    expect(refereeUntilCall(st)).toMatchObject({ type: 'icing', side: 'home' }); expect(st.faceoffSpot.x).toBeCloseTo(-21.03, 1); expect(st.noChange).toBe('home');
  });
  it('not icing from past centre, or when it goes on net', () => { expect(icingAfter(shotFrom(2))).toBeNull(); expect(icingAfter(shotFrom(-5, { onNet: true }))).toBeNull(); });
  it('not icing when the attacker wins the race', () => { expect(icingAfter(shotFrom(-5), { attackerAhead: true })).toBeNull(); });
  it('a puck iced while a delayed offside against the same team is on is called offside', () => {
    expect(icedWithWingerOffside()).toMatchObject({ type: 'offside', side: 'home' });
  });
  it('a full game has a believable number of whistles', () => { const r = simulateGame(setup(8)); expect(count(r, 'offside')).toBeLessThan(20); expect(count(r, 'icing')).toBeLessThan(25); expect(count(r, 'faceoff')).toBeGreaterThan(20); }, GAME_TIMEOUT);

  // Beyond the brief: the pieces behind those calls.
  it('a dump-in with a winger already in the zone is a delayed offside, whistled when his team touches the puck', () => {
    const st = dumpedInWith(offsideWinger());
    expect(st.phase).toBe('live'); expect(st.delayedOffside?.side).toBe('home');
    const lw = skater(st, 'home', 'LW'); st.carrierId = lw.id; st.lastTouch = { id: lw.id, side: 'home' };
    expect(refereeUntilCall(st, 1)).toMatchObject({ type: 'offside', side: 'home' });
    expect(st.phase).toBe('stopped'); expect(st.faceoffSpot.x).toBeCloseTo(6.1, 1);
  });
  it('the delayed offside ends once the winger is out', () => {
    const st = dumpedInWith(offsideWinger()); moveOut(st, 'home:LW'); refereeUntilCall(st, 90);
    expect(st.delayedOffside).toBeNull(); expect(st.phase).toBe('live');
  });
  it('the delayed offside ends when the defenders carry the puck out', () => {
    const st = dumpedInWith(offsideWinger());
    const d = skater(st, 'away', 'C'); place(st, 'away:C', 8.5, 0); st.carrierId = d.id; st.lastTouch = { id: d.id, side: 'away' };
    d.facing = Math.PI; d.target = { x: 0, y: 0 };
    expect(refereeUntilCall(st, 60)).toBeNull(); expect(st.delayedOffside).toBeNull();
  });
  it('no offside when the defending team brings the puck into its own zone', () => {
    const st = live({ carrier: 'away:C', carrierX: 6 }); place(st, 'home:LW', 10, 5); carryTo(st, 9);
    expect(refereeUntilCall(st, 30)).toBeNull();
  });
  it('a touch on the way down cancels icing', () => {
    const st = shotFrom(-5); refereeUntilCall(st, 20); st.icingWatch = null; // as recordTouch does on any pickup or block
    expect(icingAfter(st)).toBeNull();
  });
  it('the offending team tags up instead of chasing the puck', () => {
    const st = stateWith({ carrier: null, puckX: 15 });
    place(st, 'home:LW', 14, 3); place(st, 'home:C', 11, -2);
    st.delayedOffside = { side: 'home', y: 0 };
    assignJobs(st, defs, tactics);
    for (const s of onIce(st, 'home')) expect(s.target.x).toBeLessThan(RINK.blueLineX);
  });
  it('the better faceoff man wins more draws, but never all of them', () => {
    let wins = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const st = stateWith({ carrier: null, puckX: 0 });
      const ds = new Map(defs); ds.set('home-C', def({ id: 'home-C', position: 'C', faceoffs: 95 })); ds.set('away-C', def({ id: 'away-C', position: 'C', faceoffs: 45 }));
      if (dropPuck(st, ds, createRng(seed)).side === 'home') wins++;
    }
    // A 50-point edge: winProb(50) is about 0.89, just under the parity cap; 0.92 allows sampling noise over 2,000 draws.
    expect(wins / 2000).toBeGreaterThan(0.58); expect(wins / 2000).toBeLessThanOrEqual(0.92);
    // The rule itself, without noise: the draw chance the faceoff code computes for this matchup is at most the 0.9 cap.
    const ds = new Map(defs); ds.set('home-C', def({ id: 'home-C', position: 'C', faceoffs: 95 })); ds.set('away-C', def({ id: 'away-C', position: 'C', faceoffs: 45 }));
    expect(drawChance(stateWith({ carrier: null, puckX: 0 }), ds)).toBeLessThanOrEqual(0.9);
  });
  it('the draw winner has possession and the next drop clears noChange', () => {
    const g = createGame(setup(2));
    g.state.noChange = 'home';
    while (g.state.phase !== 'live') g.step();
    const fo = g.drainEvents().find((e) => e.type === 'faceoff')!;
    expect(g.state.possession).toBe(fo.side); expect(g.state.noChange).toBeNull();
  });
});
