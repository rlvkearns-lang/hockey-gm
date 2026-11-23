import { DT, type ContestOutcome, type ContestStateOf } from '@hockey/engine';
import { slotOf, toBodyFrame, type AnimContext, type Overlay, type SkaterAnim, type SkaterSample } from '../anim-context';
import type { BodyDims } from '../body';
import { styleShare } from '../gait';
import { bladeAt, fitBody, mixRaw, shoulderJoint, type RawPose, type Vec3 } from '../pose-mix';
import { boardsGap, pokeOverlay, radiusOfWeight, weightOfDims } from './contact';

/**
 * Battles (pure: no three.js, no DOM): board battles, net-front battles and loose-puck races, drawn from the engine's
 * contests only: kind, stage and stage time, roles (`first`, `pinned`, `digLast`, `supportA`/`supportB`, `winner`,
 * `carrier`, `leader`), spot and data, and the `contestEnd` event's result. The viewer decides nothing: who pins, who
 * digs it out, who supports and who wins are the engine's; these overlays only shape the bodies (lean, crouch, hips,
 * shoulders, arms, sticks, head) and, for a pin, draw the two men in contact through the overlay offset.
 *
 * - battleTrack (id `battle`) shows nothing. It keeps one slot per skater (BattleSlot, plain data changed in place):
 *   the contest he is in (or has just left, until KEEP_SECONDS after its end), its roles as last seen, and one eased
 *   amount (0..1) per stance (Stances). Each amount moves toward its target (1 while the engine's stage and his role
 *   call for that stance) at a fixed rate, so a change of role (pinned, a dig round won, a supporter arriving) blends
 *   instead of snapping, and an amount that has arrived is exactly what a seek's pre-roll gives (a fresh start takes the
 *   targets at once; every blend is shorter than the 1.5 s pre-roll, and nothing older than that is needed: a battle's
 *   stance is a function of its stage and roles now). It also keeps the point his blade aims at (the puck, kept at
 *   least AIM_MIN from his centre), moved at most AIM_SPEED.
 * - boardBattleOverlay: `protect` (the carrier turns his back to the checker, the puck to the far side; the checker
 *   leans on him, a glove on his back), `arrive` (both drive at the puck; the first man in drops his shoulder into the
 *   other), `pin` and `dig` (the pinner low and square behind the pinned man, a leg between his, forearm on his back; the
 *   pinned man upright against the boards facing them, a glove on the boards, looking back over his shoulder, the puck in
 *   his feet; nobody pinned: both low, shoulder to shoulder, the man ahead leaning in), the dig (both sticks jabbing at
 *   the puck, the last round's winner with his blade on it), `support` (each side's supporting player crouched beside the
 *   scrum, blade down toward it, a little to his teammate's side), and `resolve` with the result (`how`): the winner on
 *   the puck and turning out along the boards (pinned: the pinner pulls it out; stick: the pinned man spins out to open
 *   ice; support: he pushes it to his supporting player; scramble: he pops out with it; protect: the carrier skates out),
 *   the loser turned the wrong way (facing the boards, stick off it; a beaten pinner thrown into the boards; a scramble
 *   or protect loser lunging after it).
 * - netFrontOverlay: the attacker planted wide in front facing the puck, blade on the ice; the defender behind him
 *   leaning in with his glove and forearm in his back (the cross-check drawn as the push, not a shaft held across: a
 *   raised two-handed shaft has no steady hand solution), stick at the attacker's skates; `free`: the attacker has a
 *   step and his stick clear, the defender's push off; `tied`: the defender's blade lifts the attacker's stick.
 * - raceOverlay: both sprint low reaching one-handed with the stick toward the puck, a glove on the other man when he
 *   is alongside; the winner's blade gets there.
 * Every stance comes off within KEEP_SECONDS of the contest's end (or at once and smoothly when it is cut off: a whistle,
 * a period break, a man leaving), and every pose equals the skating pose at amount 0, so nothing snaps on or off.
 */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (t: number): number => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const fin = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

/** How long (s) a battle's slot is kept after its end: every stance has come off by then. */
export const KEEP_SECONDS = 1.2;
/** The winner and loser hold their result this long (s) after the end, then come off over OFF_RESULT. */
const HOLD_RESULT = 0.65;
/** The blade's aim point stays at least this far (m) from his centre, and moves at most this fast (m/s). */
const AIM_MIN = 0.15, AIM_SPEED = 5;
/** A blade is put no nearer his centre than this (m). */
const BLADE_MIN = 0.5;
/** The furthest (m, from under his pelvis) a blade is put on the ice reaching for the puck. */
const REACH = 1.6;
/** Dig jabs: this many a second. */
const JAB_HZ = 2.6;

type Kind = 'boardBattle' | 'netFront' | 'looseRace';
type BattleContest = ContestStateOf<'boardBattle'> | ContestStateOf<'netFront'> | ContestStateOf<'looseRace'>;
/** The stances, each an amount 0..1 in the slot. */
export type Stances = {
  /** Board battle: protect (carrier, checker), arrive (both; the first man in), pin and dig. */
  shield: number; lean: number; drive: number; inside: number;
  pinner: number; pinned: number; scrum: number; ahead: number; dig: number; onPuck: number;
  support: number; win: number; lose: number;
  /** Net front: attacker, defender; the stage (free, tied). */
  att: number; def: number; free: number; tied: number;
  /** Loose-puck race: racing; the winner and loser of it. */
  race: number; raceWin: number; raceLose: number;
};
const STANCES = ['shield', 'lean', 'drive', 'inside', 'pinner', 'pinned', 'scrum', 'ahead', 'dig', 'onPuck', 'support', 'win', 'lose', 'att', 'def', 'free', 'tied', 'race', 'raceWin', 'raceLose'] as const;
type StanceKey = typeof STANCES[number];
const BOARD: readonly StanceKey[] = ['shield', 'lean', 'drive', 'inside', 'pinner', 'pinned', 'scrum', 'ahead', 'dig', 'onPuck', 'support', 'win', 'lose'];
const NET: readonly StanceKey[] = ['att', 'def', 'free', 'tied'];
const RACE: readonly StanceKey[] = ['race', 'raceWin', 'raceLose'];
/** Seconds each stance takes to come fully on (and off). */
const RATE: Record<StanceKey, number> = {
  shield: 0.3, lean: 0.3, drive: 0.3, inside: 0.3, pinner: 0.35, pinned: 0.35, scrum: 0.35, ahead: 0.3, dig: 0.3, onPuck: 0.25,
  support: 0.4, win: 0.45, lose: 0.45, att: 0.35, def: 0.35, free: 0.35, tied: 0.3, race: 0.45, raceWin: 0.3, raceLose: 0.4,
};

const newStances = (): Stances => Object.fromEntries(STANCES.map((k) => [k, 0])) as Stances;

/** One kind's battle as last seen (each kind keeps its own, so one fading out is not upset by the next starting). */
export type BattleRec = {
  /** The contest (-1 none), its kind, the tick its current stage began, and the tick it was gone (-1: under way). */
  cid: number; kind: Kind | null; stage: string; stageAt: number; end: number;
  /** Roles as last seen. Net front: a attacker, b defender. Race: a and b. */
  a: string; b: string; pinned: string | null; digLast: string | null; winner: string | null; first: string | null;
  supportA: string | null; supportB: string | null; carrier: string | null; leader: string | null;
  /** The result once known (the stage resolve, or the contestEnd event), the winner and the loser shown. */
  how: string; winnerId: string | null; loserId: string | null;
  /** The spot (engine x, y) and the boards' outward normal there (engine x, y). */
  sx: number; sy: number; nx: number; ny: number;
  /** Where the other of the two men was last seen on the ice (engine x, y): he may step off while it fades. */
  ox: number; oy: number;
  /** Net front and race: the way (engine radians) he turns to face the puck, eased. Race: how far a glove is on the other man (0..1), eased. */
  face: number; hold: number;
};
type BladeLim = {
  x: number; y: number; z: number; has: boolean; ax: number; az: number; fx: number; fy: number; fz: number; t: number;
  /** The overlay's last output (raw pose) and its fitted hands and heel; `lag`: it is still catching up with the pose asked for. */
  out: RawPose | null; h0: Vec3; h1: Vec3; heel: Vec3; pt: number; lag: boolean;
};
export type BattleSlot = {
  recs: Record<Kind, BattleRec>;
  st: Stances;
  /** The blade's aim point (engine x, y). */
  ax: number; ay: number;
  /** Each battle overlay's blade target as last drawn (body frame) and when (game s; -1 none): it moves at most BLADE_SPEED. */
  lim: { board: BladeLim; net: BladeLim; race: BladeLim };
  /** The puck (engine x, y) at the last step: the aim moves with it, then catches up at most AIM_SPEED. */
  px: number; py: number;
};

