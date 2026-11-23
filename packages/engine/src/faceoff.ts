import { recordTouch } from './actions';
import { clearContests, effective, winProb } from './contests/core';
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
/** Faceoffs rating used for a side with no centre on the ice. */
const NO_CENTRE_RATING = 50;
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

/** Puck still and flat on the ice (every stoppage). */
export function restPuck(state: GameState): void {
  const p = state.puck;
  p.vel.x = 0;
  p.vel.y = 0;
  p.z = 0;
  p.vz = 0;
}

/**
 * Whistle: phase `stopped`, puck at rest where it is, nobody in possession, no pass or shot pending, the touch chain
 * cleared, every contest over (its players free) and every net-front tie-up and rebound edge gone, and every on-ice skater heads for his line-up spot for the faceoff
 * at `spot`.
 */
export function stopPlay(state: GameState, spot: Vec2): void {
  state.phase = 'stopped';
  state.phaseT = 0;
  state.carrierId = null;
  state.possession = null;
  state.pickupBlock = null;
  state.pendingPass = null;
  state.shotInFlight = null;
  state.touches = { side: null, ids: [] };
  state.lastAttackTouch = { home: null, away: null };
  state.delayedOffside = null;
  state.icingWatch = null;
  state.lastRelease = null;
  state.tiedUpUntil = [];
  state.reboundEdge = null;
  clearContests(state);
  restPuck(state);
  state.faceoffSpot = { x: spot.x, y: spot.y };
  headForLineup(state);
}

/** Enter faceoffSetup at `spot`: puck on the dot, nobody in possession, every on-ice skater heads for his line-up spot. */
export function setupFaceoff(state: GameState, spot: Vec2): void {
  state.phase = 'faceoffSetup';
  state.phaseT = 0;
  state.faceoffSpot = { x: spot.x, y: spot.y };
  state.puck = { pos: { x: spot.x, y: spot.y }, z: 0, vel: { x: 0, y: 0 }, vz: 0 };
  state.carrierId = null;
  state.possession = null;
  state.pendingPass = null;
  state.shotInFlight = null;
  state.touches = { side: null, ids: [] };
  state.lastAttackTouch = { home: null, away: null };
  state.delayedOffside = null;
  state.icingWatch = null;
  headForLineup(state);
}

/** Every on-ice skater (but those leaving for the bench) skates toward his line-up spot for the draw at state.faceoffSpot. */
export function headForLineup(state: GameState): void {
  const spot = state.faceoffSpot;
  for (const s of state.skaters) {
    if (!s.onIce || s.leaving) continue;
    s.target = faceoffPosition(spot, s.slot, state.attackDir[s.side]);
    s.faceTarget = null;
    s.speedCap = 0.8;
  }
}

/** True when no line change is under way and every on-ice skater is within LINEUP_TOLERANCE of his line-up spot. */
export function linedUp(state: GameState): boolean {
  for (const s of state.skaters) {
    if (!s.onIce) continue;
    if (s.leaving) return false;
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

/** Chance that home wins the draw: winProb of the difference between the centres' effective faceoffs ratings. */
export function drawChance(state: GameState, defs: Map<string, PlayerDef>): number {
  const rating = (side: Side): number => {
    const c = onIceIn(state, side, ['C'])[0];
    const d = c ? defs.get(c.id) : undefined;
    return c && d ? effective(d, c, { faceoffs: 1 }) : NO_CENTRE_RATING;
  };
  return winProb(rating('home') - rating('away'));
}

/**
 * Drop the puck: one side wins the draw (home with winProb of the difference between the centres' effective faceoffs
 * ratings) and the puck slides back toward one of its defencemen; the winner has possession. Sets phase live and lifts
 * any `noChange`. Returns the faceoff event (side = winner, playerId = winning centre, otherId = losing centre).
 */
export function dropPuck(state: GameState, defs: Map<string, PlayerDef>, rng: Rng): GameEvent {
  const winner: Side = rng.chance(drawChance(state, defs)) ? 'home' : 'away';
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
  if (winC) recordTouch(state, winC.id, winner);
  state.noChange = null;
  state.phase = 'live';
  state.phaseT = 0;
  return {
    tick: state.tick, period: state.period, clock: state.clock, type: 'faceoff', side: winner,
    playerId: winC?.id ?? null, otherId: loseC?.id ?? null, assistIds: [],
    detail: `${spot.x},${spot.y}`,
  };
}
