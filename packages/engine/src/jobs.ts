/**
 * Which jobs exist in each phase and who gets which. Every free skater of a side gets one job and no two the same
 * (the utility jobs aside); a man keeps his job while he is inside its hold (commit.ts) and is TUNING.jobs.keep nearer
 * its anchor than anyone else after it, so jobs are sticky without being fixed.
 */
import { committedPhase as committedPhase_, indexOf as indexOf_, inHold as inHold_, triggerFor as triggerFor_ } from './commit';
import { jobAnchor as jobAnchor_ } from './job-targets';
import { boardsNormal as boardsNormal_, RINK as RINK_ } from './rink';
import { TUNING } from './tuning';
import type { ContestStateOf, GameState, Job, PlayerDef, Side, SkaterState, Tactics } from './types';
import { carrierOf as carrierOf_ } from './util';
import type { Vec2 } from './vec';
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const carrierOf = carrierOf_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const boardsNormal = boardsNormal_;
const RINK = RINK_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const jobAnchor = jobAnchor_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const committedPhase = committedPhase_;
const indexOf = indexOf_;
const inHold = inHold_;
const triggerFor = triggerFor_;

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


export const UTILITY_JOBS: readonly Job[] = ['change', 'lineUp', 'tagUp', 'contest', 'down'];
/** Jobs a forward holds (or a defenceman, only when no forward is free for it). */
export const FORWARD_JOBS: readonly Job[] = [
  'lowSupport', 'netFront', 'highForward', 'office', 'driveWide', 'driveMiddle', 'trailer', 'outlet', 'centreLow', 'stretch',
  'f1', 'f2', 'f3', 'backcheckA', 'backcheckB', 'dzCentre', 'wingStrong', 'wingWeak', 'chase', 'receive', 'battleSupport',
];
/** Jobs a defenceman holds (or a forward, only when no defenceman is free for it). */
export const DEFENCE_JOBS: readonly Job[] = [
  'pointStrong', 'pointWeak', 'dJoin', 'dHold', 'dHoldWeak', 'dPartner', 'dLineStrong', 'dLineWeak', 'dGapStrong', 'dGapWeak', 'dCorner', 'dNet',
];
const DEFENCE: ReadonlySet<Job> = new Set(DEFENCE_JOBS);
/** Jobs handed out to one man by the loose puck before the phase's jobs: chase, receive, battleSupport. */
const PUCK_JOBS: ReadonlySet<Job> = new Set<Job>(['chase', 'receive', 'battleSupport']);
/** A defenceman joins the rush (`dJoin`) only with this joinRush tendency or more. */
const JOIN_RUSH_MIN = 0.6;
/** A supporting player waits this far (m) off the boards, on the ice side of a board battle. */
const SUPPORT_OFF_BOARDS = 2;

const isDefenceman = (s: SkaterState): boolean => s.slot === 'LD' || s.slot === 'RD';

/** True when `s` is in a contest that steers him (he is not one of its `freeIds`). */
function steered(state: GameState, s: SkaterState): boolean {
  if (s.contestId === null) return false;
  for (const c of state.contests) if (c.id === s.contestId) return !c.freeIds.includes(s.id);
  return true;
}

/** Can be given a job by team play now: on the ice, not heading off, not down, not steered by a contest, not the carrier. */
export function isFree(state: GameState, s: SkaterState, carrier: SkaterState | null = carrierOf(state)): boolean {
  return s.onIce && !s.leaving && s.downT === 0 && s !== carrier && !steered(state, s);
}

/**
 * The board battle running now (contest kind `boardBattle`, before its `resolve`), or null. Its `roles.supportA` and
 * `roles.supportB` are each side's supporting player (null for none yet).
 */
export function boardBattle(state: GameState): ContestStateOf<'boardBattle'> | null {
  for (const c of state.contests) if (c.kind === 'boardBattle' && c.stage !== 'resolve' && c.stage !== 'protect') return c;
  return null;
}

const normalScratch: Vec2 = { x: 0, y: 0 };

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