export const BATTLE_ID = 'battle';
export const battleSlotOf = (anim: SkaterAnim): BattleSlot | undefined => slotOf<BattleSlot>(anim, BATTLE_ID);

const newRec = (): BattleRec => ({
  cid: -1, kind: null, stage: '', stageAt: -1, end: -1, a: '', b: '', pinned: null, digLast: null, winner: null, first: null,
  supportA: null, supportB: null, carrier: null, leader: null, how: '', winnerId: null, loserId: null,
  sx: 0, sy: 0, nx: 1, ny: 0, ox: 0, oy: 0, face: NaN, hold: 0,
});
const newSlot = (): BattleSlot => ({ recs: { boardBattle: newRec(), netFront: newRec(), looseRace: newRec() }, st: newStances(), ax: 0, ay: 0, px: 0, py: 0, lim: { board: newLim(), net: newLim(), race: newLim() } });
function newLim(): BladeLim { return { x: 0, y: 0, z: 0, has: false, ax: 0, az: 0, fx: 0, fy: 0, fz: 0, t: -1, out: null, h0: v3(0, 0, 0), h1: v3(0, 0, 0), heel: v3(0, 0, 0), pt: -1, lag: false }; }
const clearContest = (sl: BattleRec): void => { Object.assign(sl, newRec()); };
const KINDS: readonly Kind[] = ['boardBattle', 'netFront', 'looseRace'];

const nrm = { x: 0, z: 0 };
/** The battle (of the three kinds) he is in now, or null. */
function contestOf(id: string, ctx: AnimContext): BattleContest | null {
  for (const c of ctx.contests) {
    if ((c.kind === 'boardBattle' || c.kind === 'netFront' || c.kind === 'looseRace') && c.participants.includes(id)) return c as BattleContest;
  }
  return null;
}

/** A board battle's result from its roles (as the engine's finish() works it out). */
function boardHow(sl: BattleRec): string {
  if (sl.winner === null) return '';
  const w = sl.winner, l = w === sl.a ? sl.b : sl.a;
  const sup = w === sl.a ? sl.supportA : sl.supportB, lsup = w === sl.a ? sl.supportB : sl.supportA;
  return sup !== null && lsup === null ? 'support' : sl.pinned === null ? 'scramble' : sl.pinned === l ? 'pinned' : 'stick';
}

/** Read the live contest into the slot. */
function readContest(sl: BattleRec, c: BattleContest, ctx: AnimContext): void {
  if (sl.cid !== c.id) { clearContest(sl); sl.cid = c.id; sl.kind = c.kind; }
  sl.end = -1;
  const at = ctx.state.tick - Math.round(c.stageT / DT);
  if (sl.stage !== c.stage) { sl.stage = c.stage; sl.stageAt = at; }
  sl.leader = c.leader;
  sl.sx = c.spot.x; sl.sy = c.spot.y;
  if (c.kind === 'boardBattle') {
    const r = c.roles;
    sl.a = r.a; sl.b = r.b; sl.pinned = r.pinned; sl.digLast = r.digLast; sl.winner = r.winner; sl.first = r.first;
    sl.supportA = r.supportA; sl.supportB = r.supportB; sl.carrier = r.carrier;
    boardsGap(c.spot.x, c.spot.y, nrm);
    sl.nx = nrm.x; sl.ny = nrm.z;
    if (c.stage === 'resolve') { sl.how = boardHow(sl); sl.winnerId = r.winner; sl.loserId = r.winner === r.a ? r.b : r.a; }
  } else if (c.kind === 'netFront') {
    sl.a = c.roles.attacker; sl.b = c.roles.defender;
  } else {
    sl.a = c.roles.a; sl.b = c.roles.b;
    if (c.stage === 'resolve') {
      const o = c.data.outcome;
      sl.winnerId = o === 'a' ? c.roles.a : o === 'b' ? c.roles.b : null;
      sl.loserId = sl.winnerId === null ? null : sl.winnerId === c.roles.a ? c.roles.b : c.roles.a;
      sl.how = o === 'bounce' ? 'bounce' : 'won';
    }
  }
}

/** The contest has gone: its end, and its result from the timeline's contestEnd. */
function readEnd(sl: BattleRec, ctx: AnimContext): void {
  if (sl.end >= 0) return;
  sl.end = ctx.state.tick;
  const e = ctx.timeline.contest(sl.cid)?.end;
  const res = (e?.detail.result ?? 'whistle') as ContestOutcome;
  if (sl.kind === 'boardBattle') {
    if (res === 'protected') { sl.how = 'protect'; sl.winnerId = sl.carrier ?? e?.detail.winnerId ?? null; sl.loserId = sl.winnerId === sl.a ? sl.b : sl.a; }
    else if (res === 'pinned' || res === 'stick' || res === 'support' || res === 'scramble') {
      if (sl.how === '') { sl.how = res; sl.winnerId = sl.winner; sl.loserId = sl.winner === sl.a ? sl.b : sl.a; }
    } else { sl.how = ''; sl.winnerId = null; sl.loserId = null; }
  } else if (sl.kind === 'looseRace') {
    if (res !== 'won' && res !== 'bounce') { sl.how = ''; sl.winnerId = null; sl.loserId = null; }
  }
}

/** The stance targets for skater `me` from one kind's record (live contest or its aftermath), added into `t`. */
function targets(sl: BattleRec, me: string, ctx: AnimContext, t: Stances): Stances {
  if (sl.cid < 0) return t;
  const live = sl.end < 0;
  const since = live ? 0 : (ctx.state.tick - sl.end) * DT;
  if (sl.kind === 'boardBattle') {
    const main = me === sl.a || me === sl.b;
    if (live) {
      if (me === sl.supportA || me === sl.supportB) t.support = 1;
      if (main) {
        const s = sl.stage;
        if (s === 'protect') { if (sl.carrier === me) t.shield = 1; else t.lean = 1; }
        else if (s === 'arrive') { t.drive = 1; t.inside = sl.first === me ? 1 : 0; }
        else {
          if (sl.pinned === null) { t.scrum = 1; t.ahead = sl.leader === me ? 1 : 0; }
          else if (sl.pinned === me) t.pinned = 1;
          else t.pinner = 1;
          if (s === 'dig' || s === 'resolve') { t.dig = 1; t.onPuck = sl.digLast === me ? 1 : 0; }
          if (s === 'resolve') { t.win = sl.winner === me ? 1 : 0; t.lose = sl.winner !== null && sl.winner !== me ? 1 : 0; }
        }
      }
    } else if (since < HOLD_RESULT && sl.how !== '') {
      if (me === sl.winnerId) t.win = 1;
      else if (me === sl.loserId) t.lose = 1;
    }
  } else if (sl.kind === 'netFront') {
    if (live) {
      if (me === sl.a) t.att = 1; else if (me === sl.b) t.def = 1;
      t.free = sl.stage === 'free' ? 1 : 0; t.tied = sl.stage === 'tied' ? 1 : 0;
    }
  } else if (sl.kind === 'looseRace') {
    if (live) t.race = 1;
    if (sl.how === 'won' && (live || since < 0.2)) {
      if (me === sl.winnerId) t.raceWin = 1; else if (me === sl.loserId) t.raceLose = 1;
    }
  }
  return t;
}

const tgt = newStances();

