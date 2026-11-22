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
