import { hasBadge } from '../badges';
import { planOf } from '../commit';
import { blockPickup, passFromFeet, recordTouch } from '../actions';
import { bladePos } from '../blade';
import { DT } from '../constants';
import { stopPlay } from '../faceoff';
import { boardsNormal, distToBoards, FACEOFF_DOTS, resolveBoards, resolveNets, RINK, supportSpot } from '../rink';
import { crossesNet } from '../lanes';
import { movementOf } from '../skating';
import { TUNING } from '../tuning';
import { heldSeconds, watchTurnover } from '../turnovers';
import { PUCK_RADIUS } from '../util';
import { engagementOf } from '../engage-state';
import type { ContestStateOf, GameEvent, GameState, SkaterState } from '../types';
import { dist, hypot2, type Vec2 } from '../vec';
import {
  carrierNow, contestEvent, contestRating, enterStage, isFree, onCooldown, puckHeldByContest, setCooldown, skaterById, STAGE_EPS, winProb,
  type Contest, type ContestCtx, type ContestResult, type Weights,
} from './core';
import type { ContestOutcome } from '../types';

const KIND = 'boardBattle';
const T = TUNING.boardBattle;
/** `protect` (a carried puck) lasts this long (s); an opponent farther than PROTECT_REACH (m) from the carrier at its end has lost him. */
const PROTECT_SECONDS = 0.5;
const PROTECT_REACH = 3;
/** A carrier behind a net (|x| beyond BEHIND_X, |y| within BEHIND_Y) starts a battle only with an opponent within BEHIND_REACH (m) of him. */
const BEHIND_X = 27.43;
const BEHIND_Y = 4;
const BEHIND_REACH = 1.2;
/** A puck knocked into their feet slides on to the spot (where it would be in SLIDE_LEAD s) over SLIDE_TICKS ticks. */
const SLIDE_LEAD = 0.12;
const SLIDE_TICKS = 6;
/** `arrive` lasts ARRIVE_SECONDS[0] to [1]; a man this close (m) to the spot has arrived. */
const ARRIVE_SECONDS: [number, number] = [0.3, 0.8];
const ARRIVE_REACH = 0.8;
/** With neither man there when `arrive` ends, the one closer by this much (m) counts as first. */
const FIRST_GAP = 0.3;
/** `pin`: one body-on-body draw every PIN_ROUND s; a lead of PIN_MARGIN draws pins the other man. The stage lasts
 * PIN_SECONDS[0] to [1]; still level at the end, nobody is pinned. */
const PIN_ROUND = 0.2;
const PIN_MARGIN = 2;
const PIN_SECONDS: [number, number] = [0.8, 1.6];
/** `dig`: one stick draw per round, each round lasting DIG_ROUND[0] to [1] s; the stage lasts at least DIG_MIN s.
 * With nobody pinned, T.digMaxRounds rounds without a side winning two in a row traps the puck. */
const DIG_ROUND: [number, number] = [0.5, 0.62];
const DIG_MIN = 1;
/** `resolve` shows the winner this long (s) before the puck moves. */
const RESOLVE_SECONDS = 0.3;
/** The puck on the winner's blade as he comes away moves at most his own travel plus BLADE_TURN (m) a tick, at most BLADE_STEP (as a carried puck: game.ts carryPuck). */
const BLADE_TURN = 0.2;
const BLADE_STEP = 0.4;
/** A puck left this far (m) or more from the spot at the end of its slide stays where it is (the spot moves to it). */
const SPOT_SETTLE = 0.05;
/**
 * The most a hand-over moves the puck to the taker's blade (m). Task 14 (thin guard: hand-overs read 1.199 to 1.30 m
 * against the 1.2 m no-teleport bar): 1.05, not the bar itself. The winner moves on the tick the puck is put on his
 * blade (up to 0.2 m as he comes away), so a puck handed over from exactly 1.2 m could travel further than that; from
 * beyond 1.05 m it squirts loose along the boards instead.
 */
const HAND_OVER = 1.05;
/** How hard they skate (fraction of top speed) while shoving and digging. */
const PIN_SPEED_CAP = 0.4;
const DIG_SPEED_CAP = 0.3;

type Battle = ContestStateOf<'boardBattle'>;

