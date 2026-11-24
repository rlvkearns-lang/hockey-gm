import { executeClear as executeClear_, executeDump as executeDump_, executePass as executePass_, executeRim as executeRim_, executeShot as executeShot_ } from './actions';
import { BRAIN_INTERVAL_TICKS as BRAIN_INTERVAL_TICKS_, DT } from './constants';
import { chooseOption as chooseOption_, listOptions as listOptions_, readSituationInto as readSituationInto_, type Option, type Situation } from './options';
import { TUNING as TUNING_ } from './tuning';
import { steeredByContest as steeredByContest_ } from './team-play';
import type { Rng } from './rng';
import type { CarrierPlan, CarryLane, GameEvent, GameState, PlayerDef, SkaterState } from './types';
import { hypot2 as hypot2_, type Vec2 } from './vec';
import { clamp as clamp_, findSkater as findSkater_ } from './util';
// Local bindings of the imports used in hot paths (a call through an imported binding costs more under the test runner).
// Never alias in a module on an import cycle: brain is on none.
const executeClear = executeClear_;
const executeDump = executeDump_;
const executePass = executePass_;
const executeRim = executeRim_;
const executeShot = executeShot_;
const BRAIN_INTERVAL_TICKS = BRAIN_INTERVAL_TICKS_;
const chooseOption = chooseOption_;
const listOptions = listOptions_;
const readSituationInto = readSituationInto_;
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
/** Holding behind the net, he faces the slot at this rx. */
const HOLD_FACE_RX = 20;
/** brainTick's copy of the carrier's situation (written by decideCarrier, read for his carry speed). */
const sitScratch: Situation = { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false, held: 0, since: 0 };

const lookScratch: Situation = { rx: 0, ly: 0, zone: 'N', pressure: 0, breakaway: false, oddMan: false, pressuredLow: false, behindNet: false, held: 0, since: 0 };
/** The situation as a key: its mode (the rule that narrows his options) and the zone. */
function readKey(sit: Situation): string {
  const mode = sit.breakaway ? 'break' : sit.oddMan ? 'odd' : sit.behindNet ? 'behind' : sit.pressuredLow ? 'low' : 'normal';
  return mode + ':' + sit.zone;
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
 * Runs the carrier's decision and carries it out: on his first tick with the puck, then every BRAIN_INTERVAL_TICKS once
 * he has carried out his last pick for TUNING.value.lookSeconds or his situation (its mode or zone: readKey) has changed.
 * Writes state.carrierPlan (cleared while nobody carries). Its events (release, and pass) go into `out` (a shot's own
 * event comes when it ends). A carrier steered by a contest (being hit, from impact on) may still pass, shoot, rim,
 * dump or clear, but his skating belongs to the contest, so a carry or protect decision changes nothing.
 */
export function brainTick(state: GameState, defs: Map<string, PlayerDef>, rng: Rng, out: GameEvent[] = []): void {
  if (state.carrierId === null) { state.carrierPlan = null; return; }
  const prev = state.carrierPlan;
  const fresh = prev === null || prev.id !== state.carrierId;
  if (!fresh && state.tick % BRAIN_INTERVAL_TICKS !== 0) return;
  const s = findSkater(state, state.carrierId);
  if (!s || !s.onIce || s.downT > 0) return;
  // Commitment: he carries out what he picked for TUNING.value.lookSeconds, unless his situation has changed.
  if (!fresh && prev.read !== undefined && (state.tick - prev.tick) * DT < TUNING.value.lookSeconds
    && readKey(readSituationInto(state, s, lookScratch)) === prev.read) return;
  const busy = steeredByContest(state, s);
  const me = defs.get(s.id)!;
  // A new carrier: his plan (and the seed of the errors that stay with him) starts now. It names no lane yet, so
  // nothing is favoured on his first look.
  if (fresh) state.carrierPlan = { id: s.id, kind: 'carry', lane: null, toId: null, to: null, tick: state.tick, seed: Math.floor(rng.next() * 4294967296) };
  const sit = sitScratch;
  const d = decideCarrier(state, me, defs, rng, sit);
  const plan: CarrierPlan = state.carrierPlan!;
  plan.id = s.id;
  plan.kind = d.kind;
  plan.lane = d.kind === 'carry' ? d.lane : null;
  plan.toId = d.kind === 'pass' || d.kind === 'rim' ? d.toId : null;
  plan.to = d.kind === 'carry' ? { x: d.to.x, y: d.to.y } : null;
  plan.tick = state.tick;
  plan.read = readKey(sit);
  state.carrierPlan = plan;
  switch (d.kind) {
    case 'shoot': executeShot(state, s.id, defs, rng, out); return;
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
      s.faceTarget = null;
      s.speedCap = T.protectSpeedCap;
      return;
    }
  }
}