function track(sl: BattleSlot, s: SkaterSample, ctx: AnimContext, dt: number, fresh: boolean): void {
  const c = contestOf(s.id, ctx);
  for (const k of STANCES) tgt[k] = 0;
  for (const kind of KINDS) {
    const rec = sl.recs[kind];
    if (c && c.kind === kind) readContest(rec, c, ctx);
    else if (rec.cid >= 0) {
      readEnd(rec, ctx);
      if ((ctx.state.tick - rec.end) * DT > KEEP_SECONDS) clearContest(rec);
    }
    if (rec.cid >= 0) {
      const o = ctx.skaters.get(s.id === rec.a ? rec.b : rec.a);
      if (o && o.onIce) { rec.ox = o.pos.x; rec.oy = o.pos.y; }
      if (kind === 'netFront' || kind === 'looseRace') easeFace(rec, s, ctx, dt, fresh);
      if (kind === 'looseRace') easeHold(rec, s, o, dt, fresh);
    }
    targets(rec, s.id, ctx, tgt);
  }
  // In (or about to be in) a hit or a poke check, or down: every battle stance comes off, quickly.
  const busy = otherContact(s, ctx);
  if (busy) for (const k of STANCES) tgt[k] = 0;
  let any = false;
  for (const k of STANCES) {
    const want = tgt[k];
    if (fresh) sl.st[k] = want;
    else { const r = dt / (busy ? YIELD_RATE : RATE[k]); sl.st[k] = clamp01(sl.st[k] + clamp(want - sl.st[k], -r, r)); }
    if (sl.st[k] > 0) any = true;
  }
  // The blade's aim: the puck, kept off his centre, moved at a limited speed.
  let px = ctx.puck.engine.x, py = ctx.puck.engine.z;
  const dx = px - s.pos.x, dy = py - s.pos.y, d = Math.hypot(dx, dy);
  if (d < AIM_MIN) {
    const ux = d > 0.05 ? dx / d : Math.cos(s.facing), uy = d > 0.05 ? dy / d : Math.sin(s.facing);
    px = s.pos.x + ux * AIM_MIN; py = s.pos.y + uy * AIM_MIN;
  }
  const qx = ctx.puck.engine.x, qy = ctx.puck.engine.z;
  // The puck's own motion (not a hand-over to a carrier, or a jump to a dot).
  const pv = ctx.state.puck.vel, moved = Math.hypot(qx - sl.px, qy - sl.py) < Math.hypot(pv.x, pv.y) * Math.max(dt, DT) * 1.5 + 0.05;
  if (moved) { sl.ax += qx - sl.px; sl.ay += qy - sl.py; }
  sl.px = qx; sl.py = qy;
  if (fresh || !any) { sl.ax = px; sl.ay = py; return; }
  const mx = px - sl.ax, my = py - sl.ay, l = Math.hypot(mx, my), max = AIM_SPEED * dt;
  if (l <= max) { sl.ax = px; sl.ay = py; } else { sl.ax += (mx / l) * max; sl.ay += (my / l) * max; }
}

/** The attacker's facing toward the puck (world angle), turned at most FACE_RATE, held while the puck is at his feet. */
const FACE_RATE = 5;
function easeFace(rec: BattleRec, s: SkaterSample, ctx: AnimContext, dt: number, fresh: boolean): void {
  const dx = ctx.puck.engine.x - s.pos.x, dy = ctx.puck.engine.z - s.pos.y;
  if (Number.isNaN(rec.face) || (fresh && Math.hypot(dx, dy) < 0.6)) rec.face = s.facing;
  if (Math.hypot(dx, dy) < 0.6) return;
  const want = Math.atan2(dy, dx), d = wrap(want - rec.face);
  rec.face = fresh ? want : wrap(rec.face + clamp(d, -FACE_RATE * dt, FACE_RATE * dt));
}
/** A glove on the other racer: only when he is alongside, going his way; eased in and out over HOLD_EASE s. */
const HOLD_EASE = 0.25;
function easeHold(rec: BattleRec, s: SkaterSample, o: SkaterSample | undefined, dt: number, fresh: boolean): void {
  let want = 0;
  if (o && o.onIce && rec.end < 0) {
    const p = toBodyFrame(s, o.pos), d = Math.hypot(p.x, p.z), rel = Math.hypot(o.vel.x - s.vel.x, o.vel.y - s.vel.y);
    want = smooth((1.4 - d) / 0.5) * smooth((0.9 - Math.abs(p.x)) / 0.4) * smooth((4 - rel) / 2);
  }
  rec.hold = fresh ? want : rec.hold + clamp(want - rec.hold, -dt / HOLD_EASE, dt / HOLD_EASE);
}

/** Seconds a battle stance takes to come off for a hit, a poke check or a fall. */
const YIELD_RATE = 0.15;
/** Ticks ahead the timeline's start of a hit or poke check of his clears the battle stances. */
const YIELD_LEAD = 8;
/** He is in a hit or a poke check (or one starts within YIELD_LEAD ticks), or down. */
function otherContact(s: SkaterSample, ctx: AnimContext): boolean {
  if (s.state.downT > 0) return true;
  for (const c of ctx.contests) if ((c.kind === 'hit' || c.kind === 'pokeCheck') && c.participants.includes(s.id)) return true;
  let e = ctx.timeline.next('contestStart', ctx.state.tick - 1, YIELD_LEAD + 1, s.id, 'either');
  for (let i = 0; i < 4 && e; i++) {
    if (e.detail.kind === 'hit' || e.detail.kind === 'pokeCheck') return true;
    e = ctx.timeline.next('contestStart', e.tick, ctx.state.tick + YIELD_LEAD - e.tick, s.id, 'either');
  }
  return false;
}

export const battleTrack: Overlay<BattleSlot> = {
  id: BATTLE_ID,
  step(slot, sample, ctx, dt) {
    const fresh = slot === undefined;
    const sl = slot ?? newSlot();
    if (!sample.onIce) return sl;
    track(sl, sample, ctx, dt, fresh);
    return sl;
  },
  weight: () => 0,
  apply: (raw) => raw,
};

// ---------------------------------------------------------------------------------------------------------------
// Pose helpers (left-shot body frame: x forward, z to his right, y up; from the ice under his pelvis)

type Geo = { s: SkaterSample; ctx: AnimContext; dims: BodyDims; sl: BattleRec; st: Stances; ax: number; ay: number };

/** A world point (engine x, y) in his body frame. */
const bodyPt = (g: Geo, x: number, y: number): Vec3 => toBodyFrame(g.s, { x, y });
/** A world direction (engine x, y) as a heading in his body frame. */
function headingOf(g: Geo, vx: number, vy: number): number {
  const c = Math.cos(g.s.facing), n = Math.sin(g.s.facing);
  return Math.atan2((g.s.right ? -1 : 1) * (-vx * n + vy * c), vx * c + vy * n);
}
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Turn him toward heading `h` (body frame) by up to `max` rad: the shoulders by all of it, the hips and skates by
 * HIP_SHARE of it. A heading nearly straight behind him fades the turn to nothing (it would flip side there).
 */
const HIP_SHARE = 0.4;
function turned(r: RawPose, h: number, max: number, k = 1): RawPose {
  const a = wrap(h);
  const t = clamp(a, -max, max) * smooth((Math.PI - Math.abs(a)) / 0.8) * k;
  const y = HIP_SHARE * t, c = Math.cos(y), n = Math.sin(y);
  const leg = (i: 0 | 1) => {
    const f = r.legs[i].foot;
    return { foot: v3(f.x * c - f.z * n, f.y, f.x * n + f.z * c), footYaw: r.legs[i].footYaw + y };
  };
  return { ...r, twist: r.twist + t, yaw: r.yaw + y, legs: [leg(0), leg(1)] };
}
/** The torso turn `turned` gives for heading `h` (for the head's own look). */
const turnOf = (h: number, max: number, k = 1): number => { const a = wrap(h); return clamp(a, -max, max) * smooth((Math.PI - Math.abs(a)) / 0.8) * k; };
/** How far to turn toward a point `d` m from him: not at all for one right at his feet, whose heading is unsteady. */
const nearK = (d: number): number => smooth((d - 0.25) / 0.5);

