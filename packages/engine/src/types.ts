import type { Vec2 } from './vec';
import type { Puck } from './puck';
import type { GoalieAttrs, SkaterAttrs } from './attributes';

export type Position = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G';
export type Side = 'home' | 'away';

/** Each value 0 to 1. */
export type Tendencies = {
  shoot: number;
  pass: number;
  carry: number;
  dump: number;
  hit: number;
  forecheck: number;
  netFront: number;
  joinRush: number;
};

export type PlayerDef = {
  id: string;
  name: string;
  number: number;
  position: Position;
  shoots: 'L' | 'R';
  heightCm: number;
  weightKg: number;
  type: string;
  subType: string | null;
  attrs: SkaterAttrs;
  goalie: GoalieAttrs | null;
  tendencies: Tendencies;
  /** -1..1, default 0 */
  form: number;
  /** -1..1, default 0 */
  morale: number;
  /** 0..1, default 0 */
  fatigue: number;
};

export type Lines = {
  /** Lines in LW, C, RW order. */
  forwards: [string, string, string][];
  /** Pairs in LD, RD order. */
  defence: [string, string][];
  goalie: string;
};

export type Tactics = {
  forecheck: 'passive' | 'balanced' | 'aggressive';
  shiftSeconds: { forwards: number; defence: number };
};

export type TeamDef = {
  id: string;
  name: string;
  abbr: string;
  players: PlayerDef[];
  lines: Lines;
  tactics: Tactics;
};

export type GameSetup = {
  home: TeamDef;
  away: TeamDef;
  seed: number;
  chemistry: { a: string; b: string; value: number }[];
};

export type SkaterState = {
  id: string;
  side: Side;
  slot: Position | null;
  pos: Vec2;
  vel: Vec2;
  /** Radians; direction the body points. */
  facing: number;
  /** Where he is trying to go. */
  target: Vec2;
  /** When set, he keeps his body pointed at this spot (skating backward if need be). */
  faceTarget: Vec2 | null;
  /** 0..1 fraction of top speed he may use this tick. */
  speedCap: number;
  energy: number;
  onIce: boolean;
  leaving: boolean;
  /** Seconds left knocked down; above 0 means no control. Decremented by the caller. */
  downT: number;
  contestId: number | null;
  /** Game clock seconds (counted from the opening faceoff) when he last stepped on the ice. */
  shiftStart: number;
};

export type Phase = 'faceoffSetup' | 'live' | 'stopped' | 'intermission' | 'final';

export type GoaliePose = 'stance' | 'butterfly' | 'glove' | 'blocker' | 'pad' | 'cover';

/** `vel` is his movement this tick (m/s); `pose` shows a save (or a cover) for `poseT` more seconds, then `stance`. */
export type GoalieState = { id: string; pos: Vec2; vel: Vec2; facing: number; pose: GoaliePose; poseT: number };

/** A shot on its way, from its release until the puck reaches the net, misses, hits a post or is blocked. */
export type ShotInFlight = {
  shooterId: string;
  side: Side;
  /** Where it was released, and how far that was from the net centre (m). */
  from: Vec2;
  fromDist: number;
  tick: number;
  /** Defenders who have already had their one chance to block it. */
  blockTried: string[];
};

/**
 * A contest under way (see contests/core.ts), what a viewer animates from. `stage` and `stageT` (seconds into that
 * stage) are kept current every tick; `leader` is whoever is ahead (null while undecided); `participants` are the
 * skaters in it now (each has `contestId` = `id`); `spot` is where it happens. `freeIds` are the participants who keep
 * their normal steering (team-play job, carrier decisions, may receive a pass) while in it; the contest steers the
 * rest. `data` is the kind's own working numbers.
 */
export type ContestState = {
  id: number;
  kind: string;
  stage: string;
  stageT: number;
  participants: string[];
  leader: string | null;
  spot: Vec2;
  freeIds: string[];
  data: Record<string, number>;
};