/** No one (as a participant index: 0 is `roles.a`, 1 is `roles.b`, supporting players come after). */
const NONE = -1;
/** Participant index of `id` (NONE for null). Participants of a board battle are only ever added, so it is stable. */
const ix = (c: Battle, id: string | null): number => (id === null ? NONE : c.participants.indexOf(id));
const idOf = (c: Battle, i: number): string => c.participants[i]!;
/** Role value for participant index `i` (null for NONE). */
const roleOf = (c: Battle, i: number): string | null => (i === NONE ? null : idOf(c, i));
const other = (i: number): number => 1 - i;

/**
 * Board battle: the puck this close (T.triggerBoards m) to the boards, slower than T.triggerSpeed m/s, on the ice and
 * not a shot, with a skater of each team within T.triggerRange m of it. A carried puck counts (the carrier is then one
 * of the two). Participants: the two men (`roles.a`, `roles.b`), then any supporting players. Stages:
 * - `protect` (a carried puck only, PROTECT_SECONDS): the carrier shields it and keeps skating while the other man
 *   leans on him; then he either keeps it and skates out (a `battle` event, detail `protect`; the contest ends) or it
 *   is knocked into their feet and the battle goes on (see protect()).
 * - `arrive` (0.3 to 0.8 s): both go to the puck; the first within reach (`roles.first`) has +6 for the rest of it.
 *   `leader`: the first man, else the closer.
 * - `pin` (0.8 to 1.6 s): a shoving draw every 0.2 s (strength .45, balance .3, compete .25, plus mass difference / 4);
 *   `data.balance` is the running score (+ for `a`) and `leader` whoever is ahead. A lead of two pins the
 *   other man against the boards (`roles.pinned`); level at the end, nobody is pinned.
 * - `dig` (1.0 to 2.5 s): stick draws (stickChecking .35, puckHandling .3, compete .2, agility .15; a pinned man at
 *   -10). The pinner, with the puck in his feet, wins the dig on the first round he wins; the pinned man has to win two
 *   rounds in a row to dig it out. With nobody pinned either side needs two in a row, and four rounds without that
 *   trap the puck: `freeze` (detail `trapped`) and a faceoff at the nearest end-zone dot inside a blue line, else the
 *   nearest neutral-zone dot. `leader`: whoever is ahead in the dig.
 * - `resolve` (0.3 s): `leader` is the winner. T.cleanShare (0.75) of the time he comes away with it clean: steered
 *   T.comeAway off the boards with the puck riding his blade, it ends `toWinner` with the puck on his stick (Task 9:
 *   whatever support he had). Won by support (his side had a supporter and the other did not), a clean win is passed
 *   instead: he stays on it, facing his supporter, and at the end passes it to him (6 to 8 m/s, `pass` and `release`
 *   events, the pass pending to him; `puck: 'loose'`, `puckTo` the supporter). Otherwise it squirts loose along the
 *   boards. Through a net frame there is no hand-over: then it squirts loose (Task 8b close-out).
 * Any time after `arrive`, the first free teammate of either side within 2.5 m joins as that side's support
 * (`roles.supportA` / `roles.supportB`): +8 for his side. He stands on his own side of it: T.supportOff from the spot
 * toward the net his side defends (rink.ts supportSpot). A supporter who leaves the ice or heads off drops out; the battle
 * goes on. One `battle` event at the end: the dig winner over the loser, detail `support` (the numbers won it), else
 * `pinned` (the winner had pinned him), `stick` (he dug it out while pinned) or `scramble` (nobody was pinned), naming
 * each side's supporter (`winnerSupportId`, `loserSupportId`). From `arrive` on the puck is in their feet
 * (`data.holdsPuck`): it slides on to `spot` over a few ticks (moving at its speed: its velocity says so) and stays there
 * with nobody carrying it until the end; every participant but a shielding carrier is steered by it. The contest's
 * `winnerId` is always the man who won it.
 */
