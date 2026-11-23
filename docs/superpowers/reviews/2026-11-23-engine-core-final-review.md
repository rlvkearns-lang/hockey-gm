# Final review: engine-core (4764e26..7bc383f)

Reviewed by reading the whole of `packages/engine/src`, the tests, scripts, `apps/debug/src`, the spec, the plan's Global Constraints and Review Focus, and the full ledger. Nothing in the checkout was changed. All experiments ran from the session scratchpad.

What I ran:

- `npm test`: 165 engine tests + 8 debug tests pass, 35 s.
- Same seed in Node 22.23.5 (V8 12.4) and headless Chrome 153, with every skater, puck and goalie position hashed each tick.
- 16 full games measuring defenceman facing, faceoff share, takeaway sources.
- 19 invalid setups through `createGame`.
- A scan of `GameState` for values that do not survive JSON.

Not run: `npm run test:calibration`. The calibration numbers below are the ledger's, except where I say I measured them.

## Strengths

- The engine is pure. There are no DOM, Node, `Date`, `Math.random` or `performance` references in `src`, all randomness comes from one `Rng`, and iteration is over arrays and insertion-ordered Maps. There is no `sort` and no key-order dependence.
- Within one runtime the game is deterministic. Irregular bursts with state reads between them match `simulateGame` (pinned in `game.test.ts:23`).
- Module-level scratch objects are refilled on every call, so two games stepped alternately do not disturb each other.
- The parity rule is applied consistently. `winProb` (`contests/core.ts:62`) uses divisor 24 and clamps to [0.1, 0.9]. Save, freeze, block, intercept, poke-attempt, hit-attempt, bounce and beaten chances are all clamped to [0.03, 0.97]. The carrier's decision has a per-kind share cap. I found no certain outcome.
- Contests are staged, take time and are visible in state: `ContestState` carries kind, stage, stageT, leader, participants and spot every tick. I saw all 16 kind:stage pairs occur in one game.
- `GameState` is plain data. Over a full game it held no NaN, Infinity or undefined, and serialises to about 14 kB.
- Performance is inside budget without thinning: about 1.1 to 1.5 s per game here against 3 s.
- The 5-on-5 totals are believable for 5-on-5. 2.31 goals, 28.1 shots, .918 and .213 ties are close to real 5-on-5 rates; the spec's "about 3 goals, .900" includes power plays.
- The controller rulings on the 76 v 66 and 95 v 10 bands are sound and are documented in the tests.

## Issues

### Critical (Must Fix)

**C1. The same seed gives a different game in Chrome than in Node. Reproduced, cause isolated, fix proven.**

- **What is wrong.** Seed 42 ends 2-3 in Node 22 and 0-3 in Chrome 153; seed 7 ends 4-4 and 1-3. The state hash already differs at tick 1. The generated rosters differ too, because tendencies are floats drawn with `gauss`.
- **Cause.** Over 400,000 identical inputs, `Math.sin`, `cos`, `tan`, `atan`, `atan2`, `exp`, `log`, `tanh`, `cbrt`, `pow` and the `**` operator return different last bits in the two runtimes. `Math.sqrt` and `Math.hypot` (2 and 3 arguments) matched.
- **Every call site in `src`:**
  - `rng.ts:52` (`log`, `cos` in `gauss`, which feeds everything, including `roster-gen.ts:17,23,29`)
  - `vec.ts:28,31`
  - `puck.ts:59` (`exp`), `puck.ts:103` (`Math.hypot` with 3 arguments: it matched, but is not guaranteed)
  - `skating.ts:73,80,94,107`
  - `game.ts:179-180`
  - `actions.ts:90-91,154-155,201-203`
  - `goalie.ts:38,83 (tanh),128,205-207,314,339,345-349`
  - `bench.ts:28,57,110`
  - `brain.ts:34,138`, and `brain.ts:140` (`calm ** T.shootPressure`, which no `Math.` grep finds)
  - `contests/core.ts:63` (`winProb` itself)
  - `contests/loose-race.ts:37,179-180`
  - `contests/poke-check.ts:60,150,154`
