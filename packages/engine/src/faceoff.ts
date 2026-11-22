import { resolveBoards } from './rink';
import type { Rng } from './rng';
import type { GameEvent, GameState, PlayerDef, Position, Side, SkaterState } from './types';
import { hypot2, type Vec2 } from './vec';

/** The puck drops once every on-ice skater is this close to his line-up spot (m)... */
export const LINEUP_TOLERANCE = 0.6;
/** ...but never before this many seconds of setup... */
export const FACEOFF_MIN_SECONDS = 3;
/** ...and at the latest after this many, with players wherever they are. */
export const FACEOFF_MAX_SECONDS = 8;
/** Stand-in chance that home wins the draw (Task 8 uses the centres' faceoffs, Task 10 winProb). */
const HOME_WIN_CHANCE = 0.5;
/** Speed range (m/s) of the puck pulled back to a defenceman. */
const DRAW_BACK_SPEED: [number, number] = [6, 8];

/** Line-up spot behind the dot along the side's attack direction; "left" is +y when attacking +x. */
const LINEUP: Record<Exclude<Position, 'G'>, { back: number; left: number }> = {
  C: { back: 0.9, left: 0 },
  LW: { back: 1.2, left: 4.5 },
  RW: { back: 1.2, left: -4.5 },
  LD: { back: 8, left: 3 },
  RD: { back: 8, left: -3 },
};

export function faceoffPosition(spot: Vec2, slot: Position | null, dir: 1 | -1): Vec2 {
  const l = LINEUP[slot === null || slot === 'G' ? 'C' : slot];
  const pos = { x: spot.x - dir * l.back, y: spot.y + dir * l.left };
  resolveBoards(pos, { x: 0, y: 0 }, 0.5, 0);
  return pos;
}

/** Enter faceoffSetup at `spot`: puck on the dot, nobody in possession, every on-ice skater heads for his line-up spot. */
export function setupFaceoff(state: GameState, spot: Vec2): void {
  state.phase = 'faceoffSetup';
  state.phaseT = 0;
  state.faceoffSpot = { x: spot.x, y: spot.y };
  state.puck = { pos: { x: spot.x, y: spot.y }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  state.carrierId = null;
  state.possession = null;
  headForLineup(state);
}

/** Every on-ice skater skates toward his line-up spot for the draw at state.faceoffSpot. */
export function headForLineup(state: GameState): void {
  const spot = state.faceoffSpot;
  for (const s of state.skaters) {
    if (!s.onIce) continue;
    s.target = faceoffPosition(spot, s.slot, state.attackDir[s.side]);
    s.faceTarget = null;
    s.speedCap = 0.8;
  }
}

/** True when every on-ice skater is within LINEUP_TOLERANCE of his line-up spot. */
export function linedUp(state: GameState): boolean {
  for (const s of state.skaters) {
    if (!s.onIce) continue;
    const p = faceoffPosition(state.faceoffSpot, s.slot, state.attackDir[s.side]);
    if (hypot2(s.pos.x - p.x, s.pos.y - p.y) > LINEUP_TOLERANCE) return false;
  }
  return true;
}

/** Put every on-ice skater exactly on his line-up spot, still, facing the attack direction. Only for the opening line-up. */
export function snapToLineup(state: GameState): void {
  for (const s of state.skaters) {
    if (!s.onIce) continue;
    const dir = state.attackDir[s.side];
    s.pos = faceoffPosition(state.faceoffSpot, s.slot, dir);
    s.target = { x: s.pos.x, y: s.pos.y };
    s.vel = { x: 0, y: 0 };
    s.facing = dir === 1 ? 0 : Math.PI;
  }
}

const onIceIn = (state: GameState, side: Side, slots: Position[]): SkaterState[] =>
  state.skaters.filter((s) => s.onIce && s.side === side && s.slot !== null && slots.includes(s.slot));

/**
 * Drop the puck: one side wins the draw and the puck slides back toward one of its defencemen.
 * Sets phase live. Returns the faceoff event (side = winner, playerId = winning centre, otherId = losing centre).
 */
export function dropPuck(state: GameState, _defs: Map<string, PlayerDef>, rng: Rng): GameEvent {
  const winner: Side = rng.chance(HOME_WIN_CHANCE) ? 'home' : 'away';
  const loser: Side = winner === 'home' ? 'away' : 'home';
  const winC = onIceIn(state, winner, ['C'])[0] ?? null;
  const loseC = onIceIn(state, loser, ['C'])[0] ?? null;
  const ds = onIceIn(state, winner, ['LD', 'RD']);
  const spot = state.faceoffSpot;
  const to = ds.length > 0 ? rng.pick(ds).pos : { x: spot.x - state.attackDir[winner] * 8, y: spot.y };
  const dx = to.x - spot.x, dy = to.y - spot.y;
  const d = hypot2(dx, dy) || 1;
  const speed = rng.range(DRAW_BACK_SPEED[0], DRAW_BACK_SPEED[1]);
  state.puck = { pos: { x: spot.x, y: spot.y }, z: 0, vel: { x: (dx / d) * speed, y: (dy / d) * speed }, vz: 0 };
  state.carrierId = null;
  state.possession = winner;
  state.lastTouch = winC ? { id: winC.id, side: winner } : null;
  state.phase = 'live';
  state.phaseT = 0;
  return {
    tick: state.tick, period: state.period, clock: state.clock, type: 'faceoff', side: winner,
    playerId: winC?.id ?? null, otherId: loseC?.id ?? null, assistIds: [],
    detail: `${spot.x},${spot.y}`,
  };
}
