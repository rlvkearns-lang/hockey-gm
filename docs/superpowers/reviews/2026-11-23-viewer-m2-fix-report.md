# Final review fixes: report

Branch `viewer-3d`, workspace `apps/viewer`. Nothing under `packages/engine` changed. Scope as ruled: I1, I2, I3, I4, M1 to M6 and M9, the real-game continuity test from I5, and the freeze note for I6. I5's restructure, M7, M8 and M10 were not touched.

## Commits

- `34673db` feat: a game recording as plain data, a cursor over it, and engine cuts found while recording
- `03dc497` fix: a seek shows every figure as play would have; engine teleports drawn as cuts
- `7d5a170` fix: the game is played in a background thread; a plain message without WebGL; safer controls
- `413f1ba` docs: the skating test page is frozen

## Per item

### I1: statues after a seek (pre-roll)
- **What changed.** `scene.ts` has a new `seekScene(pb, sc, tick, preroll = PREROLL_SECONDS)`. It seeks the playback `PREROLL_SECONDS` (1.5 s) early, but never before the game's start or before the latest engine cut at or before the target (`lastCutAtOrBefore(pb.cuts, …)`). It resets the scene, steps it through to the target at `PREROLL_STEP` (1/30 s) without drawing, and lands exactly on the target tick. A fresh gait now starts in the style its motion shows, with no blend in from `stand` (`freshGait`: `stepGait(initialGait(), m, 0)` with `from`, `blendT` and `blendDur` removed). That covers a skater stepping on and a figure restarted at a cut. `FigureView` gains `hipY` and `pose` (a skater's drawn body-frame pose) for tests and the hook.
- **The watch page** (`watch.ts`). `seekTo(tick, settle = true)` uses `seekScene`. The pre-roll runs on goal-mark jumps, the arrow keys, Skip to end, the quality rebuild, a new game, the time bar's own keys, and the end of a drag.
- **Dragging: what I chose.** A pre-rolled seek measured 18 to 41 ms in headless Chromium (one cold first seek took 78 ms), against 1 to 5 ms for a plain seek. Running the pre-roll on every pointer move would lag the drag. While the time bar is dragged, each step is a plain seek (figures already shown in their real style, not standing). 150 ms after the pointer stops (`SCRUB_SETTLE_MS`), and again on `pointerup` or `pointercancel`, the moment is played in.
- **Tests** (`scene-seek.test.ts`):
  - After a seek to a man who has been down a while, his hip is below 0.5 m. Standing is 0.85 m.
  - After a seek into a rush (carrier over 7 m/s who has held the puck through the whole pre-roll), his pose is more than 10 cm from the standing pose in some foot, hand or hip, and the drawn puck is within 2 cm of the blade of the pose drawn.
  - Seek against play. The pose at a tick reached by seeking is compared with the same tick reached by 10 s of play at 60 Hz, at 7 ticks across the game (69 figures). **Bound:** hip height differs by under 4 cm for 90% of figures (measured 2.9 cm), worst under 16 cm (measured 12.8 cm); lean (pitch) under 0.1 rad for 90% (measured 0.076); at least 75% agree on both hip within 3 cm and pitch within 0.05 (measured 84%). What is left is the stride's phase (which foot is pushing, and with it the pelvis's rise and fall). That is the gait's own clock, which no engine state sets. A 3 s pre-roll gives 91% agreement and 6 s gives 93%, so no pre-roll pins it.
- **RED** (the new tests against the old scene, with a shim `seekScene` doing the old reset-and-update): down hip 0.858 (want < 0.5); rush carrier 0.2 cm from standing (want > 10 cm); seek against play, hip 90th percentile 4.9 cm (want < 4). GREEN after the change.

### I2: engine teleports drawn as cuts
- **New pure module** `cuts.ts`: `probeOf`, `isCut`, `puckJumped`, `goalieJumped`, `skaterJumped`, `jumped`, `lastCutAtOrBefore`. A cut is any of:
  - the phase becoming `faceoffSetup` from another phase;
  - `attackDir.home` changing;
  - the puck moving faster than 60 m/s, or a goalie or on-ice skater faster than 20 m/s, plus 0.3 m of slack, over the ticks between the two states. This defensive check works across any gap, so a frame that skips ticks at 4x still sees the cut.
