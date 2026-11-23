import { createGame, DT, restoreGame, type Game, type GameEvent, type GameResult, type GameSetup, type GameState } from '@hockey/engine';

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
  /** Show exactly `tick` (clamped to the game); restores and steps now, not on the next frame(). */
  seek(tick: number): void;
  /** Move display time by `seconds` of game time (negative goes back), clamped to the game. */
  advance(seconds: number): void;
  frame(): Frame;
};

type Snapshot = { tick: number; state: GameState; eventCount: number };

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Plays the whole game once up front (on the calling thread), keeping a deep-copied snapshot every
 * `snapshotEverySeconds` and the full event log. Seeking restores the nearest earlier snapshot and steps forward;
 * the viewer never decides anything about the game.
 */
export function createPlayback(setup: GameSetup, opts: { snapshotEverySeconds?: number } = {}): Playback {
  const every = Math.max(1, Math.round((opts.snapshotEverySeconds ?? 5) / DT));
  const events: GameEvent[] = [];
  const snapshots: Snapshot[] = [];

  const first = createGame(setup);
  const snap = (g: Game): void => {
    events.push(...g.drainEvents());
    snapshots.push({ tick: g.state.tick, state: clone(g.state), eventCount: events.length });
  };
  snap(first);
  while (!first.done) {
    first.step();
    if (first.state.tick % every === 0) snap(first);
  }
  events.push(...first.drainEvents());
  const result = first.result();
  const totalTicks = first.state.tick;

  // The cursor: a game positioned on tick `game.state.tick`, with `prevState` a copy of the tick before (if it was stepped to).
  let game: Game = first;
  let prevState: GameState | null = null;
  let position = 0; // display time in ticks, 0..totalTicks

  /** Put the cursor on tick `a + 1` with a copy of tick `a` as prev (or on the final tick for a === totalTicks). */
  const place = (a: number): void => {
    const want = Math.min(a + 1, totalTicks);
    if (game.state.tick === want && (want === a || prevState?.tick === a)) return;
    if (game.state.tick > a || a - game.state.tick > every) {
      const s = snapshots[Math.floor(a / every)]!;
      game = restoreGame(setup, s.state, events.slice(0, s.eventCount));
    }
    while (game.state.tick < a) game.step();
    prevState = clone(game.state);
    if (game.state.tick < want) game.step();
  };

  return {
    totalTicks,
    events,
    result,
    seek(tick) {
      position = Math.min(Math.max(tick, 0), totalTicks);
      place(Math.floor(position)); // eager: restore and step now, so the playback is at `tick` when seek returns
    },
    advance(seconds) {
      position = Math.min(Math.max(position + seconds / DT, 0), totalTicks);
    },
    frame() {
      const a = Math.floor(position);
      place(a);
      if (a >= totalTicks) return { prev: game.state, next: game.state, alpha: 0, tick: totalTicks };
      return { prev: prevState!, next: game.state, alpha: position - a, tick: a };
    },
  };
}

/** Interpolates from angle `a` to angle `b` (radians) the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}
