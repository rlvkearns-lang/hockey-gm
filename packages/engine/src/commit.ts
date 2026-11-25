/**
 * Commitment: what each skater has decided to do (his SkaterPlan in `state.plans`) and each team's committed phase.
 *
 * A skater holds his job and his target. A held spot (`follow: 'spot'`) and the job itself change only on a trigger
 * (triggerFor: a change of possession, a pass to him, a loose puck that becomes his, a change of his team's committed
 * phase, a whistle, the end of a contest that steered him, getting up, stepping on, a delayed offside starting or
 * ending) or on review: once TUNING.commit.holdSeconds have passed since it was issued and the spot he would pick now
 * is more than TUNING.commit.moveEnough from the held one. A `puck` or `man` target is tracked every tick.
 *
 * His effort (how hard he skates: speedFor gives his speedCap), how he slows and whether he skates through his target
 * follow his need every tick; they are kept in his plan so that game.ts moves him as his plan says.
 */
import { DT as DT_ } from './constants';
import { zoneOf as zoneOf_ } from './rink';
import { TUNING as TUNING_ } from './tuning';
import type { Effort, GameState, Job, ReplanReason, Side, SkaterPlan, SkaterState, SlowMode, TeamPhase, TeamPhaseState } from './types';
import { carrierOf as carrierOf_, SIDES as SIDES_ } from './util';
import type { Vec2 } from './vec';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const DT = DT_;
const zoneOf = zoneOf_;
const TUNING = TUNING_;
const carrierOf = carrierOf_;
const SIDES = SIDES_;

const C = TUNING.commit;
const E = TUNING.effort;
/** The hold and the phase delay in ticks. */
const HOLD_TICKS = Math.round(C.holdSeconds / DT);
const PHASE_DELAY_TICKS = Math.round(C.phaseDelay / DT);

/** A team phase other than the loose-puck one. */
export type ShapePhase = Exclude<TeamPhase, 'looseChase'>;

/** Phase of `side` when `withPuck` has (or last had) the puck at puckX. */
export function shapePhase(withPuck: Side | null, puckX: number, side: Side, dir: 1 | -1): ShapePhase {
  const zone = zoneOf(puckX, dir);
  if (withPuck === side) return zone === 'D' ? 'breakout' : zone === 'N' ? 'rush' : 'ozone';
  return zone === 'O' ? 'forecheck' : zone === 'N' ? 'neutralDefence' : 'dzone';
}

/** The raw phase of `side` now: from the carrier's side, else the side in possession, and where the puck is. */
export function rawPhase(state: GameState, side: Side, carrier: SkaterState | null = carrierOf(state)): ShapePhase {
  return shapePhase(carrier ? carrier.side : state.possession, state.puck.pos.x, side, state.attackDir[side]);
}

/** A plan for a skater who has not been given anything yet. */
function blankPlan(): SkaterPlan {
  return { job: 'lineUp', jobTick: 0, targetTick: 0, reason: 'start', possession: null, follow: 'spot', markId: null, effort: 'skate', slow: 'coast', through: false };
}

export function initialPlans(skaters: number): SkaterPlan[] {
  const out: SkaterPlan[] = [];
  for (let i = 0; i < skaters; i++) out.push(blankPlan());
  return out;
}

export function initialTeamPhase(): Record<Side, TeamPhaseState> {
  return {
    home: { phase: 'neutralDefence', sinceTick: 0, pending: null, pendingTick: 0 },
    away: { phase: 'neutralDefence', sinceTick: 0, pending: null, pendingTick: 0 },
  };
}

/** Each skaters array's index by id (a derived cache: the order of state.skaters never changes). */
const indexCache = new WeakMap<GameState['skaters'], Map<string, number>>();

/** Index of skater `id` in `state.skaters` (and so of his plan). */
export function indexOf(state: GameState, id: string): number {
  const sk = state.skaters;
  let m = indexCache.get(sk);
  if (m === undefined || m.size !== sk.length) {
    m = new Map();
    for (let i = 0; i < sk.length; i++) m.set(sk[i]!.id, i);
    indexCache.set(sk, m);
  }
  const i = m.get(id);
  if (i === undefined || sk[i]!.id !== id) {
    for (let k = 0; k < sk.length; k++) if (sk[k]!.id === id) return k;
    throw new Error(`no skater ${id}`);
  }
  return i;
}

