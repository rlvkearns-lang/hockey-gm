import { executeDump as executeDump_, executePass as executePass_, executeShot as executeShot_, goalieShade as goalieShade_, pressureOn as pressureOn_ } from './actions';
import { composite as composite_ } from './attributes';
import { BRAIN_INTERVAL_TICKS as BRAIN_INTERVAL_TICKS_, DT as DT_, PERIOD_SECONDS as PERIOD_SECONDS_, PERIODS as PERIODS_ } from './constants';
import { RINK as RINK_, zoneOf as zoneOf_ } from './rink';
import { TUNING as TUNING_ } from './tuning';
import { isTiedUp as isTiedUp_, scoreMargin as scoreMargin_, steeredByContest as steeredByContest_ } from './team-play';
import { bodyRadius as bodyRadius_ } from './skating';
import type { Rng } from './rng';
import type { GameEvent, GameState, PlayerDef, SkaterState } from './types';
import { dist as dist_, hypot2 as hypot2_, segDistXY as segDistXY_, type Vec2 } from './vec';
import { dexp as dexp_, dpow as dpow_ } from './dmath';
import { clamp as clamp_, findSkater as findSkater_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const executeDump = executeDump_;
const executePass = executePass_;
const executeShot = executeShot_;
const goalieShade = goalieShade_;
const pressureOn = pressureOn_;
const composite = composite_;
const BRAIN_INTERVAL_TICKS = BRAIN_INTERVAL_TICKS_;
const DT = DT_;
const PERIOD_SECONDS = PERIOD_SECONDS_;
const PERIODS = PERIODS_;
const RINK = RINK_;
const zoneOf = zoneOf_;
const TUNING = TUNING_;
const isTiedUp = isTiedUp_;
const scoreMargin = scoreMargin_;
const steeredByContest = steeredByContest_;
const bodyRadius = bodyRadius_;
const dist = dist_;
const hypot2 = hypot2_;
const segDistXY = segDistXY_;
const dexp = dexp_;
const dpow = dpow_;
const clamp = clamp_;
const findSkater = findSkater_;

export type Decision =
  | { kind: 'carry'; to: Vec2 }
  | { kind: 'pass'; toId: string }
  | { kind: 'shoot' }
  | { kind: 'dump' }
  | { kind: 'protect' };

const GOAL = RINK.goalLineX;
const T = TUNING.brain;
const SHOOTING = { shootingAccuracy: 0.6, shootingPower: 0.4 };
const PROTECTING = { puckHandling: 0.5, strength: 0.5 };

/** How much a skill rating scales an option: T.skill.base + T.skill.perPoint * rating (0.81 at 0, 1.31 at 100). */
const skill = (rating: number): number => T.skill.base + rating * T.skill.perPoint;

/** 0..1 chance-to-score proxy from attack-relative position (inside the offensive zone): distance and angle to the net centre. */
function shotQuality(rx: number, ly: number): number {
  const dx = GOAL - rx;
  if (dx < 0.3 || rx < RINK.blueLineX) return 0;
  const d = hypot2(dx, ly);
  if (d > T.maxShotDistance) return 0;
  return dexp(-d / T.shotDistanceScale) * (dx / d);
}

/**
 * `t` can be passed to: on the ice, not heading off, not down, not steered by a contest, and his stick not tied up by
 * a net-front defender.
 */
export function canReceivePass(state: GameState, t: SkaterState): boolean {
  return t.onIce && !t.leaving && t.downT === 0 && !steeredByContest(state, t) && !isTiedUp(state, t.id);
}

// Scratch for the passing lanes he sees, best first (refilled on every call).
const laneIds: string[] = [];
const laneValues: number[] = [];

/**
 * What the carrier does next. Every kind of option is scored from the situation, his skill for it and his tendency for
 * it (shoot, pass, carry, dump, protect), then one is drawn in proportion to score, no kind more than T.maxShare of the
 * time. Passing is worth his best lane; when he passes, the lane is drawn in proportion to how good he sees each. He
 * sees only his best 1 + floor(vision / 25) passing lanes, judged with an error that shrinks with IQ. Pressure lowers the score of
 * shooting, passing and carrying, less so for a poised player, and raises dumping and protecting.
 * With the puck outside the offensive zone he keeps it onside: no pass to a teammate wholly in the zone (or about to
 * be), and while one is in there he holds up at the blue line instead of carrying in.
 */
export function decideCarrier(state: GameState, me: PlayerDef, defs: Map<string, PlayerDef>, rng: Rng): Decision {
  const s = findSkater(state, me.id);
  if (!s) throw new Error(`no skater ${me.id}`);
  const a = me.attrs, tend = me.tendencies;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const rx = p.x * dir, ly = p.y * dir;
  const pressure = pressureOn(state, s);
  const calm = 1 - pressure * (T.calm.base - a.poise * T.calm.perPoise);
  // Score effects (modest, as in real hockey): a team comfortably ahead shoots a little less, one comfortably behind
  // a little more, and late in the third a team down by one pushes as the clock runs out.
  const se = TUNING.scoreEffects;
  const margin = scoreMargin(state, s.side);
  const lead = state.score[s.side] - state.score[s.side === 'home' ? 'away' : 'home'];
  const late = state.period >= PERIODS && lead === -1 ? 1 - state.clock / PERIOD_SECONDS : 0;
  const scoreShoot = margin === 'ahead' ? se.leaderShoot : Math.min(se.maxShoot, (margin === 'behind' ? se.trailerShoot : 1) * (1 + se.latePush * late));

  // Space ahead, and which way to swerve from the nearest opponent in front.
  let aheadD = Infinity, aheadLat = 0;
  for (const o of state.skaters) {
    if (!o.onIce || o.side === s.side || o.downT > 0) continue;
    const ox = o.pos.x * dir - rx, oy = o.pos.y * dir - ly;
    if (ox > -1 && Math.abs(oy) < ox + 2) {
      const d = hypot2(ox, oy);
      if (d < aheadD) { aheadD = d; aheadLat = oy; }
    }
  }
  const spaceAhead = clamp((aheadD - 2) / 8, 0, 1);

  // Passing lanes: openness of the lane and around the receiver, ground gained, and his chance to score from there.
  const seen = 1 + Math.floor(a.vision / 25);
  const noise = T.laneNoise.base + (100 - a.iq) * T.laneNoise.perPoint;
  laneIds.length = 0;
  laneValues.length = 0;
  const outside = rx <= RINK.blueLineX;
  let mateOffside = false;
  for (const t of state.skaters) {
    if (!t.onIce || t.side !== s.side || t === s) continue;
    // Any teammate wholly in the zone, or about to be (where he will be in T.offsideLookahead s), counts for offside,
    // even one who is down or heading off.
    if (outside && (t.pos.x + Math.max(0, t.vel.x * dir) * dir * T.offsideLookahead) * dir > RINK.blueLineX + bodyRadius(defs.get(t.id)!.weightKg)) {
      mateOffside = true;
      continue;
    }
    if (t.downT > 0) continue;
    if (!canReceivePass(state, t)) continue; // still counts for offside, but is no pass target
    const l = dist(p, t.pos);
    if (l < T.passRange[0] || l > T.passRange[1]) continue;
    let laneMin = Infinity, recvMin = Infinity;
    for (const o of state.skaters) {
      if (!o.onIce || o.side === s.side || o.downT > 0) continue;
      laneMin = Math.min(laneMin, segDistXY(o.pos.x, o.pos.y, p.x, p.y, t.pos.x, t.pos.y));
      recvMin = Math.min(recvMin, dist(o.pos, t.pos));
    }
    const open = clamp((laneMin - 0.6) / 2.5, 0, 1);
    const space = clamp((recvMin - 1) / 4, 0, 1);
    const trx = t.pos.x * dir;
    const gain = clamp((trx - rx) / 25, -0.6, 1);
    const recvShot = shotQuality(trx, t.pos.y * dir) * skill(defs.get(t.id)!.attrs.shootingAccuracy);
    const value = Math.max(0.05, 0.35 + 0.4 * gain + 1.5 * recvShot);
    const perceived = Math.max(0, open * (0.3 + 0.7 * space) * value * (1 + rng.gauss() * noise));
    // Insert, best first, keeping only the lanes he sees.
    let i = laneValues.length;
    while (i > 0 && laneValues[i - 1]! < perceived) i--;
    if (i >= seen) continue;
    laneValues.splice(i, 0, perceived);
    laneIds.splice(i, 0, t.id);
    if (laneValues.length > seen) { laneValues.length = seen; laneIds.length = seen; }
  }

  // An open side of the net (the goalie shaded off the line to it) makes a better shot.
  const open = clamp(Math.abs(goalieShade(state, s.side)) / T.openNetShade, 0, 1);
  // The longer he has had it, the more he wants to move it on (nobody holds the puck for long).
  const t = state.touches;
  const since = t.side === s.side && t.ids[t.ids.length - 1] === s.id ? t.ticks[t.ticks.length - 1]! : state.tick;
  const keep = Math.max(T.holdMin, dexp(-((state.tick - since) * DT) / T.holdSeconds));
  const shootOn = 1 + T.holdBoost.shoot * (1 - keep), passOn = 1 + T.holdBoost.pass * (1 - keep);
  const shootW = T.weight.shoot * shotQuality(rx, ly) * (T.openNetWeight[0] + T.openNetWeight[1] * open) * (T.shootSkill.base + composite(a, SHOOTING) * T.shootSkill.perPoint) * tend.shoot * dpow(calm, T.shootPressure) * scoreShoot * shootOn;
  const passSkill = T.weight.pass * skill(a.passing) * tend.pass * calm * passOn;
  const carryW = T.weight.carry * (T.carrySpace[0] + T.carrySpace[1] * spaceAhead) * skill(a.puckHandling) * tend.carry * calm * keep;
  const zone = zoneOf(p.x, dir);
  // Dump in when the way ahead is closed; clear the own zone only under pressure. From his own half a dump would be
  // icing, so there he would much rather pass or carry.
  const dumpW = T.weight.dump * tend.dump * (rx < 0 ? T.icingDump : 1)
    * (zone === 'N' ? 1 - spaceAhead : zone === 'D' ? 0.5 * pressure : 0);
  const protectW = T.weight.protect * (T.protectBase + pressure) * skill(composite(a, PROTECTING)) * keep;

  // Passing as a kind is worth his best lane: seeing more lanes changes which one he picks, not how often he passes.
  let laneTotal = 0;
  for (const v of laneValues) laneTotal += v;
  const passW = laneValues.length > 0 ? laneValues[0]! * passSkill : 0;
  const total0 = shootW + passW + carryW + dumpW + protectW;
  const top = Math.max(shootW, passW, carryW, dumpW, protectW);
  // Parity: no kind of option is drawn more than T.maxShare of the time (protect always has some weight, so the rest is > 0).
  const cap = (T.maxShare / (1 - T.maxShare)) * (total0 - top);
  const w = (x: number): number => Math.min(x, cap);
  const total = top > cap ? total0 + cap - top : total0;
  let r = rng.next() * total;
  if ((r -= w(shootW)) < 0) return { kind: 'shoot' };
  const pw = w(passW);
  if (r < pw && laneTotal > 0) {
    // The same draw picks the lane, in proportion to how good he sees each one.
    let u = (r / pw) * laneTotal;
    for (let i = 0; i < laneValues.length; i++) if ((u -= laneValues[i]!) < 0 || i === laneValues.length - 1) return { kind: 'pass', toId: laneIds[i]! };
  }
  r -= pw;
  if ((r -= w(dumpW)) < 0) return { kind: 'dump' };
  if ((r -= w(protectW)) < 0) return { kind: 'protect' };
  const to = carryTarget(rx, ly, zone, aheadLat, aheadD, dir);
  if (mateOffside && to.x * dir > RINK.blueLineX - T.holdUpGap) to.x = (RINK.blueLineX - T.holdUpGap) * dir;
  return { kind: 'carry', to };
}

/** Where to carry next: at the slot or across the net front in the offensive zone, else up ice away from a checker. */
function carryTarget(rx: number, ly: number, zone: 'D' | 'N' | 'O', aheadLat: number, aheadD: number, dir: 1 | -1): Vec2 {
  let tx: number, ty: number;
  if (zone === 'O') {
    if (rx > GOAL - 1.5) { tx = GOAL - 4; ty = (ly >= 0 ? 1 : -1) * 4; } // out from behind the net
    else if (hypot2(GOAL - rx, ly) > 10) { tx = Math.min(rx + 6, 21); ty = ly * 0.5; } // drive to the slot
    else { tx = Math.min(rx + 3, GOAL - 3.5); ty = (ly >= 0 ? -1 : 1) * 2.5; } // cut across
  } else {
    tx = rx + T.carryAhead;
    ty = clamp(ly + (aheadD < 10 ? (aheadLat >= 0 ? -1 : 1) * T.carrySwerve : 0), -10, 10);
  }
  return { x: tx * dir, y: ty * dir };
}

/**
 * Runs the carrier's decision every BRAIN_INTERVAL_TICKS and carries it out. Its events (release, and pass or dump) go into
 * `out` (a shot's own event comes when it ends). A carrier steered by a contest (being hit, from impact on) may still pass, shoot
 * or dump, but his skating belongs to the contest, so a carry or protect decision changes nothing.
 */
export function brainTick(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  if (state.carrierId === null || state.tick % BRAIN_INTERVAL_TICKS !== 0) return;
  const s = findSkater(state, state.carrierId);
  if (!s || !s.onIce || s.downT > 0) return;
  const busy = steeredByContest(state, s);
  const me = defs.get(s.id)!;
  const d = decideCarrier(state, me, defs, rng);
  switch (d.kind) {
    case 'shoot': executeShot(state, s.id, defs, rng, out); return;
    case 'pass': executePass(state, s.id, d.toId, defs, rng, out); return;
    case 'dump': executeDump(state, s.id, defs, rng, out); return;
    case 'carry':
      if (busy) return;
      s.target.x = d.to.x;
      s.target.y = d.to.y;
      s.faceTarget = null;
      s.speedCap = clamp(T.carrySpeed.base + me.attrs.puckHandling * T.carrySpeed.perPoint, 0, 1);
      return;
    case 'protect': {
      if (busy) return;
      let near: SkaterState | null = null, nearD = Infinity;
      for (const o of state.skaters) {
        if (!o.onIce || o.side === s.side || o.downT > 0) continue;
        const od = dist(o.pos, s.pos);
        if (od < nearD) { nearD = od; near = o; }
      }
      if (near && nearD > 0) {
        s.target.x = s.pos.x + ((s.pos.x - near.pos.x) / nearD) * T.protectStep;
        s.target.y = s.pos.y + ((s.pos.y - near.pos.y) / nearD) * T.protectStep;
      } else { s.target.x = s.pos.x; s.target.y = s.pos.y; }
      s.faceTarget = null;
      s.speedCap = T.protectSpeedCap;
      return;
    }
  }
}
