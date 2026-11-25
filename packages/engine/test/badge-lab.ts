/**
 * Task 13b item 4: the shot badges' lifts in executed shots, re-measured (as Task 12's close-out measured them for
 * TUNING.badges.value): the same shot, the same random stream, by a 70 shooter with the badge and without it, against a
 * 70 goalie; the lift is goals with it over goals without. Also a point shot with a man screening in front, for the
 * traffic check. Used by test/valuation-calibration.test.ts (slow suite) and scripts/fit-valuation.ts.
 */
import { executeShot } from '../src/actions';
import { createRng } from '../src/rng';
import type { Badge, GameState, PlayerDef, ShotType } from '../src/types';
import { flyShot, withGoalies } from './shot-lab';
import { place, stateWith } from './helpers';

export type LabCase = 'oneTimer' | 'heavySlap' | 'quickReleaseCalm' | 'quickReleasePressed' | 'finisherRebound' | 'finisherScreen';

/** The shot of each case: where home's shooter stands (home attacks +x), its type, and what else is set up. */
const CASES: Record<LabCase, { x: number; y: number; type: ShotType; badge: Badge; checker?: number; rebound?: boolean; screen?: boolean }> = {
  oneTimer: { x: 20, y: 2, type: 'oneTimer', badge: 'One-Timer' },
  heavySlap: { x: 12, y: 3, type: 'slap', badge: 'Heavy Slapshot' },
  quickReleaseCalm: { x: 17, y: 3, type: 'wrist', badge: 'Quick Release' },
  quickReleasePressed: { x: 17, y: 3, type: 'wrist', badge: 'Quick Release', checker: 1.2 },
  finisherRebound: { x: 22, y: 0.5, type: 'wrist', badge: 'Net-Front Finisher', rebound: true },
  finisherScreen: { x: 12, y: 3, type: 'wrist', badge: 'Net-Front Finisher', screen: true },
};

/** One lab shot of `c` by home's LW (`badged`: with the case's badge; for finisherScreen it is the screener's). Whether it scored. */
function labShot(c: LabCase, badged: boolean, seed: number): boolean {
  const k = CASES[c];
  const st: GameState = stateWith({ carrier: 'home', puckX: k.x, puckY: k.y, carrierSlot: 'LW' });
  for (const s of st.skaters) if (s.id !== 'home-LW') s.pos = { x: -20, y: s.pos.y };
  const ds = withGoalies();
  const shooter: PlayerDef = { ...ds.get('home-LW')!, badges: badged && !k.screen ? [k.badge] : [] };
  ds.set('home-LW', shooter);
  if (k.checker !== undefined) place(st, 'away:LD', k.x + k.checker, k.y);
  if (k.rebound) st.lastSave = { side: 'away', tick: st.tick, kind: 'rebound' };
  if (k.screen) { place(st, 'home:C', 25.2, 0.4); ds.set('home-C', { ...ds.get('home-C')!, badges: badged ? [k.badge] : [] }); }
  const rng = createRng(seed);
  executeShot(st, 'home-LW', ds, rng, [], k.type);
  return flyShot(st, ds, rng).some((t) => t.events.some((e) => e.type === 'goal'));
}

/** The lift of case `c` over `n` paired shots: goals with the badge over goals without, and both counts. */
export function labLift(c: LabCase, n: number): { lift: number; with: number; without: number } {
  let w = 0, wo = 0;
  for (let seed = 1; seed <= n; seed++) { if (labShot(c, true, seed)) w++; if (labShot(c, false, seed)) wo++; }
  return { lift: wo > 0 ? w / wo : NaN, with: w, without: wo };
}

/** Goals in `n` point shots (from 12 m) with a teammate screening in front, and with him 4 m wide of the play. */
export function labScreen(n: number): { screened: number; clear: number } {
  const one = (screen: boolean, seed: number): boolean => {
    const st = stateWith({ carrier: 'home', puckX: 15, puckY: 2, carrierSlot: 'LD' });
    for (const s of st.skaters) if (s.id !== 'home-LD' && s.id !== 'home-C') s.pos = { x: -20, y: s.pos.y };
    place(st, 'home:C', 24.5, screen ? 0.3 : 4.5);
    const ds = withGoalies(), rng = createRng(seed);
    executeShot(st, 'home-LD', ds, rng, [], 'wrist');
    return flyShot(st, ds, rng).some((t) => t.events.some((e) => e.type === 'goal'));
  };
  let s = 0, c = 0;
  for (let seed = 1; seed <= n; seed++) { if (one(true, seed)) s++; if (one(false, seed)) c++; }
  return { screened: s, clear: c };
}
