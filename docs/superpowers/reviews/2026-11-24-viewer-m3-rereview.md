# Final re-review: milestone 3 fix wave (9154a78..19ccaf2)

Scoped re-review of the final-review fixes (I1, I2, I4, I5 quick fixes, the goalie tell) and the owner's camera feedback. Read-only at HEAD 19ccaf2; tree clean before and after. I read the final review, the fix report and the whole diff, and ran one probe (`scratchpad/rereview/cam.probe.ts`, through the viewer's own global setup: every camera over seed 5's first period at 60 Hz from the recorded paths, measuring what `operator.test.ts` does not: the camera's place, its zoom, and its speed during a goal's hold). I did not run either suite. I looked at all eleven contact sheets in `scratchpad/m3-shots/final-fix/`.

**Verdict: ISSUES.** I1, I2, I4, I5 and the goalie tell are fixed, and their tests are real. The camera rework does most of what was asked, but two Important problems remain on the broadcast camera, which is the default: its platform still travels and zooms on every board battle, and play in an end zone sits small in a corner of the picture.

## Spec Compliance

- ❌ Issues found: the broadcast camera is a fixed platform only when no board battle is on (Important 1); its framing of end-zone play is hard to read (Important 2).
- ✅ Saved-puck ruling, highlight ruling, test split, I5 items, goalie tell: compliant.
- ⚠️ Cannot verify from the diff: the claim that the collectors in `test/collect-period.ts` reproduce the four old whole-period passes line for line. Every old assertion is present unchanged in `overlays/period.picture.test.ts` (checked mechanically, see I4), and goalies are now animated in the shared pass, which only adds work. I did not diff the collector bodies against the deleted helpers.

## Item by item

