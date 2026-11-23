import { blockPickup, recordTouch } from '../actions';
import { stopPlay } from '../faceoff';
import { boardsNormal, distToBoards, FACEOFF_DOTS, RINK } from '../rink';
import { movementOf } from '../skating';
import type { ContestState, GameState, SkaterState } from '../types';
import { dist, hypot2, type Vec2 } from '../vec';
import {
  carrierOf, contestEvent, contestRating, enterStage, isFree, onCooldown, puckHeldByContest, setCooldown, skaterById, STAGE_EPS, winProb,
  type Contest, type ContestCtx, type ContestResult, type Weights,
} from './core';

const KIND = 'boardBattle';
/**
 * Trigger: the puck this close (m) to the boards, slower than this (m/s), on the ice and not a shot, with a skater of
 * each team this close (m) to it. A carried puck counts (the carrier is then one of the two), so a carrier rubbed out
 * along the boards ends up in a battle for it.
 */
const TRIGGER_BOARDS = 1.2;
const TRIGGER_SPEED = 6;
const TRIGGER_RANGE = 2;
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
 * With nobody pinned, DIG_MAX_ROUNDS rounds without a side winning two in a row traps the puck. */
const DIG_ROUND: [number, number] = [0.5, 0.62];
const DIG_MIN = 1;
const DIG_MAX_ROUNDS = 4;
/** `resolve` shows the winner this long (s) before the puck moves. */
const RESOLVE_SECONDS = 0.3;
/** Rating points: first man in, a pinned man digging (against him), a supporting teammate; mass difference (kg) per point. */
const FIRST_EDGE = 6;
const PINNED_EDGE = 10;
const SUPPORT_EDGE = 8;
const MASS_PER_POINT = 4;
/** A free teammate this close (m) to the spot joins as his side's support. */
const SUPPORT_RANGE = 2.5;
/** A supporting player stands this far (m) off the boards. */
const SUPPORT_OFF_BOARDS = 2;
/** The winner comes away with it clean this often; otherwise it squirts along the boards at SQUIRT_SPEED m/s. */
const CLEAN_SHARE = 0.6;
const SQUIRT_SPEED: [number, number] = [2, 4];
/** Afterwards nobody in it starts another board battle for this long (s), and the loser does not poke at once. */
const COOLDOWN_SECONDS = 1.5;
const LOSER_POKE_COOLDOWN = 1;
/** How hard they skate (fraction of top speed) while shoving and digging. */
const PIN_SPEED_CAP = 0.4;
const DIG_SPEED_CAP = 0.3;
const PIN: Weights = { strength: 0.45, balance: 0.3, compete: 0.25 };
const DIG: Weights = { stickChecking: 0.35, puckHandling: 0.3, compete: 0.2, agility: 0.15 };

/** No one (for data fields that hold a participant index: 0 is the first participant, 1 the second). */
const NONE = -1;

/** `ContestState.data` of a board battle (participant indexes, or NONE). */
type BattleData = {
  /** 1: the puck stays still at `spot`, nobody may pick it up. */
  holdsPuck: number;
  /** The first man in (+6), and 1 once that is settled. */
  first: number;
  firstSet: number;
  /** Pin draws won by participant 0 less those won by participant 1. */
  balance: number;
  /** The man held on the boards. */
  pinned: number;
  /** stageT of the next pin or dig draw. */
  nextAt: number;
  /** Winner of the last dig round, and how many rounds so far. */
  digLast: number;
  digRounds: number;
  /** The dig winner, and 1 if he comes away with it clean (0: it squirts loose). */
  winner: number;
  clean: number;
  /** Each side's supporting player (side of participant 0, side of participant 1). */
  supportA: number;
  supportB: number;
};
const dataOf = (c: ContestState): BattleData => c.data as BattleData;

