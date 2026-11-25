import { describe, it, expect } from 'vitest';
import { goalieTick, saveChance } from '../src/goalie';
import { DT } from '../src/constants';
import { withGoalies } from './shot-lab';
import { createGame, simulateGame } from '../src/game';
import type { GameEvent, GameResult } from '../src/types';
import { executeShot } from '../src/actions';
import { RINK } from '../src/rink';
import { createRng } from '../src/rng';
import type { PlayerDef } from '../src/types';
import { assistsWhenTouched, blockAttempt, count, def, defs, g, setup, share, shareOf, simulateUntilFirstGoal, stateWith, sum } from './helpers';

/** Whole-game tests take about 1 s; this leaves room for a loaded machine. */
const GAME_TIMEOUT = 20_000;

const base = { goalie: g(70), lateralMiss: 0.2, shotSpeed: 32, distance: 12, screened: false, goalieMovingSpeed: 0, height: 0.4 };

/** Where `n` shots by home C (`d`) from (x, y) cross the attacked goal line (y), and how hard each was lifted (vz). */
function shotsFrom(d: PlayerDef, x: number, y: number, n: number): { y: number; vz: number }[] {
  const out: { y: number; vz: number }[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const st = stateWith({ carrier: 'home', puckX: x, puckY: y, carrierSlot: 'C' });
    for (const s of st.skaters) if (s.side === 'away') s.pos = { x: -20, y: s.pos.y };
    const ds = new Map(defs); ds.set('home-C', { ...d, id: 'home-C', position: 'C' });
    executeShot(st, 'home-C', ds, createRng(seed));
    const p = st.puck, t = (RINK.goalLineX - p.pos.x) / p.vel.x;
    out.push({ y: p.pos.y + p.vel.y * t, vz: p.vz });
  }
  return out;
}

describe('shots', () => {
  it('a few shots miss the net outright, more for a poor shooter; neither always nor never', () => {
    const wide = (d: PlayerDef) => shareOf(shotsFrom(d, 15, 0, 1500), (s) => Math.abs(s.y) > RINK.netHalfWidth + 0.1);
    const good = wide(def({ shootingAccuracy: 92 })), poor = wide(def({ shootingAccuracy: 40 }));
    expect(poor).toBeGreaterThan(good + 0.05); expect(good).toBeGreaterThan(0.03); expect(poor).toBeLessThan(0.6);
  });
  it('a shot from right beside the net is not launched skyward', () => {
    for (const s of shotsFrom(def({}), RINK.goalLineX - 0.4, 1.1, 300)) expect(s.vz).toBeLessThanOrEqual(10);
  });
});

