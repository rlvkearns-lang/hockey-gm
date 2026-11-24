/**
 * Passing-lane geometry shared by jobs, options and passing: how much clear ice there is round a lane, whether a lane
 * is open, whether a skater has a clear path to the net, and which teammate is the carrier's most dangerous option.
 * "Standing opponents" are the other side's on-ice skaters who are not down (goalies are not counted).
 */
import { dexp } from './dmath';
import { RINK } from './rink';
import { TUNING } from './tuning';
import type { GameState, Side, SkaterState } from './types';
import type { Vec2 } from './vec';

// Local copies of vec.ts helpers (hot loops: a call across modules costs more under the test runner's module wrapper).
const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);
const distV = (a: Vec2, b: Vec2): number => hyp(a.x - b.x, a.y - b.y);
function segD(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return hyp(px - (ax + abx * t), py - (ay + aby * t));
}


const L = TUNING.lanes;

/** Metres of clear ice round the segment from `from` to `to`: the smallest distance from any on-ice, standing opponent of `side` to it. */
export function laneWidth(state: GameState, side: Side, from: Vec2, to: Vec2): number {
  let best = Infinity;
  for (const o of state.skaters) {
    if (!o.onIce || o.side === side || o.downT > 0) continue;
    const d = segD(o.pos.x, o.pos.y, from.x, from.y, to.x, to.y);
    if (d < best) best = d;
  }
  return best;
}

/** Distance (m) from `p` to the nearest on-ice, standing opponent of `side`; Infinity if none. */
export function spaceAt(state: GameState, side: Side, p: Vec2): number {
  let best = Infinity;
  for (const o of state.skaters) {
    if (!o.onIce || o.side === side || o.downT > 0) continue;
    const d = hyp(o.pos.x - p.x, o.pos.y - p.y);
    if (d < best) best = d;
  }
  return best;
}

/** A lane is open at TUNING.lanes.open (1.0 m) or more, with no opponent within TUNING.lanes.space (1.5 m) of `to`. */
export function laneOpen(state: GameState, side: Side, from: Vec2, to: Vec2): boolean {
  return laneWidth(state, side, from, to) >= L.open && spaceAt(state, side, to) >= L.space;
}

/** No standing opponent ahead of `s` within TUNING.lanes.clearPath (2.5 m) of his line to the centre of the net he attacks. */
export function clearPathToNet(state: GameState, s: SkaterState): boolean {
  const dir = state.attackDir[s.side];
  const nx = dir * RINK.goalLineX;
  const me = s.pos.x * dir;
  for (const o of state.skaters) {
    if (!o.onIce || o.side === s.side || o.downT > 0 || o.pos.x * dir <= me) continue;
    if (segD(o.pos.x, o.pos.y, s.pos.x, s.pos.y, nx, 0) < L.clearPath) return false;
  }
  return true;
}

/** Scale (m) of dangerMan's distance fall-off. */
const DANGER_SCALE = 9;

/** The carrier's most dangerous teammate: the one with the highest dexp(-d / 9) * dx / d (d to the net centre, dx its rx part); null with no teammate in the zone. */
export function dangerMan(state: GameState, carrier: SkaterState): SkaterState | null {
  const dir = state.attackDir[carrier.side];
  let best: SkaterState | null = null, bestV = -Infinity;
  for (const m of state.skaters) {
    if (!m.onIce || m.side !== carrier.side || m === carrier) continue;
    const rx = m.pos.x * dir;
    if (rx <= RINK.blueLineX) continue;
    const dx = RINK.goalLineX - rx;
    const d = hyp(dx, m.pos.y) || 1e-9;
    const v = dexp(-d / DANGER_SCALE) * dx / d;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
