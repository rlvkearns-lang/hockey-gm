import { hasBadge } from './badges';
import { recordTouch } from './actions';
import { clearContests, effective, winProb } from './contests/core';
import { gameEvent } from './events';
import { holdJob, setFace, setTeamPhase, speedFor } from './commit';
import { datan2, dcos, dsin } from './dmath';
import { resolveBoards } from './rink';
import type { Rng } from './rng';
import { wrapAngle } from './skating';
import { TUNING } from './tuning';
import type { GameEventOf, GameState, PlayerDef, Position, Side, SkaterState } from './types';
import { SIDES } from './util';
import { hypot2, type Vec2 } from './vec';

/** The puck drops once every on-ice skater is this close to his line-up spot (m)... */
export const LINEUP_TOLERANCE = 0.6;
/** ...slower than this (m/s)... */
export const LINEUP_SPEED = 0.5;
/**
 * ...and within this (rad) of his faceoffFacing (the brief's 0.35 let the puck drop with a man 20 degrees off up ice
 * while still turning; squared up at his spot he turns this last bit in a tick or two), a centre within
 * CENTRE_TOLERANCE (m) of his spot (0.2 m to the side of it at 0.6 m back he faces the dot 18 degrees off square)...
 */
export const LINEUP_FACING = 0.15;
export const CENTRE_TOLERANCE = 0.05;
/** ...but never before this many seconds of setup. */
export const FACEOFF_MIN_SECONDS = 3;
/**
 * A safety net only: a setup lasts as long as the players take to get to their spots (a change under way finishes by
 * itself first), and the linesman drops the puck at this point only if someone cannot get there (the tests show it is
 * never reached).
 */
export const FACEOFF_MAX_SECONDS = 25;
/** Faceoffs rating used for a side with no centre on the ice. */
const NO_CENTRE_RATING = 50;
/** Speed range (m/s) of the puck pulled back to a defenceman. */
const DRAW_BACK_SPEED: [number, number] = [6, 8];
/** He turns to his line-up facing within FACE_WITHIN (m) of his spot, toward a point FACE_AHEAD (m) along it; he sprints from beyond SPRINT_FROM (m). */
const FACE_WITHIN = TUNING.faceoff.lineup.faceWithin;
const FACE_AHEAD = TUNING.faceoff.lineup.faceAhead;
const SPRINT_FROM = TUNING.faceoff.lineup.sprintFrom;

/**
 * Line-up spots, metres behind the dot toward his own end (`back`) and to his left (`left`): the centre over the dot,
 * the wingers on the circle, the defencemen behind. Everyone is on his own side of the dot.
 */
const LINEUP: Record<Exclude<Position, 'G'>, { back: number; left: number }> = {
  C: { back: 0.6, left: 0 },
  LW: { back: 0.9, left: 4.6 },
  RW: { back: 0.9, left: -4.6 },
  LD: { back: 5, left: 2.5 },
  RD: { back: 5, left: -2.5 },
};

/** His line-up spot for the draw at `spot` (attacking toward `dir`; "left" is +y when attacking +x), inside the boards. */
export function faceoffPosition(spot: Vec2, slot: Position | null, dir: 1 | -1): Vec2 {
  const l = LINEUP[slot === null || slot === 'G' ? 'C' : slot];
  const pos = { x: spot.x - dir * l.back, y: spot.y + dir * l.left };
  resolveBoards(pos, { x: 0, y: 0 }, 0.5, 0);
  return pos;
}

