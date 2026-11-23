# 3D Viewer Milestone 1: Skating Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser page where the real engine plays a real game and one chosen skater is shown as a jointed 3D figure that strides, glides, stops, turns, crosses over and skates backward, for the owner to judge.

**Architecture:** A new workspace `apps/viewer` (Vite, three.js, TypeScript) that imports `@hockey/engine` through its public surface only. A playback layer runs the game ahead, keeps snapshots, and hands the renderer two neighbouring ticks to blend. A pure "gait" module turns a skater's recent motion into a pose (joint angles and foot placement); a rig module applies a pose to a jointed three.js figure. The page wires them to a follow camera and a few controls.

**Tech Stack:** TypeScript strict, Vite 5, three.js (npm, pinned), Vitest, vite-plugin-singlefile, Playwright with the pre-installed Chromium for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-23-3d-viewer-design.md` (milestone 1). Engine open items the viewer must respect: `docs/superpowers/reviews/2026-11-23-engine-core-open-items.md`.

## Global Constraints

- The viewer never decides anything about the game. Nothing under `packages/engine/src` changes. Engine bugs found are written in the report, not fixed here.
- Import the engine only from `@hockey/engine` (its `index.ts` surface).
- Same seed gives the same final score with the viewer running as `simulateGame` gives.
- Units as the engine: metres, seconds, radians. Engine x along the rink, y across. In three.js: engine x is world X, engine y is world Z, up is world Y.
- No imported 3D models, textures, motion data or network requests. No code from `docs/prototype/shift-prototype.html`.
- Skating style is worked out from actual velocity and facing; `SkaterState.mode` is only a hint (it can read `crossover` while standing and is stale while a skater is down).
- Pose and gait maths are pure functions (no three.js, no DOM) so they can be unit-tested.
- Root `npm test` and `npm run typecheck` cover `apps/viewer` too and stay under 90 seconds.
- A laptop is the minimum: the test page holds 60 frames a second in headless Chromium's software renderer at 1280 x 720 or reports what it reached.

## Review Focus

- A tab left in the background and brought back: playback must not jump or spiral (clamp the frame time).
- Seeking backward then forward lands on the same state as playing straight through.
- A skater standing still, or pushed by another body without trying to move, must not run his legs.
- A skater who is down (`downT > 0`) or off the ice must not be posed as skating.
- Very small and very large players (165 cm / 70 kg and 200 cm / 110 kg) both produce a sane figure with feet on the ice.

---

### Task 1: Viewer workspace and playback

**Files:**
- Create: `apps/viewer/{package.json,tsconfig.json,index.html,vite.config.ts,vite.single.config.ts}`, `apps/viewer/src/playback.ts`
- Modify: root `package.json` (`test` and `typecheck` include `apps/viewer`; add `"viewer": "npm -w apps/viewer run dev"`), `.gitignore` (viewer build output)
- Test: `apps/viewer/src/playback.test.ts`

**Interfaces:**
- Consumes: `createGame`, `restoreGame`, `simulateGame`, `generateTeam`, `GameSetup`, `GameState`, `GameEvent`, `DT` from `@hockey/engine`.
- Produces:
  - `createPlayback(setup: GameSetup, opts?: { snapshotEverySeconds?: number }): Playback`
  - `Playback = { readonly totalTicks: number; readonly events: readonly GameEvent[]; readonly result: GameResult; seek(tick: number): void; advance(seconds: number): void; frame(): Frame; }`
  - `Frame = { prev: GameState; next: GameState; alpha: number; tick: number }` where `alpha` in [0, 1) is how far the display time sits between `prev` and `next`.
  - `lerpAngle(a: number, b: number, t: number): number` (shortest way round).
  - `createPlayback` runs the whole game once up front, storing a deep-copied snapshot every `snapshotEverySeconds` (default 5) and the full event log; `seek` restores the nearest earlier snapshot with `restoreGame` and steps forward.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { generateTeam, simulateGame, type GameSetup } from '@hockey/engine';
import { createPlayback, lerpAngle } from './playback';

const setup = (seed: number): GameSetup => {
  const home = generateTeam(seed * 2 + 1, 'Harbour City', 'HBR');
  const away = generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK');
  return { home, away, seed, chemistry: [] };
};

describe('playback', () => {
  it('reaches the same final score as an unwatched sim', () => {
    const p = createPlayback(setup(42));
    const r = simulateGame(setup(42));
    expect(p.result.score).toEqual(r.score);
    expect(p.events.length).toBe(r.events.length);
  });
  it('seeking back and forward lands on the same state as playing through', () => {
    const a = createPlayback(setup(7)); a.seek(9000);
    const b = createPlayback(setup(7)); b.seek(20000); b.seek(300); b.seek(9000);
    expect(JSON.stringify(b.frame().next)).toBe(JSON.stringify(a.frame().next));
  });
  it('advance moves display time and alpha stays in [0, 1)', () => {
    const p = createPlayback(setup(3)); p.seek(100);
    p.advance(0.05);
    const f = p.frame();
    expect(f.tick).toBe(101);
    expect(f.alpha).toBeGreaterThanOrEqual(0); expect(f.alpha).toBeLessThan(1);
    expect(f.next.tick - f.prev.tick).toBe(1);
  });
  it('clamps at the end of the game', () => {
    const p = createPlayback(setup(3)); p.seek(p.totalTicks + 500);
    expect(p.frame().tick).toBe(p.totalTicks);
  });
  it('lerpAngle goes the short way round', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 1);
  });
});
```