/**
 * `a` mixed toward stance `b` by `k`, as mixRaw, except the blade: when `b` puts it at a point, the mix puts it at a
 * point too (the hand always solved from the blade), moving from where `a` actually has the heel (fitted) to `b`'s
 * point round the front of him (heading and distance from his centre interpolated). At k = 0 that is exactly `a`'s
 * stick, so a stance comes on and off without the hand ever being half way between two solves (where the shaft can
 * swing round at a touch).
 */
function mixStance(a: RawPose, b: RawPose, k: number, dims: BodyDims): RawPose {
  const m = mixRaw(a, b, k);
  if (!(k > 0 && k < 1) || !b.bladeAt) return m;
  const heel = fitBody(a, dims).blade;
  const t = polarMix(heel, b.bladeAt, k);
  return { ...m, blade: v3(t.x, 0, t.z), bladeUp: t.y, bladeAt: t, bladeAtW: 1 };
}
/** Between two points on or over the ice (body frame): heading and distance from his centre interpolated, round the front. */
function polarMix(p: Vec3, q: Vec3, k: number): Vec3 {
  const ha = Math.atan2(p.z, p.x), hb = Math.atan2(q.z, q.x), ra = Math.hypot(p.x, p.z), rb = Math.hypot(q.x, q.z);
  const h = ha + (hb - ha) * k, r = ra + (rb - ra) * k;
  return v3(r * Math.cos(h), p.y + (q.y - p.y) * k, r * Math.sin(h));
}
/**
 * The free (left) hand put on something at heading `h` (body frame), `d` m away (`lat` to its right, `y` high): only
 * as far as it is in front of or beside his shoulders (never reaching round behind his back), and no further out than
 * his arm goes.
 */
function gloveOn(r: RawPose, h: number, d: number, lat: number, y: number, dims: BodyDims): Vec3 {
  const f = smooth((Math.cos(wrap(h - r.twist)) + 0.6) / 1.2);
  return mixV(r.freeRel, freeAt(r, along(h, clamp(d, 0.3, 0.6), lat, y), dims), f);
}
/** The free (left) hand put at body-frame point `p`, from the left shoulder of pose `r`. */
function freeAt(r: RawPose, p: Vec3, dims: BodyDims): Vec3 {
  const sh = shoulderJoint({ hipY: r.hipY, pitch: r.pitch, roll: r.roll, twist: r.twist }, 0, dims);
  return v3(p.x - sh.x, p.y - sh.y, p.z - sh.z);
}
/** Skates set wide (z ±w), at x offsets fx (left) and fx2 (right), turned as the pose's hips are. */
function stance(r: RawPose, w: number, fl: number, fr: number): RawPose {
  const c = Math.cos(r.yaw), n = Math.sin(r.yaw);
  const at = (x: number, z: number): Vec3 => v3(x * c - z * n, 0, x * n + z * c);
  return { ...r, legs: [{ foot: at(fl, -w), footYaw: r.legs[0].footYaw }, { foot: at(fr, w), footYaw: r.legs[1].footYaw }] };
}
/**
 * Headings (from where his shoulders face, left-shot frame) a blade goes round to on the ice: his blade side well round
 * behind him, his top-hand side less, except near his skates (within about REACH_NEAR m), where he can reach back past
 * his right skate.
 */
const REACH_LEFT = -2.75, REACH_RIGHT = 2.4, REACH_RIGHT_NEAR = 2.9, REACH_NEAR = 0.8, REACH_FOLD = -0.45;
/**
 * A point on the ice (body frame) the stick can reach, for a target at `p` with his shoulders turned `turn`: no nearer
 * than BLADE_MIN, no further than `max`, and round no further than REACH_LEFT / REACH_RIGHT from his shoulders. A target
 * further round behind him is folded back to the front (to REACH_FOLD directly behind him, nearer as it goes), so the
 * blade never swings across behind him. Continuous in the target and the turn.
 */
function reachable(p0: Vec3, max = REACH, turn = 0): Vec3 {
  // A target right under him goes to the skating blade's place in front (its direction is unsteady there).
  const u = 1 - smooth(Math.hypot(p0.x, p0.z) / 0.2), p = v3(p0.x + 0.55 * u, 0, p0.z - 0.27 * u);
  let h = wrap(Math.atan2(p.z, p.x) - turn), r = Math.hypot(p.x, p.z);
  if (r < 1e-6) { h = 0; r = BLADE_MIN; }
  const right = REACH_RIGHT + (REACH_RIGHT_NEAR - REACH_RIGHT) * smooth((REACH_NEAR + 0.15 - r) / 0.3);
  // Round behind him the stick reaches less far (the arm is behind his back there).
  let lim = max - (max - 0.9) * smooth((Math.abs(h) - 1.6) / 0.8);
  // Across to his top-hand side it reaches less far too (the hand would have to cross his body).
  lim = Math.min(lim, max - (max - 1.35) * smooth((h - 0.3) / 0.6));
  if (h > right || h < REACH_LEFT) {
    const u = h > right ? (h - right) / (Math.PI - right) : (REACH_LEFT - h) / (Math.PI + REACH_LEFT);
    const from = h > right ? right : REACH_LEFT;
    h = from + (REACH_FOLD - from) * u;
    lim = lim + (0.8 - lim) * smooth(u);
  }
  r = clamp(r, BLADE_MIN, Math.max(BLADE_MIN, lim));
  let x = r * Math.cos(h + turn), z = r * Math.sin(h + turn);
  // Not under his top hand either: there the shaft would stand on end and its heading turn at a touch.
  const hx = x - HAND_AT.x, hz = z - HAND_AT.z, hd = Math.hypot(hx, hz);
  if (hd < HAND_CLEAR) {
    const ux = hd > 1e-6 ? hx / hd : 1, uz = hd > 1e-6 ? hz / hd : 0;
    x = HAND_AT.x + ux * HAND_CLEAR; z = HAND_AT.z + uz * HAND_CLEAR;
  }
  return v3(x, 0, z);
}
/** Where his top hand usually is over the ice (body frame), and how far (m) a blade target keeps from under it. */
const HAND_AT = { x: 0.22, z: 0.12 }, HAND_CLEAR = 0.25;
/** Point at distance `f` along unit heading `h` and `l` to its right (body frame), at height y. */
const along = (h: number, f: number, l: number, y: number): Vec3 => v3(f * Math.cos(h) - l * Math.sin(h), y, f * Math.sin(h) + l * Math.cos(h));
/** Heading (body frame) toward the boards from the slot's normal. */
const boardsHeading = (g: Geo): number => headingOf(g, g.sl.nx, g.sl.ny);
/** The other man (body frame) and his heading and distance; null if he is not on the ice. */
function otherMan(g: Geo, id: string | null): { p: Vec3; h: number; d: number } | null {
  if (!id) return null;
  const o = g.ctx.skaters.get(id);
  if (!o || !o.onIce) {
    if (id !== mainOther(g)) return null;
    const p = bodyPt(g, g.sl.ox, g.sl.oy);
    return { p, h: Math.atan2(p.z, p.x), d: Math.hypot(p.x, p.z) };
  }
  // The pinned man is drawn moved in toward the boards (pinOffset).
  const sh = id === g.sl.pinned ? pinnedShift(g.sl, o, smooth(Math.max(g.st.pinner, g.st.pinned))) : 0;
  const p = bodyPt(g, o.pos.x + g.sl.nx * sh, o.pos.y + g.sl.ny * sh);
  return { p, h: Math.atan2(p.z, p.x), d: Math.hypot(p.x, p.z) };
}
const mainOther = (g: Geo): string => (g.s.id === g.sl.a ? g.sl.b : g.sl.a);
/** The blade's aim point (the puck, from the slot) in his body frame. */
const aimPt = (g: Geo): Vec3 => bodyPt(g, g.ax, g.ay);
/**
 * The blade jabbing at the puck: on it (onPuck: the last round's winner), or beside it and stabbing in and out.
 */
