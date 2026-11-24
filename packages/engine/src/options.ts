/**
 * The carrier's options and what each is worth (Task 5). Every option he has (shoot, pass to each teammate he sees,
 * carry to a lane, rim it round the boards, dump it in, clear it, protect it) gets a value:
 *
 *   value = chance it works * (threat it leads to - threat here) - (1 - that chance) * what losing it here costs
 *
 * where `threat` is how much having the puck at a spot is worth (about its chance to score on this possession) and
 * losing it here costs the threat here plus TUNING.value.turnoverCost times the other side's threat from here. He then
 * picks the best value as he sees it (chooseOption: each value seen with an error that shrinks with IQ and poise and
 * grows with pressure; the option he is committed to is favoured by TUNING.value.stick).
 *
 * The situation removes options, it never picks one: on a breakaway (a clear path to the net) he shoots, goes at the
 * net or passes only to a teammate level or ahead who is better placed; on an odd-man rush he passes only across or
 * ahead; pressured below the dots he protects, cycles (rims) or shoots and never throws it to the point; behind the
 * net he holds it there, passes out front or wraps it round. And never an option that puts his own team offside.
 *
 * Positions here are attack-relative for the carrier's side: rx toward the net he attacks (goal line 27.13, blue line
 * 7.62), ly to his left.
 */
import { goalieShade as goalieShade_, pressureOn as pressureOn_ } from './actions';
import { composite as composite_ } from './attributes';
import { DT as DT_, PERIOD_SECONDS as PERIOD_SECONDS_, PERIODS as PERIODS_ } from './constants';
import { planOf as planOf_ } from './commit';
import { clearPathToNet as clearPathToNet_, laneWidth as laneWidth_, passLaneWidth as passLaneWidth_, spaceAt as spaceAt_ } from './lanes';
import { distToBoards as distToBoards_, RINK as RINK_ } from './rink';
import { bodyRadius as bodyRadius_ } from './skating';
import { isTiedUp as isTiedUp_, scoreMargin as scoreMargin_, steeredByContest as steeredByContest_ } from './team-play';
import { TUNING } from './tuning';
import { dcos as dcos_, dexp as dexp_, dpow as dpow_, dsin as dsin_ } from './dmath';
import type { Rng } from './rng';
import type { CarrierPlan, CarryLane, GameState, PlayerDef, SkaterState, Tactics } from './types';
import type { Vec2 } from './vec';
// Local bindings of hot imports (a call through an imported binding costs more under the test runner). Never alias
// in a module on an import cycle: this one is not on one (options imports nothing that imports it).
const goalieShade = goalieShade_;
const pressureOn = pressureOn_;
const composite = composite_;
const DT = DT_;
const PERIOD_SECONDS = PERIOD_SECONDS_;
const PERIODS = PERIODS_;
const planOf = planOf_;
const clearPathToNet = clearPathToNet_;
const laneWidth = laneWidth_;
const passLaneWidth = passLaneWidth_;
const spaceAt = spaceAt_;
const RINK = RINK_;
const distToBoards = distToBoards_;
const bodyRadius = bodyRadius_;
const isTiedUp = isTiedUp_;
const scoreMargin = scoreMargin_;
const steeredByContest = steeredByContest_;
const dcos = dcos_;
const dexp = dexp_;
const dsin = dsin_;
const dpow = dpow_;

export type Situation = {
  rx: number; ly: number; zone: 'D' | 'N' | 'O'; pressure: number;
  /** Nobody between him and the net (clearPathToNet) once he is past his own blue line. */
  breakaway: boolean;
  /** Attackers level with or ahead of the puck (within 5 m behind it) outnumber the defenders goal-side of it, two or fewer of them. */
  oddMan: boolean;
  /** Under pressure (0.5 or more) below the faceoff dots (rx > 21.03). */
  pressuredLow: boolean;
  /** Behind the goal line he attacks, within 4 m of the middle. */
  behindNet: boolean;
};

export type Option =
  | { kind: 'shoot'; value: number }
  | { kind: 'pass'; toId: string; value: number }
  | { kind: 'carry'; lane: CarryLane; to: Vec2; value: number }
  | { kind: 'rim'; toId: string | null; value: number }
  | { kind: 'dump'; value: number } | { kind: 'protect'; value: number } | { kind: 'clear'; value: number };

