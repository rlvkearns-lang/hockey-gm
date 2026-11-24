/** How a goalie plays a puck that slides at him without being a shot (Task 8b review, Important 2); kept apart so passing.ts can read it. */
import { dexp } from './dmath';
import { TUNING } from './tuning';
import { clamp } from './util';

/**
 * Chance the goalie stops a puck that was not shot as it slides over his line between the posts (a pass, a centring feed,
 * a loose puck): logistic(G.slide.base - G.slide.perSpeed * speed - G.slide.perMetre * (lateralMiss - G.slide.body, at
 * least 0)), within [0.03, 0.97]. `lateralMiss`: how far its line passes from his centre plus his squareness error (m).
 */
export function slideStopChance(speed: number, lateralMiss: number): number {
  const S = TUNING.goalie.slide;
  return clamp(1 / (1 + dexp(-(S.base - S.perSpeed * speed - S.perMetre * Math.max(0, lateralMiss - S.body)))), 0.03, 0.97);
}