export const boardBattleContest: Contest<'boardBattle'> = {
  kind: KIND,

  gate: (ctx) => puckBattleable(ctx),

  trigger(ctx, s) {
    const state = ctx.state;
    if (!puckBattleable(ctx) || dist(s.pos, state.puck.pos) > T.triggerRange || onCooldown(state, s.id, KIND)) return null;
    const carrier = carrierNow(ctx);
    if (carrier !== null) {
      // A carrier along the boards: the battle is between him and the opponent on him.
      if (!isFree(carrier) || onCooldown(state, carrier.id, KIND)) return null;
      // Behind the net the frame shields him: only an opponent right on him (BEHIND_REACH) starts a battle.
      const behind = Math.abs(carrier.pos.x) > BEHIND_X && Math.abs(carrier.pos.y) < BEHIND_Y;
      if (carrier === s) {
        const pair = nearestOpponent(state, s);
        if (pair !== null && behind && dist(skaterById(state, pair[1]!).pos, s.pos) > BEHIND_REACH) return null;
        return pair;
      }
      if (behind && dist(s.pos, carrier.pos) > BEHIND_REACH) return null;
      return carrier.side !== s.side ? [s.id, carrier.id] : null;
    }
    return nearestOpponent(state, s);
  },

  start(ctx, participants) {
    const state = ctx.state;
    const p = state.puck;
    const carrierIdx = state.carrierId === null ? NONE : participants.indexOf(state.carrierId);
    const c: Battle = {
      id: -1, kind: KIND, stage: carrierIdx === NONE ? 'arrive' : 'protect', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: p.pos.x, y: p.pos.y }, freeIds: carrierIdx === NONE ? [] : [participants[carrierIdx]!],
      roles: {
        a: participants[0]!, b: participants[1]!, carrier: carrierIdx === NONE ? null : participants[carrierIdx]!, stripped: null, first: null,
        pinned: null, digLast: null, supportA: null, supportB: null, winner: null,
      },
      data: { holdsPuck: false, slide: 0, held: 0, firstSet: false, balance: 0, nextAt: PIN_ROUND, digRounds: 0, clean: false },
    };
    // Out of an engagement (Task 10): the man who had inside position on the other is the first man in.
    const inside = insideOf(state, c.roles.a, c.roles.b);
    if (inside !== null) { c.roles.first = inside; c.data.firstSet = true; }
    if (carrierIdx === NONE) intoFeet(c, ctx);
    else c.leader = participants[carrierIdx]!;
    steer(c, ctx);
    return c;
  },

  update(c, ctx) {
    const state = ctx.state;
    if (c.stage === 'protect') {
      const r = protect(c, ctx);
      if (r === null) steer(c, ctx);
      return r;
    }
    holdPuck(ctx, c);
    if (c.stage !== 'arrive' && c.stage !== 'resolve') joinSupport(c, ctx);
    let r: ContestResult | null = null;
    switch (c.stage) {
      case 'arrive': arrive(c, ctx); break;
      case 'pin': pin(c, ctx); break;
      case 'dig': r = dig(c, ctx); break;
      case 'resolve': r = c.stageT >= RESOLVE_SECONDS - STAGE_EPS ? finish(c, ctx) : null; break;
    }
    if (r === null) steer(c, ctx);
    return r;
  },
};

/** The man of `a` and `b` with inside position in an engagement of either (Task 10), or null. */
function insideOf(state: GameState, a: string, b: string): string | null {
  for (const id of [a, b]) {
    const e = engagementOf(state, id);
    if (e !== null && (e.inside === a || e.inside === b)) return e.inside;
  }
  return null;
}

const BATTLEABLE = 'boardBattle.puck';

/**
 * The puck could start a board battle: on the ice and not a shot, slower than T.triggerSpeed, within T.triggerBoards of
 * the boards, and no battle holds it already. Worked out once per round of triggers (`ctx.memo`).
 */
function puckBattleable(ctx: ContestCtx): boolean {
  const m = ctx.memo.get(BATTLEABLE) as boolean | undefined;
  if (m !== undefined) return m;
  const state = ctx.state;
  const p = state.puck;
  const ok = state.shotInFlight === null && p.z <= 0.1 && hypot2(p.vel.x, p.vel.y) < T.triggerSpeed
    && distToBoards(p.pos) <= T.triggerBoards && !puckHeldByContest(state);
  ctx.memo.set(BATTLEABLE, ok);
  return ok;
}

/** `s` and the nearest free opponent within T.triggerRange of the puck, or null. */
function nearestOpponent(state: GameState, s: SkaterState): string[] | null {
  let o: SkaterState | null = null, od = T.triggerRange;
  for (const t of state.skaters) {
    if (t.side === s.side || !isFree(t) || onCooldown(state, t.id, KIND)) continue;
    const d = dist(t.pos, state.puck.pos);
    if (d <= od) { od = d; o = t; }
  }
  return o ? [s.id, o.id] : null;
}

const scratchVel: Vec2 = { x: 0, y: 0 };

/**
 * The puck goes into their feet: nobody carries it, and it slides on to the battle's spot (where it would be in
 * SLIDE_LEAD s, inside the boards) over SLIDE_TICKS ticks, then stays there.
 */
