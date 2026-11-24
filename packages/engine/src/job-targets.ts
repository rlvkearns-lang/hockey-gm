/**
 * Where each job wants its skater (jobWant), and the moving parts the jobs share: getting open for a pass (openSpot),
 * covering a man (coverSpot) and taking a passing lane away (shadowSpot).
 *
 * Positions in the comments are attack-relative for the skater's own side, `(rx, ly)`: rx toward the net his side
 * attacks (goal line 27.13, blue line 7.62), ly to his left; `ps` is the puck's side (`ly >= 0 ? 1 : -1`). A defending
 * job's spots therefore have negative rx (his own net is at rx -27.13).
 */
import { composite as composite_ } from './attributes';
import { DT } from './constants';
import { dangerMan as dangerMan_, laneOpen as laneOpen_, passLaneWidth as passLaneWidth_, spaceAt as spaceAt_ } from './lanes';
import { clipToNets as clipToNets_, RINK as RINK_, resolveBoards as resolveBoards_, resolveNets as resolveNets_ } from './rink';
import { TUNING } from './tuning';
import { BLADE } from './blade';
import { dcos as dcos_, dsin as dsin_ } from './dmath';
import { ICE_DECAY as PUCK_DECAY } from './puck';
import type { GameState, Job, PlayerDef, Side, SkaterState, Tactics } from './types';
import type { Want } from './commit';
import { indexOf as indexOf_ } from './commit';
import { carrierOf as carrierOf_, clamp as clamp_ } from './util';
import type { Vec2 } from './vec';
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const composite = composite_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const carrierOf = carrierOf_;
const clamp = clamp_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const indexOf = indexOf_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const clipToNets = clipToNets_;
const RINK = RINK_;
const resolveBoards = resolveBoards_;
const resolveNets = resolveNets_;
// Local bindings of hot imports: a call through an imported binding costs more under the test runner's module wrapper.
const dangerMan = dangerMan_;
const laneOpen = laneOpen_;
const passLaneWidth = passLaneWidth_;
const spaceAt = spaceAt_;
const dcos = dcos_;
const dsin = dsin_;

// Local copies of vec.ts helpers (hot loops: a call across modules costs more under the test runner's module wrapper).
const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);
/** A pass aimed within POINT_RECEIVE (m) of the blue line is taken at the point: his target stays POINT_HOLD (m) inside the line. */
const POINT_RECEIVE = 4.5;
const POINT_HOLD = 0.8;
const distV = (a: Vec2, b: Vec2): number => hyp(a.x - b.x, a.y - b.y);
function segD(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return hyp(px - (ax + abx * t), py - (ay + aby * t));
}


const GOAL = RINK.goalLineX;
const BLUE = RINK.blueLineX;
const CV = TUNING.cover;
const LN = TUNING.lanes;
const JB = TUNING.jobs;

/** Attackers without the puck wait this far (m) outside the offensive blue line until the puck is in. */
const ONSIDE_MARGIN = 1;
/** The nearest defender plays this far (m) goal-side of the carrier he pressures. */
const PRESS_GAP = 1.2;
/** Containing a carrier above the faceoff dots of his own zone: this far (m) goal-side of him. */
const CONTAIN_GAP = 2.5;
/** In his own zone, a carrier below this rx (defender's frame: deeper than the dots) is pressured, above it contained. */
const CONTAIN_ABOVE = -19;
/** A containing defender leans this much (PRESS_LANE's scale) toward the carrier's lane to his most dangerous teammate: goal-side first. */
const CONTAIN_LANE = 0.5;
/** A containing defender leads the carrier by this long (s). */
const CONTAIN_LEAD = 0.3;
/** Drivers go to the net once the puck is this far (m) inside the blue line; the trailer follows it in from TRAIL_IN. */
const DRIVE_IN = 3;
/** Until then they wait this far (m) outside the line. */
const DRIVE_WAIT = 2;
const TRAIL_IN = 10;
/** How far a presser leans from goal-side toward the carrier's lane to his most dangerous teammate (1: half way). */
const PRESS_LANE = 1.2;
/** A chaser leads a moving puck by at most this many seconds. */
const MAX_LEAD_SECONDS = 1.2;
/** Speed (m/s) used to estimate how long a chaser needs to reach the puck. */
const CHASE_SPEED = 8;
/** A chaser whose straight line to the puck passes within this far (m) of a net frame goes round the frame's corner. */
const NET_ROUTE_MARGIN = 0.7;
/** Candidate spots are kept this far (m) inside the boards and this far clear of the net frames. */
const SPOT_BOARDS_MARGIN = 1;
const SPOT_NET_MARGIN = 0.6;
/** Lane width (m) beyond which a wider lane is worth no more to a man getting open. */
const LANE_CAP = 3;
/** The net-front man stands this far (m) out from the net (the top of the crease) on its line to the puck: the screen. */
const NET_FRONT_OUT = 2.8;
/** A net-front defender looks for an attacker within this far (m) of the net front. */
const NET_FRONT_RANGE = 4;
/** A man within this far (m) of the goal line, or behind it, is not the net-front defender's. */
const NET_FRONT_BEHIND = 0.5;
/** The net-front defender leads his man by this long (s). */
const NET_FRONT_LEAD = 0.5;
/** Where the net-front defender tries to stand: (m along the line from his man to the net, m beside it), in turn, until one is this far (m) from his goalie. */
const NET_FRONT_TRIES: readonly (readonly [number, number])[] = [[1.0, 0], [0.9, 0.4], [0.9, -0.4]];
const NET_FRONT_GOALIE = 1.0;
/** The centre covers the low man in his own zone when he is within this far (m) of the slot. */
const LOW_MAN_RANGE = 6;
/** A covering job faces the play (and may skate backward) within this far (m) of his man. */
const FACE_MAN_RANGE = 4;
/** Behind his own net a carrier is chased round it after this long (s) there (at once under defence 'pressure', Task 11). */
const BEHIND_CHASE_SECONDS = 1.5;
/** Behind the net: rx beyond this (the back of the frame and a little). */
const BEHIND_RX = 27.43;
/** The office is behind the goal line: its spots stay beyond this rx. */
const OFFICE_MIN_RX = GOAL + 0.5;
/** A point man slides along the line within this far (m) of his anchor. */
const POINT_SLIDE = 4;
/** How well a defenceman reads a rush (sets his gap in the neutral zone). */
const READS = { defensivePositioning: 0.7, iq: 0.3 };

/** The jobs that face the play and so may skate backward; every other job skates forward. */
const FACING: ReadonlySet<Job> = new Set<Job>(['dGapStrong', 'dGapWeak', 'dLineStrong', 'dLineWeak', 'dNet', 'pointStrong', 'pointWeak', 'office', 'netFront']);
/** Jobs that keep a man (stickyMark): the covering jobs and the weak-side gap defenceman. */
const MARKING: ReadonlySet<Job> = new Set<Job>(['backcheckA', 'backcheckB', 'wingStrong', 'wingWeak', 'dzCentre', 'dGapWeak']);
/** A defender takes the danger lane from within this far (m) of it, at this share of the way from the carrier to the danger man. */
const LANE_TAKE_RANGE = 12;
const LANE_TAKE_FROM = 0.35;
const LANE_TAKE_TO = 0.85;
/**
 * The defending jobs whose man may take the danger lane (laneTaker): all but those that go at the puck or its carrier
 * (f1, dCorner) and the net-front defender, who keeps inside position.
 */
