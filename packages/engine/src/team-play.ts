import { composite } from './attributes';
import { DT } from './constants';
import { RINK, resolveBoards, resolveNets, zoneOf } from './rink';
import type { GameState, PlayerDef, Position, Side, SkaterState, Tactics } from './types';
import { dist, hypot2, type Vec2 } from './vec';

export type TeamPhase = 'breakout' | 'rush' | 'ozone' | 'forecheck' | 'neutralDefence' | 'dzone' | 'looseChase';

/** Named offensive-zone spots: the three the forwards cycle through, and the two points the defencemen hold. */
export type OzoneSpot = 'corner' | 'netFront' | 'highSlot' | 'leftPoint' | 'rightPoint';
export const OZONE_SPOTS: readonly OzoneSpot[] = ['corner', 'netFront', 'highSlot', 'leftPoint', 'rightPoint'];

const BLUE = RINK.blueLineX;
/** Attackers without the puck wait this far (m) outside the offensive blue line until the puck is in. */
const ONSIDE_MARGIN = 1;
/** Braking (m/s^2) assumed when easing toward the blue line; below every skater's real deceleration. */
const ONSIDE_BRAKE = 6;
/** Typical top speed (m/s), to turn a safe approach speed into a speedCap fraction. */
const TYPICAL_TOP_SPEED = 9;
/** Each cycle spot is held this long before the forwards rotate. */
const CYCLE_TICKS = Math.round(5 / DT);
const CYCLE: readonly OzoneSpot[] = ['corner', 'netFront', 'highSlot'];
/** Order in which the forwards take the cycle spots at rotation 0. */
const CYCLE_INDEX: Partial<Record<Position, number>> = { LW: 0, C: 1, RW: 2 };
/** Lane of each slot: +1 left, -1 right (left is +y when attacking +x), 0 middle. */
const LANE: Record<Position, number> = { LW: 1, LD: 1, C: 0, RW: -1, RD: -1, G: 0 };
/** The nearest defender plays this far (m) goal-side of the carrier. */
const PRESS_GAP = 1.2;
/** A chaser leads a moving puck by at most this many seconds. */
const MAX_LEAD_SECONDS = 1.2;
/** Speed (m/s) used to estimate how long a chaser needs to reach the puck. */
const CHASE_SPEED = 8;
/** Targets stay this far (m) inside the boards and clear of the net frames. */
const TARGET_BOARDS_MARGIN = 1;
const TARGET_NET_MARGIN = 0.6;
const FORECHECK_PRESS_CAP: Record<Tactics['forecheck'], number> = { passive: 0.7, balanced: 0.85, aggressive: 1 };

/** Phase of `side` when `carrierSide` has (or last had) the puck at puckX. */
type ShapePhase = Exclude<TeamPhase, 'looseChase'>;

function phaseOf(carrierSide: Side | null, puckX: number, side: Side, dir: 1 | -1): ShapePhase {
  const zone = zoneOf(puckX, dir);
  if (carrierSide === side) return zone === 'D' ? 'breakout' : zone === 'N' ? 'rush' : 'ozone';
  return zone === 'O' ? 'forecheck' : zone === 'N' ? 'neutralDefence' : 'dzone';
}

function carrierOf(state: GameState): SkaterState | null {
  if (state.carrierId === null) return null;
  for (const s of state.skaters) if (s.id === state.carrierId) return s;
  return null;
}

export function phaseFor(state: GameState, side: Side): TeamPhase {
  const carrier = carrierOf(state);
  if (!carrier) return 'looseChase';
  return phaseOf(carrier.side, state.puck.pos.x, side, state.attackDir[side]);
}

/** Distance (m) from `s` to the nearest on-ice opponent who is not down; Infinity if none. */
export function nearestOpponentDist(state: GameState, s: SkaterState): number {
  let best = Infinity;
  for (const o of state.skaters) {
    if (!o.onIce || o.side === s.side || o.downT > 0) continue;
    const d = dist(o.pos, s.pos);
    if (d < best) best = d;
  }
  return best;
}

const puckSide = (state: GameState, dir: 1 | -1): 1 | -1 => (state.puck.pos.y * dir >= 0 ? 1 : -1);

