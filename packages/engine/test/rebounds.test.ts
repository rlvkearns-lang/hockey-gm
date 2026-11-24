import { describe, it, expect } from 'vitest';
import { saveOutcome, saveOutcomeChances, type SaveFacts } from '../src/rebounds';
import { executeShot } from '../src/actions';
import { stepPuck } from '../src/puck';
import { createRng } from '../src/rng';
import { DT } from '../src/constants';
import type { GameEvent, GameState, SaveKind, SavePose } from '../src/types';
import { g, shareOf, skater, stateWith } from './helpers';
import { eventsOf, flyShot, withGoalies } from './shot-lab';
import { whistleFacedShot } from '../src/goalie';
import { moveLoosePuck } from '../src/shots';

const POSES: SavePose[] = ['glove', 'blocker', 'pad', 'butterfly'];
const GOAL_X = 27.13;

/** A live state with nobody on the ice but the goalies (home attacks +x: the away goalie's net is at +x). */
function empty(): GameState {
  const st = stateWith({ carrier: null, puckX: 20 });
  for (const s of st.skaters) s.onIce = false;
  return st;
}

/**
 * `n` saves by the away goalie, drawn with saveOutcome from a save point at his plane (his depth 0.3 to 1.3 m, his y within
 * 0.6 m of the middle, the puck up to 1 m to either side of him), with nobody near: each outcome, and where the puck is
 * 0.5 s and 1 s later.
 */
function outcomesOf(n: number): { kind: SaveKind; at05: { x: number; y: number }; at1: { x: number; y: number } }[] {
  const out: { kind: SaveKind; at05: { x: number; y: number }; at1: { x: number; y: number } }[] = [];
  for (let i = 0; i < n; i++) {
    const rng = createRng(1000 + i);
    const st = empty();
    const gl = st.goalies.away;
    gl.pos = { x: GOAL_X - rng.range(0.3, 1.3), y: rng.range(-0.6, 0.6) };
    const side = rng.range(-1, 1);
    // His left, facing out of the net at +x (toward -x), is -y.
    st.puck.pos = { x: gl.pos.x, y: gl.pos.y - side };
    st.puck.vel = { x: 0, y: 0 };
    const f: SaveFacts = { pose: POSES[i % 4]!, speed: 32, screened: false, tipped: false, reboundControl: rng.range(20, 90) };
    const kind = saveOutcome(st, 'away', f, { side, height: 0.4 }, rng, []);
    if (kind === 'held') { out.push({ kind, at05: { ...st.puck.pos }, at1: { ...st.puck.pos } }); continue; }
    for (let t = 0; t < 15; t++) stepPuck(st.puck, DT);
    const at05 = { ...st.puck.pos };
    for (let t = 0; t < 15; t++) stepPuck(st.puck, DT);
    out.push({ kind, at05, at1: { ...st.puck.pos } });
  }
  return out;
}

/** A wrist shot by the home C from the slot at (x, y) at the away goalie (rated `rating`, catching `catches`), flown until it ends. */
function slotShot(seed: number, x: number, y: number, o: { rating?: number; catches?: 'L' | 'R' } = {}): { st: GameState; ticks: ReturnType<typeof flyShot> } {
  const st = stateWith({ carrier: 'home', puckX: x, puckY: y, carrierSlot: 'C' });
  for (const s of st.skaters) if (s.id !== 'home-C') s.onIce = false;
  const c = skater(st, 'home', 'C');
  c.pos = { x: x - 0.9, y: y - 0.4 }; c.facing = Math.atan2(-y, GOAL_X - x);
  const ds = withGoalies({ goalie: g(o.rating ?? 85), catches: o.catches ?? 'L' });
  const rng = createRng(seed);
  executeShot(st, 'home-C', ds, rng, [], 'wrist');
  return { st, ticks: flyShot(st, ds, rng) };
}

