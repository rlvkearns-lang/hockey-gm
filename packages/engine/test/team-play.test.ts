import { describe, it, expect } from 'vitest';
import { assignJobs, phaseFor } from '../src/team-play';
import { defs, onIce, skater, spotName, stateWith, tactics } from './helpers';

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
  it('forwards rotate in the offensive zone', () => {
    const spots = new Set<string>(); const st = stateWith({ carrier: 'home', puckX: 22 });
    for (let t = 0; t < 30 * 40; t++) { st.tick++; assignJobs(st, defs, tactics); spots.add(spotName(st, 'home', 'C')); }
    expect(spots.size).toBeGreaterThanOrEqual(3);
  });
});
