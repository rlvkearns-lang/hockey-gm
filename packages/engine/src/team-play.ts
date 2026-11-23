import { composite } from './attributes';
import { DT, PERIODS } from './constants';
import { boardsNormal, clipToNets, RINK, resolveBoards, resolveNets, zoneOf } from './rink';
import { TUNING } from './tuning';
import type { ContestStateOf, GameState, PlayerDef, Position, Side, SkaterState, Tactics, TeamPhase } from './types';

export type { TeamPhase } from './types';
import { dist, hypot2, type Vec2 } from './vec';
import { carrierOf, clamp } from './util';


/** Named offensive-zone spots: the three the forwards cycle through, and the two points the defencemen hold. */
export type OzoneSpot = 'corner' | 'netFront' | 'highSlot' | 'leftPoint' | 'rightPoint';
export const OZONE_SPOTS: readonly OzoneSpot[] = ['corner', 'netFront', 'highSlot', 'leftPoint', 'rightPoint'];

const BLUE = RINK.blueLineX;
/** Attackers without the puck wait this far (m) outside the offensive blue line until the puck is in. */
const ONSIDE_MARGIN = 1;
/** Braking (m/s^2) assumed when easing toward the blue line; below every skater's real deceleration. */
const ONSIDE_BRAKE = 6;
/** An attacker whose target is within this far (m) of his onside limit eases up as if it were at the limit. */
const ONSIDE_EASE_FROM = 2;
/** Typical top speed (m/s), to turn a safe approach speed into a speedCap fraction. */
const TYPICAL_TOP_SPEED = 9;
/** Under a delayed offside, the offending team skates to this far (m) outside the blue line to tag up. */
const TAG_UP_MARGIN = 1;
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
/** A chaser whose straight line to the puck passes within this far (m) of a net frame goes round the frame's corner. */
const NET_ROUTE_MARGIN = 0.7;
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

export function phaseFor(state: GameState, side: Side): TeamPhase {
  const carrier = carrierOf(state);
  if (!carrier) return 'looseChase';
  return phaseOf(carrier.side, state.puck.pos.x, side, state.attackDir[side]);
}

/**
 * True when `s` is in a contest that steers him (he gets no job, his carry and protect decisions are ignored, and he is
 * no pass target and picks nothing up); false when he is in none or is one of its `freeIds`.
 */
export function steeredByContest(state: GameState, s: SkaterState): boolean {
  if (s.contestId === null) return false;
  for (const c of state.contests) if (c.id === s.contestId) return !c.freeIds.includes(s.id);
  return true;
}

/** True while `id`'s stick is tied up by a net-front defender: no pass to him, no loose puck for him. */
export function isTiedUp(state: GameState, id: string): boolean {
  for (const t of state.tiedUpUntil) if (t.id === id && state.tick < t.tick) return true;
  return false;
}

/** A supporting player waits this far (m) off the boards, on the ice side of a board battle. */
const SUPPORT_OFF_BOARDS = 2;
const normalScratch: Vec2 = { x: 0, y: 0 };

/**
 * The board battle running now (contest kind `boardBattle`, before its `resolve`), or null. Its `roles.supportA` and
 * `roles.supportB` are each side's supporting player (null for none yet).
 */
function boardBattle(state: GameState): ContestStateOf<'boardBattle'> | null {
  for (const c of state.contests) if (c.kind === 'boardBattle' && c.stage !== 'resolve' && c.stage !== 'protect') return c;
  return null;
}

/**
 * Where `side`'s nearest free skater should go to support the board battle running now: SUPPORT_OFF_BOARDS m off the
 * boards on the ice side of it, from where he joins it. Null when no battle runs, `side` has nobody in it, or it
 * already has its supporting player.
 */