- **The recording** (`record`) lists cut ticks (`Recording.cuts`, `Playback.cuts`). Seed 5 has 54.
- **The scene.** A tick whose two sides are a cut is drawn as its earlier side for the whole tick, with `next = prev`, so skaters run on along their velocity for that one tick. On the first update whose earlier tick lies across a cut from the last one drawn, whatever jumped starts afresh: the carry (`puckFresh`), the goalie gait of a goalie who jumped, and the gait of a skater who jumped. `cutNow()` is true on exactly that update. `watch.ts` `aimCamera` now cuts on `gs.cutNow()` in place of its own phase and attackDir check, which read `next` one tick early and snapped to the half-way puck.
- **Tests.** `cuts.test.ts` (4 tests) covers the pure rules. `scene-seek.test.ts` plays across a period break and a whistle (puck re-spotted more than 4 m away) at 8 frames a tick. In the two ticks either side, every drawn goalie and puck is within 0.3 m of its old or new place, and the cut frame is exactly the first frame of the cut tick. RED on the old scene: period break goalie drawn 26.7 m from both places; whistle puck drawn 13.6 m from both.
- `playback.test.ts`: every recorded cut is a restart, a change of ends or a teleport, and every period start is among them.
- **One existing test helper adjusted, assertion unchanged.** `scene-puck.test.ts` (the moved puck test) asserts `exact === true`: a loose puck is drawn exactly on the engine's puck. Its reference point was the lerp of the two ticks, which across a cut is the half-way streak this item removes. The reference now uses the earlier tick across a cut tick, where the engine has no puck between its two places. The assertion and its bounds are unchanged.

### I3: no WebGL
- `watch.ts`: `start()` first checks `canShow3d()`, a throwaway WebGL2 context that is released at once. It then wraps `makeRenderer()` in try/catch.
- Either failure shows this in `#loading`: "This computer's browser cannot show 3D graphics, so the game cannot be shown here. Try another browser, or turn on "hardware acceleration" in this browser's settings." It then disables every control and does not start a game.
- `renderer` is nullable; `fit()`, the loop and the hook check for it.
- **Context loss.** `webglcontextlost` pauses play and shows "The picture was interrupted by the computer's graphics. Waiting for it to come back…". `webglcontextrestored` clears the message and redraws. Canvases retired by a quality change are ignored, since `forceContextLoss` fires the same event.
- **Checked in Chromium.** With `--disable-3d-apis` the message shows, no control is enabled, and there are no page errors and no console errors (`no-webgl.png`). With `WEBGL_lose_context`: the message during loss, play paused; after restore the message has gone and play runs at 29.5 fps.

### I4: simulation off the main thread
- **The split** (`playback.ts`):
  - `record(setup, opts)` returns `Recording = { every, snapshots, events, result, totalTicks, cuts }`, all plain data.
  - `createCursor(setup, recording)` returns a `Playback`.
  - `createPlayback(setup, opts)` is `createCursor(setup, record(setup, opts))`, so `main.ts` and every existing caller are unchanged.
  - A test shows a JSON round trip of a recording plays the same.
- **The worker.**
  - `record-game.ts`: `recordGame(setup, { makeWorker })` runs `record` in the worker. It falls back to the main thread if the worker cannot be made, errors, or sends nothing usable, and returns `{ recording, where, ms, workerProblem? }`.
  - `record.worker.ts` is the worker. `watch.ts` imports it as `./record.worker?worker&inline`, so it is base64-inlined in the single file and started from a `blob:` URL.
  - `record-game.test.ts` covers the success path and six fallback paths with stand-in workers.
- **New game.** The old game keeps playing and stays usable while the new one is played. Only Seed and New game are disabled, and a quiet line says "Preparing a new game (seed 7)… This one keeps going until it is ready." The swap happens only when everything is built. A quality change is refused while a game is being prepared.
- **Did the worker run, and how long did it take?** Yes, from the single file (`file://`) in headless Chromium: "simulated in worker 2368 ms" on first load and 2644 ms on a New game. During that New game the old game advanced 76 ticks (2.5 s of game time) and the page drew 53 frames in 3.2 s. The longest frame was 323 ms, which is the swap: receiving the 14.6 MB recording, building the scene and the pre-rolled seek to 0. With `Worker` replaced by a throwing stub: "simulated in main 2311 ms", same score 2-3, no errors. For reference, the up-front run took 1.7 s on the main thread at review time.
- **Single file.** `dist-single/index.html` is one file, 797 kB (it now carries the engine twice, once for the worker). Requests seen: the page itself and two `blob:null/…` worker URLs created in the page, so no network. No console errors.

