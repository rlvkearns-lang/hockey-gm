# 3D viewer milestone 1 (skating test): rulings and open items (2026-11-23)

The owner approved the skating test on 2026-11-23. All three tasks were reviewed; fix rounds were re-reviewed clean. The whole-branch review for the viewer is deferred to the end of milestone 2 (ruling below).

## Rulings made by the controller

- Ruling: tasks 1-3 run as ONE implementer dispatched per task as usual; no pre-flight conflicts found (plan written by controller in one pass) — none.
- Ruling: seek() becomes eager (restore + step at call time), as the brief's wording says; the brief's own two-playback test had the same hole, so the fixed test also compares against raw engine stepping and adds a non-snapshot-boundary backward seek — plan defect in the test, spec (same result after seeking) is the authority — none.
- Ruling: Task 2's review is closed, so the Task 3 implementer now fixes those pose values in gait.ts itself (pose geometry only, style logic untouched, all gait tests still passing) as a pose-polish pass before Task 3's review — it has the rendered picture; a separate maths-only round could not judge the look — cost: Task 3's review covers a gait.ts diff too.
- Ruling: before the owner sees it, one small polish pass on the reviewer's visible minors (stick reach too long while skating, faceoff/stand crouch barely visible, wide inverted-V crossover frame just after a faceoff, New game re-entrancy / stuck on Simulating / marker disposal) — owner judges by eye and these are cheap — cost: one more builder round before the link.
- Ruling: no separate whole-branch final review for milestone 1; one review covers everything on viewer-3d at the end of milestone 2 — the milestones are slices of one branch and the owner's gate was the skating test itself — cost: a cross-task defect in milestone 1 code is found one milestone later.

## Open minor items (for the milestone 2 final review to triage)

- Task 1: minor (deferred): vite.config defineConfig cast; advance() has no max-step guard (T3's frame loop must clamp); restored games never drain events; events prefix copied on every restore; snapshot memory unmeasured
- Task 2: minor (deferred): blend moves of 6-8 cm under rapid multi-interrupt sequences (stride -> down 0.2 s -> crossover); crossover holds while travel stays >40 deg off facing with no accel condition (slow sideways slide stays in crossover; engine sheds lateral speed fast so unlikely); crossover after a slow-decaying shove once the 0.6 s passive window expires; hipRoll sign flips at hip height (geometry unchanged); real-game worst frame 8 cm (longer GAIT.blend for fast-to-fast changes would trim)
- Task 3: minor (deferred): shots.mjs profile camera outside boards / crops cut skates; moments scanner uses unmirrored per-tick gait; arm pole ignores twist; overflow-x hidden on body; #loading colour hard-coded; devicePixelRatio change unhandled; skates pass over other markers (engine body overlap)
- Known for the owner: engine motion is busy in 3D (style change ~0.8 s; "stops" brake to ~4.7 m/s then pivot; backward up to 7 m/s) -> candidate engine fix with a re-tune; backward C-cuts and stop depth capped by the 6 cm blend bound; ~23 fps on software rendering (unknown on real hardware).
- Task 3 final pass: setControls(true) re-enables every control; lerp3 used above its definition in gait.ts; stick is 0.77 of height (a little short; 0.75-0.76 broke the 6 cm continuity bound); screenshot profile camera can sit behind a net.

## Interfaces milestone 2 builds on

- playback.ts: createPlayback(setup, opts) with onStep; Playback.seek is eager, advance lazy; Frame.tick is the tick of prev; the frame loop clamps frame time to 0.1 s.
- gait.ts / body.ts: bodyDims, motionOf, initialGait, stepGait, poseOf(g, m, d, opts) with optional crouch/dot; Pose has top/blade/grip, optional twist/look; reset a gait with initialGait() after any seek, new game or re-entry from the bench; poses are for a left shot and are mirrored (motion in, pose out) for right shots.
- rig.ts: createSkaterRig(def, colors), SkaterRig.apply(pose, worldX, worldZ, facing), createMarker; rink.ts: buildRink(); moments.ts: the jump-to scanner; main.ts exposes window.__viewer for deterministic screenshots (scripts/shots.mjs).
- Engine x is world X, engine y is world Z, up is world Y.
