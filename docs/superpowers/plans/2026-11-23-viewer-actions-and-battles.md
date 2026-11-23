# 3D Viewer Milestone 3: Actions And Battles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The figures play hockey: they pass and receive, wind up and shoot, save, poke check, hit and fall, block shots, and fight board battles in which a viewer can see who is pinning, who is digging and who wins.

**Architecture:** First a behaviour-preserving restructure of `apps/viewer`: a pure animator that turns engine samples plus an event timeline into a pose per figure, with skating as the base layer and actions and contest stances as overlays mixed before the body is fitted; the puck machine and the camera operator become pure modules; the watch page is split. Then four tasks add overlays to that animator, each driven only by engine state, events and contest stages and roles, never deciding anything.

**Tech Stack:** TypeScript strict, Vite 5, three.js 0.170.0 (pinned), Vitest, Playwright with the pre-installed Chromium for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-23-3d-viewer-design.md` (milestone 3; goal 3 "readable battles"). What the restructure must cover and the open items it inherits: `docs/superpowers/reviews/2026-11-23-viewer-m2-rulings-and-open-items.md` and `docs/superpowers/reviews/2026-11-23-viewer-m2-final-review.md` (finding I5 and "New Breakage" items in the fix report).

## Global Constraints

- The viewer never decides anything about the game. Nothing under `packages/engine/src` changes. Every animation is driven by engine state (`GameState`: skaters, goalies, puck, `contests` with kind, stage, stage time, roles and spot) and the recorded event log (`GameEvent`: `release`, `pass`, `shot`, `save`, `goal`, `miss`, `post`, `block`, `hit`, `turnover`, `battle`, `contestStart`, `contestEnd`, `faceoff`, `freeze`). Engine problems seen in 3D go in the report.
- Import the engine only from `@hockey/engine`.
- Same seed, same final score with the viewer running, including after seeks. A loose puck is drawn exactly at the engine puck. Figures are drawn at their engine positions and facings: an overlay may lean, reach and turn the upper body, and may shift the drawn body by at most 0.35 m from the engine position for contact (two bodies must not be drawn inside each other), easing back afterwards.
- An action that the event log shows is coming may start before its event (a wind-up before a `release`, a goalie's reach before a `save`), which is why the animator reads the timeline; nothing may be shown that the engine did not then do.
- Pose maths, the animator, the puck machine, the camera operator and the timeline are pure modules (no three.js, no DOM) with unit tests. three.js stays in rigs, scene, arena and the page.
- Every existing test keeps passing with its assertions unchanged, unless this plan says a test moves with the code it covers; the continuity bounds stay (scripted gait bounds; the real-game bound of 10 cm per 60 Hz frame through the scene, which overlays must not break outside the frames of a hit impact or a fall, where a stated larger bound applies).
- A seek shows at once what play would have shown: overlays are restored by the pre-roll like gaits are.
- Root `npm test` and `npm run typecheck` stay under 120 seconds. Low quality stays at or above 20 frames a second with 14 figures in headless software rendering.
- The watch page keeps its behaviour and its `window.__watch` hook. The skating test page is frozen: keep it compiling, do not extend it.

## Review Focus

- An action interrupted by another (a shot wind-up cut off by a hit; a pass reception into an immediate poke check; a battle ended by a whistle): the pose must blend, not snap, and no overlay may be left stuck on.
- A contest whose participant leaves the ice, falls, or is replaced mid-stage; a contest ended by a period break or a cut.
- Two or three figures in one board battle: bodies not drawn inside each other or inside the boards, sticks not through bodies in the readable frames, each role visibly different.
- A seek into the middle of a wind-up, a save, a hit recovery or a dig: the pose matches play.
- Left and right shots, and both goalie hands if the engine ever provides them: every overlay mirrors correctly.

---

### Task 1: Restructure for actions (behaviour-preserving)

**Files:**
- Create: `apps/viewer/src/timeline.ts`, `apps/viewer/src/animator.ts`, `apps/viewer/src/pose-mix.ts`, `apps/viewer/src/operator.ts`, `apps/viewer/src/page/{renderer,lifecycle,hud,timebar,controls}.ts`
- Modify: `apps/viewer/src/gait.ts` (split: style machine stays; key-pose generators and body fit move or are exported), `carry.ts` (the pick-up and release machine moves in from `scene.ts`), `scene.ts` (becomes sample → animator → rig), `watch.ts` (becomes the thin entry that wires the page modules), `record-game.ts`, `cameras.ts` only if the operator needs a helper
- Test: `timeline.test.ts`, `animator.test.ts`, `pose-mix.test.ts`, `operator.test.ts`, additions to `carry.test.ts`, `record-game.test.ts`

**Interfaces:**
- Produces:
  - `timeline.ts` (pure): `buildTimeline(events: readonly GameEvent[]): Timeline`; `Timeline.goals`, `Timeline.shotsAt(tick): { home: number; away: number }`, `Timeline.scoreAt(tick)`, `Timeline.forPlayer(id, fromTick, toTick): GameEvent[]`, `Timeline.next(type, afterTick, withinTicks, playerId?): GameEvent | undefined`, `Timeline.last(type, atOrBeforeTick, withinTicks, playerId?): GameEvent | undefined`, `Timeline.contest(contestId): { start: GameEvent; end?: GameEvent }`. Lookups are indexed, not linear scans per frame.
  - `pose-mix.ts` (pure): the raw pose type (pelvis height and tilt, torso pitch/roll/twist, head look, each foot and its yaw, each hand, stick top and blade), `mixRaw(a, b, w)`, `fitBody(raw, dims): SkaterPose` (the two-bone solves and ground contact, what `fit` does today), and `bladeAt(raw, target: Vec3, dims): RawPose` which places the blade at a point on or above the ice and solves the hands back from it, clamped to reach.
  - `animator.ts` (pure): `SkaterAnim` (per-skater animation state: gait, carry flag, overlay slots), `initialSkaterAnim()`, `stepSkater(anim, sample: SkaterSample, ctx: AnimContext, dt): SkaterAnim`, `poseSkater(anim, sample, ctx, dims): { pose: SkaterPose; offset: { x: number; z: number } }`. `SkaterSample` is the blended engine state for one skater (position, velocity, facing, down, on-ice, shoots) and `AnimContext` gives read access to the frame's other skaters, goalies, puck, contests, the timeline and the current tick. An overlay is `{ id: string; weight(anim, sample, ctx): number; apply(raw, anim, sample, ctx): RawPose }` registered in a list; this task registers exactly one, the existing faceoff crouch, moved out of `scene.ts`. `GoalieAnim` likewise wraps the goalie gait.
  - `carry.ts`: `PuckDraw` state and `stepPuckDraw(state, input, dt)` covering carried, pick-up, release and loose, moved from `scene.ts` with its behaviour and numbers unchanged.
  - `operator.ts` (pure): `CameraOperator` state and `stepOperator(state, input, dt): { pose: CameraPose; cut: boolean }` holding the cut rules, follow anchoring and focus easing that `watch.ts` has today, with cut thresholds expressed as speeds (m/s of the focus point) rather than per-frame distances. The scene reports the kind of each cut (`'restart' | 'ends' | 'jump'`), and the operator hard-cuts only on `restart` and `ends`; on `jump` it eases.
- Fixes folded in (from the milestone 2 re-review): a watchdog (25 s) and a `messageerror` handler in the worker path of `record-game.ts`, both falling back to the main thread, with a test that distinguishes the fallback from a propagated error; `endScrub` seeks only if the time bar's value changed during that drag; the test-suite recording cache writes to a temporary name and renames, never deleting a directory another run may be using.

- [ ] **Step 1: Pin today's picture.** Before moving anything, add `apps/viewer/src/picture.test.ts`: for seeds 5 and 42, over 40 seconds of real play from tick 3000 at 60 Hz through `scene.update`, record for every on-ice skater and both goalies the pose numbers that reach the rig (hip height, torso pitch, both feet, both hands, blade) and the drawn puck, rounded to 1e-6, hash them, and store the hashes as constants in the test. Run it: PASS. This is the behaviour-preservation check for the whole task.
- [ ] **Step 2: Write the failing tests for the new modules**

```ts
// timeline.test.ts
it('answers score and shots as of any tick, and finds the next and last event for a player', () => {
  const rec = recorded(42); const tl = buildTimeline(rec.events); const g = tl.goals[0]!;
  expect(tl.scoreAt(g.tick - 1).home + tl.scoreAt(g.tick - 1).away + 1).toBe(tl.scoreAt(g.tick).home + tl.scoreAt(g.tick).away);
  const rel = rec.events.find(e => e.type === 'release')!;
  expect(tl.next('release', rel.tick - 10, 30, rel.playerId!)).toBe(rel);
  expect(tl.next('release', rel.tick, 30, rel.playerId!)).not.toBe(rel);
  expect(tl.last('release', rel.tick + 5, 30, rel.playerId!)).toBe(rel);
  expect(tl.scoreAt(rec.totalTicks)).toEqual(rec.result.score);
});
// pose-mix.test.ts
it('bladeAt puts the blade on the target when it is in reach and as near as reach allows when it is not', () => {
  const d = bodyDims(185, 90), raw = rawOf('glide', d);
  const near = fitBody(bladeAt(raw, { x: 0.8, y: 0, z: -0.3 }, d), d);
  expect(Math.hypot(near.blade.x - 0.8, near.blade.z + 0.3)).toBeLessThan(0.02); expect(near.blade.y).toBeLessThan(0.03);
  const far = fitBody(bladeAt(raw, { x: 4, y: 0, z: 0 }, d), d);
  expect(far.blade.x).toBeLessThan(2.2); expect(Number.isFinite(far.blade.x + far.hipY)).toBe(true);
});
it('mixRaw at 0 and 1 returns the ends and is continuous between', () => {
  const d = bodyDims(185, 90), a = rawOf('stand', d), b = rawOf('stop', d);
  expect(fitBody(mixRaw(a, b, 0), d)).toEqual(fitBody(a, d)); expect(fitBody(mixRaw(a, b, 1), d)).toEqual(fitBody(b, d));
  let last = fitBody(a, d).hipY; for (let w = 0; w <= 1; w += 0.01) { const h = fitBody(mixRaw(a, b, w), d).hipY; expect(Math.abs(h - last)).toBeLessThan(0.01); last = h; }
});
// animator.test.ts
it('with no overlays active the animator gives exactly the gait pose', () => {
  const d = bodyDims(185, 90); let a = initialSkaterAnim(); const s = sample({ speed: 6 }); const ctx = emptyContext();
  for (let i = 0; i < 90; i++) a = stepSkater(a, s, ctx, 1 / 60);
  expect(poseSkater(a, s, ctx, d).pose).toEqual(poseOf(a.gait, motionOfSample(s), d)); expect(poseSkater(a, s, ctx, d).offset).toEqual({ x: 0, z: 0 });
});
it('the faceoff crouch is an overlay: it fades in at the dot during faceoff setup and out when play starts', () => {
  const d = bodyDims(185, 90); let a = initialSkaterAnim(); const s = sample({ speed: 0 });
  const at = (phase: 'faceoffSetup' | 'live') => contextWith({ phase, faceoffSpot: { x: s.pos.x + 0.6, y: s.pos.y } });
  for (let i = 0; i < 60; i++) a = stepSkater(a, s, at('faceoffSetup'), 1 / 60); const low = poseSkater(a, s, at('faceoffSetup'), d).pose.hipY;
  for (let i = 0; i < 60; i++) a = stepSkater(a, s, at('live'), 1 / 60); const up = poseSkater(a, s, at('live'), d).pose.hipY;
  expect(low).toBeLessThan(up - 0.08);
});
// operator.test.ts
it('eases on a jump cut and hard-cuts on a restart or a change of ends', () => {
  let st = initialOperator('broadcast'); const inp = (x: number, cut?: 'restart' | 'ends' | 'jump') => ({ puck: { x, y: 0, z: 0 }, attackingRight: true, cut, zoom: 1 });
  for (let i = 0; i < 120; i++) st = stepOperator(st, inp(-10), 1 / 60).state;
  const jump = stepOperator(st, inp(8, 'jump'), 1 / 60); expect(jump.cut).toBe(false);
  const restart = stepOperator(st, inp(8, 'restart'), 1 / 60); expect(restart.cut).toBe(true);
});
it('the cut rule does not depend on frame rate', () => {
  const run = (hz: number) => { let st = initialOperator('overhead'), cuts = 0; for (let t = 0; t < 4; t += 1 / hz) { const r = stepOperator(st, { puck: { x: -20 + t * 18, y: 0, z: 0 }, attackingRight: true, zoom: 1 }, 1 / hz); st = r.state; if (r.cut) cuts++; } return cuts; };
  expect(run(30)).toBe(run(60)); expect(run(60)).toBe(run(144));
});
```

Helper names (`recorded`, `rawOf`, `sample`, `emptyContext`, `contextWith`, `motionOfSample`) are the builder's to write; where a real signature differs, the builder adapts the test without changing what it checks.

- [ ] **Step 3: Restructure.** Move code, do not rewrite behaviour. `scene.ts` ends up as: sample the frame, step and pose through the animator in two passes (step everyone, then pose everyone), apply to rigs, step the puck machine, report cuts with their kind. `watch.ts` ends up as the entry that creates the page modules. Tests that covered moved code move with it.
- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm -w apps/viewer run build:single` Expected: PASS, including `picture.test.ts` with its hashes untouched (the camera operator's change from jump cuts to eases is outside that test and is covered by `operator.test.ts`).
- [ ] **Step 5: Commit** `refactor: a pure animator, pose layers, puck machine, camera operator and timeline`

### Task 2: Passes, receptions, shots and dumps

**Files:**
- Create: `apps/viewer/src/overlays/stick.ts`
- Modify: `apps/viewer/src/animator.ts` (register), `carry.ts` (the release leaves from the blade at the release moment)
- Test: `apps/viewer/src/overlays/stick.test.ts`, additions to `scene-puck.test.ts`

**Interfaces:**
- Consumes: Task 1 `Overlay`, `AnimContext`, `Timeline.next`/`last`, `bladeAt`, `mixRaw`.
- Produces overlays, each mirrored for right shots:
  - `passOverlay`: before a `release` of kind `pass`, the blade draws back on the forehand (or backhand when the receiver is on that side), then sweeps through toward the receiver at the release tick, with a short follow-through pointing at him. Lead time scales with the pass's speed, between 0.12 and 0.3 s.
  - `shotOverlay`: wrist shot by default; a slapshot wind-up (stick raised behind, weight back, then through) when the shot's release speed is in the top quarter of the engine's shot speeds and the shooter had at least 0.5 s since he received or was last pressured; a one-timer when he releases within 0.25 s of receiving. Follow-through points at the net. The wind-up starts before the `release` event by 0.2 to 0.55 s depending on type.
  - `dumpOverlay`: a flip or a hard-around, from the release velocity's lift and direction.
  - `receiveOverlay`: the intended receiver of a pass in flight (from the `pass` event's `otherId` and the puck's path) presents his blade toward the incoming puck and cushions it as he picks it up; if the puck goes elsewhere the overlay fades.
  - While any of these is active the blade is placed with `bladeAt`; the drawn puck leaves from the blade's position at the release tick.

- [ ] **Step 1: Write the failing tests**

```ts
it('a shooter winds up before the release and follows through after it', () => {
  const { rec, tl } = game(42); const rel = rec.events.find(e => e.type === 'release' && e.detail.kind === 'shot')!;
  const before = poseAtTick(rec, tl, rel.playerId!, rel.tick - 6), at = poseAtTick(rec, tl, rel.playerId!, rel.tick), after = poseAtTick(rec, tl, rel.playerId!, rel.tick + 5), idle = poseAtTick(rec, tl, rel.playerId!, rel.tick - 40);
  expect(bladeBehindBody(before)).toBe(true); expect(bladeAhead(after)).toBe(true);
  expect(poseDistance(before, idle)).toBeGreaterThan(0.25); expect(Number.isFinite(at.hipY)).toBe(true);
});
it('the follow-through of a pass points toward the receiver', () => {
  const { rec, tl } = game(42); const rel = rec.events.find(e => e.type === 'release' && e.detail.kind === 'pass' && e.detail.toId)!;
  const dir = bladeDirWorld(rec, tl, rel.playerId!, rel.tick + 3), to = directionTo(rec, rel.playerId!, rel.detail.toId!, rel.tick);
  expect(dir.x * to.x + dir.z * to.z).toBeGreaterThan(0.5);
});
it('no stick overlay is left on: a second after his last release a skater is back to his plain gait pose', () => {
  const { rec, tl } = game(5); for (const rel of rec.events.filter(e => e.type === 'release').slice(0, 40)) expect(overlayWeight(rec, tl, rel.playerId!, rel.tick + 45)).toBeLessThan(0.02);
});
it('through a whole period the per-frame move of hands and blade stays under 0.35 m at 60 Hz and nothing is NaN', () => { /* drive the animator for seed 5, one period, 60 Hz */ });
it('seeking into the middle of a wind-up shows the wind-up', () => {
  const { rec, tl } = game(42); const rel = rec.events.find(e => e.type === 'release' && e.detail.kind === 'shot')!;
  expect(poseDistance(poseBySeek(rec, tl, rel.playerId!, rel.tick - 4), poseAtTick(rec, tl, rel.playerId!, rel.tick - 4))).toBeLessThan(0.15);
});
// scene-puck.test.ts addition
it('the released puck starts from the blade: at the release tick the drawn puck is within 0.25 m of the releaser blade', () => { /* seeds 5 and 42, first 60 releases */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests and typecheck; render sequences.** Using `scripts/watch-shots.mjs` (extend it), capture 8-frame sequences of a wrist shot, a slapshot, a one-timer, a pass and its reception, and a dump, from the follow and ice-level cameras, into the scratch directory named in the dispatch. Read them and fix what does not read as that action.
- [ ] **Step 5: Commit** `feat: passes, receptions, shots and dumps`

### Task 3: Saves that reach the puck, blocks, and goal reactions

**Files:**
- Create: `apps/viewer/src/overlays/goalie.ts`, `apps/viewer/src/overlays/reactions.ts`
- Modify: `goalie-pose.ts` only to accept a reach target, `animator.ts` (register)
- Test: `apps/viewer/src/overlays/goalie.test.ts`, `reactions.test.ts`

**Interfaces:**
- Produces:
  - Goalie reach: for a shot in flight toward his net (from `release` of kind `shot`, the puck's path, and the coming `save`, `goal`, `miss` or `post` event), the goalie's glove, blocker, pad or stick moves toward where the puck will cross his plane, starting in time for the engine's pose, and on a `save` the saving part is at the puck (within 0.25 m) at the arrival tick. On a `goal` he reaches and is beaten. The engine's `pose` and `poseT` still choose the save type. He tracks the puck with his head and squares to it in his stance. Holding the puck after a `freeze` of cause `save` or `cover`, the puck is drawn in his glove or under him.
  - `blockOverlay`: a skater who blocks a shot (`block` event) drops to a knee or turns side-on in the lane before the puck arrives, and the puck is drawn deflecting off him.
  - `celebrateOverlay`: after a `goal`, the scorer raises his arms and glides, teammates on the ice raise sticks and converge loosely (upper body only; positions stay the engine's), the beaten goalie slumps; all fade by the next faceoff setup.

- [ ] **Step 1: Write the failing tests** (seeds 5 and 42; helper names are the builder's)

```ts
it('on a save the saving part is at the puck when it arrives', () => { /* first 15 saves: distance from the pose part named by save.detail.pose (glove hand, blocker hand, nearest pad, body for butterfly/cover) to the engine puck at the shot's arrival tick is under 0.25 m (0.4 m for butterfly body saves) */ });
it('the goalie starts moving toward the shot before it arrives, and is back in his stance 1.5 s after a save with no rebound shot', () => { /* glove or blocker displacement from stance at arrival - 4 ticks is over 0.08 m; at arrival + 45 ticks under 0.03 m */ });
it('on a goal the goalie reaches and is beaten: his nearest part to the crossing point is over 0.2 m away', () => { /* all goals of both seeds that have a releaseTick */ });
it('a blocker is in the shooting lane, low, when the puck reaches him', () => { /* first 10 block events: hip under 0.75 of standing hip height or torso turned over 60 degrees from the shot line */ });
it('after a goal the scorer has his hands above his shoulders within a second, and nobody is still celebrating at the next faceoff setup', () => { /* every goal */ });
it('goalie reach never moves a hand more than 0.4 m in one 60 Hz frame and produces no NaN over a period', () => { /* one period, seed 5 */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests and typecheck; render sequences** of a glove save, a blocker save, a pad save, a butterfly save, a covered puck, a goal, a blocked shot and a goal celebration, from the two net cameras and ice level. Read them and fix.
- [ ] **Step 5: Commit** `feat: saves that reach the puck, blocked shots and goal reactions`

### Task 4: Poke checks, hits and falls

**Files:**
- Create: `apps/viewer/src/overlays/contact.ts`
- Modify: `animator.ts` (register; the body-offset pass)
- Test: `apps/viewer/src/overlays/contact.test.ts`

**Interfaces:**
- Produces:
  - `pokeOverlay`: from a `pokeCheck` contest (stages `reach`, `resolve`, `beaten`; roles `checker`, `carrier`): the checker extends his stick one-handed with the blade at the carrier's puck during `reach`; on a win the puck is knocked off the carrier's blade; in `beaten` the checker is caught reaching and off balance as the carrier goes by. The carrier shields the puck to the far side.
  - `hitOverlay`: from a `hit` contest (stages `close`, `impact`, `recover`; roles `hitter`, `target`) and the `hit` event's result: the hitter lowers and drives a shoulder through `impact`; the target braces. `landed`: the target is knocked off line and, if the engine puts him down (`downT > 0`), falls in the direction of the hit and gets up over `downT`. `absorbed`: both stay up, a jolt. `bounced`: the hitter recoils. Lean and recoil scale with the two players' weights and closing speed (cosmetic only).
  - Falls and getting up: a fall direction and style from the contact (onto the back, the side, or to hands and knees), then a get-up through one knee timed to `downT` reaching 0. Replaces the single `down` pose for contact falls; the plain `down` pose stays for anything else.
  - The body-offset pass: after all poses, pairs of figures drawn closer than their body radii are pushed apart along the line between them, at most 0.35 m each, eased; figures are kept inside the boards.

- [ ] **Step 1: Write the failing tests**

```ts
it('during the reach stage of a poke check the checker blade is at the puck', () => { /* first 20 pokeCheck contests of seeds 5 and 42: at the middle of reach, checker blade within 0.35 m of the drawn puck, or at full reach pointing at it */ });
it('a landed hit moves the target upper body away from the hitter at impact, and a downed target is on the ice then standing again when downT ends', () => { /* every landed hit with downT > 0 in the first period: hip under 0.45 m at mid-down; within 0.1 m of standing hip height 0.3 s after downT reaches 0 */ });
it('an absorbed hit leaves both skaters above 0.7 of standing hip height throughout', () => { /* first 10 absorbed */ });
it('no two drawn figures overlap by more than 0.15 m at any frame of a period, and none is drawn outside the boards', () => { /* seed 5, one period, 60 Hz, drawn positions with offsets */ });
it('the drawn offset never exceeds 0.35 m and returns to under 0.02 m within a second of contact ending', () => { /* same run */ });
it('outside the impact and fall frames the real-game continuity bound still holds; within them no part moves more than 0.6 m in one 60 Hz frame', () => { /* same run */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests and typecheck; render sequences** of a poke check won, a poke check beaten, a landed open-ice hit with a fall and get-up, a hit into the boards, an absorbed hit and a bounced hit, from follow, ice level and broadcast. Read them and fix.
- [ ] **Step 5: Commit** `feat: poke checks, hits, falls and getting up`

### Task 5: Board battles, net-front battles and loose-puck races

**Files:**
- Create: `apps/viewer/src/overlays/battles.ts`
- Modify: `animator.ts` (register)
- Test: `apps/viewer/src/overlays/battles.test.ts`

**Interfaces:**
- Produces, from `contests` state (stage and stage time, roles, spot) and `contestStart`/`contestEnd`/`battle` events:
  - `boardBattleOverlay` by stage and role. `protect`: the carrier turns his back to the checker with the puck on the boards side, the checker leans on him. `arrive`: both drive to the spot, the first man in getting inside position. `pin`: the pinner is square to the boards, low, forearms and hip into the pinned man's back, a leg between his; the pinned man is upright against the boards facing them, protecting the puck in his feet. `dig`: both sticks jab at the puck in their feet, the one who won the last round with his blade on it; a scramble (nobody pinned) shows both low, side by side, hacking. `support`: each side's supporting player arrives beside the scrum with his blade down, ready, on his team's side. `resolve`: the winner comes away with the puck on his blade along the boards and the loser is turned the wrong way; `how` (`pinned`, `stick`, `support`, `scramble`, `protect`) picks the variant.
  - `netFrontOverlay` (`jostle`, `free`, `tied`; `attacker`, `defender`): the attacker plants in front facing the puck with his stick on the ice for a tip, the defender cross-checks and leans from behind; `free` the attacker has a step and his stick clear; `tied` the defender has his stick lifted or tied up.
  - `raceOverlay` (`race`, `resolve`; `a`, `b`): both sprint low reaching for the puck with a hand on the other man; the winner's stick gets there.
  - The puck during a battle is drawn where the engine has it; sticks are placed at it with `bladeAt`.

- [ ] **Step 1: Write the failing tests**

```ts
it('in the pin stage the pinner is between the pinned man and open ice, facing the boards, and lower', () => { /* first 15 board battles reaching pin: boards-normal ordering of drawn bodies; pinner hip lower by 0.05 m; both torsos facing within 50 degrees of the boards */ });
it('in the dig stage both blades are within 0.5 m of the puck, and the last round winner is nearer', () => { /* first 15 reaching dig */ });
it('each role is visibly different: poses of pinner and pinned differ by more than 0.3 in pose distance at mid-pin, and a supporter differs from both', () => { /* same set */ });
it('at resolve the winner has the puck on his blade and the overlay is gone within 1.2 s of contestEnd for every participant', () => { /* every board battle in a period */ });
it('a net-front attacker faces the puck with his blade on the ice; the defender is behind him and leaning', () => { /* first 15 netFront contests */ });
it('a battle cut off by a whistle or a period break leaves no overlay on anyone', () => { /* every contest whose contestEnd result is the whistle kind */ });
it('battle frames keep the overlap, offset and continuity bounds of Task 4', () => { /* seed 5, one period */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run everything; render and judge.** `npm test && npm run typecheck && npm -w apps/viewer run build:single`. Capture 10-frame sequences of three whole board battles (one won by a pin, one by a stick, one with support), a net-front battle ending in a shot, and a loose-puck race, from ice level, follow and broadcast. For each board battle write down, from the frames alone and without the event log, who was pinning, who dug it out and who won, then check against the log; if the frames do not say it, fix the poses. Report the frame rate on Low with battles on screen, and what still looks wrong, including engine behaviour.
- [ ] **Step 5: Commit** `feat: board battles, net-front battles and loose-puck races`
