import { createGame, DT, restoreGame, type Game, type GameEvent, type GameResult, type GameSetup, type GameState } from '@hockey/engine';
import { emptyProbe, isCut, probeOf } from './cuts';

/**
 * Two neighbouring ticks to blend. `alpha` in [0, 1) is how far the display time sits from `prev` towards `next`;
 * `tick` is the display time rounded down (the tick of `prev`). At the very end of the game `prev` and `next` are the
 * same final state. Both states are read-only and valid until the next seek, advance or frame call.
 */
export type Frame = { prev: GameState; next: GameState; alpha: number; tick: number };

export type Playback = {
  readonly totalTicks: number;
  readonly events: readonly GameEvent[];
  readonly result: GameResult;
  /** Ticks at which the engine moved something discontinuously from the tick before (see cuts.ts), in order. */
  readonly cuts: readonly number[];
  /** Show exactly `tick` (clamped to the game); restores and steps now, not on the next frame(). */
  seek(tick: number): void;
  /** Move display time by `seconds` of game time (negative goes back), clamped to the game. */
  advance(seconds: number): void;
  frame(): Frame;
};

/** A snapshot of the game at `tick`, deep-copied; `eventCount` is how many events the log held then. */
export type Snapshot = { tick: number; state: GameState; eventCount: number };

/**
 * A whole game played once: plain data (no functions, no classes), so it can be made in a worker and posted to the
 * page. `every` is the snapshot interval in ticks: snapshots[i] is tick i * every.
 */
export type Recording = {
  every: number;
  snapshots: Snapshot[];
  events: GameEvent[];
  result: GameResult;
  totalTicks: number;
  cuts: number[];
};

export type RecordOptions = { snapshotEverySeconds?: number; onStep?: (state: Readonly<GameState>) => void };

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Plays the whole game once (on the calling thread), keeping a deep-copied snapshot every `snapshotEverySeconds`, the
 * full event log and the ticks the engine cuts at. `onStep`, if given, sees the state of every tick (tick 0 included),
 * read-only and only during the call (the state is changed in place by the next step).
 */
export function record(setup: GameSetup, opts: RecordOptions = {}): Recording {
  const every = Math.max(1, Math.round((opts.snapshotEverySeconds ?? 5) / DT));
  const events: GameEvent[] = [];
  const snapshots: Snapshot[] = [];
  const cuts: number[] = [];
  const g = createGame(setup);
  const snap = (): void => {
    events.push(...g.drainEvents());
    snapshots.push({ tick: g.state.tick, state: clone(g.state), eventCount: events.length });
  };
  snap();
  const probe = probeOf(g.state, emptyProbe());
  opts.onStep?.(g.state);
  while (!g.done) {
    g.step();
    if (isCut(probe, g.state)) cuts.push(g.state.tick);
    probeOf(g.state, probe);
    if (g.state.tick % every === 0) snap();
    opts.onStep?.(g.state);
  }
  events.push(...g.drainEvents());
  return { every, snapshots, events, result: g.result(), totalTicks: g.state.tick, cuts };
}

/**
 * A playback cursor over a recording. Seeking restores the nearest earlier snapshot and steps forward; the viewer
 * never decides anything about the game. A snapshot is restored with an empty event log: the engine reads the log
 * only within a step (to close contests a whistle cut), so the state and every later event are the same as with the
 * log so far (pinned by a test), and a late seek does not copy thousands of events.
 */
export function createCursor(setup: GameSetup, rec: Recording): Playback {
  const { every, snapshots, totalTicks } = rec;
  // The cursor: a game positioned on tick `game.state.tick`, with `prevState` a copy of the tick before (if it was stepped to).
  let game: Game | null = null;
  let prevState: GameState | null = null;
  let position = 0; // display time in ticks, 0..totalTicks

  /** Put the cursor on tick `a + 1` with a copy of tick `a` as prev (or on the final tick for a === totalTicks). */
  const place = (a: number): Game => {
    const want = Math.min(a + 1, totalTicks);
    if (game && game.state.tick === want && (want === a || prevState?.tick === a)) return game;
    if (!game || game.state.tick > a || a - game.state.tick > every) {
      const s = snapshots[Math.min(snapshots.length - 1, Math.floor(a / every))]!;
      game = restoreGame(setup, s.state, []);
    }
    while (game.state.tick < a) game.step();
    prevState = clone(game.state);
    if (game.state.tick < want) game.step();
    return game;
  };

  return {
    totalTicks,
    events: rec.events,
    result: rec.result,
    cuts: rec.cuts,
    seek(tick) {
      position = Math.min(Math.max(tick, 0), totalTicks);
      place(Math.floor(position)); // eager: restore and step now, so the playback is at `tick` when seek returns
    },
    advance(seconds) {
      position = Math.min(Math.max(position + seconds / DT, 0), totalTicks);
    },
    frame() {
      const a = Math.floor(position);
      const g = place(a);
      if (a >= totalTicks) return { prev: g.state, next: g.state, alpha: 0, tick: totalTicks };
      return { prev: prevState!, next: g.state, alpha: position - a, tick: a };
    },
  };
}

/** Plays the whole game up front on the calling thread (record) and returns a cursor over it (createCursor). */
export function createPlayback(setup: GameSetup, opts: RecordOptions = {}): Playback {
  return createCursor(setup, record(setup, opts));
}

/** Interpolates from angle `a` to angle `b` (radians) the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}
