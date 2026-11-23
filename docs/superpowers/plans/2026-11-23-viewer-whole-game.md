# 3D Viewer Milestone 2: The Whole Game On The Ice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser page that shows a full game in 3D: every skater and both goalies as jointed figures, the puck on the carrier's stick, a simple arena, pickable camera angles, playback controls and a score bug.

**Architecture:** Builds on milestone 1 in `apps/viewer` (deterministic playback, the gait and pose maths, the skater rig, the rink). This milestone adds a sprint style and a puck carry to the pose maths, a goalie figure with save poses, a scene module that owns every figure and the puck and updates them from a playback frame, an arena, a camera module of named angles, and a watch page that replaces the skating test page as the default while keeping the skating test reachable.

**Tech Stack:** TypeScript strict, Vite 5, three.js 0.170.0 (pinned), Vitest, vite-plugin-singlefile, Playwright with the pre-installed Chromium for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-23-3d-viewer-design.md` (milestone 2). Owner feedback after the skating test and the interfaces from milestone 1: `docs/superpowers/specs/notes-3d-viewer.md` ("Skating test verdict") and `docs/superpowers/reviews/2026-11-23-viewer-m1-rulings-and-open-items.md`.

## Global Constraints

- The viewer never decides anything about the game. Nothing under `packages/engine/src` changes. Engine problems seen in 3D are written in the report, not fixed here.
- Import the engine only from `@hockey/engine`.
- The same seed gives the same final score with the viewer running as `simulateGame` gives; what is drawn may differ from engine state only cosmetically (the carried puck on the blade) and must return to the engine's exact position whenever the puck is not carried.
- Units as the engine. Engine x is world X, engine y is world Z, up is world Y.
- No imported 3D models, textures, motion data or network requests; no `localStorage`; no code from `docs/prototype/shift-prototype.html`.
- Pose and gait maths, camera rules and puck-carry maths are pure functions (no three.js, no DOM) with unit tests.
- Every existing test keeps passing with its assertions unchanged, including the continuity bounds in `gait.test.ts` (no foot, hand or hip moving more than 6 cm in one 60 Hz frame; hip height changing less than 2 mm per 0.001 of phase; planted blades within 25 degrees of travel).
- Skating style comes from actual motion; `SkaterState.mode` is only a hint. A gait is reset with `initialGait()` after any seek, new game, or a skater coming onto the ice.
- Root `npm test` and `npm run typecheck` cover `apps/viewer` and stay under 120 seconds.
- A laptop is the minimum: with 12 skaters and 2 goalies as full figures the page must reach at least 20 frames a second in headless Chromium's software renderer at 1280 x 720 (the skating test managed about 23 with one figure), which means shared geometries and materials and no per-frame allocation in the update path. Report what it reached.
- The page is for a non-developer: plain labels, system font, light and dark schemes with colour tokens on `:root` (dark redefined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`) and an explicit body background, no horizontal page scroll at laptop or phone width, a two-to-four-word `<title>`.

## Review Focus

- A line change: skaters stepping on and off at the bench must appear and disappear cleanly, with no figure left frozen on the ice, no figure posed mid-stride at the origin, and no gait carried over from a previous shift.
- A seek across a period break or a goal: every figure, the puck and the score bug show the state at the new time at once, with no blend from the old positions.
- The carried puck: when the carrier passes, shoots, is checked or loses it, the drawn puck must not jump; when nobody carries it the drawn puck is exactly the engine's puck.
- A goalie pose that ends (`poseT` reaching 0) returns to the stance smoothly; a goalie is never drawn with a skater's stride.
- Two figures overlapping in a battle must not flicker or z-fight; shadows must not stack into a black patch.

---

### Task 1: Sprint style and the puck carry (pure maths)

**Files:**
- Modify: `apps/viewer/src/gait.ts`
- Create: `apps/viewer/src/carry.ts`
- Test: `apps/viewer/src/gait.test.ts` (add cases only), `apps/viewer/src/carry.test.ts`

