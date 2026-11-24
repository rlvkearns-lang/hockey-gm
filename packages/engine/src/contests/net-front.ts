import { DT } from '../constants';
import { RINK, zoneOf } from '../rink';
import { movementOf } from '../skating';
import { planOf } from '../commit';
import { netFrontSpot } from '../job-targets';
import { TUNING } from '../tuning';
import type { ContestStateOf, GameState, SkaterState } from '../types';
import { dist, hypot2, type Vec2 } from '../vec';
import {
  carrierNow, carrierOf, contestEvent, contestRating, enterStage, isFree, onCooldown, setCooldown, skaterById, STAGE_EPS, winProb,
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
 * puck, or he skates away from the net front; after at least one round, a `battle` event (detail `netFront`) credits
 * the last round's winner.
 */
export const netFrontContest: Contest<'netFront'> = {
  kind: KIND,

  gate(ctx) {
    const carrier = carrierNow(ctx);
    return carrier !== null && zoneOf(ctx.state.puck.pos.x, ctx.state.attackDir[carrier.side]) === 'O';
  },

  trigger(ctx, s) {
    const state = ctx.state;
    const carrier = carrierNow(ctx);
    if (!carrier || carrier.side !== s.side || carrier === s || s.slot === null || !FORWARDS.includes(s.slot)) return null;
    if (zoneOf(state.puck.pos.x, state.attackDir[s.side]) !== 'O' || onCooldown(state, s.id, KIND)) return null;
    // Only the man whose job is the net front, there (within spotRange of his target).
    if (planOf(state, s.id).job !== 'netFront' || dist(s.pos, s.target) > T.spotRange) return null;
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
    const c: ContestStateOf<'netFront'> = {
      id: -1, kind: KIND, stage: 'jostle', stageT: 0, participants: participants.slice(), leader: null,
      spot: { x: att.pos.x, y: att.pos.y }, freeIds: [att.id], roles: { attacker: att.id, defender: participants[1]! },
      data: { rounds: 0, outX: 0, outY: 0 },
    };
    steer(c, ctx);
    return c;
  },

  update(c, ctx) {
    const state = ctx.state;
    const att = skaterById(state, c.roles.attacker), def = skaterById(state, c.roles.defender);
    const carrier = carrierOf(state);
    const over = carrier === att || (carrier !== null && carrier.side !== att.side)
      || (carrier === null && state.pendingPass === null)
      || zoneOf(state.puck.pos.x, state.attackDir[att.side]) !== 'O'
      || (c.stage !== 'tied' && dist(att.pos, netFrontSpot(state, att.side, spotScratch)) > LEAVE_RANGE);
    if (over) {
      setCooldown(state, att.id, KIND, T.cooldownSeconds);
      setCooldown(state, def.id, KIND, T.cooldownSeconds);
      if (c.leader !== null) {
        // Whoever won the last round won the battle for the net front.
        const w = c.leader === att.id ? att : def, l = w === att ? def : att;
        ctx.emit(contestEvent(state, { type: 'battle', side: w.side, playerId: w.id, otherId: l.id, pos: c.spot, detail: { how: 'netFront', contestId: c.id } }));
      }
      return { winnerId: c.leader, puck: 'unchanged', outcome: c.leader === null ? 'noRound' : c.leader === att.id ? 'attacker' : 'defender' };
    }
    if (c.stageT >= ROUND_SECONDS - STAGE_EPS) round(c, ctx, att, def);
    c.spot.x = att.pos.x;
    c.spot.y = att.pos.y;
    steer(c, ctx);
    return null;
  },
};

function round(c: ContestStateOf<'netFront'>, ctx: ContestCtx, att: SkaterState, def: SkaterState): void {
  const state = ctx.state;
  const ma = movementOf(ctx.defs.get(att.id)!, 1).mass, md = movementOf(ctx.defs.get(def.id)!, 1).mass;
  const edge = contestRating(ctx, c, att.id, T.body) - contestRating(ctx, c, def.id, T.body) + (ma - md) / T.massPerPoint;
  const effectTick = state.tick + Math.round(EFFECT_SECONDS / DT);
  c.data.rounds++;
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
function steer(c: ContestStateOf<'netFront'>, ctx: ContestCtx): void {
  const state = ctx.state;
  const att = skaterById(state, c.roles.attacker), def = skaterById(state, c.roles.defender);
  const net = netOf(state, att);
  const dx = net.x - att.pos.x, dy = net.y - att.pos.y;
  const d = hypot2(dx, dy) || 1;
  const gap = movementOf(ctx.defs.get(att.id)!, 1).radius + movementOf(ctx.defs.get(def.id)!, 1).radius;
  def.target.x = att.pos.x + (dx / d) * gap;
  def.target.y = att.pos.y + (dy / d) * gap;
  if (def.faceTarget) { def.faceTarget.x = att.pos.x; def.faceTarget.y = att.pos.y; } else def.faceTarget = { x: att.pos.x, y: att.pos.y };
  def.speedCap = DEFENDER_SPEED_CAP;
  if (c.stage === 'tied') {
    att.target.x = c.data.outX;
    att.target.y = c.data.outY;
    const p = state.puck.pos;
    if (att.faceTarget) { att.faceTarget.x = p.x; att.faceTarget.y = p.y; } else att.faceTarget = { x: p.x, y: p.y };
    att.speedCap = PUSHED_SPEED_CAP;
  }
}