function intoFeet(c: Battle, ctx: ContestCtx): void {
  const state = ctx.state;
  const p = state.puck;
  state.pendingPass = null;
  state.carrierId = null;
  c.spot.x = p.pos.x + p.vel.x * SLIDE_LEAD;
  c.spot.y = p.pos.y + p.vel.y * SLIDE_LEAD;
  scratchVel.x = 0;
  scratchVel.y = 0;
  resolveBoards(c.spot, scratchVel, PUCK_RADIUS, 0);
  // Never inside a net frame (Task 8b close-out: a puck sliding goalward put the spot in the net; the winner in front of
  // it then had a puck that came out through the back of the frame, 2.4 m from his blade, seed 12).
  resolveNets(c.spot, scratchVel, PUCK_RADIUS);
  p.vel.x = 0;
  p.vel.y = 0;
  c.data.holdsPuck = true;
  c.data.slide = SLIDE_TICKS;
}

const bladeScratch: Vec2 = { x: 0, y: 0 };
const zeroVel: Vec2 = { x: 0, y: 0 };

/**
 * The puck in their feet: sliding on to the spot, still at it, or (a clean win, while it resolves) riding the winner's
 * blade as he comes away with it. A moving puck moves by its velocity (Task 9: it moved at a speed of 0 before): the
 * puck's own step (game.ts moveLoosePuck, after the skaters) takes it where this sets it going.
 */
function holdPuck(ctx: ContestCtx, c: Battle): void {
  const state = ctx.state;
  const p = state.puck;
  const d = c.data;
  p.z = 0;
  p.vz = 0;
  let tx: number, ty: number;
  if (d.slide > 0) {
    tx = p.pos.x + (c.spot.x - p.pos.x) / d.slide;
    ty = p.pos.y + (c.spot.y - p.pos.y) / d.slide;
    d.slide--;
  } else if (comesAway(c)) {
    // On his blade (inside the boards, out of a net frame), a carried puck's step at a time.
    const w = skaterById(state, c.roles.winner!);
    const b = bladePos(w.pos, w.facing, ctx.defs.get(w.id)!.shoots, bladeScratch);
    zeroVel.x = 0; zeroVel.y = 0;
    resolveBoards(b, zeroVel, PUCK_RADIUS, 0);
    resolveNets(b, zeroVel, PUCK_RADIUS);
    const dx = b.x - p.pos.x, dy = b.y - p.pos.y, l = hypot2(dx, dy);
    const step = Math.min(BLADE_STEP, hypot2(w.vel.x, w.vel.y) * DT + BLADE_TURN);
    tx = l > step ? p.pos.x + (dx / l) * step : b.x;
    ty = l > step ? p.pos.y + (dy / l) * step : b.y;
  } else {
    // Still at the spot (any drift left by the slide is settled here, in a tick of a few hundredths of a millimetre).
    // While it resolves it stays where it is: a winner who was coming away with it and now passes it on (his side's
    // supporter has gone) plays it from there.
    // And a puck the slide could not bring all the way (a net frame in its way) stays where it stopped: the spot moves to it.
    if (c.stage === 'resolve' || hypot2(c.spot.x - p.pos.x, c.spot.y - p.pos.y) > SPOT_SETTLE) { c.spot.x = p.pos.x; c.spot.y = p.pos.y; }
    p.pos.x = c.spot.x;
    p.pos.y = c.spot.y;
    p.vel.x = 0;
    p.vel.y = 0;
    return;
  }
  p.vel.x = (tx - p.pos.x) / DT;
  p.vel.y = (ty - p.pos.y) / DT;
}

/** How the battle was won (once there is a winner): by support, a pin, the stick or in a scramble. */
function howOf(c: Battle): 'support' | 'pinned' | 'stick' | 'scramble' {
  const r = c.roles;
  const w = ix(c, r.winner), l = other(w);
  const support = w === 0 ? r.supportA : r.supportB;
  const outnumbered = (l === 0 ? r.supportA : r.supportB) === null;
  return support !== null && outnumbered ? 'support' : r.pinned === null ? 'scramble' : r.pinned === idOf(c, l) ? 'pinned' : 'stick';
}

/** While it resolves: a clean win the winner comes away with himself (not a win by support, which he passes on). */
function comesAway(c: Battle): boolean {
  return c.stage === 'resolve' && c.data.clean && c.roles.winner !== null && howOf(c) !== 'support';
}

