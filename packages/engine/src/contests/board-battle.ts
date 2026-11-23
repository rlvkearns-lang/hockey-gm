import { blockPickup, recordTouch } from '../actions';
import { stopPlay } from '../faceoff';
import { boardsNormal, distToBoards, FACEOFF_DOTS, resolveBoards, RINK } from '../rink';
import { movementOf } from '../skating';
import { TUNING } from '../tuning';
import { heldSeconds, watchTurnover } from '../turnovers';
import { PUCK_RADIUS } from '../util';
import type { ContestStateOf, GameState, SkaterState } from '../types';
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
/** A supporting player stands this far (m) off the boards. */
const SUPPORT_OFF_BOARDS = 2;
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
 * - `resolve` (0.3 s): `leader` is the winner. Then 60% of the time his side comes away with it clean (`toWinner`: to
 *   his supporting player if he has one, else to him), else it squirts loose along the boards.
 * Any time after `arrive`, the first free teammate of either side within 2.5 m joins as that side's support
 * (`roles.supportA` / `roles.supportB`): +8 for his side. One `battle` event at the end: the dig
 * winner over the loser, detail `support` (his side had support and the other did not: the numbers won it), else
 * `pinned` (the winner had pinned him), `stick` (he dug it out while pinned) or `scramble` (nobody was pinned). From
 * `arrive` on the puck is in their feet (`data.holdsPuck`): it slides on to `spot` over a few ticks and stays there
 * with nobody carrying it until the end; every participant but a shielding carrier is steered by it.
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
      if (carrier === s) return nearestOpponent(state, s);
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
    holdPuck(state, c);
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
  p.vel.x = 0;
  p.vel.y = 0;
  c.data.holdsPuck = true;
  c.data.slide = SLIDE_TICKS;
}

/** The puck in their feet: still at the spot, or still sliding there. */
function holdPuck(state: GameState, c: Battle): void {
  const p = state.puck;
  const d = c.data;
  if (d.slide > 0) {
    p.pos.x += (c.spot.x - p.pos.x) / d.slide;
    p.pos.y += (c.spot.y - p.pos.y) / d.slide;
    d.slide--;
  } else {
    p.pos.x = c.spot.x;
    p.pos.y = c.spot.y;
  }
  p.vel.x = 0;
  p.vel.y = 0;
  p.z = 0;
  p.vz = 0;
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

/** Rating points participant 0 has over participant 1 in a draw with `weights` (first man, support, chemistry in). */
function sideEdge(c: Battle, ctx: ContestCtx, weights: Weights): number {
  const r = c.roles;
  return contestRating(ctx, c, r.a, weights) - contestRating(ctx, c, r.b, weights)
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
  const edge = contestRating(ctx, c, carrier.id, T.protect) - contestRating(ctx, c, opp.id, T.strip) + (mc - mo) / T.massPerPoint + T.protectEdge;
  if (ctx.rng.next() < winProb(edge)) {
    ctx.emit(contestEvent(state, { type: 'battle', side: carrier.side, playerId: carrier.id, otherId: opp.id, pos: c.spot, detail: { how: 'protect', contestId: c.id } }));
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

/** The battle is decided: the event, cooldowns, and the puck to the winner (or his support) or squirting loose. */
function finish(c: Battle, ctx: ContestCtx): ContestResult {
  const state = ctx.state;
  const d = c.data, r = c.roles;
  const w = ix(c, r.winner), l = other(w);
  const winner = skaterById(state, idOf(c, w)), loserId = idOf(c, l);
  const support = w === 0 ? r.supportA : r.supportB;
  const outnumbered = (l === 0 ? r.supportA : r.supportB) === null;
  const how = support !== null && outnumbered ? 'support' : r.pinned === null ? 'scramble' : r.pinned === loserId ? 'pinned' : 'stick';
  ctx.emit(contestEvent(state, { type: 'battle', side: winner.side, playerId: winner.id, otherId: loserId, pos: c.spot, detail: { how, contestId: c.id } }));
  // Won off the man who was carrying it: a turnover, clean (`battle`) or squirting loose (`battleLoose`).
  const stripped = r.stripped === loserId;
  if (stripped) ctx.emit(contestEvent(state, { type: 'turnover', side: winner.side, playerId: winner.id, otherId: loserId, pos: c.spot, detail: { how: d.clean ? 'battle' : 'battleLoose' } }));
  for (const id of c.participants) setCooldown(state, id, KIND, T.cooldownSeconds);
  setCooldown(state, loserId, 'pokeCheck', T.loserPokeCooldown);
  if (d.clean) {
    const to = support !== null ? support : winner.id;
    if (stripped) watchTurnover(state, winner.side, winner.id, loserId, 'battle', { held: d.held });
    return { winnerId: to, puck: 'toWinner', outcome: how };
  }
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
  return { winnerId: winner.id, puck: 'unchanged', outcome: how };
}

const scratchN: Vec2 = { x: 0, y: 0 };

function setFace(s: SkaterState, x: number, y: number): void {
  if (s.faceTarget) { s.faceTarget.x = x; s.faceTarget.y = y; } else s.faceTarget = { x, y };
}

/**
 * Everyone in it, every tick: to the puck while arriving; shoving at it (the man ahead leaning into the other) in the
 * pin; once one is pinned, he is held on the boards with the pinner on his back, both at the puck; supporting players
 * wait on the ice side.
 */
function steer(c: Battle, ctx: ContestCtx): void {
  const state = ctx.state;
  const d = c.roles;
  const n = boardsNormal(c.spot, scratchN);
  const toBoards = distToBoards(c.spot);
  const bx = c.spot.x + n.x * toBoards, by = c.spot.y + n.y * toBoards;
  for (let i = 0; i < c.participants.length; i++) {
    const s = skaterById(state, c.participants[i]!);
    if (s.id === d.supportA || s.id === d.supportB) {
      s.target.x = c.spot.x - n.x * SUPPORT_OFF_BOARDS;
      s.target.y = c.spot.y - n.y * SUPPORT_OFF_BOARDS;
      setFace(s, c.spot.x, c.spot.y);
      s.speedCap = 1;
      continue;
    }
    const r = movementOf(ctx.defs.get(s.id)!, 1).radius;
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
