# Final review: 3D viewer milestone 3 (actions and battles), 413f1ba..19f1f8e

Reviewed read-only at HEAD 19f1f8e (tree clean before and after). What I ran: `npm test` once, `npm run typecheck`, and throwaway probes under `scratchpad/final-m3/` (two whole games through the scene at 60 Hz, a seek-versus-play sweep, a save-timing probe, a highlight probe, a per-frame cost probe, and the built page `dist-single/index.html` in headless Chromium at 1280 px light and 390 px dark).

Verdict: **ready to build on, with fixes.** No Critical issue. Five Important ones; four are small and should be fixed now, one (the gait) should be scheduled before replays.

## Strengths

- Engine truth holds where it was ruled. Over two whole games (seeds 5 and 42, 487,000 frames): in live play every skater's drawn facing equals the engine's to 1e-15 from 0.45 s after a drop, the goalies' drawn turn is exactly 0, and no body is drawn more than 0.350 m from its engine place.
- The stopped-play exceptions are confined by phase checks rather than by timers alone: the goalie facing hold (`goalie.ts:526-547`) needs `stopped` or `faceoffSetup` and no faceoff since; the puck in the net (`scene.ts:409`) needs `stopped` at both ticks; the faceoff turn is exactly 0 from 0.4 s after the drop.
- No pose is ever shown for something the engine does not then do: every anticipation is keyed on a recorded event (`release`, `block`, `save`, `hit`, `contestStart`). A blocker cannot drop for a shot that is not taken; a receiver's ordinary presentation uses no look-ahead and fades when the pass is picked off.
- The camera tell before a goal is gone, with a test that removes the goal from the log and compares.
- Overlay progress is a function of ticks and the timeline almost everywhere, with fresh-start rebuilds for falls and contests that outlast the pre-roll.
- The page: a goal is unmistakable at both widths and in both schemes; no network requests, no storage, no console errors; Skip to end shows the final summary and Play restarts; a seek into a goal shows light, flash and tag, and a seek out clears them.
- Performance has headroom: Low quality measured 29 fps playing in software rendering; animation 0.97 ms and render submission 1.0 ms a frame; a settled seek 31 ms.
- The skating test page is removed with no dead references. Typecheck passes.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix before building on this)

**I1. A saved puck is drawn off the engine's puck in live play, which no ruling covers and no test sees.**
`overlays/goalie.ts:290-292` (hold starts at the plane crossing) and `:584-590` (a rebound leaves the part and rejoins); `carry.ts:194-201`; `scene-puck.test.ts:24-44`.
- Measured: on every save the drawn puck leaves the engine's puck from up to 2 ticks before the save's tick. On a rebound it rejoins only 3.5 ticks (0.12 s) after it. Worst 1.34 m (seed 5) and 1.51 m (seed 42); 284 and 365 live-play frames a game; up to 0.90 m at or after the save's tick, while the rebound is already moving.
- The ruled exception is "a puck held by a goalie drawn in his glove", limited to stopped play. This is the same mechanism leaking into live play. It looks right (the puck stops on the pad instead of passing through him to the goal line), so I would keep it, but it needs a ruling.
- The only exactness test (`when nobody carries the puck the drawn puck is the engine puck`) passes because its window, seed 5 ticks 1200 to 4800, contains no save at all: one goal and one block.
- Fix: rule it as a fifth exception with a stated bound (from the plane crossing until N ticks after the save, within X m). Add a whole-game test for both seeds that asserts exactness in live play outside those windows and the bound inside them. Correct the "one exception" comment in `carry.ts:197`. Engine round 2 adds rebounds in front, so this window will be exercised far more.

**I2. The "who came away with it" highlight lights under carriers who were in no battle.**
`puck-marker.ts:94-105`, used at `scene.ts:509`.
- `battleHighlight` fires for one second after any board or net-front `contestEnd` whenever anyone carries the puck. Net-front battles do not involve the puck.
- Measured on seed 5: of 130 net-front endings, 87 light the ring, 80 of them under a man who was not in the battle, 54 with the puck more than 6 m from the spot. Ten more come from `released` board battles. Confirmed in the built page (tick 10078, carrier 9.7 m away, Auto mode).
- Why it matters: on the default setting a ring flashes under the carrier about 90 times a game for no visible reason, and it claims something the engine did not do.
- Fix: light it only when the carrier is the `contestEnd` recipient (`puck: 'toWinner'`) or was a participant or supporter of that battle, and for net-front only when the puck is within `SCRUM_REACH` of the spot. Test with a net-front ending while a defenceman carries at the point.