function jab(g: Geo, onPuck: number, turn: number): Vec3 {
  const p = aimPt(g), d = Math.hypot(p.x, p.z) || 1;
  const id = g.s.id;
  let ph = 0;
  for (let i = 0; i < id.length; i++) ph += id.charCodeAt(i) * 0.37;
  const w = Math.sin(g.ctx.time * 2 * Math.PI * JAB_HZ + ph), o = smooth(onPuck);
  const back = (1 - o) * (0.2 + 0.08 * (0.5 + 0.5 * w)) + o * 0.02 * (0.5 + 0.5 * w);
  const lift = (1 - o) * 0.06 * Math.max(0, Math.sin(g.ctx.time * 2 * Math.PI * JAB_HZ + ph + 1.2));
  // Beside the puck on his blade side (a blade short of it toward him would stand his stick on end).
  const ux = -p.x / d, uz = -p.z / d, a = -Math.PI / 2;
  const c = Math.cos(a), n = Math.sin(a);
  const q = reachable(v3(p.x + back * (ux * c - uz * n), 0, p.z + back * (ux * n + uz * c)), REACH, 0);
  return v3(q.x, lift, q.z);
}

// ---------------------------------------------------------------------------------------------------------------
// Board battle stances (each returns the full stance from pose `r`; the caller mixes it in by its amount)

function shieldPose(r: RawPose, g: Geo): RawPose {
  const o = otherMan(g, mainOther(g));
  if (!o) return r;
  // His back to the checker: the shoulders turned so the checker is behind his near shoulder.
  const far = smooth(Math.abs(o.h) / 0.5) * smooth((Math.PI - Math.abs(o.h)) / 0.5), side = o.p.z >= 0 ? 1 : -1;
  const tw = clamp(o.h - side * 2.5, -1.0, 1.0) * far;
  const out = turned(r, tw, 1.0);
  const hh = g.dims.hipHeight;
  // The puck to his far side (away from the checker), the near shoulder and hip into him.
  const dz = -side * 0.3 * far;
  return {
    ...out, hipY: out.hipY - 0.08 * hh, pitch: out.pitch + 0.15, roll: out.roll + side * 0.16 * far,
    look: clamp(o.h - out.twist, -1.3, 1.3) * 0.5,
    blade: v3(r.blade.x - 0.05, r.blade.y, r.blade.z + dz),
    bladeAt: r.bladeAt ? v3(r.bladeAt.x - 0.05, r.bladeAt.y, r.bladeAt.z + dz) : undefined,
  };
}

function leanPose(r: RawPose, g: Geo): RawPose {
  const o = otherMan(g, mainOther(g));
  if (!o) return r;
  const out = turned(r, o.h, 1.0);
  const hh = g.dims.hipHeight;
  const side = clamp(o.p.z / 0.5, -1, 1);
  const lean: RawPose = {
    ...out, hipY: out.hipY - 0.09 * hh, pitch: out.pitch + 0.3, roll: out.roll + side * 0.16, lookDown: 0.25,
    top: v3(0.38, 0.12, 0.16), twoHands: 0,
  };
  // A glove on his back; the stick one-handed toward the puck.
  lean.freeRel = gloveOn(lean, o.h, o.d - 0.3, -0.05, 1.12, g.dims);
  return bladeAt(lean, reachable(aimPt(g), REACH, 0), g.dims);
}

function drivePose(r: RawPose, g: Geo, inside: number): RawPose {
  const p = aimPt(g);
  const out = turned(r, Math.atan2(p.z, p.x), 0.8, nearK(Math.hypot(p.x, p.z)));
  const hh = g.dims.hipHeight;
  let d: RawPose = { ...out, hipY: out.hipY - (0.1 + 0.05 * inside) * hh, pitch: out.pitch + 0.3, lookDown: 0.3, top: v3(0.34, 0.1, 0.14), twoHands: 0.5 };
  const o = otherMan(g, mainOther(g));
  if (o && inside > 0) {
    // The first man in: his shoulder dropped into the other, an arm out to hold him off the puck.
    const side = clamp(o.p.z / 0.5, -1, 1);
    d = { ...d, roll: d.roll + side * 0.2 * inside, twoHands: d.twoHands * (1 - inside) };
    d.freeRel = mixV(d.freeRel, gloveOn(d, o.h, o.d - 0.35, 0, 1.0, g.dims), inside);
  }
  return bladeAt(d, reachable(p, REACH, 0), g.dims);
}
const mixV = (a: Vec3, b: Vec3, k: number): Vec3 => v3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);

function scrumPose(r: RawPose, g: Geo, ahead: number): RawPose {
  // Nobody pinned: both down low and wide, side by side, shoulder into shoulder, both hands on the stick in the puck
  // (no glove on the other's back, no one upright on the boards: that is a pin).
  const out = stance(turned(r, boardsHeading(g), 1.1), 0.4, -0.05, 0.05);
  const hh = g.dims.hipHeight;
  const o = otherMan(g, mainOther(g));
  const side = o ? clamp(o.p.z / 0.5, -1, 1) : 0;
  const s: RawPose = {
    ...out, hipY: out.hipY - (0.2 + 0.04 * ahead) * hh, pitch: out.pitch + 0.5 + 0.1 * ahead, roll: out.roll + side * (0.22 + 0.12 * ahead),
    lookDown: 0.45, top: v3(0.12, 0.28, 0.14), twoHands: 1,
  };
  return bladeAt(s, reachable(aimPt(g), REACH, 0), g.dims);
}

/** The dig: the stick jabbing at the puck; a puck further off is reached for, bent over toward it. */
function digPose(r: RawPose, g: Geo): RawPose {
  const t = jab(g, g.st.onPuck, r.twist), d = Math.hypot(t.x, t.z), far = smooth((d - 0.9) / 0.6);
  const side = clamp(t.z / (d || 1), -1, 1);
  const b: RawPose = far > 0 ? { ...r, pitch: r.pitch + 0.35 * far, hipY: r.hipY - 0.08 * far * g.dims.hipHeight, roll: r.roll + 0.2 * side * far, twoHands: r.twoHands * (1 - far) } : r;
  return bladeAt(b, t, g.dims);
}

function pinnerPose(r: RawPose, g: Geo): RawPose {
  const o = otherMan(g, g.sl.pinned);
  const h = boardsHeading(g);
  const out = turned(r, h, 1.6);
  const hh = g.dims.hipHeight;
  // Low and square behind him: the right skate driven forward between his, the left back and wide.
  const st = stance(out, 0.28, -0.4, 0.42);
  const t = turnOf(h, 1.6) - out.yaw;
  const p: RawPose = {
    ...st, hipY: st.hipY - 0.17 * hh, pitch: st.pitch + 0.55, lookDown: 0.45, look: 0,
    top: along(t, 0.36, 0.1, 0.06), twoHands: 0,
  };
  // Forearm and glove into his back, at the shoulder blades.
  if (o) p.freeRel = gloveOn(p, o.h, o.d - 0.3, -0.08, 1.18, g.dims);
  return bladeAt(p, reachable(aimPt(g), REACH, 0), g.dims);
}

function pinnedPose(r: RawPose, g: Geo): RawPose {
  const hb = boardsHeading(g);
  const out = turned(r, hb, 1.6);
  const hh = g.dims.hipHeight;
  const st = stance(out, 0.32, 0.12, 0.12);
  const o = otherMan(g, mainOther(g));
  const tw = turnOf(hb, 1.6);
  // Upright against the boards: a glove up on the top of the boards, looking back over his shoulder at the pinner.
  const p: RawPose = {
    ...st, hipY: Math.max(st.hipY - 0.04 * hh, 0.86 * hh), pitch: 0.22, roll: 0, lookDown: 0.15,
    look: o ? clamp(wrap(o.h - tw), -1.3, 1.3) * 0.7 : 0,
    top: along(tw - out.yaw, 0.18, 0.12, 0.0), twoHands: 0,
  };
  const gap = boardsGap(g.s.pos.x, g.s.pos.y, nrm);
  p.freeRel = gloveOn(p, hb, gap - 0.1, -0.12, 1.05, g.dims);
  return bladeAt(p, reachable(aimPt(g), REACH, 0), g.dims);
}