### I1 — saved puck in live play: **fixed**
- The hold now opens at the plane crossing: `overlays/goalie.ts:312` (`now >= tc - 1`, gated in `heldBy` by the drawn hand's face for glove and blocker; pads and butterfly only from `tc`). The bounds are constants at `overlays/goalie.ts:56`, and a hard 1.6 m clamp in live play is at `scene.ts:483-487`. The comment in `carry.ts` is corrected.
- The test is real and not vacuous. `test/truth.ts` plays a whole game at 60 Hz with the timeline. Every live loose-puck frame off the engine's by more than 1e-9 m is assigned to a save looked up from `floor(now)+3` back 10 ticks (`test/truth.ts:80`). With no save, it counts as `outside`. More than 6 ticks after the save it counts as `late`. Before the plane, measured along the engine's own flight with 5 cm slack (`:88-107`), it counts as `early`. The bound checks are `far <= 1.6` and `saves > 20`. Exactness is checked over the whole game, not a window, so it covers the 45 and 55 saves the review found missing. It also asserts skater facing (< 1e-9 from 0.45 s after a drop), goalie turn exactly 0 in live play (`:131`), and every drawn place ≤ 0.35 m. Both seeds are covered (`truth-5.picture.test.ts`, `truth-42.picture.test.ts`). The reported RED (14 early frames per seed) fits the old `min(tc, T-1)` opening.
- The seed 42 picture hash was re-pinned. The fix report explains it: one puck frame changed by 2.5 mm, as the ruling requires, and every figure is unchanged.

### I2 — highlight ring: **fixed**
- `puck-marker.ts:101-115` `cameAwayWith` lights the ring for the `toWinner` recipient, for a `contestStart` participant, or for a board-battle supporter. A net-front battle lights it only within `SCRUM_REACH` of the spot. `battleHighlight` walks back to the latest qualifying ending.
- The tests are real. The fast test (`puck-marker.test.ts:161`) is independent of the new code: a defenceman not in the battle, ≥ SCRUM_REACH+3 m from the spot, and in no other battle that ended in the last second. It asserts 0 from the function and in the scene, and it lit at 0.74 on the old code. The whole-game picture test uses an independent oracle: the engine's own `contests[].participants` collected from every state, not cooldowns. Counts went from 87 lit net-front endings to 7.
- Supporters are inferred from `state.contestCooldowns`. This is a new reliance on engine internals (Minor 3). I checked it against the engine: `contests/board-battle.ts:269,368` set one cooldown on every participant at the end, and `tuning.ts:275` sets 2.5 s, longer than the 1 s highlight. It holds today.

### I4 — suite split: **fixed**
- `vite.config.ts` excludes `PICTURE_TESTS`. `vitest.picture.config.ts` and the root `test:picture` script exist.
- No assertion was weakened in the move. I compared every removed `expect` line against the added ones. Each one reappears verbatim, apart from the variable rename `stats`→`battles`/`contact`, with these exceptions:
  - The two allowed trims, both listed in the report: the no-events puck variant is dropped, and the release floor at 30 and 144 Hz goes from `> 20` to `> 5` for 30 s runs. The 60 Hz/120 s run keeps `> 20` and every movement bound (`scene-puck.picture.test.ts:533-541` in the diff).
  - The five camera assertions changed for the redesign, all listed in the report.
- One existing scene assertion changed meaning: "1 under any carrier" became "0 under a stranger". That is the behaviour I2 asks for, and it is listed.
- The reported root time is 99.9 s, within the 110 s target, but 95–127 s across runs, with the engine part varying (Minor 7).

### I5 — quick fixes: **fixed**
- `boardHow` reads `timeline.contest(cid).end.detail.result` (`overlays/battles.ts:157`). The test (`battles.test.ts`, "during the resolve…") gives the same roles three different logged results and gets each one back, so it would fail on the old role-derived rule.
- The goal hold ends by the next `faceoff` (`goal-show.ts:80-93`). The test uses a drop 2 s after the goal and a 5 s control.
- `ends` always cuts (`operator.ts:208`). The test cuts on `ends` during a hold and does not cut on `restart`.
- `lastSinceDrop` (`timeline.ts`) replaces the fixed spans in `scene.ts:411`, `overlays/goalie.ts:553-554` (`DEAD_TICKS` gone) and `reactions.ts` (the celebration fades by 0.5 s before the drop). It has a unit test with a period-end boundary. `scene-puck.picture.test.ts` uses the same rule, so the magic 120 is gone.
- The stale comments and the new invariants (`Overlay.apply`, `seekScene`, `SkaterAnim`) are in place.

### Minor from the review — goalie tell: **fixed**
- `overlays/goalie.ts:295` and `applyPlan`: a goal uses the save's `placed()` target and timing, and blends to `beatenRaw` only from `tc - 1`.
- The test is real (`overlays/goalie.test.ts:164-190`). For every goal with a release, in both seeds, it animates the goalie twice: once with the real timeline, once with that goal event replaced by a `save` with the locked part, so the timeline really is modified (`rec.events.map(e => e === goal ? save : e)`). It asserts deep equality of the full pose (`toEqual`) from 1.5 s before the release to one tick before the save version's contact. It also asserts that the comparison reaches into the reach (`reaching`) and covers ≥ 60 frames per goal. RED on the old code at 1391.5.

### Cameras: **partly fixed**
- The look point is much calmer. Broadcast p50 speed went from 3.7 to 1.6 m/s, acceleration p99 from 199 to 30, pan reversals from 51 to 12 a minute. Overhead never turns. Whole-rink overhead never moves. Buttons and keys 1–7 work (`index.html`, `controls.ts`). Per-camera limits are asserted in `operator.test.ts`, and puck-in-frame for broadcast is ≥ 99%.
- What the measurements leave out: `test/camera-run.ts:101-104` measures only the look point. Platform travel and zoom are not measured or asserted, and that is where Important 1 hides.

### Contact sheets, plainly
- `play-10s-broadcast.png`: calm. The frame is identical for frames 5–15 while the play moves inside it, then pans smoothly twice. Height and tilt are steady. Play is readable in the neutral zone and at the blue line.
- `save-rebound-broadcast.png`, `netfront-end-carrier-at-point.png`: calm, but play in the end zone is hard to read. The net and the players sit in the upper part of the picture, figures are small, and the lower right third to half is the corner boards and the stands. See Important 2.
- `play-10s-overhead.png`: calm. One slow slide to the offensive zone, held for about 6 s, one slide back, never turned. Readable as a tactical view, though figures are small marks.
- `play-10s-overheadWide.png`: perfectly still, the whole rink. Figures are dots, as expected for that angle.

## Strengths

- Truth is now proved over whole games instead of a convenient window. The truth harness checks puck, facing, goalie turn and place in one pass, at the precision of the rulings (1e-9).
- The goalie-tell test is the right shape: a counterfactual timeline compared pose for pose. It would catch any future look-ahead on goals.
- The highlight's picture test uses an oracle independent of the implementation (engine contest participants, not cooldowns).
- The viewer still decides nothing. `boardHow` reads the log instead of copying the engine's rule, and every new rule keys off recorded events or the frame's engine state. Seek and play stay equal for everything new: `battleHighlight` is a function of time, timeline and the frame's state, the save hold of the timeline and the drawn goalie pose, and operator state is reset by every seek. Nothing new breaks determinism beyond I3.
- `limitedMove` brakes in time and never overshoots, and the tests assert this.

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)

