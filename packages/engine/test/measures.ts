/**
 * "Looks like hockey" measures: a per-tick observer that counts what players do while play is live, and the measures
 * built from those counts. Test code only (it never changes play): playRecord runs it in every calibration game, and
 * the scorecard and test/play.test.ts read its measures.
 *
 * A "counted skater" on a tick is on the ice, not the carrier, not down (`downT === 0`), not leaving, and not steered by
 * a contest (in a contest and not in its `freeIds`). `rx` is a position's distance toward the net a side attacks
 * (`x * attackDir[side]`).
 *
 * The definitions are the round-2a plan's (Task 1), with one reading made explicit: a point pass counts as completed
 * (`pointPassesCompleted`) when its receiver is the next carrier and the puck stayed in the zone (rx above 7.57) until
 * he took it; a point pass that slides out and is picked up outside is a completed pass but not a completed point pass.
 */
import { createGame } from '../src/game';
import { movementOf, bodyRadius } from '../src/skating';
import { RINK } from '../src/rink';
import { listOptions, readSituation, topKindShare, type Option } from '../src/options';
import { BRAIN_INTERVAL_TICKS } from '../src/constants';
import { DT } from '../src/constants';
import type { GameEvent, GameSetup, GameState, PlayerDef, Side, SkaterState } from '../src/types';
import { gameSetup } from './helpers';

/** Raw sums over one game; every field is a count or a sum so games add up field by field. */
export type PlayCounters = Record<PlayCounterKey, number>;
export type PlayCounterKey =
  | 'liveTicks' | 'skaterTicks' | 'stationaryTicks' | 'glideTicks' | 'topSpeedTicks' | 'sprintRuns' | 'sprintRunTicks'
  | 'backwardTicksWithPuck' | 'ticksWithPuck' | 'spotTicks' | 'retargets'
  | 'passes' | 'passesCompleted' | 'pointPasses' | 'pointPassesKept' | 'pointPassesCompleted'
  | 'attempts' | 'defenceAttempts' | 'saves' | 'reboundChances' | 'goals'
  | 'battlesDecided' | 'battleWinnerCameAway' | 'battleToWinner' | 'battleToWinnerIsWinner' | 'battlesNoWinner'
  | 'hitsLanded' | 'hitsKnockdown'
  | 'ozonePossessions' | 'ozoneTicks' | 'ozoneAttempts' | 'ozoneSamples' | 'ozoneTwoOpen' | 'ozoneDangerShadowed'
  | 'behindNetPossessions' | 'passesOutFront' | 'wrapAttempts'
  | 'contactOver03' | 'puckJumpTicks'
  | 'goalieOverlapTicks' | 'raceJumpTicks'
  | 'duplicateJobTicks' | 'netFrontDefenderTicks' | 'netFrontDefenderInside'
  | 'ozoneCarrierTicks' | 'ozoneCarrierPressed'
  | 'breakawayBackPasses' | 'carrierDecisions' | 'carrierFlips' | 'normalDecisionPoints' | 'normalCertain'
  | 'carryTicks' | 'carryWrongSide' | 'pickupSnapMax' | 'passGoals';

export const PLAY_COUNTER_KEYS: readonly PlayCounterKey[] = [
  'liveTicks', 'skaterTicks', 'stationaryTicks', 'glideTicks', 'topSpeedTicks', 'sprintRuns', 'sprintRunTicks',
  'backwardTicksWithPuck', 'ticksWithPuck', 'spotTicks', 'retargets',
  'passes', 'passesCompleted', 'pointPasses', 'pointPassesKept', 'pointPassesCompleted',
  'attempts', 'defenceAttempts', 'saves', 'reboundChances', 'goals',
  'battlesDecided', 'battleWinnerCameAway', 'battleToWinner', 'battleToWinnerIsWinner', 'battlesNoWinner',
  'hitsLanded', 'hitsKnockdown',
  'ozonePossessions', 'ozoneTicks', 'ozoneAttempts', 'ozoneSamples', 'ozoneTwoOpen', 'ozoneDangerShadowed',
  'behindNetPossessions', 'passesOutFront', 'wrapAttempts',
  'contactOver03', 'puckJumpTicks',
  'goalieOverlapTicks', 'raceJumpTicks',
  'duplicateJobTicks', 'netFrontDefenderTicks', 'netFrontDefenderInside',
  'ozoneCarrierTicks', 'ozoneCarrierPressed',
  'breakawayBackPasses', 'carrierDecisions', 'carrierFlips', 'normalDecisionPoints', 'normalCertain',
  'carryTicks', 'carryWrongSide', 'pickupSnapMax', 'passGoals',
];

