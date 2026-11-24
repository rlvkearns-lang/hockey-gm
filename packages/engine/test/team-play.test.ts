import { describe, it, expect } from 'vitest';
import { assignJobs, phaseFor, sitBack } from '../src/team-play';
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
  it('drives by need: the loose-puck chaser follows the puck and skates through it, a winger held at the blue line stops hard, the rest coast', () => {
    const loose = stateWith({ carrier: null, puckX: 0 }); assignJobs(loose, defs, tactics);
    const chasers = loose.plans.filter((p, i) => loose.skaters[i]!.onIce && p.job === 'chase');
    expect(chasers.length).toBe(2); expect(chasers.every((p) => p.follow === 'puck' && p.through && p.effort === 'sprint')).toBe(true);
    const rush = stateWith({ carrier: 'home', puckX: 0 });
    const w = skater(rush, 'home', 'LW'); w.pos = { x: 5, y: 8 }; w.vel = { x: 8, y: 0 }; assignJobs(rush, defs, tactics);
    const plan = (s: { id: string }) => rush.plans[rush.skaters.findIndex((k) => k.id === s.id)]!;
    expect(plan(w)).toMatchObject({ slow: 'stop', through: false });
    expect(plan(skater(rush, 'away', 'C'))).toMatchObject({ slow: 'coast', through: false });
  });
  it('a back-checker skating fast away from his blue line is not stopped hard', () => {
    const rush = stateWith({ carrier: 'home', puckX: 0 });
    const b = skater(rush, 'away', 'LW'); b.pos = { x: -3, y: 6 }; b.vel = { x: 8, y: 0 }; assignJobs(rush, defs, tactics);
    expect(rush.plans[rush.skaters.indexOf(b)]).toMatchObject({ slow: 'coast', through: false });
  });
  it('the chaser keeps the puck unless a teammate is clearly closer, and a held spot waits out its hold', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); assignJobs(st, defs, tactics);
    const chaser = (side: 'home' | 'away') => st.skaters.find((s, i) => s.side === side && st.plans[i]!.job === 'chase')!;
    const first = chaser('home'); const other = onIce(st, 'home').find((s) => s !== first && st.plans[st.skaters.indexOf(s)]!.job === 'shape')!;
    const dFirst = Math.hypot(first.pos.x, first.pos.y);
    other.pos = { x: (dFirst - 0.5) / Math.SQRT2, y: (dFirst - 0.5) / Math.SQRT2 }; st.tick++; assignJobs(st, defs, tactics);
    expect(chaser('home')).toBe(first);                                          // closer by 0.5 m: no hand-over
    other.pos = { x: 0.3, y: 0.3 }; st.tick++; assignJobs(st, defs, tactics);
    expect(chaser('home')).toBe(other);
  });
  it('effort by need: a skater far from his spot sprints to it, one close to it glides', () => {
    const st = stateWith({ carrier: 'home', puckX: 20 }); const d = skater(st, 'home', 'LD');
    d.pos = { x: -10, y: 8 }; assignJobs(st, defs, tactics);
    const i = st.skaters.indexOf(d); expect(st.plans[i]!.effort).toBe('sprint'); expect(d.speedCap).toBe(1);
    d.pos = { x: d.target.x - 1, y: d.target.y }; st.tick++; assignJobs(st, defs, tactics);
    expect(st.plans[i]!.effort).toBe('glide'); expect(d.speedCap).toBeLessThan(0.6);
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