/** Supporting players who have left the ice or are heading off drop out of `c`; the battle goes on without them. */
export function dropGoneSupport(state: GameState, c: Battle): void {
  for (const key of ['supportA', 'supportB'] as const) {
    const id = c.roles[key];
    if (id === null) continue;
    const s = skaterById(state, id);
    if (s.onIce && !s.leaving) continue;
    c.roles[key] = null;
    const i = c.participants.indexOf(id);
    if (i >= 0) c.participants.splice(i, 1);
    if (s.contestId === c.id) s.contestId = null;
  }
}

/** Each side without support takes the first free teammate (skater order) within T.supportRange of the spot. */
function joinSupport(c: Battle, ctx: ContestCtx): void {
  const state = ctx.state;
  for (let i = 0; i < 2; i++) {
    const key = i === 0 ? 'supportA' : 'supportB';
    if (c.roles[key] !== null) continue;
    const side = skaterById(state, idOf(c, i)).side;
    for (const s of state.skaters) {
      if (s.side !== side || !isFree(s) || dist(s.pos, c.spot) > T.supportRange) continue;
      c.roles[key] = s.id;
      c.participants.push(s.id);
      s.contestId = c.id;
      break;
    }
  }
}

/** A Board Battler's TUNING.badges.boardBattlerRating in the pin and dig draws (Task 12). */
const battler = (ctx: ContestCtx, id: string): number => (hasBadge(ctx.defs.get(id)!, 'Board Battler') ? TUNING.badges.boardBattlerRating : 0);

/** Rating points participant 0 has over participant 1 in a pin or dig draw with `weights` (first man, support, chemistry, Board Battler in). */
function sideEdge(c: Battle, ctx: ContestCtx, weights: Weights): number {
  const r = c.roles;
  return contestRating(ctx, c, r.a, weights) - contestRating(ctx, c, r.b, weights) + battler(ctx, r.a) - battler(ctx, r.b)
    + (r.first === r.a ? T.firstEdge : r.first === r.b ? -T.firstEdge : 0)
    + (r.supportA !== null ? T.supportEdge : 0) - (r.supportB !== null ? T.supportEdge : 0);
}

/**
 * A carrier shielding the puck along the boards while the other man leans in, for PROTECT_SECONDS. Then one roll
 * (winProb of the carrier's strength, puck handling and balance against the other's stick, strength and compete, plus
 * mass difference / massPerPoint and T.protectEdge): he keeps it and skates out of it (a `battle` event, detail
 * `protect`), or it is knocked into their feet and the battle goes on to `arrive`. He letting the puck go, or the
 * other man losing touch with him, ends it with no result.
 */
function protect(c: Battle, ctx: ContestCtx): ContestResult | null {
  const state = ctx.state;
  const ci = ix(c, c.roles.carrier), oi = other(ci);
  const carrier = skaterById(state, idOf(c, ci)), opp = skaterById(state, idOf(c, oi));
  c.spot.x = state.puck.pos.x;
  c.spot.y = state.puck.pos.y;
  if (state.carrierId !== carrier.id) return cooledOff(c, ctx, null, 'released');
  if (c.stageT < PROTECT_SECONDS - STAGE_EPS) return null;
  if (dist(carrier.pos, opp.pos) > PROTECT_REACH) return cooledOff(c, ctx, null, 'lostTouch');
  const mc = movementOf(ctx.defs.get(carrier.id)!, 1).mass, mo = movementOf(ctx.defs.get(opp.id)!, 1).mass;
  // (Task 12: a Shutdown man strips the man he marks with TUNING.badges.shutdownRating more.)
  const shut = hasBadge(ctx.defs.get(opp.id)!, 'Shutdown') && planOf(state, opp.id).markId === carrier.id ? TUNING.badges.shutdownRating : 0;
  const edge = contestRating(ctx, c, carrier.id, T.protect) - contestRating(ctx, c, opp.id, T.strip) - shut + (mc - mo) / T.massPerPoint + T.protectEdge;
  if (ctx.rng.next() < winProb(edge)) {
    ctx.emit(contestEvent(state, { type: 'battle', side: carrier.side, playerId: carrier.id, otherId: opp.id, pos: c.spot, detail: { how: 'protect', contestId: c.id, winnerSupportId: null, loserSupportId: null } }));
    setCooldown(state, opp.id, 'pokeCheck', T.loserPokeCooldown);
    return cooledOff(c, ctx, carrier.id, 'protected');
  }
  c.roles.stripped = carrier.id;
  c.data.held = heldSeconds(state, carrier.id);
  c.roles.carrier = null;
  c.freeIds.length = 0;
  c.leader = null;
  intoFeet(c, ctx);
  enterStage(c, 'arrive');
  return null;
}