**I3. Seek does not equal play because the gait is path-dependent and step-dependent; the ledger's diagnosis and its proposed fix are both wrong.**
`gait.ts:340-372` (phase and style are integrals with hysteresis), `animator.ts:55-59` (fresh gait starts at phase 0), `scene.ts:566-590`.
Measured over 24 live moments, 240 figures, against 20 s of play at 60 Hz (legs, worst joint, m):

| Compared with 60 Hz play | p50 | p90 | max |
|---|---|---|---|
| Seek, 1.5 s pre-roll at 1/30 (as shipped) | 0.059 | 0.414 | 0.644 |
| Seek, 1.5 s pre-roll at 1/60 | 0.057 | 0.385 | 0.642 |
| Seek, 6 s pre-roll at 1/60 | 0.018 | 0.319 | 0.698 |
| Seek, 20 s pre-roll at 1/60 | 0.000 | 0.004 | 0.318 |
| Play at 144 Hz | 0.023 | 0.259 | 0.611 |
| Play at 30 Hz | 0.017 | 0.291 | 0.573 |
| Play at 60 Hz started 50 s back instead of 20 s | 0.001 | 0.231 | 0.519 |

- Pre-rolling at the display step changes nothing. The cause is that the stride phase is integrated from wherever the gait last started afresh, and the style machine's dwell and break rules make it sensitive to step size.
- New finding: the picture also differs between display rates and playback speeds by the same amount, so `picture.test.ts` pins a 60 Hz picture only.
- Why it matters: replays are a seek followed by slow play. Several seek tests already bound overlay parts relative to the base's own difference (`battles.test.ts:311`, `:337`), which lets an overlay error ride on a large base difference.
- Fix: make the base gait part of the recording. Step each skater's gait once per engine tick at fixed `DT` during `record()`, store the gait states in each snapshot, restore and step them in `createCursor.place()` alongside the engine, and carry them on `Frame`. `poseSkater` then poses from the earlier tick's gait advanced by alpha; `stepSkater` steps overlay slots only. Seek, play, any display rate and any speed then give the same base, the pre-roll only rebuilds overlay slots, and the seek tests can go back to absolute bounds. A stored odometer alone is not enough: the 20 s and 50 s rows show the style history matters too.
- When: not a blocker for the engine round. Do it as the first viewer task before replays are built, ideally before the gait is retuned for the engine's new skating.

