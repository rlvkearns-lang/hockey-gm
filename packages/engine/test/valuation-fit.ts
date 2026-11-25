/**
 * Task 13b items 3 and 4: the valuation (options.ts) read against execution. Every shot attempt of a game is recorded
 * with what the valuation looks at when it values a shot (distance, traffic in front, type, pressure, the shooter's and
 * the screener's badges, a rebound) and what became of it (blocked, wide, saved held / steered / rebound, goal), and
 * what followed (his team still with the puck in the zone 6 s on; the other team carrying it out past centre within
 * 6 s). scripts/fit-valuation.ts prints the fits; test/valuation-calibration.test.ts (slow suite) asserts them.
 */
import { createGame } from '../src/game';
import { planOf } from '../src/commit';
import { DT } from '../src/constants';
import { hasBadge } from '../src/badges';
import { RINK } from '../src/rink';
import { TUNING } from '../src/tuning';
import { shotQuality } from '../src/threat';
import { composite } from '../src/attributes';
import type { GameSetup, GameState, PlayerDef, ShotType, Side } from '../src/types';

const B = TUNING.brain;
/** options.ts SHOOTING: the shooting skill's weights. */
const SHOOTING = { shootingAccuracy: 0.6, shootingPower: 0.4 };

export type Attempt = {
  side: Side; shooter: string; tick: number; dNet: number; traffic: boolean; type: ShotType; pressure: number; rebound: boolean;
  /** Badges of the shooter, and whether the man in front (traffic) is a Net-Front Finisher. */
  oneTimerBadge: boolean; heavySlap: boolean; quickRelease: boolean; finisher: boolean; screenerFinisher: boolean;
  /** The valuation's chance a free shot from there scores (V.goal * shot quality * his shooting skill * the closed-net weight). */
  g0: number;
  outcome: 'blocked' | 'wide' | 'held' | 'steered' | 'rebound' | 'goal' | 'other';
  /** 6 s after the outcome: his team (or nobody) has it in the zone he attacks; the other team carried it past centre within the 6 s. */
  keep: boolean; rush: boolean;
};

const KEEP_TICKS = Math.round(6 / DT);
/** The outcomes TUNING.value.after describes (a goal ends the possession). */
export const AFTER_KEYS = ['blocked', 'wide', 'held', 'steered', 'rebound'] as const;
export type AfterKey = (typeof AFTER_KEYS)[number];
const GOAL = RINK.goalLineX;
const TRAFFIC_NEAR = TUNING.options.trafficNear;

/** One game of `setup` played to the end: its attempts. */
export function attemptsOf(setup: GameSetup): Attempt[] {
  const defs = new Map<string, PlayerDef>([...setup.home.players, ...setup.away.players].map((p) => [p.id, p]));
  const g = createGame(setup);
  const out: Attempt[] = [];
  const open = new Map<number, Attempt>(); // by release tick
  const watching: { a: Attempt; until: number; wait: boolean }[] = [];
  while (!g.done) {
    g.step();
    const st = g.state;
    for (const e of g.drainEvents()) {
      if (e.type === 'release' && e.detail.kind === 'shot' && e.playerId !== null && e.side !== null) {
        const a = attempt(st, defs, e.side, e.playerId, e.pos, e.detail.shotType ?? 'wrist');
        open.set(st.tick, a); out.push(a);
      } else if ((e.type === 'block' || e.type === 'miss' || e.type === 'post' || e.type === 'goal' || e.type === 'save') && 'detail' in e) {
        const rt = e.type === 'save' ? lastShotTick : (e.detail as { releaseTick: number | null }).releaseTick;
        const a = rt === null ? undefined : open.get(rt);
        if (a === undefined) continue;
        a.outcome = e.type === 'block' ? 'blocked' : e.type === 'miss' || e.type === 'post' ? 'wide' : e.type === 'goal' ? 'goal' : (e.detail as { kind: 'held' | 'steered' | 'rebound' }).kind;
        open.delete(rt!);
        // (A held save is followed from its faceoff, as Task 8 measured TUNING.value.after.)
        if (a.outcome !== 'goal') watching.push({ a, until: st.tick + KEEP_TICKS, wait: a.outcome === 'held' });
      }
      if (e.type === 'faceoff') for (const w of watching) if (w.wait) { w.wait = false; w.until = st.tick + KEEP_TICKS; }
      if (e.type === 'shot') lastShotTick = e.detail.releaseTick;
    }
    for (let i = watching.length - 1; i >= 0; i--) {
      const w = watching[i]!;
      if (w.wait) continue;
      const dir = st.attackDir[w.a.side];
      const carrier = st.carrierId === null ? null : st.skaters.find((s) => s.id === st.carrierId) ?? null;
      if (carrier !== null && carrier.side !== w.a.side && st.puck.pos.x * dir < 0) w.a.rush = true;
      if (st.tick >= w.until || g.done || st.phase !== 'live') {
        // (A whistle in between ends it: not kept, as Task 8 counted a stoppage.)
        w.a.keep = st.phase === 'live' && (carrier === null || carrier.side === w.a.side) && st.puck.pos.x * dir > RINK.blueLineX;
        watching.splice(i, 1);
      }
    }
  }
  return out;
}
let lastShotTick: number | null = null;

