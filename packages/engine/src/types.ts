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

export type ContestState = {
  id: number;
  kind: string;
  stage: string;
  stageT: number;
  participants: string[];
  leader: string | null;
  spot: Vec2;
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
  /** A pass on its way: its intended receiver skates onto it and may take it at any speed until tick `untilTick`. */
  pendingPass: { fromId: string; toId: string; untilTick: number } | null;
  shotInFlight: ShotInFlight | null;
  /** The goalie of each side is screened while tick < this value (set by net-front battles). */
  screenedUntilTick: Record<Side, number>;
  /**
   * Skaters who had the puck since the last change of team or stoppage, oldest first, by `side`: the scorer's
   * assists come from here. Pickups, releases, faceoff wins and blocks count; a goalie's save does not.
   */
  touches: { side: Side | null; ids: string[] };
};

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
