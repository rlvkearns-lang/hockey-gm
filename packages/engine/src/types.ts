import type { Vec2 } from './vec';
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