/** Counters that hold a largest value, not a sum: games combine by taking the largest. */
const MAX_KEYS: ReadonlySet<PlayCounterKey> = new Set<PlayCounterKey>(['pickupSnapMax']);
/** Adds counter `k` of one game (`v`) into the running total `c`. */
const addInto = (c: PlayCounters, k: PlayCounterKey, v: number): void => { c[k] = MAX_KEYS.has(k) ? Math.max(c[k], v) : c[k] + v; };

export type PlayMeasures = {
  stationaryShare: number; glideShare: number; topSpeedShare: number; sprintRunSeconds: number; backwardShareWithPuck: number; retargetShare: number;
  passCompletion: number; pointPassesPerGame: number; pointPassKeptShare: number; pointPassCompletion: number;
  attemptsPerTeam: number; defenceAttemptsPerTeam: number; reboundChancesPerGame: number;
  battleWinnerCameAwayShare: number; battleToWinnerIsWinnerShare: number; battlesNoWinnerPerGame: number; knockdownShare: number;
  ozoneSecondsPerPossession: number; attemptsPerOzonePossession: number; twoOpenShare: number; dangerShadowedShare: number;
  behindNetPossessionsPerGame: number; passesOutFrontPerGame: number; wrapAttemptsPerGame: number;
  contactsOver03PerGame: number; puckJumpsPerGame: number; maxPuckJump: number;
  /** Live ticks a carrier has the puck in the zone he attacks: share with a standing defender within 3 m of him. */
  carrierPressedShare: number;
};

export type Observer = { tick(state: GameState, events: readonly GameEvent[]): void; counters(): PlayCounters; maxPuckJump(): number };

export const emptyCounters = (): PlayCounters => Object.fromEntries(PLAY_COUNTER_KEYS.map((k) => [k, 0])) as PlayCounters;

// ---- definitions ----
const STATIONARY_SPEED = 0.5;
const TOP_SPEED_SHARE = 0.9;
const GLIDE_MIN_SPEED = 2;
/** m/s per second: a glide changes speed by less than this. */
const GLIDE_MAX_ACCEL = 1;
const RETARGET_M = 0.05;
const POINT_PASS_FROM_RX = RINK.blueLineX;
const POINT_PASS_BEHIND = 3;
/** The puck is still in while its rx is above this (the blue line less the puck's width). */
const KEPT_IN_RX = 7.57;
const ticksOf = (s: number): number => Math.round(s / DT);
const POINT_PASS_TICKS = ticksOf(3);
const REBOUND_TICKS = ticksOf(3);
const CAME_AWAY_TICKS = ticksOf(1.5);
const OZONE_SAMPLE_EVERY = 6;
const LANE_CLEAR = 1.0;
const MAN_CLEAR = 1.5;
const DANGER_LANE = 1.2;
const DANGER_SCALE = 9;
const BEHIND_RX = 27.43;
/** Jobs any number of a team's skaters may hold at once. */
const UTILITY = new Set(['change', 'lineUp', 'tagUp', 'contest', 'down']);
/**
 * A net-front defender "has" his man within NET_FRONT_MAN (m); he has inside position when he is nearer the net centre
 * than his man and within NET_FRONT_INSIDE (m) of him.
 */
const NET_FRONT_MAN = 2;
const NET_FRONT_INSIDE = 1.6;
/** A goalie's body radius (TUNING.goalieBody.radius). */
const GOALIE_RADIUS = 0.55;
/**
 * A race win moves the puck at most the most a pickup moves it (a kick from his feet to his blade, 1.2 m: Task 6) plus
 * his stride that tick, with slack (0.5 m), beyond the puck's own travel that tick. (Before Task 6: the pickup radius
 * 0.9 plus the carry reach 0.6, plus 0.2.)
 */
