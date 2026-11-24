import { atWrapPost as atWrapPost_, executeClear as executeClear_, executeDump as executeDump_, executePass as executePass_, executeRim as executeRim_, executeShot as executeShot_ } from './actions';
import { BRAIN_INTERVAL_TICKS as BRAIN_INTERVAL_TICKS_, DT as DT_ } from './constants';
import { carryOffside as carryOffside_, chooseOption as chooseOption_, listOptions as listOptions_, planBeaten as planBeaten_, readSituationInto as readSituationInto_, shieldingInBattle as shieldingInBattle_, type Option, type Situation } from './options';
import { RINK } from './rink';
import { TUNING as TUNING_ } from './tuning';
import { steeredByContest as steeredByContest_ } from './team-play';
import type { Rng } from './rng';
import type { CarrierPlan, CarryLane, GameEvent, GameState, PlayerDef, SkaterState } from './types';
import { hypot2 as hypot2_, type Vec2 } from './vec';
import { clamp as clamp_, findSkater as findSkater_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
// Never alias in a module on an import cycle: brain is on none.
const executeClear = executeClear_;
const atWrapPost = atWrapPost_;
const executeDump = executeDump_;
const executePass = executePass_;
const executeRim = executeRim_;
const executeShot = executeShot_;
const BRAIN_INTERVAL_TICKS = BRAIN_INTERVAL_TICKS_;
const DT = DT_;
const chooseOption = chooseOption_;
const carryOffside = carryOffside_;
const shieldingInBattle = shieldingInBattle_;
const listOptions = listOptions_;
const readSituationInto = readSituationInto_;
const planBeaten = planBeaten_;
const TUNING = TUNING_;
const steeredByContest = steeredByContest_;
const clamp = clamp_;
const findSkater = findSkater_;
const hypot2 = hypot2_;

export { canReceivePass } from './options';

export type Decision =
  | { kind: 'carry'; to: Vec2; lane: CarryLane }
  | { kind: 'pass'; toId: string }
  | { kind: 'shoot' }
  | { kind: 'dump' }
  | { kind: 'protect' }
  | { kind: 'rim'; toId: string | null }
  | { kind: 'clear' };

const T = TUNING.brain;
const optionScratch: Option[] = [];
/** A protecting carrier's target stays at least this far (m) on the puck's side of a goal line. */
const PROTECT_OFF_LINE = 0.6;
/** Holding behind the net, he faces the slot at this rx. */
const HOLD_FACE_RX = 20;
/** brainTick's copy of the carrier's situation (written by decideCarrier, read for his carry speed). */
const sitScratch: Situation = { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false, held: 0, since: 0 };

/**
 * The situation as a key: its mode (the rule that narrows his options), the zone, and whether he is in the slot.
 * Pressure is not in it (Task 8b): "pressured low" comes and goes with a checker's distance, and pressure has its own
 * trigger (pressureArrives), which fires once.
 */
function readKey(sit: Situation): string {
  const mode = sit.breakaway ? 'break' : sit.oddMan ? 'odd' : sit.behindNet ? 'behind' : 'normal';
  const slot = sit.zone === 'O' && sit.rx >= D.slotRx && Math.abs(sit.ly) <= D.slotLy;
  return mode + ':' + sit.zone + (slot ? ':slot' : '');
}

const D = TUNING.brain.decide;
const READ_GAP_TICKS = Math.round(D.readGap / DT_);
const BETTER_TICKS = Math.round(D.betterEvery / DT_);
/** A plan is chosen afresh once it is this old (ticks): TUNING.value.noise.readSeconds, how long one read of the play lasts. */
const READ_TICKS = Math.round(TUNING.value.noise.readSeconds / DT_);
const decideScratch: Situation = { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false, held: 0, since: 0 };

/** The standing opponent nearest `s` and how far he is (m), written into nearScratch. */
const nearScratch: { o: SkaterState | null; d: number } = { o: null, d: Infinity };
function nearestChecker(state: GameState, s: SkaterState): { o: SkaterState | null; d: number } {
  let near: SkaterState | null = null, nd = Infinity;
  for (const o of state.skaters) {
    if (!o.onIce || o.side === s.side || o.downT > 0) continue;
    const d = hypot2(o.pos.x - s.pos.x, o.pos.y - s.pos.y);
    if (d < nd) { nd = d; near = o; }
  }
  nearScratch.o = near; nearScratch.d = nd;
  return nearScratch;
}

/**
 * Pressure with hysteresis (Task 8b): the checker on him (plan.checker) is an opponent who came within D.pressIn m and
 * has not gone beyond D.pressOut m since. Updates plan.checker; returns whether a checker arrived just now and the
 * trigger is off its cooldown (plan.pressUntil): the one decision point pressure makes. Pressure leaving is none.
 */
function pressureArrives(state: GameState, s: SkaterState, plan: CarrierPlan): boolean {
  if (plan.checker != null) {
    let on = false;
    for (const o of state.skaters) if (o.id === plan.checker) { on = o.onIce && o.downT === 0 && hypot2(o.pos.x - s.pos.x, o.pos.y - s.pos.y) <= D.pressOut; break; }
    if (on) return false;
    plan.checker = null;
  }
  const near = nearestChecker(state, s);
  if (near.o === null || near.d > D.pressIn) return false;
  plan.checker = near.o.id;
  if (plan.pressUntil !== undefined && state.tick < plan.pressUntil) return false;
  plan.pressUntil = state.tick + Math.round(D.pressCooldown / DT);
  return true;
}

/** His plan's minimum hold (ticks): longer in the zone he attacks, shorter under pressure. */
function holdTicks(sit: Situation): number {
  return Math.round(((sit.zone === 'O' ? D.holdZone : D.hold) * (1 - D.holdPressure * sit.pressure)) / DT);
}

/** The decision point the carrier `s`, carrying out `plan`, has reached, or null (brainTick). */
function decisionPoint(state: GameState, s: SkaterState, me: PlayerDef, defs: Map<string, PlayerDef>, plan: CarrierPlan, lookTicks: number): CarrierPlan['why'] | null {
  // (Always run: it keeps the checker on him up to date.)
  const pressure = pressureArrives(state, s, plan);
  const sit = readSituationInto(state, s, decideScratch);
  if (plan.read === undefined || (readKey(sit) !== plan.read && state.tick - plan.tick >= READ_GAP_TICKS)) return 'read';
  // His plan has become impossible: carrying on would put his team offside.
  if ((plan.kind === 'carry' && plan.to !== null && carryOffside(state, s, defs, plan.to)) || (plan.kind === 'protect' && carryOffside(state, s, defs, s.target))) return 'read';
  if (plan.until === undefined) return 'hold';
  if (pressure) return 'pressure';
  const toGo = plan.kind === 'carry' && plan.to !== null ? hypot2(plan.to.x - s.pos.x, plan.to.y - s.pos.y) : Infinity;
  if (toGo <= D.arrive) return 'arrive';
  const opts = listOptions(state, me, defs, optionScratch, sit);
  // Inside his plan's minimum hold only a clearly better option (D.margin) makes him choose again. Once it has run out
  // (Task 8b) he chooses again when he sees anything worth D.marginHeld more than what he is doing, or it is gone from
  // his list; while his plan is still the best he sees he keeps at it, and the hold starts again. (An expiry that
  // always drew again was a clock: 1,900 of 5,300 decisions a game.)
  // Outside the zone he attacks, D.arriveLead s before he would reach his carry's target, he looks again: with nothing
  // better in sight he carries on up the same lane (its target moves on ahead of him, no new pick), so he does not
  // brake for each target (close-out: with decisions no longer on a clock he slowed every 8 m; a carrier's sprint
  // lasted 0.54 s against 0.86 s).
  // (The lead includes one look interval, so that how often he looks does not decide whether he sees it in time.)
  if (sit.zone !== 'O' && plan.lane !== null && toGo <= D.arrive + hypot2(s.vel.x, s.vel.y) * (D.arriveLead + lookTicks * DT)) {
    if (planBeaten(opts, me, sit, plan, D.marginHeld)) return 'arrive';
    for (const o of opts) {
      if (o.kind !== 'carry' || o.lane !== plan.lane) continue;
      plan.to = { x: o.to.x, y: o.to.y };
      if (!steeredByContest(state, s)) { s.target.x = o.to.x; s.target.y = o.to.y; }
      break;
    }
    plan.until = state.tick + holdTicks(sit);
    return null;
  }
  const expired = state.tick >= plan.until;
  // Inside the hold he weighs his plan against the rest once per D.betterEvery s (CarrierPlan.looked), however often he
  // looks: otherwise how often "something clearly better" was noticed, and so how often he chose, followed the look
  // interval (close-out: 3,190 / 3,030 / 2,810 decisions a game at 3 / 6 / 12 ticks).
  if (!expired) {
    const win = Math.floor((state.tick - plan.tick) / BETTER_TICKS);
    if (plan.looked === win) return null;
    plan.looked = win;
  }
  // He never keeps at one plan longer than he trusts one read of the play (TUNING.value.noise.readSeconds): then he
  // chooses afresh, whatever he sees (no plan is held for ever: a carrier shielding the puck with nobody coming for it).
  if (expired && state.tick - plan.tick >= READ_TICKS) return 'hold';
  if (planBeaten(opts, me, sit, plan, expired ? D.marginHeld : D.margin)) return expired ? 'hold' : 'better';
  if (expired) plan.until = state.tick + holdTicks(sit);
  return null;
}

/**
 * What the carrier does next: every option he has is valued (options.ts listOptions) and he takes the best as he sees
 * it (chooseOption), favouring what he is committed to (state.carrierPlan, when it is his).
 */
export function decideCarrier(state: GameState, me: PlayerDef, defs: Map<string, PlayerDef>, rng: Rng, situation: Situation = sitScratch): Decision {
  const s = findSkater(state, me.id);
  if (!s) throw new Error(`no skater ${me.id}`);
  const opts = listOptions(state, me, defs, optionScratch, situation);
  const plan = state.carrierPlan !== null && state.carrierPlan.id === me.id ? state.carrierPlan : null;
  const o = chooseOption(opts, me, situation, plan, rng);
  switch (o.kind) {
    case 'carry': return { kind: 'carry', to: { x: o.to.x, y: o.to.y }, lane: o.lane };
    case 'pass': return { kind: 'pass', toId: o.toId };
    case 'rim': return { kind: 'rim', toId: o.toId };
    default: return { kind: o.kind };
  }
}

/**
 * Runs the carrier's decision and carries it out (Task 8 fix round 2: decisions happen at decision points, not on a
 * clock). He draws a pick (decideCarrier, the full-temperature draw) when he gains the puck; when his situation changes
 * (readKey: breakaway, odd-man, behind the net; the zone; into the slot); when pressure arrives (pressureArrives, Task
 * 8b: once per checker, with hysteresis and a cooldown; pressure leaving is no decision point); when his carry's target is reached (within
 * decide.arrive m); when carrying on would put his team offside; when the minimum hold of his plan (CarrierPlan.until)
 * has run out and he sees something worth decide.marginHeld more than it, or it is as old as one read of the play
 * (Task 8b: a hold that runs out is reviewed, not drawn again; while his plan is still the best he sees he keeps at it);
 * or when an option he sees is worth more than his plan by decide.margin (or his plan is gone from his list). What made
 * the decision is kept in CarrierPlan.why. He looks for these every `lookTicks` ticks
 * (BRAIN_INTERVAL_TICKS); between them he carries out his plan. Writes state.carrierPlan (cleared while nobody carries).
 * Its events (release, and pass) go into `out` (a shot's own event comes when it ends). A carrier steered by a contest
 * (being hit, from impact on) may still pass, shoot, rim, dump or clear, but his skating belongs to the contest, so a
 * carry or protect decision changes nothing.
 */
export function brainTick(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = [], lookTicks: number = BRAIN_INTERVAL_TICKS): void {
  if (state.carrierId === null) { state.carrierPlan = null; return; }
  const prev = state.carrierPlan;
  const fresh = prev === null || prev.id !== state.carrierId;
  if (!fresh && state.tick % lookTicks !== 0) return;
  const s = findSkater(state, state.carrierId);
  if (!s || !s.onIce || s.downT > 0) return;
  // Shielding it in a board battle (Task 9) he holds it, keeping his plan, until the battle decides what happens to it:
  // no decision (options.ts listOptions offers only protect then).
  if (!fresh && shieldingInBattle(state, s)) return;
  const why = fresh ? 'gain' : decisionPoint(state, s, defs.get(s.id)!, defs, prev, lookTicks);
  if (why === null) return;
  const busy = steeredByContest(state, s);
  const me = defs.get(s.id)!;
  // A new carrier: his plan (and the seed of the errors that stay with him) starts now. It names no lane yet, so
  // nothing is favoured on his first look.
  if (fresh) {
    const np: CarrierPlan = { id: s.id, kind: 'carry', lane: null, toId: null, to: null, tick: state.tick, seed: Math.floor(rng.next() * 4294967296), checker: null };
    // A checker already on him as he gets it is no later arrival: he decides knowing it.
    pressureArrives(state, s, np);
    state.carrierPlan = np;
  }
  const sit = sitScratch;
  const d = decideCarrier(state, me, defs, rng, sit);
  const plan: CarrierPlan = state.carrierPlan!;
  // A shot off the wrap he was carrying out, at a post, is a wraparound (actions.ts shotTypeFor reads the plan's lane).
  const wrap = d.kind === 'shoot' && plan.lane === 'wrap' && atWrapPost(state, s);
  plan.id = s.id;
  plan.kind = d.kind;
  plan.lane = d.kind === 'carry' ? d.lane : null;
  plan.toId = d.kind === 'pass' || d.kind === 'rim' ? d.toId : null;
  plan.to = d.kind === 'carry' ? { x: d.to.x, y: d.to.y } : null;
  plan.tick = state.tick;
  plan.read = readKey(sit);
  plan.pressed = sit.pressure >= D.pressed;
  plan.why = why;
  plan.looked = 0;
  plan.until = state.tick + holdTicks(sit);
  state.carrierPlan = plan;
  switch (d.kind) {
    case 'shoot': executeShot(state, s.id, defs, rng, out, wrap ? 'wraparound' : undefined); return;
    case 'pass': executePass(state, s.id, d.toId, defs, rng, out); return;
    case 'dump': executeDump(state, s.id, defs, rng, out); return;
    case 'rim': executeRim(state, s.id, d.toId, defs, rng, out); return;
    case 'clear': executeClear(state, s.id, defs, rng, out); return;
    case 'carry':
      if (busy) return;
      s.target.x = d.to.x;
      s.target.y = d.to.y;
      // Holding behind the net he faces out front, where his passes go (Task 6: off the forehand or backhand).
      if (d.lane === 'hold') {
        const dir = state.attackDir[s.side];
        if (s.faceTarget) { s.faceTarget.x = HOLD_FACE_RX * dir; s.faceTarget.y = 0; } else s.faceTarget = { x: HOLD_FACE_RX * dir, y: 0 };
      } else s.faceTarget = null;
      // In the zone he attacks (but on a breakaway) he skates with it at T.carrySpeed.inZone of his carrying speed: he
      // looks for the play rather than outskating it.
      s.speedCap = d.lane === 'hold' ? T.protectSpeedCap
        : clamp(T.carrySpeed.base + me.attrs.puckHandling * T.carrySpeed.perPoint, 0, 1) * (sit.zone === 'O' && !sit.breakaway ? T.carrySpeed.inZone : 1);
      return;
    case 'protect': {
      if (busy) return;
      let near: SkaterState | null = null, nearD = Infinity;
      for (const o of state.skaters) {
        if (!o.onIce || o.side === s.side || o.downT > 0) continue;
        const od = hypot2(o.pos.x - s.pos.x, o.pos.y - s.pos.y);
        if (od < nearD) { nearD = od; near = o; }
      }
      if (near && nearD > 0) {
        s.target.x = s.pos.x + ((s.pos.x - near.pos.x) / nearD) * T.protectStep;
        s.target.y = s.pos.y + ((s.pos.y - near.pos.y) / nearD) * T.protectStep;
      } else { s.target.x = s.pos.x; s.target.y = s.pos.y; }
      // Shielding it he never backs over the blue line with a teammate still in the zone (Task 8b: 20 of 47 offsides in
      // four games were a protecting carrier backing in).
      if (carryOffside(state, s, defs, s.target)) s.target.x = (RINK.blueLineX - T.holdUpGap) * state.attackDir[s.side];
      // Nor across a goal line: backing round a post left the puck on the other side of the net frame from his blade
      // (Task 8b: 2.8 m from it, seed 12). He stays on the puck's side of the line.
      const gl = RINK.goalLineX, px = state.puck.pos.x, behind = Math.abs(px) > gl;
      if ((Math.abs(s.target.x) > gl) !== behind) s.target.x = (px >= 0 ? 1 : -1) * (behind ? gl + PROTECT_OFF_LINE : gl - PROTECT_OFF_LINE);
      s.faceTarget = null;
      s.speedCap = T.protectSpeedCap;
      return;
    }
  }
}