/** Ends the battle with the puck left as it is (to `winnerId`, or nobody); nobody in it starts another for a while. */
function cooledOff(c: Battle, ctx: ContestCtx, winnerId: string | null, outcome: ContestOutcome): ContestResult {
  for (const id of c.participants) setCooldown(ctx.state, id, KIND, T.cooldownSeconds);
  return { winnerId, puck: 'unchanged', outcome };
}

/** Who gets there first. */
function arrive(c: Battle, ctx: ContestCtx): void {
  const state = ctx.state;
  const d = c.data, r = c.roles;
  const da = dist(skaterById(state, r.a).pos, c.spot), db = dist(skaterById(state, r.b).pos, c.spot);
  const inA = da <= ARRIVE_REACH, inB = db <= ARRIVE_REACH;
  if (!d.firstSet && (inA || inB)) {
    d.firstSet = true;
    r.first = inA && inB ? null : inA ? r.a : r.b;
  }
  const over = (c.stageT >= ARRIVE_SECONDS[0] - STAGE_EPS && inA && inB) || c.stageT >= ARRIVE_SECONDS[1] - STAGE_EPS;
  if (over && !d.firstSet) {
    d.firstSet = true;
    r.first = Math.abs(da - db) < FIRST_GAP ? null : da < db ? r.a : r.b;
  }
  c.leader = r.first !== null ? r.first : da < db ? r.a : db < da ? r.b : null;
  if (!over) return;
  d.nextAt = PIN_ROUND;
  enterStage(c, 'pin');
}

/** Shoving draws until one man leads by PIN_MARGIN; the stage ends between PIN_SECONDS[0] and [1]. */
function pin(c: Battle, ctx: ContestCtx): void {
  const d = c.data, r = c.roles;
  if (Math.abs(d.balance) < PIN_MARGIN && c.stageT >= d.nextAt - STAGE_EPS) {
    const ma = movementOf(ctx.defs.get(r.a)!, 1).mass, mb = movementOf(ctx.defs.get(r.b)!, 1).mass;
    const edge = sideEdge(c, ctx, T.pin) + (ma - mb) / T.massPerPoint;
    d.balance += ctx.rng.next() < winProb(edge) ? 1 : -1;
    d.nextAt += PIN_ROUND;
    if (Math.abs(d.balance) >= PIN_MARGIN) r.pinned = d.balance > 0 ? r.b : r.a;
  }
  c.leader = d.balance > 0 ? r.a : d.balance < 0 ? r.b : null;
  const decided = r.pinned !== null;
  if ((decided && c.stageT >= PIN_SECONDS[0] - STAGE_EPS) || c.stageT >= PIN_SECONDS[1] - STAGE_EPS) {
    d.nextAt = ctx.rng.range(DIG_ROUND[0], DIG_ROUND[1]);
    enterStage(c, 'dig');
  }
}

/** Stick draws; returns a result only when the puck is trapped (play stops). */
function dig(c: Battle, ctx: ContestCtx): ContestResult | null {
  const d = c.data, r = c.roles;
  const pinned = ix(c, r.pinned);
  if (r.winner === null && c.stageT >= d.nextAt - STAGE_EPS) {
    const pinEdge = pinned === 0 ? -T.pinnedEdge : pinned === 1 ? T.pinnedEdge : 0;
    const w = ctx.rng.next() < winProb(sideEdge(c, ctx, T.dig) + pinEdge) ? 0 : 1;
    const last = ix(c, r.digLast);
    d.digRounds++;
    if (pinned !== NONE) {
      if (w !== pinned || last === pinned) r.winner = idOf(c, w);
    } else if (last === w) r.winner = idOf(c, w);
    else if (d.digRounds >= T.digMaxRounds) return trapped(c, ctx);
    r.digLast = idOf(c, w);
    if (r.winner === null) d.nextAt += ctx.rng.range(DIG_ROUND[0], DIG_ROUND[1]);
  }
  const last = ix(c, r.digLast);
  const ahead = r.winner !== null ? ix(c, r.winner)
    : pinned !== NONE ? (last === pinned ? pinned : other(pinned)) : last;
  c.leader = roleOf(c, ahead);
  if (r.winner !== null && c.stageT >= DIG_MIN - STAGE_EPS) {
    d.clean = ctx.rng.chance(T.cleanShare);
    enterStage(c, 'resolve');
  }
  return null;
}