/** The phase's job list, most important first (before the carrier's own job is taken out). */
function phaseJobs(state: GameState, side: Side, carrier: SkaterState | null): Job[] {
  const dir = state.attackDir[side];
  const own = carrier !== null && carrier.side === side ? carrier : null;
  switch (committedPhase(state, side)) {
    case 'ozone': {
      let second: Job = 'lowSupport';
      if (own !== null && own.pos.x * dir < RINK.goalLineX && Math.abs(own.pos.y) > 6) {
        let behind = false;
        for (const o of state.skaters) if (o.onIce && o.side !== side && o.pos.x * dir > RINK.goalLineX) behind = true;
        if (!behind) second = 'office';
      }
      if (own !== null && !isDefenceman(own) && own.pos.x * dir > 20) return ['highForward', 'netFront', second, 'pointStrong', 'pointWeak'];
      return ['netFront', second, 'highForward', 'pointStrong', 'pointWeak'];
    }
    case 'rush': return ['driveWide', 'driveMiddle', 'trailer', 'dJoin', 'dHold', 'dHoldWeak'];
    case 'breakout': return ['outlet', 'centreLow', 'stretch', 'dPartner'];
    case 'forecheck': return carrier === null ? ['f2', 'f3', 'dLineStrong', 'dLineWeak'] : ['f1', 'f2', 'f3', 'dLineStrong', 'dLineWeak'];
    case 'dzone': return ['dCorner', 'dNet', 'dzCentre', 'wingStrong', 'wingWeak'];
    default: return carrier === null ? ['dGapStrong', 'dGapWeak', 'backcheckA', 'backcheckB'] : ['f1', 'dGapStrong', 'dGapWeak', 'backcheckA', 'backcheckB'];
  }
}

const anchorScratch: Vec2 = { x: 0, y: 0 };
/** Spare jobs for a man left over when his group's jobs are all held. */
const SPARE_D: readonly Job[] = ['dHold', 'dHoldWeak'];
const SPARE_F: readonly Job[] = ['trailer', 'backcheckA', 'backcheckB'];

/**
 * The jobs to hand out to `side`'s free skaters now, most important first (never `carrier`, never a utility job).
 * With the puck loose the first forechecker's job is left out (the loose-puck chaser is the first man). When `side`
 * has the puck and his group (forwards or defencemen) has more jobs than free men, the carrier does the job of his
 * group whose anchor is nearest him, and it is left out.
 */
export function jobsFor(state: GameState, side: Side, tactics: Tactics): Job[] {
  const carrier = carrierOf(state);
  let freeD = 0, freeF = 0;
  for (const s of state.skaters) if (s.side === side && isFree(state, s, carrier)) { if (isDefenceman(s)) freeD++; else freeF++; }
  return jobsWith(state, side, tactics, carrier, freeD, freeF);
}

function jobsWith(state: GameState, side: Side, tactics: Tactics, carrier: SkaterState | null, freeD: number, freeF: number): Job[] {
  const jobs = phaseJobs(state, side, carrier);
  if (carrier === null || carrier.side !== side) return jobs;
  const d = isDefenceman(carrier);
  const free = d ? freeD : freeF;
  let mine = 0;
  for (const j of jobs) if (DEFENCE.has(j) === d) mine++;
  if (mine <= free) return jobs;
  let drop = -1, best = Infinity;
  for (let k = 0; k < jobs.length; k++) {
    if (DEFENCE.has(jobs[k]!) !== d) continue;
    const a = jobAnchor(state, side, jobs[k]!, tactics, anchorScratch);
    const dd = hyp(a.x - carrier.pos.x, a.y - carrier.pos.y);
    if (dd < best) { best = dd; drop = k; }
  }
  jobs.splice(drop, 1);
  return jobs;
}

/** The free skater of `side` (from `pool`) nearest `to`, keeping whoever holds `job` now unless another is nearer by more than TUNING.commit.chaserMargin. */
function stickyNearest(state: GameState, pool: number[], job: Job, to: Vec2): number {
  let near = -1, nearD = Infinity, cur = -1, curD = Infinity;
  for (const i of pool) {
    const s = state.skaters[i]!;
    const d = hyp(s.pos.x - to.x, s.pos.y - to.y);
    if (d < nearD) { nearD = d; near = i; }
    if (state.plans[i]!.job === job && d < curD) { curD = d; cur = i; }
  }
  return cur < 0 || curD > nearD + TUNING.commit.chaserMargin ? near : cur;
}