**I4. The root suite is over budget and still lacks a whole-game truth test.**
- My single run: engine 63.3 s, debug 0.7 s, viewer 101.2 s, about 165 s wall against the 150 s budget (the ledger's last figure was 148 s; I ran it once, on four cores).
- Heaviest viewer files: `stick.test.ts` 56.7 s, `contact.test.ts` 51.8 s, `scene-puck.test.ts` 37.3 s, `battles.test.ts` 33.6 s, `goalie.test.ts` 18.8 s, `scene-lines.test.ts` 15.2 s, `puck-marker.test.ts` 13.4 s.
- Four files each drive seed 5's first period at 60 Hz on their own (stick 27 s, contact and battles in `beforeAll`, goalie 6.6 s).
- Fix, as the engine does with calibration:
  - `npm test` stays fast: unit tests and event-sampled tests.
  - `npm run test:picture` holds the measurements: one shared whole-period pass collecting the stick, contact, battle and goalie bounds together; the puck no-jump test with the timeline only (the no-events variant is not what the page ships), 60 Hz for 120 s and 30 and 144 Hz for 30 s; the picture hashes; the seek sweeps; the marker period; and the new whole-game truth test from I1 (puck, facings, offsets).
  - The controller runs `test:picture` at every hand-back. Expect the viewer's fast suite near 40 s.
- Also trim `scene-lines.test.ts` (9.9 s scanning for one line change).

**I5. Several viewer assumptions will break or mislead when the engine changes; one duplicates an engine decision.**
- `battles.ts:153-158` `boardHow` re-derives the engine's `finish()` rule to show the kind of win during `resolve`. If the engine's rule changes, the viewer shows a result the engine does not then report. Fix now: read `ctx.timeline.contest(cid)?.end` (already recorded) during `resolve`.
- Engine constants copied into the viewer:
  - `contact.ts:66-67` body radius and mass; `:60-64` inverts `bodyDims`.
  - `contact.ts:151` `IMPACT_TICKS = 5`.
  - `stick.ts:115` `PICKUP_REACH = 0.9`.
  - `goalie.ts:131` `partFor` mimics the engine's choice of save pose.
  - `goalie.ts:522`, `reactions.ts:318`, `goal-show.ts:20-22` and `scene.ts:131` all assume a 1.5 s stoppage and a setup of at least 3 s.
- The 4 s camera hold after a goal is not tied to the next faceoff. With a shorter setup the camera would sit on the net during live play. Fix: end the hold at the next `faceoff` event from the timeline.
- `goalie.ts:198-204` assumes a shot runs straight from release to the goal line. Tips and deflections will send the reach to the wrong place; the existing path test will fail usefully.
- Tests that pin today's engine rather than viewer behaviour:
  - sample counts and windows: saves > 8, releases > 50, `touches < 5`, tick 1200 to 4800, ticks 3100 to 86000;
  - "seed 42 has a board battle at the period end";
  - shot-type counts in the first 40 shots;
  - hit power thirds; the fall-time margin 3.35 against 3;
  - 80% of dig frames;
  - the picture hashes.
- Fix: after the engine round, plan one re-baseline task that sorts failures into "sample missing" and "behaviour changed". Decide now how `picture.test.ts` is re-pinned when only the engine changed, since the "old hash holds with the additions off" rule cannot apply.

### Minor (Nice to Have)

- **Tells that are within the plan's wording but show the outcome early.** They matter more at replay speed.
  - `goalie.ts:275-281` with `beatenRaw`: on a goal the goalie's pose differs from a save's from the first frame of the reach, 0.15 to 0.3 s before the puck arrives (legs opening, hand coming from below). At 0.25x that is over a second. Suggest the same target for both until contact, arriving late on a goal.
  - `stick.ts:226-227`, `:590-592`: a receiver loads his stick for a one-timer up to about 0.3 s before he has the puck, which only happens on passes that connect.
  - `goalie.ts:272`: the goalie gets set only for shots that will reach him, not blocked ones (3 cm, negligible).
- **`scene.ts:131`, `:410`.** The puck-in-net window is "stopped within 120 ticks of a goal". Unreachable today, but only because of the engine's 1.5 s and 3 s constants. Tie it to "no faceoff since that goal"; `scene-puck.test.ts:37` repeats the same magic number.
- **`operator.ts:222`.** While the hold is on, an `ends` cut is suppressed too, so a goal on the last tick of a period would hold the camera on the net while everyone is moved. Rare; let `ends` always cut.
- **`contact.ts:479-486`, `battles.ts:758-827`, `battles.ts:866`.** Limiters write slot state from `apply`, and a weight reads `lim.lag` written by the previous frame's `apply`. It works because the scene poses every on-ice figure once a frame, including during the pre-roll. It breaks if anyone poses a figure twice at different times, or skips posing in the pre-roll as an optimisation. Say so at `seekScene` and on `Overlay.apply`.
- **Slots are mutated in place** (stick, contact, battle, goalie reach), so a `SkaterAnim` is not a snapshot and cannot be kept and resumed. Replays must go through `seekScene`. Document it on `SkaterAnim`.
- **Yielding between overlays is implicit**: registration order plus one-off rules (`give` for down, `pokeOverlay.weight` imported into battles, `otherContact`, `faceoffStickHold`). Sound today; each new action will need to touch several of them. Consider one shared "busy" record written by the trackers.
- **In the 0.4 s after a drop** the stick overlays aim in the engine-facing frame while the figure is drawn turned (`stick.ts:201-204`), so a shot or pass straight off the draw points off by the remaining turn.
- **Allocation.** About 0.4 MB a frame in Node (closures in `mixRawParts`, `copyRaw`, repeated `fitBody`), and 88 timeline lookups a frame of which 72 build a key string (`timeline.ts:79`). No effect on frame rate today.
- **`arena.ts:481`.** `getObjectByName` walks the arena twice a frame; keep the lamp references.
- **Tests that prove less than their titles.**
  - `puck-marker.test.ts:14-50`: the open-ice assertion recomputes the marker's own functions.
  - `stick.test.ts:152`: the "played" reference is itself a seek plus two seconds of play.
  - `battles.test.ts:311`, `:337`: bounds relative to the base (see I3).
- **Stale comments.**
  - `anim-context.ts:127` "Goalies are never drawn offset": the body pass moves a goalie up to 0.35 m in live play.
  - `battles.ts:34-36` against `:992`: cross-check as push versus shaft across the hips.
  - `carry.ts:197`: "the one exception".
  - `scene-seek.test.ts` and the ledger: the gait difference is not a step-size effect.

## Triage of ledger items

Task 1
- Per-frame copies of slots and `motionOfSample` allocations: can wait (revisit with I3).
- Crouch weight lingers 9.7 s: drop.
- `pruneStale` leaves orphaned temp files: drop.
- Viewer tests 24 to 29 s: fix now (I4).
- Broadcast lead swing 0.6 m under the cut threshold: can wait; count cuts when the director is built.
- `stepOperator` allocates a trail array per frame: drop.

Task 2
- `CARRIER_SPEED` loosened (now 16 in code): can wait.
- `stick.ts` imports `carry`: drop.
- Timeline key string per call: can wait.
- Seek-versus-play base difference: fix before replays (I3).
- Slapshot peaks at shoulder height: can wait.
- "Both hands" test loosened: can wait.
- Raised-stick tests in one body frame: drop.
- Contact hidden in the high broadcast view: can wait (director angle).
- Defencemen rarely shoot: engine round.
- Carry to Task 3 (hand moving 1.5 m in a frame): closed; the unfiltered whole-period bound passes with every overlay registered.

Task 3
- Ruling, goalies catch right: stands; engine round 2; flag to owner.
- Ruling, facing held in dead play: stands; verified confined.
- Chest-high goals through the torso: can wait.
- Celebration sticks look like rifles: can wait.
- Module-level scratch: drop (not re-entrant, not held across calls).
- "Back in stance" checked on few saves: can wait.
- Skaters' shooting side mirrored: can wait, but settle before the player card milestone.
- Caught puck edge-on: done in Task 6.
- Facing hold drops instantly at an intermission: drop.
- `deadFacingOf` runs twice a frame: drop.
- Celebration judged only at ice level: can wait.

Task 4
- Poke test exclusions: can wait.
- Two of six tests are guards: can wait.
- Heavy against light reads through pose, not size: can wait.
- Fall-time test margin thin: can wait; expect it to break in the engine round (I5).
- Light hitter's recoil modest: drop.
- Seek-versus-play in falls and for the hitter: fix with I3.
- Skater drawn 0.39 m inside his goalie: can wait; engine collision.
- Engine list (no skater-goalie collision, every landed hit downs, poke checker on the puck): engine round.

Task 5
- Ruling, winner target not chased: stands; re-run the blind test after the engine round.
- Seek transients near a role change: can wait; re-measure after I3.
- Net-front reads as a crowd; steep dig sticks: can wait.
- No period-break battle test: drop (it now exists).
- Mirroring untested for mixed shot pairs: can wait.
- Report overstatement: drop.
- Pin hard to pick in a four-man scrum or from the steep view: can wait.
- Net-front result judged from code only: can wait; look at one render.
- Stale comment `battles.ts:34-35`: fix now.
- Stick end over the board top: can wait.
- Stance bounds relative to the gait: fix with I3.
- NOTE, `contestEnd.winnerId` is the recipient: keep; carry into the broadcast plan, and see I2 and I5.

Task 6
- Ruling, puck eased into the net: stands; confined.
- Marker open-ice test circular: can wait.
- Held-puck tilt fixed to the broadcast side: can wait (director).
- Ring flashes under the goalie as the puck flies through: can wait.
- Coasting man faces the dot while striding: can wait.
- Unparenthesised `||` `&&` in `watch.ts`: drop (parenthesised now).
- Puck-in-net window not tied to its goal: fix now (one line).
- Heaviest tests: fix now (I4).

Process rulings (dispatch during re-review, re-pin rule, budget raised to 150 s): no action, except that the budget is exceeded (I4) and the re-pin rule needs an engine-change clause (I5).

## Declined to judge

- Goal marks on the time line show every goal before it is watched: milestone 2 design, already finally reviewed.
- Engine behaviour (breakaway passes, supporters taking won pucks, facing at setup, shot volume): out of scope; recorded in the engine notes.
- Whether the poses look like hockey to the owner (celebration sticks, net-front crowd, dig sticks): owner's judgement; task reviews covered the contact sheets.
- High quality frame rate and real GPUs: only Low in software rendering is a stated requirement.
- Browsers other than Chromium: the spec lists this as an open risk.
- `scripts/watch-shots.mjs` (834 lines): developer tooling, not shipped.
- The published artifact's sharing setting: the owner's own action.
- Director, replays, on-ice information, quality settings: milestone 4.
- Goalie catching hand and skater handedness against real players: ruled to engine round 2.
- A goal on the final tick of the game leaving the light and flash on at the end screen: could not occur in the two seeds; arguably correct.

## Assessment

**Ready to build on? With fixes.** The architecture is sound and the ruled exceptions are confined, but one live-play puck exception is unruled and untested, one default-on cue is wrong about 90 times a game, the suite is over budget, and one viewer rule duplicates an engine decision. Fix now: I1 (ruling plus whole-game test), I2, I4 (suite split), and from I5 the `boardHow` read, the hold tied to the faceoff, the net window and the stale comments. Schedule I3 (the gait in the recording) as the first viewer task before replays.