- **Nothing else is a source.** I replaced `sin`, `cos`, `atan2`, `exp`, `log`, `tanh` and the one `**` with implementations built only from `+ - * /`, `Math.round` and `Math.abs`. Three full games (seeds 42, 7, 123456), hashed every tick, were then bit-identical between Node and Chrome. Firefox and Safari were not available to test.
- **Why it matters.** It breaks spec goal 12 and the anti-goal "a watched game ending differently from the same game simmed unwatched" as soon as the two run in different runtimes. Stage 5's server-sims, client-replays design depends on it. It also changes every game, so calibration must be re-run once after the fix; fixing it later costs a second recalibration.
- **How to fix.**
  - Add `src/dmath.ts` exporting `dsin`, `dcos`, `datan2`, `dexp`, `dlog`, `dtanh`, `dpow`, `hypot3`. Use argument reduction plus fixed-order polynomial or series; scale by powers of two with exact multiplies. Use no `Math.*` beyond `abs`, `round`, `floor`, `sqrt`, `min`, `max`, `sign`, `imul`.
  - Replace every site above, including `**`.
  - My naive version was accurate to about 1e-15 relative (`tanh` 1e-13) and cost about 20% run time (1.49 s to 1.82 s per game with per-tick hashing on). That is well inside budget and can be tightened.
- **Tests that would catch regressions.**
  - Extend `test/purity.test.ts:18` to ban `Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log(1p|2|10)?|pow|hypot|cbrt|a?(sinh|cosh|tanh))` and `\*\*` everywhere in `src` except `dmath.ts`.
  - Add a golden test: for 2 or 3 seeds, a hash of the rosters and of all positions at fixed ticks, plus the final score, compared with constants checked into the repo. Any runtime that disagrees fails.
  - Run that same golden file in a real browser in CI. Headless Chrome on a bundled page, as I did, takes a few seconds.

### Important (Should Fix before building on this)

**I1. A game cannot be resumed from a `GameState` snapshot, and there is no restore entry point.**

- **What is wrong.** Outside the state are:
  - the RNG's four state words (`rng.ts:27-33`, created at `game.ts:110`). The ledger missed this one, and it is the one that makes resume impossible rather than awkward.
  - the event log and drain cursor (`game.ts:114-115`), from which the whole box score is rebuilt (`game.ts:332`).
  - per-skater time on ice (`game.ts:125`).
  - the Movement cache, which is derived and harmless.
- **Why it matters.** The 3D viewer's seek and the spec's director ("run the whole game first and pick from it") need keyframe-and-resume. Otherwise every seek replays from tick 0, about a second.
- **How to fix.**
  - Put the RNG words in `GameState` (`createRng` gains `getState` and `fromState`).
  - Move time on ice into `SkaterState` as an integer tick count. `toi += DT` currently yields values like 1299.7999999994752.
  - Add `restoreGame(setup, state, eventsSoFar)`.
  - Test: run to tick K, clone, restore, finish, and expect the result to equal the straight run, for several K including mid-contest and mid-line-change.
- **A trap for that test.** State holds `-0` in `vel` (seen in `skaters[].vel` and `puck.vel`). JSON drops the sign, and `atan2(-0, negative)` differs from `atan2(0, negative)`. Either snapshot with `structuredClone`, or normalise `-0` in the engine.

**I2. Retreating defencemen mostly do not skate backward.**

- **What I measured.** Over 16 games, taking defending defencemen moving toward their own net at more than 1.5 m/s with the puck up-ice of them: 43% face the puck within 60 degrees and 32% are moving backward. The debug-view report of about 20% used a stricter definition; the conclusion is the same.
- **Cause.** `skating.ts:77-88` faces the puck only when the travel direction is more than 100 degrees off the puck direction (`skating.ts:23`); otherwise the body faces travel.
  - `faceTarget` was set in 96% of those samples, so team play is asking correctly.
  - The off angle exceeded 100 degrees in only 51%, and its largest bucket is 90 to 120 degrees. The shape targets are diagonal and sit on the threshold.
  - There is no hysteresis, so he flips between the two facings, and at speed a pivot takes over a second (`skating.ts:91`).
  - Effort only counts along the facing axis (`skating.ts:97`), so he cannot move sideways while squared up.
- **Why it matters.** The spec asks for backward skating and crossovers, and the 3D viewer will animate whatever facing the engine gives it.
- **How to fix, in the engine, not the viewer.**
  - With `faceTarget` set, face it whenever the off angle is above about 60 to 70 degrees, with hysteresis: enter backward mode high, leave it low.
  - Allow a lateral (crossover) velocity component at a reduced factor.
  - Expose the mode on `SkaterState` (`forward | backward | crossover`) so the viewer does not have to infer it.
  - Pin it with a whole-game test on the measure above, for example facing above 80%.
- This changes results, so do it in the same recalibration as C1.

**I3. Bad tactics, weights and tendencies pass validation and silently wreck the game.** (Review Focus 4.)

