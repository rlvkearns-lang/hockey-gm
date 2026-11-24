import { composite } from './attributes';
import { DT, PERIODS } from './constants';
import { boardsNormal, clipToNets, RINK, resolveBoards, resolveNets } from './rink';
import { TUNING } from './tuning';
import type { ContestStateOf, GameState, Job, PlayerDef, Position, ReplanReason, Side, SkaterPlan, SkaterState, Tactics, TeamPhase } from './types';

export type { TeamPhase } from './types';
import { dist, hypot2, type Vec2 } from './vec';
import { carrierOf, clamp } from './util';
import type { Drive } from './skating';
import { commitTo, committedPhase, effortToReach, holding, holdJob, rawPhase, setFace, shapePhase, speedFor, triggerFor, updateTeamPhase, type ShapePhase, type Want } from './commit';


/** Named offensive-zone spots: the three the forwards cycle through, and the two points the defencemen hold. */
export type OzoneSpot = 'corner' | 'netFront' | 'highSlot' | 'leftPoint' | 'rightPoint';
export const OZONE_SPOTS: readonly OzoneSpot[] = ['corner', 'netFront', 'highSlot', 'leftPoint', 'rightPoint'];

const BLUE = RINK.blueLineX;
/** Attackers without the puck wait this far (m) outside the offensive blue line until the puck is in. */
const ONSIDE_MARGIN = 1;
/** An attacker whose target is within this far (m) of his onside limit is ready to stop at it. */
const ONSIDE_EASE_FROM = 2;
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

