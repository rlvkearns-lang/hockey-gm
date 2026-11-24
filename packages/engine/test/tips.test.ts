import { describe, it, expect } from 'vitest';
import { tipChance } from '../src/tips';
import { executeShot } from '../src/actions';
import { bladePos } from '../src/blade';
import { createRng } from '../src/rng';
import type { GameEvent, PlayerDef } from '../src/types';
import { def, g, shareOf, skater, stateWith } from './helpers';
import { eventsOf, flyShot, withGoalies } from './shot-lab';

const GOAL_X = 27.13;
const FROM = { x: 9.5, y: 6 };

type End = 'goal' | 'save' | 'miss' | 'post' | 'block' | 'none';
type PointShot = { tipped: boolean; turnedRad: number; end: End; events: GameEvent[] };

/**
 * A wrist shot by the home LD from the point (9.5, 6) at the away goalie (rated `rating`), with the home C (`tipper`) at the
 * top of the crease, his stick blade on the shot's line 2.8 m out (or, with tipper null, nobody else on the ice).
 */
function pointShot(seed: number, tipper: PlayerDef | null, rating = 75): PointShot {
  const st = stateWith({ carrier: 'home', puckX: FROM.x, puckY: FROM.y, carrierSlot: 'LD' });
  for (const s of st.skaters) if (s.id !== 'home-LD' && (tipper === null || s.id !== 'home-C')) s.onIce = false;
  const ld = skater(st, 'home', 'LD');
  ld.pos = { x: FROM.x - 0.9, y: FROM.y - 0.4 }; ld.facing = Math.atan2(-FROM.y, GOAL_X - FROM.x);
  st.puck.pos = { ...FROM };
  const ds = withGoalies({ goalie: g(rating) });
  if (tipper !== null) {
    ds.set('home-C', { ...tipper, id: 'home-C', position: 'C' });
    const l = Math.hypot(GOAL_X - FROM.x, FROM.y), ux = (FROM.x - GOAL_X) / l, uy = FROM.y / l;
    const P = { x: GOAL_X + ux * 2.8, y: uy * 2.8 };
    const c = skater(st, 'home', 'C');
    c.facing = Math.atan2(uy, ux);
    const b = bladePos({ x: 0, y: 0 }, c.facing, tipper.shoots, { x: 0, y: 0 });
    c.pos = { x: P.x - b.x, y: P.y - b.y };
  }
  const rng = createRng(seed);
  executeShot(st, 'home-LD', ds, rng, [], 'wrist');
  const v0 = Math.atan2(st.puck.vel.y, st.puck.vel.x);
  const events = eventsOf(flyShot(st, ds, rng));
  const tip = events.find((e) => e.type === 'tip');
  const turnedRad = tip && tip.type === 'tip' ? Math.abs(Math.atan2(tip.detail.vel.y, tip.detail.vel.x) - v0) : 0;
  const endEvent = events.find((e) => e.type === 'goal' || e.type === 'save' || e.type === 'miss' || e.type === 'post' || e.type === 'block');
  return { tipped: tip !== undefined, turnedRad, end: (endEvent?.type ?? 'none') as End, events };
}

function tipShare(d: PlayerDef, n: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (pointShot(i + 1, d).tipped) k++;
  return k / n;
}
const handy = def({ puckHandling: 95, shootingAccuracy: 95, iq: 95 });
/** Tipped point shots among `n` with a skilled tipper. */
const tippedShots = (n: number): PointShot[] => Array.from({ length: n }, (_, i) => pointShot(20_000 + i, handy)).filter((s) => s.tipped);
/** The same point shots with nobody in front. */
const untippedShots = (n: number): PointShot[] => Array.from({ length: n }, (_, i) => pointShot(20_000 + i, null));

describe('tips (Task 8)', () => {
  it('a net-front man with his stick in the lane tips 5% to 40% of point shots; hand-eye helps', () => {
    const avg = tipShare(def({}), 2000);
    expect(avg).toBeGreaterThan(0.05); expect(avg).toBeLessThan(0.40);
    expect(tipShare(handy, 2000)).toBeGreaterThan(tipShare(def({ puckHandling: 40, shootingAccuracy: 40, iq: 40 }), 2000) * 1.5);
    expect(tipChance(def({ puckHandling: 100, shootingAccuracy: 100, iq: 100 }))).toBeLessThanOrEqual(0.97);
    expect(tipChance(def({ puckHandling: 1, shootingAccuracy: 1, iq: 1 }))).toBeGreaterThanOrEqual(0.03);
  }, 120_000);
  it('a tip changes the path late, is harder to save, and can miss the net', () => {
    const t = tippedShots(3000), plain = untippedShots(3000);
    expect(t.length).toBeGreaterThan(300);
    expect(shareOf(t, (s) => s.turnedRad > 0.017)).toBeGreaterThan(0.8);
    expect(shareOf(t, (s) => s.end === 'miss' || s.end === 'post')).toBeGreaterThan(0.05);
    const goalRate = (xs: PointShot[]): number => xs.filter((s) => s.end === 'goal').length / xs.filter((s) => s.end === 'goal' || s.end === 'save').length;
    expect(goalRate(t)).toBeGreaterThan(goalRate(plain) * 1.3);
  }, 120_000);
  it('a tipped goal is the tipper\'s, the shooter has the first assist, and it points back to the shooter\'s release', () => {
    let goal: Extract<GameEvent, { type: 'goal' }> | null = null, shot: Extract<GameEvent, { type: 'shot' }> | null = null;
    for (let seed = 1; seed < 5000 && goal === null; seed++) {
      const s = pointShot(seed, handy, 40);
      if (!s.tipped || s.end !== 'goal') continue;
      goal = s.events.find((e): e is Extract<GameEvent, { type: 'goal' }> => e.type === 'goal')!;
      shot = s.events.find((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot')!;
    }
    expect(goal).not.toBeNull();
    expect(goal!.playerId).toBe('home-C'); expect(goal!.detail.tippedFrom).toBe('home-LD'); expect(goal!.assistIds[0]).toBe('home-LD');
    expect(shot!.playerId).toBe('home-C'); expect(shot!.detail.tippedFrom).toBe('home-LD'); expect(goal!.detail.releaseTick).toBe(0);
  }, 120_000);
  // Task 8 review, Minor 2: after a tip the line starts at the tipper's blade, with his own body beside it.
  it('the man who tipped it is not his own screen: no tipped shot on goal is screened with only him in front', () => {
    const shots = tippedShots(1500).flatMap((s) => s.events.filter((e) => e.type === 'shot'));
    expect(shots.length).toBeGreaterThan(30);
    for (const e of shots) if (e.type === 'shot') { expect(e.detail.tippedFrom).not.toBeNull(); expect(e.detail.screened).toBe(false); }
  }, 60_000);
});