- **What is wrong.** `validate.ts` checks ratings and lines only. Measured:
  - `tactics.forecheck = 'bogus'` gives NaN skater positions and a 0-0 game with 1 shot. `FORECHECK_PRESS_CAP[...]` is undefined at `team-play.ts:252`.
  - `weightKg = NaN` gives NaN state.
  - `tendencies.shoot = NaN` gives a 0-0 game.
  - `form = NaN`, `shiftSeconds` of NaN, 0 or negative, tendencies of 5 or 50, a NaN chemistry value, and a NaN or string seed all run without complaint.
  - `chemistry` undefined throws "not iterable" rather than a named problem.
- **Why it matters.** Stage 2 will feed real, user-edited rosters and tactics. The plan promises an error naming the problem, not a broken game.
- **How to fix.** In `validateSetup`:
  - finite, in-range `weightKg` and `heightCm`;
  - every tendency finite in [0, 1];
  - `form`, `morale`, `fatigue` and chemistry values finite;
  - `tactics.forecheck` one of the three values, `shiftSeconds` finite and positive;
  - `seed` a finite number, `chemistry` an array.
  - One test per case.

**I4. The box score's takeaways and giveaways are not believable.**

- **What is wrong.** I measured 64.2 takeaways and 32.5 giveaways per team per game; the NHL records roughly 5 to 10 of each.
- **Cause.** It is a counting rule, not too much action. Takeaways are emitted for every won poke check, including ones that only knock the puck loose (`poke-check.ts:142`: 35 clean and 34 loose per game), every puck separated by a hit (`hit.ts:224`: 31), and every board-battle strip (`board-battle.ts:385`: 29). `stats.ts:59-62` counts them all.
- **Why it matters.** The stage's deliverable is a believable box score, and the debug view already shows these numbers to the owner.
- **How to fix.** Keep the events for the viewer, but give them their own type or a flag. Count a box-score takeaway only for a clean strip where the taker's team keeps the puck, and a giveaway only for an unforced loss. Tune both to about 5 to 10 and add them to the calibration bands.

**I5. The interface the 3D viewer will consume is stringly typed and has gaps.** Tighten it before a second consumer is written against it.

- `ContestState.kind` and `stage` are `string`, and `data` is `Record<string, number>` holding roles as participant indexes (`supportA`, `pinned`, `carrier`, `winner`, `outcome` codes) (`types.ts:120-130`). The viewer needs string-literal unions per kind, and named role ids (hitter/target, pinner/pinned, checker/carrier, supporters).
- Outcomes live in free-text `GameEvent.detail`, and the debug view already string-matches it (`events.ts:13-47`). Make `detail` a typed union per event type, or add structured fields. Distances and faceoff spots are currently formatted strings (`actions.ts:93`, `faceoff.ts:163`).
- Events carry no position. The director must seek to find where something happened. Add `pos`.
- A `shot` event is emitted when the puck arrives, not at release (`goalie.ts:321`), and a missed shot only yields a later `miss`. The viewer needs the release tick for the shooting animation. Stamp the release tick on the event, or emit a `release` event (pass, shot or dump).
- Poke checks that fail, loose-puck races, and contests cut short emit nothing; only state shows them. Emit contest start and end events with the contest id and result, so a pre-run log is enough for the director.
- `index.ts` re-exports every module. Any consumer can reach internals such as `stepPuck` and the mutable `TUNING`. Export a deliberate surface: `createGame`, `simulateGame`, `restoreGame`, the types, rink geometry, `generateTeam`, constants.

**I6. Faceoff share per game swings too far.**

- **What I measured.** Home share in 16 games: .62 .42 .55 .51 .30 .59 .40 .52 .47 .48 .38 .46 .43 .33 .54 .78. Five of 16 are outside 40 to 60%. The ledger's 32 v 14 is typical of this, not a fluke.
- **Cause.** `faceoff.ts:127-134` adds the whole-game `teamJump` (sd 3 per side, `tuning.ts:69`) to both centres on every draw, on top of the full `winProb` slope on a single attribute.
- **How to fix.** Take `teamJump` out of draws, or halve the faceoff edge, and add a band on the per-game spread to calibration. The average is fine, so this is the least urgent of the Important items.

### Minor (Nice to Have)