/** From seed `seed` on, the first slot shot that is saved: the save event, the goalie then, the puck's travel on the save tick and the shot's speed before it. */
function savedShot(seed: number): { saveEvent: Extract<GameEvent, { type: 'save' }>; goalie: { x: number; y: number }; puckStepOnSaveTick: number; shotSpeed: number } {
  for (let k = seed; ; k += 1000) {
    const { st, ticks } = slotShot(k, 17 + (k % 5), ((k % 7) - 3) * 0.8);
    for (const t of ticks) {
      const save = t.events.find((e): e is Extract<GameEvent, { type: 'save' }> => e.type === 'save');
      if (!save) continue;
      return { saveEvent: save, goalie: { ...st.goalies.away.pos }, puckStepOnSaveTick: Math.hypot(t.after.x - t.before.x, t.after.y - t.before.y), shotSpeed: t.speed };
    }
  }
}

/** Save events of `n` slot shots at a goalie catching with `catches`. */
function manySaves(n: number, catches: 'L' | 'R'): Extract<GameEvent, { type: 'save' }>[] {
  const out: Extract<GameEvent, { type: 'save' }>[] = [];
  for (let i = 0; i < n; i++) {
    const { ticks } = slotShot(5000 + i, 14 + (i % 9), ((i % 11) - 5) * 0.9, { rating: 70, catches });
    for (const e of eventsOf(ticks)) if (e.type === 'save') out.push(e);
  }
  return out;
}