/** Own-zone jobs whose man may be the one who has the carrier (carrierTaker): all but dNet. */
const CARRIER_TAKERS: ReadonlySet<Job> = new Set<Job>(['dCorner', 'dzCentre', 'wingStrong', 'wingWeak']);
/** The man who has the carrier keeps him unless another is this much (m) nearer. */
const TAKE_KEEP = 2;
const LANE_TAKERS: ReadonlySet<Job> = new Set<Job>(['f2', 'f3', 'dLineStrong', 'dLineWeak', 'backcheckA', 'backcheckB', 'dGapStrong', 'dGapWeak', 'dzCentre', 'wingStrong', 'wingWeak']);
/** Jobs that cover a man. */
const COVER_JOBS: ReadonlySet<Job> = new Set<Job>(['backcheckA', 'backcheckB', 'wingStrong', 'wingWeak', 'dzCentre']);

const TT = TUNING.tactics;
const pointIn = (t: Tactics): number => (t.offence === 'pointShots' ? TT.pointIn : 0);
const pressing = (t: Tactics): boolean => t.defence === 'pressure';
/** The two own-zone jobs that both go at a carrier below the dots under defence 'pressure' (Task 11). */
const PRESSERS: ReadonlySet<Job> = new Set<Job>(['dCorner', 'dzCentre']);
/** The own-zone jobs; under defence 'collapse' they hold in front of the goal line (rx -HOLD_FRONT) against a carrier behind the net. */
const OWN_ZONE: ReadonlySet<Job> = new Set<Job>(['dCorner', 'dNet', 'dzCentre', 'wingStrong', 'wingWeak']);
const HOLD_FRONT = 26.6;

/** The view of the play from `side`: its attack direction, the puck's rx and ly, the puck's side, and the carrier. */
type Frame = { dir: 1 | -1; pr: number; pl: number; ps: 1 | -1; carrier: SkaterState | null };
const frameScratch: Frame = { dir: 1, pr: 0, pl: 0, ps: 1, carrier: null };
function frameOf(state: GameState, side: Side, f: Frame = frameScratch): Frame {
  const dir = state.attackDir[side];
  f.dir = dir;
  f.pr = state.puck.pos.x * dir;
  f.pl = state.puck.pos.y * dir;
  f.ps = f.pl >= 0 ? 1 : -1;
  f.carrier = curCarrier(state);
  return f;
}

function setRel(out: Vec2, rx: number, ly: number, dir: 1 | -1): Vec2 {
  // `+ 0` turns -0 into 0 (JSON would drop the sign).
  out.x = rx * dir + 0;
  out.y = ly * dir + 0;
  return out;
}

const otherSide = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const isD = (s: SkaterState): boolean => s.slot === 'LD' || s.slot === 'RD';
const standing = (s: SkaterState): boolean => s.onIce && s.downT === 0;

// ---- marks: which opponent each covering job looks after (derived from the state alone) ----

/**
 * While team play hands out jobs (between beginMarks and endMarks) each side's marks are worked out once: a derived
 * cache, rebuilt on every assignJobs call and never read outside it.
 */
type Marks = { ct: SkaterState | null; ctOk: boolean; lt: SkaterState | null; ltOk: boolean; dm: SkaterState | null; dmOk: boolean; ok: boolean; nf: SkaterState | null; nfOk: boolean; pm: (SkaterState | null)[]; pmOk: boolean; low: SkaterState | null; lowOk: boolean;
  ww: SkaterState | null; wwOk: boolean; back: (SkaterState | null)[]; backOk: boolean };
const blankMarks = (): Marks => ({ ct: null, ctOk: false, lt: null, ltOk: false, dm: null, dmOk: false, ok: false, nf: null, nfOk: false, pm: [null, null], pmOk: false, low: null, lowOk: false, ww: null, wwOk: false, back: [null, null], backOk: false });
const marks: Record<Side, Marks> = { home: blankMarks(), away: blankMarks() };
let caching = false;
let passCarrier: SkaterState | null = null;
/** The carrier (the pass's own while team play hands out jobs). */
const curCarrier = (state: GameState): SkaterState | null => (caching ? passCarrier : carrierOf(state));

/** Starts a pass of team play over `state`: marks are cached until endMarks. */
export function beginMarks(carrier: SkaterState | null): void {
  caching = true;
  passCarrier = carrier;
  for (const m of [marks.home, marks.away]) { m.nfOk = m.pmOk = m.lowOk = m.wwOk = m.backOk = m.dmOk = m.ltOk = m.ctOk = false; }
}
export function endMarks(): void {
  caching = false;
  passJobs.home = passJobs.away = null;
}

/** The jobs team play is handing out in this pass, per side and skater index (null outside a pass: plans are read). */
const passJobs: Record<Side, readonly (Job | null)[] | null> = { home: null, away: null };
/** Tells the pass which jobs `side`'s skaters are being given (jobs.ts assignTeamJobs' result). */
export function setPassJobs(side: Side, jobs: readonly (Job | null)[]): void {
  passJobs[side] = jobs;
}
/** Skater k's job in this pass (or his plan's job outside one). */
const jobNow = (state: GameState, side: Side, k: number): Job | null => {
  const pj = caching ? passJobs[side] : null;
  return pj !== null ? pj[k] ?? null : state.plans[k]!.job;
};

/** The opponent of `side` nearest the front of `side`'s own net, within NET_FRONT_RANGE of it and in front of the goal line; null if none. */
export function netFrontMark(state: GameState, side: Side): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.nfOk) return mk.nf;
  const r = netFrontMarkNow(state, side);
  if (caching) { mk.nf = r; mk.nfOk = true; }
  return r;
}
function netFrontMarkNow(state: GameState, side: Side): SkaterState | null {
  const fx = -state.attackDir[side] * (GOAL - NET_FRONT_OUT);
  let best: SkaterState | null = null, bestD = NET_FRONT_RANGE;
  for (const o of state.skaters) {
    // In front of the net: a man behind the goal line is the corner defenceman's.
    if (!standing(o) || o.side === side || o.pos.x * -state.attackDir[side] > GOAL - NET_FRONT_BEHIND) continue;
    const d = hyp(o.pos.x - fx, o.pos.y);
    if (d <= bestD) { bestD = d; best = o; }
  }
  return best;
}

const pointScratch: (SkaterState | null)[] = [null, null];

/**
 * The opposing point men as `side` sees them: [strong, weak], strong on the puck's side. They are the opposing
 * defencemen; a missing one is replaced by the opponent (not already a point man) furthest from `side`'s net.
 * The array is reused: read it before the next call.
 */
export function pointMen(state: GameState, side: Side): (SkaterState | null)[] {
  const mk = marks[side];
  if (caching && mk.pmOk) return mk.pm;
  const r = pointMenNow(state, side);
  if (caching) { mk.pm[0] = r[0]!; mk.pm[1] = r[1]!; mk.pmOk = true; return mk.pm; }
  return r;
}
function pointMenNow(state: GameState, side: Side): (SkaterState | null)[] {
  const f = frameOf(state, side);
  let a: SkaterState | null = null, b: SkaterState | null = null;
  for (const o of state.skaters) {
    if (!standing(o) || o.side === side || !isD(o)) continue;
    if (a === null) a = o; else if (b === null) b = o;
  }
  for (let k = 0; k < 2 && (a === null || b === null); k++) {
    let far: SkaterState | null = null;
    for (const o of state.skaters) {
      if (!standing(o) || o.side === side || o === a || o === b) continue;
      if (far === null || o.pos.x * f.dir > far.pos.x * f.dir) far = o;
    }
    if (a === null) a = far; else if (b === null) b = far;
  }
  const la = a ? a.pos.y * f.dir * f.ps : -Infinity, lb = b ? b.pos.y * f.dir * f.ps : -Infinity;
  pointScratch[0] = la >= lb ? a : b;
  pointScratch[1] = la >= lb ? b : a;
  return pointScratch;
}