describe('goalies, saves, goals', () => {
  it('better goalies save more, never everything', () => { expect(saveChance({ ...base, goalie: g(95) })).toBeGreaterThan(saveChance({ ...base, goalie: g(50) }) + 0.03); expect(saveChance({ ...base, goalie: g(100), distance: 50 })).toBeLessThanOrEqual(0.97); });
  it('being out of position, screens, speed and close range all hurt', () => {
    for (const worse of [{ lateralMiss: 0.9 }, { screened: true }, { shotSpeed: 42 }, { distance: 4 }, { goalieMovingSpeed: 4 }]) expect(saveChance({ ...base, ...worse })).toBeLessThan(saveChance(base));
  });
  it('an open net is nearly always a goal but a set goalie on a point shot nearly always saves', () => { expect(saveChance({ ...base, lateralMiss: 1.6 })).toBeLessThan(0.2); expect(saveChance({ ...base, distance: 18, lateralMiss: 0.05 })).toBeGreaterThan(0.95); });
  it('goals credit scorer, assists and plus/minus', () => {
    const r = simulateUntilFirstGoal(setup(11)); const goal = r.events.find(e => e.type === 'goal')!;
    expect(goal.playerId).not.toBeNull(); expect(goal.assistIds.length).toBeLessThanOrEqual(2); expect(goal.assistIds).not.toContain(goal.playerId);
    expect(sum(r.players.map(p => p.plusMinus))).toBe(0); expect(r.players.find(p => p.id === goal.playerId)!.goals).toBe(1);
  }, GAME_TIMEOUT);
  it('only touches within about 10 s of the goal earn an assist', () => {
    expect(assistsWhenTouched(4)).toEqual(['home-LW']);
    expect(assistsWhenTouched(12)).toEqual([]);
  });
  it('a goalie\'s night moves his save chance, and each game draws its own', () => {
    expect(saveChance({ ...base, distance: 6, night: 0.5 })).toBeGreaterThan(saveChance({ ...base, distance: 6 }));
    expect(saveChance({ ...base, distance: 6, night: -0.5 })).toBeLessThan(saveChance({ ...base, distance: 6 }));
    const nights = [1, 2, 3].map((s) => createGame(setup(s)).state.goalieNight);
    expect(new Set(nights.map((n) => n.home)).size).toBe(3);
    expect(createGame(setup(1)).state.goalieNight).toEqual(nights[0]);
  });
  it('shot blockers block more', () => { expect(share(3000, () => blockAttempt(def({ shotBlocking: 92 })))).toBeGreaterThan(share(3000, () => blockAttempt(def({ shotBlocking: 40 }))) + 0.15); });
  // A goal with releaseTick null went in with no shot (a pass or loose puck): no shot on goal (Task 7 review).
  const shotGoals = (r: GameResult, side: 'home' | 'away'): number => r.events.filter((e) => e.type === 'goal' && e.side === side && e.detail.releaseTick !== null).length;
  it('shots, saves and goals reconcile', () => { const r = simulateGame(setup(4)); expect(r.team.home.shots).toBe(count(r, 'save', 'away') + shotGoals(r, 'home')); }, GAME_TIMEOUT);
  describe('every goal and shot is credited (seeds 1 to 8)', () => {
    const results: GameResult[] = [];
    const games = (): GameResult[] => { if (results.length === 0) for (let seed = 1; seed <= 8; seed++) results.push(simulateGame(setup(seed))); return results; };
    const sideOf = (s: ReturnType<typeof setup>, id: string | null) => (s.home.players.some(p => p.id === id) ? 'home' : s.away.players.some(p => p.id === id) ? 'away' : null);
    it('every goal and shot names a player of its own side', () => {
      const bad: string[] = [];
      games().forEach((r, i) => { const s = setup(i + 1); for (const e of r.events) if ((e.type === 'goal' || e.type === 'shot') && (e.playerId === null || sideOf(s, e.playerId) !== e.side)) bad.push(`seed ${i + 1} tick ${e.tick} ${e.type} ${e.playerId}`); });
      expect(bad).toEqual([]);
    }, GAME_TIMEOUT * 8);
    it('player goals add up to the score, and shots reconcile for both sides', () => {
      games().forEach((r, i) => {
        const s = setup(i + 1);
        for (const side of ['home', 'away'] as const) {
          const other = side === 'home' ? 'away' : 'home';
          const ids = new Set(s[side].players.map(p => p.id));
          expect(sum(r.players.filter(p => ids.has(p.id)).map(p => p.goals))).toBe(r.score[side]);
          expect(r.team[side].shots).toBe(count(r, 'save', other) + shotGoals(r, side));
        }
      });
    }, GAME_TIMEOUT * 8);
    // Task 8: the shot is emitted where the puck meets the goalie and the goal when it crosses the line, up to 4 ticks later.
    it('every goal from a shot is preceded by its shot by the same player, at most 4 ticks before', () => {
      const bad: string[] = [];
      for (const r of games()) r.events.forEach((e, k) => {
        if (e.type !== 'goal' || e.detail.releaseTick === null) return;
        let j = k - 1; while (j >= 0 && r.events[j]!.type !== 'shot') j--;
        const prev = r.events[j];
        if (!prev || prev.type !== 'shot' || prev.playerId !== e.playerId || e.tick - prev.tick > 4) bad.push(`tick ${e.tick}`);
      });
      expect(bad).toEqual([]);
    }, GAME_TIMEOUT * 8);
  });
});

