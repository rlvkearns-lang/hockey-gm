/**
 * How much having the puck at a spot is worth (options.ts's valuation; Task 7 also reads it in actions.ts for one-timer
 * passes). Positions are attack-relative: rx toward the net attacked (goal line 27.13, blue line 7.62), ly across.
 */
import { dexp as dexp_ } from './dmath';
import { RINK } from './rink';
import { TUNING } from './tuning';
const dexp = dexp_;

const GOAL = RINK.goalLineX;
const BLUE = RINK.blueLineX;
const B = TUNING.brain;
const O = TUNING.options;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** 0..1: the shot-quality part of threat (distance and angle to the net centre), 0 outside the zone, behind the line or beyond maxShotDistance. */
export function shotQuality(rx: number, ly: number): number {
  const dx = GOAL - rx;
  if (dx < 0.3 || rx < BLUE) return 0;
  const d = hyp(dx, ly);
  if (d > B.maxShotDistance) return 0;
  return dexp(-d / B.shotDistanceScale) * (dx / d);
}

/** How much having the puck at (rx, ly) is worth to the team that has it: about its chance to score on this possession, 0 to about 0.2. */
export function threat(rx: number, ly: number): number {
  const r = clamp((rx + 30) / 60, 0, 1);
  return O.threat.base + O.threat.ice * r * r + O.threat.shot * shotQuality(rx, ly);
}