/** The opponent `side`'s centre covers in its own zone: not the carrier, the net-front man or a point man; nearest the slot. */
export function lowMan(state: GameState, side: Side): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.lowOk) return mk.low;
  const r = lowManNow(state, side);
  if (caching) { mk.low = r; mk.lowOk = true; }
  return r;
}
function lowManNow(state: GameState, side: Side): SkaterState | null {
  const f = frameOf(state, side);
  const nf = netFrontMark(state, side);
  const pm = pointMen(state, side);
  const p0 = pm[0], p1 = pm[1];
  const sx = -20 * f.dir;
  let best: SkaterState | null = null, bestD = Infinity;
  for (const o of state.skaters) {
    if (!standing(o) || o.side === side || o === f.carrier || o === nf || o === p0 || o === p1) continue;
    const d = hyp(o.pos.x - sx, o.pos.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/** The widest opponent on the weak side (away from the puck) without the puck, for the weak-side gap defenceman; null if none is there. */
export function widestWeak(state: GameState, side: Side): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.wwOk) return mk.ww;
  const r = widestWeakNow(state, side);
  if (caching) { mk.ww = r; mk.wwOk = true; }
  return r;
}
function widestWeakNow(state: GameState, side: Side): SkaterState | null {
  const f = frameOf(state, side);
  let best: SkaterState | null = null, bestW = 1;
  for (const o of state.skaters) {
    if (!standing(o) || o.side === side || o === f.carrier) continue;
    const w = -o.pos.y * f.dir * f.ps;
    if (w > bestW) { bestW = w; best = o; }
  }
  return best;
}

/** The back-checkers' men: the opponents without the puck (not the weak-side gap defenceman's), nearest `side`'s net first. `k` 0 or 1. */
export function backMan(state: GameState, side: Side, k: 0 | 1): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.backOk) return mk.back[k]!;
  const f = frameOf(state, side);
  const ww = widestWeak(state, side);
  let first: SkaterState | null = null, second: SkaterState | null = null;
  for (const o of state.skaters) {
    if (!standing(o) || o.side === side || o === f.carrier || o === ww) continue;
    const rx = o.pos.x * f.dir;
    if (first === null || rx < first.pos.x * f.dir) { second = first; first = o; }
    else if (second === null || rx < second.pos.x * f.dir) second = o;
  }
  if (caching) { mk.back[0] = first; mk.back[1] = second; mk.backOk = true; }
  return k === 0 ? first : second;
}

/** The skater of `side` with the puck, or null. */
function ownCarrier(state: GameState, side: Side): SkaterState | null {
  const c = curCarrier(state);
  return c !== null && c.side === side ? c : null;
}
/** The opponent of `side` with the puck, or null. */
function oppCarrier(state: GameState, side: Side): SkaterState | null {
  const c = curCarrier(state);
  return c !== null && c.side !== side ? c : null;
}

// ---- anchors ----

/** `m`'s position, or (rx, ly) with no man. */
function manPos(out: Vec2, dir: 1 | -1, m: SkaterState | null, rx: number, ly: number): Vec2 {
  if (m === null) return setRel(out, rx, ly, dir);
  out.x = m.pos.x;
  out.y = m.pos.y;
  return out;
}

/** The net-front man's spot for `side`: on the line from the net centre to the puck, NET_FRONT_OUT from the net. */
export function netFrontSpot(state: GameState, side: Side, out: Vec2): Vec2 {
  const f = frameOf(state, side);
  if (f.pr > GOAL - 1.5) return setRel(out, GOAL - NET_FRONT_OUT, f.ps * 0.4, f.dir);
  const dx = f.pr - GOAL, dy = f.pl;
  const l = hyp(dx, dy) || 1;
  return setRel(out, GOAL + (dx / l) * NET_FRONT_OUT, (dy / l) * NET_FRONT_OUT, f.dir);
}

/** A defender's gap (m) on the carrier through the neutral zone: 6 + (100 - reads) * 0.05 + approach * 0.6. */
function gapOf(state: GameState, d: PlayerDef | undefined, dir: 1 | -1): number {
  const reads = d ? composite(d.attrs, READS) : 70;
  const approach = Math.max(0, -state.puck.vel.x * dir);
  return 6 + (100 - reads) * 0.05 + approach * 0.6;
}

/**
 * Where job `job` of `side` is anchored now (absolute coordinates, written into `out`): the spot the job is built round,
 * or for a job that covers or pressures a man, that man's position. Used to hand jobs out by distance (jobs.ts).
 */
export function jobAnchor(state: GameState, side: Side, job: Job, tactics: Tactics, out: Vec2): Vec2 {
  const f = frameOf(state, side);
  const { dir, pr, pl, ps } = f;
  const own = ownCarrier(state, side), opp = oppCarrier(state, side);
  const ball = own ?? opp;
  const crx = ball ? ball.pos.x * dir : pr;
  switch (job) {
    case 'netFront': return netFrontSpot(state, side, out);
    case 'lowSupport': return setRel(out, clamp(crx < 21 ? crx + 7 : crx - 7, BLUE + 1, 25.5), ps * 11, dir);
    case 'office': return setRel(out, 28.3, -ps * 1.2, dir);
    case 'highForward': return setRel(out, 16, ps * 2, dir);
    // (Task 11: a team that shoots from the point holds its point men TUNING.tactics.pointIn m further in.)
    case 'pointStrong': return setRel(out, 9.1 + pointIn(tactics), ps * 8.5, dir);
    case 'pointWeak': return setRel(out, 9.1 + pointIn(tactics), -ps * 4, dir);
    case 'driveWide': return pr > BLUE + DRIVE_IN ? setRel(out, GOAL - 1, -ps * 1.6, dir) : setRel(out, Math.min(pr + 2, BLUE - DRIVE_WAIT), -ps * 8, dir);
    case 'driveMiddle': return pr > BLUE + DRIVE_IN ? setRel(out, GOAL - 2.3, 0, dir) : setRel(out, Math.min(pr + 1, BLUE - DRIVE_WAIT), ps * 1, dir);
    // The trailer stays outside the line until the play is well in.
    case 'trailer': return setRel(out, pr < BLUE + TRAIL_IN ? Math.min(pr - 7, BLUE - ONSIDE_MARGIN) : pr - 7, ps * 3, dir);
    case 'dJoin': return setRel(out, Math.max(-24, pr - 9), -ps * 7, dir);
    case 'dHold': return setRel(out, Math.max(-24, pr - 14), ps * 4, dir);
    case 'dHoldWeak': return setRel(out, Math.max(-24, pr - 14), -ps * 4, dir);
    case 'outlet': return setRel(out, -14, ps * 11, dir);
    case 'centreLow': return setRel(out, -19, ps * 3, dir);
    case 'stretch': return setRel(out, -2, -ps * 9, dir);
    case 'dPartner': return setRel(out, -25, -ps * 4, dir);
    case 'f1': return manPos(out, dir, opp, pr, pl);
    case 'f2': {
      if (tactics.forecheck === 'passive') return setRel(out, 3, ps * 8, dir);
      return manPos(out, dir, opp, pr, pl);
    }
    case 'f3': return setRel(out, Math.min(tactics.forecheck === 'passive' ? -2 : 13, pr - 4), pl * 0.3, dir);
    case 'dLineStrong': case 'dLineWeak': {
      const s = job === 'dLineStrong' ? ps : -ps;
      const fc = tactics.forecheck;
      return fc === 'aggressive' ? setRel(out, 9.1, s * 7, dir) : fc === 'balanced' ? setRel(out, 7, s * 7, dir) : setRel(out, -3, s * 4, dir);
    }
    case 'dGapStrong': return setRel(out, Math.max(-24, crx - 7), ball ? ball.pos.y * dir : pl, dir);
    case 'dGapWeak': {
      const w = widestWeak(state, side);
      return setRel(out, Math.max(-24, crx - 7), w ? w.pos.y * dir * 0.8 : -ps * 4, dir);
    }
    case 'backcheckA': return manPos(out, dir, backMan(state, side, 0), Math.max(-22, pr - 5), -ps * 3);
    case 'backcheckB': return manPos(out, dir, backMan(state, side, 1), Math.max(-22, pr - 5), ps * 3);
    case 'dCorner': return opp && opp.pos.x * dir < -19 ? manPos(out, dir, opp, 0, 0) : setRel(out, -23.5, ps * 5, dir);
    case 'dNet': return manPos(out, dir, netFrontMark(state, side), -25.1, -ps * 0.8);
    case 'dzCentre': return manPos(out, dir, lowMan(state, side), -20, ps * 1.5);
    case 'wingStrong': return manPos(out, dir, pointMen(state, side)[0]!, -11, ps * 8);
    case 'wingWeak': return manPos(out, dir, pointMen(state, side)[1]!, -11, -ps * 8);
    default: {
      // chase, receive, battleSupport and the utility jobs: the puck.
      out.x = state.puck.pos.x;
      out.y = state.puck.pos.y;
      return out;
    }
  }
}