const poolScratch: number[] = [];
const netScratch: Vec2 = { x: 0, y: 0 };
const shotPool: number[] = [];
/** Jobs are handed out afresh every ASSIGN_TICKS ticks (0.2 s), and at once on a trigger or a change of the list. */
const ASSIGN_TICKS = 6;
const outHome: (Job | null)[] = [];
const outAway: (Job | null)[] = [];
/** The indices each side's array was last written at (cleared on the next call). */
const setHome: number[] = [];
const setAway: number[] = [];

/**
 * Gives every free skater of `side` one job, no two the same. For each job in jobsFor order: the free, unassigned skater of the
 * right group with the lowest cost, cost = distance to the job's anchor, less TUNING.jobs.keep (3 m) if he holds that job now.
 * A forward takes a defence job (and the reverse) only when nobody of the right group is free. Skaters left over take the next
 * unused job of the phase's list. Returns the job per skater index (null for skaters not assigned here); the array is
 * reused for the side: read it before the next call for that side.
 *
 * Before that: under a delayed offside against `side` every free man tags up; with the puck loose, the side's man
 * nearest it chases it (sticky by TUNING.commit.chaserMargin), a pass's receiver receives it instead, and while a board
 * battle holds the puck the would-be chaser supports it (or takes a phase job once his side has its supporter). A man
 * inside his hold with no trigger keeps the job he holds if it is still on the list (commit.ts: a job only changes on
 * a trigger or once the hold has passed).
 */