**Interfaces:**
- Consumes: milestone 1 `Motion`, `GaitState`, `Pose`, `poseOf`, `stepGait`, `BodyDims`.
- Produces:
  - `Style` gains `'sprint'`; `STYLES` includes it. A skater enters `sprint` from `stride` when he is at high effort near his top speed (the builder picks thresholds from the engine's real speeds: top speeds are about 8 to 9.5 m/s) and leaves it with hysteresis. The sprint pose: deeper forward lean than the stride, head down (`look` pitched toward the ice ahead), longer and harder pushes, a bigger arm drive, and, when `opts.hasPuck` is not true, the stick carried in the top hand only with the blade off the ice. `PoseOptions` gains `hasPuck?: boolean`. With `hasPuck` true in any style, both hands are on the stick and the blade is on the ice at the carry point.
  - `carry.ts`:
    - `carryPoint(pose: Pose): { x: number; z: number }` the blade's position on the ice in the body frame for a pose (x forward, z to his right).
    - `stickhandle(t: number, speed: number): { dx: number; dz: number }` a small, smooth, bounded side-to-side offset (under 0.18 m) that slows as speed rises.
    - `CarryBlend = { w: number; from: { x: number; z: number } }` and `stepCarry(b: CarryBlend, carried: boolean, enginePuck: { x: number; z: number }, bladeWorld: { x: number; z: number }, dt: number): { blend: CarryBlend; drawn: { x: number; z: number } }`: while carried, the drawn puck eases from where it was onto the blade (reaching it within 0.15 s); when the carry ends, it eases from the blade back to the engine's puck within 0.1 s and is then exactly the engine's puck.

- [ ] **Step 1: Write the failing tests**

```ts
// gait.test.ts additions
it('flat-out skating is a sprint, and easing off returns to a stride or glide', () => {
  let g = initialGait();
  for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 8.8, forward: 8.8, accelAlong: 2.5 }), 1 / 60);
  expect(g.style).toBe('sprint');
  for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 5, forward: 5, accelAlong: 0 }), 1 / 60);
  expect(['stride', 'glide']).toContain(g.style);
});
it('a moderate stride is not a sprint', () => {
  let g = initialGait();
  for (let i = 0; i < 120; i++) g = stepGait(g, m({ speed: 5.5, forward: 5.5, accelAlong: 2 }), 1 / 60);
  expect(g.style).toBe('stride');
});
it('the sprint leans further forward and looks down more than the stride', () => {
  const d = bodyDims(185, 90);
  const s = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.3 }, m({ speed: 9, forward: 9, accelAlong: 2 }), d);
  const t = poseOf({ ...initialGait(), style: 'stride', styleT: 1, phase: 0.3 }, m({ speed: 6, forward: 6, accelAlong: 2 }), d);
  expect(s.pitch).toBeGreaterThan(t.pitch + 0.08);
  expect((s.look?.pitch ?? 0)).toBeGreaterThan((t.look?.pitch ?? 0));
});
it('with the puck the blade is on the ice in every moving style; sprinting without it the blade is up', () => {
  const d = bodyDims(185, 90);
  for (const style of ['glide', 'stride', 'sprint', 'crossover', 'backward'] as const) {
    const p = poseOf({ ...initialGait(), style, styleT: 1, phase: 0.4 }, m({ speed: 7, forward: 7 }), d, { hasPuck: true });
    expect(p.blade.y).toBeLessThan(0.03);
  }
  const free = poseOf({ ...initialGait(), style: 'sprint', styleT: 1, phase: 0.4 }, m({ speed: 9, forward: 9, accelAlong: 2 }), d);
  expect(free.blade.y).toBeGreaterThan(0.1);
});

// carry.test.ts
it('the carry point is ahead of him and on his forehand side', () => {
  const p = poseOf({ ...initialGait(), style: 'glide', styleT: 1 }, m({ speed: 6, forward: 6 }), bodyDims(185, 90), { hasPuck: true });
  const c = carryPoint(p);
  expect(c.x).toBeGreaterThan(0.4); expect(c.x).toBeLessThan(1.2); expect(Math.abs(c.z)).toBeGreaterThan(0.1);
});
it('stickhandling is small, smooth and bounded', () => {
  let prev = stickhandle(0, 3);
  for (let t = 1 / 60; t < 4; t += 1 / 60) { const s = stickhandle(t, 3); expect(Math.hypot(s.dx, s.dz)).toBeLessThan(0.18); expect(Math.hypot(s.dx - prev.dx, s.dz - prev.dz)).toBeLessThan(0.03); prev = s; }
});
it('the drawn puck eases onto the blade, and back to the engine puck when the carry ends, without a jump', () => {
  let b: CarryBlend = { w: 0, from: { x: 0, z: 0 } }, last = { x: 0, z: 0 }, worst = 0;
  const step = (carried: boolean, eng: { x: number; z: number }, blade: { x: number; z: number }) => { const r = stepCarry(b, carried, eng, blade, 1 / 60); worst = Math.max(worst, Math.hypot(r.drawn.x - last.x, r.drawn.z - last.z)); b = r.blend; last = r.drawn; return r.drawn; };
  for (let i = 0; i < 30; i++) step(true, { x: 0, z: 0 }, { x: 0.8, z: 0.3 });
  expect(Math.hypot(last.x - 0.8, last.z - 0.3)).toBeLessThan(0.01);
  for (let i = 0; i < 12; i++) step(false, { x: 0.1, z: 0 }, { x: 0.8, z: 0.3 });
  expect(last).toEqual({ x: 0.1, z: 0 });
  expect(worst).toBeLessThan(0.2);
});
```

The tests reuse the existing `m()` helper. Where milestone 1's real field names differ (for example how `look` is shaped), the builder adapts the test to the real shape without changing what it checks.

- [ ] **Step 2: Run them.** `npm -w apps/viewer run test` Expected: the new cases FAIL.
- [ ] **Step 3: Implement.** Blends into and out of `sprint` obey the existing continuity bounds.
- [ ] **Step 4: Run tests and typecheck.** `npm test && npm run typecheck` Expected: PASS, all earlier assertions unchanged.
- [ ] **Step 5: Commit** `feat: sprint style and the puck carried on the blade`

### Task 2: The goalie figure

**Files:**
- Create: `apps/viewer/src/goalie-pose.ts`, `apps/viewer/src/goalie-rig.ts`
- Test: `apps/viewer/src/goalie-pose.test.ts`, `apps/viewer/src/goalie-rig.test.ts`

**Interfaces:**
- Consumes: `GoalieState` (`pos`, `vel`, `facing`, `pose`: `'stance' | 'butterfly' | 'glove' | 'blocker' | 'pad' | 'cover'`, `poseT`), `PlayerDef`, `bodyDims`, milestone 1 rig helpers and shared materials.
- Produces:
  - `goalie-pose.ts` (pure): `GoalieGait = { pose: GoaliePose; t: number; from: GoaliePose; shuffle: number }`, `initialGoalieGait()`, `stepGoalie(g, s: { pose: GoaliePose; poseT: number; lateral: number; speed: number }, dt): GoalieGait` (eases between poses in about 0.12 s into a save and about 0.3 s back to the stance; `shuffle` advances with sideways movement), `goaliePoseOf(g, d: BodyDims, catches: 'L' | 'R'): GoalieFigurePose` giving hip height, torso pitch, each leg's knee and pad placement, glove and blocker hand positions and the stick blade, all in the body frame.
  - `goalie-rig.ts`: `createGoalieRig(def: PlayerDef, colors: RigColors): GoalieRig` with the same `root` / `apply(pose, worldX, worldZ, facing)` / `dispose()` shape as the skater rig. The figure: mask, chest protector (bulkier torso), big leg pads, a catching glove and a blocker, a goalie stick with a wide paddle, skates.
  - Poses read clearly: `stance` (knees bent, pads together-ish, glove up, stick on the ice), `butterfly` (knees on the ice, pads flared flat to both sides, torso upright), `glove` and `blocker` (that hand reaching to its side, the body still square), `pad` (one pad kicked or slid to a side), `cover` (down over the puck, glove on the ice).

- [ ] **Step 1: Write the failing tests**

```ts
// goalie-pose.test.ts
it('eases into a save and back to the stance, with no jump', () => {
  let g = initialGoalieGait(); const d = bodyDims(188, 88); let last = goaliePoseOf(g, d, 'L').hipY, worst = 0;
  const run = (pose: GoaliePose, poseT: number, n: number) => { for (let i = 0; i < n; i++) { g = stepGoalie(g, { pose, poseT, lateral: 0, speed: 0 }, 1 / 60); const h = goaliePoseOf(g, d, 'L').hipY; worst = Math.max(worst, Math.abs(h - last)); last = h; } };
  run('butterfly', 0.5, 30); const down = last; run('stance', 0, 40);
  expect(down).toBeLessThan(goaliePoseOf(initialGoalieGait(), d, 'L').hipY - 0.2);
  expect(last).toBeCloseTo(goaliePoseOf(initialGoalieGait(), d, 'L').hipY, 2);
  expect(worst).toBeLessThan(0.06);
});
it('the butterfly puts both knees on the ice with the pads flared', () => {
  const p = goaliePoseOf({ ...initialGoalieGait(), pose: 'butterfly', from: 'butterfly', t: 1 }, bodyDims(188, 88), 'L');
  for (const l of p.legs) expect(l.knee.y).toBeLessThan(0.12);
  expect(Math.abs(p.legs[0].foot.z - p.legs[1].foot.z)).toBeGreaterThan(0.9);
});
it('a glove save reaches to the catching side, mirrored for the other hand', () => {
  const at = (c: 'L' | 'R') => goaliePoseOf({ ...initialGoalieGait(), pose: 'glove', from: 'glove', t: 1 }, bodyDims(188, 88), c).glove;
  expect(at('L').z).toBeLessThan(-0.5); expect(at('R').z).toBeGreaterThan(0.5); expect(at('L').y).toBeGreaterThan(0.6);
});
it('no pose produces NaN or puts a pad below the ice', () => {
  for (const pose of ['stance', 'butterfly', 'glove', 'blocker', 'pad', 'cover'] as const) for (let t = 0; t <= 1; t += 0.1) {
    const p = goaliePoseOf({ ...initialGoalieGait(), pose, from: 'stance', t }, bodyDims(188, 88), 'L');
    expect(Number.isFinite(p.hipY)).toBe(true); for (const l of p.legs) { expect(l.foot.y).toBeGreaterThanOrEqual(0); expect(l.knee.y).toBeGreaterThanOrEqual(0); }
  }
});

// goalie-rig.test.ts
it('the goalie figure rests on the ice and is clearly wider than a skater of the same size', () => {
  const g = createGoalieRig(goalieDef(188, 88), colors); g.apply(goaliePoseOf(initialGoalieGait(), bodyDims(188, 88), 'L'), 0, 0, 0); g.root.updateMatrixWorld(true);
  const gb = new THREE.Box3().setFromObject(g.root);
  const s = createSkaterRig(skaterDef(188, 88), colors); s.apply(poseOf(initialGait(), standing, bodyDims(188, 88)), 0, 0, 0); s.root.updateMatrixWorld(true);
  const sb = new THREE.Box3().setFromObject(s.root);
  expect(gb.min.y).toBeGreaterThan(-0.02); expect(gb.min.y).toBeLessThan(0.05);
  expect(gb.max.z - gb.min.z).toBeGreaterThan((sb.max.z - sb.min.z) * 1.15);
});
```

Whether the engine records which hand a goalie catches with is for the builder to check in `PlayerDef`; if it does not, catch with the left and note it in the report.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests and typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: goalie figure with save poses`

### Task 3: The scene: every figure, the puck and the arena

**Files:**
- Create: `apps/viewer/src/scene.ts`, `apps/viewer/src/arena.ts`
- Modify: `apps/viewer/src/rig.ts` (shared geometries and materials across figures; a name bar on the back above the number), `apps/viewer/src/rink.ts` only if the arena needs a hook
- Test: `apps/viewer/src/scene.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2; milestone 1 `Frame`, `motionOf`, `stepGait`, `poseOf`, `createSkaterRig`, `buildRink`.
- Produces:
  - `scene.ts`: `createGameScene(setup: GameSetup, opts?: { quality?: 'low' | 'high' }): GameScene` with `root: THREE.Group`, `update(frame: Frame, dt: number): void` (dt is game time: display time times playback speed), `reset(): void` (after a seek or new game: every gait, goalie gait and carry blend back to initial, positions snapped), `puckWorld(): THREE.Vector3`, `figure(id: string): { position: THREE.Vector3; facing: number; onIce: boolean } | undefined`, `dispose(): void`.
  - `update` blends each skater's and goalie's position and facing between `frame.prev` and `frame.next` by `frame.alpha`, steps gaits with the blended motion, applies poses (mirrored for right shots), shows only players on the ice, resets a skater's gait when he comes onto the ice, draws the puck from `stepCarry` (on the carrier's blade while carried, the engine's puck otherwise, with its height when it is in the air), and gives the carrier `hasPuck`.
  - Home and away colours: the builder picks two clearly different sets (home darker jersey, away white jersey with coloured trim) from simple constants; team colours as data arrive with the league stage.
  - `arena.ts`: `buildArena(quality): THREE.Group`: stands rising behind the boards on all sides with a still crowd as coloured blocks (one instanced mesh), glass above the boards (cheap, mostly transparent, omitted on `low` if it costs frames), a scoreboard hanging over centre ice, a placeholder crest at centre ice, benches and penalty boxes as simple shapes on the bench side, and lighting that reads like an arena. `low` has no real-time shadows (blob shadows only) and fewer crowd blocks.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows exactly the players who are on the ice, at the engine positions', () => {
  const pb = createPlayback(setup(5)); const sc = createGameScene(setup(5)); pb.seek(3000); sc.reset(); sc.update(pb.frame(), 0);
  const st = pb.frame().prev;
  for (const s of st.skaters) { const f = sc.figure(s.id)!; expect(f.onIce).toBe(s.onIce); if (s.onIce) { expect(f.position.x).toBeCloseTo(s.pos.x, 3); expect(f.position.z).toBeCloseTo(s.pos.y, 3); } }
  expect(st.skaters.filter(s => s.onIce).length).toBeGreaterThanOrEqual(10);
});
it('when nobody carries the puck the drawn puck is the engine puck; when carried it is within a stick length of the carrier', () => {
  const pb = createPlayback(setup(5)); const sc = createGameScene(setup(5)); let loose = 0, carried = 0;
  for (let t = 600; t < 9000; t += 37) { pb.seek(t); sc.reset(); for (let i = 0; i < 20; i++) { pb.advance(1 / 60); sc.update(pb.frame(), 1 / 60); }
    const f = pb.frame(), st = f.next, p = sc.puckWorld();
    if (st.carrierId == null && f.prev.carrierId == null) { const ex = f.prev.puck.pos.x + (st.puck.pos.x - f.prev.puck.pos.x) * f.alpha; if (Math.abs(p.x - ex) < 0.02) loose++; else throw new Error('loose puck drawn away from the engine puck at tick ' + t); }
    else if (st.carrierId != null && f.prev.carrierId === st.carrierId) { const c = sc.figure(st.carrierId)!; expect(Math.hypot(p.x - c.position.x, p.z - c.position.z)).toBeLessThan(1.6); carried++; } }
  expect(loose).toBeGreaterThan(20); expect(carried).toBeGreaterThan(20);
});
it('a seek snaps: after reset and one update nothing is still blending from the old place', () => {
  const pb = createPlayback(setup(5)); const sc = createGameScene(setup(5)); pb.seek(2000); sc.reset(); sc.update(pb.frame(), 0);
  pb.seek(60000); sc.reset(); sc.update(pb.frame(), 0);
  const st = pb.frame().prev; for (const s of st.skaters) if (s.onIce) expect(sc.figure(s.id)!.position.x).toBeCloseTo(s.pos.x, 3);
});
it('the update path does not grow the scene', () => {
  const pb = createPlayback(setup(5)); const sc = createGameScene(setup(5)); pb.seek(1000); sc.reset();
  let n0 = 0; sc.root.traverse(() => n0++); for (let i = 0; i < 600; i++) { pb.advance(1 / 30); sc.update(pb.frame(), 1 / 30); }
  let n1 = 0; sc.root.traverse(() => n1++); expect(n1).toBe(n0);
});
```

The builder adapts field names (`carrierId`, `puck.pos`) to the real `GameState` without changing what is checked, and keeps these tests fast by sharing one playback.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests and typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: the whole game as figures, the puck on the stick, and an arena`