const GOAL = RINK.goalLineX;
const BLUE = RINK.blueLineX;
const B = TUNING.brain;
const V = TUNING.value;
const L = TUNING.lanes;
/** The faceoff dots' rx: below them is "down low". */
const DOTS = 21.03;
/** Behind the net: within this far (m) of the middle. */
const BEHIND_Y = 4;
/** Odd-man rush: attackers within this far (m) behind the puck count. */
const ODD_BEHIND = 5;
const ODD_NEAR = 8;
/** In the zone (no breakaway) a carry at the net goes no closer than the top of the slot: NET_LANE_OUT (m) out. */
const NET_LANE_OUT = 5;
/** A breakaway shoots from inside this far (m) of the net; inside DEKE_FROM (m) his carry at the net cuts DEKE_ACROSS (m) across the goalie. */
const BREAKAWAY_SHOT = 12;
/** A breakaway needs nobody within this far (m) of him, beside or behind him as well as ahead. */
const BREAKAWAY_ALONE = 4;
const DEKE_FROM = 6;
const DEKE_ACROSS = 1.5;
/** A pass on a rush goes only to a teammate no more than this far (m) behind him. */
const LEVEL = 1;
/** Pressured low, no pass to anyone above this rx. */
const LOW_PASS_MIN_RX = 15;
/** From behind the net, passes go out front: to a teammate below this rx. */
const OUT_FRONT_MIN_RX = 15;
/** A pass in his first PASS_SETTLE (s) with the puck has less chance of working (SETTLE_MIN of it at once). */
const PASS_SETTLE = 1;
/** A rim is offered only within this far (m) of the boards, or from behind the goal line. */
const RIM_BOARDS = 3;
/** A rim to nobody gets this share of its race chance. */
const BLIND_RIM = 0.6;
const SETTLE_MIN = 0.9;
/** A pass in the zone that moves the puck ACROSS_FULL (m) or more across adds V.goal * PASS_ACROSS * the receiver's shot quality * his skill to its worth (the goalie must move). */
const PASS_ACROSS = 0.6;
const ACROSS_FULL = 6;
/** A teammate more than 100 degrees off his facing is behind his back: seen only with vision of BEHIND_VISION or more. */
const BEHIND_COS = -0.1736;
const BEHIND_VISION = 60;
/** Wraparound: to (WRAP_RX, +-WRAP_LY), the post the goalie is further from; a shot within WRAP_SHOT (m) of a post is a wrap shot. */
const WRAP_RX = 26.7;
const WRAP_LY = 1.3;
const WRAP_SHOT = 1.0;
/** A wrap shot's chance to score: V.goal * WRAP_GOAL * clamp(goalie's distance from the post / WRAP_OPEN, 0.1, 1) * shooting skill. */
const WRAP_GOAL = 0.55;
const WRAP_OPEN = 1.2;
/** The office: (OFFICE_RX, +-OFFICE_LY), for a carrier low on the wall (rx > DOTS, |ly| > OFFICE_WALL) with nobody behind the net. */
const OFFICE_RX = 28.3;
const OFFICE_LY = 1.5;
const OFFICE_WALL = 4;
/** Holding behind the net: at HOLD_RX, within HOLD_LY of the middle (the frame between him and the nearest opponent). */
const HOLD_RX = 28.7;
const HOLD_LY = 0.6;
const HOLD_KEEP = 0.9;
/** Carry lanes: how far (m) ahead he aims in the offensive zone, and up ice elsewhere. */
const CARRY_IN_ZONE = 5;
/** A rim goes to the far low corner (rx GOAL - RIM_BACK, |ly| RIM_LY) with nobody named. */
const RIM_BACK = 1;
const RIM_LY = 8;
/** A clear goes up the boards to (CLEAR_RX, +-CLEAR_LY). */
const CLEAR_RX = -3.6;
const CLEAR_LY = 10;
const CLEAR_IDLE = 0.04;
/** Protecting under full pressure he loses it with chance base - perPoint * (puckHandling .5, strength .5). */
const PROTECT_LOSS = { base: 0.4, perPoint: 0.0025 };
const PROTECT_IDLE = 0.01;
/** A shooting lane narrower than these (m) scales the shot's chance by these. */
const SHOT_LANE = [0.5, 1.0] as const;
const SHOT_BLOCKED = [0.3, 0.6] as const;
/** The share of TUNING.scoreEffects' shot factor applied to a shot's value. */
const SCORE_SOFT = 0.5;
const SHOOTING = { shootingAccuracy: 0.6, shootingPower: 0.4 };
const PROTECTING = { puckHandling: 0.5, strength: 0.5 };

