# Task 3 report: the rig and the skating test page

Status: DONE_WITH_CONCERNS (concerns are about how some poses look, which comes from gait.ts values I was told not to change, and the software-renderer frame rate)
Commit: `11fd40e feat: jointed skater rig and the skating test page` on `viewer-3d` (not pushed)

## What was built
- `apps/viewer/src/rig.ts`
  - `createSkaterRig(def, colors)`: a figure built from basic shapes and sized from `bodyDims`. It has:
    - rounded-box pants, jersey torso with two trim bands and a collar, flattened shoulder pads;
    - head with a helmet cap in the jersey colour and a visor (the visor marks his front);
    - capsule upper arms and forearms in the jersey, with a trim cuff, and dark gloves;
    - capsule thighs in the pants colour and socks in the jersey with a trim stripe;
    - skates with a boot, a dark holder and a light steel runner;
    - a stick with a shaft and a blade;
    - his number on the back (canvas texture, system font, trim colour outlined in the pants colour);
    - soft shadow blobs: one under the body and one under each skate, fading and growing as the skate lifts.
  - Limb thickness and torso depth scale with girth squared (from `bodyDims.bulk`), so build reads at a glance.
  - Knees use `solveLeg` in a frame turned to the skate's `footYaw`, as the task 2 report prescribes, so knees bend over the toes. Hips use `hipJoint`, shoulders use `shoulderJoint`, and the torso and head use `torsoRotate`, with Euler(roll, 0, −pitch, 'XYZ') matching Rx(roll)·Rz(−pitch). Elbows come from a two-bone solve with a pole out to the side and back.
  - `createMarker(color, radius)`: a short cylinder with a white top and a dark facing notch along +x.
  - Also exported: `handedMotion`, `mirrorPose`, `createShadowBlob`.
- `apps/viewer/src/rink.ts`: `buildRink()` built to `RINK` and `FACEOFF_DOTS`:
  - pale blue-grey ice (`0xd6e2ea`, not white) with an arena floor around it;
  - red centre line, blue lines and goal lines, each cut at the corner arcs;
  - centre circle, end circles with hash marks, all dots;
  - creases (light blue with a red edge) on the centre-ice side of the goal line;
  - nets with red posts, crossbar and base, and translucent netting;
  - boards with a yellow kickplate, white boards and a dark cap rail.
- `apps/viewer/src/moments.ts` (new, with a test): `createMomentScanner()` runs every on-ice skater's real gait (`motionOf` + `stepGait` at DT) over the pre-run game through createPlayback's new `onStep`. For each skater it keeps:
  - his longest backward stretch;
  - the stop with the highest entry speed;
  - his longest fast crossover;
  - the stride run with the highest peak speed;
  - a faceoff he is on the ice for. It prefers one after a stoppage, since at the opening draw he just stands there.

  The "Jump to" buttons seek to 1 s before each run (4 s before the faceoff drop), so the gait has time to settle after the reset.