describe('saves with an outcome (Task 8)', () => {
  it('a save is held, steered to a corner or leaves a rebound; none is certain and they sum to 1', () => {
    for (const pose of POSES) for (const rc of [1, 50, 100]) for (const extra of [{}, { speed: 45, screened: true, tipped: true }]) {
      const c = saveOutcomeChances({ pose, speed: 32, screened: false, tipped: false, reboundControl: rc, ...extra });
      for (const k of ['held', 'steered', 'rebound'] as const) { expect(c[k]).toBeGreaterThanOrEqual(0.03); expect(c[k]).toBeLessThanOrEqual(0.97); }
      expect(c.held + c.steered + c.rebound).toBeCloseTo(1, 9);
    }
  });
  it('rebound control matters: a 90 leaves at least 15 points fewer rebounds than a 30; a hard, screened, tipped shot leaves more', () => {
    const rb = (o: Partial<SaveFacts>): number => saveOutcomeChances({ pose: 'pad', speed: 32, screened: false, tipped: false, reboundControl: 60, ...o }).rebound;
    expect(rb({ reboundControl: 30 }) - rb({ reboundControl: 90 })).toBeGreaterThan(0.15);
    expect(rb({ speed: 40, screened: true, tipped: true })).toBeGreaterThan(rb({}) + 0.1);
  });
  it('a rebound is still in front half a second later; a steered puck is in the corner a second later', () => {
    const where = outcomesOf(2000);
    const front = where.filter((w) => w.kind === 'rebound'), corner = where.filter((w) => w.kind === 'steered');
    expect(front.length).toBeGreaterThan(100); expect(corner.length).toBeGreaterThan(100);
    expect(shareOf(front, (w) => Math.hypot(GOAL_X - w.at05.x, w.at05.y) < 4 && w.at05.x < GOAL_X)).toBeGreaterThan(0.9);
    expect(shareOf(corner, (w) => Math.abs(w.at1.y) > 5 && Math.hypot(GOAL_X - w.at1.x, w.at1.y) > 5)).toBeGreaterThan(0.85);
  });
  // Task 8 review, Important 2: a rebound depends on the save, the shot and the goalie.
  /** `n` rebounds (saveOutcome draws that leave one) off the away goalie at the middle of his net, the shot arriving with velocity (vx, vy): each one's speed and its angle off straight out (rad, positive toward +y). */
  const reboundsOf = (n: number, o: Partial<SaveFacts> & { vx?: number; vy?: number; side?: number }): { speed: number; angle: number }[] => {
    const out: { speed: number; angle: number }[] = [];
    for (let i = 0; out.length < n && i < n * 40; i++) {
      const st = empty(); const gl = st.goalies.away; gl.pos = { x: GOAL_X - 1, y: 0 };
      const side = o.side ?? 0;
      st.puck.pos = { x: gl.pos.x, y: -side }; st.puck.vel = { x: o.vx ?? 30, y: o.vy ?? 0 };
      const f: SaveFacts = { pose: 'pad', speed: Math.hypot(o.vx ?? 30, o.vy ?? 0), screened: false, tipped: false, reboundControl: 60, ...o };
      if (saveOutcome(st, 'away', f, { side, height: 0.2 }, createRng(70_000 + i), []) !== 'rebound') continue;
      out.push({ speed: Math.hypot(st.puck.vel.x, st.puck.vel.y), angle: Math.atan2(st.puck.vel.y, -st.puck.vel.x) });
    }
    return out;
  };
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  it('a harder shot leaves a livelier rebound, a pad a livelier one than the glove, and better rebound control a deader one; all within 2.5 to 6 m/s', () => {
    const sp = (o: Partial<SaveFacts> & { vx?: number }): number => mean(reboundsOf(200, o).map((r) => r.speed));
    expect(sp({ vx: 40 })).toBeGreaterThan(sp({ vx: 22 }) + 1.2);
    expect(sp({ vx: 34, pose: 'pad' })).toBeGreaterThan(sp({ vx: 34, pose: 'glove' }) + 1);
    expect(sp({ vx: 34, pose: 'pad' })).toBeGreaterThan(sp({ vx: 34, pose: 'butterfly' }) + 0.5);
    expect(sp({ vx: 34, reboundControl: 30 })).toBeGreaterThan(sp({ vx: 34, reboundControl: 90 }) + 0.8);
    for (const o of [{ vx: 45, reboundControl: 20 }, { vx: 10, pose: 'glove' as const, reboundControl: 95 }]) for (const r of reboundsOf(100, o)) { expect(r.speed).toBeGreaterThanOrEqual(2.5 - 1e-9); expect(r.speed).toBeLessThanOrEqual(6 + 1e-9); }
  });
  it('a rebound follows the shot\'s line and the saving part: a shot moving toward +y comes out toward +y, a pad or blocker kicks it to its own side, the chest drops it in front', () => {
    const ang = (o: Partial<SaveFacts> & { vx?: number; vy?: number; side?: number }): number => mean(reboundsOf(300, o).map((r) => r.angle));
    // From the -y wing (moving toward +y), 30 degrees off straight on: out toward +y; from the other wing, toward -y.
    expect(ang({ pose: 'butterfly', vx: 26, vy: 15 })).toBeGreaterThan(0.15); expect(ang({ pose: 'butterfly', vx: 26, vy: -15 })).toBeLessThan(-0.15);
    // Straight on: the away goalie's left is -y, so a save on his left (side > 0) goes toward -y off a pad or a blocker.
    expect(ang({ pose: 'pad', side: 0.4 })).toBeLessThan(-0.2); expect(ang({ pose: 'pad', side: -0.4 })).toBeGreaterThan(0.2);
    expect(ang({ pose: 'blocker', side: -0.4 })).toBeGreaterThan(ang({ pose: 'pad', side: -0.4 }) + 0.1);
    expect(Math.abs(ang({ pose: 'butterfly', side: 0.4 }))).toBeLessThan(0.08);
    // A goalie with poor rebound control sprays them wider.
    const sd = (rc: number): number => { const a = reboundsOf(300, { pose: 'butterfly', reboundControl: rc }).map((r) => r.angle); const m0 = mean(a); return Math.sqrt(mean(a.map((x) => (x - m0) * (x - m0)))); };
    expect(sd(30)).toBeGreaterThan(sd(90) * 1.5);
  });
  it('better rebound control: more saves held and fewer rebounds (a 90 holds at least 15 points more than a 30 with the glove)', () => {
    const c = (rc: number): ReturnType<typeof saveOutcomeChances> => saveOutcomeChances({ pose: 'glove', speed: 30, screened: false, tipped: false, reboundControl: rc });
    expect(c(90).held - c(30).held).toBeGreaterThan(0.15); expect(c(90).rebound).toBeLessThan(c(30).rebound);
  });
  it('a save sets lastSave for that goalie; a held one stops play', () => {
    const rng = createRng(3);
    const kinds = new Set<SaveKind>();
    for (let i = 0; i < 60 && kinds.size < 3; i++) {
      const s2 = empty(); s2.tick = 500; s2.puck.pos = { x: s2.goalies.away.pos.x, y: 0.3 };
      const k = saveOutcome(s2, 'away', { pose: 'pad', speed: 30, screened: false, tipped: false, reboundControl: 50 }, { side: -0.3, height: 0.1 }, rng, []);
      kinds.add(k);
      if (k === 'held') { expect(s2.phase).toBe('stopped'); expect(s2.lastSave).toBeNull(); }
      else expect(s2.lastSave).toEqual({ side: 'away', tick: 500, kind: k });
    }
    expect(kinds.size).toBe(3);
  });
  it('the save is made at the goalie: the puck stops at his plane and comes out from there, never from behind him', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = savedShot(seed);
      expect(Math.abs(s.saveEvent.pos.x - s.goalie.x)).toBeLessThan(0.05);
      expect(s.puckStepOnSaveTick).toBeLessThanOrEqual(s.shotSpeed * DT + 0.05);
      expect(s.saveEvent.detail.cross.height).toBeGreaterThanOrEqual(0); expect(Math.abs(s.saveEvent.detail.cross.side)).toBeLessThan(1.6);
      expect(s.saveEvent.pos.x).toBeLessThan(GOAL_X);
    }
  }, 60_000);
  it('the crossing point says which hand: a left-catching goalie\'s glove saves are on his left', () => {
    const left = manySaves(600, 'L').filter((s) => s.detail.pose === 'glove'), right = manySaves(600, 'R').filter((s) => s.detail.pose === 'glove');
    expect(left.length).toBeGreaterThan(20); expect(right.length).toBeGreaterThan(20);
    for (const s of left) expect(s.detail.cross.side).toBeGreaterThan(0);
    for (const s of right) expect(s.detail.cross.side).toBeLessThan(0);
  }, 60_000);
  // Task 8 review, Minor 1: sharp-angle shots were "saved" at his plane up to 3 m from him.
  it('a save needs the goalie within reach: a sharp-angle shot crossing his plane wide of him is never saved out there', () => {
    let saves = 0, shots = 0;
    for (let seed = 1; seed <= 400; seed++) {
      // From low on the wing, 1.2 to 2.8 m out from the goal line: its line crosses his plane well wide of him.
      const { st, ticks } = slotShot(seed, GOAL_X - 1.2 - (seed % 5) * 0.4, (seed % 2 === 0 ? 1 : -1) * (5 + (seed % 4)));
      for (const e of eventsOf(ticks)) {
        if (e.type === 'shot') shots++;
        if (e.type !== 'save') continue;
        saves++;
        expect(Math.hypot(e.pos.x - st.goalies.away.pos.x, e.pos.y - st.goalies.away.pos.y)).toBeLessThanOrEqual(1.6 + 1.3);
        expect(Math.abs(e.detail.cross.side)).toBeLessThanOrEqual(1.6 + 1e-9);
      }
    }
    expect(shots).toBeGreaterThan(20); expect(saves).toBeGreaterThan(5);
  }, 60_000);
  // Task 8 review, Minor 4: a referee's whistle kills a shot already past the goalie.
  it('a shot past the goalie is no goal at a referee\'s whistle: it ends as a held save, the score stands', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const st = stateWith({ carrier: 'home', puckX: 19, puckY: 1, carrierSlot: 'C' });
      for (const s of st.skaters) if (s.id !== 'home-C') s.onIce = false;
      const ds = withGoalies({ goalie: g(40) }); const rng = createRng(seed); const out: GameEvent[] = [];
      st.goalies.away.pos = { x: GOAL_X - 1.3, y: 0 }; // well out: a backhand takes over a tick from him to the line
      executeShot(st, 'home-C', ds, rng, out, 'backhand');
      const prev = { x: 0, y: 0 };
      for (let t = 0; t < 60 && st.shotInFlight !== null && !st.shotInFlight.faced && st.phase === 'live'; t++) { st.tick++; moveLoosePuck(st, ds, rng, out, prev); }
      if (st.shotInFlight === null || !st.shotInFlight.faced || st.phase !== 'live') continue;
      const n = out.length;
      whistleFacedShot(st, ds, out);
      expect(st.shotInFlight).toBeNull(); expect(st.score).toEqual({ home: 0, away: 0 });
      expect(out.length).toBe(n + 1); const e = out[n]!;
      expect(e.type).toBe('save'); if (e.type === 'save') { expect(e.detail.kind).toBe('held'); expect(e.playerId).toBe('away-G'); expect(e.otherId).toBe('home-C'); }
      expect(out.filter((x) => x.type === 'shot').length).toBe(1); expect(out.some((x) => x.type === 'goal')).toBe(false);
      return;
    }
    throw new Error('no shot beat the goalie');
  });
});
