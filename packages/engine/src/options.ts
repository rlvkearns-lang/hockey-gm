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
import { clearPathToNet as clearPathToNet_, laneWidth as laneWidth_, spaceAt as spaceAt_ } from './lanes';
import { canReceivePass as canReceivePass_, planPass as planPass_, type PassPlan } from './passing';
import { distToBoards as distToBoards_, RINK as RINK_ } from './rink';
import { bodyRadius as bodyRadius_ } from './skating';
import { scoreMargin as scoreMargin_ } from './team-play';
import { TUNING } from './tuning';
import { dcos as dcos_, dexp as dexp_, dpow as dpow_, dsin as dsin_ } from './dmath';
import type { Rng } from './rng';
import type { CarrierPlan, CarryLane, GameState, PlayerDef, SkaterState } from './types';
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
const canReceivePass = canReceivePass_;
const planPass = planPass_;
const spaceAt = spaceAt_;
const RINK = RINK_;
const distToBoards = distToBoards_;
const bodyRadius = bodyRadius_;
const scoreMargin = scoreMargin_;
const dcos = dcos_;
const dexp = dexp_;
const dsin = dsin_;
const dpow = dpow_;

export type Situation = {
  rx: number; ly: number; zone: 'D' | 'N' | 'O'; pressure: number;
  /** Nobody between him and the net (clearPathToNet), and no opponent skater nearer the net than he is, once he is past his own blue line. */
  breakaway: boolean;
  /** Attackers level with or ahead of the puck (within 5 m behind it) outnumber the defenders goal-side of it, two or fewer of them. */
  oddMan: boolean;
  /** Under pressure (0.5 or more) below the faceoff dots (rx > 21.03). */
  pressuredLow: boolean;
  /** Behind the goal line he attacks, within 4 m of the middle. */
  behindNet: boolean;
  /** Seconds he has had the puck (since his touch began), at most TUNING.value.holdCap. */
  held: number;
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
/** The weights of the carrier's valuation (TUNING.options). */
const O = TUNING.options;
const RIM = TUNING.rim;
/** A clear is valued at the spot it is aimed at (TUNING.rim.clear.x), CLEAR_LY (m) out from the middle (off the boards). */
const CLEAR_LY = 10;
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
/** A rim is offered only within this far (m) of the boards, or from behind the goal line. */
const RIM_BOARDS = 3;
/** A teammate more than 100 degrees off his facing is behind his back: seen only with vision of BEHIND_VISION or more. */
const BEHIND_COS = -0.1736;
const BEHIND_VISION = 60;
/** Wraparound: to (WRAP_RX, +-WRAP_LY), the post the goalie is further from; a shot within WRAP_SHOT (m) of a post is a wrap shot. */
const WRAP_RX = 26.7;
const WRAP_LY = 1.3;
const WRAP_SHOT = 1.0;
/** The office: (OFFICE_RX, +-OFFICE_LY), for a carrier low on the wall (rx > DOTS, |ly| > OFFICE_WALL) with nobody behind the net. */
const OFFICE_RX = 28.3;
const OFFICE_LY = 1.5;
const OFFICE_WALL = 4;
/** Holding behind the net: at HOLD_RX, within HOLD_LY of the middle (the frame between him and the nearest opponent). */
const HOLD_RX = 28.7;
const HOLD_LY = 1.4;
/** Carry lanes: how far (m) ahead he aims in the offensive zone, and up ice elsewhere. */
const CARRY_IN_ZONE = 5;
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
  return O.threat.base + O.threat.ice * r * r + O.threat.shot * shotQuality(rx, ly);
}

/** A spot is worth less with an opponent near it: O.openAt.min with one within `from` m, 1 with nobody within from + over. */
const openAt = (space: number): number => O.openAt.min + (1 - O.openAt.min) * clamp((space - O.openAt.from) / O.openAt.over, 0, 1);

export { canReceivePass } from './passing';

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
  out.breakaway = srx > -BLUE && srx < GOAL && clearPathToNet(state, s) && spaceAt(state, s.side, s.pos) > BREAKAWAY_ALONE && !defenderGoalSide(state, s);
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
  const t = state.touches;
  const since = t.side === s.side && t.ids[t.ids.length - 1] === s.id ? t.ticks[t.ticks.length - 1]! : state.tick;
  out.held = Math.min(V.holdCap, (state.tick - since) * DT);
  return out;
}