// ---- moving parts ----

const candScratch: Vec2 = { x: 0, y: 0 };
const zeroVel: Vec2 = { x: 0, y: 0 };
const fromScratch: Vec2 = { x: 0, y: 0 };

/** Where a pass to `s` comes from: his side's carrier, else the puck. Writes and returns `out`. */
function passFrom(state: GameState, s: SkaterState, out: Vec2): Vec2 {
  const c = ownCarrier(state, s.side);
  const p = c ? c.pos : state.puck.pos;
  out.x = p.x;
  out.y = p.y;
  return out;
}

/** Keeps a candidate spot for `side` inside the boards, clear of the nets and onside (attackers wait outside the line until the puck is in). */
function legalSpot(state: GameState, side: Side, p: Vec2): void {
  zeroVel.x = 0; zeroVel.y = 0;
  resolveBoards(p, zeroVel, SPOT_BOARDS_MARGIN, 0);
  resolveNets(p, zeroVel, SPOT_NET_MARGIN);
  const dir = state.attackDir[side];
  if (state.puck.pos.x * dir < BLUE && p.x * dir > BLUE - ONSIDE_MARGIN) p.x = (BLUE - ONSIDE_MARGIN) * dir;
}

/** How good a spot is for a pass from `from`: the lane's width (worth nothing past LANE_CAP), then the room round it. */
function spotScore(state: GameState, side: Side, from: Vec2, p: Vec2): number {
  const w = Math.min(LANE_CAP, passLaneWidth(state, side, from, p));
  const sp = spaceAt(state, side, p);
  return w + (sp >= LN.space ? LN.space : sp - LN.space * 2) * 0.5;
}

const COS45 = Math.SQRT1_2;
const RING: readonly (readonly [number, number])[] = [[1, 0], [COS45, COS45], [0, 1], [-COS45, COS45], [-1, 0], [-COS45, -COS45], [0, -1], [COS45, -COS45]];

/**
 * Get open: the best of the anchor and 8 spots at `radius` round it for a pass from the carrier: widest laneWidth, at least
 * TUNING.lanes.space from any opponent, inside the boards, onside. He keeps his held spot while laneOpen holds for it; when it
 * stops holding (he is covered, or a defender's shadow is on the lane) the hold rule's `review` moves him.
 */
export function openSpot(state: GameState, s: SkaterState, anchor: Vec2, radius: number, out: Vec2, minRx = -Infinity): Vec2 {
  const from = passFrom(state, s, fromScratch);
  const c = candScratch;
  let bx = anchor.x, by = anchor.y, best = -Infinity;
  for (let k = -1; k < RING.length; k++) {
    if (k < 0) { c.x = anchor.x; c.y = anchor.y; } else { c.x = anchor.x + RING[k]![0] * radius; c.y = anchor.y + RING[k]![1] * radius; }
    legalSpot(state, s.side, c);
    if (k >= 0 && c.x * state.attackDir[s.side] < minRx) continue;
    const v = spotScore(state, s.side, from, c);
    if (v > best + 1e-9) { best = v; bx = c.x; by = c.y; }
  }
  out.x = bx;
  out.y = by;
  return out;
}

/** The point of segment a-b nearest p, written into `out`. */
function nearestOnSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number, out: Vec2): Vec2 {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  out.x = ax + dx * t;
  out.y = ay + dy * t;
  return out;
}

const laneScratch: Vec2 = { x: 0, y: 0 };

/**
 * Cover a man ("man, you, puck"): `gap` m off `mark` on the puck's side of him, toward the carrier (the puck with no
 * carrier), shaded goal-side by TUNING.cover.goalShade so his stick is in the lane and he is still between his man and
 * the net. A man who has the puck himself is played goal-side.
 */
export function coverSpot(state: GameState, s: SkaterState, mark: SkaterState, gap: number, out: Vec2): Vec2 {
  const nx = -state.attackDir[s.side] * GOAL;
  let vx = nx - mark.pos.x, vy = -mark.pos.y;
  const vl = hyp(vx, vy) || 1;
  vx /= vl; vy /= vl;
  const c = curCarrier(state);
  let dx = vx, dy = vy;
  if (c !== mark) {
    const from = c !== null && c.side === mark.side ? c.pos : state.puck.pos;
    const ux = from.x - mark.pos.x, uy = from.y - mark.pos.y, ul = hyp(ux, uy);
    if (ul > 1e-6) { dx = ux / ul + vx * CV.goalShade; dy = uy / ul + vy * CV.goalShade; }
    const g = Math.min(gap, ul * 0.6);
    const l = hyp(dx, dy) || 1;
    out.x = mark.pos.x + (dx / l) * g;
    out.y = mark.pos.y + (dy / l) * g;
    return out;
  }
  const g = Math.min(gap, vl * 0.5);
  out.x = mark.pos.x + dx * g;
  out.y = mark.pos.y + dy * g;
  return out;
}

/** How far off his man a covering defender plays: TUNING.cover.gapNear near the net, looser (up to gapFar) for a man far from it. */
function coverGap(state: GameState, s: SkaterState, mark: SkaterState): number {
  const nx = -state.attackDir[s.side] * GOAL;
  const d = hyp(mark.pos.x - nx, mark.pos.y);
  return clamp(CV.gapNear + (d - CV.gapFrom) * CV.gapPerMetre, CV.gapNear, CV.gapFar);
}

/**
 * The man `s` covers for a covering job whose rule names `rule`: the man he covers now, while that man is still free to
 * cover (on the ice, standing, not covered by a teammate nearer him) and not more than TUNING.cover.keepMan m further from him
 * than `rule`; else `rule`. A man followed is not swapped for another every time positions shift.
 */
function stickyMark(state: GameState, s: SkaterState, rule: SkaterState | null): SkaterState | null {
  const plan = state.plans[indexOf(state, s.id)]!;
  if (plan.follow !== 'man' || plan.markId === null || !(MARKING.has(plan.job) || plan.job === 'dNet') || (rule !== null && rule.id === plan.markId)) return rule;
  const c = curCarrier(state);
  let old: SkaterState | null = null;
  for (const o of state.skaters) if (o.id === plan.markId) old = o;
  if (old === null || !standing(old) || old.side === s.side || (old === c && rule !== c)) return rule;
  // Two on one man: the nearer of them keeps him.
  const mine = distV(s.pos, old.pos);
  for (let k = 0; k < state.skaters.length; k++) {
    const t = state.skaters[k]!;
    if (t === s || !t.onIce || t.side !== s.side) continue;
    const tp = state.plans[k]!;
    if (tp.follow === 'man' && tp.markId === old.id && MARKING.has(tp.job)) {
      const theirs = distV(t.pos, old.pos);
      if (theirs < mine || (theirs === mine && t.id < s.id)) return rule;
    }
  }
  if (rule !== null && distV(s.pos, old.pos) > distV(s.pos, rule.pos) + CV.keepMan) return rule;
  return old;
}