export function assignTeamJobs(state: GameState, side: Side, defs: Map<string, PlayerDef>, tactics: Tactics): (Job | null)[] {
  const sk = state.skaters;
  const out = side === 'home' ? outHome : outAway;
  if (out.length !== sk.length) { out.length = sk.length; out.fill(null); }
  else for (const i of side === 'home' ? setHome : setAway) out[i] = null;
  const set = side === 'home' ? setHome : setAway;
  set.length = 0;
  const carrier = carrierOf(state);
  const pool = poolScratch;
  pool.length = 0;
  for (const id of state.onIce[side]) {
    const i = indexOf(state, id);
    if (isFree(state, sk[i]!, carrier)) { pool.push(i); set.push(i); }
  }
  if (pool.length === 0) return out;
  if (state.delayedOffside?.side === side) {
    for (const i of pool) out[i] = 'tagUp';
    return out;
  }
  if (carrier === null) {
    // A shot on its way to a net (Task 8): the man of each side nearest that net goes there for the rebound (the puck's
    // own way); otherwise the man nearest the puck chases it.
    // The net-front men (the attackers' netFront, the defenders' dNet) stay on their spots: a screen, a tip, a man marked.
    const shot = state.shotInFlight;
    let puckMan: number;
    if (shot !== null) {
      netScratch.x = state.attackDir[shot.side] * RINK.goalLineX; netScratch.y = 0;
      const stay: Job = shot.side === side ? 'netFront' : 'dNet';
      shotPool.length = 0;
      for (const i of pool) if (state.plans[i]!.job !== stay) shotPool.push(i);
      puckMan = stickyNearest(state, shotPool.length > 0 ? shotPool : pool, 'chase', netScratch);
    } else puckMan = stickyNearest(state, pool, 'chase', state.puck.pos);
    // A rebound loose in front (Task 8): the attackers' net-front man and the defenders' net defenceman go for it.
    const ls = state.lastSave;
    if (ls !== null && ls.kind === 'rebound') {
      const want: Job = ls.side === side ? 'dNet' : 'netFront';
      for (const i of pool) if (state.plans[i]!.job === want) puckMan = i;
    }
    let job: Job | null = 'chase';
    const pass = state.pendingPass;
    if (pass !== null) for (const i of pool) if (sk[i]!.id === pass.toId) { puckMan = i; job = 'receive'; }
    if (job === 'chase' && boardBattle(state) !== null) job = supportTarget(state, side) !== null ? 'battleSupport' : null;
    if (job !== null) out[puckMan] = job;
  }
  let freeD = 0;
  for (const i of pool) if (isDefenceman(sk[i]!)) freeD++;
  const jobs = jobsWith(state, side, tactics, carrier, freeD, pool.length - freeD);
  // Between hand-outs (every ASSIGN_TICKS) everyone keeps a job that is still on the list, unless a trigger says otherwise.
  if (state.tick % ASSIGN_TICKS !== 0 && keepAll(state, side, carrier, pool, jobs, out)) return out;
  const used = new Array<boolean>(jobs.length).fill(false);
  // Inside his hold, with nothing to re-plan for, a man keeps the job he holds.
  for (const i of pool) {
    if (out[i] !== null) continue;
    const held = state.plans[i]!.job;
    const k = jobs.indexOf(held);
    if (k < 0 || used[k] || !inHold(state, i) || triggerFor(state, i, held) !== null) continue;
    used[k] = true;
    out[i] = held;
  }
  // Each job in order to the cheapest man of its group.
  for (let k = 0; k < jobs.length; k++) {
    if (used[k]) continue;
    const job = jobs[k]!;
    const a = jobAnchor(state, side, job, tactics, anchorScratch);
    let best = -1, bestCost = Infinity;
    for (const i of pool) {
      if (out[i] !== null) continue;
      const s = sk[i]!;
      if (isDefenceman(s) !== DEFENCE.has(job)) continue;
      if (job === 'dJoin' && (defs.get(s.id)?.tendencies.joinRush ?? 0) < JOIN_RUSH_MIN) continue;
      const held = state.plans[i]!.job;
      // The man at the net stays there: another job costs him keepNet more.
      const cost = hyp(s.pos.x - a.x, s.pos.y - a.y) - (held === job ? TUNING.jobs.keep : 0) + (held === 'dNet' && job !== 'dNet' ? TUNING.jobs.keepNet : 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best >= 0) { out[best] = job; used[k] = true; }
  }
  // The men left over take the next unused job of the phase's list: one of their own group first, then a spare job
  // of their group (a defenceman holds behind the play, a forward trails it), then any.
  let left = false;
  for (const i of pool) if (out[i] === null) left = true;
  if (!left) return out;
  const all = phaseJobs(state, side, carrier);
  for (const i of pool) {
    if (out[i] !== null) continue;
    const d = isDefenceman(sk[i]!);
    let pick: Job | null = null;
    for (const j of all) if (pick === null && DEFENCE.has(j) === d && j !== 'dJoin' && !taken(out, pool, j)) pick = j;
    for (const j of d ? SPARE_D : SPARE_F) if (pick === null && !taken(out, pool, j)) pick = j;
    for (const j of all) if (pick === null && j !== 'dJoin' && !taken(out, pool, j)) pick = j;
    out[i] = pick ?? (d ? 'dHold' : 'trailer');
  }
  return out;
}

/**
 * Between hand-outs: when every man of `pool` not given a puck job holds a different job of `jobs` (or, left over, a
 * job of the phase or a spare one), the puck jobs'
 * men hold theirs already, and no trigger applies to anyone, writes their held jobs into `out` and returns true.
 */
function keepAll(state: GameState, side: Side, carrier: SkaterState | null, pool: number[], jobs: Job[], out: (Job | null)[]): boolean {
  let all: Job[] | null = null;
  for (const i of pool) {
    const held = state.plans[i]!.job;
    if (out[i] !== null) { if (out[i] !== held) return false; }
    else if (jobs.indexOf(held) < 0) {
      // A man left over holds a job off the list: the phase's or a spare one.
      if (pool.length <= jobs.length) return false;
      all ??= phaseJobs(state, side, carrier);
      if (all.indexOf(held) < 0 && SPARE_D.indexOf(held) < 0 && SPARE_F.indexOf(held) < 0) return false;
    }
    if (triggerFor(state, i, held) !== null) return false;
    for (const k of pool) { if (k === i) break; if (state.plans[k]!.job === held) return false; }
  }
  for (const i of pool) out[i] = state.plans[i]!.job;
  return true;
}

/** True when one of `pool` has been given `j`. */
function taken(out: (Job | null)[], pool: number[], j: Job): boolean {
  for (const i of pool) if (out[i] === j) return true;
  return false;
}

/** True for the jobs the loose puck hands out (chase, receive, battleSupport). */
export const isPuckJob = (job: Job): boolean => PUCK_JOBS.has(job);