### Task 4: Cameras, the watch page, and looking at it

**Files:**
- Create: `apps/viewer/src/cameras.ts`, `apps/viewer/src/watch.ts`, `apps/viewer/skating.html` (the milestone 1 page, kept reachable), `apps/viewer/scripts/watch-shots.mjs`
- Modify: `apps/viewer/index.html` (becomes the watch page), `apps/viewer/src/main.ts` (moves behind `skating.html`), the Vite configs (two pages in dev; the single-file build is the watch page; a second single file for the skating test is optional)
- Test: `apps/viewer/src/cameras.test.ts`

**Interfaces:**
- Consumes: Task 3 `createGameScene`, `GameScene`; milestone 1 `createPlayback`.
- Produces:
  - `cameras.ts` (pure): `CameraName = 'broadcast' | 'overhead' | 'netHome' | 'netAway' | 'iceLevel' | 'follow'`, `CameraInput = { puck: Vec3; followed?: { pos: Vec3; facing: number; vel: Vec3 }; attackingRight: boolean }`, `CameraPose = { pos: Vec3; look: Vec3; fov: number }`, `cameraTarget(name, input): CameraPose`, and `easeCamera(current: CameraPose, target: CameraPose, dt: number, snap: boolean): CameraPose`.
    - `broadcast`: high on the side opposite the benches, panning along the rink with the puck, looking slightly ahead of play, never past the ends.
    - `overhead`: straight down over the puck's half of the rink, wide enough to see all the skaters in the zone.
    - `netHome` / `netAway`: behind and above that net, looking up ice.
    - `iceLevel`: low along the boards on the broadcast side, near the puck.
    - `follow`: behind and above the followed player along his travel, as in the skating test.
    - Every angle stays inside the arena and above the ice.
  - `watch.ts` and `index.html`: the 3D picture (16:9, resizes, pixel ratio capped at 2); a score bug over the picture (team names, score, period, clock, shots); controls: Play/Pause, Speed (0.5x, 1x, 2x, 4x), a time scrubber across the game with period marks and a mark at each goal, Skip to end, Camera (the six angles), Follow (pick a player, used by the follow angle), Quality (Low, High), Seed and New game; a link to the skating test page. Changing camera or seeking snaps the camera; otherwise it eases. After a seek the scene is reset. A `window.__watch` hook (seek, setCamera, setFollow, step, renderOnce, fps) for deterministic screenshots.

