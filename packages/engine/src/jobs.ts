/**
 * Which jobs exist in each phase and who gets which. Every free skater of a side gets one job and no two the same
 * (the utility jobs aside); a man keeps his job while he is inside its hold (commit.ts) and is TUNING.jobs.keep nearer
 * its anchor than anyone else after it, so jobs are sticky without being fixed.
 */
import { committedPhase as committedPhase_, indexOf as indexOf_, inHold as inHold_, triggerFor as triggerFor_ } from './commit';
import { jobAnchor as jobAnchor_ } from './job-targets';
import { RINK as RINK_, supportSpot as supportSpot_ } from './rink';
import { DEFAULT_TACTICS } from './tactics';
import { TUNING } from './tuning';
import type { ContestStateOf, GameState, Job, PlayerDef, Side, SkaterState, Tactics } from './types';
import { carrierOf as carrierOf_ } from './util';
import type { Vec2 } from './vec';
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const carrierOf = carrierOf_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const supportSpot = supportSpot_;
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
/**
 * A defenceman joins the rush (`dJoin`) only with this joinRush tendency or more (Task 11: TUNING.tactics.joinRush,
 * lower for a team whose offence is the rush).
 */
const joinRushMin = (t: Tactics): number => ((t.offence ?? DEFAULT_TACTICS.offence) === 'rush' ? TUNING.tactics.joinRush.rush : TUNING.tactics.joinRush.other);
const BLUE = RINK.blueLineX;

/**
 * Pinching (Task 11): with the puck loose in the zone `side` attacks and more than TUNING.tactics.pinchDepth m deeper
 * than him, a defenceman at the point (inside the blue line, or within a metre of it) may go down the wall for it only when it is on his side of the ice, within his team's pinch
 * distance of him (TUNING.tactics.pinch by tactics.pinch) and a teammate with job highForward is above it (nearer the
 * blue line than the puck): otherwise he holds the line and someone else goes. True when `d` may not go.
 * (The Task 11 brief said "above him", the point man. Tried in the review fixes: pinches by a team told to pinch often
 * fell from 3.8 to 2.2 a game on seeds 1-16, and four guards that read one to three games went red, carrier pressed
 * 0.771 against 0.78 among them; kept as it was, for a ruling.)
 */
/** A defenceman of `side` at the point with the puck loose in the zone it attacks: inside the blue line or within 1 m of it. */
function atPoint(state: GameState, side: Side, d: SkaterState): boolean {
  const dir = state.attackDir[side];
  return isDefenceman(d) && state.puck.pos.x * dir > BLUE && d.pos.x * dir > BLUE - 1;
}

function heldAtPoint(state: GameState, side: Side, d: SkaterState, tactics: Tactics): boolean {
  if (!atPoint(state, side, d)) return false;
  const dir = state.attackDir[side], p = state.puck.pos;
  const prx = p.x * dir;
  // A puck no deeper than TUNING.tactics.pinchDepth below him is his to keep in at the line: no pinch.
  if (prx <= d.pos.x * dir + TUNING.tactics.pinchDepth) return false;
  const reach = TUNING.tactics.pinch[tactics.pinch ?? DEFAULT_TACTICS.pinch];
  if (hyp(p.x - d.pos.x, p.y - d.pos.y) > reach || (p.y >= 0) !== (d.pos.y >= 0)) return true;
  for (let k = 0; k < state.skaters.length; k++) {
    const t = state.skaters[k]!;
    if (t !== d && t.onIce && t.side === side && t.downT === 0 && state.plans[k]!.job === 'highForward' && t.pos.x * dir < prx) return false;
  }
  return true;
}

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


/**
 * Where `side`'s nearest free skater should go to support the board battle running now: on his own side of it,
 * TUNING.boardBattle.supportOff m from its spot toward the net his side defends and at least supportBoards m off the
 * boards (rink.ts supportSpot, Task 9: both sides' supporters stood on one spot straight out from the scrum), from where
 * he joins it. Null when no battle runs, `side` has nobody in it, or it
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
  const BB = TUNING.boardBattle;
  return supportSpot(c.spot, -state.attackDir[side] * RINK.goalLineX, BB.supportOff, BB.supportBoards, { x: 0, y: 0 });
}

/**
 * The phase's job list, most important first (before the carrier's own job is taken out). In the zone it attacks the
 * team's offence orders it (Task 11 brief; review fix): a cycle team puts its low support (lowSupport, or the office
 * when the carrier is on the wall) first, a point-shot or rush team the net-front man.
 */
