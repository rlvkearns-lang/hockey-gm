# Task 2 report: gait and pose (pure maths)

Status: DONE_WITH_CONCERNS (the concerns are about how the engine's motion will look, not about unmet requirements)
Commit: `9fc872f feat: skating gait and pose maths` on `viewer-3d`

## What was built

- `apps/viewer/src/body.ts`: `bodyDims(heightCm, weightKg)` built from standard anthropometric fractions of height (thigh 0.245H, shin 0.246H, torso 0.288H, upper arm 0.186H, and so on). Skate = 0.039H + 7.5 cm (boot and blade). `hipHeight` is the ready-stance pelvis height, `STANCE_HIP` (0.9) times the straight leg, so the leg always reaches the ice with a bent knee. Girth factor = sqrt(weight per unit height) relative to 90 kg at 185 cm. It feeds `bulk` (torso half-depth, m) and slightly widens shoulders and hips. **I added one field the brief doesn't list: `stick` (0.82H)**, because the stick geometry in the pose depends on it.
- `apps/viewer/src/gait.ts`: `Vec3`, `Motion`, `Style`, `STYLES`, `GaitState`, `LegPose`, `ArmPose`, `Pose`, `motionOf`, `initialGait`, `stepGait`, `poseOf`, `solveLeg`. It also exports `GAIT` (all thresholds and time constants, for tuning by eye) and three helpers Task 3 should use so its rig matches the maths: `hipJoint`, `shoulderJoint`, `torsoRotate`.

### How it works
- **stepGait**: smooths acceleration (clamped to ±10 m/s² first), turn rate and travel direction with exponential time constants, all based on dt. It then classifies a style using enter/exit threshold pairs and a minimum dwell. Leaving a stride or crossover also waits (at most 0.4 s) for a natural break in the cycle: both skates down, or the outside skate planted. It advances `phase` by a per-style rate. `lean` and `roll` ease toward targets: lean from acceleration, roll from centripetal acceleration v·ω. `down` and `stop` take effect at once.
- **poseOf**: builds the style's raw pose. During the first 0.35 s of a style it blends from the previous style (`from`/`fromSide`), using smoothstep. It then fits the result to the body:
  - lowest skate on the ice;
  - pelvis lowered until each planted ankle is within reach (this gives the natural hip drop at full push extension);
  - lifted skates out of reach drawn in;
  - top hand within arm reach, holding the stick butt;
  - lower hand on the shaft as near 36% down it as the left arm allows, or swinging free.
- **The styles as built:**
  - **Stride**: each leg glides under the body (q 0 to 0.15), then pushes back and out at 45° with the toe turning out to about 36° (to 0.6). It then lifts (peak 13 cm × amplitude), recovers under the body and sets down pointing along travel. The legs are half a cycle apart, so there is double support around q 0 and 0.5. Pelvis weight shifts over the gliding skate. Torso pitch is 0.4 + 0.12·amp + lean (up to about 50° under hard acceleration). Stride length grows with speed and effort. The free (left) arm swings big, opposite the legs; the stick hand stays low in front with a small swing.
  - **Glide**: skates shoulder-width apart, toes ±0.05 rad, knees bent, pitch 0.35 + lean, small weight shifts at 0.2 Hz.
  - **Crossover**: the outside skate lifts and crosses in front of the inside one, then rides back out. The inside skate pushes under and out behind it, then recovers. The body rolls into the turn (roll + 0.12), so the skates sit outward of the pelvis. Skates turn partly toward travel (0.5·sin travel).
  - **Backward**: seated (hipY 0.9 × stance), pitch 0.18 plus a little lean. Alternating C-cuts trace a half-ellipse out and forward with the toe turned in, and both skates always stay on the ice. Cut size and cadence scale with effort, so holding speed gives gentle cuts and slowing gives none.
  - **Stop**: hips turn about 70° to 90° sideways and skates about 95° (both bounded and continuous). Feet go out ahead along travel, knees deeply bent (hipY down 17%), torso back. All of this eases out as speed drops.
  - **Stand**: upright athletic stance, both hands on the stick with its blade on the ice.
  - **Down**: sitting on the ice, legs out front, hands behind.

## Conventions Task 3 must follow (also in gait.ts doc comments)
- Body frame: x forward, y up, z to his right. Origin on the ice under the pelvis. Index 0 = left (z < 0), index 1 = right.
- All yaws (`footYaw`, `Pose.yaw`, `stickAngle`) run from +x toward +z: heading h points along (cos h, 0, sin h). Roll is positive leaning toward +z; pitch is positive leaning forward.
- Engine to body: engine y is world Z, so his right (+z) is engine (−sin f, cos f). `Motion.lateral` is positive toward +z, and a rising facing (`turnRate` > 0) turns him toward +z.
- `foot` is the blade's contact point. The ankle is `d.skate` straight above it. Pass the ankle to `solveLeg`.
- `solveLeg` bends the knee toward +x:
  - thigh direction = (sin a, −cos a·cos r, cos a·sin r) with a = hipPitch, r = hipRoll;
  - shin direction = the same with a = hipPitch − kneeAngle.

  To make the knee follow a turned-out skate, rotate hip and ankle by −footYaw about the hip before solving, then yaw the solved leg by footYaw. The test file's `ankleOf` helper shows the reconstruction.
- `Pose.yaw` turns the pelvis and hip sockets only (`hipJoint`). The torso takes `pitch` then `roll` about the pelvis centre: `torsoRotate` = Rx(roll)·Rz(−pitch). Use `shoulderJoint` for the shoulders.
- Stick: held at its butt by arms[1] (top hand, left shot; mirror z, yaws and roll for a right shot). The shaft runs from that hand along (cos h·cos t, −sin t, sin h·cos t), with h = `stickAngle` and sin t = min(1, hand.y / `d.stick`), so the blade end reaches the ice.
- `phase` is not wrapped (it counts cycles). Poses use its fractional part.
- Call `stepGait` every display frame with the frame's dt and a `motionOf` that is blended or per-tick. All smoothing is in seconds.
- Off-ice skaters are not handled here. The page should simply not draw them.

## Thresholds chosen (all in `GAIT`)

| Style / item | Enter | Exit | Why |
|---|---|---|---|
| moving vs stand | speed > 0.9 m/s | ≤ 0.5 | A drift slower than a walk shouldn't move the legs. A start from rest strides as soon as he is clearly pushing (speed > 0.25). |
| stride | smoothed accel > 2.0 m/s² | < 0.5 | The engine accelerates at 7.8 to 9.8 m/s² and then holds speed, so steady speed is a glide (as the brief's tests require). 2.0 sits clear of the 1.0 hysteresis test. Bursts of 1 to 2 ticks (shoves, brain retargets) peak below it. |
| accel smoothing | τ = 0.4 s, raw clamp ±10 | | Tick-to-tick accel is bang-bang (±9 m/s² for a couple of ticks). One clamped shove tick reads as about 0.8. A real sprint crosses 2.0 within about 0.1 s. |
| backward | travel > 115° off facing and speed > 1.2 | < 100° | Matches the engine's "squared up" 120° rule with margin. Below 1.2 m/s the travel direction is noise. |
| stop | accel < −4 m/s², speed > 1.5, travel not behind | accel > −1.5, or speed ≤ 0.5 | Engine braking runs at the accel rate (about −8 to −12), so a sustained hard brake (about 0.25 s) is a stop. The brief's −9 test triggers by frame 14 of 20. Once begun, it holds through his pivot. |
| crossover (sideways) | travel > 55° off facing | < 40° | The engine squares up past 65° and back at 45°. Ignored while speed bleeds off faster than 3 m/s², so a sideways shove isn't a crossover. |
| crossover (turn) | smoothed turn > 1.0 rad/s at > 3 m/s | < 0.7 rad/s, or speed < 2.5 | The engine's forward turn limit at speed is about 0.9 to 2.1 rad/s, so this catches its hard turns (centripetal ≥ 3 m/s²) and leaves gentle curves gliding. Needs accel > −2. |
| turn smoothing | τ = 0.3 s | | The facing changes in single-tick spikes when the brain retargets. |
| min dwell | 0.45 s | | Ordinary changes only. Down, stop and getting up are immediate. |
| natural break wait | up to 0.4 s more | | Stride/crossover exits start from a settled pose. |
| blend | 0.35 s smoothstep | | A blend interrupted before half done keeps blending from its older style. |
| stride cadence | 1.2 + 0.11·v + 0.06·accel pushes/s, clamped 1.2 to 2.4 | | About 2.1 to 2.4 pushes/s sprinting at 8 to 9.5 m/s. Test checks 1.5 to 2.5. |
| crossover cadence | 0.8 + 0.1·v crossovers/s, max 1.7 | | |
| backward cadence | (0.5 + 0.05·v)·effort cycles/s (2 cuts each) | | effort = clamp(0.2 + 0.27·accel). |
| lean | 0.045·accel, clamped −0.25 to 0.35 rad, τ 0.25 s | | |
| roll | 0.85·atan(v·ω/g), clamped ±0.6 rad, τ 0.2 s | | |

## Tests

RED (before any implementation): `npm -w apps/viewer run test` gave `FAIL src/body.test.ts … Error: Failed to load url ./body … Does the file exist?` and the same for gait.test.ts.

GREEN: `npx vitest run --root apps/viewer src/gait.test.ts src/body.test.ts` gave `✓ src/body.test.ts (2 tests)`, `✓ src/gait.test.ts (26 tests)`, `Tests 28 passed (28)`. Root `npm test`: engine 227 passed, debug 10 passed, viewer 34 passed, wall time 72 s. `npm run typecheck`: exit 0.

- All 12 brief tests are verbatim. The helper `m(partial)` fills a zero `Motion`.
- Added tests:
  - a one-tick shove doesn't stride, and a slow drift stands with phase 0;
  - a sideways shove isn't a crossover;
  - frame-rate independence at 30, 60 and 144 Hz;
  - sprint cadence is 1.5 to 2.5 pushes/s;
  - lean and roll ease rather than snap;
  - full-blend sweep: every style blended from every style, at extreme motion, for 165/70 and 200/110 bodies. No NaN, one skate on the ice, legs within reach, hands above the ice;
  - stride alternates, pushes back and out with the toe out, and leans further under acceleration;
  - glide is about shoulder width;
  - crossover rolls in and the outside skate crosses in front;
  - stop has skates sideways, deep knees, torso back;
  - backward is more upright, both skates down, C-cuts sweep out;
  - down is low;
  - coming to rest eases to the stand pose with no jumps;
  - `solveLeg` reconstructs the ankle with the knee forward, and gives a straight leg when out of reach;
  - `motionOf` frame, sign, wrap and down handling.
- In my own first draft of a `solveLeg` test I picked a target out of reach (0.95 m for a 0.91 m leg). I fixed the test data; the code was unchanged.

Evidence beyond unit tests: a temporary probe (deleted, not committed) ran 10 minutes of a real game, all on-ice skaters at 60 fps with two frames per tick:
- top speed seen 9.4 m/s;
- time share: glide 26%, crossover 26%, stand 20%, stride 17%, stop 12%, backward 6%;
- frame-to-frame foot movement: median 1.3 cm, p99 7 cm, p99.9 9.3 cm, worst 24 cm (a stop interrupting a blend).

Tuning driven by the probe:
- longer accel smoothing and stride enter 2.0;
- minimum speed for backward;
- stop priority while pivoting;
- natural-break exits;
- stop hips and skates kept continuous and bounded (an early version spun 360° when travel swung behind him);
- yaws blended linearly (all yaws are bounded);
- smoothed travel direction.

## Files
- `apps/viewer/src/body.ts`, `apps/viewer/src/body.test.ts`
- `apps/viewer/src/gait.ts`, `apps/viewer/src/gait.test.ts`

## Self-review
- Matches the brief. Brief tests are verbatim. No three.js or DOM. Engine imported only as a type from `@hockey/engine`. `SkaterState.mode` isn't read.
- Extras beyond the brief: `BodyDims.stick`, `STANCE_HIP`, `GAIT`, `hipJoint`, `shoulderJoint`, `torsoRotate`, and the optional `GaitState` fields (`acc`, `turn`, `travel`, `side`, `from`, `fromSide`). Each exists so Task 3 can match the maths or tune it. The fields listed in the brief keep their meaning.
- Engine types match the brief's sketch. No differences.

## Concerns
1. **The engine's motion is twitchy, and the figure will show it.** Even with the hysteresis, dwell and natural-break exits, a skater changes style about 75 times per skater-minute (once every 0.8 s). Median durations: stride 0.83 s, crossover 0.72 s, glide/stop/stand about 0.5 s. The cause is the engine: speed targets change every brain interval (0.2 s), with acceleration and braking at about ±9 m/s². Task 3 can calm it with `GAIT.minDwell` and `strideEnter`. Anything beyond that is an engine matter.
2. **Stops are frequent** (12% of skater time), because the engine brakes as hard as it accelerates. If the owner finds that too much, raise `stopEnter` in magnitude (−5 still passes the brief's test, though only just) or raise `stopMinSpeed`.
3. Handedness: poses assume a left shot. Task 3 should mirror for right shots (negate z, the yaws and roll, and swap the leg and arm indices).
4. The poses are tuned on paper and in numbers, not by eye. Expect Task 3 to adjust the magnitudes in the pose functions (stride reach 0.62·leg, pitches, crossover offsets).

## Fix round 1

Commit: `f17c4d1 fix: smooth pelvis, continuous blends, no effort on a shove, skates follow travel`. Only `apps/viewer/src/gait.ts` and `gait.test.ts` changed; `body.ts` needed nothing.

### What changed, finding by finding

**I-1 (pelvis jump at push-off).**
- Before: in `fit`, a skate stopped holding the pelvis down the moment it counted as lifted (foot.y > 0.01).
- Now: every skate's hip limit is computed, and a lifting skate's limit fades toward the free hip height by smoothstep(foot.y / 6 cm) (`GAIT.liftFade`). The pelvis rises as the weight comes off.
- Test: over a 0.001-step phase sweep at 5, 7 and 9 m/s for 165/70, 185/90 and 200/110, hipY changes by less than 2 mm per 0.001 of phase.
- Steady stride bob at 9.5 m/s (185/90) is 0.825 to 0.874 m.

**I-2 (blends snapping when interrupted).**
- `GaitState.from` is now the pose shown at the moment of a change, stored as a mix of styles: `MixPart[] = {style, side, w}`. On any change, style or side, the mix shown is recorded as `from`, whatever blend was under way. It then fades into the new style over `blendDur` while `blendT` runs. So every change starts from exactly what was on screen.
- Falls and getting up blend over `blendDown` = 0.65 s; everything else over 0.35 s.
- Test bound: 6 cm per 60 Hz frame for every foot, hand and the pelvis, falls included. At 30 and 144 Hz the move is scaled to a 60 Hz frame. Falling meets the same bound at 0.65 s, about how long a real fall takes to reach the ice, so it needed no separate bound.
- Scenes, with the interruption landing at 0.05 to 0.6 s into the blend: glide/stop, stride/stop, crossover/stop, stride/down, stop/down, down/stand, backward/crossover, a collision jolt mid-stop, and stride, then stop, then down.
- Found while testing: `shaftGrip` returned a negative grip, a hand jump of up to 19 cm, when the arm's reachable stretch of shaft lay entirely behind the butt. Fixed so it is continuous with the other branch.
- Also, for continuity:
  - the skates follow a travel direction that turns at most 4 rad/s (`travelMaxRate`);
  - stop depth and stride length read a smoothed speed (τ 0.15 s, `GaitState.speed`), so a collision that changes speed by 3 m/s in one tick doesn't jerk the stop pose. The jolt scene fails at 12.4 cm per frame without it.

**I-3 (shove read as effort).**
- Raw acceleration above 14 m/s² (`impulseAccel`; the engine's own skating tops out near 10) is an impulse:
  - it is left out of the smoothed acceleration;
  - it opens a 0.6 s passive window (`passiveT`), ended early if he accelerates by himself (raw > 1).
- In that window no stride, crossover or stop starts.
- Starting those styles also needs unlagged evidence:
  - a crossover needs raw above −2 (speed held, not bleeding off) and below the impulse threshold;
  - a stop needs raw below −2;
  - a stride needs raw above −0.5.
- Test: engine-like shoves at v0 = 1.5, 2.5 and 4 m/s, in six directions (side, other side, diagonal, backward, back-diagonal, forward), at 30, 60 and 144 Hz. The velocity jumps in one 30 Hz tick, then the along-facing part brakes at 8 m/s² and the sideways part decays exp(−6t). No stride, crossover or stop is ever seen. A skater gliding at 5 m/s and shoved sideways stays a glide throughout.

**I-4 (planted skates sliding).**
- The forward styles (glide, stride, crossover) are built facing along a heading H = `forwardHeading(travel)`. Backward uses `backwardHeading(travel)`, the reversed travel.
- H follows the line of travel exactly within 1.75 rad (100°) of his facing, then turns smoothly back toward his facing at ±180°, so it is continuous all the way round.
- Hips open by H/2 (pelvis yaw). Feet positions and skate yaws turn by H, so a push is back and out relative to travel, and the pushing skate keeps its turn-out relative to H. The stop is unchanged.
- The brief's glide test still passes unchanged (H = 0 for straight travel).
- Test: steady travel from −180° to 180° in 5° steps at 3 and 7 m/s. Every planted, non-pushing blade (stride glide portion, crossover planted legs except the inside push, backward passive leg; stops excluded) is within 25° of the line of travel.
- Second test: travel swinging 0 → 180 → 0 → −180° over 24 s at 30, 60 and 144 Hz. footYaw changes by under 0.25 rad per 60 Hz frame. The fastest part is the forward-to-backward pivot blend.

**M-1 (frame-rate-dependent timeline).**
- A side change no longer resets `styleT`: the dwell keeps running and only the blend restarts (`blendT`).
- The dwell and break-wait now compare the time at the end of the step, so a change lands on the first frame at or after its moment. Before, it landed one frame late, which is 33 ms at 30 Hz.
- The run that exposed it is the reviewer's p6 script. At 60 Hz it dropped out of the crossover through a 0.12 s glide just before the stop. At 144 Hz the phase was outside the break window, so it went straight to the stop. Now a crossover holds until a stop takes over (stay condition no longer reads acceleration; `crossLatMinAcc` removed), and braking out of a crossover goes straight to the stop at every rate.
- Test: transition lists for the p6 script and a brake-then-swing script with a side flip match at 30, 60 and 144 Hz, with every change within 0.05 s of 60 Hz.

**M-2 (non-finite motion).** `stepGait` and `poseOf` read non-finite Motion fields as 0 (speed as |speed|). Test: NaN accel, infinite turn rate and NaN speed leave a finite state that recovers to a glide.

**M-3 (down pose, ill-conditioned solve).**
- Down sits with the pelvis at skate + 12 cm and each skate straight ahead of its hip joint, below it. The knees go up and forward with hipRoll ≈ 0.
- `solveLeg` keeps hipRoll within ±π/2: a foot level with or above the hip is reached by pitching the thigh past horizontal, never by flipping the leg's plane. The reconstruction formula is unchanged.
- Tests: for three body sizes, |hipRoll| < 0.2, and the knee is ≥ 10 cm above both the hip and the ankle and in front of the hip. Feet level with and above the hip reconstruct exactly with |hipRoll| ≤ π/2.

**M-4 (touchdown yaw, crossover recovery speed).**
- Stride swing ends exactly at the stance's set-down yaw.
- Crossover inside recovery now has 0.25 of the cycle (was 0.15), with the push 0.45 to 0.75.
- Crossover cadence is capped at 1.4 a second (0.8 + 0.07·v).
- The stride arm swing is a sinusoid of 0.68 rad × amplitude, peaking when the same-side push ends; it was the difference of leg extensions × 0.95. At 9.5 m/s the free hand had reached 8 cm a frame, about 4.8 m/s.
- Tests: stride footYaw changes by under 0.01 rad per 0.001 phase at 5, 7 and 9 m/s. Steady sprint, hard turn, lateral crossover, backward and fast glide, for three body sizes, move no foot, hand or pelvis more than 6 cm per 60 Hz frame.

### Updated thresholds (changes from the earlier table)

| Item | Value | Why |
|---|---|---|
| impulse | raw > 14 m/s² → passive 0.6 s (ends on raw > 1) | Body contact gives 30·Δv per tick (45+ for a 1.5 m/s shove); engine skating stays under about 12 |
| crossover start | raw in (−2, 14), not passive; turning also smoothed > −2 | Speed held by effort, not decaying from a shove |
| crossover stay | until a stop takes over (no acceleration condition) | No 0.1 s glide between a crossover and a stop; frame-rate independent |
| crossover cadence | 0.8 + 0.07·v, max 1.4 /s | Recovery stays under 6 cm a frame at 9 m/s |
| stop start | smoothed < −4, raw < −2, speed > 1.5, not passive | |
| stride start | smoothed > 2.0, raw > −0.5, not passive | |
| blend | 0.35 s; falls and getting up 0.65 s | 6 cm per frame bound |
| skate heading | follows travel within 100° of facing, hips open by half | Planted blades within 25° of travel |
| travel followed | τ 0.15 s, at most 4 rad/s | |
| speed for pose depth | τ 0.15 s | Collision jolts |
| lift fade | 6 cm | Pelvis rises smoothly at push-off |

### For Task 3
- **Reset after a seek.** After any seek, or any jump in display time, reset the gait with `initialGait()` (or step it once with zero motion and dt 0, then rebuild). `motionOf` across a seek sees a facing jump and gives a huge turn-rate spike, and an impulse-sized speed change that would start a passive window.
- `GaitState.from` is now `MixPart[]`, and `fromSide` is gone. New optional fields: `speed`, `passive`, `blendT`, `blendDur`. `poseOf` still accepts a bare `{phase, style, styleT, lean, roll}`.
- New exports: `forwardHeading` and `backwardHeading` (skate heading for a travel yaw), and `MixPart`.

### Real game after the fixes (10 minutes, all on-ice skaters, 60 fps, two frames per tick, 185/90 body)
- Shares: glide 27%, crossover 23%, stand 19%, stride 15%, stop 10%, backward 5%.
- Style changes: 1.26 per skater-second (75 a minute; unchanged, the engine's motion drives it). Median durations: stride 0.85 s, crossover 0.80 s, backward 0.67 s, glide/stand/stop 0.47 s.
- Per-frame largest move of any foot, hand or the pelvis: median 1.6 cm, p99 5.5 cm, p99.9 7.0 cm.
- Worst single frame: 8.0 cm, during a stride-to-crossover blend at 9.3 m/s. Before this round's speed smoothing the worst was 21.7 cm, at a stop during a collision.

### Commands and output
- `npx vitest run src/gait.test.ts` (in apps/viewer) with the new tests against the previous commit's gait.ts (RED): `Tests 9 failed | 24 passed (33)`. Every new test fails on its own finding:
  - I-1: 0.0137 > 0.002;
  - I-2: stride/stop 9.8 cm;
  - I-3: "side v0=1.5 30 Hz saw stand,crossover";
  - I-4: backward at −150° 25.4°;
  - M-1: 144 Hz change 6 off by 0.49 s;
  - M-2: phase null;
  - M-3: hipRoll 0.92;
  - M-4: yaw step 0.05.

  The ninth failure is the full-blend sweep using the new `from` shape. The jolt scene alone fails at 12.4 cm with speed smoothing disabled.
- `npm -w apps/viewer run test`: `Test Files 3 passed (3)`, `Tests 41 passed (41)`.
- `npm -w apps/viewer run typecheck`: exit 0.
- Root `npm test`: engine 227 passed, debug 10 passed, viewer 41 passed; wall time 69 s. Root `npm run typecheck`: exit 0.

### Concerns remaining
- Styles still change about once every 0.8 s in a real game. This is the engine's bang-bang motion; see the main concerns.
- The worst real-game frame (8 cm) is a high-speed blend between two fast-moving styles, above the 6 cm scripted bound. Lengthening `GAIT.blend` would reduce it at the cost of slower changes.