- [ ] **Step 1: Write the failing tests**

```ts
const input = (x: number, z: number): CameraInput => ({ puck: { x, y: 0, z }, attackingRight: true, followed: { pos: { x, y: 0, z }, facing: 0, vel: { x: 5, y: 0, z: 0 } } });
it('every angle stays above the ice and looks at something near the play', () => {
  for (const name of ['broadcast', 'overhead', 'netHome', 'netAway', 'iceLevel', 'follow'] as const) for (const [x, z] of [[0, 0], [25, 10], [-28, -12], [29, 0]] as const) {
    const c = cameraTarget(name, input(x, z));
    expect(c.pos.y).toBeGreaterThan(0.5); expect(Number.isFinite(c.pos.x + c.pos.z + c.look.x + c.look.z)).toBe(true);
    if (name !== 'netHome' && name !== 'netAway') expect(Math.hypot(c.look.x - x, c.look.z - z)).toBeLessThan(12);
  }
});
it('the broadcast camera pans with the puck but never past the ends of the rink', () => {
  const a = cameraTarget('broadcast', input(-20, 0)), b = cameraTarget('broadcast', input(20, 0)), e = cameraTarget('broadcast', input(200, 0));
  expect(b.look.x).toBeGreaterThan(a.look.x + 20); expect(e.look.x).toBeLessThan(31);
  expect(Math.sign(a.pos.z)).toBe(Math.sign(b.pos.z));
});
it('easing moves toward the target without overshooting, and snap jumps', () => {
  const from: CameraPose = { pos: { x: 0, y: 10, z: 20 }, look: { x: 0, y: 0, z: 0 }, fov: 40 }, to: CameraPose = { pos: { x: 30, y: 10, z: 20 }, look: { x: 30, y: 0, z: 0 }, fov: 40 };
  let c = from; for (let i = 0; i < 600; i++) { const n = easeCamera(c, to, 1 / 60, false); expect(n.pos.x).toBeGreaterThanOrEqual(c.pos.x); expect(n.pos.x).toBeLessThanOrEqual(30.0001); c = n; }
  expect(c.pos.x).toBeCloseTo(30, 1);
  expect(easeCamera(from, to, 1 / 60, true)).toEqual(to);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the cameras and the watch page.**
- [ ] **Step 4: Run tests, typecheck, build.** `npm test && npm run typecheck && npm -w apps/viewer run build:single` Expected: PASS; the single file is the watch page with no external URLs.
- [ ] **Step 5: Look at it.** Run `node apps/viewer/scripts/watch-shots.mjs` against the single-file page in headless Chromium, driving it through `window.__watch`: from each of the six cameras capture sequences (6 to 8 consecutive frames) of a rush with the puck on a stick, a faceoff, a line change at the benches, a shot and save, a goal, and a board battle; plus the page at 1280 and 390 px in light and dark. Save them to the scratch directory named in the dispatch. Read them critically as a hockey viewer: is the puck on the carrier's blade, do goalies look like goalies and move into their saves, do figures appear and vanish cleanly at the bench, can the two teams be told apart at broadcast distance, are heights and builds visibly different, does the sprint read as head-down and powerful, does anything float, sink, flicker or face the wrong way. Fix what is wrong in the viewer and repeat. Measure and report the frame rate with all 14 figures at both quality settings. List what still looks wrong, and anything about the engine's play that looks wrong in 3D, in the report.
- [ ] **Step 6: Commit** `feat: camera angles and the watch page`