export function planOf(state: GameState, id: string): SkaterPlan {
  return state.plans[indexOf(state, id)]!;
}

/** Once per live tick, before jobs: the committed phase follows the raw one only after it has differed for TUNING.commit.phaseDelay. */
export function updateTeamPhase(state: GameState, carrier: SkaterState | null = carrierOf(state)): void {
  for (const side of SIDES) {
    const t = state.teamPhase[side];
    const raw = rawPhase(state, side, carrier);
    if (raw === t.phase) { t.pending = null; t.pendingTick = 0; continue; }
    if (t.pending !== raw) { t.pending = raw; t.pendingTick = state.tick; }
    if (state.tick - t.pendingTick >= PHASE_DELAY_TICKS) {
      t.phase = raw;
      t.sinceTick = state.tick;
      t.pending = null;
      t.pendingTick = 0;
    }
  }
}

export function committedPhase(state: GameState, side: Side): TeamPhase {
  return state.teamPhase[side].phase;
}

/** Sets a committed phase at once (faceoff drops, period starts). */
export function setTeamPhase(state: GameState): void {
  const carrier = carrierOf(state);
  for (const side of SIDES) {
    const t = state.teamPhase[side];
    t.phase = rawPhase(state, side, carrier);
    t.sinceTick = state.tick;
    t.pending = null;
    t.pendingTick = 0;
  }
}

export type Want = { job: Job; pos: Vec2; face: Vec2 | null; follow: SkaterPlan['follow']; markId: string | null; effort: Effort; slow: SlowMode; through: boolean };

/** Jobs that may sprint on empty legs: the puck is at stake. */
const ALWAYS_SPRINT: ReadonlySet<Job> = new Set<Job>(['chase', 'receive', 'f1']);

/** Task 14: the jobs skated flat out when they sprint (caught offside, he gets back as fast as he can); every other sprint is hard skating (TUNING.effort.sprint). */
const ALL_OUT: ReadonlySet<Job> = new Set<Job>(['tagUp']);

/** speedCap for an effort and energy: TUNING.effort.glide / skate / sprint; a sprint needs energy >= sprintMinEnergy unless the job is chase, receive or f1. */
export function speedFor(effort: Effort, job: Job, energy: number): number {
  if (effort === 'glide') return E.glide;
  if (effort === 'skate') return E.skate;
  if (ALL_OUT.has(job)) return E.allOut;
  return energy >= E.sprintMinEnergy || ALWAYS_SPRINT.has(job) ? E.sprint : E.skate;
}

/** The effort a positional job needs: sprint beyond TUNING.effort.sprintFrom m from the spot, glide within glideWithin, else skate. */
export function effortToReach(distance: number): Effort {
  return distance > E.sprintFrom ? 'sprint' : distance < E.glideWithin ? 'glide' : 'skate';
}

/** Copies `face` into the skater's own faceTarget object (kept, updated in place), or clears it. */
export function setFace(s: GameState['skaters'][number], face: Vec2 | null): void {
  if (face === null) s.faceTarget = null;
  else if (s.faceTarget) { s.faceTarget.x = face.x; s.faceTarget.y = face.y; } else s.faceTarget = { x: face.x, y: face.y };
}

/**
 * Applies the hold rule to skater i and writes his target, faceTarget and speedCap. A `follow: 'spot'` target and the
 * job itself change only (a) on a trigger, named in `trigger`, or (b) when TUNING.commit.holdSeconds have passed since
 * `targetTick` and `want.pos` is more than TUNING.commit.moveEnough from the held target (reason `review`). Returns true when re-issued.
 * A `puck` or `man` job that team play no longer wants of him is also given up on review once the hold has passed.
 * While the job is kept, a `puck` or `man` target follows `want.pos` every tick; his face, effort, slow mode and
 * through follow `want` every tick whatever is held.
 */
