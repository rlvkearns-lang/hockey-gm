# Final review: 3D viewer milestones 1 and 2 (`viewer-3d` vs `main`)

Reviewed 2026-11-23 at `fffbc66`. Read-only; nothing in the checkout was changed except this file.

**Verdict: ready to build on with fixes.** Nothing is wrong with what the picture says about the game. Four things should be fixed before milestone 3 starts, and the animation, puck and camera logic should be moved out of the three.js and page modules first, because milestone 3 rewrites exactly those parts.

## What was run

| Check | Result |
|---|---|
| Root `npm test` | 28 + 2 + 10 files pass (227 + 10 + 114 tests), 86.5 s wall (limit 120 s) |
| `npm run typecheck` | clean, 9.7 s |
| Same seed, same game | Seed 42: `simulateGame` gives 2-3, shots 42-39. The built page gives 2-3, 42-39, and still does after seeking 50000, 300, 90000, end |
| Network and storage | The single-file page makes one request (itself). No `localStorage`, `sessionStorage`, `indexedDB` or `Worker` in the bundle; one unused `fetch(` inside three.js |
| Memory | JS heap 26 MB with a game loaded, 27 MB after four more New games and three Low/High round trips. One canvas left in the page |
| Frame rate | 25 fps on Low in headless software rendering, 1280 wide, playing |
| Up-front simulation | 1.7 s in Chromium, 2.7 s in Node on this machine, on the main thread |

Probes are in `/tmp/claude-0/-home-user-hockey-gm/3ee2ba5d-ceac-5f4a-bbf8-ff6eedc912e9/scratchpad/final-viewer/` (`probeA.ts` to `probeE.ts`, `probeB.cjs`, `probeC.cjs`, screenshots).

## Strengths

- **The viewer decides nothing.** `playback.ts` is 94 lines: one up-front run, snapshots, `restoreGame` plus stepping. Positions, facings, score, clock and shots all come from engine state or the event log. A loose puck is drawn on the interpolated engine puck to 1e-9 (tested at 30, 60 and 144 Hz).
- **Line changes are clean.** A skater is drawn while on the ice at the earlier tick, extrapolated for his last tick, hidden otherwise, and gets a fresh gait when he steps on. Tested over 200 to 300 s of real play.
- **The pure maths is properly separated and tested** for the gait, carry, goalie poses and camera targets, with real continuity bounds.
- **Cheap to draw.** One kit shares geometries and materials across figures, parts are merged and vertex-coloured, the crowd is one mesh, shadow blobs use darkest-wins blending so they never stack.
- **The page fails safely on New game and on a quality change.** The new game is fully built before the old one is dropped, with a plain message otherwise.
- **Frame time is clamped** (0.1 s on the page, 0.25 s inside `stepGait` and `stepGoalie`), so a returning background tab cannot make the game jump.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix before building on this)