- `roster-gen.ts:41,80-81`: players are numbered 1 to 20 in order, so both starting goalies wear 19. Give goalies conventional numbers and skaters varied ones.
- `validate.ts:19`, `game.ts:72,103`: `PlayerDef.fatigue` is validated but never read (energy always starts at 1). `form` and `morale` only affect contest ratings (`core.ts:80-81`), not shooting, passing, skating or goalies. Wire these or document them as not yet effective before stage 2 relies on them.
- `stats.ts:51`: `hits` counts absorbed and bounced checks (about 15 of 53 per game). Decide whether those are hits.
- `stats.ts:67`: `battlesWon` mixes board battles, net-front jostles (78 in one game) and protect rounds (63).
- `actions.ts:165-167`: interception chance is halved after the clamp, so its floor is 0.015. `loose-race.ts:200`: with the bounce band a racer's floor is 0.02. Neither is certain, but both are under the stated 0.03.
- One game (seed 42) had 6 posts and 11 wide shots against 61 on goal: posts look several times too frequent and misses too few. Check over a calibration run.
- Duplication: `skaterById` in 5 files, `clamp` in 6, `carrierOf` in 2, event stamping in 7, `PUCK_RADIUS` in 3, `GRAVITY`, `MAX_LEAD_SECONDS`, `wrap`, `other` in 2 each, `SIDES` in 4. Move them to one small module.
- `tuning.ts`: `TUNING` is a mutable export, and some values are baked at import (`bench.ts:28` `RECOVERY_RATE`), so changing it at run time half-works. Freeze it or make it a `createGame` input.
- Dead or unused: `_rng` parameters (`bench.ts:106`, `goalie.ts:171`); `icingWatch.fromX` and `.tick`; `releasePuck` (`actions.ts:70`) is used only by tests.
- `game.ts:275`: `periodEnd` carries `side: 'home'`, which means nothing.
- `apps/debug/src/events.ts:46`: a `freeze` with detail `trapped` (a board battle) reads "X covered the puck".
- `scripts/calibrate.ts:5` imports from `test/helpers.ts`, which is 1,446 lines. Split the game-set runner from the per-task harnesses.
- `test/helpers.ts:87,331,570,710,797`: five module-level seed counters make statistical tests depend on which tests ran earlier in the file. Derive the seed from the test instead.
- `test/calibration.test.ts:26`: "no freak scores" relies on an earlier test filling the cache and times out when run alone.
- `test/perf.test.ts`: averaged 1.7 s per game while the suite ran in parallel. The 3 s limit is machine-dependent; it is fine as a smoke check.
- `main.ts:74,142`: the box score is rebuilt from the whole event log every 250 ms. Harmless here; I1 removes the need.

## Triage of ledger items

The ledger has no line containing "parked".

**Fix now** (before the 3D viewer is built on this):

- T13 ENGINE ISSUE 1, cross-runtime divergence; and T3 "Math.exp/hypot cross-engine bit-identity": C1.
- T13 ENGINE ISSUE 2, retreating defencemen: I2.
- T5b "toi/event log/Movement cache outside GameState": I1, plus the RNG state.
- T2 "validate NaN form/morale/fatigue": I3.
- T12 "takeaways 62.6/team still high"; T13 observed "takeaways >> giveaways": I4.
- T13 observed "faceoffs lopsided 32 v 14": I6.
- T13 observed "both goalies number 19": trivial, do it with the above.
- T12 "TUNING mutable export": do it with I5.

**Can wait:**

- T1 "rng/vec helper tests thin, bench has no threshold".
- T2 "skater with goalie attrs not rejected".
- T3 "no rest-snap for near-zero puck speed".
- T3 untested: net back-corner, -x post, puck dropping into the net after overNet.
- T4 "downed-skater test starts at rest".
- T4 "single pass does not fully resolve 3+ bodies".
- T4 "top speed overshoots the 2 m ease-off": revisit with I2, same function.
- T5b "hypot2 test range narrow".
- T5b "8 s faceoff cap path untested"; T9 "forced finish at 8 s cap untested": one test covers both.
- T5b "goalies jump ends at period start": the viewer can cut over the intermission.
- T6 "cycle rotation ignores carrier position".
- T6 "no tests for vision/poise effects".
- T6 "carrier targets skip board/net clamps".
- T7 "brain/actions aim at open side (affects tuning)".
- T7 "few tests beyond the brief's six".
- T8 "'touch cancels icing' test tautological"; "no test in period 2 / away offender".
- T8 "chase waypoint picked from puck side only"; "hold-up can send carrier backwards".
- T8 "dead icingWatch.fromX/tick, releasePuck only used by tests": delete when next in those files.
- T9 "b.cur flips at change start (toi share skew of seconds)".
- T9 "iced team's in-progress change still finishes".
- T10 "trigger() mutates cooldown state"; "contestTick default out=[] drops events": fold into I5.
- T10 "INTERCEPT speed floor duplicates PICKUP_MAX_SPEED".
- T11 "both sides get a supporter so +8 cancels in ~96%".
- T11 "trapped whistle only ~0.6/game".
- T11 "630 loose races/game": not re-measured.
- T11 "harnessSeed depends on test order".
- T12 "hit minClosing 7.5 means ordinary-speed hits never trigger".
- T12 "calibrate script imports from test/helpers, ms/game under 4 workers".
- T12 "decideCarrier long".
- T12 "snipers = power forwards in goals/60".
- T12 "'no freak scores' depends on runGames cache".
- T12 "stray whitespace + duplicated ruling comment in robustness.test.ts".
- T12 "goals 2.31 low in band": acceptable for 5-on-5; re-check after the C1 and I2 recalibration.
- T13 observed "~55 shots/game": 28 per team is on target.
- Carry to stage 2: rating spread against real win rates (76 v 66 gives .74/.12). Correctly deferred.
- T13 "overflow-x hidden", "vite.config cast", "draw.test covers labelFor only", "no box-score test", "Enter in seed field mid sim", "low-contrast numbers": the debug view is to be replaced.

