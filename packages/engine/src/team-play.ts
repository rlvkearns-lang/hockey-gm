import { PERIODS } from './constants';
import { RINK, resolveBoards, resolveNets } from './rink';
import { TUNING } from './tuning';
import type { GameState, Job, PlayerDef, ReplanReason, Side, SkaterPlan, SkaterState, Tactics, TeamPhase } from './types';

export type { TeamPhase } from './types';
import { dist, type Vec2 } from './vec';
import { carrierOf } from './util';
import type { Drive } from './skating';
import { commitTo, effortToReach, holding, holdJob, setFace, shapePhase, speedFor, triggerFor, updateTeamPhase, type Want } from './commit';
import { assignTeamJobs, boardBattle, supportTarget } from './jobs';
import { beginMarks, endMarks, jobWant } from './job-targets';

export { supportTarget } from './jobs';

const BLUE = RINK.blueLineX;
/** Attackers without the puck wait this far (m) outside the offensive blue line until the puck is in. */
const ONSIDE_MARGIN = 1;
/** An attacker whose target is within this far (m) of his onside limit is ready to stop at it. */
const ONSIDE_EASE_FROM = 2;
/** Under a delayed offside, the offending team skates to this far (m) outside the blue line to tag up. */
const TAG_UP_MARGIN = 1;
/** After the hold a held spot is reviewed every REVIEW_TICKS ticks (0.1 s), counted from when it was issued. */
const REVIEW_TICKS = 3;
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

/** Scratch for what team play wants of each skater (commitTo copies what it keeps). */
const wantPos: Vec2 = { x: 0, y: 0 };
const want: Want = { job: 'netFront', pos: wantPos, face: null, follow: 'spot', markId: null, effort: 'skate', slow: 'coast', through: false };
const slotScratch: Vec2 = { x: 0, y: 0 };

/** What a man holding `job` at a spot faces: the puck for the jobs that face the play, the slot from behind the net, else nothing. */
function faceOf(state: GameState, s: SkaterState, job: Job): Vec2 | null {
  if (job === 'office') { const dir = state.attackDir[s.side]; slotScratch.x = 20 * dir; slotScratch.y = 0; return slotScratch; }
  return FACE_SPOT_JOBS.has(job) ? state.puck.pos : null;
}
const FACE_SPOT_JOBS: ReadonlySet<Job> = new Set<Job>(['dGapStrong', 'dGapWeak', 'dLineStrong', 'dLineWeak', 'dNet', 'pointStrong', 'pointWeak', 'netFront', 'battleSupport']);
/** Jobs that follow the puck or a man every tick (the rest that follow one do so every other tick). */
const TRACK_EVERY_TICK: ReadonlySet<Job> = new Set<Job>(['chase', 'receive', 'f1', 'dCorner', 'dNet', 'driveWide', 'driveMiddle']);
/** Jobs that skate flat out after the puck or its carrier whatever the distance. */
const SPRINT_JOBS: ReadonlySet<Job> = new Set<Job>(['chase', 'receive', 'battleSupport', 'f1', 'tagUp']);

/**
 * Gives every on-ice skater a job and commits him to it (commit.ts commitTo: a held spot changes only on a trigger or
 * on review). The carrier's target and speedCap belong to the brain (brainTick): here he only stops facing anything
 * but his own way. Skaters steered by a contest, down or heading off keep what steers them (job `contest`, `down`,
 * `change`); a contest's `freeIds` still get jobs. Every other skater gets one job of his team's committed phase
 * (jobs.ts assignTeamJobs: unique and sticky; the loose puck's chase, receive and battleSupport first; tagUp for all
 * under a delayed offside) and jobWant (job-targets.ts) says where that job wants him.
 *
 * Effort is chosen by need: a sprint for the puck jobs, f1 and tagUp and where the job asks for one; otherwise by how
 * far his target is (effortToReach). A skater who must be able to stop at the blue line (keepLegal) slows with `stop`.
 */
export function assignJobs(state: GameState, defs: Map<string, PlayerDef>, tactics: Record<Side, Tactics>): void {
  const carrier = carrierOf(state);
  updateTeamPhase(state, carrier);
  beginMarks(carrier);
  try { assignAll(state, defs, tactics, carrier); } finally { endMarks(); }
}