/** The raw phase of `side` from the carrier (looseChase without one); team play uses the committed phase (commit.ts). */
export function phaseFor(state: GameState, side: Side): TeamPhase {
  const carrier = carrierOf(state);
  if (!carrier) return 'looseChase';
  return shapePhase(carrier.side, state.puck.pos.x, side, state.attackDir[side]);
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


function setRel(out: Vec2, rx: number, ly: number, dir: 1 | -1): void {
  out.x = rx * dir;
  out.y = ly * dir;
}

/** How well a defenceman reads a rush (sets his gap in the neutral zone). */
const READS = { defensivePositioning: 0.7, iq: 0.3 };

/** Off-puck positioning for `phase`, in attack-relative coordinates: writes the spot into `out`. */
function shape(state: GameState, s: SkaterState, d: PlayerDef, phase: ShapePhase, tactic: Tactics, dir: 1 | -1, out: Vec2): void {
  const puck = state.puck.pos;
  const pr = puck.x * dir, pl = puck.y * dir;
  const ps = pl >= 0 ? 1 : -1;
  const slot = s.slot ?? 'C';
  const lane = LANE[slot];
  const isD = slot === 'LD' || slot === 'RD';
  const isC = slot === 'C' || slot === 'G';
  switch (phase) {
    case 'breakout':
      if (isD) setRel(out, lane === ps ? clamp(pr - 3, -25, -12) : clamp(pr - 1, -22, -10), lane === ps ? ps * 7 : -ps * 3, dir);
      else if (isC) setRel(out, clamp(pr + 4, -20, -6), -ps * 2, dir);
      else setRel(out, clamp(pr + 8, -16, -5), lane * 10.5, dir);
      return;
    case 'rush':
      if (isD) setRel(out, pr - (13 - 6 * d.tendencies.joinRush), lane * 5, dir);
      else if (isC) setRel(out, pr - 2, -ps * 3, dir);
      else setRel(out, pr + 4, lane * 8, dir);
      return;
    case 'ozone': {
      if (isD) ozoneSpotPos(state, s.side, lane > 0 ? 'leftPoint' : 'rightPoint', out);
      else {
        const rot = Math.floor(state.tick / CYCLE_TICKS);
        ozoneSpotPos(state, s.side, CYCLE[((CYCLE_INDEX[slot] ?? 1) + rot) % CYCLE.length]!, out);
      }
      return;
    }
    case 'forecheck': {
      const f = tactic.forecheck;
      const keen = (d.tendencies.forecheck - 0.5) * 4;
      if (isD) setRel(out, f === 'aggressive' ? BLUE + 1.5 : f === 'balanced' ? BLUE + 0.5 : -3, lane * (f === 'passive' ? 4 : 7), dir);
      else if (isC) {
        if (f === 'aggressive') setRel(out, Math.min(pr, 23) + keen, ps * 7, dir);
        else if (f === 'balanced') setRel(out, BLUE + 7 + keen, -ps * 2, dir);
        else setRel(out, BLUE - 3 + keen, 0, dir);
      } else setRel(out, (f === 'aggressive' ? BLUE + 4 : f === 'balanced' ? BLUE + 2 : 2) + keen, lane * 7, dir);
      return;
    }
    case 'neutralDefence': {
      if (isD) {
        const reads = composite(d.attrs, READS);
        const approach = Math.max(0, -state.puck.vel.x * dir);
        const gap = 6 + (100 - reads) * 0.05 + approach * 0.6;
        setRel(out, Math.max(-24, pr - gap), lane * 4 + pl * 0.3, dir);
      } else if (isC) setRel(out, Math.max(-22, pr - 5), pl * 0.5, dir);
      else setRel(out, Math.max(-22, pr - 3), lane * 7, dir);
      return;
    }
    case 'dzone':
      if (isD) setRel(out, lane === ps ? -23.5 : -24.3, lane === ps ? ps * 5 : -ps * 0.8, dir);
      else if (isC) setRel(out, -20, ps * 1.5, dir);
      else setRel(out, -11, lane * 8, dir);
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


/** Goal-side pressure on the carrier: PRESS_GAP m from him toward the net `s` defends. Writes the spot into `out`. */
function pressSpot(state: GameState, s: SkaterState, carrier: SkaterState, out: Vec2): void {
  const dir = state.attackDir[s.side];
  const netX = -dir * RINK.goalLineX;
  const dx = netX - carrier.pos.x, dy = -carrier.pos.y;
  const l = hypot2(dx, dy) || 1;
  out.x = carrier.pos.x + (dx / l) * PRESS_GAP;
  out.y = carrier.pos.y + (dy / l) * PRESS_GAP;
}

const routeProbe: Vec2 = { x: 0, y: 0 };

/**
 * Where to skate for a loose puck (written into `out`): where it will be, leading it by the time it takes to get
 * there. With a net in the way he heads for the corner of the frame on his side and the puck's end of it first.
 */
function chaseSpot(state: GameState, s: SkaterState, out: Vec2): void {
  const p = state.puck;
  const t = Math.min(MAX_LEAD_SECONDS, dist(s.pos, p.pos) / CHASE_SPEED);
  out.x = p.pos.x + p.vel.x * t;
  out.y = p.pos.y + p.vel.y * t;
  routeProbe.x = out.x;
  routeProbe.y = out.y;
  clipToNets(s.pos, routeProbe, NET_ROUTE_MARGIN);
  if (routeProbe.x !== out.x || routeProbe.y !== out.y) {
    const end = out.x >= 0 ? 1 : -1;
    const behind = out.x * end > RINK.goalLineX + RINK.netDepth / 2;
    out.x = end * (behind ? RINK.goalLineX + RINK.netDepth + NET_ROUTE_MARGIN : RINK.goalLineX - NET_ROUTE_MARGIN);
    out.y = (s.pos.y >= 0 ? 1 : -1) * (RINK.netHalfWidth + NET_ROUTE_MARGIN);
  }
}

const scratchVel: Vec2 = { x: 0, y: 0 };

/**
 * Keeps `pos`, the target of `s`, legal: onside (an attacker without the puck never goes into the offensive zone
 * ahead of it; a chaser may follow the puck itself up to the line; under a delayed offside against his team he heads
 * out over the blue line to tag up), inside the boards and clear of the net frames. Returns `beyond` when he is past
 * his onside limit (he must get back), `atLine` when his target is at it or near it, or he is skating toward it too fast
 * to stop short of it by easing off (he must be able to stop there), else `free`. With `rink` false only the onside
 * part is applied (for a target already kept inside the boards and clear of the frames).
 */
type Onside = 'free' | 'atLine' | 'beyond';

function keepLegal(state: GameState, s: SkaterState, pos: Vec2, chasing: boolean, tagUp: boolean, rink = true): Onside {
  const dir = state.attackDir[s.side];
  const pr = state.puck.pos.x * dir;
  let hold: Onside = 'free';
  if (tagUp) {
    if (pos.x * dir > BLUE - TAG_UP_MARGIN) pos.x = (BLUE - TAG_UP_MARGIN) * dir;
    hold = s.pos.x * dir > BLUE - TAG_UP_MARGIN ? 'beyond' : 'atLine';
  } else if (pr < BLUE) {
    const limit = chasing ? Math.max(BLUE - ONSIDE_MARGIN, Math.min(pr, BLUE)) : BLUE - ONSIDE_MARGIN;
    if (pos.x * dir > limit) pos.x = limit * dir;
    // Too fast toward the line to stop short of it by easing off, he must be ready to stop hard as well.
    const room = limit - s.pos.x * dir, toward = s.vel.x * dir;
    hold = room < 0 ? 'beyond'
      : limit - pos.x * dir < ONSIDE_EASE_FROM || (toward > 0 && toward * toward > 2 * TUNING.skating.easeDecel * room) ? 'atLine' : 'free';
  }
  if (rink) {
    scratchVel.x = 0;
    scratchVel.y = 0;
    resolveBoards(pos, scratchVel, TARGET_BOARDS_MARGIN, 0);
    resolveNets(pos, scratchVel, TARGET_NET_MARGIN);
  }
  return hold;
}

/** Can be given a job by team play now: on the ice, not heading off, not down, not steered by a contest, not the carrier. */
const available = (state: GameState, s: SkaterState, carrier: SkaterState | null): boolean =>
  s.onIce && !s.leaving && s.downT === 0 && s !== carrier && !steeredByContest(state, s);

/** Each side's nearest available skater to a spot, and whoever of them holds a job now (stickyPicks). */
const pickScratch = {
  near: [null, null] as (SkaterState | null)[], nearD2: [0, 0], cur: [null, null] as (SkaterState | null)[], curD2: [0, 0],
};

/**
 * For each side (0 home, 1 away) with a spot in `to` (null: none wanted), the skater who should hold `job` going for
 * it: whoever of that side holds it now, unless another is closer to it by more than TUNING.commit.chaserMargin, in
 * which case the nearest. Null where nobody can. Writes `out` and returns it.
 */
function stickyPicks(state: GameState, job: Job, to: readonly (Vec2 | null)[], carrier: SkaterState | null, out: (SkaterState | null)[]): (SkaterState | null)[] {
  const p = pickScratch;
  for (let k = 0; k < 2; k++) { p.near[k] = null; p.cur[k] = null; p.nearD2[k] = Infinity; p.curD2[k] = Infinity; }
  const sk = state.skaters;
  for (let i = 0; i < sk.length; i++) {
    const s = sk[i]!;
    if (!s.onIce) continue;
    const k = s.side === 'home' ? 0 : 1;
    const spot = to[k];
    if (!spot || !available(state, s, carrier)) continue;
    const dx = s.pos.x - spot.x, dy = s.pos.y - spot.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < p.nearD2[k]!) { p.nearD2[k] = d2; p.near[k] = s; }
    if (state.plans[i]!.job === job && d2 < p.curD2[k]!) { p.curD2[k] = d2; p.cur[k] = s; }
  }
  for (let k = 0; k < 2; k++) {
    const cur = p.cur[k]!, near = p.near[k]!;
    out[k] = cur === null || cur === near || Math.sqrt(p.curD2[k]!) > Math.sqrt(p.nearD2[k]!) + TUNING.commit.chaserMargin ? near : cur;
  }
  return out;
}

const pickTo: (Vec2 | null)[] = [null, null];
const picked: (SkaterState | null)[] = [null, null];

/** Scratch for what team play wants of each skater (commitTo copies what it keeps). */
const wantPos: Vec2 = { x: 0, y: 0 };
const want: Want = { job: 'shape', pos: wantPos, face: null, follow: 'spot', markId: null, effort: 'skate', slow: 'coast', through: false };

/**
 * Gives every on-ice skater a job from his team's committed phase and commits him to it (commit.ts commitTo: a held
 * spot changes only on a trigger or on review). The carrier's target and speedCap belong to the brain (brainTick):
 * here he only stops facing anything but his own way. Skaters steered by a contest, down or heading off keep what
 * steers them (job `contest`, `down`, `change`); a contest's `freeIds` still get jobs. With the puck carried, one
 * defender presses the carrier (`press`); with it loose, one skater of each side chases it (`chase`; a pass's intended
 * receiver `receive`s it for his side) and the rest keep the shape of the side that last had the puck (`shape`). The
 * presser and the chasers hand over only to a teammate closer by more than TUNING.commit.chaserMargin. While a board
 * battle holds the puck, each side's would-be chaser goes to support it (`battleSupport`, supportTarget) instead, or
 * keeps his shape once his side has its supporting player. Under a delayed offside the offending team neither presses
 * nor chases: all of it skates out of the zone (`tagUp`).
 *
 * Effort is chosen by need: a sprint for press, chase, receive, battleSupport and tagUp; otherwise by how far the spot
 * is (effortToReach). A skater who must be able to stop at the blue line (keepLegal) slows with `stop`.
 */
export function assignJobs(state: GameState, defs: Map<string, PlayerDef>, tactics: Record<Side, Tactics>): void {
  const carrier = carrierOf(state);
  updateTeamPhase(state, carrier);
  const puck = state.puck.pos;
  const tagUp = state.delayedOffside?.side ?? null;
  let presser: SkaterState | null = null;
  let homeChaser: SkaterState | null = null, awayChaser: SkaterState | null = null;
  if (carrier) {
    // The defending side (not one tagging up) presses the carrier.
    const def = carrier.side === 'home' ? 1 : 0;
    pickTo[def] = (def === 0 ? 'home' : 'away') === tagUp ? null : carrier.pos;
    pickTo[1 - def] = null;
    presser = stickyPicks(state, 'press', pickTo, carrier, picked)[def]!;
  } else {
    pickTo[0] = tagUp === 'home' ? null : puck;
    pickTo[1] = tagUp === 'away' ? null : puck;
    stickyPicks(state, 'chase', pickTo, null, picked);
    homeChaser = picked[0]!;
    awayChaser = picked[1]!;
  }
  const pass = carrier ? null : state.pendingPass;
  let receiver: SkaterState | null = null;
  if (pass) {
    for (const s of state.skaters) {
      if (s.id !== pass.toId) continue;
      if (available(state, s, null) && s.side !== tagUp) {
        receiver = s;
        if (s.side === 'home') homeChaser = s; else awayChaser = s;
      }
      break;
    }
  }
  const battle = carrier ? null : boardBattle(state);
  const homeSupport = battle ? supportTarget(state, 'home') : null;
  const awaySupport = battle ? supportTarget(state, 'away') : null;
  // Score effects: a team comfortably ahead presses a little less hard.
  const homeBack = sitBack(state, 'home'), awayBack = sitBack(state, 'away');
  const homeRaw = rawPhase(state, 'home', carrier), awayRaw = rawPhase(state, 'away', carrier);

  const sk = state.skaters;
  for (let i = 0; i < sk.length; i++) {
    const s = sk[i]!;
    if (!s.onIce) continue;
    if (s.leaving) { holdJob(state, i, 'change', null, 'stop'); continue; }
    if (steeredByContest(state, s)) { holdJob(state, i, 'contest', null, 'stop'); continue; }
    if (s === carrier) { s.faceTarget = null; holdJob(state, i, 'carrier', null); continue; }
    if (s.downT > 0) { holdJob(state, i, 'down', null); continue; }
    const chasing = s === homeChaser || s === awayChaser;
    const support = chasing && battle ? (s.side === 'home' ? homeSupport : awaySupport) : null;
    const tagging = s.side === tagUp;
    const job: Job = tagging ? 'tagUp' : s === presser ? 'press' : support ? 'battleSupport'
      : chasing && !battle ? (s === receiver ? 'receive' : 'chase') : 'shape';
    const plan = state.plans[i]!;
    const phase = committedPhase(state, s.side);
    // He faces the puck unless his team has it outside the offensive zone: a defenceman as play is now (he reads the
    // rush coming at him at once), a forward as his team's committed phase says.
    const seen = s.slot === 'LD' || s.slot === 'RD' ? (s.side === 'home' ? homeRaw : awayRaw) : phase;
    const facePuck = seen !== 'breakout' && seen !== 'rush';
    const spotJob = job === 'shape' || job === 'tagUp';
    let trigger: ReplanReason | null = null;
    if (spotJob && holding(state, i, job) && (trigger = triggerFor(state, i, job)) === null) {
      // Inside the hold, with nothing to re-plan for: he keeps his spot; only how he gets there follows his need.
      setFace(s, facePuck ? puck : null);
      spotEffort(state, s, plan, keepLegal(state, s, s.target, chasing, tagging, false), tagging);
      continue;
    }
    const d = defs.get(s.id)!;
    const dir = state.attackDir[s.side];
    want.job = job;
    want.face = null;
    want.follow = 'spot';
    want.markId = null;
    want.slow = 'coast';
    want.through = false;
    want.effort = 'sprint';
    if (spotJob) {
      shape(state, s, d, phase === 'looseChase' ? 'neutralDefence' : phase, tactics[s.side], dir, wantPos);
      if (facePuck) want.face = puck;
    } else if (job === 'press') {
      pressSpot(state, s, carrier!, wantPos);
      want.face = puck;
      want.follow = 'man';
      want.markId = carrier!.id;
      want.through = true;
    } else if (job === 'battleSupport') {
      wantPos.x = support!.x;
      wantPos.y = support!.y;
      want.face = puck;
    } else {
      chaseSpot(state, s, wantPos);
      want.follow = 'puck';
      want.through = true;
    }
    // Ready to stop at the line; caught beyond it, he gets back onside as fast as he can.
    const onside = keepLegal(state, s, wantPos, chasing, tagging);
    if (onside !== 'free') { want.slow = 'stop'; want.through = false; }
    if (onside === 'beyond') want.effort = 'sprint';
    commitTo(state, i, want, trigger ?? triggerFor(state, i, job));
    // A held target the play has since made illegal (the puck left the zone) is pulled back onside.
    const held = keepLegal(state, s, s.target, chasing, tagging, false);
    if (plan.follow === 'spot' && (plan.job === 'shape' || plan.job === 'tagUp')) spotEffort(state, s, plan, held, plan.job === 'tagUp');
    else {
      if (held !== 'free') { plan.slow = 'stop'; plan.through = false; }
      if (held === 'beyond' && plan.effort !== 'sprint') { plan.effort = 'sprint'; s.speedCap = speedFor('sprint', plan.job, s.energy); }
    }
    if (plan.job === 'press') s.speedCap *= s.side === 'home' ? homeBack : awayBack;
  }
}

/**
 * How a skater holding a spot (`shape`, `tagUp`) gets there, by need: stopping at the blue line when `onside` says
 * so, otherwise coasting; a sprint to tag up or to get back onside, else effortToReach the held spot.
 */
function spotEffort(state: GameState, s: SkaterState, plan: SkaterPlan, onside: Onside, tagging: boolean): void {
  plan.slow = onside === 'free' ? 'coast' : 'stop';
  plan.through = false;
  const dx = s.target.x - s.pos.x, dy = s.target.y - s.pos.y;
  plan.effort = tagging || onside === 'beyond' ? 'sprint' : effortToReach(Math.sqrt(dx * dx + dy * dy));
  s.speedCap = speedFor(plan.effort, plan.job, s.energy);
}

const STEERED: Drive = { slow: 'stop', through: false };
const RACING: Drive = { slow: 'coast', through: true };
const planDrive: Drive = { slow: 'coast', through: false };

/**
 * How skater i (`s`) drives this tick: as his plan says, or, steered by a contest, ready to stop and never skating
 * through, except in the race stage of a loose-puck race, which he skates flat out through the puck's spot. The
 * returned object is reused: read it before the next call.
 */
export function driveOf(state: GameState, s: SkaterState, i: number): Drive {
  if (s.contestId !== null) {
    for (const c of state.contests) {
      if (c.id !== s.contestId) continue;
      if (c.freeIds.includes(s.id)) break;
      return c.kind === 'looseRace' && c.stage === 'race' ? RACING : STEERED;
    }
  }
  const p = state.plans[i]!;
  planDrive.slow = p.slow;
  planDrive.through = p.through;
  return planDrive;
}
