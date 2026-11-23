import { DT } from '../constants';
import { RINK, zoneOf } from '../rink';
import { movementOf } from '../skating';
import { ozoneSpotPos } from '../team-play';
import { TUNING } from '../tuning';
import type { ContestState, GameState, SkaterState } from '../types';
import { dist, hypot2, type Vec2 } from '../vec';
import {
  carrierNow, carrierOf, contestRating, enterStage, isFree, onCooldown, setCooldown, skaterById, STAGE_EPS, winProb,
  type Contest, type ContestCtx,
} from './core';

const KIND = 'netFront';
const T = TUNING.netFront;
/** One round every ROUND_SECONDS; what a round wins (the screen, or the tie-up) lasts EFFECT_SECONDS. */
const ROUND_SECONDS = 1.2;
const EFFECT_SECONDS = 1.2;
/** The attacker who won the last round is first to a rebound (+10 in a loose-puck race) for this long (s). */
const REBOUND_EDGE_SECONDS = 2;
/** A tied-up attacker is moved this far (m) out from the net. */
const PUSH_OUT = 1.5;
/** A free attacker this far (m) from his net-front spot has left it: the battle is over. */
const LEAVE_RANGE = 2.5;
/** How hard each skates (fraction of top speed): the defender leaning on him, the attacker being moved out. */
const DEFENDER_SPEED_CAP = 0.7;
const PUSHED_SPEED_CAP = 0.5;
const FORWARDS = ['LW', 'C', 'RW'];

const spotScratch: Vec2 = { x: 0, y: 0 };

/** Centre of the net `s` attacks. */
const netOf = (state: GameState, s: SkaterState): Vec2 => ({ x: state.attackDir[s.side] * RINK.goalLineX, y: 0 });

/**
 * Net-front battle. Participants: the attacking forward (in `freeIds` except while tied up: he keeps playing, can take a
 * pass and pick up a rebound), then the defender, whom it steers goal-side of him, leaning on him. Stages: `jostle`
 * (the first 1.2 s), then each 1.2 s a round decides the next stage: `free` (the attacker held his ground: he screens
 * the goalie, `screenedUntilTick` 1.2 s ahead, and is first to a rebound) or `tied` (the defender moved him 1.5 m out
 * and tied up his stick: no pass to him or rebound for him for 1.2 s, `tiedUpUntil`). `leader`: the last round's winner.
 * A round: winProb of strength .4, balance .3, compete .3 against the same, plus mass difference / 4. It ends with
 * no puck change when the attacking side loses the puck, the puck is loose or leaves the zone, the attacker gets the
 * puck, or he skates away from the net front.
 */
export const netFrontContest: Contest = {
  kind: KIND,

  trigger(ctx, s) {
    const state = ctx.state;
    const carrier = carrierNow(ctx);
    if (!carrier || carrier.side !== s.side || carrier === s || s.slot === null || !FORWARDS.includes(s.slot)) return null;
    if (zoneOf(state.puck.pos.x, state.attackDir[s.side]) !== 'O' || onCooldown(state, s.id, KIND)) return null;
    if (dist(s.pos, ozoneSpotPos(state, s.side, 'netFront', spotScratch)) > T.spotRange) return null;
    let o: SkaterState | null = null, od = T.triggerRange;
    for (const t of state.skaters) {
      if (t.side === s.side || !isFree(t) || onCooldown(state, t.id, KIND)) continue;
      const d = dist(t.pos, s.pos);
      if (d <= od) { od = d; o = t; }
    }
    return o ? [s.id, o.id] : null;
  },

  start(ctx, participants) {
    const state = ctx.state;
    const att = skaterById(state, participants[0]!);
    const c: ContestState = {
      id: -1, kind: KIND, stage: 'jostle', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: att.pos.x, y: att.pos.y }, freeIds: [att.id], data: { rounds: 0, outX: 0, outY: 0 },
    };
    steer(c, ctx);
    return c;
  },

  update(c, ctx) {
    const state = ctx.state;
    const att = skaterById(state, c.participants[0]!), def = skaterById(state, c.participants[1]!);
    const carrier = carrierOf(state);
    const over = carrier === att || (carrier !== null && carrier.side !== att.side)
      || (carrier === null && state.pendingPass === null)
      || zoneOf(state.puck.pos.x, state.attackDir[att.side]) !== 'O'
      || (c.stage !== 'tied' && dist(att.pos, ozoneSpotPos(state, att.side, 'netFront', spotScratch)) > LEAVE_RANGE);
    if (over) {
      setCooldown(state, att.id, KIND, T.cooldownSeconds);
      setCooldown(state, def.id, KIND, T.cooldownSeconds);
      return { winnerId: c.leader, puck: 'unchanged' };
    }
    if (c.stageT >= ROUND_SECONDS - STAGE_EPS) round(c, ctx, att, def);
    c.spot.x = att.pos.x;
    c.spot.y = att.pos.y;
    steer(c, ctx);
    return null;
  },
};