function supportPose(r: RawPose, g: Geo): RawPose {
  const sp = bodyPt(g, g.sl.sx, g.sl.sy), h = Math.atan2(sp.z, sp.x);
  const out = stance(turned(r, h, 1.0), 0.3, 0.05, 0.05);
  const hh = g.dims.hipHeight, tw = turnOf(h, 1.0);
  const s: RawPose = {
    ...out, hipY: out.hipY - 0.12 * hh, pitch: out.pitch + 0.2, look: clamp(wrap(h - tw), -1, 1) * 0.6, lookDown: 0.2,
    twoHands: 1, top: v3(0.26, 0.02, 0.12),
  };
  // Blade flat on the ice toward the scrum, ready for it.
  return bladeAt(s, reachable(along(h, 1.05, -0.15, 0), REACH, 0), g.dims);
}

/**
 * The way along the boards a battle's winner comes out (+1: toward heading hb + PI/2, -1 the other way), fixed for the
 * battle: toward the net his team attacks along side boards, toward the middle along end boards.
 */
function outSign(g: Geo, team: SkaterSample | undefined): number {
  const tx = -g.sl.ny, ty = g.sl.nx; // engine tangent, the normal turned +PI/2
  const att = team ? -g.ctx.defends[team.side] : 1;
  const along = Math.abs(tx) > 0.3 ? tx * att : -ty * g.sl.sy;
  // The tangent (tx, ty) in his body frame is heading hb + PI/2 (left-shot frame mirrors both alike).
  return (g.s.right ? -1 : 1) * (along >= 0 ? 1 : -1);
}

/** How far the winner's blade is still on the puck after the end (1 at the end, 0 WIN_LET_GO s later). */
const WIN_LET_GO = 0.25;
function winPose(r: RawPose, g: Geo): RawPose {
  const hb = boardsHeading(g), how = g.sl.how, sg = outSign(g, g.s);
  // Out along the boards, or, having dug it out from against them, spun out toward open ice.
  const h = how === 'stick' ? hb + sg * 2.4 : hb + sg * Math.PI / 2;
  const out = turned(r, h, 1.1);
  const hh = g.dims.hipHeight;
  const w: RawPose = { ...out, hipY: out.hipY - 0.1 * hh, pitch: out.pitch + 0.32, lookDown: 0.2, top: v3(0.3, 0.06, 0.14) };
  const on = g.sl.end < 0 ? 1 : 1 - smooth((g.ctx.tick + g.ctx.alpha - g.sl.end) * DT / WIN_LET_GO);
  if (!(on > 0)) return w;
  // With the puck on his blade (pushing it back to his supporting player on a win by support).
  let p = aimPt(g);
  if (how === 'support') {
    const sup = otherMan(g, g.s.id === g.sl.a ? g.sl.supportA : g.sl.supportB);
    if (sup) {
      const u = clamp01((g.ctx.tick + g.ctx.alpha - g.sl.stageAt) * DT / 0.3) * 0.2, l = sup.d || 1;
      p = v3(p.x + (sup.p.x - p.x) / l * u, 0, p.z + (sup.p.z - p.z) / l * u);
    }
  }
  return mixStance(w, bladeAt(w, reachable(p, 1.8), g.dims), on, g.dims);
}

function losePose(r: RawPose, g: Geo): RawPose {
  const hb = boardsHeading(g), how = g.sl.how, hh = g.dims.hipHeight;
  const win = otherMan(g, g.sl.winnerId);
  if ((how === 'scramble' || how === 'protect') && win) {
    // Lunging after it one-handed, stretched, the free arm flung back.
    const out = turned(r, win.h, 1.0);
    const l: RawPose = { ...out, hipY: out.hipY - 0.14 * hh, pitch: out.pitch + 0.5, lookDown: 0.3, top: along(turnOf(win.h, 1.0) - out.yaw, 0.45, 0.12, 0.15), twoHands: 0, freeRel: v3(-0.3, -0.25, -0.3) };
    return bladeAt(l, reachable(v3(win.p.x * 1.2, 0, win.p.z * 1.2), 1.75), g.dims);
  }
  // Turned the wrong way: facing the boards, his stick off the puck.
  const out = turned(r, hb, 1.2);
  const tw = turnOf(hb, 1.2);
  const thrown = how === 'stick' ? 1 : 0; // a pinner the pinned man spun off: thrown forward into the boards
  const l: RawPose = {
    ...out, hipY: out.hipY - (0.02 + 0.08 * thrown) * hh, pitch: 0.25 + 0.5 * thrown, roll: 0, lookDown: -0.1,
    look: win ? clamp(wrap(win.h - tw), -1.2, 1.2) * 0.4 : 0, top: along(tw - out.yaw, 0.3 + 0.15 * thrown, 0.12, 0.1 + 0.25 * thrown), twoHands: 0,
  };
  const gap = boardsGap(g.s.pos.x, g.s.pos.y, nrm);
  l.freeRel = gloveOn(l, hb, gap - 0.1, -0.15, 1.0, g.dims);
  return bladeAt(l, along(tw - out.yaw, 0.55, -0.35, 0.18), g.dims);
}

/** A battle stance's blade target moves no faster than this (m/s, body frame). */
const BLADE_SPEED = 14;
/** A battle stance's free hand moves no faster than this (m/s, from his shoulder). */
const FREE_SPEED = 4;
/**
 * The pose's blade target kept within BLADE_SPEED of where this overlay last drew it (a target that passes right by
 * his skates turns its heading fast, and the engine hands a puck over in a tick). The last target is kept in the slot
 * from here: the one place an overlay's apply writes its own state, once a frame, deterministically (as the poke
 * check's blade limit does in contact.ts).
 */
function limitBlade(r: RawPose, lim: BladeLim, time: number, k: number): RawPose {
  const dt = time - lim.t, fresh = lim.t < 0 || dt < 0 || dt > 0.1, max = BLADE_SPEED * Math.max(0, dt);
  lim.t = time;
  // As the stance comes off (k toward 0) the limited stick gives way to the one asked for, so it never lags behind the
  // skating pose it hands over to.
  const hold = smooth(k / 0.3);
  const step = (x: number, z: number, lx: number, lz: number): [number, number] => {
    if (fresh) return [x, z];
    const dx = x - lx, dz = z - lz, l = Math.hypot(dx, dz);
    return l > max ? [lx + (dx / l) * max, lz + (dz / l) * max] : [x, z];
  };
  // The stick's aim (where the shaft points from the top hand), then the blade target if there is one.
  const [ax0, az0] = step(r.blade.x, r.blade.z, lim.ax, lim.az);
  const ax = r.blade.x + (ax0 - r.blade.x) * hold, az = r.blade.z + (az0 - r.blade.z) * hold;
  lim.ax = ax; lim.az = az;
  // The free hand (from his shoulder) no faster than FREE_SPEED.
  let fr = r.freeRel;
  if (!fresh) {
    const dx = fr.x - lim.fx, dy = fr.y - lim.fy, dz = fr.z - lim.fz, l = Math.hypot(dx, dy, dz), fm = FREE_SPEED * Math.max(0, dt);
    if (l > fm) { const q = (1 - fm / l) * hold; fr = v3(fr.x - dx * q, fr.y - dy * q, fr.z - dz * q); }
  }
  lim.fx = fr.x; lim.fy = fr.y; lim.fz = fr.z;
  const t = r.bladeAt;
  if (!t) { lim.has = false; return { ...r, blade: v3(ax, 0, az), freeRel: fr }; }
  let nt = t;
  if (lim.has) {
    const [x0, z0] = step(t.x, t.z, lim.x, lim.z);
    nt = v3(t.x + (x0 - t.x) * hold, t.y, t.z + (z0 - t.z) * hold);
  }
  lim.x = nt.x; lim.y = nt.y; lim.z = nt.z; lim.has = true;
  return { ...r, bladeAt: nt, blade: v3(ax, 0, az), bladeUp: nt.y, freeRel: fr };
}

