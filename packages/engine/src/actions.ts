import { DT as DT_ } from './constants';
import { bladePos as bladePos_, forehandWithin as forehandWithin_ } from './blade';
import { forcedPass as forcedPass_, HAND_ERROR as HAND_ERROR_, interceptChance as interceptChance_, laneReach as laneReach_, planPass as planPass_, stickInterceptChance as stickInterceptChance_, type PassPlan } from './passing';
import { crossesEndBox as crossesEndBox_ } from './lanes';
import { boardsNormal as boardsNormal_, distToBoards as distToBoards_, RINK as RINK_ } from './rink';
import type { Rng } from './rng';
import { nearestOpponentDist as nearestOpponentDist_, steeredByContest as steeredByContest_ } from './team-play';
import { TUNING as TUNING_ } from './tuning';
import { watchTurnover as watchTurnover_ } from './turnovers';
import { gameEvent as gameEvent_ } from './events';
import { threat as threat_ } from './threat';
import type { GameEvent, GameState, PlayerDef, ShotInFlight, ShotType, Side, SkaterState } from './types';
import { hypot2 as hypot2_, segDistXY as segDistXY_, type Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { clamp as clamp_, GRAVITY as GRAVITY_, skaterById as skaterById_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
const DT = DT_;
const bladePos = bladePos_;
const forcedPass = forcedPass_;
const HAND_ERROR = HAND_ERROR_;
const interceptChance = interceptChance_;
const laneReach = laneReach_;
const planPass = planPass_;
const stickInterceptChance = stickInterceptChance_;
const RINK = RINK_;
const crossesEndBox = crossesEndBox_;
const boardsNormal = boardsNormal_;
const distToBoards = distToBoards_;
const nearestOpponentDist = nearestOpponentDist_;
const steeredByContest = steeredByContest_;
const TUNING = TUNING_;
const watchTurnover = watchTurnover_;
const gameEvent = gameEvent_;
const threat = threat_;
const forehandWithin = forehandWithin_;
const hypot2 = hypot2_;
const segDistXY = segDistXY_;
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;
const clamp = clamp_;
const GRAVITY = GRAVITY_;
const skaterById = skaterById_;

/** After a release (draw, pass, shot, dump), the releasing players cannot pick the puck up again for this long. */
export const RELEASE_NO_PICKUP_SECONDS = 0.3;
/** Upward speed (m/s) a shot can be lifted with, at most: about 5 m high at the top of its flight. */
const MAX_SHOT_LIFT = 10;
const PASS = TUNING.pass;
const SHOT = TUNING.shot;
const DUMP = TUNING.dump;
/** A one-timer pass crosses the slot (y = 0) between this rx and the goal line. */
const ONE_TIMER_RX = 18;
/** Scratch: the pass being made, and an opponent's blade. */
const passPlan = {} as PassPlan;
const recvBlade: Vec2 = { x: 0, y: 0 };
const bladeScratch: Vec2 = { x: 0, y: 0 };

export { interceptChance } from './passing';


/** 0 (nobody within 5 m) to 1 (an opponent on top of him). */
export function pressureOn(state: GameState, s: SkaterState): number {
  return clamp((5 - nearestOpponentDist(state, s)) / 4, 0, 1);
}

/** Longest touch chain kept: the scorer, two assists, and room for repeats. */
const MAX_TOUCHES = 6;

/** `id` of `side` has the puck now: a new team starts a new chain; a new player of the same team joins it. */
export function recordTouch(state: GameState, id: string, side: Side): void {
  state.icingWatch = null;
  const t = state.touches;
  state.lastAttackTouch[side] = id;
  if (t.side !== side) { t.side = side; t.ids.length = 0; t.ticks.length = 0; t.ids.push(id); t.ticks.push(state.tick); return; }
  if (t.ids[t.ids.length - 1] === id) { t.ticks[t.ticks.length - 1] = state.tick; return; }
  t.ids.push(id);
  t.ticks.push(state.tick);
  if (t.ids.length > MAX_TOUCHES) { t.ids.shift(); t.ticks.shift(); }
}

/**
 * The players `ids` may not pick the puck up for RELEASE_NO_PICKUP_SECONDS. Anyone already blocked stays blocked (until
 * the later of the two ends): a pass deflected at once does not free its passer to take it back.
 */
export function blockPickup(state: GameState, ids: string[]): void {
  const until = state.tick + Math.round(RELEASE_NO_PICKUP_SECONDS / DT);
  const b = state.pickupBlock;
  if (b !== null && state.tick < b.untilTick) {
    const merged = b.ids.slice();
    for (const id of ids) if (!merged.includes(id)) merged.push(id);
    state.pickupBlock = { ids: merged, untilTick: Math.max(b.untilTick, until) };
    return;
  }
  state.pickupBlock = { ids, untilTick: until };
}

/**
 * The carrier lets the puck go with this velocity; it becomes loose and he cannot re-take it at once. Released from
 * his own half (behind the centre line), it is watched for icing until someone touches it. With `out`, a `release`
 * event (of `kind`, toward `toId`) goes into it.
 */
function release(
  state: GameState, from: SkaterState, vx: number, vy: number, vz: number,
  out: GameEvent[] | null = null, kind: 'pass' | 'shot' | 'dump' = 'pass', toId: string | null = null, shotType: ShotType | null = null,
): void {
  const p = state.puck;
  if (out) out.push(gameEvent(state, { type: 'release', side: from.side, playerId: from.id, otherId: toId, pos: p.pos, detail: { kind, toId, vel: { x: vx, y: vy, z: vz }, shotType } }));
  recordTouch(state, from.id, from.side); // his touch lasts until he lets it go
  state.icingWatch = p.pos.x * state.attackDir[from.side] < 0 ? { side: from.side, fromY: p.pos.y } : null;
  p.vel.x = vx;
  p.vel.y = vy;
  p.z = 0;
  p.vz = vz;
  state.carrierId = null;
  state.lastTouch = { id: from.id, side: from.side };
  state.possession = from.side;
  state.pendingPass = null;
  state.lastRelease = { id: from.id, tick: state.tick };
  blockPickup(state, [from.id]);
}

/**
 * Pass along the ice to `toId` as passing.ts plans it (planPass: aimed at his blade where he will be, weighted for its
 * length and hand), or, when planPass says it is no option (the brain decided it all the same), a forehand pass to him
 * (forcedPass). Off by a normal error that shrinks with passing and grows with pressure, times 1.6 off the backhand and
 * 2.2 behind him. Its `release` and `pass` events go into `out`.
 */
export function executePass(state: GameState, fromId: string, toId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const from = skaterById(state, fromId), to = skaterById(state, toId);
  const passing = defs.get(fromId)!.attrs.passing;
  const plan = planPass(state, from, to, defs, passPlan) ?? forcedPass(state, from, to, defs, passPlan);
  const p = state.puck.pos;
  const aim = plan.aim;
  const pressure = pressureOn(state, from);
  const sigma = (PASS.error.base + (100 - passing) * PASS.error.perPoint + pressure * PASS.error.pressure) * HAND_ERROR[plan.hand];
  const angle = datan2(aim.y - p.y, aim.x - p.x) + rng.gauss() * sigma;
  const l = hypot2(aim.x - p.x, aim.y - p.y);
  out.push(gameEvent(state, { type: 'pass', side: from.side, playerId: fromId, otherId: toId, pos: p, detail: { kind: 'pass', distance: l, hand: plan.hand } }));
  const oneTimer = isOneTimerPass(state, from, aim);
  release(state, from, dcos(angle) * plan.speed, dsin(angle) * plan.speed, 0, out, 'pass', toId);
  state.pendingPass = {
    fromId, toId, untilTick: state.tick + Math.round((plan.arriveSeconds + PASS.graceSeconds) / DT), tried: checkersOf(state, from), pressure,
    aim: { x: aim.x, y: aim.y }, bobbled: false, cover: plan.cover, oneTimer,
  };
}

/**
 * The opponents within PASS.clearOfPasser (m) of the passer as he lets it go: the pressure they put on him is in the pass's
 * error (and a poke check is theirs to try), so, as with a shot and its blockers, they get no interception try at it.
 */
function checkersOf(state: GameState, from: SkaterState): string[] {
  const ids: string[] = [];
  for (const o of state.skaters) if (o.onIce && o.side !== from.side && hypot2(o.pos.x - from.pos.x, o.pos.y - from.pos.y) <= PASS.clearOfPasser) ids.push(o.id);
  return ids;
}

/**
 * A one-timer pass: across the slot (the line from the puck to `aim` crosses y = 0 at an rx between ONE_TIMER_RX and the
 * goal line, attack-relative for the passer's side) to a man whose spot is a scoring area (options.ts threat over
 * TUNING.value.oneTimerThreat).
 */
function isOneTimerPass(state: GameState, from: SkaterState, aim: Vec2): boolean {
  const dir = state.attackDir[from.side];
  const p = state.puck.pos;
  const py = p.y * dir, ay = aim.y * dir;
  if ((py >= 0) === (ay >= 0) || py === ay) return false;
  const t = py / (py - ay);
  const cx = (p.x + (aim.x - p.x) * t) * dir;
  return cx > ONE_TIMER_RX && cx < RINK.goalLineX && threat(aim.x * dir, ay) > TUNING.value.oneTimerThreat;
}

/**
 * Where across the attacked goal line (y, m) the defending goalie stands in the way, seen from the puck: 0 when he
 * is square to it, positive when he is shaded to +y (so the -y side is open).
 */
export function goalieShade(state: GameState, attackingSide: Side): number {
  const dir = state.attackDir[attackingSide];
  const g = state.goalies[attackingSide === 'home' ? 'away' : 'home'].pos;
  const p = state.puck.pos;
  const netX = dir * RINK.goalLineX;
  const gx = (g.x - p.x) * dir, nx = (netX - p.x) * dir;
  if (gx <= 0.1 || nx <= 0) return 0;
  return clamp(p.y + ((g.y - p.y) * nx) / gx, -RINK.netHalfWidth, RINK.netHalfWidth);
}

/** Shot type effects (TUNING.shot.types): speed and spread multipliers. */
const TYPE_SPEED: Record<ShotType, number> = { wrist: 1, slap: SHOT.types.slap.speed, oneTimer: SHOT.types.oneTimer.speed, backhand: SHOT.types.backhand.speed, wraparound: 1 };
const TYPE_SPREAD: Record<ShotType, number> = { wrist: 1, slap: SHOT.types.slap.spread, oneTimer: SHOT.types.oneTimer.spread, backhand: SHOT.types.backhand.spread, wraparound: 1 };
const netScratch: Vec2 = { x: 0, y: 0 };

/**
 * The type of a shot `s` lets go now, when none is given: `wraparound` (within TUNING.shot.types.wrapPost of a post off a
 * wrap: his carrierPlan's lane is `wrap`), `oneTimer` (he took a one-timer pass at most oneTimerTicks ago), `slap` (slapFrom
 * m or more out, pressure under slapPressure), `backhand` (the net centre is not on his forehand even once
 * he has turned TUNING.shot.types.setTurn per metre out toward it: blade.ts forehandWithin), else `wrist`.
 */
export function shotTypeFor(state: GameState, s: SkaterState, shoots: 'L' | 'R', d: number, pressure: number): ShotType {
  const T = SHOT.types;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const plan = state.carrierPlan;
  if (plan !== null && plan.id === s.id && plan.lane === 'wrap'
    && hypot2(dir * RINK.goalLineX - p.x, RINK.netHalfWidth - Math.abs(p.y)) <= T.wrapPost) return 'wraparound';
  const ot = state.oneTimerTaken;
  if (ot !== null && ot.id === s.id && state.tick - ot.tick <= T.oneTimerTicks) return 'oneTimer';
  if (d >= T.slapFrom && pressure < T.slapPressure) return 'slap';
  netScratch.x = dir * RINK.goalLineX; netScratch.y = 0;
  // He turns toward his forehand as he winds up, more the more room he has (setTurn per metre out): only a shooter in
  // tight with the net off his forehand, or one turned well away from it, shoots off the backhand.
  if (!forehandWithin(s.pos, s.facing, shoots, netScratch, Math.min(Math.PI, T.setTurn * d))) return 'backhand';
  return 'wrist';
}

/**
 * Shoot at the attacked net: aim at a spot inside it (more often on the side the goalie leaves open), missed by a
 * normal spread from shootingAccuracy, distance and pressure, or now and then mishit wide or high (TUNING.shot.wild).
 * Speed TUNING.shot.speed (base + per point of power), lifted so it arrives at the aimed height. Its type (`shotType`,
 * or shotTypeFor when not given) scales its speed and spread (TUNING.shot.types); a wraparound goes along the ice at the
 * near post at TUNING.shot.types.wraparound.speed. No event yet: the release is recorded in `state.shotInFlight`, and
 * what happens to the puck decides whether it is a shot on goal, a miss, a post or a block. Its `release` event (with its
 * type) goes into `out`.
 */
export function executeShot(state: GameState, shooterId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = [], shotType?: ShotType): void {
  const s = skaterById(state, shooterId);
  const me = defs.get(shooterId)!;
  const a = me.attrs;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const netX = dir * RINK.goalLineX;
  const d = hypot2(netX - p.x, p.y);
  const pressure = pressureOn(state, s);
  const type = shotType ?? shotTypeFor(state, s, me.shoots, d, pressure);
  const from = { x: p.x, y: p.y };
  if (type === 'wraparound') {
    // Along the ice at the near post, just inside it.
    const py = p.y >= 0 ? 1 : -1;
    const ty = py * (RINK.netHalfWidth - 0.15) + rng.gauss() * 0.1;
    const dx = netX - p.x, dy = ty - p.y, l = hypot2(dx, dy) || 1;
    const v = SHOT.types.wraparound.speed;
    release(state, s, (dx / l) * v, (dy / l) * v, 0, out, 'shot', null, type);
    state.shotInFlight = newShot(state, shooterId, s.side, from, d, type);
    return;
  }
  const sigma = (SHOT.spread.base + (100 - a.shootingAccuracy) * SHOT.spread.perPoint + d * SHOT.spread.perMetre
    + pressure * SHOT.spread.pressure) * TYPE_SPREAD[type];
  const shade = goalieShade(state, s.side);
  const openSide = shade > 0 ? -1 : 1;
  const aimSide = rng.chance(clamp(0.5 + Math.abs(shade) * SHOT.openSidePull, 0.5, SHOT.openSideMax)) ? openSide : -openSide;
  // A weaker shooter aims nearer the middle: he just wants it on net.
  const aimY = aimSide * rng.range(SHOT.aimY[0], SHOT.aimY[1]) * (SHOT.aimReach.base + SHOT.aimReach.perPoint * a.shootingAccuracy);
  const aimZ = rng.range(SHOT.aimZ[0], SHOT.aimZ[1]);
  let y = aimY + rng.gauss() * sigma;
  let z = Math.max(0.02, aimZ + rng.gauss() * sigma * 0.7);
  // Besides that spread, some shots are mishit or rushed and miss the net outright, wide of the post he aimed beside
  // or over the bar (more often for a poor shooter under pressure, from far out): most missed shots come from here.
  const W = SHOT.wild;
  if (rng.chance(clamp(W.base + (100 - a.shootingAccuracy) * W.perPoint + pressure * W.pressure + d * W.perMetre, 0.03, 0.97))) {
    const by = W.clear + Math.abs(rng.gauss()) * W.spread;
    if (rng.chance(W.highShare)) z = RINK.netHeight + by;
    else y = aimSide * (RINK.netHalfWidth + by);
  }
  const speed = (SHOT.speed.base + a.shootingPower * SHOT.speed.perPoint) * TYPE_SPEED[type];
  const dx = netX - p.x, dy = y - p.y;
  const l = hypot2(dx, dy) || 1;
  const t = l / speed;
  // Lifted to arrive at height z, but never harder than MAX_SHOT_LIFT (from beside the net that would launch it skyward).
  release(state, s, (dx / l) * speed, (dy / l) * speed, Math.min(MAX_SHOT_LIFT, (z + 0.5 * GRAVITY * t * t) / t), out, 'shot', null, type);
  state.shotInFlight = newShot(state, shooterId, s.side, from, d, type);
}

/** A shot just released: a rebound shot when released within TUNING.rebound.windowSeconds of a save on that net (Task 8). */
function newShot(state: GameState, shooterId: string, side: Side, from: Vec2, fromDist: number, shotType: ShotType): ShotInFlight {
  const ls = state.lastSave;
  const rebound = ls !== null && ls.side !== side && (state.tick - ls.tick) * DT <= TUNING.rebound.windowSeconds;
  return { shooterId, side, from, fromDist, tick: state.tick, blockTried: [], shotType, tippedBy: null, tipTried: [], rebound, screened: false, faced: false };
}

/**
 * Chip the puck deep into the attacked end, toward one corner (picked at random), with a passing-based direction error.
 * Its `pass` event (kind `dump`, no receiver) and `release` event go into `out`.
 */
export function executeDump(state: GameState, fromId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const s = skaterById(state, fromId);
  const passing = defs.get(fromId)!.attrs.passing;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const tx = dir * DUMP.spot.x, ty = (rng.chance(0.5) ? 1 : -1) * DUMP.spot.y;
  const speed = DUMP.speed.base + passing * DUMP.speed.perPoint;
  const sigma = DUMP.errorFactor * (PASS.error.base + (100 - passing) * PASS.error.perPoint);
  const angle = datan2(ty - p.y, tx - p.x) + rng.gauss() * sigma;
  out.push(gameEvent(state, { type: 'pass', side: s.side, playerId: fromId, otherId: null, pos: p, detail: { kind: 'dump', distance: null, hand: null } }));
  release(state, s, dcos(angle) * speed, dsin(angle) * speed, DUMP.vz, out, 'dump');
}

const RIM = TUNING.rim;
const aimScratch: Vec2 = { x: 0, y: 0 };
const normScratch: Vec2 = { x: 0, y: 0 };

/**
 * Where a rim is aimed (written into `out`): `ahead` m along the boards nearest `from` (the way round toward `to`),
 * out onto the boards, so the puck meets them at a shallow angle and rides round them.
 */
function boardsAhead(from: Vec2, to: Vec2, ahead: number, out: Vec2, otherWay = false): Vec2 {
  const n0 = boardsNormal(from, normScratch);
  // The tangent of the boards there that points round toward the target (or, otherWay, away from it).
  let tx = -n0.y, ty = n0.x;
  if ((tx * (to.x - from.x) + ty * (to.y - from.y) < 0) !== otherWay) { tx = -tx; ty = -ty; }
  out.x = from.x + tx * ahead;
  out.y = from.y + ty * ahead;
  const n = boardsNormal(out, normScratch), d = distToBoards(out);
  out.x += n.x * d;
  out.y += n.y * d;
  return out;
}

/**
 * Rim it: hard along the boards (TUNING.rim.speed, 16 to 20 m/s by passing), aimed at the boards RIM.ahead m along
 * them (the way round toward its target, or the other way round when that line would cross the crease or the net) so it rides round them, toward the man named (`toId`, who then has it as a pass on its way to him) or, with nobody named, the far low
 * corner, so it rings round the boards. Its `pass` event (kind `rim`) and `release` event (kind `dump`: the viewer's
 * release kinds are pass, shot and dump) go into `out`.
 */
export function executeRim(state: GameState, fromId: string, toId: string | null, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const s = skaterById(state, fromId);
  const passing = defs.get(fromId)!.attrs.passing;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const to = toId !== null ? skaterById(state, toId).pos : { x: dir * (RINK.goalLineX - RIM.corner.back), y: -(p.y * dir >= 0 ? 1 : -1) * RIM.corner.y * dir };
  let aim = boardsAhead(p, to, RIM.ahead, aimScratch);
  // Never through the crease or the net: then round the other way.
  if (crossesEndBox(p, aim, RINK.goalLineX - RINK.creaseRadius, RINK.goalLineX + RINK.netDepth, RINK.creaseRadius)) aim = boardsAhead(p, to, RIM.ahead, aimScratch, true);
  const speed = RIM.speed.base + passing * RIM.speed.perPoint;
  const pressure = pressureOn(state, s);
  const sigma = PASS.error.base + (100 - passing) * PASS.error.perPoint + pressure * PASS.error.pressure;
  const angle = datan2(aim.y - p.y, aim.x - p.x) + rng.gauss() * sigma;
  const l = hypot2(to.x - p.x, to.y - p.y);
  out.push(gameEvent(state, { type: 'pass', side: s.side, playerId: fromId, otherId: toId, pos: p, detail: { kind: 'rim', distance: toId === null ? null : l, hand: null } }));
  release(state, s, dcos(angle) * speed, dsin(angle) * speed, 0, out, 'dump', toId);
  if (toId !== null) state.pendingPass = { fromId, toId, untilTick: state.tick + Math.round((RIM.path * l / speed + PASS.graceSeconds) / DT), tried: checkersOf(state, s), pressure, aim: { x: to.x, y: to.y }, bobbled: false, cover: 0, oneTimer: false };
}

/**
 * Clear it: off the boards and out past his own blue line, toward (TUNING.rim.clear) on his side of the ice, at
 * TUNING.rim.clearSpeed. Its `pass` event (kind `clear`, no receiver) and `release` event (kind `dump`) go into `out`.
 */
export function executeClear(state: GameState, fromId: string, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  const s = skaterById(state, fromId);
  const passing = defs.get(fromId)!.attrs.passing;
  const dir = state.attackDir[s.side];
  const p = state.puck.pos;
  const ps = p.y * dir >= 0 ? 1 : -1;
  aimScratch.x = RIM.clear.x * dir;
  aimScratch.y = ps * RINK.halfWidth * dir;
  const speed = RIM.clearSpeed.base + passing * RIM.clearSpeed.perPoint;
  const sigma = DUMP.errorFactor * (PASS.error.base + (100 - passing) * PASS.error.perPoint);
  const angle = datan2(aimScratch.y - p.y, aimScratch.x - p.x) + rng.gauss() * sigma;
  out.push(gameEvent(state, { type: 'pass', side: s.side, playerId: fromId, otherId: null, pos: p, detail: { kind: 'clear', distance: null, hand: null } }));
  release(state, s, dcos(angle) * speed, dsin(angle) * speed, 0, out, 'dump');
}

/**
 * A pass still on its way (state.pendingPass) along the ice, at any speed (a slow one is easier to take): each opposing skater (on the ice,
 * not leaving, not down, not steered by a contest) gets one try when his stick blade came within PASS.stickLane of the
 * puck's path this tick (from `prev` to its position now), with stickInterceptChance, or, with no stick in the lane,
 * his body within PASS.interceptRange of it, with interceptChance, or, with neither and a lane that was covered when
 * the pass was thrown (pendingPass.cover over 0), as the puck passes him when he could have reached the lane
 * since the pass was let go (passing.ts laneReach: the lane was covered), with interceptChance * PASS.reach * how far
 * he reaches. On success the pass is over and a `turnover` is
 * returned. With his stick there, he takes it PASS.interceptTake of the time (`taker`, now the carrier; the caller puts
 * the puck on his blade) and otherwise deflects it loose (`taker` null); off his body it always goes loose.
 */
export function tryIntercept(
  state: GameState, defs: Map<string, PlayerDef>, rng: Rng, prev: Vec2,
): { event: GameEvent; taker: SkaterState | null } | null {
  const pass = state.pendingPass;
  if (pass === null) return null;
  const p = state.puck;
  const speed = hypot2(p.vel.x, p.vel.y);
  // A lifted pass goes over sticks; any pass on the ice, slow ones included, can be picked off (Task 7 review).
  if (p.z > 0) return null;
  const from = skaterById(state, pass.fromId);
  const rel = state.lastRelease;
  const releaseTick = rel !== null && rel.id === pass.fromId ? rel.tick : state.tick;
  // Where along this tick's path (0 to 1) the receiver's blade meets it, if it does: a stick it reaches only after that
  // comes too late (Task 7 review: the order of the tries is the order along the path).
  const mx = p.pos.x - prev.x, my = p.pos.y - prev.y, m2 = mx * mx + my * my;
  const along = (q: Vec2): number => (m2 === 0 ? 0 : clamp(((q.x - prev.x) * mx + (q.y - prev.y) * my) / m2, 0, 1));
  let catchAt = 2;
  const recv = pass.bobbled ? null : skaterById(state, pass.toId);
  if (recv !== null && recv.onIce && recv.downT === 0) {
    const rb = bladePos(recv.pos, recv.facing, defs.get(recv.id)!.shoots, recvBlade);
    if (segDistXY(rb.x, rb.y, prev.x, prev.y, p.pos.x, p.pos.y) <= TUNING.blade.pickupReach) catchAt = along(rb);
  }
  for (const s of state.skaters) {
    if (!s.onIce || s.leaving || s.downT > 0 || steeredByContest(state, s) || s.side === from.side || pass.tried.includes(s.id)) continue;
    const d = defs.get(s.id)!;
    const blade = bladePos(s.pos, s.facing, d.shoots, bladeScratch);
    if (along(blade) > catchAt && along(s.pos) > catchAt) continue;
    const stick = segDistXY(blade.x, blade.y, prev.x, prev.y, p.pos.x, p.pos.y) <= PASS.stickLane;
    let chance: number;
    if (stick) chance = stickInterceptChance(d, speed);
    else {
      const off = segDistXY(s.pos.x, s.pos.y, prev.x, prev.y, p.pos.x, p.pos.y);
      if (off <= PASS.interceptRange) chance = interceptChance(d, speed);
      else if (pass.cover <= 0) continue;
      else {
        // In a lane that was covered when it was thrown (pendingPass.cover), he reaches for it: a man who could get his
        // stick into the lane since the pass was let go (passing.ts laneReach, the rule that says a lane is covered)
        // gets a try, the less likely the further he has to reach.
        // He reaches when the puck passes him (its nearest point to him is not still ahead of it).
        const mx = p.pos.x - prev.x, my = p.pos.y - prev.y;
        if ((s.pos.x - p.pos.x) * mx + (s.pos.y - p.pos.y) * my > 0) continue;
        const reach = laneReach(off, (state.tick - releaseTick) * DT);
        if (reach <= 0) continue;
        chance = clamp(interceptChance(d, speed) * PASS.reach * reach, 0.03, 0.97);
      }
    }
    pass.tried.push(s.id);
    if (!rng.chance(chance)) continue;
    const take = rng.chance(PASS.interceptTake) && stick;
    state.pendingPass = null;
    state.lastTouch = { id: s.id, side: s.side };
    state.possession = s.side;
    recordTouch(state, s.id, s.side);
    if (take) {
      watchTurnover(state, s.side, s.id, pass.fromId, 'intercepted', { passPressure: pass.pressure });
      state.carrierId = s.id;
      p.vel.x = s.vel.x;
      p.vel.y = s.vel.y;
    } else {
      const turn = (rng.chance(0.5) ? 1 : -1) * rng.range(PASS.deflectTurn[0], PASS.deflectTurn[1]);
      const a = datan2(p.vel.y, p.vel.x) + turn, v = speed * PASS.deflectKeep;
      p.vel.x = dcos(a) * v;
      p.vel.y = dsin(a) * v;
      blockPickup(state, [s.id]);
    }
    return {
      // The interceptor won the puck off the passer (whether it goes in the box score is turnovers.ts's call).
      event: gameEvent(state, { type: 'turnover', side: s.side, playerId: s.id, otherId: pass.fromId, pos: p.pos, detail: { how: take ? 'intercepted' : 'deflected' } }),
      taker: take ? s : null,
    };
  }
  return null;
}