/** Whether a standing opponent skater is nearer the net `s` attacks than he is (goal-side of him, in or out of his path). */
function defenderGoalSide(state: GameState, s: SkaterState): boolean {
  const dir = state.attackDir[s.side];
  const me = hyp(GOAL - s.pos.x * dir, s.pos.y);
  for (const o of state.skaters) if (o.onIce && o.side !== s.side && o.downT === 0 && hyp(GOAL - o.pos.x * dir, o.pos.y) < me) return true;
  return false;
}

/** The carrier's situation now (a new object). */
export function readSituation(state: GameState, s: SkaterState): Situation {
  return readInto(state, s, { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false, held: 0 });
}

/** listOptions' situation when its caller passes none (private scratch). */
const ownSituation: Situation = { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false, held: 0 };

/**
 * A habit multiplies a value (a positive one by 0.6 + 0.8 * tendency, a negative one is divided by it) and leans it by
 * TUNING.value.habitShift * (tendency - 0.5): a passer likes to pass even when nothing else is good either.
 */
const habit = (v: number, tendency: number): number => { const h = 0.6 + 0.8 * tendency; return (v >= 0 ? v * h : v / h) + V.habitShift * (tendency - 0.5); };

// Scratch for the passes he sees, best first (refilled on every call).
const passIds: string[] = [];
const passValues: number[] = [];
const passSeen: number[] = [];
const passKey: Extract<Option, { kind: 'pass' }> = { kind: 'pass', toId: '', value: 0 };
const planScratch = {} as PassPlan;
/** The best chance a receiver has of handling a pass (passing.ts receiveChance's ceiling). */
const RECEIVE_BEST = 0.97;
const tw: Vec2 = { x: 0, y: 0 };

/**
 * Every option he has, each with value = chance it works * (threat it leads to - threat here) - (1 - that chance) *
 * what losing it here costs. Refills and returns `out`, and writes his situation into `situation`. (Tactics, Task 11,
 * will come in as a parameter when they shade an option.)
 */