### M1: shadow map
- `scene.ts` `dispose()` calls `light.shadow.dispose()` for every light under the rink and the arena.
- **Test.** Replaces the dropped shared-texture test: a high-quality scene's shadow-casting lights each get a stand-in `WebGLRenderTarget`, and `dispose()` fires its `dispose` event.

### M2: restore with an empty event log
- `createCursor` restores snapshots with `restoreGame(setup, state, [])`. The engine reads its log only within a step (`endCutContests` scans from that step's mark).
- **Test** (`playback.test.ts`). From a third-period snapshot, a game restored with the event prefix and one restored with `[]`, both played to the end, give identical later events and identical final states. The final score equals the recording's result.
- **Measured** (seed 42, the 60 latest snapshots, Node/tsx): a restore costs 19.2 ms with the 5066-event prefix and 0.48 ms with `[]`. A plain cursor seek late in the game: median 3.3 ms, worst 10.0 ms. The review measured 20 to 33 ms before.

### M3: Space
- On a focused button or checkbox, Space now does what it does anywhere: it presses the button or ticks the box. Elsewhere it plays or pauses. The keyup `preventDefault` skips buttons and checkboxes.
- Checked: Space on "Overhead" switched to the overhead camera and left play off; Space on the page toggled play.

### M4: seed
- `readSeed()` accepts only a whole number written as digits (optional minus) within the safe-integer range.
- Anything else shows "The seed must be a whole number, like 42. Type one and press New game." and starts nothing. That covers empty, "3.7", "1e400", and text, which a number field reports as empty.
- The field is rewritten with the seed played ("007" becomes "7"). All checked in Chromium.

### M5: pointercancel
- `pointercancel` on the time bar and the window ends a drag, the same as `pointerup`: dragging stops and the moment is played in.

### M6: pad-save side
- `createGameScene(setup, { quality, events })`: the optional event log is indexed per goalie. While a save event of his is at most 1.5 s old, its `pos` against his place gives the side. Without one, the live puck is used as before. The watch page passes the events.
- **Test.** At real pad saves, the pad kicked out is on the event's side, and mirroring the event's puck across him kicks out the other pad. Saves he froze (drawn as a cover) are skipped.

### M9: tests
- **One shared game.** `src/test/global-setup.ts` (vitest `globalSetup`) records seed 5 once per run. It also counts what `onStep` sees, for the onStep test, and writes the result to `node_modules/.cache/hockey-viewer-tests/recording-<hash>.json`. The hash covers every engine source plus `playback.ts`, `cuts.ts` and the setup helper, so any change records afresh. `src/test/game.ts` reads the file once per test file.
- `playback.test.ts`, `scene*.test.ts` and `record-game.test.ts` use the shared game. `playback.test.ts`'s own games (seeds 3, 7 and 5) were replaced by cursors over it. The assertions are unchanged; the game they run on changed.
- The old `scene.test.ts` is split across `scene.test.ts`, `scene-puck.test.ts`, `scene-lines.test.ts` and `arena.test.ts`, so they run side by side. Tests moved unchanged.
- The console output (`scene.test.ts:101`) is removed, and so is the shared-texture dispose test.
- **New test:** after five seeks, playing on at 30 frames a second to the end reaches `phase: 'final'`, the recording's score and its total ticks.
- **Times.**

| Suite | Before | After |
|---|---|---|
| Viewer (cached recording) | 22.7 s (114 tests) | 18.7 to 19.6 s (131 tests) |
| Viewer (first run after a source change) | — | 21.6 s |
| Root `npm test` | 86.5 s at review | 75.4 to 82.9 s |
| `npm run typecheck` | — | 9.1 s, clean |

### I5 (the one piece now): real-game continuity
- `scene-seek.test.ts`, "continuity in a real game": two minutes of seed 5 at 60 Hz through `scene.update`. It takes the worst per-frame move of a foot, hand or hip in each skater's body-frame pose, skipping a skater's first frame on the ice and cut frames.
- **Measured** 9.1 cm; pinned below 10 cm. The synthetic bound in `gait.test.ts` stays 6 cm.

### I6: frozen
- `main.ts` starts with a comment that the skating test page (main.ts, skating.html, moments.ts, scripts/shots.mjs and the rig code only they use) is frozen, approved and published separately, kept compiling and not kept in step.
- No moments test blocked anything. `moments.test.ts` passes unchanged, and `build:single` still builds `skating.html`.

## Commands and output

- `npm test` (root): engine 28 files / 227 tests, debug 2 / 10, viewer 15 files / 129 tests (131 with `record-game.test.ts` in the last run), all pass; real 1m22.9s. No console output from the viewer tests.
- `npm run typecheck`: clean.
- `npm -w apps/viewer run build:single`: `dist-single/index.html` 797 kB, `dist-single/skating.html` 648 kB.
- Browser probes (`probe.cjs`, `probe2.cjs`, with logs `probe.log` and `probe2.log`, all in the shots folder below):
  - seed 42 gives 2-3 (shots 42-39), the same as at review. After seeks to 50000, 300, 90000 and the last 3000 ticks, playing on to the end gives 2-3 again, with the summary "Final: Harbour City 2, Northern Peaks 3 · Shots 42 – 39";
  - Low runs at 28.5 fps playing at 1280 wide (software rendering);
  - no console errors. The only warnings are the GPU driver's "GPU stall due to ReadPixels" from the probe's own screenshots, and Chrome's "1e400 cannot be parsed" from the probe putting that value into the number field.

## Images

All are in `/tmp/claude-0/-home-user-hockey-gm/3ee2ba5d-ceac-5f4a-bbf8-ff6eedc912e9/scratchpad/final-fix-shots/`, and I read them:

| Image | What it shows |
|---|---|
| `down-seek-paused.png` | Paused seek, following #51 who is down. He is drawn sitting on the ice, and the skaters around him are mid-stride. Before the fix, the review's `down-paused.png` showed him standing. Hip 0.269 m after the seek and 0.269 m when played to (`down-played.png`). |
| `rush-seek-paused.png`, `rush-seek-broadcast.png` | Paused seek into a rush (#22 carrying at over 7 m/s). Every figure is in a skating pose, and the puck is on the blade. `rush-played.png` is the same moment reached by playing. |
| `whistle-00` to `whistle-07.png` | Broadcast camera at 0.5x, 4 frames a tick, across a whistle where the puck is re-spotted more than 6 m away (cut tick 767). The picture and the camera change together on the first frame of tick 767 (`whistle-05`). Before it, nothing moves toward the dot, and there is no streak. |
| `period-00` to `period-07.png` | Overhead camera across the first period break (cut tick 41649). Frame 04: the goalie at the right net with the puck near him. Frame 05: goalies at their new ends, puck at centre, camera cut on the same frame. No goalie is drawn crossing centre ice. |
| `no-webgl.png` | The plain message in the picture area, with every control greyed out. |
| `page-after-new-game.png`, `after-context-restored.png` | The page after a background New game, and after a lost and restored WebGL context. |

## Not done, and why
- **I5 restructure** (animator, exported pose mixing, camera operator, timeline): next milestone, as ruled. My changes stay small and local:
  - `seekScene` and the cut handling live in `scene.ts` beside `update`;
  - `cuts.ts` is pure and can feed the timeline or the director;
  - the camera reads one `cutNow()`.
- **M7, M8, M10**: left, as ruled. M10 (the per-tick `structuredClone` in the cursor) is now the largest single cost of the scene tests (about a quarter of their CPU) and of a pre-roll.

## Concerns
- **The test-time target.** The viewer target holds only with the cached recording: about 19 s warm, 21.6 s on the first run after any engine or playback change, because recording the shared game takes about 3 s before any test starts. Root `npm test` is under 100 s either way.
- **Seek against play is close but not equal.** Hip and lean match closely for most figures. The stride phase cannot match, because the gait's own clock is not engine state, so feet can be at a different point of the stride after a seek than after playing (worst hip difference measured 12.8 cm).
- **A seek costs 18 to 41 ms** in headless Chromium (software rendering). That is fine for clicks and keys, which is why the drag uses plain seeks until it rests.
- **New game still hitches once**, a frame of about 320 ms at the swap (receiving the recording, building the scene, the pre-roll). The simulation itself no longer freezes the page.
- **Untested hosts.** The published copy is served from another host than `file://`. If that host refuses workers, the main-thread fallback runs (tested with a refused `Worker`); only Chromium from `file://` was checked.