function attempt(st: GameState, defs: Map<string, PlayerDef>, side: Side, shooter: string, pos: { x: number; y: number }, type: ShotType): Attempt {
  const dir = st.attackDir[side];
  const nx = dir * GOAL;
  const me = defs.get(shooter)!;
  let near = Infinity, screener: string | null = null;
  const s = st.skaters.find((k) => k.id === shooter)!;
  for (const o of st.skaters) {
    if (!o.onIce) continue;
    if (o.side !== side && o.downT === 0) near = Math.min(near, Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y));
    if (o.side === side && o.id !== shooter && o.downT === 0 && Math.hypot(o.pos.x - nx, o.pos.y) <= TRAFFIC_NEAR && planOf(st, o.id).job === 'netFront') screener = o.id;
  }
  const ls = st.lastSave;
  return {
    side, shooter, tick: st.tick, dNet: Math.hypot(nx - pos.x, pos.y), traffic: screener !== null, type,
    pressure: Math.min(1, Math.max(0, (5 - near) / 4)),
    rebound: ls !== null && ls.side !== side && (st.tick - ls.tick) * DT <= TUNING.rebound.windowSeconds,
    oneTimerBadge: hasBadge(me, 'One-Timer'), heavySlap: hasBadge(me, 'Heavy Slapshot'), quickRelease: hasBadge(me, 'Quick Release'),
    finisher: hasBadge(me, 'Net-Front Finisher'), screenerFinisher: screener !== null && hasBadge(defs.get(screener)!, 'Net-Front Finisher'),
    g0: TUNING.value.goal * shotQuality(pos.x * dir, pos.y * dir) * (B.shootSkill.base + composite(me.attrs, SHOOTING) * B.shootSkill.perPoint) * B.openNetWeight[0],
    outcome: 'other', keep: false, rush: false,
  };
}

/** Goals per attempt of `as` that pass `f`, and how many (a binomial standard error with it). */
export function rate(as: readonly Attempt[], f: (a: Attempt) => boolean): { n: number; p: number; se: number } {
  let n = 0, k = 0;
  for (const a of as) if (f(a)) { n++; if (a.outcome === 'goal') k++; }
  const p = n > 0 ? k / n : 0;
  return { n, p, se: n > 0 ? Math.sqrt((p * (1 - p)) / n) : 0 };
}

/**
 * The traffic lift the valuation adds to a far shot's chance (TUNING.value.traffic) as execution gives it: goals per
 * unblocked attempt from TUNING.options.farShot m or more with a man in front, less without.
 */