/**
 * Take a lane away: the point of the carrier's lane to `dangerMan` nearest `s`, when that is within TUNING.cover.shadowReach (3 m)
 * of his cover spot (`from`, by default his target); null otherwise (or with no opposing carrier or danger man).
 */
export function shadowSpot(state: GameState, s: SkaterState, out: Vec2, from: Vec2 = s.target): Vec2 | null {
  const c = oppCarrier(state, s.side);
  if (c === null) return null;
  let m: SkaterState | null;
  const mk = marks[s.side];
  if (caching && mk.dmOk) m = mk.dm;
  else { m = dangerMan(state, c); if (caching) { mk.dm = m; mk.dmOk = true; } }
  if (m === null) return null;
  const q = nearestOnSeg(s.pos.x, s.pos.y, c.pos.x, c.pos.y, m.pos.x, m.pos.y, laneScratch);
  if (hyp(q.x - from.x, q.y - from.y) > CV.shadowReach) return null;
  out.x = q.x;
  out.y = q.y;
  return out;
}

/** Goal-side pressure: PRESS_GAP m from `man` toward the net `s` defends. Writes the spot into `out`. */
function pressSpot(state: GameState, s: SkaterState, man: SkaterState, gap: number, out: Vec2, lean = PRESS_LANE): Vec2 {
  const netX = -state.attackDir[s.side] * GOAL;
  let dx = netX - man.pos.x, dy = -man.pos.y;
  let l = hyp(dx, dy) || 1;
  dx /= l; dy /= l;
  // With the puck, goal-side and leaning into the lane to his most dangerous teammate: pressure that takes the pass away too.
  if (state.carrierId === man.id) {
    let m: SkaterState | null;
    const mk = marks[s.side];
    if (caching && mk.dmOk) m = mk.dm;
    else { m = dangerMan(state, man); if (caching) { mk.dm = m; mk.dmOk = true; } }
    if (m !== null) {
      const ex = m.pos.x - man.pos.x, ey = m.pos.y - man.pos.y, el = hyp(ex, ey) || 1;
      dx += (ex / el) * lean; dy += (ey / el) * lean;
      l = hyp(dx, dy) || 1;
      dx /= l; dy /= l;
    }
  }
  out.x = man.pos.x + dx * gap;
  out.y = man.pos.y + dy * gap;
  return out;
}

const routeProbe: Vec2 = { x: 0, y: 0 };

/**
 * Where to skate for a loose puck (written into `out`): where it will be, leading it by the time it takes to get
 * there. With a net in the way he heads for the corner of the frame on his side and the puck's end of it first.
 */
/**
 * Whether a rebound (state.lastSave of kind 'rebound') is loose within REBOUND_RANGE (m) of the net `side` attacks
 * (`attacking`) or defends.
 */
function reboundInFront(state: GameState, side: Side, attacking: boolean): boolean {
  const ls = state.lastSave;
  if (ls === null || ls.kind !== 'rebound' || state.carrierId !== null) return false;
  if ((ls.side === side) === attacking) return false;
  const nx = (attacking ? state.attackDir[side] : -state.attackDir[side]) * GOAL;
  return hyp(state.puck.pos.x - nx, state.puck.pos.y) <= REBOUND_RANGE;
}
const REBOUND_RANGE = TUNING.jobs.reboundRange;

function chaseSpot(state: GameState, s: SkaterState, out: Vec2): void {
  const p = state.puck;
  const t = Math.min(MAX_LEAD_SECONDS, distV(s.pos, p.pos) / CHASE_SPEED);
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

/**
 * Where a pass's receiver goes (Task 6): onto the puck's actual path (the point of its slide nearest his blade, which
 * is the pass's aim when it is on target and he is where it was aimed), with his centre placed so that his blade is there as he faces the puck. A point reception (aimed
 * within POINT_RECEIVE of the blue line, the puck in the zone) never targets a spot nearer the line than POINT_HOLD (m):
 * he stays between the puck and the line. Writes `out`.
 */
function receiveSpot(state: GameState, s: SkaterState, shoots: 'L' | 'R', out: Vec2): void {
  const pass = state.pendingPass!;
  const P = state.puck.pos, vel = state.puck.vel;
  const dir = state.attackDir[s.side];
  const v = hyp(vel.x, vel.y);
  let mx = pass.aim.x, my = pass.aim.y, fx: number, fy: number;
  if (v >= 1) {
    const ux = vel.x / v, uy = vel.y / v;
    // The point of its slide nearest his blade now (the shortest way onto its path).
    const hb = shoots === 'L' ? BLADE.side : -BLADE.side, c = dcos(s.facing), sn = dsin(s.facing);
    const bx = s.pos.x + BLADE.forward * c - hb * sn, by = s.pos.y + BLADE.forward * sn + hb * c;
    const t = clamp((bx - P.x) * ux + (by - P.y) * uy, 0, v / PUCK_DECAY);
    mx = P.x + ux * t;
    my = P.y + uy * t;
    fx = -ux; fy = -uy;
  } else {
    const dx = P.x - s.pos.x, dy = P.y - s.pos.y, l = hyp(dx, dy) || 1;
    mx = P.x; my = P.y; fx = dx / l; fy = dy / l;
  }
  // Facing the puck (fx, fy), his blade is BLADE.forward ahead and BLADE.side to his shooting side (his left is (-fy, fx)).
  const h = shoots === 'L' ? BLADE.side : -BLADE.side;
  out.x = mx - BLADE.forward * fx + h * fy;
  out.y = my - BLADE.forward * fy - h * fx;
  if (P.x * dir > BLUE && pass.aim.x * dir < BLUE + POINT_RECEIVE && out.x * dir < BLUE + POINT_HOLD) out.x = (BLUE + POINT_HOLD) * dir;
}

const anchorScratch: Vec2 = { x: 0, y: 0 };
const spotScratch: Vec2 = { x: 0, y: 0 };
const BEHIND_TICKS = Math.round(BEHIND_CHASE_SECONDS / DT);

/**
 * Get open round `anchor`: his held spot while he holds `job`, it is still near the anchor and its lane is open; else
 * openSpot (spots below `minRx` left out: the office stays behind the net).
 */
function getOpen(state: GameState, s: SkaterState, job: Job, anchor: Vec2, radius: number, out: Vec2, minRx = -Infinity): void {
  const plan = state.plans[indexOf(state, s.id)]!;
  const t = s.target;
  if (plan.job === job && hyp(t.x - anchor.x, t.y - anchor.y) <= radius + 0.5 && laneOpen(state, s.side, passFrom(state, s, fromScratch), t)) {
    out.x = t.x;
    out.y = t.y;
    return;
  }
  openSpot(state, s, anchor, radius, out, minRx);
}

/** A point man's spot: slides along the line within POINT_SLIDE of `anchor` to the widest lane from the carrier. */
function pointSpot(state: GameState, s: SkaterState, job: Job, anchor: Vec2, out: Vec2): void {
  const plan = state.plans[indexOf(state, s.id)]!;
  const from = passFrom(state, s, fromScratch);
  const t = s.target;
  if (plan.job === job && Math.abs(t.x - anchor.x) < 0.5 && Math.abs(t.y - anchor.y) <= POINT_SLIDE + 0.1 && laneOpen(state, s.side, from, t)) {
    out.x = t.x;
    out.y = t.y;
    return;
  }
  const c = candScratch;
  let best = -Infinity;
  out.x = anchor.x;
  out.y = anchor.y;
  for (let k = 0; k < 5; k++) {
    const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * (k < 3 ? POINT_SLIDE / 2 : POINT_SLIDE);
    c.x = anchor.x;
    c.y = clamp(anchor.y + off, -RINK.halfWidth + 1.5, RINK.halfWidth - 1.5);
    const v = spotScore(state, s.side, from, c) - Math.abs(off) * 0.05;
    if (v > best) { best = v; out.x = c.x; out.y = c.y; }
  }
}

/** Fills `out` for a covering job on `mark` (null: hold `fallback`), with the lane shadow where it is within reach. */
/** The carrier's most dangerous teammate as `side` (defending) sees it, cached per pass. */
function dangerFor(state: GameState, side: Side, c: SkaterState): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.dmOk) return mk.dm;
  const m = dangerMan(state, c);
  if (caching) { mk.dm = m; mk.dmOk = true; }
  return m;
}