/** Plain JSON data only: a viewer reads it between steps. */
export type GameState = {
  tick: number;
  period: number;
  /** Seconds left in the period; runs only while live. */
  clock: number;
  phase: Phase;
  /** Seconds spent in the current phase. */
  phaseT: number;
  attackDir: { home: 1 | -1; away: 1 | -1 };
  puck: Puck;
  carrierId: string | null;
  lastTouch: { id: string; side: Side } | null;
  possession: Side | null;
  skaters: SkaterState[];
  goalies: { home: GoalieState; away: GoalieState };
  contests: ContestState[];
  score: { home: number; away: number };
  faceoffSpot: Vec2;
  onIce: { home: string[]; away: string[] };
  /** Players who just released the puck and may not pick it up before tick `untilTick`. */
  pickupBlock: { ids: string[]; untilTick: number } | null;
  /**
   * A pass on its way: its intended receiver skates onto it and may take it at any speed until tick `untilTick`.
   * `tried` lists the opponents who have had their one chance to intercept it.
   */
  pendingPass: { fromId: string; toId: string; untilTick: number; tried: string[] } | null;
  /** The last skater to let the puck go (pass, shot, dump) and the tick he did; a hit on him counts for a moment after. */
  lastRelease: { id: string; tick: number } | null;
  /** Skater `id` may not start a contest of `kind` before tick `untilTick` (expired entries are dropped). */
  contestCooldowns: { id: string; kind: string; untilTick: number }[];
  shotInFlight: ShotInFlight | null;
  /** Each team's jump on the night: rating points added to all its players' contest ratings and faceoffs (drawn at the start). */
  teamJump: Record<Side, number>;
  /** Each goalie's night: added to his save chance's log-odds for the whole game (drawn at the start; a hot or cold night). */
  goalieNight: Record<Side, number>;
  /** The goalie of each side is screened while tick < this value (set by net-front battles). */
  screenedUntilTick: Record<Side, number>;
  /** Skater `id` has his stick tied up (no pass reception, no loose-puck pickup or race) while tick < `tick` (net-front). */
  tiedUpUntil: { id: string; tick: number }[];
  /** Skater `id` won his last net-front round: +10 in a loose-puck race (a rebound) while tick < `untilTick`. */
  reboundEdge: { id: string; untilTick: number } | null;
  /**
   * Skaters who had the puck since the last change of team or stoppage, oldest first, by `side`: the scorer's
   * assists come from here. Pickups, releases, faceoff wins and blocks count; a goalie's save does not. `ticks[i]` is
   * the last tick `ids[i]` had the puck.
   */
  touches: { side: Side | null; ids: string[]; ticks: number[] };
  /** The last skater of each side to touch the puck since the last stoppage (credited with a goal the defenders put in). */
  lastAttackTouch: Record<Side, string | null>;
  /** The side that iced the puck: it may not change lines before the next faceoff drop (set by an icing, cleared by dropPuck). */
  noChange: Side | null;
  /**
   * Delayed offside against `side`: the puck went into its attacking zone with one of its skaters already wholly in it.
   * Play goes on until that team touches the puck (whistle) or the puck leaves the zone or all of them leave it
   * (waved off). `y` is where the puck went in, for the faceoff dot.
   */
  delayedOffside: { side: Side; y: number } | null;
  /** A puck released by `side` from its own half at (fromX, fromY) on `tick`, untouched since: icing if it crosses the far goal line. */
  icingWatch: { side: Side; fromX: number; fromY: number; tick: number } | null;
  /** Each team's line rotation (see bench.ts). */
  bench: Record<Side, BenchState>;
};

/** One kind of unit of a team: its forward lines or its defence pairs. */
export type BenchUnit = {
  /** Index (into Lines.forwards or Lines.defence) of the unit on the ice, or coming on while `changing`. */
  cur: number;
  /** True from the start of a change until the outgoing unit is all off and the incoming one all on. */
  changing: boolean;
  /** Game clock seconds (counted from the opening faceoff) when the unit's current shift began. */
  shiftStart: number;
  /** Live seconds each unit has been credited with, by index. */
  toi: number[];
};

export type BenchState = { forwards: BenchUnit; defence: BenchUnit };

export type GameEventType =
  | 'faceoff' | 'pass' | 'shot' | 'save' | 'goal' | 'miss' | 'post' | 'block' | 'hit' | 'takeaway'
  | 'giveaway' | 'battle' | 'offside' | 'icing' | 'freeze' | 'lineChange' | 'periodEnd';

export type GameEvent = {
  tick: number;
  period: number;
  clock: number;
  type: GameEventType;
  side: Side;
  playerId: string | null;
  otherId: string | null;
  assistIds: string[];
  detail: string;
  /** On a goal: the skaters of each side on the ice when it went in (for plus/minus). */
  onIce?: { home: string[]; away: string[] };
};

export type PlayerLine = {
  id: string;
  goals: number;
  assists: number;
  shots: number;
  hits: number;
  blocks: number;
  takeaways: number;
  giveaways: number;
  faceoffsWon: number;
  faceoffsLost: number;
  plusMinus: number;
  toiSeconds: number;
  battlesWon: number;
  battlesLost: number;
  saves: number;
  shotsAgainst: number;
};

export type TeamLine = { shots: number; hits: number; blocks: number; faceoffsWon: number; giveaways: number; takeaways: number };

export type GameResult = {
  score: { home: number; away: number };
  tied: boolean;
  team: Record<Side, TeamLine>;
  players: PlayerLine[];
  events: GameEvent[];
  seed: number;
};