/**
 * Board battle (trigger above). Participants: the two men (index 0 and 1), then any supporting players. Stages:
 * - `arrive` (0.3 to 0.8 s): both go to the puck; the first within reach (`data.first`) has +6 for the rest of it.
 *   `leader`: the first man, else the closer.
 * - `pin` (0.8 to 1.6 s): a shoving draw every 0.2 s (strength .45, balance .3, compete .25, plus mass difference / 4);
 *   `data.balance` is the running score (+ for participant 0) and `leader` whoever is ahead. A lead of two pins the
 *   other man against the boards (`data.pinned`, his participant index); level at the end, nobody is pinned.
 * - `dig` (1.0 to 2.5 s): stick draws (stickChecking .35, puckHandling .3, compete .2, agility .15; a pinned man at
 *   -10). The pinner, with the puck in his feet, wins the dig on the first round he wins; the pinned man has to win two
 *   rounds in a row to dig it out. With nobody pinned either side needs two in a row, and four rounds without that
 *   trap the puck: `freeze` (detail `trapped`) and a faceoff at the nearest end-zone dot inside a blue line, else the
 *   nearest neutral-zone dot. `leader`: whoever is ahead in the dig.
 * - `resolve` (0.3 s): `leader` is the winner. Then 60% of the time his side comes away with it clean (`toWinner`: to
 *   his supporting player if he has one, else to him), else it squirts loose along the boards.
 * Any time after `arrive`, the first free teammate of either side within 2.5 m joins as that side's support
 * (`data.supportA` / `data.supportB`, his participant index): +8 for his side. One `battle` event at the end: the dig
 * winner over the loser, detail `support` (his side had support and the other did not: the numbers won it), else
 * `pinned` (the winner had pinned him), `stick` (he dug it out while pinned) or `scramble` (nobody was pinned). From
 * the start the puck stays still at `spot` with nobody carrying it until then (`data.holdsPuck`); every participant is
 * steered by it.
 */