/** Neither side can get it out: whistle, faceoff at the nearest end-zone dot inside a blue line, else neutral-zone dot. */
function trapped(c: Battle, ctx: ContestCtx): ContestResult {
  const state = ctx.state;
  const a = skaterById(state, c.roles.a);
  ctx.emit(contestEvent(state, { type: 'freeze', side: a.side, playerId: a.id, otherId: c.roles.b, pos: c.spot, detail: { cause: 'trapped' } }));
  const inEnd = Math.abs(c.spot.x) > RINK.blueLineX;
  let best: Vec2 = FACEOFF_DOTS.centre, bestD = Infinity;
  for (const dot of inEnd ? FACEOFF_DOTS.end : FACEOFF_DOTS.neutral) {
    if (inEnd && dot.x * c.spot.x < 0) continue;
    const dd = dist(dot, c.spot);
    if (dd < bestD) { bestD = dd; best = dot; }
  }
  stopPlay(state, best);
  return { winnerId: null, puck: 'unchanged', outcome: 'trapped' };
}

const passScratch: GameEvent[] = [];

/**
 * The battle is decided: the event, cooldowns, and the puck: on the winner's stick (a clean win), passed to his supporter
 * (a clean win by support), or squirting loose. The result's `winnerId` is the man who won it.
 */
function finish(c: Battle, ctx: ContestCtx): ContestResult {
  const state = ctx.state;
  const d = c.data, r = c.roles;
  const w = ix(c, r.winner), l = other(w);
  const winner = skaterById(state, idOf(c, w)), loserId = idOf(c, l);
  const support = w === 0 ? r.supportA : r.supportB, loserSupport = l === 0 ? r.supportA : r.supportB;
  const how = howOf(c);
  // A clean win by support goes to the supporter by a pass; any other clean win stays with the winner. No hand-over
  // through a net (Task 8b close-out: the frame between the puck and the blade): then it squirts loose instead.
  const p = state.puck.pos;
  const sup = how === 'support' && support !== null ? skaterById(state, support) : null;
  const toSupport = d.clean && sup !== null && sup.onIce && !sup.leaving && sup.downT === 0
    && !crossesNet(p, bladePos(sup.pos, sup.facing, ctx.defs.get(sup.id)!.shoots, bladeScratch));
  // On his stick only from his blade's reach (it rode his blade as he came away; if he turned away from it, it squirts).
  const wb = bladePos(winner.pos, winner.facing, ctx.defs.get(winner.id)!.shoots, bladeScratch);
  const toWinner = d.clean && !toSupport && !crossesNet(p, wb) && hypot2(wb.x - p.x, wb.y - p.y) <= HAND_OVER;
  const clean = toSupport || toWinner;
  ctx.emit(contestEvent(state, {
    type: 'battle', side: winner.side, playerId: winner.id, otherId: loserId, pos: c.spot,
    detail: { how, contestId: c.id, winnerSupportId: support, loserSupportId: loserSupport },
  }));
  // Won off the man who was carrying it: a turnover, clean (`battle`) or squirting loose (`battleLoose`).
  const stripped = r.stripped === loserId;
  if (stripped) ctx.emit(contestEvent(state, { type: 'turnover', side: winner.side, playerId: winner.id, otherId: loserId, pos: c.spot, detail: { how: clean ? 'battle' : 'battleLoose' } }));
  for (const id of c.participants) setCooldown(state, id, KIND, T.cooldownSeconds);
  setCooldown(state, loserId, 'pokeCheck', T.loserPokeCooldown);
  if (clean && stripped) watchTurnover(state, winner.side, winner.id, loserId, 'battle', { held: d.held });
  if (toSupport) {
    passScratch.length = 0;
    passFromFeet(state, winner.id, sup!.id, ctx.rng.range(T.passSpeed[0], T.passSpeed[1]), ctx.defs, ctx.rng, passScratch);
    for (const e of passScratch) ctx.emit(e);
    return { winnerId: winner.id, puck: 'loose', outcome: how, puckTo: sup!.id };
  }
  if (toWinner) return { winnerId: winner.id, puck: 'toWinner', outcome: how };
  // He gets a piece of it, but it squirts along the boards.
  state.lastTouch = { id: winner.id, side: winner.side };
  state.possession = winner.side;
  recordTouch(state, winner.id, winner.side);
  const n = boardsNormal(c.spot, { x: 0, y: 0 });
  const dirAlong = ctx.rng.chance(0.5) ? 1 : -1;
  const v = ctx.rng.range(T.squirtSpeed[0], T.squirtSpeed[1]);
  state.puck.vel.x = -n.y * dirAlong * v - n.x * 0.5;
  state.puck.vel.y = n.x * dirAlong * v - n.y * 0.5;
  blockPickup(state, c.participants.slice());
  return { winnerId: winner.id, puck: 'unchanged', outcome: how, puckTo: null };
}