/**
 * The lane taker of `side`: of its defenders in a LANE_TAKERS job, the one nearest the lane from the
 * opposing carrier to his most dangerous teammate, within LANE_TAKE_RANGE (m) of it. Null with no opposing carrier,
 * no danger man or nobody near. Cached per pass.
 */
function laneTaker(state: GameState, side: Side): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.ltOk) return mk.lt;
  let best: SkaterState | null = null;
  const c = curCarrier(state);
  const m = c !== null && c.side !== side ? dangerFor(state, side, c) : null;
  if (c !== null && m !== null) {
    let bestD = LANE_TAKE_RANGE;
    for (let k = 0; k < state.skaters.length; k++) {
      const t = state.skaters[k]!;
      const j = jobNow(state, side, k);
      if (!standing(t) || t.side !== side || t.leaving || t.contestId !== null || j === null || !LANE_TAKERS.has(j)) continue;
      // The man who has the carrier stays on him.
      if (t === carrierTaker(state, side)) continue;
      const d = segD(t.pos.x, t.pos.y, c.pos.x, c.pos.y, m.pos.x, m.pos.y);
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  if (caching) { mk.lt = best; mk.ltOk = true; }
  return best;
}

/**
 * The man of `side` who has the opposing carrier in its own zone: of its defenders in a CARRIER_TAKERS job (every
 * own-zone job but dNet, who keeps the net front), the one nearest the carrier; the man who has him now keeps him
 * unless another is TAKE_KEEP (m) nearer. Exactly one, so someone always has the carrier. Null with no opposing
 * carrier or nobody in such a job. Cached per pass.
 */
export function carrierTaker(state: GameState, side: Side): SkaterState | null {
  const mk = marks[side];
  if (caching && mk.ctOk) return mk.ct;
  let best: SkaterState | null = null;
  const c = curCarrier(state);
  if (c !== null && c.side !== side) {
    let bestD = Infinity, cur: SkaterState | null = null, curD = Infinity;
    for (let k = 0; k < state.skaters.length; k++) {
      const t = state.skaters[k]!;
      const tp = state.plans[k]!;
      const j = jobNow(state, side, k);
      if (!standing(t) || t.side !== side || t.leaving || t.contestId !== null || j === null || !CARRIER_TAKERS.has(j)) continue;
      const d = hyp(t.pos.x - c.pos.x, t.pos.y - c.pos.y);
      if (d < bestD) { bestD = d; best = t; }
      if (tp.follow === 'man' && tp.markId === c.id && d < curD) { curD = d; cur = t; }
    }
    if (cur !== null && curD <= bestD + TAKE_KEEP) best = cur;
  }
  if (caching) { mk.ct = best; mk.ctOk = true; }
  return best;
}

/**
 * Under defence 'pressure' (Task 11): with the carrier below the dots, the one of the dCorner and dzCentre men who is
 * not the man who has him (the nearer to him, if neither is) goes at him as well: TUNING.tactics.pressure.second m from
 * him toward the slot, or behind the net round the other side of it from the man who has him. Returns false otherwise.
 */
function secondPresser(state: GameState, s: SkaterState, out: Want): boolean {
  const taker = carrierTaker(state, s.side);
  if (taker === null || taker === s) return false;
  const c = curCarrier(state);
  if (c === null || c.side === s.side) return false;
  const dir = state.attackDir[s.side];
  const crx = c.pos.x * dir;
  if (crx >= CONTAIN_ABOVE) return false;
  // The one of the corner man and the centre (not the man who has him) nearest the carrier.
  let near: SkaterState | null = null, nd = Infinity;
  for (let k = 0; k < state.skaters.length; k++) {
    const t = state.skaters[k]!;
    const j = jobNow(state, s.side, k);
    if (t === taker || !standing(t) || t.side !== s.side || j === null || !PRESSERS.has(j)) continue;
    const d = hyp(t.pos.x - c.pos.x, t.pos.y - c.pos.y);
    if (d < nd) { nd = d; near = t; }
  }
  if (near !== s) return false;
  if (crx < -GOAL) {
    // Behind the net: round the other side of it from the man who has him, to close him in.
    const side = taker.pos.y >= c.pos.y ? -1 : 1;
    out.pos.x = c.pos.x;
    out.pos.y = c.pos.y + side * TT.pressure.second;
  } else {
    setRel(spotScratch, -20, 0, dir);
    const dx = spotScratch.x - c.pos.x, dy = spotScratch.y - c.pos.y, l = hyp(dx, dy) || 1;
    out.pos.x = c.pos.x + (dx / l) * TT.pressure.second;
    out.pos.y = c.pos.y + (dy / l) * TT.pressure.second;
  }
  out.face = null;
  out.slow = 'coast';
  out.follow = 'man';
  out.markId = c.id;
  out.through = true;
  out.effort = 'sprint';
  return true;
}

/**
 * Has the carrier (`s` is carrierTaker): below the dots, or wherever the carrier is shielding the puck (his plan is
 * protect), he pressures him (PRESS_GAP goal-side, skating through him); above them he contains him (CONTAIN_GAP
 * goal-side). Behind the net he waits at the near post until he has waited BEHIND_CHASE_SECONDS (Task 11, defence
 * 'collapse'; before it, also until he was within 3 m of the carrier), or under defence 'pressure' goes at once.
 * Returns false when `s` is not the taker.
 */
function takeCarrier(state: GameState, s: SkaterState, out: Want, tactics: Tactics): boolean {
  if (carrierTaker(state, s.side) !== s) return false;
  const c = curCarrier(state)!;
  const dir = state.attackDir[s.side];
  const crx = c.pos.x * dir;
  const p = out.pos;
  out.face = null;
  out.slow = 'coast';
  // (Task 11: a team that pressures the puck goes behind the net at once.)
  if (crx < -BEHIND_RX && !pressing(tactics)) {
    const plan = state.plans[indexOf(state, s.id)]!;
    // He has waited once his post spot (a held spot, no man) is BEHIND_TICKS old.
    const waited = plan.follow === 'spot' && plan.markId === null && state.tick - plan.targetTick > BEHIND_TICKS;
    // (Task 11: a collapsing team holds the post for the whole wait, however near he comes; before, he went at once
    // from within 3 m.)
    if (!waited) {
      setRel(p, -26.6, (c.pos.y * dir >= 0 ? 1 : -1) * 1.3, dir);
      out.follow = 'spot';
      out.markId = null;
      out.through = false;
      out.effort = 'sprint';
      return true;
    }
  }
  // A carrier who is shielding the puck (his plan is protect) is pressured wherever he is: containing him at a stick's
  // length and more, nobody ever engaged him (Task 9 close-out: 15 s along the boards with a winger shadowing at 2.5 m).
  const shielding = state.carrierPlan !== null && state.carrierPlan.id === c.id && state.carrierPlan.kind === 'protect';
  const deep = crx < CONTAIN_ABOVE || shielding;
  pressSpot(state, s, c, deep ? PRESS_GAP : CONTAIN_GAP, p, deep ? PRESS_LANE : CONTAIN_LANE);
  // Containing, he plays where the carrier is going (CONTAIN_LEAD s ahead), not where he was.
  if (!deep) { p.x += c.vel.x * CONTAIN_LEAD; p.y += c.vel.y * CONTAIN_LEAD; }
  out.follow = 'man';
  out.markId = c.id;
  out.through = deep;
  out.effort = 'sprint';
  return true;
}

/** Takes the lane: the point of the carrier's lane to his danger man nearest `s`, kept between LANE_TAKE_FROM and LANE_TAKE_TO of the way along it. */
function takeLane(state: GameState, s: SkaterState, out: Vec2): boolean {
  if (laneTaker(state, s.side) !== s) return false;
  const c = curCarrier(state)!;
  const m = dangerFor(state, s.side, c)!;
  const dx = m.pos.x - c.pos.x, dy = m.pos.y - c.pos.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : clamp(((s.pos.x - c.pos.x) * dx + (s.pos.y - c.pos.y) * dy) / l2, LANE_TAKE_FROM, LANE_TAKE_TO);
  out.x = c.pos.x + dx * t;
  out.y = c.pos.y + dy * t;
  return true;
}

function cover(state: GameState, s: SkaterState, rule: SkaterState | null, job: Job, tactics: Tactics, out: Want, shadow: boolean, gap?: number): void {
  const mark = stickyMark(state, s, rule);
  if (mark === null) {
    const fallback = jobAnchor(state, s.side, job, tactics, anchorScratch);
    out.pos.x = fallback.x;
    out.pos.y = fallback.y;
    if (shadow && shadowSpot(state, s, spotScratch, fallback) !== null) { out.pos.x = spotScratch.x; out.pos.y = spotScratch.y; out.follow = 'puck'; }
    return;
  }
  coverSpot(state, s, mark, gap ?? coverGap(state, s, mark), out.pos);
  if (shadow && shadowSpot(state, s, spotScratch, out.pos) !== null) { out.pos.x = spotScratch.x; out.pos.y = spotScratch.y; }
  out.follow = 'man';
  out.markId = mark.id;
  if (distV(s.pos, mark.pos) <= FACE_MAN_RANGE) out.face = state.puck.pos;
}

/**
 * What job `job` wants of `s` now, written into `out` (and returned): the spot, what he faces, whether he follows a
 * spot, the puck or a man, and how he skates there (effort, slow mode, through). Effort here is the job's own need;
 * team play adds the blue line's needs (keepLegal) and the effort by distance for held spots.
 */
export function jobWant(state: GameState, s: SkaterState, job: Job, defs: Map<string, PlayerDef>, tactics: Tactics, out: Want): Want {
  jobWantOwn(state, s, job, defs, tactics, out);
  // In his own zone the defender nearest the carrier has him, whatever his job (someone always has the carrier).
  if (CARRIER_TAKERS.has(job) && takeCarrier(state, s, out, tactics)) return out;
  // Defence 'pressure' (Task 11): the other of the corner man and the centre goes at a carrier below the dots too.
  if (pressing(tactics) && PRESSERS.has(job) && secondPresser(state, s, out)) return out;
  // The defender nearest the most dangerous pass takes that lane first, whatever his job; the others play theirs.
  if (LANE_TAKERS.has(job) && takeLane(state, s, out.pos)) {
    if (out.follow === 'spot') out.follow = 'puck';
    // A lane is taken now or not at all: he gets there flat out.
    if (distV(s.pos, out.pos) > 1) out.effort = 'sprint';
  }
  // Defence 'collapse' (Task 11): with their carrier behind the net, the own-zone men hold the front of it: nobody goes
  // behind the goal line after him, a man back there or a lane (the man who has him waits at the post, takeCarrier).
  if (!pressing(tactics) && OWN_ZONE.has(job)) {
    const c = curCarrier(state);
    const dir = state.attackDir[s.side];
    if (c !== null && c.side !== s.side && c.pos.x * dir < -BEHIND_RX && out.pos.x * dir < -HOLD_FRONT) out.pos.x = -HOLD_FRONT * dir;
  }
  return out;
}

function jobWantOwn(state: GameState, s: SkaterState, job: Job, defs: Map<string, PlayerDef>, tactics: Tactics, out: Want): Want {
  const f = frameOf(state, s.side);
  const { dir, pr, ps } = f;
  const p = out.pos;
  out.job = job;
  out.face = FACING.has(job) ? state.puck.pos : null;
  out.follow = 'spot';
  out.markId = null;
  out.effort = 'skate';
  out.slow = 'coast';
  out.through = false;
  const a = NO_ANCHOR.has(job) ? anchorScratch : jobAnchor(state, s.side, job, tactics, anchorScratch);
  const opp = oppCarrier(state, s.side);
  switch (job) {
    case 'receive':
      if (state.pendingPass !== null && state.pendingPass.toId === s.id) {
        receiveSpot(state, s, defs.get(s.id)?.shoots ?? 'L', p);
        out.follow = 'puck';
        // He gets there and stops on the spot (a man skating through it takes his blade off the puck's path).
        out.through = false;
        out.slow = 'stop';
        out.effort = 'sprint';
        // He opens up to the pass: square to the puck, his blade on its path.
        out.face = state.puck.pos;
        return out;
      }
      chaseSpot(state, s, p);
      out.follow = 'puck';
      out.through = true;
      out.effort = 'sprint';
      return out;
    case 'chase':
      chaseSpot(state, s, p);
      out.follow = 'puck';
      out.through = true;
      out.effort = 'sprint';
      return out;
    case 'battleSupport':
      p.x = a.x; p.y = a.y; // set by team play (supportTarget)
      out.face = state.puck.pos;
      out.effort = 'sprint';
      return out;
    case 'tagUp':
      setRel(p, BLUE - 2, s.pos.y * dir, dir);
      out.effort = 'sprint';
      return out;
    case 'lowSupport': case 'highForward': case 'outlet': case 'stretch': case 'dPartner':
      getOpen(state, s, job, a, JB.openRadius, p);
      return out;
    case 'office':
      getOpen(state, s, job, a, JB.officeRadius, p, OFFICE_MIN_RX);
      setRel(spotScratch, 20, 0, dir);
      out.face = spotScratch;
      return out;
    case 'trailer':
      if (laneOpen(state, s.side, passFrom(state, s, fromScratch), a)) { p.x = a.x; p.y = a.y; } else openSpot(state, s, a, JB.openRadius, p);
      out.follow = 'puck';
      return out;
    case 'pointStrong': case 'pointWeak':
      pointSpot(state, s, job, a, p);
      return out;
    case 'netFront':
      // A rebound loose in front of the net he attacks (Task 8): he goes for it.
      if (reboundInFront(state, s.side, true)) { chaseSpot(state, s, p); out.follow = 'puck'; out.through = true; out.effort = 'sprint'; out.face = null; return out; }
      p.x = a.x; p.y = a.y;
      return out;
    case 'driveWide': case 'driveMiddle':
      p.x = a.x; p.y = a.y;
      // Up with the play, not ahead of it: flat out only once the puck is in.
      if (pr <= BLUE + DRIVE_IN) out.follow = 'puck';
      else { out.through = true; out.effort = 'sprint'; }
      return out;
    case 'dJoin': case 'dHold': case 'dHoldWeak':
      p.x = a.x; p.y = a.y;
      out.follow = 'puck';
      return out;
    case 'centreLow': {
      // Down to the low spot and through it; once he has turned up ice, up the middle.
      const rx = s.pos.x * dir, vrx = s.vel.x * dir;
      if (vrx > 1.5 && rx > -22 && rx < -8) setRel(p, Math.min(rx + 10, -4), ps * 1, dir);
      else { p.x = a.x; p.y = a.y; out.through = true; }
      return out;
    }
    case 'dCorner':
      // The man who has the carrier is chosen by carrierTaker (jobWant); a corner defenceman who is not him holds the
      // strong-side corner.
      setRel(p, -23.5, ps * 5, dir);
      return out;
    case 'f1': {
      if (opp === null) { p.x = state.puck.pos.x; p.y = state.puck.pos.y; out.follow = 'puck'; out.effort = 'sprint'; return out; }
      // A passive forecheck (Task 11, the trap): he holds at the top of the circles, on the carrier's line, until the
      // carrier comes up to it.
      if (tactics.forecheck === 'passive' && opp.pos.x * dir > TT.passiveF1.hold) {
        setRel(p, TT.passiveF1.hold, clamp(opp.pos.y * dir, -TT.passiveF1.holdLy, TT.passiveF1.holdLy), dir);
        out.face = state.puck.pos;
        return out;
      }
      pressSpot(state, s, opp, PRESS_GAP, p);
      out.follow = 'man';
      out.markId = opp.id;
      out.through = true;
      out.effort = 'sprint';
      return out;
    }
    case 'f2': {
      const fc = tactics.forecheck;
      if (fc === 'passive' || opp === null) { if (opp === null) setRel(p, pr - 3, ps * 7, dir); else { p.x = a.x; p.y = a.y; } return out; }
      if (fc === 'aggressive') {
        const side = opp.pos.y >= 0 ? 1 : -1;
        p.x = opp.pos.x; p.y = opp.pos.y + side * 3;
      } else {
        // The lane from the carrier to his teammate furthest out on the wall on the puck's side.
        let w: SkaterState | null = null, wv = -Infinity;
        for (const o of state.skaters) {
          if (!standing(o) || o.side === s.side || o === opp) continue;
          const v = o.pos.y * dir * ps;
          if (v > wv) { wv = v; w = o; }
        }
        if (w !== null) { p.x = opp.pos.x + (w.pos.x - opp.pos.x) * 0.4; p.y = opp.pos.y + (w.pos.y - opp.pos.y) * 0.4; }
        else { p.x = opp.pos.x; p.y = opp.pos.y + (opp.pos.y >= 0 ? 1 : -1) * 3; }
      }
      out.follow = 'man';
      out.markId = opp.id;
      return out;
    }
    case 'f3': case 'dLineStrong': case 'dLineWeak':
      p.x = a.x; p.y = a.y;
      return out;
    case 'dGapStrong': case 'dGapWeak': {
      const ball = opp;
      const gap = gapOf(state, defs.get(s.id), dir);
      const crx = ball ? ball.pos.x * dir : pr;
      // Once the carrier is inside the blue line the gap closes to a contain (CONTAIN_GAP goal-side).
      const rx = Math.max(-24, crx - (crx < -BLUE ? Math.min(gap, CONTAIN_GAP) : gap));
      if (job === 'dGapStrong') {
        setRel(p, rx, (ball ? ball.pos.y * dir : f.pl) * 0.85, dir);
        if (ball) { out.follow = 'man'; out.markId = ball.id; } else out.follow = 'puck';
      } else {
        const w = stickyMark(state, s, widestWeak(state, s.side));
        setRel(p, rx, w ? w.pos.y * dir * 0.8 : -ps * 4, dir);
        if (w) { out.follow = 'man'; out.markId = w.id; } else out.follow = 'puck';
      }
      return out;
    }
    case 'backcheckA': case 'backcheckB': {
      const m = backMan(state, s.side, job === 'backcheckA' ? 0 : 1);
      cover(state, s, m, job, tactics, out, false);
      if (m === null) out.follow = 'puck';
      return out;
    }
    case 'dNet': {
      // A rebound loose in front of his own net (Task 8): he goes for it.
      if (reboundInFront(state, s.side, false)) { chaseSpot(state, s, p); out.follow = 'puck'; out.through = true; out.effort = 'sprint'; out.face = null; return out; }
      // His man stays his while he is still in front (within NET_FRONT_RANGE of it), unless another is much nearer the net.
      const rule = netFrontMark(state, s.side);
      const kept = stickyMark(state, s, rule);
      const m = kept !== null && kept !== rule && hyp(kept.pos.x + dir * (GOAL - NET_FRONT_OUT), kept.pos.y) > NET_FRONT_RANGE ? rule : kept;
      if (m === null) { jobAnchor(state, s.side, job, tactics, p); return out; }
      // Between that man and the net: on the line from where he is going to the net centre.
      const nx = -dir * GOAL;
      const mx = m.pos.x + m.vel.x * NET_FRONT_LEAD, my = m.pos.y + m.vel.y * NET_FRONT_LEAD;
      const dx = nx - mx, dy = -my, l = hyp(dx, dy) || 1;
      // On that line, or beside it (away from his goalie) where the goalie's body leaves no room on it.
      const gl = state.goalies[s.side].pos;
      // Beside it, the puck's side first: his stick is then in the lane from the puck to his man as well.
      const pk = state.puck.pos;
      const toward = (pk.y - my) * dx - (pk.x - mx) * dy >= 0 ? 1 : -1;
      let bestClear = -Infinity;
      for (let k = 0; k < NET_FRONT_TRIES.length && bestClear < NET_FRONT_GOALIE; k++) {
        const g = Math.min(NET_FRONT_TRIES[k]![0], l * 0.6), o = NET_FRONT_TRIES[k]![1] * toward;
        const cx = mx + (dx / l) * g - (dy / l) * o, cy = my + (dy / l) * g + (dx / l) * o;
        const clear = hyp(cx - gl.x, cy - gl.y);
        if (clear > bestClear) { bestClear = clear; p.x = cx; p.y = cy; }
      }
      out.follow = 'man';
      out.markId = m.id;
      out.slow = 'stop';
      out.effort = 'sprint';
      return out;
    }
    case 'dzCentre': {
      // The slot is his: the lane to the most dangerous man when it passes within reach of the slot, else the low
      // man when he is near it, else the slot itself.
      setRel(spotScratch, -20, ps * 1.5, dir);
      const sx = spotScratch.x, sy = spotScratch.y;
      if (shadowSpot(state, s, p, spotScratch) !== null) { out.follow = 'puck'; return out; }
      const m = lowMan(state, s.side);
      if (m !== null && hyp(m.pos.x - sx, m.pos.y - sy) <= LOW_MAN_RANGE) { cover(state, s, m, job, tactics, out, false); return out; }
      p.x = sx; p.y = sy;
      return out;
    }
    case 'wingStrong': case 'wingWeak':
      // The weak-side winger sags into the lane to the most dangerous man when it is within reach (shadowSpot).
      // (Task 11: under defence 'pressure' they cover their point men tight, TUNING.tactics.pressure.gap.)
      cover(state, s, pointMen(state, s.side)[job === 'wingStrong' ? 0 : 1]!, job, tactics, out, job === 'wingWeak', pressing(tactics) ? TT.pressure.gap : undefined);
      return out;
    default:
      // Utility jobs are steered elsewhere; hold where he is.
      p.x = s.target.x; p.y = s.target.y;
      return out;
  }
}

/** Jobs whose want does not start from jobAnchor (cover jobs work it out only without a man). */
const NO_ANCHOR: ReadonlySet<Job> = new Set<Job>(['chase', 'receive', 'f1', 'f2', 'dGapStrong', 'dGapWeak', 'backcheckA', 'backcheckB', 'dNet', 'dzCentre', 'wingStrong', 'wingWeak', 'tagUp']);

/** True for the jobs that keep a man (covering jobs and the weak-side gap defenceman). */
export const isCoverJob = (job: Job): boolean => MARKING.has(job);
/** True for the jobs that face the play. */
export const facesPlay = (job: Job): boolean => FACING.has(job);