The builder adapts `setup()` to the real `GameSetup` shape if it differs (for example required tactics), without changing what the tests check.

- [ ] **Step 2: Run them.** `npm -w apps/viewer run test` Expected: FAIL, module not found.
- [ ] **Step 3: Implement the workspace and `playback.ts`.** The up-front run happens on the calling thread in this task (a worker is a later milestone); it must finish in under 4 seconds.
- [ ] **Step 4: Run tests and typecheck.** `npm test && npm run typecheck` Expected: PASS.
- [ ] **Step 5: Commit** `feat: viewer workspace and deterministic playback`

### Task 2: Gait and pose (pure maths)

**Files:**
- Create: `apps/viewer/src/gait.ts`, `apps/viewer/src/body.ts`
- Test: `apps/viewer/src/gait.test.ts`, `apps/viewer/src/body.test.ts`

**Interfaces:**
- Consumes: nothing from three.js or the DOM. Engine types only.
- Produces:
  - `body.ts`: `bodyDims(heightCm: number, weightKg: number): BodyDims` giving segment lengths and girths in metres (`hipHeight`, `thigh`, `shin`, `skate`, `torso`, `upperArm`, `forearm`, `shoulderWidth`, `hipWidth`, `headRadius`, `bulk`), with `thigh + shin + skate` reaching the ice from `hipHeight` at a bent knee.
  - `gait.ts`:
    - `Motion = { speed: number; forward: number; lateral: number; accelAlong: number; turnRate: number; facing: number; down: boolean }` in the skater's own frame (`forward` and `lateral` are the velocity components along and across his facing, m/s).
    - `motionOf(prev: SkaterState, next: SkaterState, dt: number): Motion`
    - `Style = 'stand' | 'glide' | 'stride' | 'crossover' | 'backward' | 'stop' | 'down'`
    - `GaitState = { phase: number; style: Style; styleT: number; lean: number; roll: number }`
    - `stepGait(g: GaitState, m: Motion, dt: number): GaitState` advances the stride phase with speed and effort and picks the style with hysteresis.
    - `Pose = { hipY: number; pitch: number; roll: number; yaw: number; legs: [LegPose, LegPose]; arms: [ArmPose, ArmPose]; stickAngle: number }`, `LegPose = { foot: { x: number; y: number; z: number }; footYaw: number; lifted: boolean }` in the body frame (x forward, y up, z to his right), `ArmPose = { hand: { x: number; y: number; z: number } }`.
    - `poseOf(g: GaitState, m: Motion, d: BodyDims): Pose`
    - `solveLeg(hip: Vec3, foot: Vec3, thigh: number, shin: number): { kneeAngle: number; hipPitch: number; hipRoll: number }` two-bone solve, clamped so an unreachable foot gives a straight leg, never NaN.

- [ ] **Step 1: Write the failing tests** (names and assertions; helper `m(partial)` fills a `Motion` with zeros)

