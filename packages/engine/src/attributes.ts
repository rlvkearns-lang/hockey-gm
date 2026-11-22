export const SKATER_ATTRS = [
  'shootingAccuracy', 'shootingPower', 'passing', 'vision', 'iq', 'poise',
  'speed', 'acceleration', 'agility', 'balance', 'strength', 'fortitude',
  'compete', 'stamina', 'puckHandling', 'stickChecking', 'bodyChecking', 'aggression',
  'shotBlocking', 'faceoffs', 'discipline', 'defensivePositioning', 'fighting', 'injuryProneness',
] as const;
export type SkaterAttrs = Record<(typeof SKATER_ATTRS)[number], number>;

export const GOALIE_ATTRS = [
  'reflexes', 'positioning', 'reboundControl', 'glove', 'blocker', 'lateral', 'puckHandling', 'poise',
] as const;
export type GoalieAttrs = Record<(typeof GOALIE_ATTRS)[number], number>;

/** Weighted mean of the named attributes; weights need not sum to 1. */
export function composite(attrs: SkaterAttrs, weights: Partial<Record<keyof SkaterAttrs, number>>): number {
  let sum = 0;
  let total = 0;
  for (const k of SKATER_ATTRS) {
    const w = weights[k];
    if (w === undefined) continue;
    sum += attrs[k] * w;
    total += w;
  }
  return total === 0 ? 0 : sum / total;
}
