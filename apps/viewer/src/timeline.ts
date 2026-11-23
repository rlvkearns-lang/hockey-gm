import type { GameEvent, GameEventOf, GameEventType, Side } from '@hockey/engine';

/**
 * The game's event log, indexed (pure: no three.js, no DOM). Built once per recording and shared by the page (score
 * bug, goal marks, shots) and the scene's animator (an action the log shows is coming may start before its event: a
 * wind-up before a `release`, a goalie's reach before a `save`).
 *
 * Every lookup is a binary search over a list kept per event type (and per type and player), never a scan of the log.
 * Events are returned as the log holds them (the same objects).
 */
/** Which part of an event a player has: its `playerId`, its `otherId`, or either. */
export type Role = 'player' | 'other' | 'either';

export type Timeline = {
  /** Every goal, in order. */
  readonly goals: readonly GameEventOf<'goal'>[];
  /** The tick of each `periodEnd`, in order. */
  readonly periodEnds: readonly number[];
  /** Shots on goal of each side at or before `tick` (a goal is a shot too; `Infinity` gives the game's totals). */
  shotsAt(tick: number): { home: number; away: number };
  /** Goals of each side at or before `tick`. */
  scoreAt(tick: number): { home: number; away: number };
  /** Every event in which `id` is the player or the other player, with `fromTick <= tick <= toTick`, in order. */
  forPlayer(id: string, fromTick: number, toTick: number): GameEvent[];
  /**
   * The first event of `type` with `afterTick < tick <= afterTick + withinTicks`; with `playerId`, only events in
   * which he has `role`: 'player' (the event's playerId, the default), 'other' (its otherId: the receiver of a pass,
   * the goalie of a shot, the man beaten) or 'either'.
   */
  next<T extends GameEventType>(type: T, afterTick: number, withinTicks: number, playerId?: string, role?: Role): GameEventOf<T> | undefined;
  /** The latest event of `type` with `atOrBeforeTick - withinTicks <= tick <= atOrBeforeTick`; `playerId` and `role` as for next. */
  last<T extends GameEventType>(type: T, atOrBeforeTick: number, withinTicks: number, playerId?: string, role?: Role): GameEventOf<T> | undefined;
  /** A contest's `contestStart` and, once it has ended, its `contestEnd`; undefined for an id the log never started. */
  contest(contestId: number): { start: GameEventOf<'contestStart'>; end?: GameEventOf<'contestEnd'> } | undefined;
};

/** Index of the first entry of sorted `ticks` that is greater than `t`. */
function upper(ticks: readonly number[], t: number): number {
  let lo = 0, hi = ticks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ticks[m]! <= t) lo = m + 1; else hi = m; }
  return lo;
}

/** Index of the first entry of sorted `ticks` that is at least `t`. */
function lower(ticks: readonly number[], t: number): number {
  let lo = 0, hi = ticks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ticks[m]! < t) lo = m + 1; else hi = m; }
  return lo;
}

/** Events in tick order with their ticks alongside (for the searches). */
type List = { ticks: number[]; events: GameEvent[] };
const push = (map: Map<string, List>, key: string, e: GameEvent): void => {
  let l = map.get(key);
  if (!l) { l = { ticks: [], events: [] }; map.set(key, l); }
  l.ticks.push(e.tick);
  l.events.push(e);
};

export function buildTimeline(events: readonly GameEvent[]): Timeline {
  // The log is in tick order; a stable sort keeps it so (and orders a log that is not).
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tick - b.e.tick || a.i - b.i).map((x) => x.e);
  const byType = new Map<string, List>(), byTypePlayer = new Map<string, List>(), byPlayer = new Map<string, List>();
  const shots: Record<Side, number[]> = { home: [], away: [] }, goalTicks: Record<Side, number[]> = { home: [], away: [] };
  const goals: GameEventOf<'goal'>[] = [], periodEnds: number[] = [];
  const contests = new Map<number, { start: GameEventOf<'contestStart'>; end?: GameEventOf<'contestEnd'> }>();
  for (const e of sorted) {
    push(byType, e.type, e);
    if (e.playerId !== null) { push(byTypePlayer, `${e.type}|player|${e.playerId}`, e); push(byTypePlayer, `${e.type}|either|${e.playerId}`, e); push(byPlayer, e.playerId, e); }
    if (e.otherId !== null) push(byTypePlayer, `${e.type}|other|${e.otherId}`, e);
    if (e.otherId !== null && e.otherId !== e.playerId) { push(byPlayer, e.otherId, e); push(byTypePlayer, `${e.type}|either|${e.otherId}`, e); }
    if (e.type === 'shot' && e.side) shots[e.side].push(e.tick);
    else if (e.type === 'goal') { goals.push(e); if (e.side) goalTicks[e.side].push(e.tick); }
    else if (e.type === 'periodEnd') periodEnds.push(e.tick);
    else if (e.type === 'contestStart') contests.set(e.detail.contestId, { start: e });
    else if (e.type === 'contestEnd') { const c = contests.get(e.detail.contestId); if (c && !c.end) c.end = e; }
  }
  const listOf = (type: string, playerId?: string, role: Role = 'player'): List | undefined =>
    (playerId === undefined ? byType.get(type) : byTypePlayer.get(`${type}|${role}|${playerId}`));
  return {
    goals,
    periodEnds,
    shotsAt: (tick) => ({ home: upper(shots.home, tick), away: upper(shots.away, tick) }),
    scoreAt: (tick) => ({ home: upper(goalTicks.home, tick), away: upper(goalTicks.away, tick) }),
    forPlayer(id, fromTick, toTick) {
      const l = byPlayer.get(id);
      if (!l) return [];
      return l.events.slice(lower(l.ticks, fromTick), upper(l.ticks, toTick));
    },
    next<T extends GameEventType>(type: T, afterTick: number, withinTicks: number, playerId?: string, role?: Role) {
      const l = listOf(type, playerId, role);
      if (!l) return undefined;
      const i = upper(l.ticks, afterTick);
      return i < l.ticks.length && l.ticks[i]! <= afterTick + withinTicks ? (l.events[i] as GameEventOf<T>) : undefined;
    },
    last<T extends GameEventType>(type: T, atOrBeforeTick: number, withinTicks: number, playerId?: string, role?: Role) {
      const l = listOf(type, playerId, role);
      if (!l) return undefined;
      const i = upper(l.ticks, atOrBeforeTick) - 1;
      return i >= 0 && l.ticks[i]! >= atOrBeforeTick - withinTicks ? (l.events[i] as GameEventOf<T>) : undefined;
    },
    contest: (contestId) => contests.get(contestId),
  };
}