const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const sgn = (v: number): 1 | -1 => (v >= 0 ? 1 : -1);

/** 0..1: the shot-quality part of threat (distance and angle to the net centre), 0 outside the zone, behind the line or beyond maxShotDistance. */
function shotQuality(rx: number, ly: number): number {
  const dx = GOAL - rx;
  if (dx < 0.3 || rx < BLUE) return 0;
  const d = hyp(dx, ly);
  if (d > B.maxShotDistance) return 0;
  return dexp(-d / B.shotDistanceScale) * (dx / d);
}

/** How much having the puck at (rx, ly) is worth to the team that has it: about its chance to score on this possession, 0 to about 0.2. */
export function threat(rx: number, ly: number): number {
  const r = clamp((rx + 30) / 60, 0, 1);
  return 0.005 + 0.035 * r * r + 0.15 * shotQuality(rx, ly);
}

/** A spot is worth less with an opponent near it: 0.6 with one on top of it, 1 with nobody within 5 m. */
const openAt = (space: number): number => 0.6 + 0.4 * clamp((space - 1) / 4, 0, 1);

/**
 * `t` can be passed to: on the ice, not heading off, not down, not steered by a contest, and his stick not tied up by
 * a net-front defender.
 */
export function canReceivePass(state: GameState, t: SkaterState): boolean {
  return t.onIce && !t.leaving && t.downT === 0 && !steeredByContest(state, t) && !isTiedUp(state, t.id);
}

function findSkater(state: GameState, id: string): SkaterState | null {
  for (const s of state.skaters) if (s.id === id) return s;
  return null;
}

function readInto(state: GameState, s: SkaterState, out: Situation): Situation {
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const rx = p.x * dir, ly = p.y * dir;
  out.rx = rx;
  out.ly = ly;
  out.zone = rx > BLUE ? 'O' : rx < -BLUE ? 'D' : 'N';
  out.pressure = pressureOn(state, s);
  const srx = s.pos.x * dir;
  // A clear path with a man right on him (within BREAKAWAY_ALONE, from any side) is no breakaway: he is caught.
  out.breakaway = srx > -BLUE && srx < GOAL && clearPathToNet(state, s) && spaceAt(state, s.side, s.pos) > BREAKAWAY_ALONE;
  let att = 0, def = 0;
  if (!out.breakaway && srx > -BLUE) {
    // Goal-side: nearer the net centre than the puck (down low, the men in front of the net are goal-side of a puck on the wall).
    const pd = hyp(GOAL - rx, ly);
    for (const o of state.skaters) {
      if (!o.onIce || o.downT > 0) continue;
      const orx = o.pos.x * dir;
      if (o.side === s.side) { if (!o.leaving && orx >= rx - ODD_BEHIND) att++; }
      else if (hyp(GOAL - orx, o.pos.y * dir) < pd) def++;
    }
  }
  // A rush decision: within ODD_NEAR (m) of the net it is a scoring chance, not an odd-man rush.
  out.oddMan = !out.breakaway && srx > -BLUE && hyp(GOAL - rx, ly) > ODD_NEAR && def <= 2 && att > def;
  out.pressuredLow = out.pressure >= 0.5 && rx > DOTS;
  out.behindNet = rx > GOAL && Math.abs(ly) < BEHIND_Y;
  return out;
}

/** The carrier's situation now (a new object). */
export function readSituation(state: GameState, s: SkaterState): Situation {
  return readInto(state, s, { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false });
}

/** The situation of the last listOptions call (scratch, read by decideCarrier). */
export const lastSituation: Situation = { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false };

/**
 * A habit multiplies a value (a positive one by 0.6 + 0.8 * tendency, a negative one is divided by it) and leans it by
 * TUNING.value.habitShift * (tendency - 0.5): a passer likes to pass even when nothing else is good either.
 */
const habit = (v: number, tendency: number): number => { const h = 0.6 + 0.8 * tendency; return (v >= 0 ? v * h : v / h) + V.habitShift * (tendency - 0.5); };

// Scratch for the passes he sees, best first (refilled on every call).
const passIds: string[] = [];
const passValues: number[] = [];
const tw: Vec2 = { x: 0, y: 0 };