export function commitTo(state: GameState, i: number, want: Want, trigger: ReplanReason | null): boolean {
  const plan = state.plans[i]!;
  const s = state.skaters[i]!;
  const tick = state.tick;
  let issue = trigger !== null;
  if (!issue && tick - plan.targetTick >= HOLD_TICKS) {
    // A puck or man he no longer follows holds him to nothing once the hold has passed.
    const dx = want.pos.x - s.target.x, dy = want.pos.y - s.target.y;
    // So does a job that now follows something else (a spot, the puck, a man).
    // (Task 13b: the net-front man keeps to the goalie's eyes: his spot is re-issued once it is moveEnoughNet away.)
    const enough = plan.job === 'netFront' && want.job === 'netFront' ? C.moveEnoughNet : C.moveEnough;
    issue = dx * dx + dy * dy > enough * enough || (plan.follow !== 'spot' && plan.job !== want.job) || plan.follow !== want.follow;
  }
  if (issue) {
    if (plan.job !== want.job) { plan.job = want.job; plan.jobTick = tick; }
    plan.targetTick = tick;
    plan.reason = trigger ?? 'review';
    plan.possession = state.possession;
    plan.follow = want.follow;
    plan.markId = want.markId;
    s.target.x = want.pos.x;
    s.target.y = want.pos.y;
  } else if (plan.follow !== 'spot' && plan.job === want.job) {
    plan.markId = want.markId;
    s.target.x = want.pos.x;
    s.target.y = want.pos.y;
  }
  // What he does on the way follows what is wanted now, for the job he holds.
  if (plan.job === want.job) {
    plan.effort = want.effort;
    plan.slow = want.slow;
    plan.through = want.through;
    setFace(s, want.face);
  }
  s.speedCap = speedFor(plan.effort, plan.job, s.energy);
  return issue;
}

/** True while skater i holds `job` at a spot issued less than TUNING.commit.holdSeconds ago (only a trigger re-issues it). */
export function holding(state: GameState, i: number, job: Job): boolean {
  const plan = state.plans[i]!;
  return plan.job === job && plan.follow === 'spot' && state.tick - plan.targetTick < HOLD_TICKS;
}

/** The trigger that holds for skater i now against his plan, or null. */
export function triggerFor(state: GameState, i: number, wantJob: Job): ReplanReason | null {
  const plan = state.plans[i]!;
  const s = state.skaters[i]!;
  if (plan.job === 'lineUp') return 'whistle';
  if (plan.reason === 'steppedOn' && plan.targetTick === state.tick) return 'steppedOn';
  if (plan.job === 'down') return 'gotUp';
  if (plan.job === 'contest') return 'contestEnd';
  if ((wantJob === 'tagUp') !== (plan.job === 'tagUp')) return 'offside';
  if (state.possession !== plan.possession) return 'possession';
  if (wantJob === 'receive' && plan.job !== 'receive' && state.pendingPass?.toId === s.id) return 'passToMe';
  if (wantJob === 'chase' && plan.job !== 'chase') return 'loosePuckMine';
  if (state.teamPhase[s.side].sinceTick > plan.targetTick) return 'phase';
  // Team play has given him another job (the job lists are unique and respect the hold: jobs.ts).
  if (wantJob !== plan.job) return 'newJob';
  return null;
}

/** True while skater i is inside the hold of the target he was last issued (TUNING.commit.holdSeconds). */
export function inHold(state: GameState, i: number): boolean {
  return state.tick - state.plans[i]!.targetTick < HOLD_TICKS;
}

/**
 * Puts skater i on a job whose target someone else sets (carrier: the brain; contest: the contest; change: the bench;
 * lineUp: the faceoff; down: nobody) at once. With a `reason` that counts as his target being issued now (lineUp,
 * steppedOn); without one, when his target was last issued is left as it was.
 */
export function holdJob(state: GameState, i: number, job: Job, reason: ReplanReason | null, slow: SlowMode = 'coast', through = false): void {
  const plan = state.plans[i]!;
  plan.slow = slow;
  plan.through = through;
  if (plan.job === job && reason === null) return;
  if (plan.job !== job) { plan.job = job; plan.jobTick = state.tick; }
  if (reason !== null) {
    plan.targetTick = state.tick;
    plan.reason = reason;
    plan.possession = state.possession;
  }
  plan.follow = 'spot';
  plan.markId = null;
  plan.effort = 'skate';
}