function round(c: ContestState, ctx: ContestCtx, att: SkaterState, def: SkaterState): void {
  const state = ctx.state;
  const ma = movementOf(ctx.defs.get(att.id)!, 1).mass, md = movementOf(ctx.defs.get(def.id)!, 1).mass;
  const edge = contestRating(ctx, c, att.id, T.body) - contestRating(ctx, c, def.id, T.body) + (ma - md) / T.massPerPoint;
  const effectTick = state.tick + Math.round(EFFECT_SECONDS / DT);
  c.data.rounds!++;
  if (ctx.rng.next() < winProb(edge)) {
    state.screenedUntilTick[def.side] = effectTick;
    state.reboundEdge = { id: att.id, untilTick: state.tick + Math.round(REBOUND_EDGE_SECONDS / DT) };
    c.leader = att.id;
    if (!c.freeIds.includes(att.id)) c.freeIds.push(att.id);
    enterStage(c, 'free');
    return;
  }
  let tied = false;
  for (const t of state.tiedUpUntil) if (t.id === att.id) { t.tick = effectTick; tied = true; }
  if (!tied) state.tiedUpUntil.push({ id: att.id, tick: effectTick });
  if (state.reboundEdge?.id === att.id) state.reboundEdge = null;
  const net = netOf(state, att);
  const dx = att.pos.x - net.x, dy = att.pos.y - net.y;
  const d = hypot2(dx, dy) || 1;
  c.data.outX = att.pos.x + (dx / d) * PUSH_OUT;
  c.data.outY = att.pos.y + (dy / d) * PUSH_OUT;
  c.leader = def.id;
  c.freeIds.length = 0; // he goes where he is pushed
  enterStage(c, 'tied');
}

/** The defender stays goal-side of the attacker, leaning on him; a tied-up attacker is moved out. */
function steer(c: ContestState, ctx: ContestCtx): void {
  const state = ctx.state;
  const att = skaterById(state, c.participants[0]!), def = skaterById(state, c.participants[1]!);
  const net = netOf(state, att);
  const dx = net.x - att.pos.x, dy = net.y - att.pos.y;
  const d = hypot2(dx, dy) || 1;
  const gap = movementOf(ctx.defs.get(att.id)!, 1).radius + movementOf(ctx.defs.get(def.id)!, 1).radius;
  def.target.x = att.pos.x + (dx / d) * gap;
  def.target.y = att.pos.y + (dy / d) * gap;
  if (def.faceTarget) { def.faceTarget.x = att.pos.x; def.faceTarget.y = att.pos.y; } else def.faceTarget = { x: att.pos.x, y: att.pos.y };
  def.speedCap = DEFENDER_SPEED_CAP;
  if (c.stage === 'tied') {
    att.target.x = c.data.outX!;
    att.target.y = c.data.outY!;
    const p = state.puck.pos;
    if (att.faceTarget) { att.faceTarget.x = p.x; att.faceTarget.y = p.y; } else att.faceTarget = { x: p.x, y: p.y };
    att.speedCap = PUSHED_SPEED_CAP;
  }
}
