import { describe, it, expect } from 'vitest';
import { commitTo, committedPhase, effortToReach, holdJob, setTeamPhase, speedFor, updateTeamPhase, type Want } from '../src/commit';
import { assignJobs } from '../src/team-play';
import { resolveGoalies } from '../src/bodies';
import { defs, mv, skater, stateWith, tactics } from './helpers';
import type { GameState, ReplanReason } from '../src/types';

/**
 * Each replan trigger alone: home attacks with the puck at x 0, everyone has held his place a while and the last
 * target was issued 2 ticks ago (inside the hold). `make` applies one cause and returns the skater it is for.
 */
const TRIGGERS: [ReplanReason, (st: GameState) => string][] = [
  ['possession', (st) => { st.carrierId = 'away-C'; st.possession = 'away'; st.lastTouch = { id: 'away-C', side: 'away' }; return 'home-LD'; }],
  ['passToMe', (st) => { st.carrierId = null; st.pendingPass = { fromId: 'home-RW', toId: 'home-LW', untilTick: st.tick + 30, tried: [], pressure: 0, aim: { x: 0, y: 0 }, bobbled: false, cover: 0, oneTimer: false }; return 'home-LW'; }],
  ['loosePuckMine', (st) => { st.carrierId = null; skater(st, 'home', 'RW').pos = { x: -8, y: -9 }; skater(st, 'home', 'C').pos = { x: -0.5, y: 0.2 }; return 'home-C'; }],
  ['phase', (st) => { st.teamPhase.home.sinceTick = st.tick; return 'home-LD'; }],
  ['whistle', (st) => { st.plans[idx(st, 'home-LD')]!.job = 'lineUp'; return 'home-LD'; }],
  ['contestEnd', (st) => { st.plans[idx(st, 'home-LD')]!.job = 'contest'; return 'home-LD'; }],
  ['gotUp', (st) => { st.plans[idx(st, 'home-LD')]!.job = 'down'; return 'home-LD'; }],
  ['steppedOn', (st) => { holdJob(st, idx(st, 'home-LD'), st.plans[idx(st, 'home-LD')]!.job, 'steppedOn'); return 'home-LD'; }],
  ['offside', (st) => { st.delayedOffside = { side: 'home', y: 0 }; return 'home-LD'; }],
  // A job his team no longer has (a defensive-zone job while it rushes) is handed in at once, hold or not.
  ['newJob', (st) => { st.plans[idx(st, 'home-LD')]!.job = 'dCorner'; return 'home-LD'; }],
];
const idx = (st: GameState, id: string): number => st.skaters.findIndex((s) => s.id === id);

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
    const want = (x: number): Want => ({ job: 'pointStrong', pos: { x, y: 8 }, face: null, follow: 'spot', markId: null, effort: 'skate', slow: 'coast', through: false });
    commitTo(st, i, want(9), 'start');
    for (let t = 1; t <= 11; t++) { st.tick++; expect(commitTo(st, i, want(9 + t), null)).toBe(false); expect(st.skaters[i]!.target.x).toBe(9); }
    st.tick++; expect(commitTo(st, i, want(9.8), null)).toBe(false);                 // 0.4 s passed, moved 0.8 m: kept
    expect(commitTo(st, i, want(12), null)).toBe(true); expect(st.plans[i]!.reason).toBe('review');
  });
  it('a trigger re-issues at once and names itself', () => {
    const st = stateWith({ carrier: 'home', puckX: 20 }); const i = st.skaters.findIndex((s) => s.id === 'away-C');
    assignJobs(st, defs, tactics); st.tick++; st.carrierId = null; st.pendingPass = { fromId: 'away-LD', toId: 'away-C', untilTick: st.tick + 30, tried: [], pressure: 0, aim: { x: 0, y: 0 }, bobbled: false, cover: 0, oneTimer: false }; st.possession = 'away';
    assignJobs(st, defs, tactics);
    expect(st.plans[i]!.job).toBe('receive'); expect(['passToMe', 'possession']).toContain(st.plans[i]!.reason); expect(st.plans[i]!.targetTick).toBe(st.tick);
  });
  it.each(TRIGGERS)('the %s trigger alone re-issues at once and names itself', (reason, make) => {
    const st = stateWith({ carrier: 'home', puckX: 0 }); assignJobs(st, defs, tactics);
    st.tick += 2;
    for (const p of st.plans) p.targetTick = st.tick - 2;
    const i = idx(st, make(st)); const s = st.skaters[i]!; s.target = { x: s.pos.x - 0.5, y: 12 };  // a stale held target, like a bench door
    assignJobs(st, defs, tactics);
    expect(st.plans[i]!.reason).toBe(reason); expect(st.plans[i]!.targetTick).toBe(st.tick); expect(s.target.y).not.toBe(12);
  });
  it('effort is chosen by need: a sprint to a far spot, a glide near it, and no sprint on empty legs', () => {
    expect(effortToReach(12)).toBe('sprint'); expect(effortToReach(5)).toBe('skate'); expect(effortToReach(2)).toBe('glide');
    expect(speedFor('sprint', 'f3', 0.1)).toBeLessThan(1); expect(speedFor('sprint', 'chase', 0.1)).toBe(1);
  });
  it('a skater is pushed out of the goalie', () => {
    const st = stateWith({ carrier: null, puckX: 0 }); const s = skater(st, 'away', 'C'); s.pos = { x: -26.4, y: 0.1 }; s.vel = { x: -3, y: 0 };
    resolveGoalies([s], [mv(85)], [st.goalies.home]);
    expect(Math.hypot(s.pos.x - st.goalies.home.pos.x, s.pos.y - st.goalies.home.pos.y)).toBeGreaterThanOrEqual(0.55 + 0.38 - 1e-9); expect(s.vel.x).toBeGreaterThanOrEqual(0);
  });
});
