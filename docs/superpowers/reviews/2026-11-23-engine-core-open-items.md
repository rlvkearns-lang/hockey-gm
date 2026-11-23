# Engine core: open items after the final review (2026-11-23)

The final review's findings (C1, I1 to I6) were all fixed and confirmed by a scoped re-review. These remain, none blocking:

## From the re-review of the fix wave
- A "wild high" shot from within about 3 m can be pulled under the bar by the 10 m/s lift cap and count as on net (actions.ts).
- A post graze (approach under 25% of puck speed) is no longer counted as a post (puck.ts); posts are still about 1.96 per team per game, roughly twice the NHL rate. Add a posts band at the next calibration.
- `SkaterState.mode` comes from the direction to the target, not actual velocity; it can read `crossover` while standing and is stale while a skater is down. The 3D viewer must not treat it as literal motion in those cases.
- -0 is normalised only in pos, vel, facing and z.
- `contestCooldowns[].kind` is still `string`.
- The "< 220 battles" test uses one seed with a mean near 200: fragile under tuning.

## Bands close to their limits (watch at the next calibration)
- Icings 12.15 per game (limit 13). Highest game total 12 goals (limit under 15; 14 to 15 in nearby tunings). 76 v 66 loser .130 (floor .10).

## Carried from the final review's "can wait" list
- See the triage section of `2026-11-23-engine-core-final-review.md`. Notably: `calibrate.ts` depends on `test/helpers.ts`; seed counters in test helpers depend on test order; `battlesWon` mixes contest kinds; `hits` counts absorbed checks; form and morale affect contest ratings only and fatigue is not yet read; snipers do not outscore power forwards.

## Not tested
- Firefox and Safari (the deterministic maths is runtime-independent by construction; only Node and Chrome were checked).

## For stage 2
- Calibrate the rating spread against real team win rates (a uniform 10-point better team wins .75 and loses .13).