/** A battle overlay's output moves a hand no faster than HAND_SPEED and the blade heel no faster than HEEL_SPEED (m/s). */
const HAND_SPEED = 5.4, HEEL_SPEED = 13;
const d3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** `r` with its upper body, arms and stick taken `k` of the way from `prev` (its skates and hips are `r`'s). */
function upperPart(prev: RawPose, r: RawPose, k: number): RawPose {
  const m = mixRaw(prev, r, k);
  return { ...r, pitch: m.pitch, roll: m.roll, twist: m.twist, look: m.look, lookDown: m.lookDown, top: m.top, freeRel: m.freeRel, twoHands: m.twoHands, blade: m.blade, bladeUp: m.bladeUp, bladeAt: m.bladeAt, bladeAtW: m.bladeAtW };
}
const copyRaw = (r: RawPose): RawPose => ({
  ...r, legs: [{ foot: { ...r.legs[0].foot }, footYaw: r.legs[0].footYaw }, { foot: { ...r.legs[1].foot }, footYaw: r.legs[1].footYaw }],
  top: { ...r.top }, freeRel: { ...r.freeRel }, blade: { ...r.blade }, bladeAt: r.bladeAt ? { ...r.bladeAt } : undefined,
});
/**
 * The last guard on a battle overlay's output: fitted, its hands and blade heel move no faster than HAND_SPEED and
 * HEEL_SPEED from where this overlay last put them (a hand solved back from a blade can swing round at a touch where
 * the two-bone solution turns over); where they would, the output's upper body, arms and stick are part way from the
 * last ones toward those asked for (its skates and hips are always the ones asked for). `lag` keeps the overlay on (weightOf) until it has caught up, so it never hands a pose over with a
 * jump. Like limitBlade, state from apply, once a frame.
 */
function limitPose(r: RawPose, lim: BladeLim, time: number, dims: BodyDims): RawPose {
  const dt = time - lim.pt, f = fitBody(r, dims);
  const keep = (o: RawPose, p: ReturnType<typeof fitBody>, lag: boolean): RawPose => {
    lim.out = copyRaw(o); lim.h0 = { ...p.arms[0].hand }; lim.h1 = { ...p.arms[1].hand }; lim.heel = { ...p.blade }; lim.pt = time; lim.lag = lag;
    return o;
  };
  if (!lim.out || lim.pt < 0 || dt <= 0 || dt > 0.1) return keep(r, f, false);
  const hMax = HAND_SPEED * dt, bMax = HEEL_SPEED * dt;
  const over = (p: ReturnType<typeof fitBody>): number => Math.max(Math.max(d3(p.arms[0].hand, lim.h0), d3(p.arms[1].hand, lim.h1)) / hMax, d3(p.blade, lim.heel) / bMax);
  if (over(f) <= 1) return keep(r, f, false);
  let lo = 0, hi = 1, best = lim.out, bf = fitBody(lim.out, dims);
  for (let i = 0; i < 5; i++) {
    const mid = (lo + hi) / 2, m = upperPart(lim.out, r, mid), mf = fitBody(m, dims);
    if (over(mf) <= 1) { lo = mid; best = m; bf = mf; } else hi = mid;
  }
  return keep(best, bf, true);
}

/** A board battle stance amount: smooth of the slot's. */
const am = (sl: BattleSlot, k: StanceKey): number => smooth(sl.st[k]);
const anyOf = (sl: BattleSlot, keys: readonly StanceKey[]): boolean => keys.some((k) => sl.st[k] > 0);
const maxAm = (sl: BattleSlot, keys: readonly StanceKey[]): number => keys.reduce((m, k) => Math.max(m, am(sl, k)), 0);

function boardApply(raw: RawPose, anim: SkaterAnim, s: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose {
  const sl = battleSlotOf(anim);
  if (!sl || !(anyOf(sl, BOARD) || sl.lim.board.lag)) return raw;
  // A pinned or pinning man is drawn where the pin puts him: everything he reaches for is reckoned from there.
  const o = pinOffset(anim, s, ctx, pinOut);
  const at = o.x === 0 && o.z === 0 ? s : { ...s, pos: { x: s.pos.x + o.x, y: s.pos.y + o.z } };
  const g: Geo = { s: at, ctx, dims, sl: sl.recs.boardBattle, st: sl.st, ax: sl.ax, ay: sl.ay };
  let r = raw;
  const mix = (k: number, f: (b: RawPose) => RawPose): void => { if (k > 0) r = mixStance(r, f(r), k, dims); };
  mix(am(sl, 'shield'), (b) => shieldPose(b, g));
  mix(am(sl, 'lean'), (b) => leanPose(b, g));
  mix(am(sl, 'drive'), (b) => drivePose(b, g, am(sl, 'inside')));
  mix(am(sl, 'scrum'), (b) => scrumPose(b, g, am(sl, 'ahead')));
  mix(am(sl, 'pinner'), (b) => pinnerPose(b, g));
  mix(am(sl, 'pinned'), (b) => pinnedPose(b, g));
  // The dig: the stick jabbing at the puck (the last round's winner on it).
  mix(am(sl, 'dig'), (b) => digPose(b, g));
  mix(am(sl, 'support'), (b) => supportPose(b, g));
  mix(am(sl, 'win'), (b) => winPose(b, g));
  mix(am(sl, 'lose'), (b) => losePose(b, g));
  return limitPose(limitBlade(r, sl.lim.board, ctx.time, maxAm(sl, BOARD)), sl.lim.board, ctx.time, dims);
}

const downOff = (anim: SkaterAnim): number => 1 - styleShare(anim.gait, 'down');
const limOf = (keys: readonly StanceKey[]): 'board' | 'net' | 'race' => (keys === BOARD ? 'board' : keys === NET ? 'net' : 'race');
function weightOf(keys: readonly StanceKey[]) {
  return (anim: SkaterAnim, s: SkaterSample, ctx: AnimContext): number => {
    if (!s.onIce) return 0;
    const sl = battleSlotOf(anim);
    if (!sl || !(anyOf(sl, keys) || sl.lim[limOf(keys)].lag)) return 0;
    // A poke check of his (contact.ts, applied before these) takes over his stick and body as it comes on.
    const w = downOff(anim) * (1 - Math.min(1, pokeOverlay.weight(anim, s, ctx)));
    return w > 1e-4 ? w : 0;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The pin's drawn contact

/** The pinned man is drawn toward the boards by up to this (m), leaving this gap (m) to them. */
const PIN_TO_BOARDS = 0.3, PIN_GAP = 0.04;
/** The pinner is drawn at most this far (m) from his engine place to be on the pinned man's back. */
const PIN_REACH = 0.33;
const pinOut = { x: 0, z: 0 };
const gapN = { x: 0, z: 0 };
/** How far (m, along the boards' normal) the pinned man `P` is drawn in toward the boards at pin amount `k`. */
function pinnedShift(sl: BattleRec, P: SkaterSample, k: number): number {
  const gap = boardsGap(P.pos.x, P.pos.y, gapN);
  // Not away from the puck: only as far as the puck is in front of him toward the boards (in his feet), not behind him.
  const ahead = smooth(((sl.sx - P.pos.x) * sl.nx + (sl.sy - P.pos.y) * sl.ny + 0.4) / 0.6);
  return clamp(gap - radiusOfWeight(weightOfDims(P.dims)) - PIN_GAP, 0, PIN_TO_BOARDS) * k * ahead;
}

/**
 * Where the pin wants the two men drawn: the pinned man moved in toward the boards (as far as his place allows), the
 * pinner squarely behind him along the boards' normal, the two bodies touching (their two radii apart, so the body pass
 * has nothing to push). Both men work it out alike from the same slot amounts and samples, so they agree.
 */
function pinOffset(anim: SkaterAnim, s: SkaterSample, ctx: AnimContext, out: { x: number; z: number }): { x: number; z: number } {
  out.x = 0; out.z = 0;
  const slot = battleSlotOf(anim);
  if (!slot || !s.onIce) return out;
  const sl = slot.recs.boardBattle;
  if (sl.pinned === null) return out;
  const amPinned = sl.pinned === s.id ? slot.st.pinned : 0, amPinner = sl.pinned !== s.id && (s.id === sl.a || s.id === sl.b) ? slot.st.pinner : 0;
  const k = smooth(Math.max(amPinned, amPinner));
  if (!(k > 0)) return out;
  const P = ctx.skaters.get(sl.pinned);
  if (!P || !P.onIce) return out;
  const rP = radiusOfWeight(weightOfDims(P.dims));
  const toB = pinnedShift(sl, P, k);
  if (amPinned > 0) { out.x = sl.nx * toB; out.z = sl.ny * toB; return out; }
  const rQ = radiusOfWeight(weightOfDims(s.dims));
  // Round the pinned man (as drawn), from where the engine has the pinner to squarely behind him, never through him:
  // heading and distance from him interpolated by the amount, and no further along than PIN_REACH allows.
  const px = P.pos.x + sl.nx * toB, py = P.pos.y + sl.ny * toB, rs = rP + rQ;
  const ex = s.pos.x - px, ey = s.pos.y - py, er = Math.hypot(ex, ey) || rs;
  const ha = Math.atan2(ey, ex), hb = Math.atan2(-sl.ny, -sl.nx), dh = wrap(hb - ha);
  const at = (u: number): { x: number; y: number } => {
    const h = ha + dh * u, r = er + (Math.max(rs, Math.min(er, rs)) - er) * u;
    return { x: px + Math.cos(h) * r - s.pos.x, y: py + Math.sin(h) * r - s.pos.y };
  };
  // (With the engine's pinner on the far side of him, nearly opposite where he should be, he is left where he is: going
  // round would have to pick a side, and the side flips as the angle passes through it.)
  let u = k * smooth((Math.PI - Math.abs(dh)) / 0.8), q = at(u);
  for (let i = 0; i < 8 && Math.hypot(q.x, q.y) > PIN_REACH; i++) { u *= 0.75; q = at(u); }
  if (Math.hypot(q.x, q.y) > PIN_REACH) { const l = Math.hypot(q.x, q.y); q = { x: (q.x * PIN_REACH) / l, y: (q.y * PIN_REACH) / l }; }
  out.x = fin(q.x); out.z = fin(q.y);
  return out;
}

export const boardBattleOverlay: Overlay = {
  id: 'boardBattle', weight: weightOf(BOARD), apply: boardApply,
  offset: (anim, s, ctx) => pinOffset(anim, s, ctx, pinOut),
};

// ---------------------------------------------------------------------------------------------------------------
// Net front

function netApply(raw: RawPose, anim: SkaterAnim, s: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose {
  const sl = battleSlotOf(anim);
  if (!sl || !(anyOf(sl, NET) || sl.lim.net.lag)) return raw;
  const g: Geo = { s, ctx, dims, sl: sl.recs.netFront, st: sl.st, ax: sl.ax, ay: sl.ay };
  const free = am(sl, 'free'), tied = am(sl, 'tied'), hh = dims.hipHeight;
  let r = raw;
  const att = am(sl, 'att'), def = am(sl, 'def');
  if (att > 0) {
    // Planted wide in front, facing the puck, blade on the ice for a tip; tied up: his stick lifted, pushed back.
    const f = Number.isNaN(g.sl.face) ? s.facing : g.sl.face, h = headingOf(g, Math.cos(f), Math.sin(f));
    const out = stance(turned(r, h, 1.15), 0.36, 0, 0.04);
    const tw = turnOf(h, 1.15);
    const a: RawPose = {
      ...out, hipY: out.hipY - (0.11 - 0.05 * free) * hh, pitch: out.pitch + 0.15 - 0.25 * tied, look: clamp(wrap(h - tw), -1, 1) * 0.7,
      lookDown: 0, twoHands: 1, top: v3(0.24, 0.04 + 0.2 * tied, 0.12),
    };
    r = mixStance(r, bladeAt(a, along(tw - out.yaw, 0.95 + 0.15 * free, -0.25, 0.45 * tied), dims), att, dims);
  }
  if (def > 0) {
    const o = otherMan(g, g.sl.a);
    if (o) {
      // Behind him, leaning in, his glove and forearm driven into his back, the stick one-handed at his skates; tied:
      // the blade lifting the attacker's stick; free: the push off, the stick back on the ice.
      const out = turned(r, o.h, 1.3);
      const tw = turnOf(o.h, 1.3) - out.yaw;
      // Leaning toward him whichever way the engine has him facing (at most sideways).
      const L = 0.6 - 0.35 * free, lh = clamp(o.h, -1.6, 1.6);
      const d0: RawPose = {
        ...out, hipY: out.hipY - 0.1 * hh, pitch: out.pitch + L * Math.cos(lh), roll: out.roll + L * Math.sin(lh), lookDown: 0.05, twoHands: 0,
        top: along(tw, 0.3, 0.18, 0.1),
      };
      d0.freeRel = gloveOn(d0, o.h, o.d - 0.3 - 0.15 * free, -0.05, 1.1 - 0.2 * free, dims);
      const stick = along(tw, clamp(o.d, 0.8, 1.2), -0.3, 0), lift = along(tw, clamp(o.d - 0.1, 0.6, 1.1), -0.25, 0.3);
      const target = v3(stick.x + (lift.x - stick.x) * tied, lift.y * tied, stick.z + (lift.z - stick.z) * tied);
      r = mixStance(r, bladeAt(d0, target, dims), def, dims);
    }
  }
  return limitPose(limitBlade(r, sl.lim.net, ctx.time, maxAm(sl, NET)), sl.lim.net, ctx.time, dims);
}
export const netFrontOverlay: Overlay = { id: 'netFront', weight: weightOf(NET), apply: netApply };

// ---------------------------------------------------------------------------------------------------------------
// Loose-puck races

function raceApply(raw: RawPose, anim: SkaterAnim, s: SkaterSample, ctx: AnimContext, dims: BodyDims): RawPose {
  const sl = battleSlotOf(anim);
  if (!sl || !(anyOf(sl, RACE) || sl.lim.race.lag)) return raw;
  const g: Geo = { s, ctx, dims, sl: sl.recs.looseRace, st: sl.st, ax: sl.ax, ay: sl.ay };
  const hh = dims.hipHeight;
  let r = raw;
  const k = Math.max(am(sl, 'race'), am(sl, 'raceWin'), am(sl, 'raceLose'));
  if (k > 0) {
    // Low, reaching one-handed for the puck; a glove on the other man when he is alongside.
    const p = aimPt(g), f = Number.isNaN(g.sl.face) ? s.facing : g.sl.face;
    const out = turned(r, headingOf(g, Math.cos(f), Math.sin(f)), 0.6);
    const lose = am(sl, 'raceLose');
    const rc: RawPose = {
      ...out, hipY: out.hipY - 0.09 * hh, pitch: out.pitch + 0.28 + 0.15 * lose, lookDown: 0.25, look: 0,
      top: v3(0.44, 0.16, 0.18), twoHands: 0.15,
    };
    const o = otherMan(g, mainOther(g));
    if (o) {
      const near = smooth(g.sl.hold);
      if (near > 0) rc.freeRel = mixV(rc.freeRel, gloveOn(rc, o.h, o.d - 0.3, 0, 1.05, dims), near);
    }
    const win = am(sl, 'raceWin');
    const to = reachable(p, REACH + 0.2, 0);
    // The winner's blade on the puck.
    r = mixStance(r, bladeAt(rc, win > 0 ? mixV(to, reachable(p, 1.9, 0), win) : to, dims), k, dims);
  }
  return limitPose(limitBlade(r, sl.lim.race, ctx.time, k), sl.lim.race, ctx.time, dims);
}
export const raceOverlay: Overlay = { id: 'race', weight: weightOf(RACE), apply: raceApply };

/** The battle overlays in the order they are registered (after the contact overlays). */
export const BATTLE_OVERLAYS: readonly Overlay[] = [battleTrack as Overlay, boardBattleOverlay, netFrontOverlay, raceOverlay];
/** Whether any battle stance is on him (for tests). */
export const battleOn = (anim: SkaterAnim): boolean => { const sl = battleSlotOf(anim); return !!sl && STANCES.some((k) => sl.st[k] > 0); };