export function supportTarget(state: GameState, side: Side): Vec2 | null {
  const c = boardBattle(state);
  if (c === null) return null;
  let slot = -1;
  for (let i = 0; i < 2; i++) {
    const id = c.participants[i];
    for (const s of state.skaters) if (s.id === id && s.side === side) slot = i;
  }
  if (slot < 0 || (slot === 0 ? c.roles.supportA : c.roles.supportB) !== null) return null;
  const n = boardsNormal(c.spot, normalScratch);
  return { x: c.spot.x - n.x * SUPPORT_OFF_BOARDS, y: c.spot.y - n.y * SUPPORT_OFF_BOARDS };
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


function setRel(s: SkaterState, rx: number, ly: number, dir: 1 | -1): void {
  s.target.x = rx * dir;
  s.target.y = ly * dir;
}

/** Face the puck (kept as the skater's own object, updated in place). */
function facePuck(s: SkaterState, puck: Vec2): void {
  if (s.faceTarget) { s.faceTarget.x = puck.x; s.faceTarget.y = puck.y; } else s.faceTarget = { x: puck.x, y: puck.y };
}

/** How well a defenceman reads a rush (sets his gap in the neutral zone). */
const READS = { defensivePositioning: 0.7, iq: 0.3 };

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
        const reads = composite(d.attrs, READS);
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

/**
 * Where `side` stands on the scoreboard: `ahead` with a comfortable lead (TUNING.scoreEffects.lead goals, or lateLead
 * in the third period), `behind` facing one, else `close`.
 */
export function scoreMargin(state: GameState, side: Side): 'ahead' | 'behind' | 'close' {
  const lead = state.score[side] - state.score[side === 'home' ? 'away' : 'home'];
  const se = TUNING.scoreEffects;
  const need = state.period >= PERIODS ? se.lateLead : se.lead;
  return lead >= need ? 'ahead' : -lead >= need ? 'behind' : 'close';
}

/** How hard `side` still pushes (its presser's speed, its poke attempts): TUNING.scoreEffects.sitBack when comfortably ahead, else 1. */
export function sitBack(state: GameState, side: Side): number {
  return scoreMargin(state, side) === 'ahead' ? TUNING.scoreEffects.sitBack : 1;
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

const routeProbe: Vec2 = { x: 0, y: 0 };

/**
 * Skate to where a loose puck will be, leading it by the time it takes to get there. With a net in the way he heads
 * for the corner of the frame on his side and the puck's end of it first.
 */
function chase(state: GameState, s: SkaterState): void {
  const p = state.puck;
  const t = Math.min(MAX_LEAD_SECONDS, dist(s.pos, p.pos) / CHASE_SPEED);
  s.target.x = p.pos.x + p.vel.x * t;
  s.target.y = p.pos.y + p.vel.y * t;
  routeProbe.x = s.target.x;
  routeProbe.y = s.target.y;
  clipToNets(s.pos, routeProbe, NET_ROUTE_MARGIN);
  if (routeProbe.x !== s.target.x || routeProbe.y !== s.target.y) {
    const end = s.target.x >= 0 ? 1 : -1;
    const behind = s.target.x * end > RINK.goalLineX + RINK.netDepth / 2;
    s.target.x = end * (behind ? RINK.goalLineX + RINK.netDepth + NET_ROUTE_MARGIN : RINK.goalLineX - NET_ROUTE_MARGIN);
    s.target.y = (s.pos.y >= 0 ? 1 : -1) * (RINK.netHalfWidth + NET_ROUTE_MARGIN);
  }
  s.faceTarget = null;
  s.speedCap = 1;
}

const scratchVel: Vec2 = { x: 0, y: 0 };

/**
 * Keep the target onside (an attacker without the puck never goes into the offensive zone ahead of it, and eases up
 * so he does not coast over the line; a chaser may follow the puck itself up to the line; under a delayed offside
 * against his team he heads out over the blue line to tag up), inside the boards and clear of the net frames.
 */
function keepLegal(state: GameState, s: SkaterState, dir: 1 | -1, chasing: boolean, tagUp: boolean): void {
  const pr = state.puck.pos.x * dir;
  if (tagUp) {
    if (s.target.x * dir > BLUE - TAG_UP_MARGIN) s.target.x = (BLUE - TAG_UP_MARGIN) * dir;
    s.speedCap = 1;
  } else if (pr < BLUE) {
    const limit = chasing ? Math.max(BLUE - ONSIDE_MARGIN, Math.min(pr, BLUE)) : BLUE - ONSIDE_MARGIN;
    if (s.target.x * dir > limit) s.target.x = limit * dir;
    // Heading for the line (his target at it or just short of it), he eases up in time to stop short of it.
    const room = limit - s.pos.x * dir;
    if (room > 0 && limit - s.target.x * dir < ONSIDE_EASE_FROM) s.speedCap = Math.min(s.speedCap, Math.max(0.15, Math.sqrt(2 * ONSIDE_BRAKE * room) / TYPICAL_TOP_SPEED));
  }
  scratchVel.x = 0;
  scratchVel.y = 0;
  resolveBoards(s.target, scratchVel, TARGET_BOARDS_MARGIN, 0);
  resolveNets(s.target, scratchVel, TARGET_NET_MARGIN);
}

/**
 * Sets every on-ice skater's target, faceTarget and speedCap from his team's phase. The carrier's target and
 * speedCap belong to the brain (brainTick); here he only stops facing anything but his own way. Skaters steered by
 * a contest are left alone (its `freeIds` still get jobs). With the puck carried, the nearest defender pressures the carrier; with it loose, the
 * nearest skater of each side chases it (a pass's intended receiver chases for his side) and the rest keep the shape
 * of the side that last had the puck. While a board battle holds the puck, each side's would-be chaser goes to support
 * it (supportTarget) instead, or keeps his shape once his side has its supporting player. Under a delayed offside the
 * offending team neither presses nor chases: all of it skates out of the zone.
 */
export function assignJobs(state: GameState, defs: Map<string, PlayerDef>, tactics: Record<Side, Tactics>): void {
  const puck = state.puck.pos;
  const carrier = carrierOf(state);
  const shapeSide: Side | null = carrier ? carrier.side : state.possession;
  let presser: SkaterState | null = null, pressD = Infinity;
  let homeChaser: SkaterState | null = null, homeD = Infinity;
  let awayChaser: SkaterState | null = null, awayD = Infinity;
  const tagUp = state.delayedOffside?.side ?? null;
  for (const s of state.skaters) {
    if (!s.onIce || s.leaving || s.downT > 0 || steeredByContest(state, s) || s === carrier || s.side === tagUp) continue;
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
      if (s.onIce && !s.leaving && s.downT === 0 && !steeredByContest(state, s) && s.side !== tagUp) { if (s.side === 'home') homeChaser = s; else awayChaser = s; }
      break;
    }
  }
  const battle = carrier ? null : boardBattle(state);
  const homeSupport = battle ? supportTarget(state, 'home') : null;
  const awaySupport = battle ? supportTarget(state, 'away') : null;
  // Score effects: a team comfortably ahead presses a little less hard.
  const homeBack = sitBack(state, 'home'), awayBack = sitBack(state, 'away');
  const homePhase = phaseOf(shapeSide, puck.x, 'home', state.attackDir.home);
  const awayPhase = phaseOf(shapeSide, puck.x, 'away', state.attackDir.away);

  for (const s of state.skaters) {
    if (!s.onIce || s.leaving || steeredByContest(state, s)) continue;
    if (s === carrier) { s.faceTarget = null; continue; }
    const d = defs.get(s.id)!;
    const dir = state.attackDir[s.side];
    const phase = s.side === 'home' ? homePhase : awayPhase;
    const chasing = s === homeChaser || s === awayChaser;
    const support = chasing && battle ? (s.side === 'home' ? homeSupport : awaySupport) : null;
    const tactic = tactics[s.side];
    if (s === presser) {
      press(state, s, d, carrier!, phase, tactic);
      s.speedCap *= s.side === 'home' ? homeBack : awayBack;
    }
    else if (support) {
      s.target.x = support.x;
      s.target.y = support.y;
      facePuck(s, puck);
      s.speedCap = 1;
    } else if (chasing && !battle) chase(state, s);
    else shape(state, s, d, phase, tactic, dir);
    keepLegal(state, s, dir, chasing, s.side === tagUp);
  }
}