const RACE_JUMP_MAX = 1.2 + 0.5;
const BEHIND_Y = 4;
/** A carrier in the zone he attacks is pressed with a standing defender within this far (m) of him. */
const CARRIER_PRESSED = 3;
/** A breakaway pass is backward when its receiver is more than this (m) behind the passer (rx). */
const BREAKAWAY_BEHIND = 1;
const BEHIND_TICKS = ticksOf(0.5);
const OUT_FRONT = { rxMin: 15.13, rxMax: 26.13, y: 6 };
const WRAP_TICKS = ticksOf(1.5);
const CONTACT_SLACK = 0.25;
const CONTACT_TICKS = 10;
const JUMP_SLACK = 0.5;
const DECIDED = new Set(['pinned', 'stick', 'support', 'scramble']);
const NO_WINNER = new Set(['released', 'lostTouch', 'abandoned', 'trapped']);

const speedOf = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);
const otherSide = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** Distance from p to the segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Call `tick` after every `game.step()` with `game.drainEvents()`. */
export function createObserver(setup: GameSetup): Observer {
  const defs = new Map<string, PlayerDef>([...setup.home.players, ...setup.away.players].map((p) => [p.id, p]));
  const topSpeed = new Map<string, number>(), radius = new Map<string, number>();
  for (const [id, d] of defs) { if (d.position !== 'G') { topSpeed.set(id, movementOf(d, 1).topSpeed); radius.set(id, bodyRadius(d.weightKg)); } }

  const c = emptyCounters();
  let maxJump = 0;
  /** Each skater's speed and target on the tick he was last seen on the ice. */
  const prev = new Map<string, { tick: number; speed: number; tx: number; ty: number }>();
  /** Last tick each skater was counted at top speed (a run goes on while this is the previous tick). */
  const lastTop = new Map<string, number>();
  /** The pass on its way; `point` stays true while it is a point pass whose puck has stayed in the zone. */
  let openPass: { from: string; to: string; side: Side; tick: number; point: boolean } | null = null;
  let openPoint: { from: string; side: Side; tick: number } | null = null;
  let lastSave: { attack: Side; tick: number } | null = null;
  const openBattles: { winner: string; tick: number }[] = [];
  let ozone: { side: Side; k: number } | null = null;
  let behind: { id: string; ticks: number } | null = null;
  /** Last tick each player was the carrier of a behind-the-net possession (0.5 s or more there). */
  const lastBehind = new Map<string, number>();
  let contacts = new Map<string, number>();
  let prevPuck: { x: number; y: number; speed: number; live: boolean } | null = null;
  /** The carrier at the end of the last tick, and whether he was on a breakaway then. */
  let prevBreakaway: { id: string; rx: number; clear: boolean; mates: Map<string, number> } | null = null;
  const optionScratch: Option[] = [];
  /** The last release (its side and kind), for a goal with no shot. */
  let lastRel: { side: Side | null; kind: string } | null = null;
  /** Whether play was live with nobody carrying at the end of the last tick. */
  let wasLoose = false;
  const shoots = new Map<string, 1 | -1>();
  for (const [id, d] of defs) shoots.set(id, d.shoots === 'L' ? 1 : -1);
  /** The carrier's plan at the end of the last tick. */
  let prevPlan: { id: string; kind: string; lane: string | null } | null = null;

  const steered = (st: GameState, s: SkaterState): boolean => {
    if (s.contestId === null) return false;
    const ct = st.contests.find((k) => k.id === s.contestId);
    return ct !== undefined && !ct.freeIds.includes(s.id);
  };
  const counted = (st: GameState, s: SkaterState): boolean =>
    s.onIce && s.id !== st.carrierId && s.downT === 0 && !s.leaving && !steered(st, s);
  const skaterById = (st: GameState, id: string | null): SkaterState | undefined => (id === null ? undefined : st.skaters.find((k) => k.id === id));
  const rxOf = (st: GameState, side: Side, x: number): number => x * st.attackDir[side];

  /** Whether some skater of `opp` is within `lane` of the segment from the puck to `m`, or (manClear > 0) within manClear of him. */
  function covered(st: GameState, opp: Side, m: SkaterState, lane: number, manClear: number): boolean {
    const p = st.puck.pos;
    for (const o of st.skaters) {
      if (!o.onIce || o.side !== opp) continue;
      if (segDist(o.pos.x, o.pos.y, p.x, p.y, m.pos.x, m.pos.y) < lane) return true;
      if (manClear > 0 && Math.hypot(o.pos.x - m.pos.x, o.pos.y - m.pos.y) < manClear) return true;
    }
    return false;
  }

  function ozoneSample(st: GameState, side: Side, carrier: SkaterState): void {
    c.ozoneSamples++;
    const opp = otherSide(side);
    let open = 0, best: SkaterState | null = null, bestV = -Infinity;
    for (const m of st.skaters) {
      if (!m.onIce || m.side !== side || m.id === carrier.id) continue;
      if (!covered(st, opp, m, LANE_CLEAR, MAN_CLEAR)) open++;
      const dx = RINK.goalLineX - rxOf(st, side, m.pos.x), dy = m.pos.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      const v = Math.exp(-d / DANGER_SCALE) * dx / d;
      if (v > bestV) { bestV = v; best = m; }
    }
    if (open >= 2) c.ozoneTwoOpen++;
    if (best !== null && covered(st, opp, best, DANGER_LANE, 0)) c.ozoneDangerShadowed++;
  }

  function onEvents(st: GameState, events: readonly GameEvent[]): void {
    const tick = st.tick;
    for (const e of events) {
      switch (e.type) {
        case 'pass': {
          if (e.detail.kind !== 'pass' || e.playerId === null || e.otherId === null) break;
          c.passes++;
          const from = skaterById(st, e.playerId), to = skaterById(st, e.otherId);
          let point = false;
          if (from && to) {
            const fromRx = rxOf(st, from.side, from.pos.x), toRx = rxOf(st, from.side, to.pos.x);
            point = fromRx > POINT_PASS_FROM_RX && (to.slot === 'LD' || to.slot === 'RD') && toRx <= fromRx - POINT_PASS_BEHIND;
            if (point) { c.pointPasses++; openPoint = { from: from.id, side: from.side, tick }; }
            if ((lastBehind.get(from.id) ?? -Infinity) >= tick - 1 && toRx > OUT_FRONT.rxMin && toRx < OUT_FRONT.rxMax && Math.abs(to.pos.y) < OUT_FRONT.y) c.passesOutFront++;
          }
          // Where the receiver was when the pass was decided (the end of the tick before), against the passer then.
          if (prevBreakaway !== null && prevBreakaway.clear && prevBreakaway.id === e.playerId
            && (prevBreakaway.mates.get(e.otherId) ?? Infinity) < prevBreakaway.rx - BREAKAWAY_BEHIND) c.breakawayBackPasses++;
          openPass = { from: e.playerId, to: e.otherId, side: from?.side ?? e.side ?? 'home', tick, point };
          break;
        }
        case 'release': {
          lastRel = { side: e.side, kind: e.detail.kind };
          if (e.detail.kind !== 'shot' || e.playerId === null) break;
          c.attempts++;
          const s = skaterById(st, e.playerId);
          if (s && (s.slot === 'LD' || s.slot === 'RD')) c.defenceAttempts++;
          if (lastSave !== null && e.side === lastSave.attack && tick - lastSave.tick <= REBOUND_TICKS) c.reboundChances++;
          if (ozone !== null && e.side === ozone.side) c.ozoneAttempts++;
          if ((lastBehind.get(e.playerId) ?? -Infinity) >= tick - WRAP_TICKS) c.wrapAttempts++;
          break;
        }
        case 'save':
          c.saves++;
          if (e.side !== null) lastSave = { attack: otherSide(e.side), tick };
          break;
        case 'goal':
          c.goals++;
          // A puck its own side let go without shooting (a pass, rim, dump or clear) that went in with no shot.
          if (e.detail.releaseTick === null && lastRel !== null && lastRel.kind !== 'shot' && lastRel.side === e.side) c.passGoals++;
          break;
        case 'battle':
          if (DECIDED.has(e.detail.how) && e.playerId !== null) { c.battlesDecided++; openBattles.push({ winner: e.playerId, tick }); }
          break;
        case 'contestEnd': {
          if (e.detail.kind === 'looseRace' && e.detail.result === 'won' && prevPuck !== null
            && Math.hypot(st.puck.pos.x - prevPuck.x, st.puck.pos.y - prevPuck.y) - prevPuck.speed * DT > RACE_JUMP_MAX) c.raceJumpTicks++;
          if (e.detail.kind !== 'boardBattle') break;
          if (NO_WINNER.has(e.detail.result)) c.battlesNoWinner++;
          if (e.detail.puck === 'toWinner') {
            c.battleToWinner++;
            const id = e.detail.contestId;
            const b = events.find((x) => x.type === 'battle' && x.detail.contestId === id);
            if (b !== undefined && b.playerId !== null && st.carrierId === b.playerId) c.battleToWinnerIsWinner++;
          }
          break;
        }
        case 'hit':
          if (e.detail.result === 'landed') {
            c.hitsLanded++;
            const t = skaterById(st, e.otherId);
            if (t && t.downT > 0) c.hitsKnockdown++;
          }
          break;
        default:
          break;
      }
    }
  }

  function afterEvents(st: GameState): void {
    const tick = st.tick, live = st.phase === 'live', carrier = st.carrierId;
    // passes: completed when the next carrier (not the passer on the pass's own tick) is the receiver; a point pass
    // counts as completed only if the puck stayed in the zone until he took it
    if (openPass !== null && openPass.point && rxOf(st, openPass.side, st.puck.pos.x) <= KEPT_IN_RX) openPass.point = false;
    if (openPass !== null) {
      if (!live) openPass = null;
      else if (carrier !== null && (tick > openPass.tick || carrier !== openPass.from)) {
        if (carrier === openPass.to) { c.passesCompleted++; if (openPass.point) c.pointPassesCompleted++; }
        openPass = null;
      }
    }
    if (openPoint !== null) {
      if (rxOf(st, openPoint.side, st.puck.pos.x) <= KEPT_IN_RX) openPoint = null;
      else if (!live || tick - openPoint.tick >= POINT_PASS_TICKS || (carrier !== null && (tick > openPoint.tick || carrier !== openPoint.from))) {
        c.pointPassesKept++;
        openPoint = null;
      }
    }
    if (lastSave !== null) {
      const cs = skaterById(st, carrier);
      if (!live || (cs !== undefined && cs.side !== lastSave.attack) || tick - lastSave.tick > REBOUND_TICKS) lastSave = null;
    }
    for (let i = openBattles.length - 1; i >= 0; i--) {
      const b = openBattles[i]!;
      if (carrier !== null) { if (carrier === b.winner) c.battleWinnerCameAway++; openBattles.splice(i, 1); }
      else if (!live || tick - b.tick >= CAME_AWAY_TICKS) openBattles.splice(i, 1);
    }
  }

  function skaters(st: GameState): void {
    const tick = st.tick, live = st.phase === 'live';
    for (const s of st.skaters) {
      if (!s.onIce) continue;
      const speed = speedOf(s.vel);
      const p = prev.get(s.id);
      const before = p !== undefined && p.tick === tick - 1 ? p : null;
      const i = st.skaters.indexOf(s);
      const plan = st.plans[i]!;
      const spot = plan.follow === 'spot';
      if (live) {
        for (const g of [st.goalies.home, st.goalies.away]) {
          if (Math.hypot(s.pos.x - g.pos.x, s.pos.y - g.pos.y) < GOALIE_RADIUS + (radius.get(s.id) ?? 0.38) - 1e-6) c.goalieOverlapTicks++;
        }
      }
      if (live && counted(st, s)) {
        c.skaterTicks++;
        if (spot) c.spotTicks++;
        if (speed < STATIONARY_SPEED) c.stationaryTicks++;
        if (speed >= TOP_SPEED_SHARE * (topSpeed.get(s.id) ?? Infinity)) {
          c.topSpeedTicks++;
          c.sprintRunTicks++;
          if (lastTop.get(s.id) !== tick - 1) c.sprintRuns++;
          lastTop.set(s.id, tick);
        }
        if (before !== null) {
          if (speed >= GLIDE_MIN_SPEED && Math.abs(speed - before.speed) < GLIDE_MAX_ACCEL * DT) c.glideTicks++;
          if (spot && Math.hypot(s.target.x - before.tx, s.target.y - before.ty) > RETARGET_M) c.retargets++;
        }
        if (st.possession === s.side) { c.ticksWithPuck++; if (s.mode === 'backward') c.backwardTicksWithPuck++; }
      }
      if (p === undefined) prev.set(s.id, { tick, speed, tx: s.target.x, ty: s.target.y });
      else { p.tick = tick; p.speed = speed; p.tx = s.target.x; p.ty = s.target.y; }
    }
  }

  /** Jobs: a team never has two men on the same job; the net-front defender has inside position on his man. */
  function jobs(st: GameState): void {
    if (st.phase !== 'live') return;
    for (const side of ['home', 'away'] as const) {
      const seen = new Set<string>();
      let dup = false;
      st.skaters.forEach((s, i) => {
        if (!s.onIce || s.side !== side) return;
        const plan = st.plans[i]!;
        const job = plan.job;
        if (!UTILITY.has(job)) { if (seen.has(job)) dup = true; seen.add(job); }
        if (job !== 'dNet' || plan.markId === null) return;
        const m = skaterById(st, plan.markId);
        if (m === undefined || Math.hypot(m.pos.x - s.pos.x, m.pos.y - s.pos.y) > NET_FRONT_MAN) return;
        c.netFrontDefenderTicks++;
        const nx = -st.attackDir[side] * RINK.goalLineX;
        const nearer = Math.hypot(s.pos.x - nx, s.pos.y) < Math.hypot(m.pos.x - nx, m.pos.y);
        if (nearer && Math.hypot(m.pos.x - s.pos.x, m.pos.y - s.pos.y) <= NET_FRONT_INSIDE) c.netFrontDefenderInside++;
      });
      if (dup) c.duplicateJobTicks++;
    }
  }

  function zonePlay(st: GameState): void {
    const live = st.phase === 'live', S = st.possession;
    const active = live && S !== null && rxOf(st, S, st.puck.pos.x) > RINK.blueLineX;
    if (!active) ozone = null;
    else if (ozone === null || ozone.side !== S) { ozone = { side: S, k: 0 }; c.ozonePossessions++; }
    else ozone.k++;
    const cs = skaterById(st, st.carrierId);
    if (live && cs !== undefined && rxOf(st, cs.side, cs.pos.x) > RINK.blueLineX) {
      c.ozoneCarrierTicks++;
      for (const o of st.skaters) {
        if (o.onIce && o.side !== cs.side && o.downT === 0 && Math.hypot(o.pos.x - cs.pos.x, o.pos.y - cs.pos.y) <= CARRIER_PRESSED) { c.ozoneCarrierPressed++; break; }
      }
    }
    if (ozone !== null) {
      c.ozoneTicks++;
      if (ozone.k % OZONE_SAMPLE_EVERY === 0 && cs !== undefined && cs.side === ozone.side) ozoneSample(st, ozone.side, cs);
    }
    // behind the net
    if (live && cs !== undefined && rxOf(st, cs.side, cs.pos.x) > BEHIND_RX && Math.abs(cs.pos.y) < BEHIND_Y) {
      if (behind !== null && behind.id === cs.id) behind.ticks++;
      else behind = { id: cs.id, ticks: 1 };
      if (behind.ticks === BEHIND_TICKS) c.behindNetPossessions++;
      if (behind.ticks >= BEHIND_TICKS) lastBehind.set(cs.id, st.tick);
    } else behind = null;
  }

  /**
   * The carrier's decisions: a decision is a tick on which his plan was written (carrierPlan.tick is this tick); a flip
   * is one whose kind or carry lane differs from his plan on the tick before. Also notes whether the carrier is on a
   * breakaway (options.ts readSituation: a clear path to the net past his own blue line, nobody within 4 m of him)
   * for the next tick's passes.
   */
  function carrierMind(st: GameState): void {
    const plan = st.phase === 'live' ? st.carrierPlan ?? null : null;
    if (plan !== null && plan.tick === st.tick) {
      c.carrierDecisions++;
      if (prevPlan !== null && prevPlan.id === plan.id && (prevPlan.kind !== plan.kind || prevPlan.lane !== plan.lane)) c.carrierFlips++;
    }
    prevPlan = plan === null ? null : { id: plan.id, kind: plan.kind, lane: plan.lane };
    const cs = st.phase === 'live' ? skaterById(st, st.carrierId) : undefined;
    if (cs === undefined) { prevBreakaway = null; return; }
    const rx = rxOf(st, cs.side, cs.pos.x);
    const sit = readSituation(st, cs);
    const clear = sit.breakaway;
    // A decision point in normal mode (no situation rule applies), sampled on the brain's cadence: the share of the
    // draw its most likely kind of option gets.
    if (st.tick % BRAIN_INTERVAL_TICKS === 0 && !sit.breakaway && !sit.oddMan && !sit.behindNet && !sit.pressuredLow) {
      const me = defs.get(cs.id)!;
      listOptions(st, me, defs, optionScratch);
      c.normalDecisionPoints++;
      if (topKindShare(optionScratch, me, sit, st.carrierPlan) > 0.97 + 1e-9) c.normalCertain++;
    }
    const mates = new Map<string, number>();
    if (clear) for (const m of st.skaters) if (m.onIce && m.side === cs.side && m !== cs) mates.set(m.id, rxOf(st, m.side, m.pos.x));
    prevBreakaway = { id: cs.id, rx, clear, mates };
  }

  function bodies(st: GameState): void {
    const next = new Map<string, number>();
    if (st.phase === 'live') {
      const home = st.skaters.filter((s) => s.onIce && s.side === 'home'), away = st.skaters.filter((s) => s.onIce && s.side === 'away');
      for (const a of home) for (const b of away) {
        const reach = (radius.get(a.id) ?? 0.4) + (radius.get(b.id) ?? 0.4) + CONTACT_SLACK;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) >= reach) continue;
        const key = `${a.id}|${b.id}`;
        const run = (contacts.get(key) ?? 0) + 1;
        if (run === CONTACT_TICKS) c.contactOver03++;
        next.set(key, run);
      }
    }
    contacts = next;
  }

  /**
   * The carried puck: a live tick with a carrier counts (carryTicks), and is on the wrong side when the puck is not on
   * his shooting side of his facing (cross(facing, puck - him) * handSign < 0). A tick on which someone takes a loose
   * puck (tryPickup or an interception: no contest ended that tick, as contest hand-overs have their own measures): how
   * far the puck moved beyond its own travel that tick (pickupSnapMax, the largest). Call before puck(), which moves
   * prevPuck on.
   */
  function carry(st: GameState, events: readonly GameEvent[]): void {
    const live = st.phase === 'live';
    const cs = live ? skaterById(st, st.carrierId) : undefined;
    if (cs !== undefined) {
      c.carryTicks++;
      const dx = st.puck.pos.x - cs.pos.x, dy = st.puck.pos.y - cs.pos.y;
      if ((Math.cos(cs.facing) * dy - Math.sin(cs.facing) * dx) * (shoots.get(cs.id) ?? 1) < 0) c.carryWrongSide++;
      if (wasLoose && prevPuck !== null && prevPuck.live && !events.some((e) => e.type === 'contestEnd')) {
        const move = Math.hypot(st.puck.pos.x - prevPuck.x, st.puck.pos.y - prevPuck.y) - prevPuck.speed * DT;
        if (move > c.pickupSnapMax) c.pickupSnapMax = move;
      }
    }
    wasLoose = live && cs === undefined;
  }

  function puck(st: GameState): void {
    const live = st.phase === 'live', p = st.puck, speed = speedOf(p.vel);
    if (live && prevPuck !== null && prevPuck.live) {
      const cs = skaterById(st, st.carrierId);
      const vmax = Math.max(prevPuck.speed, speed, cs !== undefined ? speedOf(cs.vel) : 0);
      const excess = Math.hypot(p.pos.x - prevPuck.x, p.pos.y - prevPuck.y) - vmax * DT;
      if (excess > JUMP_SLACK) c.puckJumpTicks++;
      if (excess > maxJump) maxJump = excess;
    }
    prevPuck = { x: p.pos.x, y: p.pos.y, speed, live };
  }

  return {
    tick(st, events) {
      if (st.phase === 'live') c.liveTicks++;
      skaters(st);
      jobs(st);
      const wasOzone = ozone;
      zonePlay(st);
      // an attempt counts for the offensive-zone possession it ended, too
      const nowOzone = ozone;
      ozone = nowOzone ?? wasOzone;
      onEvents(st, events);
      ozone = nowOzone;
      afterEvents(st);
      carrierMind(st);
      bodies(st);
      carry(st, events);
      puck(st);
    },
    counters: () => ({ ...c }),
    maxPuckJump: () => maxJump,
  };
}