```ts
it('standing still does not move the legs', () => {
  let g = initialGait(); for (let i = 0; i < 120; i++) g = stepGait(g, m({}), 1 / 60);
  expect(g.style).toBe('stand'); expect(g.phase).toBe(0);
});
it('accelerating forward strides, and the stride phase advances faster at higher speed', () => {
  const run = (speed: number) => { let g = initialGait(); for (let i = 0; i < 60; i++) g = stepGait(g, m({ speed, forward: speed, accelAlong: 3 }), 1 / 60); return g; };
  expect(run(4).style).toBe('stride'); expect(run(8).phase).toBeGreaterThan(run(4).phase);
});
it('coasting at speed glides', () => {
  let g = initialGait(); for (let i = 0; i < 90; i++) g = stepGait(g, m({ speed: 7, forward: 7, accelAlong: 0 }), 1 / 60);
  expect(g.style).toBe('glide');
});
it('moving opposite to his facing is backward skating', () => {
  let g = initialGait(); for (let i = 0; i < 60; i++) g = stepGait(g, m({ speed: 4, forward: -4 }), 1 / 60);
  expect(g.style).toBe('backward');
});
it('moving mostly sideways, or turning hard at speed, is a crossover', () => {
  let a = initialGait(), b = initialGait();
  for (let i = 0; i < 60; i++) { a = stepGait(a, m({ speed: 4, lateral: 4 }), 1 / 60); b = stepGait(b, m({ speed: 7, forward: 7, turnRate: 2.2, accelAlong: 1 }), 1 / 60); }
  expect(a.style).toBe('crossover'); expect(b.style).toBe('crossover');
});
it('braking hard is a stop', () => {
  let g = initialGait(); for (let i = 0; i < 20; i++) g = stepGait(g, m({ speed: 6, forward: 6, accelAlong: -9 }), 1 / 60);
  expect(g.style).toBe('stop');
});
it('a downed skater is down and his style does not flicker', () => {
  let g = initialGait(); const seen = new Set<string>();
  for (let i = 0; i < 60; i++) { g = stepGait(g, m({ speed: 3, forward: 3, down: true }), 1 / 60); seen.add(g.style); }
  expect([...seen]).toEqual(['down']);
});
it('style does not flip back and forth across a threshold', () => {
  let g = initialGait(), flips = 0, last = g.style;
  for (let i = 0; i < 240; i++) { g = stepGait(g, m({ speed: 5, forward: 5, accelAlong: i % 2 ? 0.9 : 1.1 }), 1 / 60); if (g.style !== last) { flips++; last = g.style; } }
  expect(flips).toBeLessThanOrEqual(2);
});
it('poses keep at least one skate on the ice and never produce NaN', () => {
  for (const d of [bodyDims(165, 70), bodyDims(185, 90), bodyDims(200, 110)]) for (const style of STYLES) for (let ph = 0; ph < 1; ph += 0.05) {
    const p = poseOf({ phase: ph, style, styleT: 1, lean: 0.2, roll: 0.1 }, m({ speed: 6, forward: 6 }), d);
    expect(Number.isFinite(p.hipY)).toBe(true);
    expect(Math.min(p.legs[0].foot.y, p.legs[1].foot.y)).toBeCloseTo(0, 5);
    for (const l of p.legs) expect(l.foot.y).toBeGreaterThanOrEqual(0);
  }
});
it('skates do not point across the direction of glide when gliding forward', () => {
  const p = poseOf({ phase: 0.3, style: 'glide', styleT: 1, lean: 0, roll: 0 }, m({ speed: 7, forward: 7 }), bodyDims(185, 90));
  for (const l of p.legs) expect(Math.abs(l.footYaw)).toBeLessThan(0.35);
});
it('solveLeg never returns NaN, even for a foot out of reach', () => {
  const s = solveLeg({ x: 0, y: 0.9, z: 0 }, { x: 3, y: 0, z: 0 }, 0.45, 0.45);
  expect(Number.isFinite(s.kneeAngle) && Number.isFinite(s.hipPitch) && Number.isFinite(s.hipRoll)).toBe(true);
});
it('bodyDims scales: taller is longer-legged, heavier is bulkier, and the leg reaches the ice', () => {
  const a = bodyDims(170, 75), b = bodyDims(195, 75), c = bodyDims(195, 105);
  expect(b.thigh).toBeGreaterThan(a.thigh); expect(c.bulk).toBeGreaterThan(b.bulk);
  for (const d of [a, b, c]) expect(d.thigh + d.shin + d.skate).toBeGreaterThan(d.hipHeight);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** What each style must look like (the builder chooses the maths):
  - `stride`: legs alternate; the pushing leg extends back and out to the side at roughly 45 degrees with the skate turned out, then recovers under the body; the gliding skate points along travel; torso pitched forward, more so under hard acceleration; arms swing opposite the legs, with the stick hand low.
  - `glide`: both skates on the ice about shoulder width, knees bent, torso moderately forward, small weight shifts only.
  - `crossover`: body rolled into the turn; the outside leg crosses over in front of the inside leg, then the inside leg pushes under and out.
  - `backward`: seated posture, torso more upright, alternating C-cuts (each skate sweeps out and back in a half circle) with both skates staying on the ice.
  - `stop`: both skates turned sideways to travel, body leaning back against the stop, knees deeply bent, easing out as speed drops.
  - `stand`: upright athletic stance, stick on the ice.
  - `down`: on the ice (a simple fallen pose is enough for this milestone).
  - Lean and roll ease toward their targets (acceleration gives pitch, turning gives roll) rather than snapping.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: skating gait and pose maths`