export function trafficLift(as: readonly Attempt[]): { lift: number; se: number; with: ReturnType<typeof rate>; without: ReturnType<typeof rate> } {
  const far = (a: Attempt): boolean => a.dNet >= TUNING.options.farShot && a.outcome !== 'blocked';
  const w = rate(as, (a) => far(a) && a.traffic), wo = rate(as, (a) => far(a) && !a.traffic);
  return { lift: w.p - wo.p, se: Math.hypot(w.se, wo.se), with: w, without: wo };
}

/** What follows each outcome (TUNING.value.after's keep and rush), measured: share kept and share rushed. */
export function afterShares(as: readonly Attempt[]): Record<AfterKey, { n: number; keep: number; rush: number }> {
  const r = {} as Record<AfterKey, { n: number; keep: number; rush: number }>;
  for (const k of AFTER_KEYS) {
    const xs = as.filter((a) => a.outcome === k);
    r[k] = { n: xs.length, keep: xs.filter((a) => a.keep).length / Math.max(1, xs.length), rush: xs.filter((a) => a.rush).length / Math.max(1, xs.length) };
  }
  return r;
}

/** A badge's lift in goals per attempt on the shots it acts on: holders' rate over the others' (and their sizes). */
export type Lift = { factor: number; holders: number; others: number; valued: number };
function lift(as: readonly Attempt[], on: (a: Attempt) => boolean, holder: (a: Attempt) => boolean, valued: number): Lift {
  const h = rate(as, (a) => on(a) && holder(a)), o = rate(as, (a) => on(a) && !holder(a));
  return { factor: o.p > 0 ? h.p / o.p : NaN, holders: h.n, others: o.n, valued };
}

/**
 * The shot badges' lifts (TUNING.badges.value) as execution gives them: One-Timer on one-timers, Heavy Slapshot on
 * slapshots, Quick Release unpressured (pressure under 0.25) and pressured (0.5 or more), Net-Front Finisher on his rebound
 * shots and in front of a far shot (traffic). `valued` is what the valuation uses (Quick Release at the bin's mean pressure).
 */
export function badgeLifts(as: readonly Attempt[]): Record<string, Lift> {
  const BV = TUNING.badges.value;
  return {
    oneTimer: lift(as, (a) => a.type === 'oneTimer', (a) => a.oneTimerBadge, BV.oneTimer),
    heavySlap: lift(as, (a) => a.type === 'slap', (a) => a.heavySlap, BV.heavySlap),
    quickReleaseCalm: lift(as, (a) => a.pressure < 0.25, (a) => a.quickRelease, quickReleaseValued(0.1)),
    quickReleasePressed: lift(as, (a) => a.pressure >= 0.5, (a) => a.quickRelease, quickReleaseValued(0.75)),
    finisherRebound: lift(as, (a) => a.rebound, (a) => a.finisher, BV.finisherRebound),
    finisherScreen: lift(as, (a) => a.dNet >= TUNING.options.farShot && a.traffic, (a) => a.screenerFinisher, BV.finisherScreen),
  };
}
/** The valuation's Quick Release factor at `pressure` (options.ts shotBadgeFactor). */
function quickReleaseValued(pressure: number): number { return TUNING.badges.value.quickReleaseCalm * (1 + TUNING.badges.value.quickRelease * pressure); }

/** Goals per unpressured, unblocked attempt (no checker within 5 m, not a rebound, nobody in front) by distance against the valuation's g0. */
export function distanceFit(as: readonly Attempt[]): { from: number; to: number; n: number; measured: number; valued: number }[] {
  const bins = [[0, 5], [5, 8], [8, 11], [11, 16], [16, 30]] as const;
  return bins.map(([from, to]) => {
    const xs = as.filter((a) => a.dNet >= from && a.dNet < to && a.pressure === 0 && !a.rebound && !a.traffic && a.outcome !== 'blocked');
    return { from, to, n: xs.length, measured: xs.filter((a) => a.outcome === 'goal').length / Math.max(1, xs.length), valued: xs.reduce((t, a) => t + a.g0, 0) / Math.max(1, xs.length) };
  });
}