const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);

export function measuresOf(games: { counters: PlayCounters; maxPuckJump: number }[]): PlayMeasures {
  const c = emptyCounters();
  for (const g of games) for (const k of PLAY_COUNTER_KEYS) addInto(c, k, g.counters[k] ?? 0);
  const n = games.length, perGame = (x: number): number => ratio(x, n), perTeam = (x: number): number => ratio(x, 2 * n);
  return {
    stationaryShare: ratio(c.stationaryTicks, c.skaterTicks),
    glideShare: ratio(c.glideTicks, c.skaterTicks),
    topSpeedShare: ratio(c.topSpeedTicks, c.skaterTicks),
    sprintRunSeconds: ratio(c.sprintRunTicks * DT, c.sprintRuns),
    backwardShareWithPuck: ratio(c.backwardTicksWithPuck, c.ticksWithPuck),
    retargetShare: ratio(c.retargets, c.spotTicks),
    passCompletion: ratio(c.passesCompleted, c.passes),
    pointPassesPerGame: perGame(c.pointPasses),
    pointPassKeptShare: ratio(c.pointPassesKept, c.pointPasses),
    pointPassCompletion: ratio(c.pointPassesCompleted, c.pointPasses),
    attemptsPerTeam: perTeam(c.attempts),
    defenceAttemptsPerTeam: perTeam(c.defenceAttempts),
    reboundChancesPerGame: perGame(c.reboundChances),
    battleWinnerCameAwayShare: ratio(c.battleWinnerCameAway, c.battlesDecided),
    battleToWinnerIsWinnerShare: ratio(c.battleToWinnerIsWinner, c.battleToWinner),
    battlesNoWinnerPerGame: perGame(c.battlesNoWinner),
    knockdownShare: ratio(c.hitsKnockdown, c.hitsLanded),
    ozoneSecondsPerPossession: ratio(c.ozoneTicks * DT, c.ozonePossessions),
    attemptsPerOzonePossession: ratio(c.ozoneAttempts, c.ozonePossessions),
    twoOpenShare: ratio(c.ozoneTwoOpen, c.ozoneSamples),
    dangerShadowedShare: ratio(c.ozoneDangerShadowed, c.ozoneSamples),
    behindNetPossessionsPerGame: perGame(c.behindNetPossessions),
    passesOutFrontPerGame: perGame(c.passesOutFront),
    wrapAttemptsPerGame: perGame(c.wrapAttempts),
    contactsOver03PerGame: perGame(c.contactOver03),
    puckJumpsPerGame: perGame(c.puckJumpTicks),
    maxPuckJump: games.reduce((a, g) => Math.max(a, g.maxPuckJump), 0),
    carrierPressedShare: ratio(c.ozoneCarrierPressed, c.ozoneCarrierTicks),
  };
}

/** One game of `setup` played to the end under an observer: its counters and largest puck jump. */
export function observeGame(setup: GameSetup): { counters: PlayCounters; maxPuckJump: number } {
  const game = createGame(setup);
  const obs = createObserver(setup);
  while (!game.done) { game.step(); obs.tick(game.state, game.drainEvents()); }
  return { counters: obs.counters(), maxPuckJump: obs.maxPuckJump() };
}

const bySeed = new Map<number, { counters: PlayCounters; maxPuckJump: number }>();
const observeSeed = (seed: number): { counters: PlayCounters; maxPuckJump: number } => {
  let r = bySeed.get(seed);
  if (!r) { r = observeGame(gameSetup(seed)); bySeed.set(seed, r); }
  return r;
};

/** Plays `gameSetup(seed)` for each seed under an observer (each seed once per process). */
export function measureGames(seeds: number[]): PlayMeasures {
  return measuresOf(seeds.map(observeSeed));
}

/** The same games' counters, summed field by field. */
export function countGames(seeds: number[]): PlayCounters {
  const c = emptyCounters();
  for (const r of seeds.map(observeSeed)) for (const k of PLAY_COUNTER_KEYS) addInto(c, k, r.counters[k]);
  return c;
}