/**
 * Every option he has, each with value = chance it works * (threat it leads to - threat here) - (1 - that chance) *
 * what losing it here costs. Refills and returns `out`.
 */
export function listOptions(state: GameState, me: PlayerDef, defs: Map<string, PlayerDef>, tactics: Tactics, out: Option[]): Option[] {
  void tactics;
  out.length = 0;
  const s = findSkater(state, me.id);
  if (s === null) { out.push({ kind: 'protect', value: 0 }); return out; }
  const sit = readInto(state, s, lastSituation);
  const a = me.attrs, tend = me.tendencies;
  const side = s.side, dir = state.attackDir[side];
  const p = state.puck.pos;
  const { rx, ly, pressure } = sit;
  const srx = s.pos.x * dir, sly = s.pos.y * dir;
  const outside = rx <= BLUE;
  const mode = sit.breakaway ? 'break' : sit.oddMan ? 'odd' : sit.behindNet ? 'behind' : sit.pressuredLow ? 'low' : 'normal';

  const here = threat(rx, ly) * (0.6 + 0.4 * (1 - pressure));
  const loss = here + V.turnoverCost * threat(-rx, -ly);
  const valueOf = (chance: number, to: number, lose: number = loss): number => chance * (to - here) - (1 - chance) * lose;

  // How long he has had it: the longer, the more he wants to move it on.
  const t = state.touches;
  const since = t.side === side && t.ids[t.ids.length - 1] === s.id ? t.ticks[t.ticks.length - 1]! : state.tick;
  const held = Math.min(V.holdCap, (state.tick - since) * DT);
  const moveOn = V.hold * held;
  // Passing: worth less in his first PASS_SETTLE s with it (he has not settled it), more the longer he has it.
  const passOn = V.hold * B.holdBoost.pass * (held - PASS_SETTLE), shootOn = moveOn * B.holdBoost.shoot;
  const settled = SETTLE_MIN + (1 - SETTLE_MIN) * clamp(held / PASS_SETTLE, 0, 1);

  // Offside: with the puck outside the zone, any teammate wholly in it (or about to be) puts his team offside if the
  // puck goes in now.
  let mateOffside = false;
  for (const m of state.skaters) {
    if (!outside || !m.onIce || m.side !== side || m === s) continue;
    const mx = (m.pos.x + Math.max(0, m.vel.x * dir) * dir * B.offsideLookahead) * dir;
    const def = defs.get(m.id);
    if (mx > BLUE + (def ? bodyRadius(def.weightKg) : 0.4)) mateOffside = true;
  }

  // ---- shoot ----
  const shootSkill = B.shootSkill.base + composite(a, SHOOTING) * B.shootSkill.perPoint;
  let g = 0, shootScore = 1;
  const dNet = hyp(GOAL - rx, ly);
  const shootAllowed = mode === 'break' ? dNet < BREAKAWAY_SHOT : mode !== 'behind';
  if (shootAllowed) {
    const q = shotQuality(rx, ly);
    if (q > 0) {
      const open = clamp(Math.abs(goalieShade(state, side)) / B.openNetShade, 0, 1);
      const calm = 1 - pressure * (B.calm.base - a.poise * B.calm.perPoise);
      const se = TUNING.scoreEffects;
      const margin = scoreMargin(state, side);
      const lead = state.score[side] - state.score[side === 'home' ? 'away' : 'home'];
      const late = state.period >= PERIODS && lead === -1 ? 1 - state.clock / PERIOD_SECONDS : 0;
      const scoreShoot = margin === 'ahead' ? se.leaderShoot : Math.min(se.maxShoot, (margin === 'behind' ? se.trailerShoot : 1) * (1 + se.latePush * late));
      g = V.goal * q * shootSkill * (B.openNetWeight[0] + B.openNetWeight[1] * open) * dpow(calm, B.shootPressure);
      // A defender in his shooting lane blocks or smothers it: under SHOT_LANE[1] m of clear ice g is scaled by
      // SHOT_BLOCKED[1], under SHOT_LANE[0] by SHOT_BLOCKED[0].
      tw.x = GOAL * dir; tw.y = 0;
      const sw = laneWidth(state, side, p, tw);
      if (sw < SHOT_LANE[0]) g *= SHOT_BLOCKED[0]; else if (sw < SHOT_LANE[1]) g *= SHOT_BLOCKED[1];
      // Half the score effect's size: on a value near zero its full size would swing shooting by far more than real
      // teams change.
      shootScore = 1 + (scoreShoot - 1) * SCORE_SOFT;
    }
    // Near a post (a wraparound's end): the chance comes from how far the goalie is from that post.
    const postLy = sgn(sly) * RINK.netHalfWidth;
    if (hyp(GOAL - srx, postLy - sly) <= WRAP_SHOT) {
      const gl = state.goalies[side === 'home' ? 'away' : 'home'].pos;
      const gd = hyp(gl.x * dir - GOAL, gl.y * dir - postLy);
      g = Math.max(g, V.goal * WRAP_GOAL * clamp(gd / WRAP_OPEN, 0.1, 1) * shootSkill);
    }
    // A shot scores with chance g; one that does not leaves his team the puck TUNING.value.shotKeep of the time, down
    // low on the boards (worth threat there), and otherwise loses what he has here. Score effects then scale its
    // value as a habit does (more eager when behind, less when comfortably ahead).
    if (g > 0) {
      const gc = clamp(g, 0, 0.97);
      const v = habit(gc * (1 - here) + (1 - gc) * (V.shotKeep * threat(GOAL - 2, sgn(ly) * 8) - here), tend.shoot);
      out.push({ kind: 'shoot', value: (v >= 0 ? v * shootScore : v / shootScore) + shootOn });
    }
  }

  // ---- passes ----
  const seen = 1 + Math.floor(a.vision / 25);
  passIds.length = 0;
  passValues.length = 0;
  const fc = dcos(s.facing), fs = dsin(s.facing);
  const passSkill = a.passing;
  for (const m of state.skaters) {
    if (!m.onIce || m.side !== side || m === s || !canReceivePass(state, m)) continue;
    const mrx = m.pos.x * dir, mly = m.pos.y * dir;
    const dx = m.pos.x - p.x, dy = m.pos.y - p.y;
    const l = hyp(dx, dy);
    if (l < B.passRange[0] || l > B.passRange[1]) continue;
    // Never one who would be offside: with the puck outside, nobody wholly in the zone (or about to be).
    if (outside) {
      const mx = (m.pos.x + Math.max(0, m.vel.x * dir) * dir * B.offsideLookahead) * dir;
      const def = defs.get(m.id);
      if (mx > BLUE + (def ? bodyRadius(def.weightKg) : 0.4)) continue;
    }
    if (mode === 'break' && (mrx < srx - LEVEL || threat(mrx, mly) <= threat(rx, ly))) continue;
    if (mode === 'odd' && mrx < srx - LEVEL) continue;
    if (mode === 'low' && (mrx <= DOTS || mrx < LOW_PASS_MIN_RX || isPoint(state, m))) continue;
    if (mode === 'behind' && (mrx < OUT_FRONT_MIN_RX || mrx > GOAL)) continue;
    // Behind his back: seen only with good vision.
    if ((dx * fc + dy * fs) / (l || 1) < BEHIND_COS && a.vision < BEHIND_VISION) continue;
    let chance = clamp(0.97 - 0.006 * Math.max(0, l - 12) - pressure * (0.3 - 0.002 * passSkill), 0.03, 0.97) * settled;
    // The goalie and the net frames are in the way of a pass as much as a skater is.
    const w = passLaneWidth(state, side, p, m.pos);
    if (w < 0.5) chance *= 0.2; else if (w < L.open) chance *= V.shadowed;
    const space = spaceAt(state, side, m.pos);
    if (space < L.space) chance *= 0.5 + space / 3;
    // A pass across the front of the net makes the goalie move: the receiver's shot is worth more (PASS_ACROSS).
    let to = threat(mrx, mly) * openAt(space);
    const qm = shotQuality(mrx, mly);
    if (qm > 0 && rx > BLUE) {
      const rd = defs.get(m.id);
      to += V.goal * PASS_ACROSS * qm * clamp(Math.abs(mly - ly) / ACROSS_FULL, 0, 1) * (rd ? B.shootSkill.base + composite(rd.attrs, SHOOTING) * B.shootSkill.perPoint : 1);
    }
    let v = valueOf(chance, to);
    // From inside the zone, a pass out to a man at or outside the line, who will carry it back in while the passer
    // (and whoever else) is still inside, puts them offside.
    if (!outside && mrx < BLUE + 1) v -= V.offside;
    v = habit(v, tend.pass) + passOn;
    let i = passValues.length;
    while (i > 0 && passValues[i - 1]! < v) i--;
    if (i >= seen) continue;
    passValues.splice(i, 0, v);
    passIds.splice(i, 0, m.id);
    if (passValues.length > seen) { passValues.length = seen; passIds.length = seen; }
  }
  for (let i = 0; i < passIds.length; i++) out.push({ kind: 'pass', toId: passIds[i]!, value: passValues[i]! });

  // ---- carry lanes ----
  const ph = a.puckHandling;
  const carry = (lane: CarryLane, trx: number, tly: number): void => {
    trx = clamp(trx, -GOAL, GOAL + 2.2);
    tly = clamp(tly, -RINK.halfWidth + 1.5, RINK.halfWidth - 1.5);
    // Never carry the puck in while a teammate is still in the zone.
    if (outside && mateOffside && trx > BLUE - B.holdUpGap) trx = BLUE - B.holdUpGap;
    tw.x = trx * dir; tw.y = tly * dir;
    const w = laneWidth(state, side, s.pos, tw);
    const block = w < 2.5 ? ((2.5 - w) / 2.5) * 0.5 : 0;
    const chance = clamp(0.95 - pressure * (0.35 - 0.002 * ph) - block, 0.03, 0.97);
    let v = valueOf(chance, threat(trx, tly) * openAt(spaceAt(state, side, tw)));
    v = habit(v, tend.carry) - moveOn;
    out.push({ kind: 'carry', lane, to: { x: tw.x + 0, y: tw.y + 0 }, value: v });
  };
  const ps = sgn(sly);
  if (mode === 'break') {
    if (dNet < DEKE_FROM) {
      const gl = state.goalies[side === 'home' ? 'away' : 'home'].pos;
      const gly = gl.y * dir;
      carry('net', GOAL - 1.2, gly + (sly >= gly ? -DEKE_ACROSS : DEKE_ACROSS));
    } else {
      const tx = GOAL - 1.5, l = hyp(tx - srx, -sly) || 1, k = Math.min(1, 6 / l);
      carry('net', srx + (tx - srx) * k, sly - sly * k);
    }
  } else if (mode === 'behind') {
    // Hold: the frame between him and the nearest opponent.
    let oly = 0, od = Infinity;
    for (const o of state.skaters) {
      if (!o.onIce || o.side === side || o.downT > 0) continue;
      const d = hyp(o.pos.x - s.pos.x, o.pos.y - s.pos.y);
      if (d < od) { od = d; oly = o.pos.y * dir; }
    }
    // Holding, the frame shields him and the passes out front stay open to him: he keeps HOLD_KEEP of the best one's worth.
    const hy = Math.abs(oly) > RINK.netHalfWidth ? -sgn(oly) * HOLD_LY : clamp(sly, -HOLD_LY, HOLD_LY);
    tw.x = HOLD_RX * dir; tw.y = hy * dir;
    const keep = clamp(0.97 - pressure * 0.1, 0.03, 0.97);
    const kept = passValues.length > 0 ? Math.max(0, passValues[0]! - passOn) * HOLD_KEEP : 0;
    out.push({ kind: 'carry', lane: 'hold', to: { x: tw.x + 0, y: tw.y + 0 }, value: keep * kept - (1 - keep) * loss - moveOn });
    // Wrap: to the post the goalie is further from, worth what a shot from there would be.
    const gl = state.goalies[side === 'home' ? 'away' : 'home'].pos;
    const grx = gl.x * dir, gly = gl.y * dir;
    const wy = hyp(grx - GOAL, gly - RINK.netHalfWidth) >= hyp(grx - GOAL, gly + RINK.netHalfWidth) ? 1 : -1;
    const gd = hyp(grx - GOAL, gly - wy * RINK.netHalfWidth);
    tw.x = WRAP_RX * dir; tw.y = wy * WRAP_LY * dir;
    const w = laneWidth(state, side, s.pos, tw);
    const chance = clamp(0.9 - pressure * 0.2 - (w < 1.5 ? (1.5 - w) * 0.3 : 0), 0.03, 0.97);
    const wrapG = V.goal * WRAP_GOAL * clamp(gd / WRAP_OPEN, 0.1, 1) * shootSkill;
    const v = habit(valueOf(chance, wrapG), tend.carry) - moveOn;
    out.push({ kind: 'carry', lane: 'wrap', to: { x: tw.x + 0, y: tw.y + 0 }, value: v });
  } else {
    if (mode !== 'low') {
      if (sit.zone === 'O') {
        const tx = GOAL - NET_LANE_OUT, l = hyp(tx - srx, -sly) || 1, k = Math.min(1, CARRY_IN_ZONE / l);
        carry('net', srx + (tx - srx) * k, sly - sly * k);
        carry('wide', Math.min(srx + CARRY_IN_ZONE, GOAL - 1), ps * Math.min(Math.abs(sly) + 1.5, 10.5));
        if (mode === 'normal') carry('middle', Math.min(srx + 3, 20), sly * 0.4);
      } else {
        carry('net', srx + B.carryAhead, sly * 0.6);
        carry('wide', srx + B.carryAhead, ps * 9);
        if (mode === 'normal') carry('middle', srx + B.carryAhead, 0);
      }
    }
    // The office: low on the wall with nobody of his behind the net.
    if (mode !== 'odd' && rx > DOTS && Math.abs(sly) > OFFICE_WALL && !teammateBehind(state, s)) carry('office', OFFICE_RX, ps * OFFICE_LY);
  }

  // ---- rim (the cycle) ----
  // Only along the boards (within RIM_BOARDS m of them) or from behind the goal line: from the slot a rim goes at the net.
  if ((mode === 'low' || mode === 'behind') && (distToBoards(p) <= RIM_BOARDS || rx > GOAL)) {
    let to: SkaterState | null = null;
    for (let k = 0; k < state.skaters.length; k++) {
      const m = state.skaters[k]!;
      if (!m.onIce || m.side !== side || m === s || !canReceivePass(state, m)) continue;
      const j = planOf(state, m.id).job;
      if (j === 'lowSupport' || j === 'office') { to = m; break; }
    }
    let drx: number, dly: number;
    if (to !== null) { drx = to.pos.x * dir; dly = to.pos.y * dir; } else { drx = GOAL - RIM_BACK; dly = -ps * RIM_LY; }
    tw.x = drx * dir; tw.y = dly * dir;
    // Round the boards to nobody is a puck thrown away unless his team is nearer it: BLIND_RIM of the race.
    const chance = race(state, s, tw, to) * (to === null ? BLIND_RIM : 1);
    const v = habit(valueOf(chance, threat(drx, dly) * openAt(spaceAt(state, side, tw))), tend.pass);
    out.push({ kind: 'rim', toId: to === null ? null : to.id, value: v });
  }

  // ---- dump (neutral zone) or clear (own zone) ----
  if (mode === 'normal' && sit.zone === 'N' && !mateOffside) {
    const D = TUNING.dump.spot;
    tw.x = D.x * dir; tw.y = D.y * dir;
    let chance = race(state, s, tw, null);
    tw.y = -tw.y;
    chance = (chance + race(state, s, tw, null)) / 2;
    let v = valueOf(chance, threat(D.x, D.y), here + V.turnoverCost * threat(-D.x, D.y));
    if (rx < 0) v -= V.icing;
    out.push({ kind: 'dump', value: habit(v, tend.dump) });
  }
  if (mode === 'normal' && sit.zone === 'D') {
    tw.x = CLEAR_RX * dir; tw.y = ps * CLEAR_LY * dir;
    const chance = race(state, s, tw, null);
    const v = valueOf(chance, threat(CLEAR_RX, ps * CLEAR_LY), V.turnoverCost * threat(-CLEAR_RX, -ps * CLEAR_LY));
    // Unpressured, a clear throws away a puck he could carry or pass out: it costs CLEAR_IDLE * (1 - pressure).
    out.push({ kind: 'clear', value: habit(v - CLEAR_IDLE * (1 - pressure), tend.dump) });
  }

  // ---- protect ----
  if (mode === 'normal' || mode === 'low') {
    const keep = clamp(0.97 - pressure * (PROTECT_LOSS.base - PROTECT_LOSS.perPoint * composite(a, PROTECTING)), 0.03, 0.97);
    // Unpressured, shielding the puck only stands still: it costs PROTECT_IDLE * (1 - pressure).
    out.push({ kind: 'protect', value: valueOf(keep, here) - moveOn - PROTECT_IDLE * (1 - pressure) });
  }
  if (out.length === 0) out.push({ kind: 'protect', value: 0 });
  return out;
}