function assignAll(state: GameState, defs: Map<string, PlayerDef>, tactics: Record<Side, Tactics>, carrier: SkaterState | null): void {
  const homeJobs = assignTeamJobs(state, 'home', defs, tactics.home);
  const awayJobs = assignTeamJobs(state, 'away', defs, tactics.away);
  const battle = carrier ? null : boardBattle(state);
  // Score effects: a team comfortably ahead presses a little less hard.
  const homeBack = sitBack(state, 'home'), awayBack = sitBack(state, 'away');

  const sk = state.skaters;
  for (let i = 0; i < sk.length; i++) {
    const s = sk[i]!;
    if (!s.onIce) continue;
    if (s.leaving) { holdJob(state, i, 'change', null, 'stop'); continue; }
    if (s === carrier) { s.faceTarget = null; holdJob(state, i, 'carrier', null); continue; }
    const job = (s.side === 'home' ? homeJobs : awayJobs)[i] ?? null;
    if (job === null) {
      if (steeredByContest(state, s)) holdJob(state, i, 'contest', null, 'stop'); else holdJob(state, i, 'down', null);
      continue;
    }
    const plan = state.plans[i]!;
    const tagging = job === 'tagUp';
    const chasing = job === 'chase' || job === 'receive';
    let trigger: ReplanReason | null = null;
    if (plan.job === job && plan.follow === 'spot' && (holding(state, i, job) || (state.tick - plan.targetTick) % REVIEW_TICKS !== 0)
      && (trigger = triggerFor(state, i, job)) === null) {
      // Inside the hold, or between reviews, with nothing to re-plan for: he keeps his spot; only how he gets there
      // follows his need.
      setFace(s, faceOf(state, s, job));
      spotEffort(state, s, plan, keepLegal(state, s, s.target, chasing, tagging, false), tagging);
      continue;
    }
    if (plan.job === job && plan.follow !== 'spot' && !TRACK_EVERY_TICK.has(job) && (state.tick + i) % 2 === 1
      && (trigger ?? (trigger = triggerFor(state, i, job))) === null) {
      // A man or the puck he follows from a distance is tracked every other tick: his target, face and effort stay.
      continue;
    }
    jobWant(state, s, job, defs, tactics[s.side], want);
    if (job === 'battleSupport' && battle) {
      const t = supportTarget(state, s.side);
      if (t) { wantPos.x = t.x; wantPos.y = t.y; }
    }
    if (SPRINT_JOBS.has(job)) want.effort = 'sprint';
    // Ready to stop at the line; caught beyond it, he gets back onside as fast as he can.
    const onside = keepLegal(state, s, wantPos, chasing, tagging);
    if (onside !== 'free') { want.slow = 'stop'; want.through = false; }
    // Ready to stop at the line means not arriving at it flat out.
    if (onside === 'atLine' && want.effort === 'sprint') want.effort = 'skate';
    if (onside === 'beyond') want.effort = 'sprint';
    commitTo(state, i, want, trigger ?? triggerFor(state, i, job));
    // A held target the play has since made illegal (the puck left the zone) is pulled back onside.
    const held = keepLegal(state, s, s.target, chasing, tagging, false);
    if (plan.follow === 'spot' && !SPRINT_JOBS.has(plan.job) && want.effort !== 'sprint') spotEffort(state, s, plan, held, tagging);
    else {
      if (held !== 'free') { plan.slow = 'stop'; plan.through = false; }
      if (plan.follow !== 'spot' && !SPRINT_JOBS.has(plan.job) && plan.effort !== 'sprint') {
        // Following a man or the puck: as hard as the distance needs, never a glide behind a moving man.
        const dx = s.target.x - s.pos.x, dy = s.target.y - s.pos.y;
        const e = effortToReach(Math.sqrt(dx * dx + dy * dy));
        plan.effort = e === 'glide' ? 'skate' : e;
      }
      if (held === 'atLine' && plan.effort === 'sprint') plan.effort = 'skate';
      if (held === 'beyond') plan.effort = 'sprint';
      s.speedCap = speedFor(plan.effort, plan.job, s.energy);
    }
    if (plan.job === 'f1') s.speedCap *= s.side === 'home' ? homeBack : awayBack;
  }
}

/**
 * How a skater holding a spot gets there, by need: stopping at the blue line when `onside` says
 * so, otherwise coasting; a sprint to tag up or to get back onside, else effortToReach the held spot.
 */
function spotEffort(state: GameState, s: SkaterState, plan: SkaterPlan, onside: Onside, tagging: boolean): void {
  plan.slow = onside === 'free' ? 'coast' : 'stop';
  if (onside !== 'free') plan.through = false;
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
