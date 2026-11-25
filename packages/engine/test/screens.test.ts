/**
 * Task 13b item 3: a screen as dangerous as the valuation says. A screened goalie reacts later and reads the shot worse,
 * by how much of his sight line to the puck an attacker blocked on its way (shot.sight: ticks watched and ticks blocked).
 */
import { describe, it, expect } from 'vitest';
import { saveChance } from '../src/goalie';
import { createRng } from '../src/rng';
import type { GameEvent, GameState } from '../src/types';
import { executeShot } from '../src/actions';
import { flyShot, withGoalies } from './shot-lab';
import { g, place, stateWith } from './helpers';

const base = { goalie: g(70), lateralMiss: 0.2, shotSpeed: 36, distance: 18, screened: false, goalieMovingSpeed: 0, height: 0.4 };

/**
 * Home LD shoots from the point (x 9, y 1; home attacks +x, the away goalie at x 26.3). With `screen`, home C stands in the
 * goalie's sight line 2 m in front of him; otherwise he is 4 m wide of it. Every other skater is far away.
 */
function pointShot(screen: boolean, seed: number): { st: GameState; events: GameEvent[] } {
  const st = stateWith({ carrier: 'home', puckX: 9, puckY: 1, carrierSlot: 'LD' });
  for (const s of st.skaters) if (s.id !== 'home-LD' && s.id !== 'home-C') s.pos = { x: -20, y: s.pos.y };
  place(st, 'home:C', 24.3, screen ? 0.3 : 4.5);
  const ds = withGoalies();
  const rng = createRng(seed);
  const out: GameEvent[] = [];
  executeShot(st, 'home-LD', ds, rng, out, 'wrist');
  const ticks = flyShot(st, ds, rng);
  return { st, events: [...out, ...ticks.flatMap((t) => t.events)] };
}

describe('screens (Task 13b)', () => {
  it('the more of the shot he could not see, the worse he reads it and the later he reacts', () => {
    const s0 = saveChance({ ...base, screenShare: 0 }), s5 = saveChance({ ...base, screenShare: 0.5 }), s1 = saveChance({ ...base, screenShare: 1 });
    expect(s5).toBeLessThan(s0); expect(s1).toBeLessThan(s5);
    // Screened for the whole flight he gets no time from the distance: a far shot is no easier to read than a near one.
    expect(saveChance({ ...base, screenShare: 1, distance: 18 })).toBeCloseTo(saveChance({ ...base, screenShare: 1, distance: 6 }), 6);
    // (The flag alone, as before: screened is a full screen.)
    expect(saveChance({ ...base, screened: true })).toBeCloseTo(s1, 9);
  });
  it('a man standing in the goalie\'s sight line blocks most of a point shot\'s flight; one wide of it none', () => {
    let blocked = 0, clear = 0, nb = 0, nc = 0;
    // The share is read off the shot events (detail.screen).
    for (let seed = 1; seed <= 40; seed++) {
      for (const e of pointShot(true, seed).events) if (e.type === 'shot' && e.detail.screen !== undefined) { blocked += e.detail.screen; nb++; }
      for (const e of pointShot(false, seed).events) if (e.type === 'shot' && e.detail.screen !== undefined) { clear += e.detail.screen; nc++; }
    }
    expect(nb).toBeGreaterThan(10); expect(nc).toBeGreaterThan(10);
    expect(blocked / nb).toBeGreaterThan(0.5);
    expect(clear / nc).toBe(0);
  });
  // Task 14 (Task 13b review, Important 1 and Minor 8): one screen mechanism. The sight-line share decides the save,
  // the `screened` flag on the events and the held-rebound chance; a goalie's own defenders block his sight as an
  // attacker does; no timer flag (state.screenedUntilTick is no longer written or read).
  it('a defender standing in his own goalie\'s sight line screens him too', () => {
    let share = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const st = stateWith({ carrier: 'home', puckX: 9, puckY: 1, carrierSlot: 'LD' });
      for (const s of st.skaters) if (s.id !== 'home-LD' && s.id !== 'away-LD') s.pos = { x: -20, y: s.pos.y };
      place(st, 'away:LD', 24.3, 0.3);
      const ds = withGoalies(); const rng = createRng(seed); const out: GameEvent[] = [];
      executeShot(st, 'home-LD', ds, rng, out, 'wrist');
      for (const t of flyShot(st, ds, rng)) for (const e of t.events) if (e.type === 'shot' && e.detail.screen !== undefined) { share += e.detail.screen; n++; }
    }
    expect(n).toBeGreaterThan(5); expect(share / n).toBeGreaterThan(0.5); // (he also blocks many of them)
  });
  it('the `screened` flag on a shot is the sight-line share: true from half the flight hidden, and nothing else sets it', () => {
    let seen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const screen of [true, false]) {
        const { st, events } = pointShot(screen, seed);
        expect(st.screenedUntilTick).toEqual({ home: 0, away: 0 });
        for (const e of events) if ((e.type === 'shot' || e.type === 'goal') && 'screened' in e.detail) {
          const sh = events.find((f) => f.type === 'shot' && f.detail.screen !== undefined);
          if (sh === undefined || sh.type !== 'shot') continue;
          expect(e.detail.screened).toBe(sh.detail.screen! >= 0.5); seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(40);
  });
  it('a timer flag no longer screens anybody: with screenedUntilTick set and nobody in the sight line the shot is clean', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const st = stateWith({ carrier: 'home', puckX: 9, puckY: 1, carrierSlot: 'LD' });
      for (const s of st.skaters) if (s.id !== 'home-LD') s.pos = { x: -20, y: s.pos.y };
      st.screenedUntilTick = { home: st.tick + 600, away: st.tick + 600 };
      const ds = withGoalies(); const rng = createRng(seed); const out: GameEvent[] = [];
      executeShot(st, 'home-LD', ds, rng, out, 'wrist');
      for (const t of flyShot(st, ds, rng)) for (const e of t.events) if (e.type === 'shot') expect(e.detail.screened).toBe(false);
    }
  });
  it('screened point shots score several times as often as clean ones from the same spot (at least 2.5 times)', () => {
    const goals = (screen: boolean): number => { let n = 0; for (let seed = 1; seed <= 600; seed++) if (pointShot(screen, seed).events.some((e) => e.type === 'goal')) n++; return n; };
    const s = goals(true), c = goals(false);
    expect(s).toBeGreaterThan(2.5 * Math.max(c, 4));
  }, 60_000);
});