**I1. After any seek, every figure is drawn in the standing pose, including a man who is down.**
`scene.ts:208-214`, `gait.ts:411-417`.
A fresh gait starts as `stand` and the first `stepGait(..., 0)` records a blend *from* stand with `blendT = 0`, so the pose shown is 100% stand and fades to the real style over 0.35 s (0.65 s for a fall). Confirmed: a fresh gait at 7 m/s has `hipY` 0.845, identical to the standing pose; a fresh gait with `down: true` also has `hipY` 0.845. Screenshots `down-paused.png` (fallen #51 standing upright) against `down-played.png` (same tick reached by playing: sitting on the ice).
- Why it matters: paused scrubbing and the arrow keys show a rink of identical statues; every goal-mark jump starts with a morph. The plan's review focus asks that a seek shows the new time at once. Replays in milestone 4 are seeks, and a replay would not show the body motion that was shown live.
- Fix: on `reset()`, pre-roll. Seek about 1.5 s early and step the scene through at 1/30 s without drawing, then show. That settles gaits, goalie fades, the crouch and the carry blend together, and makes the pose at a given time nearly independent of how it was reached. Cheaper stopgap: when fresh, set the classified style with no `from`.

**I2. Engine teleports are interpolated, so the puck and the goalies streak across the ice.**
`scene.ts:241` (goalies), `scene.ts:322-323` and the last branch of `updatePuck` (puck).
The engine moves the puck to the faceoff dot in one tick at every stoppage (`faceoff.ts:77`) and swaps the goalies' ends in one tick at each period start (`game.ts:102-103`). The scene lerps across that tick. Measured: at the first period break the home goalie is drawn at x = 0.35 (centre ice) facing -1.57 at alpha 0.5; at three stoppages the puck was drawn 4.2 to 4.5 m from either end of an 8.4 to 9.0 m jump.
- Why it matters: a visible flash at every whistle (dozens a game), four frames long at 0.5x, and two goalies crossing centre ice at each period start. The camera also snaps on that same frame, to the half-way puck (`watch.ts:169-171`).
- Fix: treat such a tick as a cut. When `next.phase` becomes `faceoffSetup` from another phase, or `attackDir` changes, draw `prev` for the whole tick (or `next`), and start goalie gaits and the carry afresh. Add a test at a period break and at a whistle; the existing puck test skips non-live frames (`scene.test.ts:81`).

**I3. Without WebGL the page sits on "Simulating…" for ever with live-looking controls.**
`watch.ts:619` (`makeRenderer()` at module top level), `watch.ts:90`.
Run with `--disable-3d-apis`: two uncaught errors ("Error creating WebGL context", then `setPixelRatio` of undefined from the `ResizeObserver`), the loading text never changes, Play and New game stay enabled.
- Why it matters: the page is for a non-developer, and this is the one start-up failure with no message.
- Fix: wrap the first `makeRenderer()` in try/catch, show "This computer's browser cannot show 3D graphics…" in `#loading`, disable the controls, and do not start `newGame()`.

**I4. The up-front simulation runs on the main thread; the design says a background thread, and no ruling records the change.**
`playback.ts:26-50`, `watch.ts:468`.
1.7 s in Chromium here with the page frozen (the old game freezes too on New game).
- Why it matters: it is a stated design point, and milestone 4 adds a pre-game screen that should stay alive while the game is prepared.
- Fix: split `createPlayback` now into `record(setup) → { snapshots, events, result, totalTicks }` (plain data, can run in a worker) and `createCursor(setup, recording)`. Run `record` in an inlined worker with a main-thread fallback (a single-file page may be refused a worker). The split is the part to do before milestone 3; the worker can follow, but record a ruling either way.

**I5. The logic milestone 3 will rewrite lives in three.js and page modules, with no pure tests.** Restructure before adding to it:
- `scene.ts:189-237` (`updateSkater`) mixes sampling, gait stepping, the faceoff crouch (already an "action", hard-coded), posing, rig placement and the blade point, one figure at a time through shared scratch objects. Contests need two passes (place everyone, then pose figures that depend on each other). Make a pure `animator.ts`: per-skater animation state, `step(state, sample, context, dt) → SkaterPose`. The scene becomes sample → animator → rig.
- `gait.ts`: `RawPose`, `mixRaw` and `fit` are private. Actions are overlays on a skating base (upper body and stick over gait legs), and the pre-fit raw pose is the right place to mix them. Split gait.ts into the style machine, the key-pose generators and the body fit, and export the last two. Digging and poke checks also need "put the blade at this point" (solve the top hand from the blade); today the blade can only be aimed.
- `scene.ts:257-316` (`updatePuck`): the pick-up and release machine is pure maths inside the scene, tested only through 24 s of scene tests. A shot with a release moment replaces it. Move it into `carry.ts` first.
- `watch.ts:161-216` (`aimCamera`): the cut rules, follow anchoring and focus easing are a camera operator written against the DOM. The director needs exactly this. Move it to a pure module beside `cameras.ts`. `CUT_JUMP` (`watch.ts:42,189`) is a per-frame distance, so it depends on frame rate and playback speed; make it a speed.
- `watch.ts:136-149` (`indexEvents`): the start of an event timeline. The scene needs the log too (a wind-up must start before the `release` event; a save can start before the puck arrives), and `scene.update` gets none of it. Build one pure, tested `timeline.ts` for the HUD, the animator and the director.
- `watch.ts` is 622 lines with DOM lookups at import and no tests. Split it (renderer, game lifecycle, HUD, timeline, controls) before milestone 4 adds panels and screens.
- The 6 cm continuity bound is tested only on synthetic motion; the ledger records 8 to 10 cm on real games and nothing in the suite measures it. With a pure animator, add a real-game bound (pin it at today's value).

**I6. The skating test page is a second, untested integration of the same maths.**
`main.ts` (466 lines), `skating.html`, `moments.ts`, `scripts/shots.mjs`; and in `rig.ts` only for it: `handedMotion` (45-47), `createShadowBlob` (159-168), the private-kit and foot-shadow path, `createMarker` (599-636).
It has its own team colours (`main.ts:19`, different from `arena.ts:27`), its own motion blending (`main.ts:101` against `scene.ts:175`), its own crouch code, page scaffold and hook, and it never shows the carried puck. The owner has approved it and the approved copy is published separately.
- Fix: retire it now (delete the four files and the rig code only it uses), or freeze it in writing so milestone 3 does not have to keep it working. Keeping it alive doubles every gait interface change.

### Minor (Nice to Have)

- **M1. High quality leaks the shadow map on New game.** `scene.ts:336-351` disposes meshes only; the key light's 2048 x 2048 shadow target (`arena.ts:397-398`) is never freed while the renderer lives. By reading, not measured. Fix: dispose `light.shadow` for lights under `arena`.
- **M2. Seeks late in the game cost 20 to 33 ms**, 14 ms of it copying the event prefix into `restoreGame` (`playback.ts:63`). Restoring with `[]` took 0.4 ms and gave an identical state and identical later events over 3000 ticks. Pass `[]` and pin that with a test, and ask the engine to document it.
- **M3. Space on a focused button plays or pauses instead of pressing the button** (`watch.ts:565,571`). Confirmed: Space on "Overhead" started play and left the camera unchanged; Enter pressed it.
- **M4. The seed field accepts anything silently.** Empty and "abc" play seed 0, "3.7" plays seed 3, and the field keeps what was typed (`watch.ts:456`). Write the seed used back into the field. "1e400" gives the plain error message, correctly.
- **M5. `pointercancel` is not handled** (`watch.ts:558-559`): a cancelled touch leaves `scrubbing` true and the thumb stops following play.
- **M6. The pad-save side is read from the live puck each frame** (`scene.ts:243-245`). The `save` event's `pos` against the goalie's position gives the engine's own side.
- **M7. Duplication.** Team colours in three places (`arena.ts:27`, `main.ts:19`, `index.html:11`); `clamp`/`lerp`/`smooth`/`v3`/`add`/`sub` in six files; `twoBone` lives in `goalie-pose.ts` and is imported by `rig.ts:7` (the comment at `goalie-pose.ts:99` is stale); `scene.ts:175` re-implements `gait.motionOf` plus `handedMotion`.
- **M8. The boards carry no team colours** (`rink.ts:202-205`), which the design's arena line asks for. Benches and crest do.
- **M9. Tests.** `scene.test.ts` takes 24.6 s of the viewer's 25.6 s and builds on one shared playback; `playback.test.ts` builds five games (12.6 s). 33 s of margin is left under the 120 s limit, so share one recorded game. `scene.test.ts:101` logs to the console. No test plays to the end after seeks and compares the final state's score with `result`. The shared-texture dispose test (`scene.test.ts:211`) cannot fail in Node.
- **M10. A `structuredClone` of the whole state per tick while playing** (`playback.ts:66`): 0.13 ms a tick here. It is the largest allocation in the update path; the small pose objects the ledger lists are much less.

## Engine issues seen in 3D: diagnosis checked against the source

**Busy movement and short sprints: the effect is real, the stated cause is partly wrong.**
- Only the puck carrier decides every 0.2 s (`brain.ts:192`, `BRAIN_INTERVAL_TICKS = 6`). Every other skater is retargeted **every tick**: `assignJobs` runs each live tick (`game.ts:275`) and shape targets are puck-relative (`team-play.ts:160-220`). Measured over 40,000 ticks of seed 42: the target moved on 40.6% of skater-ticks (a 0.2 s interval could give at most 16.7%) and jumped more than 1 m on 3.9%, about once a second per skater. Team phase flips with no hysteresis.
- Speed: `wantAlong = topSpeed * cap * arrive * align` (`skating.ts`, `stepSkater`), applied at full acceleration in both directions. There is no coasting: easing off is braking as hard as he can accelerate.
- Measured: skaters are above 93% of top speed 9.6% of the time, in runs of median 0.60 s (p90 2.0 s). The runs ended on a job speed cap below 0.93 (42%; most jobs set 0.8 to 0.9, so those skaters can never sprint), on the 2 m arrive radius (33%), and on the target swinging off his facing (24%).
- Engine round 2 should: hold a job and its target for a while (hysteresis on team phase; re-issue a target only when it has moved enough or after a minimum time); stop easing off toward a target that is itself moving; turn by carving rather than cutting speed by the cosine; separate coasting (gentle) from braking (hard); and review the role speed caps. All of this changes results and needs a re-tune.

**Carry spot: confirmed.** `CARRY_REACH = 0.6` along his facing (`game.ts:41, 221-222`); a pick-up snaps the puck there from up to 0.9 m away (`carryPuck` in `tryPickup`). The viewer's blade point is about 0.95 m ahead and 0.5 m to his forehand. Round 2: put the carry spot on the blade (forward and to his `shoots` side), and re-tune pokes, shot origins and the net clipping.

**Goalie: partly corrected.** The engine does have a catching side, hard-coded: the glove is on his left (`goalie.ts:236-241`); passing `'L'` matches it. `PlayerDef.shoots` exists for goalies and is ignored. The pad side is decided in the engine (`goalie.ts:331`) but not stored; the `save` event carries only `pose`, with `pos` the puck's place on arrival and no height. Round 2: read the catching hand from the player, and add to `save` and `goal` where the puck crossed (offset from the goalie and height), so the viewer can put the glove on the puck.

## Triage of ledger items

Milestone 2 ledger:
- T2: interruption test divides the glove jump by 3 — can wait (rewrite with milestone 3's saves).
- T2: `GoalieInput.speed` unused — drop.
- T2: cover shadow stays under the pads — can wait.
- T2: goalie stick blade points toward the glove side — can wait (milestone 3 goalie pass).
- T2: dispose leaves the shared-texture question open — drop (two page-lifetime textures; heap flat).
- T1: `strideEnter` 2.0 to 1.8 — drop.
- T1: `poseOf` ignores `opts.hasPuck` once `g.puck` is set — drop (goes away with I5).
- T1: real-game frames of 8 to 10 cm — fix now: put a real-game bound in the suite (I5).
- T1: `moments.ts` counts sprint runs of 0.5 s — drop with I6.
- T1: fast loose puck lags on its first carried frame — drop.
- T3: small per-frame allocations — can wait (software fps is renderer-bound; see M10).
- T3: shared-texture dispose test proves nothing in Node — drop the test.
- T3: a pass from behind eases through the receiver's body — can wait (milestone 3 reception).
- T3: antialias off on Low — done, drop.
- T4: puck hard to spot on a red line or the crest — can wait for the owner's eye on a real screen.
- T4: ice level shows boards across the left third — can wait (the director will avoid it).
- T4: net cameras long and low when play is far — can wait.
- T4: phone score bug covers almost half the width — can wait (milestone 4 on-screen information).
- T4: key handler with no game after a failed rebuild — drop: `watch.ts:564` returns when `game` is null.
- T4: High about 7 fps in software — can wait, but measure on real hardware before milestone 4.
- Ruling, T1 and T2 dispatched together — drop (process).
- Ruling, sprint held while speed stays high — keep; consistent with the engine having no coasting.
- Ruling, T4 builder may edit `arena.ts` and `scene.ts` — done, drop.
- Carry, busy movement and short sprints — keep for engine round 2, with the corrected cause above.
- Carry, carry spot on the blade — keep for engine round 2, confirmed.

Milestone 1 file:
- `vite.config` `defineConfig` cast — drop.
- `advance()` has no max-step guard — drop (the loop clamps to 0.1 s; the gaits clamp to 0.25 s).
- Restored games never drain events; events prefix copied on every restore — fix now (M2).
- Snapshot memory unmeasured — drop: measured, 26 MB heap for the whole page.
- Blend moves of 6 to 8 cm under rapid interrupts; real-game worst frame 8 cm — fix now as the real-game test (I5).
- Crossover holds with no acceleration condition; crossover after a slow shove — can wait.
- `hipRoll` sign flips at hip height — drop.
- `shots.mjs` profile camera and crops; moments scanner uses unmirrored gait; skates pass over markers; screenshot camera behind a net — drop with I6.
- Arm pole ignores twist — can wait (milestone 3 arm work).
- `overflow-x: hidden` on body — can wait.
- `#loading` colour hard-coded — drop (the watch page uses tokens).
- `devicePixelRatio` change unhandled — can wait.
- `setControls(true)` re-enables every control — fixed in `watch.ts:359-363`, drop.
- `lerp3` used above its definition (`gait.ts:504` against `819`) — can wait; fix when gait.ts is split.
- Stick 0.77 of height — drop.
- Ruling, eager seek — keep. Ruling, one final review for both milestones — this document.

## Declined to judge

- How good the skating, sprint and goalie poses look: the owner's call, and he approved the skating.
- Arena looks, the camera framing residuals the builder listed, and puck findability by eye: need a real screen and the owner.
- Frame rate on real hardware: only software rendering was available.
- Browsers other than Chromium: the design already lists this as unchecked.
- The one-tick intermission (no pause at a period break): engine behaviour; the intermission screen is milestone 4.
- Director, replays, names on the ice, stats panel, pre- and post-game screens, player card: later milestones.
- No in-page light/dark switch: the plan asks only for the colour tokens, which are there.
- Touch gestures on a phone beyond layout: the plan asks only for no horizontal scroll.
- Engine correctness beyond the three reported items: already reviewed and merged.
- The internals of `watch-shots.mjs` and `shots.mjs`: tooling, not shipped.
- WebGL context loss while paused, and the overhead camera cutting on shots at 4x: read in the code, not reproduced.
- The published artifact links: outside the checkout.

## Assessment

**Ready to build on? With fixes.** The picture is faithful to the engine and the pure maths is sound, so nothing needs redoing. Fix I1 to I3 and decide I4 and I6 first, then do the I5 restructure as the opening task of milestone 3, since that milestone would otherwise be written into `scene.ts` and `watch.ts` where it cannot be unit-tested.