const scratchN: Vec2 = { x: 0, y: 0 };

function setFace(s: SkaterState, x: number, y: number): void {
  if (s.faceTarget) { s.faceTarget.x = x; s.faceTarget.y = y; } else s.faceTarget = { x, y };
}

/**
 * Everyone in it, every tick: to the puck while arriving; shoving at it (the man ahead leaning into the other) in the
 * pin; once one is pinned, he is held on the boards with the pinner on his back, both at the puck; supporting players
 * wait on their own side of it (supportSpot). While it resolves a clean win: the winner comes T.comeAway off the boards
 * with it, facing the ice (won by support: he stays on it, facing his supporter); the loser stays where he is.
 */
function steer(c: Battle, ctx: ContestCtx): void {
  const state = ctx.state;
  const d = c.roles;
  const n = boardsNormal(c.spot, scratchN);
  const toBoards = distToBoards(c.spot);
  const bx = c.spot.x + n.x * toBoards, by = c.spot.y + n.y * toBoards;
  const resolving = c.stage === 'resolve' && c.data.clean && d.winner !== null;
  const passOn = resolving && howOf(c) === 'support';
  for (let i = 0; i < c.participants.length; i++) {
    const s = skaterById(state, c.participants[i]!);
    if (s.id === d.supportA || s.id === d.supportB) {
      supportSpot(c.spot, -state.attackDir[s.side] * RINK.goalLineX, T.supportOff, T.supportBoards, s.target);
      setFace(s, c.spot.x, c.spot.y);
      s.speedCap = 1;
      continue;
    }
    const r = movementOf(ctx.defs.get(s.id)!, 1).radius;
    if (resolving) {
      if (s.id === d.winner && !passOn) {
        s.target.x = c.spot.x - n.x * T.comeAway;
        s.target.y = c.spot.y - n.y * T.comeAway;
        setFace(s, c.spot.x - n.x * 6, c.spot.y - n.y * 6);
        s.speedCap = 1;
      } else if (s.id === d.winner) {
        const sup = skaterById(state, (i === 0 ? d.supportA : d.supportB)!);
        s.target.x = s.pos.x;
        s.target.y = s.pos.y;
        setFace(s, sup.pos.x, sup.pos.y);
        s.speedCap = DIG_SPEED_CAP;
      } else {
        s.target.x = s.pos.x;
        s.target.y = s.pos.y;
        s.speedCap = DIG_SPEED_CAP;
      }
      continue;
    }
    if (c.stage === 'protect') {
      if (s.id === d.carrier) continue; // he keeps skating his own way, the puck on his stick
      const o = skaterById(state, idOf(c, other(i)));
      s.target.x = o.pos.x;
      s.target.y = o.pos.y;
      setFace(s, state.puck.pos.x, state.puck.pos.y);
      s.speedCap = 1;
    } else if (c.stage === 'arrive') {
      s.target.x = c.spot.x;
      s.target.y = c.spot.y;
      setFace(s, c.spot.x, c.spot.y);
      s.speedCap = 1;
    } else if (d.pinned === null) {
      // Shoulder to shoulder at the puck; the man ahead leans into the other.
      const o = skaterById(state, idOf(c, other(i)));
      const leaning = c.leader === s.id;
      s.target.x = leaning ? o.pos.x : c.spot.x;
      s.target.y = leaning ? o.pos.y : c.spot.y;
      setFace(s, bx, by);
      s.speedCap = c.stage === 'pin' ? PIN_SPEED_CAP : DIG_SPEED_CAP;
    } else if (s.id === d.pinned) {
      s.target.x = bx - n.x * r;
      s.target.y = by - n.y * r;
      setFace(s, bx, by);
      s.speedCap = DIG_SPEED_CAP;
    } else {
      const o = skaterById(state, idOf(c, other(i)));
      const ro = movementOf(ctx.defs.get(o.id)!, 1).radius;
      s.target.x = o.pos.x - n.x * (r + ro);
      s.target.y = o.pos.y - n.y * (r + ro);
      setFace(s, c.spot.x, c.spot.y);
      s.speedCap = PIN_SPEED_CAP;
    }
  }
}