export const boardBattleContest: Contest = {
  kind: KIND,

  trigger(ctx, s) {
    const state = ctx.state;
    const p = state.puck;
    if (state.shotInFlight !== null || p.z > 0.1) return null;
    if (hypot2(p.vel.x, p.vel.y) >= TRIGGER_SPEED || distToBoards(p.pos) > TRIGGER_BOARDS) return null;
    if (dist(s.pos, p.pos) > TRIGGER_RANGE || onCooldown(state, s.id, KIND) || puckHeldByContest(state)) return null;
    const carrier = carrierOf(state);
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
    state.pendingPass = null;
    state.carrierId = null; // a carried puck is knocked into their feet
    p.vel.x = 0;
    p.vel.y = 0;
    const c: ContestState = {
      id: -1, kind: KIND, stage: 'arrive', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: p.pos.x, y: p.pos.y }, freeIds: [],
      data: {
        holdsPuck: 1, first: NONE, firstSet: 0, balance: 0, pinned: NONE, nextAt: PIN_ROUND, digLast: NONE, digRounds: 0,
        winner: NONE, clean: 0, supportA: NONE, supportB: NONE,
      },
    };
    steer(c, ctx);
    return c;
  },

  update(c, ctx) {
    const state = ctx.state;
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

/** `s` and the nearest free opponent within TRIGGER_RANGE of the puck, or null. */
function nearestOpponent(state: GameState, s: SkaterState): string[] | null {
  let o: SkaterState | null = null, od = TRIGGER_RANGE;
  for (const t of state.skaters) {
    if (t.side === s.side || !isFree(t) || onCooldown(state, t.id, KIND)) continue;
    const d = dist(t.pos, state.puck.pos);
    if (d <= od) { od = d; o = t; }
  }
  return o ? [s.id, o.id] : null;
}

const idOf = (c: ContestState, i: number): string => c.participants[i]!;
const other = (i: number): number => 1 - i;

/** The puck stays still where the battle is, in their feet. */
function holdPuck(state: GameState, c: ContestState): void {
  const p = state.puck;
  p.pos.x = c.spot.x;
  p.pos.y = c.spot.y;
  p.vel.x = 0;
  p.vel.y = 0;
  p.z = 0;
  p.vz = 0;
}

/** Each side without support takes the first free teammate (skater order) within SUPPORT_RANGE of the spot. */
function joinSupport(c: ContestState, ctx: ContestCtx): void {
  const state = ctx.state;
  for (let i = 0; i < 2; i++) {
    const key = i === 0 ? 'supportA' : 'supportB';
    if (dataOf(c)[key] !== NONE) continue;
    const side = skaterById(state, idOf(c, i)).side;
    for (const s of state.skaters) {
      if (s.side !== side || !isFree(s) || dist(s.pos, c.spot) > SUPPORT_RANGE) continue;
      dataOf(c)[key] = c.participants.length;
      c.participants.push(s.id);
      s.contestId = c.id;
      break;
    }
  }
}

/** Rating points participant 0 has over participant 1 in a draw with `weights` (first man, support, chemistry in). */
function sideEdge(c: ContestState, ctx: ContestCtx, weights: Weights): number {
  const d = dataOf(c);
  return contestRating(ctx, c, idOf(c, 0), weights) - contestRating(ctx, c, idOf(c, 1), weights)
    + (d.first === 0 ? FIRST_EDGE : d.first === 1 ? -FIRST_EDGE : 0)
    + (d.supportA !== NONE ? SUPPORT_EDGE : 0) - (d.supportB !== NONE ? SUPPORT_EDGE : 0);
}

/** Who gets there first. */
function arrive(c: ContestState, ctx: ContestCtx): void {
  const state = ctx.state;
  const d = dataOf(c);
  const da = dist(skaterById(state, idOf(c, 0)).pos, c.spot), db = dist(skaterById(state, idOf(c, 1)).pos, c.spot);
  const inA = da <= ARRIVE_REACH, inB = db <= ARRIVE_REACH;
  if (d.firstSet === 0 && (inA || inB)) {
    d.firstSet = 1;
    d.first = inA && inB ? NONE : inA ? 0 : 1;
  }
  const over = (c.stageT >= ARRIVE_SECONDS[0] - STAGE_EPS && inA && inB) || c.stageT >= ARRIVE_SECONDS[1] - STAGE_EPS;
  if (over && d.firstSet === 0) {
    d.firstSet = 1;
    d.first = Math.abs(da - db) < FIRST_GAP ? NONE : da < db ? 0 : 1;
  }
  c.leader = d.first !== NONE ? idOf(c, d.first) : da < db ? idOf(c, 0) : db < da ? idOf(c, 1) : null;
  if (!over) return;
  d.nextAt = PIN_ROUND;
  enterStage(c, 'pin');
}

/** Shoving draws until one man leads by PIN_MARGIN; the stage ends between PIN_SECONDS[0] and [1]. */
function pin(c: ContestState, ctx: ContestCtx): void {
  const d = dataOf(c);
  if (Math.abs(d.balance) < PIN_MARGIN && c.stageT >= d.nextAt - STAGE_EPS) {
    const ma = movementOf(ctx.defs.get(idOf(c, 0))!, 1).mass, mb = movementOf(ctx.defs.get(idOf(c, 1))!, 1).mass;
    const edge = sideEdge(c, ctx, PIN) + (ma - mb) / MASS_PER_POINT;
    d.balance += ctx.rng.next() < winProb(edge) ? 1 : -1;
    d.nextAt += PIN_ROUND;
    if (Math.abs(d.balance) >= PIN_MARGIN) d.pinned = d.balance > 0 ? 1 : 0;
  }
  c.leader = d.balance > 0 ? idOf(c, 0) : d.balance < 0 ? idOf(c, 1) : null;
  const decided = d.pinned !== NONE;
  if ((decided && c.stageT >= PIN_SECONDS[0] - STAGE_EPS) || c.stageT >= PIN_SECONDS[1] - STAGE_EPS) {
    d.nextAt = ctx.rng.range(DIG_ROUND[0], DIG_ROUND[1]);
    enterStage(c, 'dig');
  }
}

/** Stick draws; returns a result only when the puck is trapped (play stops). */
function dig(c: ContestState, ctx: ContestCtx): ContestResult | null {
  const d = dataOf(c);
  if (d.winner === NONE && c.stageT >= d.nextAt - STAGE_EPS) {
    const pinEdge = d.pinned === 0 ? -PINNED_EDGE : d.pinned === 1 ? PINNED_EDGE : 0;
    const w = ctx.rng.next() < winProb(sideEdge(c, ctx, DIG) + pinEdge) ? 0 : 1;
    d.digRounds++;
    if (d.pinned !== NONE) {
      if (w !== d.pinned || d.digLast === d.pinned) d.winner = w;
    } else if (d.digLast === w) d.winner = w;
    else if (d.digRounds >= DIG_MAX_ROUNDS) return trapped(c, ctx);
    d.digLast = w;
    if (d.winner === NONE) d.nextAt += ctx.rng.range(DIG_ROUND[0], DIG_ROUND[1]);
  }
  const ahead = d.winner !== NONE ? d.winner
    : d.pinned !== NONE ? (d.digLast === d.pinned ? d.pinned : other(d.pinned)) : d.digLast;
  c.leader = ahead === NONE ? null : idOf(c, ahead);
  if (d.winner !== NONE && c.stageT >= DIG_MIN - STAGE_EPS) {
    d.clean = ctx.rng.chance(CLEAN_SHARE) ? 1 : 0;
    enterStage(c, 'resolve');
  }
  return null;
}

/** Neither side can get it out: whistle, faceoff at the nearest end-zone dot inside a blue line, else neutral-zone dot. */
function trapped(c: ContestState, ctx: ContestCtx): ContestResult {
  const state = ctx.state;
  const a = skaterById(state, idOf(c, 0));
  ctx.emit(contestEvent(state, { type: 'freeze', side: a.side, playerId: a.id, otherId: idOf(c, 1), assistIds: [], detail: 'trapped' }));
  const inEnd = Math.abs(c.spot.x) > RINK.blueLineX;
  let best: Vec2 = FACEOFF_DOTS.centre, bestD = Infinity;
  for (const dot of inEnd ? FACEOFF_DOTS.end : FACEOFF_DOTS.neutral) {
    if (inEnd && dot.x * c.spot.x < 0) continue;
    const dd = dist(dot, c.spot);
    if (dd < bestD) { bestD = dd; best = dot; }
  }
  stopPlay(state, best);
  return { winnerId: null, puck: 'unchanged' };
}

/** The battle is decided: the event, cooldowns, and the puck to the winner (or his support) or squirting loose. */
function finish(c: ContestState, ctx: ContestCtx): ContestResult {
  const state = ctx.state;
  const d = dataOf(c);
  const w = d.winner, l = other(w);
  const winner = skaterById(state, idOf(c, w));
  const supportIdx = w === 0 ? d.supportA : d.supportB;
  const outnumbered = (l === 0 ? d.supportA : d.supportB) === NONE;
  const detail = supportIdx !== NONE && outnumbered ? 'support' : d.pinned === NONE ? 'scramble' : d.pinned === l ? 'pinned' : 'stick';
  ctx.emit(contestEvent(state, { type: 'battle', side: winner.side, playerId: winner.id, otherId: idOf(c, l), assistIds: [], detail }));
  for (const id of c.participants) setCooldown(state, id, KIND, COOLDOWN_SECONDS);
  setCooldown(state, idOf(c, l), 'pokeCheck', LOSER_POKE_COOLDOWN);
  if (d.clean === 1) return { winnerId: supportIdx !== NONE ? idOf(c, supportIdx) : winner.id, puck: 'toWinner' };
  // He gets a piece of it, but it squirts along the boards.
  state.lastTouch = { id: winner.id, side: winner.side };
  state.possession = winner.side;
  recordTouch(state, winner.id, winner.side);
  const n = boardsNormal(c.spot, { x: 0, y: 0 });
  const dirAlong = ctx.rng.chance(0.5) ? 1 : -1;
  const v = ctx.rng.range(SQUIRT_SPEED[0], SQUIRT_SPEED[1]);
  state.puck.vel.x = -n.y * dirAlong * v - n.x * 0.5;
  state.puck.vel.y = n.x * dirAlong * v - n.y * 0.5;
  blockPickup(state, c.participants.slice());
  return { winnerId: winner.id, puck: 'unchanged' };
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
function steer(c: ContestState, ctx: ContestCtx): void {
  const state = ctx.state;
  const d = dataOf(c);
  const n = boardsNormal(c.spot, scratchN);
  const toBoards = distToBoards(c.spot);
  const bx = c.spot.x + n.x * toBoards, by = c.spot.y + n.y * toBoards;
  for (let i = 0; i < c.participants.length; i++) {
    const s = skaterById(state, c.participants[i]!);
    if (i === d.supportA || i === d.supportB) {
      s.target.x = c.spot.x - n.x * SUPPORT_OFF_BOARDS;
      s.target.y = c.spot.y - n.y * SUPPORT_OFF_BOARDS;
      setFace(s, c.spot.x, c.spot.y);
      s.speedCap = 1;
      continue;
    }
    const r = movementOf(ctx.defs.get(s.id)!, 1).radius;
    if (c.stage === 'arrive') {
      s.target.x = c.spot.x;
      s.target.y = c.spot.y;
      setFace(s, c.spot.x, c.spot.y);
      s.speedCap = 1;
    } else if (d.pinned === NONE) {
      // Shoulder to shoulder at the puck; the man ahead leans into the other.
      const o = skaterById(state, idOf(c, other(i)));
      const leaning = c.leader === s.id;
      s.target.x = leaning ? o.pos.x : c.spot.x;
      s.target.y = leaning ? o.pos.y : c.spot.y;
      setFace(s, bx, by);
      s.speedCap = c.stage === 'pin' ? PIN_SPEED_CAP : DIG_SPEED_CAP;
    } else if (i === d.pinned) {
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
