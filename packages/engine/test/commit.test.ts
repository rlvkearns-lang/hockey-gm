import { describe, it, expect } from 'vitest';
import { commitTo, committedPhase, effortToReach, setTeamPhase, speedFor, updateTeamPhase, type Want } from '../src/commit';
import { assignJobs } from '../src/team-play';
import { resolveGoalies } from '../src/bodies';
import { defs, mv, skater, stateWith, tactics } from './helpers';

describe('commitment', () => {
  it('one bobble does not flip the phase; a real change of possession does, after about half a second', () => {
    const st = stateWith({ carrier: 'home', puckX: 20 }); setTeamPhase(st);
    expect(committedPhase(st, 'home')).toBe('ozone'); expect(committedPhase(st, 'away')).toBe('dzone');
    st.carrierId = 'away-LD'; st.possession = 'away';
    for (let t = 0; t < 6; t++) { st.tick++; updateTeamPhase(st); }            // 0.2 s
    st.carrierId = 'home-RW'; st.possession = 'home';
    for (let t = 0; t < 30; t++) { st.tick++; updateTeamPhase(st); expect(committedPhase(st, 'home')).toBe('ozone'); }
    st.carrierId = 'away-LD'; st.possession = 'away'; let flipped = -1;
    for (let t = 1; t <= 30 && flipped < 0; t++) { st.tick++; updateTeamPhase(st); if (committedPhase(st, 'home') !== 'ozone') flipped = t; }
    expect(flipped).toBeGreaterThanOrEqual(12); expect(flipped).toBeLessThanOrEqual(18);
  });
  it('a held spot is not re-issued inside 0.4 s when the wanted spot drifts, and is after it once it has moved 1.5 m', () => {
    const st = stateWith({ carrier: 'home', puckX: 20 }); const i = st.skaters.findIndex((s) => s.id === 'home-LD');
    const want = (x: number): Want => ({ job: 'shape', pos: { x, y: 8 }, face: null, follow: 'spot', markId: null, effort: 'skate', slow: 'coast', through: false });
    commitTo(st, i, want(9), 'start');
    for (let t = 1; t <= 11; t++) { st.tick++; expect(commitTo(st, i, want(9 + t), null)).toBe(false); expect(st.skaters[i]!.target.x).toBe(9); }
    st.tick++; expect(commitTo(st, i, want(9.8), null)).toBe(false);                 // 0.4 s passed, moved 0.8 m: kept
    expect(commitTo(st, i, want(12), null)).toBe(true); expect(st.plans[i]!.reason).toBe('review');
  });
  it('a trigger re-issues at once and names itself', () => {
    const st = stateWith({ carrier: 'home', puckX: 20 }); const i = st.skaters.findIndex((s) => s.id === 'away-C');
    assignJobs(st, defs, tactics); st.tick++; st.carrierId = null; st.pendingPass = { fromId: 'away-LD', toId: 'away-C', untilTick: st.tick + 30, tried: [], pressure: 0 }; st.possession = 'away';
    assignJobs(st, defs, tactics);
    expect(st.plans[i]!.job).toBe('receive'); expect(['passToMe', 'possession']).toContain(st.plans[i]!.reason); expect(st.plans[i]!.targetTick).toBe(st.tick);
  });
  it('effort is chosen by need: a sprint to a far spot, a glide near it, and no sprint on empty legs', () => {
    expect(effortToReach(12)).toBe('sprint'); expect(effortToReach(5)).toBe('skate'); expect(effortToReach(2)).toBe('glide');
    expect(speedFor('sprint', 'shape', 0.1)).toBeLessThan(1); expect(speedFor('sprint', 'chase', 0.1)).toBe(1);
  });
  it('a skater is pushed out of the goalie', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); const s = skater(st, 'away', 'C'); s.pos = { x: -26.4, y: 0.1 }; s.vel = { x: -3, y: 0 };
    resolveGoalies([s], [mv(85)], [st.goalies.home]);
    expect(Math.hypot(s.pos.x - st.goalies.home.pos.x, s.pos.y - st.goalies.home.pos.y)).toBeGreaterThanOrEqual(0.55 + 0.38 - 1e-9); expect(s.vel.x).toBeGreaterThanOrEqual(0);
  });
});