function phaseJobs(state: GameState, side: Side, carrier: SkaterState | null, tactics: Tactics): Job[] {
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
      const cycle = (tactics.offence ?? DEFAULT_TACTICS.offence) === 'cycle';
      if (own !== null && !isDefenceman(own) && own.pos.x * dir > 20) {
        return cycle ? [second, 'highForward', 'netFront', 'pointStrong', 'pointWeak'] : ['highForward', 'netFront', second, 'pointStrong', 'pointWeak'];
      }
      return cycle ? [second, 'netFront', 'highForward', 'pointStrong', 'pointWeak'] : ['netFront', second, 'highForward', 'pointStrong', 'pointWeak'];
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
 * group whose anchor is nearest him, and it is left out (never netFront: someone stays at the net).
 */
export function jobsFor(state: GameState, side: Side, tactics: Tactics): Job[] {
  const carrier = carrierOf(state);
  let freeD = 0, freeF = 0;
  for (const s of state.skaters) if (s.side === side && isFree(state, s, carrier)) { if (isDefenceman(s)) freeD++; else freeF++; }
  return jobsWith(state, side, tactics, carrier, freeD, freeF);
}

function jobsWith(state: GameState, side: Side, tactics: Tactics, carrier: SkaterState | null, freeD: number, freeF: number): Job[] {
  const jobs = phaseJobs(state, side, carrier, tactics);
  if (carrier === null || carrier.side !== side) return jobs;
  const d = isDefenceman(carrier);
  const free = d ? freeD : freeF;
  let mine = 0;
  for (const j of jobs) if (DEFENCE.has(j) === d) mine++;
  if (mine <= free) return jobs;
  let drop = -1, best = Infinity;
  for (let k = 0; k < jobs.length; k++) {
    // (Task 8 fix round: the net-front man is never the one left out; the carrier takes another forward's job.)
    if (DEFENCE.has(jobs[k]!) !== d || jobs[k] === 'netFront') continue;
    const a = jobAnchor(state, side, jobs[k]!, tactics, anchorScratch);
    const dd = hyp(a.x - carrier.pos.x, a.y - carrier.pos.y);
    if (dd < best) { best = dd; drop = k; }
  }
  jobs.splice(drop, 1);
  return jobs;
}

/** The free skater of `side` (from `pool`) nearest `to`, keeping whoever holds `job` now unless another is nearer by more than TUNING.commit.chaserMargin. */
function stickyNearest(state: GameState, pool: number[], job: Job, to: Vec2, bias: number[] | null = null): number {
  let near = -1, nearD = Infinity, cur = -1, curD = Infinity;
  for (const i of pool) {
    const s = state.skaters[i]!;
    const d = hyp(s.pos.x - to.x, s.pos.y - to.y) + (bias === null ? 0 : bias[i] ?? 0);
    if (d < nearD) { nearD = d; near = i; }
    if (state.plans[i]!.job === job && d < curD) { curD = d; cur = i; }
  }
  return cur < 0 || curD > nearD + TUNING.commit.chaserMargin ? near : cur;
}

const poolScratch: number[] = [];
const netScratch: Vec2 = { x: 0, y: 0 };
const chasePool: number[] = [];
const heldPool: number[] = [];
/** Per skater index: the pinch bias (m) on his distance to the loose puck (Task 11). */
const pinchBias: number[] = [];
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
    // The net-front men (the attackers' netFront in the offensive zone, the defenders' dNet in their own) keep their jobs
    // through a loose puck in the zone (Task 8 fix round: a save, a rebound, a block or a bobble must not reshuffle
    // them): the screen, the tip and the rebound are theirs (job-targets.ts sends them to a rebound in front). Someone
    // else chases: while a shot is on its way to a net, the man nearest that net (for the rebound); otherwise the man
    // nearest the puck.
    const phase = committedPhase(state, side);
    const stay: Job | null = phase === 'ozone' ? 'netFront' : phase === 'dzone' ? 'dNet' : null;
    const shot = state.shotInFlight;
    chasePool.length = 0;
    heldPool.length = 0;
    // (A point man who may not pinch is in neither pool: he never goes, Task 11.)
    let eager = false;
    for (const i of pool) {
      pinchBias[i] = 0;
      if (heldAtPoint(state, side, sk[i]!, tactics)) continue;
      // A point man who may pinch goes as if he were TUNING.tactics.pinchEager m nearer (further for a negative one).
      if (atPoint(state, side, sk[i]!)) { pinchBias[i] = -TUNING.tactics.pinchEager[tactics.pinch ?? DEFAULT_TACTICS.pinch]; eager = true; }
      heldPool.push(i);
      if (stay === null || state.plans[i]!.job !== stay) chasePool.push(i);
    }
    const from = chasePool.length > 0 ? chasePool : heldPool;
    let puckMan = -1;
    if (from.length === 0) {
      // Nobody may go for it.
    } else if (shot !== null) {
      netScratch.x = state.attackDir[shot.side] * RINK.goalLineX; netScratch.y = 0;
      puckMan = stickyNearest(state, from, 'chase', netScratch, eager ? pinchBias : null);
    } else puckMan = stickyNearest(state, from, 'chase', state.puck.pos, eager ? pinchBias : null);
    let job: Job | null = puckMan < 0 ? null : 'chase';
    const pass = state.pendingPass;
    if (pass !== null) for (const i of pool) if (sk[i]!.id === pass.toId) { puckMan = i; job = 'receive'; }
    if (job === 'chase' && boardBattle(state) !== null) job = supportTarget(state, side) !== null ? 'battleSupport' : null;
    if (job !== null) out[puckMan] = job;
  }
  let freeD = 0;
  for (const i of pool) if (isDefenceman(sk[i]!)) freeD++;
  const jobs = jobsWith(state, side, tactics, carrier, freeD, pool.length - freeD);
  // Between hand-outs (every ASSIGN_TICKS) everyone keeps a job that is still on the list, unless a trigger says otherwise.
  if (state.tick % ASSIGN_TICKS !== 0 && keepAll(state, side, carrier, pool, jobs, out, tactics)) return out;
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
  // Each job in order to the cheapest man of its group; netFront first when it is on the list (Task 8b: handed out after
  // highForward, the man at the net was sent high whenever the other forward was further from there than he was, and
  // the two swapped: 115 net-front spells a game ended that way while a teammate carried the puck).
  // (Task 11 review fix: a cycle team's list puts its low support first, but the net-front man is still handed out
  // before it: handed out after low support, the man at the net was pulled off it and net-front holds, tips and second
  // chances fell, 0.54 -> 0.42 holds over 2.5 s, 3.5 -> 1.9 tips a game on seeds 1-8. The order counts after him.)
  const nf = jobs.indexOf('netFront');
  for (let kk = nf >= 0 ? -1 : 0; kk < jobs.length; kk++) {
    const k = kk < 0 ? nf : kk;
    if (used[k]) continue;
    const job = jobs[k]!;
    const a = jobAnchor(state, side, job, tactics, anchorScratch);
    let best = -1, bestCost = Infinity;
    for (const i of pool) {
      if (out[i] !== null) continue;
      const s = sk[i]!;
      if (isDefenceman(s) !== DEFENCE.has(job)) continue;
      if (job === 'dJoin' && (defs.get(s.id)?.tendencies.joinRush ?? 0) < joinRushMin(tactics)) continue;
      const held = state.plans[i]!.job;
      // The man at the net stays there: another job costs him keepNet more (the defenders' dNet, and since Task 8's fix
      // round the attackers' netFront).
      // (Task 8b: the attackers' net-front man also keeps his own job by keepNet, not keep: another forward takes it only from keepNet nearer the net.)
      const cost = hyp(s.pos.x - a.x, s.pos.y - a.y) - (held === job ? (job === 'netFront' ? TUNING.jobs.keepNet : TUNING.jobs.keep) : 0) + ((held === 'dNet' || held === 'netFront') && job !== held ? TUNING.jobs.keepNet : 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best >= 0) { out[best] = job; used[k] = true; }
  }
  // The men left over take the next unused job of the phase's list: one of their own group first, then a spare job
  // of their group (a defenceman holds behind the play, a forward trails it), then any.
  let left = false;
  for (const i of pool) if (out[i] === null) left = true;
  if (!left) return out;
  const all = phaseJobs(state, side, carrier, tactics);
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
function keepAll(state: GameState, side: Side, carrier: SkaterState | null, pool: number[], jobs: Job[], out: (Job | null)[], tactics: Tactics): boolean {
  let all: Job[] | null = null;
  for (const i of pool) {
    const held = state.plans[i]!.job;
    if (out[i] !== null) { if (out[i] !== held) return false; }
    else if (jobs.indexOf(held) < 0) {
      // A man left over holds a job off the list: the phase's or a spare one.
      if (pool.length <= jobs.length) return false;
      all ??= phaseJobs(state, side, carrier, tactics);
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