/** Whether `m` is one of his team's point men (job pointStrong or pointWeak, or a defenceman at the point). */
function isPoint(state: GameState, m: SkaterState): boolean {
  const j = planOf(state, m.id).job;
  return j === 'pointStrong' || j === 'pointWeak' || ((m.slot === 'LD' || m.slot === 'RD') && m.pos.x * state.attackDir[m.side] < LOW_PASS_MIN_RX);
}

/** Whether a teammate of `s` is behind the net he attacks. */
function teammateBehind(state: GameState, s: SkaterState): boolean {
  const dir = state.attackDir[s.side];
  for (const m of state.skaters) if (m.onIce && m.side === s.side && m !== s && m.pos.x * dir > GOAL && Math.abs(m.pos.y) < BEHIND_Y) return true;
  return false;
}

/**
 * Chance a puck sent to `to` ends with his team: raceBase + racePerMetre * (how much nearer his nearest teammate, or
 * the man named, is than their nearest man), within [0.03, raceMax].
 */
function race(state: GameState, s: SkaterState, to: Vec2, named: SkaterState | null): number {
  let mate = Infinity, opp = Infinity;
  for (const o of state.skaters) {
    if (!o.onIce || o.downT > 0 || o === s) continue;
    const d = hyp(o.pos.x - to.x, o.pos.y - to.y);
    if (o.side === s.side) { if (named === null || o === named) mate = Math.min(mate, d); } else opp = Math.min(opp, d);
  }
  if (mate === Infinity) return 0.03;
  if (opp === Infinity) return V.raceMax;
  return clamp(V.raceBase + V.racePerMetre * (opp - mate), 0.03, V.raceMax);
}

