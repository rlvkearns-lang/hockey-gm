import { DT, type GameState } from '@hockey/engine';

/**
 * Engine cuts (pure: no three.js, no DOM). Between some ticks the engine moves things discontinuously: at every
 * stoppage it puts the puck on the faceoff dot in one tick (the phase becomes `faceoffSetup`), and at each period
 * start it swaps the goalies' ends in one tick (`attackDir` changes). Blending across such a tick would draw the puck
 * or a goalie streaking across the ice, so the viewer treats it as a cut: one side of the tick is drawn for the whole
 * tick, and whatever jumped starts afresh.
 *
 * Besides those two engine rules, anything that moves further between two ticks than it physically can is a cut too
 * (a defence against teleports the rules above do not name).
 */

/** Faster than this (m/s) a puck cannot travel: anything further in a tick is a teleport. */
export const PUCK_MAX_SPEED = 60;
/** Faster than this (m/s) no skater or goalie moves. */
export const BODY_MAX_SPEED = 20;
/** Slack (m) on top of the distance a speed allows, so rounding and contact nudges never read as a cut. */
const SLACK = 0.3;

/**
 * What a cut test needs from one tick, copied so it outlives the state it came from: the phase, home's attack
 * direction and the places of the puck (pts 0..1), the goalies (home 2..3, away 4..5) and every skater (6.., NaN while
 * he is off the ice), in the order of `GameState.skaters`.
 */
export type CutProbe = { tick: number; phase: string; attack: number; pts: number[] };

export function emptyProbe(): CutProbe {
  return { tick: -1, phase: '', attack: 0, pts: [] };
}

/** Copy what the cut test needs from `s` into `into` (allocates only the first time, or if the roster grows). */
export function probeOf(s: Readonly<GameState>, into: CutProbe = emptyProbe()): CutProbe {
  into.tick = s.tick;
  into.phase = s.phase;
  into.attack = s.attackDir.home;
  const p = into.pts;
  p[0] = s.puck.pos.x; p[1] = s.puck.pos.y;
  p[2] = s.goalies.home.pos.x; p[3] = s.goalies.home.pos.y;
  p[4] = s.goalies.away.pos.x; p[5] = s.goalies.away.pos.y;
  for (let i = 0; i < s.skaters.length; i++) {
    const k = s.skaters[i]!;
    p[6 + 2 * i] = k.onIce ? k.pos.x : NaN;
    p[7 + 2 * i] = k.onIce ? k.pos.y : NaN;
  }
  p.length = 6 + 2 * s.skaters.length;
  return into;
}

/** Whether a point moved from (ax, ay) to (bx, by) further than `maxSpeed` allows over `ticks` ticks. */
export function jumped(ax: number, ay: number, bx: number, by: number, ticks: number, maxSpeed: number): boolean {
  if (!Number.isFinite(ax) || !Number.isFinite(bx)) return false;
  return Math.hypot(bx - ax, by - ay) > maxSpeed * Math.max(1, ticks) * DT + SLACK;
}

/**
 * Whether going from the tick `a` was probed at to the later state `b` is a cut: play restarts at a faceoff (the phase
 * becomes `faceoffSetup` from another phase), the teams change ends, or the puck, a goalie or a skater on the ice at
 * both moves further than it can. `a` and `b` may be any number of ticks apart (a frame can skip ticks at speed).
 */
export function isCut(a: CutProbe, b: Readonly<GameState>): boolean {
  if (a.tick < 0 || b.tick <= a.tick) return false;
  if (b.phase === 'faceoffSetup' && a.phase !== 'faceoffSetup') return true;
  if (b.attackDir.home !== a.attack) return true;
  const n = b.tick - a.tick, p = a.pts;
  if (jumped(p[0]!, p[1]!, b.puck.pos.x, b.puck.pos.y, n, PUCK_MAX_SPEED)) return true;
  if (goalieJumped(a, b, 'home') || goalieJumped(a, b, 'away')) return true;
  for (let i = 0; i < b.skaters.length; i++) if (skaterJumped(a, b, i)) return true;
  return false;
}

/** Whether the puck jumped between probe `a` and state `b` (or play restarted at a faceoff, which re-spots it). */
export function puckJumped(a: CutProbe, b: Readonly<GameState>): boolean {
  if (a.tick < 0 || b.tick <= a.tick) return false;
  if (b.phase === 'faceoffSetup' && a.phase !== 'faceoffSetup') return true;
  return jumped(a.pts[0]!, a.pts[1]!, b.puck.pos.x, b.puck.pos.y, b.tick - a.tick, PUCK_MAX_SPEED);
}

/** Whether a goalie jumped between probe `a` and state `b` (the teams changing ends moves both). */
export function goalieJumped(a: CutProbe, b: Readonly<GameState>, side: 'home' | 'away'): boolean {
  if (a.tick < 0 || b.tick <= a.tick) return false;
  if (b.attackDir.home !== a.attack) return true;
  const o = side === 'home' ? 2 : 4, g = b.goalies[side];
  return jumped(a.pts[o]!, a.pts[o + 1]!, g.pos.x, g.pos.y, b.tick - a.tick, BODY_MAX_SPEED);
}

/** Whether skater `i` (index into GameState.skaters), on the ice at both, jumped between probe `a` and state `b`. */
export function skaterJumped(a: CutProbe, b: Readonly<GameState>, i: number): boolean {
  if (a.tick < 0 || b.tick <= a.tick) return false;
  const k = b.skaters[i];
  if (!k || !k.onIce) return false;
  return jumped(a.pts[6 + 2 * i] ?? NaN, a.pts[7 + 2 * i] ?? NaN, k.pos.x, k.pos.y, b.tick - a.tick, BODY_MAX_SPEED);
}

/** The latest cut tick at or before `tick` in sorted `cuts` (a cut tick is the first tick after the jump), or -1. */
export function lastCutAtOrBefore(cuts: readonly number[], tick: number): number {
  let lo = 0, hi = cuts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cuts[m]! <= tick) lo = m + 1; else hi = m; }
  return lo > 0 ? cuts[lo - 1]! : -1;
}