export function listOptions(state: GameState, me: PlayerDef, defs: Map<string, PlayerDef>, out: Option[], situation: Situation = ownSituation): Option[] {
  out.length = 0;
  const s = findSkater(state, me.id);
  if (s === null) { out.push({ kind: 'protect', value: 0 }); return out; }
  const sit = readInto(state, s, situation);
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
  const held = sit.held;
  const moveOn = V.hold * held;
  // Passing: worth less in his first O.pass.settle s with it (he has not settled it), more the longer he has it.
  const passOn = V.hold * B.holdBoost.pass * (held - O.pass.settle), shootOn = moveOn * B.holdBoost.shoot;
  const settled = O.pass.settleMin + (1 - O.pass.settleMin) * clamp(held / O.pass.settle, 0, 1);

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
      // A defender in his shooting lane blocks or smothers it: under O.shotLane[1] m of clear ice g is scaled by
      // O.shotBlocked[1], under O.shotLane[0] by O.shotBlocked[0].
      tw.x = GOAL * dir; tw.y = 0;
      const sw = laneWidth(state, side, p, tw);
      if (sw < O.shotLane[0]) g *= O.shotBlocked[0]; else if (sw < O.shotLane[1]) g *= O.shotBlocked[1];
      // Half the score effect's size: on a value near zero its full size would swing shooting by far more than real
      // teams change.
      shootScore = 1 + (scoreShoot - 1) * O.scoreSoft;
    }
    // Near a post (a wraparound's end): the chance comes from how far the goalie is from that post.
    const postLy = sgn(sly) * RINK.netHalfWidth;
    if (hyp(GOAL - srx, postLy - sly) <= WRAP_SHOT) {
      const gl = state.goalies[side === 'home' ? 'away' : 'home'].pos;
      const gd = hyp(gl.x * dir - GOAL, gl.y * dir - postLy);
      g = Math.max(g, V.goal * O.wrap.goal * clamp(gd / O.wrap.open, 0.1, 1) * shootSkill);
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
  passSeen.length = 0;
  const plan = state.carrierPlan !== null && state.carrierPlan.id === s.id ? state.carrierPlan : null;
  const T0 = pickTemperature(me, pressure);
  const fc = dcos(s.facing), fs = dsin(s.facing);
  const passSkill = a.passing;
  for (const m of state.skaters) {
    if (!m.onIce || m.side !== side || m === s || !canReceivePass(state, m)) continue;
    const mrx = m.pos.x * dir, mly = m.pos.y * dir;
    const dx = m.pos.x - p.x, dy = m.pos.y - p.y;
    const l = hyp(dx, dy);
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
    // A pass he can make (passing.ts planPass: the receiver can take it, its hand's range, no body in the lane, not too
    // hard), aimed at the receiver's blade.
    const pp = planPass(state, s, m, defs, planScratch);
    if (pp === null) continue;
    const pl = hyp(pp.aim.x - p.x, pp.aim.y - p.y);
    let chance = O.pass.base - O.pass.perMetre * Math.max(0, pl - O.pass.from) - V.skill.pass * (100 - passSkill) - pressure * (O.pass.pressure - O.pass.pressurePerPoint * passSkill);
    // Settled on it, and the chance he handles it (passing.ts receiveChance, against the best there is).
    chance *= settled * (pp.chance / RECEIVE_BEST) * O.pass.hand[pp.hand];
    // A lane an opponent can get his stick into first (pp.cover) is riskier, the less so the better he passes.
    chance *= 1 - Math.sqrt(pp.cover) * clamp(O.pass.cover - O.pass.coverPerPoint * passSkill, 0, 1);
    // A man on the receiver as it arrives (pp.contest) can take it off him or knock it loose as he gets it.
    chance *= 1 - pp.contest * O.pass.contest;
    // The goalie and the net frames are in the way of a pass as much as a skater is (passLaneWidth, to the aim).
    const w = pp.lane;
    if (w < O.pass.narrow) chance *= O.pass.narrowFactor; else if (w < L.open) chance *= V.shadowed;
    const space = spaceAt(state, side, m.pos);
    if (space < L.space) chance *= O.pass.crowded + space / O.pass.crowdedPer;
    chance = clamp(chance, 0.03, 0.97);
    // A pass across the front of the net makes the goalie move: the receiver's shot is worth more (O.pass.across).
    let to = threat(mrx, mly) * openAt(space);
    const qm = shotQuality(mrx, mly);
    if (qm > 0 && rx > BLUE) {
      const rd = defs.get(m.id);
      to += V.goal * O.pass.across * qm * clamp(Math.abs(mly - ly) / O.pass.acrossFull, 0, 1) * (rd ? B.shootSkill.base + composite(rd.attrs, SHOOTING) * B.shootSkill.perPoint : 1);
    }
    let v = valueOf(chance, to);
    // From inside the zone, a pass out to a man at or outside the line, who will carry it back in while the passer
    // (and whoever else) is still inside, puts them offside.
    if (!outside && mrx < BLUE + 1) v -= V.offside;
    v = habit(v, tend.pass) + passOn;
    // Vision: he sees the best `seen` passes as he reads them (value plus the error of his read, fixed for the possession).
    passKey.toId = m.id;
    const sv = v + readError(plan, passKey, T0, held);
    let i = passSeen.length;
    while (i > 0 && passSeen[i - 1]! < sv) i--;
    if (i >= seen) continue;
    passSeen.splice(i, 0, sv);
    passValues.splice(i, 0, v);
    passIds.splice(i, 0, m.id);
    if (passValues.length > seen) { passValues.length = seen; passIds.length = seen; passSeen.length = seen; }
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
    const block = w < O.carry.laneFrom ? ((O.carry.laneFrom - w) / O.carry.laneFrom) * O.carry.laneCost : 0;
    const chance = clamp(O.carry.base - V.skill.carry * (100 - ph) - pressure * (O.carry.pressure - O.carry.pressurePerPoint * ph) - block, 0.03, 0.97);
    // On a breakaway a carry at the net leads to the shot or deke at its end: worth that chance to score (the goalie
    // square to him), not the threat of the spot.
    // A carry that ends inside DEKE_FROM of the net ends in a deke, with the goalie to beat at close range: V.deke of it.
    const to = mode === 'break'
      ? V.goal * shotQuality(trx, tly) * shootSkill * B.openNetWeight[0] * (hyp(GOAL - trx, tly) < DEKE_FROM ? V.deke : 1)
      : threat(trx, tly) * openAt(spaceAt(state, side, tw));
    let v = valueOf(chance, to);
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
    // Holding, the frame shields him and the passes out front stay open to him: he keeps O.hold.keep of the best one's worth.
    const hy = Math.abs(oly) > RINK.netHalfWidth ? -sgn(oly) * HOLD_LY : clamp(sly, -HOLD_LY, HOLD_LY);
    tw.x = HOLD_RX * dir; tw.y = hy * dir;
    const keep = clamp(O.hold.base - pressure * O.hold.pressure, 0.03, 0.97);
    let bestPass = -Infinity;
    for (const pv of passValues) if (pv > bestPass) bestPass = pv;
    const kept = passValues.length > 0 ? Math.max(0, bestPass - passOn) * O.hold.keep : 0;
    out.push({ kind: 'carry', lane: 'hold', to: { x: tw.x + 0, y: tw.y + 0 }, value: keep * kept - (1 - keep) * loss - moveOn });
    // Wrap: to the post the goalie is further from, worth what a shot from there would be.
    const gl = state.goalies[side === 'home' ? 'away' : 'home'].pos;
    const grx = gl.x * dir, gly = gl.y * dir;
    const wy = hyp(grx - GOAL, gly - RINK.netHalfWidth) >= hyp(grx - GOAL, gly + RINK.netHalfWidth) ? 1 : -1;
    const gd = hyp(grx - GOAL, gly - wy * RINK.netHalfWidth);
    tw.x = WRAP_RX * dir; tw.y = wy * WRAP_LY * dir;
    const w = laneWidth(state, side, s.pos, tw);
    const chance = clamp(O.wrap.base - pressure * O.wrap.pressure - (w < O.wrap.laneFrom ? (O.wrap.laneFrom - w) * O.wrap.laneCost : 0), 0.03, 0.97);
    const wrapG = V.goal * O.wrap.goal * clamp(gd / O.wrap.open, 0.1, 1) * shootSkill;
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
    if (to !== null) { drx = to.pos.x * dir; dly = to.pos.y * dir; } else { drx = GOAL - RIM.corner.back; dly = -ps * RIM.corner.y; }
    tw.x = drx * dir; tw.y = dly * dir;
    // Round the boards to nobody is a puck thrown away unless his team is nearer it: O.blindRim of the race.
    const chance = clamp(race(state, s, tw, to) * (to === null ? O.blindRim : 1), 0.03, 0.97);
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
    const cx = RIM.clear.x;
    tw.x = cx * dir; tw.y = ps * CLEAR_LY * dir;
    const chance = race(state, s, tw, null);
    const v = valueOf(chance, threat(cx, ps * CLEAR_LY), V.turnoverCost * threat(-cx, -ps * CLEAR_LY));
    // Unpressured, a clear throws away a puck he could carry or pass out: it costs O.clearIdle * (1 - pressure).
    out.push({ kind: 'clear', value: habit(v - O.clearIdle * (1 - pressure), tend.dump) });
  }

  // ---- protect ----
  if (mode === 'normal' || mode === 'low') {
    const keep = clamp(O.protect.base - pressure * (O.protect.loss - O.protect.lossPerPoint * composite(a, PROTECTING)), 0.03, 0.97);
    // Unpressured, shielding the puck only stands still: it costs O.protect.idle * (1 - pressure).
    out.push({ kind: 'protect', value: valueOf(keep, here) - moveOn - O.protect.idle * (1 - pressure) });
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

/** The standard deviation of the softmax draw's implied (Gumbel) error, in units of its temperature: pi / sqrt(6). */
const GUMBEL_SD = 1.2825498301618641;
/** The share of the temperature left fresh at each look once he has his read. */
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

/** Scratch for chooseOption: each option's weight and each kind's total. */
const pickW: number[] = [];
const kindW: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * His pick, a draw weighted by value: option i is taken with weight exp(seen_i / T), where seen_i is its value, plus
 * TUNING.value.stick when it is what he is committed to, plus the part of his judging error that stays with him for the
 * possession (persist * a fixed normal error * T, keyed by his plan's seed). The temperature T (TUNING.value.pick: base +
 * perPoint * (100 - iq) + pressure * his pressure - perPoise * poise, at least `min`) is lower for a smart, poised player,
 * who usually takes the best option, and higher for a limited one. In an ordinary state (no breakaway, odd-man rush,
 * play behind the net or pressure down low) no kind of option is taken more than TUNING.brain.maxShare of the time when
 * there is another kind on the list: the rest goes to the other kinds by weight.
 */
export function chooseOption(options: readonly Option[], me: PlayerDef, sit: Situation, plan: CarrierPlan | null, rng: Rng): Option {
  const n = options.length;
  if (n === 1) return options[0]!;
  const total = weigh(options, me, sit, plan);
  let r = rng.next() * total;
  for (let i = 0; i < n; i++) {
    const w = pickW[i]!;
    if (r < w) return options[i]!;
    r -= w;
  }
  return options[n - 1]!;
}

/** The share of chooseOption's draw that goes to its most likely kind of option (1 with a single kind on the list). */
export function topKindShare(options: readonly Option[], me: PlayerDef, sit: Situation, plan: CarrierPlan | null): number {
  if (options.length <= 1) return 1;
  const total = weigh(options, me, sit, plan);
  for (let k = 0; k < kindW.length; k++) kindW[k] = 0;
  for (let i = 0; i < options.length; i++) kindW[KIND_KEY[options[i]!.kind]]! += pickW[i]!;
  let top = 0;
  for (let k = 1; k < kindW.length; k++) if (kindW[k]! > top) top = kindW[k]!;
  return top / total;
}

/** His pick's temperature (TUNING.value.pick): lower for a smart, poised player, higher under pressure. */
function pickTemperature(me: PlayerDef, pressure: number): number {
  const P = V.pick, a = me.attrs;
  return Math.max(P.min, P.base + P.perPoint * (100 - a.iq) + P.pressure * pressure - P.perPoise * a.poise);
}

/**
 * The error in his read of option `o`: persist * T0 * GUMBEL_SD * a normal keyed by his plan's seed and how many
 * TUNING.value.noise.readSeconds he has had the puck (his read of the play holds that long, then he reads it again);
 * 0 with no seed.
 */
function readError(plan: CarrierPlan | null, o: Option, T0: number, held: number): number {
  if (plan === null || plan.seed === undefined) return 0;
  return V.noise.persist * GUMBEL_SD * seenError(mix(plan.seed, Math.floor(held / V.noise.readSeconds) + 1), o) * T0;
}

/** Fills pickW with each option's weight in the draw (the kind cap applied); returns their total. */
function weigh(options: readonly Option[], me: PlayerDef, sit: Situation, plan: CarrierPlan | null): number {
  const T0 = pickTemperature(me, sit.pressure);
  // Once he has a read of the play (his plan's seed), most of his error is that read, fixed for the possession
  // (readError), and the draw at each look is cooler (FRESH * T0).
  const seeded = plan !== null && plan.seed !== undefined;
  const T = seeded ? T0 * FRESH : T0;
  const n = options.length;
  let vmax = -Infinity;
  pickW.length = n;
  for (let i = 0; i < n; i++) {
    const o = options[i]!;
    const z = readError(plan, o, T0, sit.held);
    // His commitment to what he is doing fades over TUNING.value.holdCap seconds with the puck.
    const v = o.value + (committed(o, plan) ? V.stick * (1 - sit.held / V.holdCap) : 0) + z;
    pickW[i] = v;
    if (v > vmax) vmax = v;
  }
  for (let k = 0; k < kindW.length; k++) kindW[k] = 0;
  let total = 0, kinds = 0;
  for (let i = 0; i < n; i++) {
    const w = dexp((pickW[i]! - vmax) / T);
    pickW[i] = w;
    const k = KIND_KEY[options[i]!.kind];
    if (kindW[k] === 0) kinds++;
    kindW[k]! += w;
    total += w;
  }
  // The parity cap, in an ordinary state (no breakaway, odd-man rush, play behind the net or pressure down low, whose
  // rules narrow his list on purpose): with more than one kind on the list, no kind gets more than maxShare of the draw.
  let top = 0;
  for (let k = 1; k < kindW.length; k++) if (kindW[k]! > kindW[top]!) top = k;
  const ordinary = !sit.breakaway && !sit.oddMan && !sit.behindNet && !sit.pressuredLow;
  if (ordinary && kinds > 1 && kindW[top]! > B.maxShare * total) {
    let rest = 0;
    for (let k = 1; k < kindW.length; k++) if (k !== top) rest += kindW[k]!;
    const topScale = (B.maxShare * total) / kindW[top]!, restScale = ((1 - B.maxShare) * total) / rest;
    for (let i = 0; i < n; i++) pickW[i]! *= KIND_KEY[options[i]!.kind] === top ? topScale : restScale;
  }
  return total;
}