- `apps/viewer/src/playback.ts`: one additive option, `onStep(state)`. It is called for every tick of the up-front run, so the scan costs no second simulation. Test added.
- `apps/viewer/src/main.ts` + `index.html`: the page.
  - Title "Skating Test".
  - Score, period and clock line.
  - A 16:9 canvas with the device pixel ratio capped at 2. It resizes with the page.
  - "Simulating…" is painted before the up-front run.
  - Readout "Skating: stride · 6.2 m/s", plus the player's number, name, position, height, weight and shot.
  - Play/Pause; Speed 0.25x, 0.5x, 1x, 2x; Player picker (both teams by number, name and position; defaults to the home team's first-pair LD); Camera Follow, Side and Above; the Jump to row; Seed and New game.
  - Colour tokens on `:root`, with dark redefined under both guards. The body has an explicit background, and the page uses the system font. No network requests, no localStorage.
  - Frame loop:
    - clamps frame time to 0.1 s and calls `advance(dt·speed)`;
    - blends position and facing between `prev` and `next`;
    - feeds `stepGait` the blended motion: velocity and facing lerped, acceleration and turn rate over the tick, all through `motionOf`. The time step is display dt × speed.
  - The gait resets with `initialGait()` after any seek, a new game, a change of player, or his return from the bench. Off-ice skaters are hidden.
  - Goalies are tall markers. The puck is drawn with its height.
  - Cameras ease their offset from the player, not their absolute position. Easing the position lagged about 3 m behind a skater at 8 m/s and turned the side view into a rear view.
    - Follow: 5.2 m behind his smoothed travel and 2.7 m up.
    - Side: 6 m to the side at 1.2 m. It switches to his other side only when the camera would be outside the boards.
    - Above: top-down, oriented like the debug view.
  - `window.__viewer` (kept): `ready`, `seek`, `setPlayer`, `setCamera`, `setSpeed`, `setManual`, `step(displaySeconds)`, `renderOnce`, `grab`, `orbit(angle, dist, height)` (a screenshot camera fixed in his body frame), `screenPos`, `info`, `moments`, `players`, `debug`.
- `apps/viewer/scripts/shots.mjs`: drives the single-file page in headless Chromium (Playwright, SwiftShader).
  - Measures real-time fps at a 1280×720 window.
  - Takes page shots at 1280 and 390 px widths, in light and dark.
  - For a defenceman and then a centre, each at 0.5x: 8-frame sequences of each moment, from the Follow, Side and a fixed "profile" camera.
  - Writes per-sequence contact sheets cropped around the figure, and `log.json` with the style per frame.

## Right shots
Poses are built for a left shot. Mirroring only the output pose would also mirror his travel: a crossover to his right would be drawn as one to his left. So for a right shot:
1. The motion going into the gait is mirrored: `handedMotion` negates `lateral`, `turnRate` and `facing`.
2. The pose coming out is mirrored back: `mirrorPose` negates z, the yaws and roll, and swaps left and right, so the top hand is `arms[0]`.

The test "a right shot crosses over the same way as a left shot" fails if the motion mirror is removed. I checked: it fails with `handedMotion` returning `m` unchanged.

## How facing handedness was verified
- **Algebra.** The body frame (x forward, z right) maps to world (cos f, 0, sin f) and (−sin f, 0, cos f). That is `rotation.y = −facing`, since three.js turns +x toward −z for a positive angle.
- **Unit test.** At facings 0, 0.7, 2.2 and −1.9 and an off-origin position: the visor ("face") is ahead along (cos f, sin f); the number is behind; the stick blade is ahead and on his left for an L shot and on his right for an R shot.
- **Against the debug view.** draw.ts draws engine x to the right and engine y down, with the facing tick at (cos f, sin f). The Above camera uses `up = (0,0,−1)`, which shows the same picture. I rendered a skater moving at heading −2.99 with facing −3.00, a right shot. The figure pointed along his travel (left on screen), with the number on the trailing side and the stick on his right (the top of the screen, engine −y).

## Tests (RED then GREEN)
- `npx vitest run src/rig.test.ts` before rig.ts existed: `Error: Failed to load url ./rig ... Does the file exist?`, Tests: no tests. GREEN: `✓ src/rig.test.ts (5 tests)`. Both brief tests are verbatim. Added tests: facing and stick side for L and R shots; right-shot crossover side; marker notch direction.
- moments.test.ts with moments.ts moved away: `Failed to load url ./moments`. GREEN: 1 passed. It uses a scripted skater: a sprint, a hard stop, then backward, with a faceoff drop at tick 30. It checks the order, the faceoff tick, and that a skater never on the ice gets nothing.
- playback onStep test: GREEN, 7 passed. I did not separately record a RED run for this one. Without the option, `seen` stays empty and `totalTicks + 1` fails.
- Final root `npm test`: engine 227 passed (57 s), debug 10 passed, viewer 48 passed (12.5 s). `npm run typecheck`: clean.
- `npm -w apps/viewer run build:single` writes `dist-single/index.html` at **626.6 kB** (gzip 175.7 kB). The only URL-like string in it is three.js's `http://www.w3.org/1999/xhtml` namespace constant; it is not a request. The shots run logged no network requests.

## Looking at it (Step 5)
Screenshots are in `/tmp/claude-0/-home-user/3ee2ba5d-ceac-5f4a-bbf8-ff6eedc912e9/scratchpad/viewer-shots/`: 275 files, 30 contact sheets `sheet-{d|f}-{kind}-{follow|side|profile}.png`, page shots `page-{1280|390}-{light|dark}.png`, and `log.json`.
- Console: no errors. The only warnings were 4 Chromium "GPU stall due to ReadPixels" messages, caused by the script's own `toDataURL` captures. All page shots had 0 px horizontal overflow.
- **Frame rate.** About **23 to 29 fps** in real time across runs (26, 28, 29, 23.6), in headless Chromium's software renderer (SwiftShader, no GPU). The canvas was 1098×618 inside a 1280×720 window, at 1x, Follow camera. It does not reach 60 there. The per-call render time (about 0.4 ms) is not meaningful, because GL is asynchronous.
- **Up-front run.** The simulation plus the moment scan took 2.7 to 3.2 s (`simulateMs`), against about 2 s for the simulation alone.

### What I fixed after looking
- **Side camera showed his back.** The camera's absolute position was eased and lagged a fast skater. It now eases the offset.
- **Shoulder pads read as a second head** from the side and back. They are now smaller, flattened and lower.
- **The neck was too short.** I raised the head.
- **Moments.** The faceoff moment now avoids the opening draw where possible, with a longer lead-in.
- **Cameras.**
  - The Follow camera moved closer, so the figure is larger in frame.
  - The Side camera ended up behind the boards near them; it now switches sides.
  - The ice was nearly white; it is now darker.

### Each style, judged by eye
- **Stride (profile, 8 to 9 m/s).** This reads as hockey. He leans forward, knees bend forward over the toes, and the push leg extends back and out with the skate turned out. The recovery skate comes under the body and sets down along travel. From behind, the V push to the side is clear. Feet stay on the ice with no legs through it.
- **Glide.** Seen in the lead-ins: bent knees, skates parallel and pointing along travel.
- **Crossover (behind and side).** The body rolls into the turn and the outside leg crosses in front. It reads as a crossover.
- **Backward (profile and front quarter, 3 to 7 m/s).** He is seated and upright, knees forward, facing opposite his travel; the visor leads the way he faces, not the way he moves. The C-cuts are visible but small.
- **Stop (profile).** The hips and skates turn sideways to travel while the torso stays facing forward, and the knees bend over the turned skates. It reads as a stop, but a weak one; see concerns.
- **Standing at a faceoff.** A static upright stance. The centre faces the opposing centre's marker across the dot.

## GAIT tunables changed
None.

## Concerns: things that still look wrong, with where they come from (gait.ts, not changed here)
1. **The stick blade sits nearly centred in front of him, not out on his forehand side.** The poses use small stick headings: `standPose` stickAngle −0.3, `glidePose` −0.25, `backwardPose` −0.15, `stopPose` −0.3, and `stridePose` −0.35 − 0.15·s. The top hand is in front of the opposite shoulder. So for a left shot the shaft runs from about z −0.17 to about z +0.2 at the heel, and the blade ends close to his midline. A real stance has the blade about 0.4 to 0.6 m to the stick side. Suggested change in gait.ts: put the top hand nearer the body's midline or stick-side hip, and use stick headings of about −0.6 to −0.8 for a left shot. The rig turns the blade a further 0.35 rad outward from the heel to soften this.
2. **The stop is upright, with little lean back and the feet barely ahead.**
   - `stopPose` pitch is 0.1 + 0.6·lean, with lean bottoming at −0.25, so the torso is about −0.05 rad (vertical).
   - Feet sit ahead by `0.22·k` and hipY drops 17%. It looks more like a sideways stance than a digging, shoulders-back hockey stop.
   - Suggested: pitch about −0.15 to −0.25 at full speed, feet about 0.35 to 0.45 m ahead along travel, and a deeper knee bend.
3. **Faceoff stance is too tall.** At the dot, `standPose` (hipY 1.04 × hipHeight, pitch 0.22) shows a tall, straight-legged figure. A centre taking a draw crouches low with the stick blade on the ice in front.
4. **Backward C-cuts are small from the side, even accelerating.** The cut size is `A = 0.22·eff·leg/0.9`.
5. **The engine's motion.** As the task 2 report says, styles change about every 0.8 s. On the page this shows as stride, glide and crossover alternating within a second during ordinary play. The jump-to moments pick the longest clean runs.

   The "hardest stop" for the defenceman tested (seed 42) holds 4 to 5 m/s for a second while braking, then pivots. A stop that doesn't stop is engine braking, not the viewer.
6. **Frame rate.** About 23 to 29 fps on the software renderer at 1098×618, against the 60 fps target. On a real GPU it should be far higher; I did not measure one. The cost is mostly fill and antialias on SwiftShader. If needed, the cheapest levers are `antialias: false` and a lower pixel ratio.
7. **Side camera at an angle.** The Side camera turns with his smoothed travel (τ 1.2 s). During a hard turn, or right after a jump, it can show him from a front or rear three-quarter view for a moment. The screenshot-only `orbit` camera gives an exact profile.
8. **Bench.** When the followed player is on the bench, the camera holds still and the readout says "Skating: on the bench"; press Play or use Jump to.

## Files
- New: `apps/viewer/src/rig.ts`, `rig.test.ts`, `rink.ts`, `main.ts`, `moments.ts`, `moments.test.ts`, `apps/viewer/scripts/shots.mjs`
- Changed: `apps/viewer/index.html` (the page), `apps/viewer/src/playback.ts` (+`onStep` option), `playback.test.ts` (+1 test)

## Interfaces for later work
- `createSkaterRig(def, colors): { root, apply(pose, worldX, worldZ, facing), dispose }`. Feed it a pose from `poseOf(gait, handedMotion(def, motion), dims)`; `apply` mirrors right shots itself.
- `createMarker(color, radius)`; `buildRink()`; `iceHalfWidthAt(x)`.
- `createPlayback(setup, { onStep })`.
- `createMomentScanner()` returns `{ onStep, momentsFor(id) }`.
- `window.__viewer` as listed above. To run the screenshots: `npm -w apps/viewer run build:single && node apps/viewer/scripts/shots.mjs <outDir>`.

## Self-review
- **Complete against the brief.** All of these are done: rig parts, number, marker, rink parts, page controls, readout, follow and side cameras, puck, score line, the 0.1 s clamp, hiding off-ice skaters, the single-file build, shots, and the frame rate.
- **Beyond the brief:** the Above camera, the Jump to row (from the dispatch), `moments.ts`, and the playback `onStep` option.
- **No changes** to gait.ts, body.ts or the engine.
- `debug()` and `orbit()` on the hook are for scripts only. They are harmless on the page.

## Pose polish

Commit: `ad9758b feat: skating poses that read as hockey`.

The coordinator allowed pose geometry changes in gait.ts. No style logic changed: classify, stepGait, dwell, the passive gate, phase rates, `backEffort` and every GAIT value are as they were. No test assertion changed. `body.ts` is unchanged.

Screenshots are in the same directory with the `polish-` prefix: `polish-sheet-{d|f}-{kind}-{follow|side|profile}.png`, the frames, `polish-page-*.png` and `polish-log.json`. The page had no console errors and no horizontal overflow, and ran at 25.6 fps in software rendering.

### Structural changes (geometry only)
- **`RawPose`.**
  - `topRel` (top hand from the right shoulder) is now `top`: the top hand placed from the pelvis centre, at the hip on the side away from the blade, scaled by torso length.
  - The per-pose `stickAngle` is replaced by `blade`: the point on the ice the stick should reach. `fit` aims the shaft at it, `stickAngle = atan2(blade − top hand)`, and still outputs `Pose.stickAngle`.
  - Blade points blend as positions, so the stick stays continuous.
- **New optional `Pose` fields.**
  - `twist`: shoulders turned about the torso axis. `torsoRotate(v, pitch, roll, twist = 0)` and `shoulderJoint` accept it.
  - `look`: head yaw.
  - Both are also on `RawPose` and are mixed.
- **`poseOf(g, motion, d, opts?)`.** A new optional `{ crouch }` (0..1) feeds the stand pose. The page eases crouch toward 1 (τ 0.35 s) when the followed player is within 1.3 m of `faceoffSpot`, during `faceoffSetup`, and slower than 0.5 m/s. These are engine fields that already exist.
- **Rig.**
  - The torso uses Euler(roll, −twist, −pitch, 'XZY'), which matches `torsoRotate`.
  - The head turns by `look` and stays fairly upright.
  - `mirrorPose` negates twist and look.
  - The number on the back moved from 0.58 to 0.50 of torso height, so it stays on his back in the deeper-pitched stance.
- **Page.**
  - Markers are now flat discs (7 cm), puck-like, with a flat wedge notch and the player's number on top, readable from behind him. Goalies are larger discs (0.55 m) with numbers.
  - The followed player skates on a yellow ring (0.64 to 0.72 m, opacity 0.8).
  - The hint text was updated.
  - `shots.mjs` takes an optional file prefix.

### Pose values (old → new)
| Pose | Value | Old | New |
|---|---|---|---|
| stand | hipY | 1.04 × hipHeight | (0.95 − 0.1·crouch) × hipHeight |
| stand | pitch | 0.22 + 0.2·lean | 0.32 + 0.3·crouch + 0.2·lean |
| stand | feet | x 0.03, z ±sw/2, yaw ∓0.1 | x 0.10 (hips back), z ±sw/2·(1.1 + 0.15·crouch), yaw ∓0.15 |
| stand | top hand / stick | topRel (0.3R, −0.62R, −0.05R) from shoulder; stickAngle −0.3 | top (0.30, 0.04 − 0.1c, 0.10 − 0.05c) from pelvis; blade (1.2, −0.5 + 0.35c) |
| glide | hipY | 0.98 × hipHeight | 0.94 × hipHeight |
| glide | pitch | 0.35 + 0.6·lean | 0.45 + 0.6·lean |
| glide | feet x | 0.06 / 0.02 | 0.08 / 0.04 |
| glide | top hand / stick | topRel (0.35R, −0.6R, −0.05R); stickAngle −0.25 + 0.03 sin | top (0.30, 0.05, 0.10); blade turn((1.2, −0.45), H) ± 0.05 sway |
| glide | look | none | 0.8·H, clamped ±0.8 |
| stride | top hand | swingArm(0.75 − 0.3s, 0.85, −0.15) from shoulder | top (0.28 − 0.08s, 0.06, 0.12) from pelvis |
| stride | stick | stickAngle −0.35 − 0.15s | blade turn((1.25, −0.3 − 0.1s), H) |
| stride | two hands | 0 | clamp01((0.75 − amp)/0.2): both hands at an easy pace, free arm swings when pushing hard |
| stride | twist / look | none | 0.14·s / 0.8·H |
| stride | hipY, pitch, legs | unchanged | unchanged (keeps I-1 and M-4) |
| crossover | pitch | 0.4 + 0.8·lean | 0.45 + 0.8·lean |
| crossover | top / stick | topRel (0.3R, −0.65R, −0.05R); stickAngle −0.2 + 0.3·dir | top (0.30, 0.05, 0.10); blade turn((1.2, −0.4 + 0.25·dir), H) |
| crossover | twist / look | none | 0.12·dir / 0.8·H + 0.25·dir |
| backward | hipY | 0.90 × hipHeight | 0.86 × hipHeight (seated) |
| backward | pitch | 0.18 + 0.3·lean | 0.25 + 0.3·lean |
| backward | half stance | sw/2 + 0.02 | sw·0.5 + 0.03 |
| backward | C-cut size A | 0.22·eff·leg/0.9 | 0.24·eff·leg/0.9 |
| backward | cut forward travel | 0.6·A | 0.6·A (unchanged; 0.45 and 0.7 tried, see below) |
| backward | base x | 0.05 | 0.06 |
| backward | toe-in | 0.5·eff | 0.55·eff |
| backward | top / stick | topRel (0.35R, −0.65R, 0); stickAngle −0.15 | top (0.30, 0.08, 0.10); blade (1.1, −0.35) along his facing (squared to the play) |
| stop | hipY | (1 − 0.17k) × hipHeight | (1 − 0.25k) × hipHeight |
| stop | feet ahead along travel | 0.22k | 0.38k·leg/0.9 |
| stop | pitch, roll | 0.1 + 0.6·lean, 0 | lean back against travel: back = 0.3k − 0.4·min(0, lean); pitch 0.25 − back·cos(travel), roll −back·sin(travel) |
| stop | top / stick | topRel (0.3R, −0.6R, 0); stickAngle −0.3 | top (0.28, 0.06, 0.10); blade (1.1, −0.45) |
| down | top / stick | topRel (−0.15R, −1.1R, 0.25R) from shoulder; stickAngle 0.4 | top (−0.17R, −0.36R, 0.55R) from pelvis (the same place); blade (0.5, 1.4), so the stick lies beside him |

Blend speed limited how far I could go. Several values sit where they are because of the continuity bounds. I first used a stop stance half-width of 1.15, feet 0.48 ahead and a hip drop of 0.27, and backward A 0.32 to 0.36 with a stance of 0.55·sw. Those broke the 6 cm per frame bound in two I-2 blend scenes:
- cross/stop reached 6.1 cm;
- back/cross reached 6.2 to 7.0 cm. While the backward pose fades out during a crossover blend, it keeps cutting at the crossover's phase rate, so the cut size sets the speed.

I tried `GAIT.blend` 0.4, which did not fix back/cross, and reverted it. No GAIT value changed. The final worst cases are cross/stop 5.8 cm and back/cross 5.9 cm (the original code gave 4.9 and 5.7).

### How each style looks now (polish sheets and orbit checks)
- **Stand / faceoff.** Athletic stance: knees bent, hips back, torso forward, both hands on the stick, blade on the ice in front and out to the forehand. A centre at the dot crouches lower with the blade nearer the middle.
- **Stride.** Deep forward lean and a long push back and out. When pushing hard the free arm swings across with the shoulders counter-rotating; at an easy pace both hands stay on the stick. The stick hand rides at the hip and the blade is ahead on his forehand side.
- **Glide.** Knees bent, feet shoulder-width, two hands on the stick, head turned toward where he is going.
- **Crossover.** Rolls into the turn with the outside leg crossing in front. The stick and shoulders turn into the turn.
- **Backward.** Seated, stance a little wider than the shoulders. Each skate sweeps out in a half circle and back in, toe turned in, with the stick ahead along his facing.
- **Stop.** Hips and skates sideways to travel, skates well ahead of the hips, deep knee bend, upper body leaning back against travel. Seen from the front it reads as a hockey stop. It eases upright as speed drops.
- **Right shots** mirror correctly. I checked from directly behind and from above: the blade is on his right.
- **The followed player** is obvious on his yellow ring. The markers read as tokens on the ice, not obstacles.

### Still not right
- **Small C-cuts.** C-cuts are only as big as the continuity bound allows (A 0.24·eff). At steady backward speed the gait's effort is 0.2, so the cuts are slight then; they are clear only while he accelerates backward.
- **The stick reaches far ahead.** It is long (0.82H) and runs straight from the hip hand to the ice, so at hip height the blade lands about 1.1 to 1.3 m in front of the hand. That is about right for a long reach, but more than most players carry it when skating. A lower top hand or a shorter stick would bring it in.
- **The stop leans back with straight-looking legs from the side.** The knees bend over the turned skates, so the bend shows only from the front or behind.
- **The faceoff crouch is not seen during the draw.** It applies only during `faceoffSetup`. Once the puck drops, phase goes live and the stance eases up over 0.35 s.
- **Not polished:** the down pose (only the stick changed); the lower hand's grip point on the shaft (still 36% down, limited by arm reach).

### How the engine's motion looks in 3D
- **Styles change about every 0.8 s in ordinary play.** On screen, stride, glide and crossover flick back and forth. Each change is smooth, but the stream of changes looks busy.
- **Stops often don't stop.** A "hard stop" brakes from about 7.8 to 4.7 m/s and then pivots away instead of stopping. That is the engine's braking-then-retarget pattern.
- **Backward skating reaches 7 m/s,** which is fast for backward skating, so the seated stance with small cuts looks like it is gliding.
- **At faceoffs,** players stand still at their spots before the drop. The opening draw holds for several seconds.

### Tests and checks
- Root `npm test`: engine 227, debug 10, viewer 48, all passing. Every gait, body, rig and playback test passes unchanged, including I-1, I-2, I-4 and M-4.
- `npm run typecheck`: clean.
- `build:single`: 635.1 kB (gzip 178.6 kB), self-contained, with no network requests in the shots run.

## Final pass

Commit: `2da7e12 fix: stick carry, athletic stance, faceoff crouch, page robustness`.

The same limits as the pose-polish pass held: pose geometry only. No change to style logic, GAIT timing or any test assertion. `npm test` passes (engine 227, debug 10, viewer 48) and `npm run typecheck` is clean. `build:single` is 636.3 kB with no network requests. Screenshots are in `viewer-shots/final-*`: no console errors, 0 px overflow at 1280 and 390 px, and 22.6 fps in software rendering.

### What changed
1. **Stick carry**
   - `body.ts`: stick 0.82H → 0.77H (1.42 m at 185 cm). 0.75H and 0.76H broke M-4's 6 cm bound in the glide-to-stride blend, through the lower hand.
   - The top hand now holds the stick 14% of its length down from the butt (`STICK_GRIP`, new `Pose.grip`), and the butt shows behind the hand. The rig draws the shaft from the butt.
   - The top hand is lower and nearer the body:
     - stand (0.22, 0, 0.10);
     - glide (0.28, 0.04, 0.10);
     - stride (0.22 − 0.04s, 0.04, 0.12);
     - crossover (0.24, 0.02, 0.10);
     - backward (0.24, 0.05, 0.10);
     - stop (0.22, 0.04, 0.10).
   - Blade targets moved in and out to the forehand side:
     - stand (0.85, −0.65);
     - glide (0.95, −0.5);
     - stride (0.95, −0.5 − 0.04s);
     - crossover (0.9, −0.5 + 0.15·dir);
     - backward (0.9, −0.5);
     - stop (0.9, −0.6).
   - The moving styles now turn the blade target by 0.3·H, not H. With H the stick swung across to the side when he travelled at an angle.
   - Result: the blade is on the ice about 0.7 to 0.9 m ahead of the skates and out to the forehand. Both hands hold the stick except in the hard-sprint one-hand carry.
   - The lower-hand grip stays at 0.36 of the stick: it is reach-limited, so other values made no difference. The stride free-arm swing went from 0.68 to 0.55 rad × amp, needed to keep M-4 under 6 cm with the new hand positions.
2. **Athletic stance and faceoff**
   - Stand: hipY 0.95 → 0.89 × hipHeight; pitch 0.32 → 0.36; feet 0.16 ahead of the pelvis (hips back), half-width 1.15·sw/2, toes out 0.18.
   - Crouch, at full: hipY −0.17·hipHeight, pitch +0.4, feet wider (+0.25·sw/2), top hand 0.12 lower.
   - The crouched stick aims at the dot. New `PoseOptions.dot`: the faceoff spot in his body frame, in the left-shot frame with z mirrored for a right shot.
   - The engine's centres stand about 0.9 m from the dot, so the crouch triggers (within 1.3 m, under 0.5 m/s, during `faceoffSetup`).
   - Two limits held the stance up:
     - The rig test needs the top of a 165 cm figure above 90% of his height. So the stance stays up and I lengthened the neck: head centre +0.03k higher, plus a skin neck. Human proportions support it: the head top was 3 cm short of the real shoulder-to-crown distance.
     - The rig facing test needs the number centre well behind his pelvis. The number moved to 0.42 of torso height and 0.55 of the torso width; the hem stripes moved down so they don't run under it.
3. **The wide-V crossover after a faceoff.** The frame was 0.04 s into a stride-to-crossover blend, moving at 57° off his facing.
   - Cause: a stride built along that travel puts the feet about 0.4 m apart fore and aft, and stride and crossover hips were high (0.92 to 0.93 × hipHeight) on nearly straight legs, which made the inverted V.
   - Changes:
     - Stride reach shrinks by up to half when travel is far off facing (smoothstep over |H| 0.4 to 1.2).
     - A crossover's width scales 0.55 to 1.0 with speed (2.5 to 7 m/s), including its roll offset.
     - Stride hipY (0.96 − 0.04·amp) → (0.92 − 0.02·amp); crossover hipY 0.93 → 0.90.
   - The same frame now shows bent knees and a modest step.
4. **Page robustness**
   - New game ignores a second request while one runs, which also covers Enter in the seed field.
   - Every control is disabled during a run.
   - An exception during setup shows "Sorry, this game could not be set up (seed N). Try another seed and press New game." and re-enables the controls.
   - Old markers' geometry, materials and number textures are disposed; the shared shadow texture is kept.
   - The `#loading` text colour comes from a new `--stage-text` token.
5. **Screenshot script**
   - The profile (`orbit`) camera switches to the opposite side when its spot is outside the boards.
   - Sheet cells are 360×440, centred at hip height, so the whole figure including skates is in frame.

### What I saw (`final-` sheets)
- **Sprint (side and profile).** The stick blade is on the ice in front, about 0.8 m ahead; the stride is unchanged otherwise, with a bit more knee bend.
- **Defenceman's stand.** Knees and hips clearly bent, torso forward, blade on the ice about 0.7 m in front.
- **Centre at the faceoff.** Drops into a deep crouch with the blade on the dot. He comes back up into a stride as play starts.
- **The previous frame 7.** Now a moderate crossover step with bent knees.

### Still not right
- **The profile camera can sit behind a net** near the crease and look through the netting. It does stay inside the boards. This camera is screenshot-only; the page's Side camera is unaffected.
- **The faceoff crouch eases out** over 0.35 s after the drop. It is held only during setup.
- **Continuity bounds cap two poses.** The backward C-cut stays at 0.24·eff and the stop depth stays as in the polish pass.
- **The engine's motion is unchanged:** busy style changes, stops that don't stop, and backward skating up to 7 m/s.