const FRESH = Math.sqrt(1 - V.noise.persist * V.noise.persist);
const LANE_KEY: Record<CarryLane, number> = { net: 1, wide: 2, middle: 3, office: 4, wrap: 5, hold: 6 };
const KIND_KEY: Record<Option['kind'], number> = { shoot: 1, pass: 2, carry: 3, rim: 4, dump: 5, protect: 6, clear: 7 };

/** A 32-bit integer hash step (deterministic, integer maths only). */
function mix(h: number, v: number): number {
  h = Math.imul(h ^ v, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** A standard-normal-like error (sum of four uniforms, scaled) for option `o`, fixed for `seed`. */
function seenError(seed: number, o: Option): number {
  let h = mix(seed >>> 0, KIND_KEY[o.kind]);
  if (o.kind === 'carry') h = mix(h, LANE_KEY[o.lane]);
  if ((o.kind === 'pass' || o.kind === 'rim') && o.toId !== null) for (let i = 0; i < o.toId.length; i++) h = mix(h, o.toId.charCodeAt(i));
  let sum = 0;
  for (let k = 0; k < 4; k++) { h = mix(h, k + 1); sum += h / 4294967296; }
  return (sum - 2) * 1.7320508075688772;
}

/** Whether option `o` is what `plan` has him doing. */
function committed(o: Option, plan: CarrierPlan | null): boolean {
  if (plan === null || plan.kind !== o.kind) return false;
  if (o.kind === 'carry') return plan.lane === o.lane;
  if (o.kind === 'pass' || o.kind === 'rim') return plan.toId === o.toId;
  return true;
}

/** His pick: each value is seen with an error (TUNING.value.noise: base + perPoint * (100 - iq), more under pressure, less with poise), then the best seen is taken. */
export function chooseOption(options: readonly Option[], me: PlayerDef, sit: Situation, plan: CarrierPlan | null, rng: Rng): Option {
  const N = V.noise, a = me.attrs;
  const sd = Math.max(0.001, N.base + N.perPoint * (100 - a.iq) + N.pressure * sit.pressure - N.perPoise * a.poise);
  let best = options[0]!, bestV = -Infinity;
  for (const o of options) {
    // Most of his error in judging an option stays with him while he has the puck (keyed by the plan's seed and the
    // option); the rest is fresh at every look. Without a plan (his first look) it is all fresh.
    const z = plan !== null && plan.seed !== undefined ? N.persist * seenError(plan.seed, o) + FRESH * rng.gauss() : rng.gauss();
    const v = o.value + (committed(o, plan) ? V.stick : 0) + z * sd;
    if (v > bestV) { bestV = v; best = o; }
  }
  return best;
}
