# Final review fixes: report

**Status: DONE_WITH_CONCERNS** (all seven findings fixed and every band passes; concerns at the end: posts are still about twice the NHL rate, and a few bands sit close to their edges).

Commits (branch `engine-core`, in order; the controller's docs commits interleave):

| Step | Commit | Subject |
|---|---|---|
| 1 C1 | `8967b7d` | fix: deterministic math, so a seed plays the same game in every runtime |
| 2 I2 | `87e09d8` | feat: backward skating and crossovers, with the mode on SkaterState |
| 3 I4, I6 | `fa24a27` | fix: believable takeaways and giveaways, steadier faceoff shares |
| 4 recalibrate | `519904e` | tune: recalibrate after deterministic math and backward skating |
| 5 I1 | `9630de0` | feat: resume a game from a snapshot (restoreGame) |
| 6 I3 | `2852440` | fix: validate every setup field the engine reads, with named errors |
| 7 I5 | `2316a0a` | feat: a typed interface for the 3D viewer |
| 8 minors | `4d99180` | chore: sweater numbers, shared helpers, dead code, documented hooks |
| 9 viewer | (no commit: `dist-single/` is git-ignored) | rebuilt and checked headlessly |

`npm test` and `npm run typecheck` were green at every commit; `npm run test:browser` passed at every commit from step 1 on.

---

## C1. Same seed, same game in every runtime

**What changed**
- `src/dmath.ts` (new): `dsin`, `dcos`, `datan`, `datan2`, `dexp`, `dlog`, `dtanh`, `dpow`, `hypot3`, built from `+ - * /`, a table of exact powers of two and the IEEE bit layout (DataView), with fixed-order Horner polynomials; argument reduction with split constants (fdlibm's ln2 and pi/2 hi/lo). `datan2` ignores the sign of zero, so a state that went through JSON gives the same angle.
- Every transcendental call and the one `**` in `src` replaced: `rng.ts` (gauss), `vec.ts`, `puck.ts` (incl. the 3-argument hypot), `skating.ts`, `game.ts`, `actions.ts`, `goalie.ts`, `bench.ts`, `brain.ts` (incl. `calm ** shootPressure`), `contests/core.ts` (`winProb`), `loose-race.ts`, `poke-check.ts`.
- `-0`: after every step the engine turns `-0` into `+0` in all positions, velocities, heights and facings (`noNegativeZero`, `x += 0`). A whole-game scan found `-0` only in skater and puck velocities; none remain.
- Golden games: `test/golden.ts` plays seeds 42, 7 and 123456 with the debug viewer's teams, hashing the exact bits of the rosters and of every skater, puck and goalie position every tick (recorded at ticks 1, 10, 100, 1000, 10000, 50000, 100000 and at the end), plus the final score and event count. `test/golden-expected.ts` holds the constants (`npm run golden:update` rewrites them after a deliberate change of results).
- `npm run test:browser` (`scripts/test-browser.ts`): bundles `test/golden-browser.ts` with esbuild into a page, runs it in headless Chromium via Playwright (`require('playwright')`, `chromium.launch()`), and fails unless the page's results equal `golden-expected.ts`.

**Tests**: `test/dmath.test.ts` (accuracy against `Math.*` over 100,000 draws each: exp, log, sin, cos, atan within 4e-16 to 1e-15 relative or absolute; atan2 1e-15; tanh 1e-15; pow 1e-14 (error grows with |b log a|); hypot3 5e-16; range ends and special values); `test/purity.test.ts` (bans `Math.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log…|pow|hypot|cbrt|…h)` and `**` outside `dmath.ts`, comments stripped; a self-test that the pattern catches them); `test/golden.test.ts`; the `-0` scan in `test/game.test.ts`.

**Measured**: Node 22.23.5 and HeadlessChrome 157 give identical fingerprints for all three seeds (every `test:browser` run). Cost: about 1.6 s per game in Node before the I2 change, single-threaded; see performance below.

## I2. Retreating defencemen skate backward

**What changed** (`src/skating.ts`, `src/types.ts`)
- With a `faceTarget` and somewhere to go, a skater squares up (keeps his body to the faced spot) once his travel is more than 65° off it, and stays squared up until it is within 45° (hysteresis).
- Squared up he pivots at his full turn rate (his travel no longer follows his blades) and pushes toward his target in any direction within an ellipse of top speeds: forward at top speed, sideways at 0.8 (crossovers, sideways acceleration 0.75 of his accel), backward at his `backwardFactor`. Edges still shed unwanted sideways speed.
- `SkaterState.mode: 'forward' | 'backward' | 'crossover'` (backward: travel more than 120° off his facing).

**Tests** (`test/skating.test.ts`): squares up and reports backward / crossover / forward; moves sideways while squared up, slower than forward; hysteresis inside the 45-65° band; whole-game measure (`retreatMeasure` in helpers, seeds 1 and 2): retreating defending defencemen facing the puck within 60°: **above 0.8** (measured 0.896 over four games; 0.418 before; moving backward 0.53, was 0.21).

## I4. Takeaways and giveaways

**What changed** (`src/turnovers.ts` new, `actions.ts`, `poke-check.ts`, `hit.ts`, `board-battle.ts`, `game.ts`, `stats.ts`, `tuning.ts`)
- Every strip and picked-off pass is now a `turnover` event (how: poke, pokeLoose, hit, battle, battleLoose, intercepted, deflected), kept for the viewer and not counted.
- Box score (`TUNING.boxScore`): a **takeaway** only for a clean strip (poke take, or a board battle won clean off the carrier) that ends a possession (the loser had carried it at least 1.5 s) and that the winning side keeps for 2 s (or still has at a stoppage); a **giveaway** only for a pass picked off cleanly from a passer under little pressure (`pressureOn` below 0.5 at release). The confirmed event carries `atTick` and `pos` of the strip. The watch is in `GameState.turnoverWatch`.

**Tests**: `test/turnovers.test.ts` (counts after the keep window; not when the loser had only just got it; not when the other team gets it straight back; unforced vs pressured interception; the box score counts takeaways and giveaways, not turnovers); calibration band (below).

## I6. Faceoff spread

**What changed** (`src/faceoff.ts`, `tuning.ts`): the team's jump on the night no longer touches draws, and the centres' rating edge is halved before `winProb` (`TUNING.faceoff.edgeScale = 0.5`). The 50-point faceoff test still passes (winProb(25) ≈ 0.74).

**Tests**: `test/referee.test.ts` ("the team's jump on the night does not touch faceoffs"); calibration band (below).

## Recalibration (step 4)

All bands of `npm run test:calibration` pass through play: no pre-game handicaps, no mercy rules, the 76 v 66 loser (> 0.10) and 95 v 10 rulings untouched, `winProb` unchanged (clamp [0.1, 0.9], divisor 24).

**Parity floors fixed**
- `interceptChance`: the speed scaling now happens before the [0.03, 0.97] clamp (was clamp then halve, floor 0.015).
- Loose-puck race: each man's bounce band narrows when he is a big underdog, so his chance never falls below 0.03 (`raceChances`; was 0.02). Tests: `test/contests/core.test.ts`, `test/contests/loose-race.test.ts`.

**Posts and misses**: one calibration run before tuning had, per game (both teams), 13.85 misses and 5.48 posts against 58 shots on goal: posts several times too frequent, misses about half the NHL rate. Shots now go near where they are aimed with a slightly tighter spread and aims a little further inside the posts, and some shots (more for a poor shooter, under pressure, from far out; chance clamped [0.03, 0.97]) are mishit and miss the net outright, wide of the post or over the bar (`TUNING.shot.wild`). Post contact that is only a graze (approach under 25% of the puck's speed) no longer counts as a post. Result: see the table (posts about 2 per team, misses about 13).

**Defect found while tuning**: a shot released from right beside the net could be lifted at over 100 m/s (`vz = (z + g t²/2) / t` with t ≈ 0), and the puck then flew hundreds of metres up and stayed loose for 20 s (the robustness test "the puck is never left alone" caught it at 15.03 s). Shot lift is now capped at 10 m/s. Test: "a shot from right beside the net is not launched skyward" (`test/goalie.test.ts`; fails with the cap removed: vz 16.1).

**TUNING changes** (old → new)
- `brain.weight.shoot` 0.45 → 0.55
- `shot.spread` {0.19, 0.003, 0.008, 0.25} → {base 0.15, perPoint 0.0025, perMetre 0.006, pressure 0.2}
- `shot.aimY` [0.35, 0.75] → [0.3, 0.65]
- `shot.wild` (new) {base 0.06, perPoint 0.002, pressure 0.15, perMetre 0.004, clear 0.12, spread 0.6, highShare 0.3}
- `goalie.save.base` 2.05 → 2.0
- `boardBattle.cooldownSeconds` 1.5 → 2.5 (battle events per game 212 → 196; the brief's "a full game has plenty of battles" < 220 failed at 231 for seed 3)
- `boxScore` (new) {keepSeconds 2, unforcedPressure 0.5, controlSeconds 1.5}
- `faceoff` (new) {edgeScale 0.5}
- `looseRace.bounceBand` 0.08 unchanged (now narrowed for underdogs, see above)

**Calibration**: `npm run calibrate -- --games 300` (70 v 70, per team per game unless noted; band in brackets):

| measure | before this wave (ledger) | now | band |
|---|---|---|---|
| goals | 2.31 | 2.43 | 2.1-3.0 |
| shots on goal | 28.13 | 29.00 | 26-34 |
| save % | .918 | .916 | .900-.928 |
| hits | 25.56 | 25.79 | 14-30 |
| blocks | 10.63 | 10.55 | 9-19 |
| takeaways | 62.58 | 6.32 | 4-12 (new) |
| giveaways | 33.89 | 5.03 | 4-12 (new) |
| faceoffs per game | 51.85 | 53.38 | 42-72 |
| games with faceoff share outside 35-65% | (5 of 16 outside 40-60 in the review) | 4.3% | at most 10% (new) |
| offsides / icings per game | 6.88 / 9.93 | 5.40 / 12.15 | 2-11 / 3-13 |
| tie share | .213 | .210 | .15-.30 |
| missed shots / posts per team | (review: 11 / 6 in one game; pre-tuning run 6.9 / 2.7) | 13.0 / 1.96 | not banded |
| total goals: max, 0-0 games | 10, 2 | 12, 1 | < 15, at most 5 |
| goals/60 Sniper vs Grinder | 1.08 vs 0.38 | 1.19 vs 0.44 | Sniper > 1.5 x Grinder |
| battle share Power Forward vs Speedster | .628 vs .448 | .633 vs .455 | PF > Sp + .05, PF < .75 |
| ms per game (4 worker threads) | 1153 | 1385 | < 3000 |

76 v 66 (300 games): home .753, away .130 (ruling: away > .10, gap > .12), ties .117. 95 v 10 robustness test passes as ruled. Single-thread time: about 1.5 s per game in Node and in headless Chrome (`test:browser`: 1496 ms per game), against 1.15-1.7 s before; the simulation was not thinned.

## I1. Resume from a snapshot

**What changed** (`src/game.ts`, `src/rng.ts`, `src/types.ts`)
- `GameState.rng`: the generator's four state words after every step (`Rng.getState`, `restoreRng`); `GameState.seed`.
- `SkaterState.toiTicks`: live ticks on the ice (integer). `toiSeconds` in the result is `toiTicks * DT` (1299.8, not 1299.7999999994752).
- `restoreGame(setup, state, eventsSoFar)`: validates the setup, copies the state and events (JSON), checks the state belongs to the setup (seed, skaters, goalies) and carries on. `drainEvents` hands out only events after the snapshot. The Movement cache is derived and rebuilt.
- `createGame` and `restoreGame` share one runner; golden fingerprints did not change in this step.

**Tests**: `test/resume.test.ts` — snapshot through JSON at seven points (the first tick; mid-contest past its first stage; mid-board-battle dig; mid-line-change; shot in flight; play stopped; third period with a turnover being watched); each restored game equals the straight run exactly (`toEqual` on the whole result), the original is unaffected, nothing is re-drained; the state holds the RNG and integer TOI; a state from another seed is rejected. `test/rng.test.ts`: a restored stream carries on exactly. These failed before the change (RED: 10 failures, `restoreGame` missing).

## I3. Validation

**What changed** (`src/validate.ts`): `SetupError` with a `code` (`SetupProblem`) and a message naming field and value, for: forecheck not one of the three; weight or height NaN or out of range (45-160 kg, 140-230 cm); any tendency missing, not finite or outside [0, 1]; form, morale, fatigue not finite (and in range); shift length not a positive number; chemistry value not finite or outside [-1, 1]; chemistry not an array; chemistry naming an unknown player; seed not a finite number (NaN, a string); unknown position; plus the old checks (now coded).

**Tests**: `test/validate.test.ts`, one case each (26), each asserting the error class, code and message, and that `createGame` refuses it. With the old `validate.ts`: 26 of 27 fail.

## I5. Interface for the viewer

**What changed**
- Contests (`types.ts`): `ContestKind`, `ContestStages` (stage union per kind), `ContestRoles` (named ids), `ContestData` (typed per kind), `ContestStateOf<K>`, `ContestState` = union. All contest modules use roles instead of participant indexes; board-battle logic still works on 0/1 internally through `ix()` but stores ids.
- Events: `GameEvent` is a discriminated union with a typed `detail` per type (`EventDetails`), `pos` on every event, `side: null` only for `periodEnd` and contest events.
- New events: `release` (every pass, shot, dump, with velocity); `shot`/`miss`/`post`/`block`/`goal` carry `releaseTick`; `contestStart` and `contestEnd` (id, kind, result, winner, puck) for every contest, including those cleared by a whistle or period end (`result: 'whistle'`) or abandoned when a player leaves (`'abandoned'`).
- `index.ts`: a deliberate surface (below). `TUNING` is internal and deep-frozen.
- Debug view (`apps/debug`): reads typed details (no string matching), lists no bookkeeping events, and a trapped puck reads "Whistle: the puck was trapped along the boards between X and Y" instead of "covered the puck".

**Results unchanged**: golden positions and scores identical; only the event count grew (e.g. seed 42: 2097 → 5066 events).

**Tests**: `test/interface.test.ts` (the exported names; TUNING frozen; every contest state's stage is in its kind's list and every role is a skater; every event has an object detail and an on-ice pos; every contestStart has exactly one later contestEnd and vice versa, with landed/take/kept/won/whistle results all seen; every pass has its release and every shot outcome points to a shot release of its shooter); `apps/debug/src/events.test.ts` (incl. the trapped wording).

## Small items (step 8)
- Goalies wear goalie numbers (30, 31, 35, 1, 29, 33, 34, 39, 40, 41, 70), skaters unique numbers 2-98 from a separate stream (players unchanged; golden roster hash moved). Test in `test/roster-gen.test.ts`.
- `periodEnd` has `side: null` and `detail.period` (done with I5).
- Deleted: `_rng` parameters of `benchTick`/`goalieTick`, `icingWatch.fromX`/`.tick`, `releasePuck` (tests use `letGo` in helpers), unused imports.
- `src/util.ts`: `skaterById`/`findSkater`, `carrierOf`, `clamp`, `other`, `SIDES`, `PUCK_RADIUS`, `GRAVITY` (the five `skaterById`, six `clamp`, two `carrierOf` and so on are gone). `wrap` was an alias of `wrapAngle` and is now `wrapAngle`. Event stamping is one function, `gameEvent` (`src/events.ts`).
- `PlayerDef` documents that `fatigue` is not read yet and that `form`/`morale` move contest ratings (and faceoffs) only.
- `test/calibration.test.ts`: every test has the long timeout, so any one runs alone.

## Step 9: viewer
- `npm -w apps/debug run build:single`: `dist-single/index.html` 106 kB.
- Headless Chromium (HeadlessChrome 157) at 1280×800 and 390×844: no console errors or warnings, no page errors; `scrollWidth` equals `clientWidth` (1280/1280, 390/390) and the widest element ends inside the viewport (1190, 374).
- Same final score, measured: in the page (seed field, Sim to end) seed 42 ends **2-3** and seed 7 **1-1**; `simulateGame` in Node 22.23.5 on the same setups: **2-3** and **1-1**.

## Commands run at the end
- `npm test`: engine 227 passed, debug 10 passed (54 s).
- `npm run typecheck`: clean.
- `npm run test:calibration`: 11 passed (calibration 8, robustness 3), 263 s on 4 cores.
- `npm run test:browser`: "browser golden games match Node: PASS" (HeadlessChrome 157, 1496 ms per game).
- `npm run calibrate -- --games 300`: table above (and `--home 76 --away 66`).

## Tests changed because of an interface change (none weakened)
- `test/contests/core.test.ts`: an intercepted pass is now a `turnover` won by the interceptor (was the passer's `giveaway`); box-score giveaways are covered in `test/turnovers.test.ts`.
- `test/contests/hit.test.ts`, `board-battle.test.ts`: the hitter's / battle winner's `takeaway` is now a `turnover` (`detail.how` 'hit', 'battle' or 'battleLoose'); trapped freeze read from `detail.cause`; the board-battle log's `pinned` is the pinned man's id (or null) instead of a participant index (same assertion).
- `test/contests/poke-check.test.ts`: "out of stick reach … nothing is decided" now ignores the contest's own start/end events and additionally asserts the end's result is `outOfReach` with no winner (stronger).
- `test/contests/net-front.test.ts`, `test/bench.test.ts`: typed detail (`detail.how`, `detail.phase`) instead of strings.
- `test/referee.test.ts`: comment for the halved faceoff edge; assertion unchanged.
- `test/helpers.ts`: `runPoke`/`pokeReleased` count `turnover`; `letGo` replaces `releasePuck`; `detailKey` for calibration counts; `lineChangeEvents`/`shiftLengths` read typed details; `BattleTick.pinned` is an id.
- `apps/debug/src/events.test.ts`, `draw.test.ts`: typed events and contests.

## Public interface for the 3D viewer
`import { … } from '@hockey/engine'`:
- **Play**: `createGame(setup) → Game` (`state`, `done`, `step()`, `drainEvents()`, `result()`); `simulateGame(setup) → GameResult`; `restoreGame(setup, state, eventsSoFar) → Game` (keyframes: snapshot `game.state` (JSON is fine) and `game.result().events`; seek by restoring the nearest keyframe and stepping).
- **Input**: `validateSetup`, `SetupError`/`SetupProblem`, `generateTeam`, `PLAYER_TYPES`, `SKATER_ATTRS`, `GOALIE_ATTRS`.
- **Geometry and constants**: `RINK`, `FACEOFF_DOTS`, `zoneOf`, `BENCH_DOORS`, `bodyRadius`, `DT` (1/30 s), `PERIOD_SECONDS`, `PERIODS`, `BRAIN_INTERVAL_TICKS`.
- **State to animate** (`GameState`, read between steps): `skaters[]` (`pos`, `vel`, `facing`, `mode` forward/backward/crossover, `downT` (knocked down), `onIce`, `leaving`, `contestId`, `energy`), `puck` (`pos`, `z`, `vel`, `vz`), `carrierId`, `goalies.home/away` (`pos`, `facing`, `pose` stance/butterfly/glove/blocker/pad/cover, `poseT`), `contests[]` (`kind`, `stage`, `stageT`, `roles`, `leader`, `spot`, `participants`, `freeIds`, typed `data`), `phase`, `clock`, `period`, `score`, `faceoffSpot`.
- **Events** (`GameEvent`, discriminate on `type`; all have `tick`, `period`, `clock`, `pos`, `side`, `playerId`, `otherId`): `release` (kind, vel), `pass`, `shot`/`miss`/`post`/`block`/`goal` (distance, `releaseTick`), `save` (pose), `hit` (result, contestId), `battle` (how, contestId), `turnover` (how), `takeaway`/`giveaway` (box score; `atTick`), `faceoff`/`offside`/`icing` (faceoff `spot`), `freeze` (cause), `lineChange` (unit, from, to, onTheFly, phase), `periodEnd`, `contestStart`/`contestEnd` (contestId, kind, participants / result, winnerId, puck). A pre-run event log is enough for a director to find every contest, shot and stoppage with its position and timing.

## Concerns / not done
- **Posts still about twice real.** Per team per game 1.96 posts against roughly 1 in the NHL (misses 13.0 against roughly 11-12, now plausible). Before: 2.7 posts and 6.9 misses. Pushing posts lower meant aiming further from the posts or a tighter spread, which made goals per game more dispersed (one 15-goal game in a 300-game set, failing "no freak scores"); I stopped at this trade-off rather than chase it further.
- **Bands close to an edge**: icings 12.15 per game (band < 13), tie share .210 is fine, save % .916 fine; the 76 v 66 loser .130 (ruled > .10). The "no freak scores" test (max < 15) passed at 12 but has sat at 14-15 in nearby tunings: total goals are somewhat over-dispersed game to game (variance/mean about 1.0-1.25 depending on tuning).
- **"A full game has plenty of battles" (< 220)** needed the board-battle cooldown raised (1.5 -> 2.5 s): the mean was about 207 battle events per game (net-front about 75, protect about 60), so single games went over.
- Firefox and Safari were not tested (none here); dmath is runtime-independent by construction.
- Not done (outside this wave): splitting `scripts/calibrate.ts` from the 1,500-line `test/helpers.ts`, order-dependent seed counters in helpers, `battlesWon` mixing kinds, `hits` counting absorbed checks (review minors not in the step-8 list).
- The controller committed docs to `engine-core` while I worked; my commits sit between them. Nothing pushed.
