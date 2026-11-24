import { describe, it, expect } from 'vitest';
import { assignJobs, driveFor, phaseFor, sitBack } from '../src/team-play';
import type { Drive } from '../src/skating';
import { DT } from '../src/constants';
import { resolveNets } from '../src/rink';
import { movementOf, stepSkater } from '../src/skating';
import { defs, onIce, skater, spotName, stateWith, tactics, wingerAheadOnRush } from './helpers';

describe('team play', () => {
  it('phases track the puck', () => {
    expect(phaseFor(stateWith({ carrier: 'home', puckX: -20 }), 'home')).toBe('breakout');
    expect(phaseFor(stateWith({ carrier: 'home', puckX: 20 }), 'home')).toBe('ozone');
    expect(phaseFor(stateWith({ carrier: 'home', puckX: 20 }), 'away')).toBe('dzone');
  });
  it('defencemen face the puck while backing up against a rush', () => {
    const st = stateWith({ carrier: 'away', puckX: 5 }); assignJobs(st, defs, tactics);
    const d = skater(st, 'home', 'LD'); expect(d.faceTarget).not.toBeNull(); expect(d.target.x).toBeLessThan(d.pos.x);
  });
  it('nobody is sent offside', () => {
    const st = stateWith({ carrier: 'home', puckX: 2 }); assignJobs(st, defs, tactics);
    for (const s of onIce(st, 'home')) if (s.id !== st.carrierId) expect(s.target.x).toBeLessThanOrEqual(7.62);
  });
  it('a chaser goes round the net to a puck sitting behind it', () => {
    const st = stateWith({ carrier: null, puckX: -28.9 }); st.puck.pos.y = -0.2;
    for (const s of st.skaters) s.onIce = s.id === 'home-RD';
    const d = skater(st, 'home', 'RD'); d.pos = { x: -26.4, y: 0.2 };
    let reached = false;
    for (let t = 0; t < 30 * 5 && !reached; t++) {
      assignJobs(st, defs, tactics); stepSkater(d, movementOf(defs.get(d.id)!, 1), DT); resolveNets(d.pos, d.vel, 0.38);
      reached = Math.hypot(d.pos.x - st.puck.pos.x, d.pos.y - st.puck.pos.y) < 0.9;
    }
    expect(reached).toBe(true);
  });
  it('stopgap drives: the loose-puck chaser skates through the puck, a winger held at the blue line stops hard, the rest coast', () => {
    const loose = stateWith({ carrier: null, puckX: 0 }); const drives = new Map<string, Drive>(); assignJobs(loose, defs, tactics, drives);
    const through = loose.skaters.filter((s) => s.onIce && driveFor(loose, s, drives).through);
    expect(through.length).toBeGreaterThanOrEqual(1); expect(through.length).toBeLessThanOrEqual(2);
    const rush = stateWith({ carrier: 'home', puckX: 0 }); const d2 = new Map<string, Drive>();
    const w = skater(rush, 'home', 'LW'); w.pos = { x: 5, y: 8 }; w.vel = { x: 8, y: 0 }; assignJobs(rush, defs, tactics, d2);
    expect(driveFor(rush, w, d2)).toEqual({ slow: 'stop', through: false });
    expect(driveFor(rush, skater(rush, 'away', 'C'), d2)).toEqual({ slow: 'coast', through: false });
  });
  it('a winger flying up ice with the carrier eases up in time to stay onside', () => {
    expect(wingerAheadOnRush()).toBeLessThan(0);
  });
  it('a team well ahead sits back; a close game is played straight', () => {
    const st = stateWith({ carrier: 'home', puckX: 0 });
    expect(sitBack(st, 'home')).toBe(1);
    st.score = { home: 5, away: 0 };
    expect(sitBack(st, 'home')).toBeLessThan(1); expect(sitBack(st, 'home')).toBeGreaterThanOrEqual(0.8); expect(sitBack(st, 'away')).toBe(1);
    st.score = { home: 2, away: 0 }; expect(sitBack(st, 'home')).toBe(1);
    st.period = 3; expect(sitBack(st, 'home')).toBeLessThan(1);
  });
  it('forwards rotate in the offensive zone', () => {
    const spots = new Set<string>(); const st = stateWith({ carrier: 'home', puckX: 22 });
    for (let t = 0; t < 30 * 40; t++) { st.tick++; assignJobs(st, defs, tactics); spots.add(spotName(st, 'home', 'C')); }
    expect(spots.size).toBeGreaterThanOrEqual(3);
  });
});