// Task 13: a goalie under pressure covers a puck he has. His body in his crease, a slow loose puck within his reach in
// front of his goal line (in the crease or just outside it), an opponent near it: he falls on it and play stops. Not
// behind his line, not from out of his crease, not with nobody near.
describe('a goalie under pressure covers the puck (Task 13)', () => {
  const GOAL_X = RINK.goalLineX;
  /** Away goalie (net at +x) at `g`, the puck still at `p`, home C at `c` (or off the ice), everyone else off the ice. */
  function cover(gp: { x: number; y: number }, p: { x: number; y: number }, c: { x: number; y: number } | null): { stopped: boolean; events: GameEvent[] } {
    const st = stateWith({ carrier: null, puckX: p.x, puckY: p.y });
    for (const s of st.skaters) s.onIce = false;
    const hc = st.skaters.find((k) => k.id === 'home-C')!;
    if (c !== null) { hc.onIce = true; hc.pos = { ...c }; }
    st.goalies.away.pos = { ...gp };
    st.puck.vel = { x: 0, y: 0 };
    const out: GameEvent[] = [];
    goalieTick(st, withGoalies(), DT, out);
    return { stopped: st.phase === 'stopped', events: out };
  }
  it('covers a puck at his feet just outside his crease with an attacker on him', () => {
    const r = cover({ x: GOAL_X - 1.55, y: 0.4 }, { x: GOAL_X - 2.25, y: 0.9 }, { x: GOAL_X - 3.6, y: 1.5 });
    expect(r.stopped).toBe(true);
    expect(r.events).toEqual([expect.objectContaining({ type: 'freeze', playerId: 'away-G', detail: { cause: 'cover' } })]);
  });
  it('covers one in his crease, as before', () => {
    expect(cover({ x: GOAL_X - 0.9, y: 0 }, { x: GOAL_X - 1.2, y: 0.5 }, { x: GOAL_X - 3, y: 0.5 }).stopped).toBe(true);
  });
  it('goes for a slow loose puck in his crease when an attacker is on it, and covers it within half a second', () => {
    for (const p of [{ x: GOAL_X - 0.9, y: 1.55 }, { x: GOAL_X - 1.75, y: -0.4 }, { x: GOAL_X - 1.2, y: -1.2 }]) {
      const st = stateWith({ carrier: null, puckX: p.x, puckY: p.y });
      for (const s of st.skaters) s.onIce = false;
      const hc = st.skaters.find((k) => k.id === 'home-C')!;
      hc.onIce = true; hc.pos = { x: p.x - 2.2, y: p.y };
      st.goalies.away.pos = { x: GOAL_X - 0.5, y: 0 };
      st.puck.vel = { x: 0, y: 0 };
      const ds = withGoalies(); const out: GameEvent[] = [];
      expect(Math.hypot(st.goalies.away.pos.x - p.x, st.goalies.away.pos.y - p.y)).toBeGreaterThan(1.1);
      for (let t = 0; t < 30 && st.phase === 'live'; t++) goalieTick(st, ds, DT, out);
      expect(st.phase).toBe('stopped');
      expect(out.at(-1)).toMatchObject({ type: 'freeze', playerId: 'away-G', detail: { cause: 'cover' } });
    }
  });
  it('leaves it with nobody near, behind his goal line, or when he is out of his crease', () => {
    expect(cover({ x: GOAL_X - 1.55, y: 0.4 }, { x: GOAL_X - 2.25, y: 0.9 }, null).stopped).toBe(false);
    expect(cover({ x: GOAL_X - 1.55, y: 0.4 }, { x: GOAL_X - 2.25, y: 0.9 }, { x: GOAL_X - 8, y: 1.5 }).stopped).toBe(false);
    expect(cover({ x: GOAL_X - 0.4, y: 1.1 }, { x: GOAL_X + 0.3, y: 1.4 }, { x: GOAL_X + 1.5, y: 2.5 }).stopped).toBe(false);
    expect(cover({ x: GOAL_X - 2.6, y: 0.5 }, { x: GOAL_X - 3.3, y: 0.9 }, { x: GOAL_X - 4.5, y: 1.5 }).stopped).toBe(false);
  });
});