### Task 3: The rig and the skating test page

**Files:**
- Create: `apps/viewer/src/rig.ts`, `apps/viewer/src/rink.ts`, `apps/viewer/src/main.ts`; fill in `apps/viewer/index.html`
- Create: `apps/viewer/scripts/shots.mjs` (headless screenshots)
- Test: `apps/viewer/src/rig.test.ts`

**Interfaces:**
- Consumes: Task 1 `createPlayback`, `Frame`, `lerpAngle`; Task 2 `bodyDims`, `motionOf`, `stepGait`, `poseOf`, `solveLeg`; `RINK`, `FACEOFF_DOTS`, `PlayerDef` from the engine.
- Produces:
  - `rig.ts`: `createSkaterRig(def: PlayerDef, colors: { jersey: number; trim: number; pants: number }): SkaterRig`, `SkaterRig = { root: THREE.Group; apply(pose: Pose, worldX: number, worldZ: number, facing: number): void; dispose(): void }`. The figure: pelvis, torso, head with helmet, upper arms, forearms, gloves, thighs, shins, skates with blades, and a stick with a blade; sized from `bodyDims`; the number on the back. `createMarker(color: number, radius: number): THREE.Object3D` for everyone else (a short cylinder with a facing notch).
  - `rink.ts`: `buildRink(): THREE.Group` with ice, lines, circles, dots, creases, nets and boards to the engine's `RINK` dimensions.
  - The page: seed input and New game; a player picker (both teams, by number, name and position, defaulting to a home defenceman so backward skating shows); Play/Pause; speed 0.25x, 0.5x, 1x, 2x; a readout of the followed player's current style and speed; a follow camera that trails the player from above and behind his travel with easing, plus a side-on option; the puck; a score and clock line. Readable at laptop and phone widths, light and dark schemes, system font, no network requests, no localStorage.
  - `npm -w apps/viewer run build:single` writes `apps/viewer/dist-single/index.html` (git-ignored), fully self-contained.

- [ ] **Step 1: Write the failing test**

```ts
it('builds a figure whose skates rest on the ice for small and large players', () => {
  for (const [h, w] of [[165, 70], [185, 90], [200, 110]] as const) {
    const rig = createSkaterRig(defWith(h, w), { jersey: 0xb3202e, trim: 0xffffff, pants: 0x1a1a1a });
    rig.apply(poseOf(initialGait(), standing, bodyDims(h, w)), 0, 0, 0);
    rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.root);
    expect(box.min.y).toBeGreaterThan(-0.02); expect(box.min.y).toBeLessThan(0.05);
    expect(box.max.y).toBeGreaterThan(h / 100 * 0.9);
  }
});
it('a heavier player of the same height is wider', () => {
  const width = (w: number) => { const r = createSkaterRig(defWith(185, w), colors); r.apply(poseOf(initialGait(), standing, bodyDims(185, w)), 0, 0, 0); r.root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(r.root); return b.max.z - b.min.z; };
  expect(width(105)).toBeGreaterThan(width(75));
});
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement the rig, rink and page.** The frame loop clamps frame time to 0.1 s, calls `playback.advance`, blends positions and facing between `prev` and `next` with `alpha`, steps each rig's gait with the real elapsed display time scaled by playback speed, and applies the pose. A skater who is off the ice is hidden.
- [ ] **Step 4: Run tests, typecheck, and build the single file.** `npm test && npm run typecheck && npm -w apps/viewer run build:single` Expected: PASS and the file exists with no external URLs.
- [ ] **Step 5: Look at it.** Run `node apps/viewer/scripts/shots.mjs`: open the single-file page in headless Chromium (Playwright is pre-installed; `require('playwright')` works; do not install it), play at 0.5x following a defenceman and then a forward, and save at least 12 screenshots into the session scratch directory named in the dispatch, covering a stride, a glide, a crossover, backward skating, a stop and standing at a faceoff, from the follow camera and the side-on camera, with no console errors. Read the screenshots. Fix what looks wrong in the viewer (legs through the ice, feet sliding sideways, limbs bending backward, the body snapping between styles, the figure facing the wrong way) and repeat until each style reads as hockey skating. Record the measured frame rate. List what still looks wrong, and any engine behaviour that looks wrong in 3D, in the report.
- [ ] **Step 6: Commit** `feat: jointed skater rig and the skating test page`
