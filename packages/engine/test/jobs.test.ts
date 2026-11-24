import { describe, it, expect } from 'vitest';
import { setTeamPhase } from '../src/commit';
import { DT } from '../src/constants';
import { goalieTick } from '../src/goalie';
import { coverSpot, openSpot } from '../src/job-targets';
import { assignTeamJobs } from '../src/jobs';
import { laneOpen } from '../src/lanes';
import { assignJobs as assignAll } from '../src/team-play';
import type { GameState, Job, PlayerDef, Side } from '../src/types';
import { segDistXY } from '../src/vec';
import { def, defs, g, place, skater, stateWith, tactics } from './helpers';

const assignJobs = assignAll;
const goalieDefs: Map<string, PlayerDef> = new Map([
  ['home-G', def({ id: 'home-G', position: 'G', goalie: g(70) })],
  ['away-G', def({ id: 'away-G', position: 'G', goalie: g(70) })],
]);
const jobsOf = (st: GameState, side: Side): Job[] => st.skaters.flatMap((s, i) => (s.onIce && s.side === side ? [st.plans[i]!.job] : []));

describe('every player has a job', () => {
  it.each([['home', 22], ['home', 2], ['home', -20], ['away', 22], ['away', 2], ['away', -20]] as const)('carrier %s at x %s: five different jobs a side', (side, x) => {
    const st = stateWith({ carrier: side, puckX: x }); setTeamPhase(st); assignJobs(st, defs, tactics);
    for (const sd of ['home', 'away'] as const) { const js = jobsOf(st, sd); expect(new Set(js).size).toBe(5); for (const j of js) expect(['press', 'shape']).not.toContain(j); }
  });
  it('in the offensive zone: net front, low support, high forward and two points', () => {
    const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9, carrierSlot: 'LD' }); setTeamPhase(st); assignJobs(st, defs, tactics);
    expect(jobsOf(st, 'home').sort()).toEqual(['carrier', 'highForward', 'lowSupport', 'netFront', 'pointWeak'].sort());
  });
  it('in his own zone each man covers a man or a lane: wingers on the points, a defenceman at the net', () => {
    const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9 }); setTeamPhase(st); assignJobs(st, defs, tactics);
    expect(jobsOf(st, 'away').sort()).toEqual(['dCorner', 'dNet', 'dzCentre', 'wingStrong', 'wingWeak'].sort());
    const w = st.plans[st.skaters.findIndex((s) => s.id === 'away-LW')]!; expect(w.markId === 'home-LD' || w.markId === 'home-RD').toBe(true);
  });
  it('the net-front defender stands between his man and the net', () => {
    const st = stateWith({ carrier: 'home', puckX: 12, puckY: 9, carrierSlot: 'LD' }); place(st, 'home:C', 24.5, 0.8); setTeamPhase(st); assignJobs(st, defs, tactics);
    const i = st.plans.findIndex((p, k) => p.job === 'dNet' && st.skaters[k]!.side === 'away'); const t = st.skaters[i]!.target;
    expect(segDistXY(t.x, t.y, 24.5, 0.8, 27.13, 0)).toBeLessThan(0.3); expect(t.x).toBeGreaterThan(24.5);
  });
  it('the first forechecker goes at the puck, the third stays high', () => {
    const st = stateWith({ carrier: 'away', puckX: 22 }); setTeamPhase(st); assignJobs(st, defs, tactics);
    const tx = (job: Job): number => st.skaters[st.plans.findIndex((p, k) => p.job === job && st.skaters[k]!.side === 'home')]!.target.x;
    expect(tx('f1')).toBeGreaterThan(tx('f3') + 5);
  });
  it('a man holding a job keeps it when another is 2 m nearer its spot, and loses it at 4 m', () => {
    // Home forechecks (away carries deep in its own zone, the puck in the middle): the strong-side line spot is (7, 7).
    const jobsWith = (rdY: number): (Job | null)[] => {
      const st = stateWith({ carrier: 'away', puckX: 22 }); setTeamPhase(st);
      const ld = st.skaters.findIndex((s) => s.id === 'home-LD'), rd = st.skaters.findIndex((s) => s.id === 'home-RD');
      st.plans[ld]!.job = 'dLineStrong'; st.plans[rd]!.job = 'dLineWeak';
      place(st, 'home:LD', 7, 2); place(st, 'home:RD', 7, rdY);                                    // LD 5 m from the spot
      const out = assignTeamJobs(st, 'home', defs, tactics.home);
      return [out[ld]!, out[rd]!];
    };
    expect(jobsWith(4)).toEqual(['dLineStrong', 'dLineWeak']);                                      // RD 3 m from it: 2 m nearer
    expect(jobsWith(6)).toEqual(['dLineWeak', 'dLineStrong']);                                      // RD 1 m from it: 4 m nearer
  });
  it('a man keeps his job inside its hold, then hands it on', () => {
    const st = stateWith({ carrier: 'away', puckX: 22 }); setTeamPhase(st); assignJobs(st, defs, tactics);
    const ld = st.skaters.findIndex((s) => s.id === 'home-LD'), rd = st.skaters.findIndex((s) => s.id === 'home-RD');
    const strong = st.plans[ld]!.job === 'dLineStrong' ? ld : rd, other = strong === ld ? rd : ld;
    st.plans[strong]!.targetTick = st.tick;                                                          // just issued
    st.skaters[strong]!.pos = { x: 7, y: -6 }; st.skaters[other]!.pos = { x: 7, y: 7 };
    st.tick += 2; assignJobs(st, defs, tactics);
    expect(st.plans[strong]!.job).toBe('dLineStrong'); expect(st.plans[other]!.job).not.toBe('dLineStrong');
    st.tick += 11; let handed = -1;                                                                  // 0.43 s since it was issued
    for (let t = 0; t < 3 && handed < 0; t++) { st.tick++; assignJobs(st, defs, tactics); if (st.plans[other]!.job === 'dLineStrong') handed = st.tick; }
    expect(handed).toBeGreaterThan(0); expect(st.plans[other]!.reason).toBe('newJob'); expect(st.plans[other]!.targetTick).toBe(handed);
    expect(st.plans[strong]!.job).toBe('dLineWeak');
  });
  it('getting open is active: a covered man moves to a spot the carrier can reach', () => {
    const st = stateWith({ carrier: 'home', puckX: 22, puckY: 9 }); const out = { x: 0, y: 0 };
    const hf = skater(st, 'home', 'C'); place(st, 'home:C', 16, 2); place(st, 'away:C', 18.5, 5);        // a defender on the lane
    expect(laneOpen(st, 'home', st.puck.pos, hf.pos)).toBe(false);
    openSpot(st, hf, { x: 16, y: 2 }, 3, out);
    expect(laneOpen(st, 'home', st.puck.pos, out)).toBe(true); expect(Math.hypot(out.x - 16, out.y - 2)).toBeGreaterThan(1.5);
  });
  it('taking a lane away: a covering winger shades into the lane to his point man, stick in it', () => {
    const st = stateWith({ carrier: 'home', puckX: 24, puckY: 9 }); const out = { x: 0, y: 0 }; const mark = skater(st, 'home', 'LD'); place(st, 'home:LD', 9.1, 8.5);
    coverSpot(st, skater(st, 'away', 'RW'), mark, 3, out);
    expect(segDistXY(out.x, out.y, st.puck.pos.x, st.puck.pos.y, 9.1, 8.5)).toBeLessThan(1.2);            // within a stick of the lane
  });
  it('behind the net is a place: the office is filled when the puck is on the half wall and nobody is back there', () => {
    const st = stateWith({ carrier: 'home', puckX: 18, puckY: 11 }); setTeamPhase(st); assignJobs(st, defs, tactics);
    const i = st.plans.findIndex((p, k) => p.job === 'office' && st.skaters[k]!.side === 'home'); expect(i).toBeGreaterThanOrEqual(0); expect(st.skaters[i]!.target.x).toBeGreaterThan(27.5);
  });
  it('the goalie follows a carrier behind his net post to post', () => {
    const st = stateWith({ carrier: 'home', puckX: 28.6, puckY: 2 }); const gl = st.goalies.away;
    for (let t = 0; t < 30; t++) goalieTick(st, goalieDefs, DT);
    expect(gl.pos.y).toBeGreaterThan(0.6);
    st.puck.pos.y = -2; let ticks = 0; while (gl.pos.y > -0.6 && ticks < 90) { goalieTick(st, goalieDefs, DT); ticks++; }
    expect(ticks).toBeGreaterThan(6); expect(ticks).toBeLessThan(45);                                     // 0.2 to 1.5 s: he has to move
  });
});