**1. The broadcast camera still travels and zooms on every board battle, so it is a fixed platform only part of the time.** `cameras.ts:145-146` (with `BATTLE_VIEW`, `:97`), `operator.ts:44` (`pos` limit 6 m/s), `operator.ts:117` (`BATTLE_EASE` 1.2 s).
- What happens: on a board battle the broadcast pose slides its platform along the rail to the battle's x, rises 3 m and comes 6.5 m closer on the near boards, and zooms 2.3x. The page feeds the nearest battle (`watch.ts:127`).
- Probe on seed 5, period 1, 60 Hz: the broadcast platform moves in 19.1% of frames, up to 20.4 m from its centre-ice spot (p95 6 m/s), and its field of view changes in 26.9% of frames. A board battle is under way in 6.2% of frames, and the 1.2 s ease plus the 6 m/s platform limit stretch each one into several seconds of travel. That is about 150 board battles a game.
- The owner said "broadcast moves too much", and the ruling is a fixed-platform TV camera with zoom only for real events. `operator.test.ts:249` asserts "it turns, it does not travel" only on a run with no battle. `camera-run.ts` never measures the platform or the zoom, so the 99%/speed/reversal limits do not see this.
- Fix: keep the platform fixed and show the battle by turning and (if a board battle is ruled a real event) zooming only. Drop the slide, rise and closer moves, or ask the controller whether battles are a ruled exception. Add platform-travel and zoom-change measures to `camera-run.ts`, with limits in `operator.test.ts`: platform 0 m for broadcast, and a bound on frames with a zoom change.

**2. On the default camera, end-zone play is small and pushed into a corner of the picture.** `cameras.ts:91` (`maxLook: 21`, `nearBias: 4.5`, steady tilt), together with the dead zone `turn: 0.4` at `operator.ts:44`.
- Seen in `save-rebound-broadcast.png` and `netfront-end-carrier-at-point.png`. The look point stops 5–6 m short of the goal line. The tilt is fixed 4.5 m toward the near side. The play may sit 40% of the half-width off centre before the camera turns.
- Net-front and far-boards play therefore ends up in the upper part of the frame, near the right edge. Much of the lower right of the picture is corner boards and stands. A large share of a game is played there, and the owner will see it ("camera angles are a bit wonky").
- The ruling limits zoom, not tilt or pan reach. Within it, the fix is:
  - let the look reach the net (maxLook near the goal line);
  - let the tilt follow the play across the ice with its own dead zone and slow limit, as the pan already does;
  - narrow the turn dead zone near the ends.
- Assert a framing measure: the share of live end-zone frames with the puck in the middle 60% of the picture.

### Minor (Nice to Have)

1. **A quick swing at every goal.** `operator.ts:57,274` (`HOLD_QUICK` 10). The probe measured look speed during holds up to 62 m/s for broadcast and 49–55 m/s for the net and ice-level cameras, against an ordinary p99 of 13.6–17. A goal is a real event and the swing lasts a fraction of a second, but it is the one jerky moment left in a calm camera. A cut to the net, which a director would make, is calmer. That needs the existing "no cut during the hold" test changed, which is a controller decision because it alters an existing assertion.
2. **The overhead camera loses the puck on clears and long passes.** `operator.ts:53` (`ZONE_DWELL` 1 s). Puck in picture is 97.7% of live frames, about 2% of a game with the puck off screen. Change zone without waiting (still sliding) once the puck has left the picture, and keep the dwell for play near a blue line.
3. **New reliance on engine internals for supporters.** `puck-marker.ts:101-115` infers who was in a board battle from `contestCooldowns` having equal `untilTick`. It is correct today (`board-battle.ts:269,368`; 2.5 s cooldown). It breaks silently if the engine changes cooldown handling, and in theory it could match a man from a different battle that ended on the same tick. Ask in the engine round for `contestEnd` to carry the final participants, and read those.
4. **The beaten blend lasts one tick.** `overlays/goalie.ts:60,295`. The part moves from the save target to `beatenRaw` (0.42 m short, 0.55 m on a pad) within 33 ms, two frames at 60 Hz. It is under the 0.4 m/frame bound in the measured period, but it can read as a snap at 0.25x replay. Revisit with replays; a slightly longer blend that starts at contact keeps the no-tell property.
5. **Ice level and the behind-net cameras still zoom continuously** (field of view changes in 78–82% of frames, from `fovFor` with distance), and they keep the puck in picture less often (95%, 97%). They are calmer than before, but "calm" for these was asserted only on the look point.
6. **Part of a scene test checks the code against itself.** `puck-marker.test.ts:49` decides which carriers should get 0 by calling `cameAwayWith`, the function under test. It is harmless because the fast net-front test and the picture oracle are independent, but this branch proves nothing.
7. **Suite time is near the limit.** Root 95–127 s across the fixer's runs against the 110 s target, mostly from engine variance. The viewer's fast suite, 38–47 s, is on target.

## Fixer's concerns, weighed

- Puck in frame on the other cameras (97%, 95%, 97.7%): acceptable for those angles. The overhead one has a cheap fix (Minor 2).
- Fast swing at a goal: see Minor 1. It is noticeable but brief, on a real event. Calmer to cut.
- Broadcast small at the far end: worse than "small". The play is also off-centre in the frame. Important 2, fixable within the ruling.
- Supporters through cooldowns: Minor 3.
- Root suite time: Minor 7.

## Assessment

**Task quality:** Needs fixes
**Reasoning:** Every review item is fixed with tests that fail on the old code, and nothing new decides for the engine or breaks seek and play. But the default camera still moves its platform and zoom on every board battle, unmeasured by the new camera tests, and end-zone play reads poorly. Those two are what the owner complained about.