/** The way he faces at the draw (rad): a centre (or a man with no slot) at the dot from `pos`, everyone else straight up ice. */
export function faceoffFacing(spot: Vec2, slot: Position | null, dir: 1 | -1, pos: Vec2): number {
  if (slot === 'C' || slot === null || slot === 'G') {
    const dx = spot.x - pos.x, dy = spot.y - pos.y;
    if (dx * dx + dy * dy > 1e-12) return datan2(dy, dx);
  }
  return dir === 1 ? 0 : Math.PI;
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
 * cleared, every contest over (its players free) and every net-front tie-up, engagement and rebound edge gone, and every on-ice
 * skater heads for his line-up spot for the faceoff at `spot` (his plan: job `lineUp`, reason `whistle`).
 */
export function stopPlay(state: GameState, spot: Vec2): void {
  state.phase = 'stopped';
  state.phaseT = 0;
  state.carrierId = null;
  state.carrierPlan = null;
  state.possession = null;
  state.pickupBlock = null;
  state.pendingPass = null;
  state.oneTimerTaken = null;
  state.shotInFlight = null;
  state.touches = { side: null, ids: [], ticks: [] };
  state.lastAttackTouch = { home: null, away: null };
  state.delayedOffside = null;
  state.icingWatch = null;
  state.hardClear = null;
  state.lastRelease = null;
  state.tiedUpUntil = [];
  state.staggered = [];
  state.engagements = []; // a new list: game.ts step emits `whistle` for the old one's
  state.reboundEdge = null;
  state.lastSave = null;
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
  state.carrierPlan = null;
  state.possession = null;
  state.pendingPass = null;
  state.oneTimerTaken = null;
  state.shotInFlight = null;
  state.touches = { side: null, ids: [], ticks: [] };
  state.lastAttackTouch = { home: null, away: null };
  state.delayedOffside = null;
  state.icingWatch = null;
  state.hardClear = null;
  headForLineup(state);
}

/** Every on-ice skater (but those leaving for the bench) skates toward his line-up spot for the draw at state.faceoffSpot. */
export function headForLineup(state: GameState): void {
  const sk = state.skaters;
  for (let i = 0; i < sk.length; i++) {
    const s = sk[i]!;
    if (!s.onIce || s.leaving) continue;
    holdJob(state, i, 'lineUp', 'whistle', 'stop');
    lineUp(state, i);
  }
}

/**
 * While play is stopped, every tick before the skaters move: each on-ice skater with job `lineUp` (not leaving) skates
 * for his spot (effort skate, sprint from beyond 20 m; ready to stop) and, within 1.5 m of it, turns to his
 * faceoffFacing (a point 10 m along it from his spot).
 */
export function lineupTick(state: GameState): void {
  const sk = state.skaters, plans = state.plans;
  for (let i = 0; i < sk.length; i++) {
    const s = sk[i]!;
    if (!s.onIce || s.leaving || plans[i]!.job !== 'lineUp') continue;
    lineUp(state, i);
  }
}

function lineUp(state: GameState, i: number): void {
  const s = state.skaters[i]!, plan = state.plans[i]!;
  const spot = state.faceoffSpot, dir = state.attackDir[s.side];
  const p = faceoffPosition(spot, s.slot, dir);
  s.target.x = p.x;
  s.target.y = p.y;
  const d = hypot2(p.x - s.pos.x, p.y - s.pos.y);
  plan.effort = d > SPRINT_FROM ? 'sprint' : 'skate';
  plan.slow = 'stop';
  plan.through = false;
  s.speedCap = speedFor(plan.effort, 'lineUp', s.energy);
  if (d > FACE_WITHIN) { s.faceTarget = null; return; }
  const f = faceoffFacing(spot, s.slot, dir, s.pos);
  setFace(s, { x: p.x + FACE_AHEAD * dcos(f), y: p.y + FACE_AHEAD * dsin(f) });
}

/**
 * True when no line change is under way and every on-ice skater is within LINEUP_TOLERANCE of his line-up spot (a
 * centre within CENTRE_TOLERANCE), slower than LINEUP_SPEED and within LINEUP_FACING of his faceoffFacing.
 */
export function linedUp(state: GameState): boolean {
  for (const side of SIDES) if (state.bench[side].forwards.changing || state.bench[side].defence.changing) return false;
  const spot = state.faceoffSpot;
  for (const s of state.skaters) {
    if (!s.onIce) continue;
    if (s.leaving) return false;
    const dir = state.attackDir[s.side];
    const p = faceoffPosition(spot, s.slot, dir);
    if (hypot2(s.pos.x - p.x, s.pos.y - p.y) > (s.slot === 'C' ? CENTRE_TOLERANCE : LINEUP_TOLERANCE)) return false;
    if (hypot2(s.vel.x, s.vel.y) >= LINEUP_SPEED) return false;
    if (Math.abs(wrapAngle(s.facing - faceoffFacing(spot, s.slot, dir, s.pos))) > LINEUP_FACING) return false;
  }
  return true;
}

/** Put every on-ice skater exactly on his line-up spot, still, facing his line-up facing. Only for the opening line-up. */
export function snapToLineup(state: GameState): void {
  for (const s of state.skaters) {
    if (!s.onIce) continue;
    const dir = state.attackDir[s.side];
    s.pos = faceoffPosition(state.faceoffSpot, s.slot, dir);
    s.target = { x: s.pos.x, y: s.pos.y };
    s.vel = { x: 0, y: 0 };
    s.facing = faceoffFacing(state.faceoffSpot, s.slot, dir, s.pos);
  }
}

const onIceIn = (state: GameState, side: Side, slots: Position[]): SkaterState[] =>
  state.skaters.filter((s) => s.onIce && s.side === side && s.slot !== null && slots.includes(s.slot));

const FACEOFFS = { faceoffs: 1 };

/**
 * Chance that home wins the draw: winProb of the difference between the centres' effective faceoffs ratings, scaled by
 * TUNING.faceoff.edgeScale. The team's jump on the night is left out, and the edge is scaled down, because a draw is
 * taken dozens of times a game between the same few centres: at full size one centre's edge swung whole games' faceoff
 * shares too far.
 */
export function drawChance(state: GameState, defs: Map<string, PlayerDef>): number {
  const rating = (side: Side): number => {
    const c = onIceIn(state, side, ['C'])[0];
    const d = c ? defs.get(c.id) : undefined;
    // (Task 12: a Faceoff Specialist's rating is TUNING.badges.faceoffRating higher.)
    return c && d ? effective(d, c, FACEOFFS) + (hasBadge(d, 'Faceoff Specialist') ? TUNING.badges.faceoffRating : 0) : NO_CENTRE_RATING;
  };
  return winProb((rating('home') - rating('away')) * TUNING.faceoff.edgeScale);
}

/**
 * Drop the puck: one side wins the draw (home with winProb of the difference between the centres' effective faceoffs
 * ratings) and the puck slides back toward one of its defencemen; the winner has possession. Sets phase live and lifts
 * any `noChange`. Returns the faceoff event (side = winner, playerId = winning centre, otherId = losing centre).
 */
export function dropPuck(state: GameState, defs: Map<string, PlayerDef>, rng: Rng): GameEventOf<'faceoff'> {
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
  setTeamPhase(state);
  return gameEvent(state, {
    type: 'faceoff', side: winner, playerId: winC?.id ?? null, otherId: loseC?.id ?? null, pos: spot, detail: { spot: { x: spot.x, y: spot.y } },
  });
}