**Drop** (already done; seen in the code unless noted):

- T3 "net-segment checks run everywhere": bounding box at `puck.ts:80`.
- T4 "separation can push a skater past boards": boards resolved after bodies, `game.ts:172`.
- Carry to T6 "pickup block into GameState".
- Carry to T7 and T5 minors: shot/goal pairing, goal counts a shot, on-ice ids for plus/minus.
- T6 "97% cap per option not per kind": per-kind cap at `brain.ts:155-159`.
- Carry to T8 "possession to the draw winner": `faceoff.ts:155`. "refereeTick guard on phase live": `referee.ts:69`. "goalie lastTouch id not in state.skaters": lookups are null-safe.
- Carry to T10 "interception chance": `tryIntercept`.
- T7 "touch chain has no time limit": assist window, `goalie.ts:355-361`.
- T7 "goalie.test dead duplicate describe blocks": not present now.
- T8 "icing called while delayed offside is running": `referee.ts:132-140`.
- T9 "no energy recovery during intermission": `game.ts:103`.
- Carry to T12 "hit momentum saturates the cap" and "trigger rates far too high": rescaled; landed share measured at 72%, hits 25.6 per team.
- T10 "side outcomes become certain at the cap": own clamped chances, `hit.ts:228`, `poke-check.ts:127`.
- T11 "puck stops dead at battle start": slides in. "slow carrier always pulled into a battle": protect stage with its own roll.
- T13 "Sim to end blocks ~3 s": chunked, `main.ts:149-164`. "skaters tiny on screen": fixed in the fix round.

## Declined to judge

- Penalties, power plays, pulled goalie, overtime, shootout, injuries, fights, scrums: step 2 and 3 scope.
- Whether a uniform 10-point better team should win .74: the spec gives no number; the controller ruled, and stage 2 calibrates.
- The 95 v 10 result (21-0 reported): ratings of 10 cannot occur in play; ruling accepted.
- Size of the per-game form (team jump sd 3, goalie night sd 0.2) and of score effects: a tuning choice the controller ruled on, except its effect on faceoffs (I6).
- Unused attributes (`fortitude`, `discipline`, `fighting`, `injuryProneness`), `shoots`, `heightCm`, `subType`: for later steps or the viewer.
- Goalie puck-handling and goalies leaving the crease: not in the step 1 list.
- The debug view's layout, colours and wording beyond the one mislabelled event: throwaway tool, replaced by the 3D viewer.
- `docs/superpowers/specs/notes-*.md` and `docs/prototype`: excluded by the brief.
- Watch-only physics, cameras, condensed viewing lengths: viewer work, not on this branch.
- Firefox and Safari determinism: no such runtime here. The C1 fix is runtime-independent by construction, but only Node and Chrome were checked.
- Realism of pass counts (about 1,070 per game) and line-change counts: no spec number and not in the box score.

## Assessment

**Ready to build on? With fixes.**

The engine is well built, pure, within budget and close to calibrated. But the 3D viewer would be built on a game that plays out differently in the browser than in Node (C1), cannot be resumed for seeking (I1), turns defencemen the wrong way (I2), and exposes an untyped contest and event interface (I5). C1 and I2 both change every result, so fix them first and recalibrate once, together with I4 and I6. I1, I3 and I5 do not change results and can follow in the same wave.