/** Where `spot` is for `side` right now (it shifts with the puck's side of the ice). Writes and returns `out`. */
export function ozoneSpotPos(state: GameState, side: Side, spot: OzoneSpot, out: Vec2): Vec2 {
  const dir = state.attackDir[side];
  const ps = puckSide(state, dir);
  let rx: number, ly: number;
  switch (spot) {
    case 'corner': rx = 24.5; ly = ps * 8.5; break;
    case 'netFront': rx = 24.3; ly = -ps * 0.6; break;
    case 'highSlot': rx = 17; ly = -ps * 2.5; break;
    case 'leftPoint': rx = BLUE + 1.5; ly = 8.5; break;
    case 'rightPoint': rx = BLUE + 1.5; ly = -8.5; break;
  }
  out.x = rx * dir;
  out.y = ly * dir;
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function setRel(s: SkaterState, rx: number, ly: number, dir: 1 | -1): void {
  s.target.x = rx * dir;
  s.target.y = ly * dir;
}

/** Face the puck (kept as the skater's own object, updated in place). */
function facePuck(s: SkaterState, puck: Vec2): void {
  if (s.faceTarget) { s.faceTarget.x = puck.x; s.faceTarget.y = puck.y; } else s.faceTarget = { x: puck.x, y: puck.y };
}

/** Off-puck positioning for `phase`, in attack-relative coordinates. */
function shape(state: GameState, s: SkaterState, d: PlayerDef, phase: ShapePhase, tactic: Tactics, dir: 1 | -1): void {
  const puck = state.puck.pos;
  const pr = puck.x * dir, pl = puck.y * dir;
  const ps = pl >= 0 ? 1 : -1;
  const slot = s.slot ?? 'C';
  const lane = LANE[slot];
  const isD = slot === 'LD' || slot === 'RD';
  const isC = slot === 'C' || slot === 'G';
  switch (phase) {
    case 'breakout':
      if (isD) setRel(s, lane === ps ? clamp(pr - 3, -25, -12) : clamp(pr - 1, -22, -10), lane === ps ? ps * 7 : -ps * 3, dir);
      else if (isC) setRel(s, clamp(pr + 4, -20, -6), -ps * 2, dir);
      else setRel(s, clamp(pr + 8, -16, -5), lane * 10.5, dir);
      s.faceTarget = null;
      s.speedCap = 0.9;
      return;
    case 'rush':
      if (isD) setRel(s, pr - (13 - 6 * d.tendencies.joinRush), lane * 5, dir);
      else if (isC) setRel(s, pr - 2, -ps * 3, dir);
      else setRel(s, pr + 4, lane * 8, dir);
      s.faceTarget = null;
      s.speedCap = isD ? 0.9 : 1;
      return;
    case 'ozone': {
      if (isD) ozoneSpotPos(state, s.side, lane > 0 ? 'leftPoint' : 'rightPoint', s.target);
      else {
        const rot = Math.floor(state.tick / CYCLE_TICKS);
        ozoneSpotPos(state, s.side, CYCLE[((CYCLE_INDEX[slot] ?? 1) + rot) % CYCLE.length]!, s.target);
      }
      facePuck(s, puck);
      s.speedCap = 0.8;
      return;
    }
    case 'forecheck': {
      const f = tactic.forecheck;
      const keen = (d.tendencies.forecheck - 0.5) * 4;
      if (isD) setRel(s, f === 'aggressive' ? BLUE + 1.5 : f === 'balanced' ? BLUE + 0.5 : -3, lane * (f === 'passive' ? 4 : 7), dir);
      else if (isC) {
        if (f === 'aggressive') setRel(s, Math.min(pr, 23) + keen, ps * 7, dir);
        else if (f === 'balanced') setRel(s, BLUE + 7 + keen, -ps * 2, dir);
        else setRel(s, BLUE - 3 + keen, 0, dir);
      } else setRel(s, (f === 'aggressive' ? BLUE + 4 : f === 'balanced' ? BLUE + 2 : 2) + keen, lane * 7, dir);
      facePuck(s, puck);
      s.speedCap = 0.85;
      return;
    }
    case 'neutralDefence': {
      if (isD) {
        const reads = composite(d.attrs, { defensivePositioning: 0.7, iq: 0.3 });
        const approach = Math.max(0, -state.puck.vel.x * dir);
        const gap = 6 + (100 - reads) * 0.05 + approach * 0.6;
        setRel(s, Math.max(-24, pr - gap), lane * 4 + pl * 0.3, dir);
      } else if (isC) setRel(s, Math.max(-22, pr - 5), pl * 0.5, dir);
      else setRel(s, Math.max(-22, pr - 3), lane * 7, dir);
      facePuck(s, puck);
      s.speedCap = 1;
      return;
    }
    case 'dzone':
      if (isD) setRel(s, lane === ps ? -23.5 : -24.3, lane === ps ? ps * 5 : -ps * 0.8, dir);
      else if (isC) setRel(s, -20, ps * 1.5, dir);
      else setRel(s, -11, lane * 8, dir);
      facePuck(s, puck);
      s.speedCap = 0.9;
      return;
  }
}

/** Goal-side pressure on the carrier by the nearest defender. */
function press(state: GameState, s: SkaterState, d: PlayerDef, carrier: SkaterState, phase: TeamPhase, tactic: Tactics): void {
  const dir = state.attackDir[s.side];
  const netX = -dir * RINK.goalLineX;
  const dx = netX - carrier.pos.x, dy = -carrier.pos.y;
  const l = hypot2(dx, dy) || 1;
  s.target.x = carrier.pos.x + (dx / l) * PRESS_GAP;
  s.target.y = carrier.pos.y + (dy / l) * PRESS_GAP;
  facePuck(s, state.puck.pos);
  s.speedCap = phase === 'forecheck' ? Math.min(1, FORECHECK_PRESS_CAP[tactic.forecheck] * (0.85 + 0.3 * d.tendencies.forecheck)) : 1;
}

/** Skate to where a loose puck will be, leading it by the time it takes to get there. */
function chase(state: GameState, s: SkaterState): void {
  const p = state.puck;
  const t = Math.min(MAX_LEAD_SECONDS, dist(s.pos, p.pos) / CHASE_SPEED);
  s.target.x = p.pos.x + p.vel.x * t;
  s.target.y = p.pos.y + p.vel.y * t;
  s.faceTarget = null;
  s.speedCap = 1;
}

const scratchVel: Vec2 = { x: 0, y: 0 };

/**
 * Keep the target onside (an attacker without the puck never goes into the offensive zone ahead of it, and eases up
 * so he does not coast over the line; a chaser may follow the puck itself up to the line), inside the boards and clear
 * of the net frames.
 */
function keepLegal(state: GameState, s: SkaterState, dir: 1 | -1, chasing: boolean): void {
  const pr = state.puck.pos.x * dir;
  if (pr < BLUE) {
    const limit = chasing ? Math.max(BLUE - ONSIDE_MARGIN, Math.min(pr, BLUE)) : BLUE - ONSIDE_MARGIN;
    if (s.target.x * dir > limit) {
      s.target.x = limit * dir;
      const room = limit - s.pos.x * dir;
      if (room > 0) s.speedCap = Math.min(s.speedCap, Math.max(0.15, Math.sqrt(2 * ONSIDE_BRAKE * room) / TYPICAL_TOP_SPEED));
    }
  }
  scratchVel.x = 0;
  scratchVel.y = 0;
  resolveBoards(s.target, scratchVel, TARGET_BOARDS_MARGIN, 0);
  resolveNets(s.target, scratchVel, TARGET_NET_MARGIN);
}

/**
 * Sets every on-ice skater's target, faceTarget and speedCap from his team's phase. The carrier's target and
 * speedCap belong to the brain (brainTick); here he only stops facing anything but his own way. Skaters in a
 * contest are left alone. With the puck carried, the nearest defender pressures the carrier; with it loose, the
 * nearest skater of each side chases it (a pass's intended receiver chases for his side) and the rest keep the shape
 * of the side that last had the puck.
 */
export function assignJobs(state: GameState, defs: Map<string, PlayerDef>, tactics: Record<Side, Tactics>): void {
  const puck = state.puck.pos;
  const carrier = carrierOf(state);
  const shapeSide: Side | null = carrier ? carrier.side : state.possession;
  let presser: SkaterState | null = null, pressD = Infinity;
  let homeChaser: SkaterState | null = null, homeD = Infinity;
  let awayChaser: SkaterState | null = null, awayD = Infinity;
  for (const s of state.skaters) {
    if (!s.onIce || s.downT > 0 || s.contestId !== null || s === carrier) continue;
    if (carrier) {
      if (s.side === carrier.side) continue;
      const d = dist(s.pos, carrier.pos);
      if (d < pressD) { pressD = d; presser = s; }
    } else {
      const d = dist(s.pos, puck);
      if (s.side === 'home') { if (d < homeD) { homeD = d; homeChaser = s; } }
      else if (d < awayD) { awayD = d; awayChaser = s; }
    }
  }
  const pass = carrier ? null : state.pendingPass;
  if (pass) {
    for (const s of state.skaters) {
      if (s.id !== pass.toId) continue;
      if (s.onIce && s.downT === 0 && s.contestId === null) { if (s.side === 'home') homeChaser = s; else awayChaser = s; }
      break;
    }
  }
  const homePhase = phaseOf(shapeSide, puck.x, 'home', state.attackDir.home);
  const awayPhase = phaseOf(shapeSide, puck.x, 'away', state.attackDir.away);

  for (const s of state.skaters) {
    if (!s.onIce || s.contestId !== null) continue;
    if (s === carrier) { s.faceTarget = null; continue; }
    const d = defs.get(s.id)!;
    const dir = state.attackDir[s.side];
    const phase = s.side === 'home' ? homePhase : awayPhase;
    const chasing = s === homeChaser || s === awayChaser;
    if (s === presser) press(state, s, d, carrier!, phase, tactics[s.side]);
    else if (chasing) chase(state, s);
    else shape(state, s, d, phase, tactics[s.side], dir);
    keepLegal(state, s, dir, chasing);
  }
}
