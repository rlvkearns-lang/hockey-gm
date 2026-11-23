import * as THREE from 'three';
import { DT, type GameState } from '@hockey/engine';
import type { ArenaQuality } from './arena';
import type { CameraName, CameraPose } from './cameras';
import { goalShow } from './goal-show';
import { forgetTarget, initialOperator, stepOperator, withCamera, type OperatorInput } from './operator';
import { createControls } from './page/controls';
import { $, createHud } from './page/hud';
import { createLifecycle, type Game } from './page/lifecycle';
import { canShow3d, createRenderer } from './page/renderer';
import { createTimebar } from './page/timebar';
import type { Vec3 } from './pose-mix';
import type { MarkerMode } from './puck-marker';
import type { WorkerLike } from './record-game';
import RecordWorker from './record.worker?worker&inline';
import { seekScene } from './scene';

/**
 * The watch page: a whole game in 3D with a score bug, a time line, camera angles and playback controls. The game is
 * played once up front, in a background thread when the browser allows one (page/lifecycle.ts); the page only shows
 * it. This entry wires the page modules (renderer, lifecycle, HUD, time bar, controls) to the camera operator
 * (operator.ts) and runs the real-time loop, which draws only while something moves (playing, a seek, a new camera);
 * `window.__watch` drives it frame by frame for the screenshot script. Without WebGL the page says so in plain words
 * and starts nothing.
 */

/** Below this many frames a second for SLOW_SECONDS in a row on High, suggest Low. */
const SLOW_FPS = 20, SLOW_SECONDS = 3;
/** Below this picture width (CSS px) the broadcast camera frames the play tighter: 29 degrees / 1.7, about 17. */
const NARROW_PX = 700, NARROW_ZOOM = 1.7;

const stage = $('stage');

// ---------------------------------------------------------------------------------------------------------------
// What the page is doing

let playing = false;
let speed = 1;
let followId = '';
let operator = initialOperator('broadcast');
/** The page's "Puck marker" setting (puck-marker.ts). */
let markerMode: MarkerMode = 'auto';
/** Something changed that the picture must show (a seek, a resize, a camera): draw on the next frame even if paused. */
let dirty = true;
/** The cost (ms) of the latest seek that played its moment in, for the screenshot script. */
let lastSeekMs = 0;
let slowSeconds = 0;

const hud = createHud();
const renderer = createRenderer(stage, {
  lost: () => { setPlaying(false); hud.showProblem('The picture was interrupted by the computer\'s graphics. Waiting for it to come back…', game() !== null); },
  restored: () => { hud.hideProblem(); dirty = true; },
  resized: () => { dirty = true; },
});
const makeWorker = (): WorkerLike => new RecordWorker() as unknown as WorkerLike;
const life = createLifecycle(renderer, hud, {
  readSeed: () => controls.readSeed(),
  showSeed: (seed) => controls.showSeed(seed),
  setControls: (on) => controls.setControls(on),
  isPlaying: () => playing,
  setPlaying: (on) => setPlaying(on),
  position: () => posNow(),
  seek: (tick) => seekTo(tick),
  showQuality: (q) => controls.showQuality(q),
  resetSlow: () => { slowSeconds = 0; },
  started: (g) => {
    operator = forgetTarget(operator);
    hud.teams(g.setup);
    controls.fillFollow(g.setup);
    followId = g.setup.home.lines.forwards[0]?.[1] ?? '';
    drawTimebar(g);
    setCamera(operator.camera);
    seekTo(0);
  },
}, makeWorker);
const game = (): Game | null => life.game();
const timebar = createTimebar({
  seek: (tick, settle) => seekTo(tick, settle),
  playGoal: (tick) => { seekTo(tick); setPlaying(true); },
});
const controls = createControls({
  togglePlay: () => setPlaying(!playing),
  setSpeed: (v) => setSpeed(v),
  setCamera: (name) => setCamera(name),
  setQuality: (q) => { void life.setQuality(q); },
  setMarker: (mode) => setMarker(mode),
  toEnd: () => { const g = game(); if (g) { setPlaying(false); seekTo(g.playback.totalTicks); } },
  newGame: () => { void life.newGame(); },
  follow: (id) => setFollow(id),
  seekBy: (seconds) => seekTo(posNow() + seconds / DT),
}, { hasGame: () => game() !== null, busy: () => life.busy(), preparing: () => life.preparing() });

new ResizeObserver(() => { renderer.fit(); const g = game(); if (g) drawTimebar(g); }).observe(stage);

const drawTimebar = (g: Game): void => timebar.draw(g.playback.totalTicks, g.timeline.periodEnds, g.goals);

// ---------------------------------------------------------------------------------------------------------------
// Each frame: the camera, the score bug, the time line

function posNow(): number {
  const g = game();
  if (!g) return 0;
  const f = g.playback.frame();
  return f.tick + f.alpha;
}

const puckV = new THREE.Vector3();
/** A fixed camera the screenshot script asked for (hook.aimAt), in place of the operator's; null normally. */
let scriptCamera: CameraPose | null = null;

/** Point the camera for the current frame; `dt` is the game time just played (0 when paused); `snap` cuts to it. */
function aimCamera(dt: number, snap = false, displayDt = 0): void {
  const g = game();
  if (!g) return;
  const { gs, playback } = g;
  const f = playback.frame();
  gs.puckWorld(puckV);
  const a = f.alpha, pp = f.prev.puck.vel, pn = f.next.puck.vel;
  const fv = followId ? gs.figure(followId) : undefined;
  const followOn = !!fv && fv.onIce;
  const input: OperatorInput = {
    puck: { x: puckV.x, y: puckV.y, z: puckV.z }, puckVel: { x: pp.x + (pn.x - pp.x) * a, y: 0, z: pp.y + (pn.y - pp.y) * a },
    attackingRight: f.prev.attackDir.home === 1, zoom: stage.clientWidth < NARROW_PX ? NARROW_ZOOM : 1,
    // The scene's cut on this frame: the camera cuts with a restart or a change of ends, and eases across a jump.
    cut: gs.cutKind(), snap,
    // A board battle under way (the one nearest the puck): the broadcast camera closes in on it.
    battle: battleSpot(f.next, puckV.x, puckV.z),
  };
  // After a goal: hold on the net scored on and the scorer (goal-show.ts), not the restart.
  const hold = goalShow(g.timeline, f.tick + f.alpha).hold;
  if (hold) {
    const sv = hold.scorerId ? gs.figure(hold.scorerId) : undefined;
    input.goal = { net: hold.net, k: hold.k, scorer: sv && sv.onIce ? { x: sv.position.x, y: 0, z: sv.position.z } : null };
  }
  if (followOn && fv) input.followed = { pos: { x: fv.position.x, y: 0, z: fv.position.z }, facing: fv.facing, vel: velocityOf(f.prev, f.next, a, followId) };
  const r = stepOperator(operator, input, dt);
  operator = r.state;
  const camPose = scriptCamera ?? r.pose;
  renderer.aim(camPose);
  // Draw the puck large enough to find from far away, and true to size up close.
  gs.setPuckScale(renderer.puckScaleAt(puckV));
  // The puck marker, decided from what this camera sees.
  gs.updateMarker(camPose.pos, markerMode, displayDt, snap || (dt === 0 && displayDt === 0), { fov: camPose.fov, heightPx: Math.max(1, stage.clientHeight) });
  // The overhead camera hangs above the scoreboard; it would hide centre ice.
  if (g.scoreboard) g.scoreboard.visible = operator.camera !== 'overhead';
  const off = operator.camera === 'follow' && !followOn;
  hud.benchNote(off ? { def: g.defs.get(followId) } : null);
}

/** The spot (world) of the board battle under way nearest the puck at (x, z), or null. */
function battleSpot(st: GameState, x: number, z: number): Vec3 | null {
  let best: Vec3 | null = null, bd = Infinity;
  for (const c of st.contests) {
    if (c.kind !== 'boardBattle') continue;
    const d = Math.hypot(c.spot.x - x, c.spot.y - z);
    if (d < bd) { bd = d; best = { x: c.spot.x, y: 0, z: c.spot.y }; }
  }
  return best;
}

/** A skater's or goalie's velocity (world) blended between the frame's ticks. */
function velocityOf(prev: GameState, next: GameState, a: number, id: string): Vec3 {
  const find = (s: GameState) => s.skaters.find((x) => x.id === id) ?? (s.goalies.home.id === id ? s.goalies.home : s.goalies.away.id === id ? s.goalies.away : undefined);
  const p = find(prev), n = find(next);
  if (!p || !n) return { x: 0, y: 0, z: 0 };
  return { x: p.vel.x + (n.vel.x - p.vel.x) * a, y: 0, z: p.vel.y + (n.vel.y - p.vel.y) * a };
}

function updateHud(): void {
  const g = game();
  if (!g) return;
  const { playback } = g;
  const f = playback.frame();
  const atEnd = f.tick >= playback.totalTicks;
  const ph = hud.update({ setup: g.setup, timeline: g.timeline, result: playback.result, prev: f.prev, next: f.next, atEnd, show: goalShow(g.timeline, f.tick + f.alpha) });
  timebar.show(posNow(), playback.totalTicks, ph);
  if (atEnd && playing) setPlaying(false);
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

/**
 * Show `tick` at once. With `settle` (the default) the moments before it are played through first (seekScene), so
 * every figure is in the pose play would have shown; without, it is a plain seek (used while the time bar is dragged).
 */
function seekTo(tick: number, settle = true): void {
  const g = game();
  if (!g) return;
  const t0 = performance.now();
  seekScene(g.playback, g.gs, tick, settle ? undefined : 0);
  if (settle) lastSeekMs = performance.now() - t0;
  aimCamera(0, true);
  updateHud();
  dirty = true;
}

function setPlaying(on: boolean): void {
  const g = game();
  if (on && g && g.playback.frame().tick >= g.playback.totalTicks) seekTo(0); // Play at the end starts again
  playing = on && game() !== null;
  controls.showPlaying(playing);
  slowSeconds = 0;
  dirty = true;
}

function setSpeed(v: number): void {
  speed = v;
  controls.showSpeed(v);
}

function setCamera(name: CameraName): void {
  operator = withCamera(operator, name);
  // The picker shows the followed player only while following him, so picking him again is a change that follows him.
  controls.showCamera(name, followId);
  aimCamera(0);
  dirty = true;
}

function setMarker(mode: MarkerMode): void {
  markerMode = mode;
  controls.showMarker(mode);
  aimCamera(0);
  dirty = true;
}

function setFollow(id: string): void {
  const g = game();
  if (!g || !g.defs.has(id)) return;
  followId = id;
  controls.showFollow(id);
  setCamera('follow');
}

// ---------------------------------------------------------------------------------------------------------------
// The real-time loop

let lastT = 0;
let manual = false;
let frames = 0, fpsSince = 0, fps = 0;

/** Play `displayDt` seconds of wall time: advance the game (if playing), move the figures and the camera. */
function advance(displayDt: number): void {
  const g = game();
  if (!g) return;
  const gameDt = playing ? displayDt * speed : 0;
  if (gameDt > 0) g.playback.advance(gameDt);
  if (gameDt > 0 || dirty) {
    g.gs.update(g.playback.frame(), gameDt);
    aimCamera(gameDt, false, displayDt);
    updateHud();
  }
}

function loop(t: number): void {
  requestAnimationFrame(loop);
  if (manual) return;
  const dt = lastT === 0 ? 0 : Math.min(0.1, (t - lastT) / 1000); // a background tab must not make the game jump
  lastT = t;
  if (!game() || !renderer.canDraw() || (!playing && !dirty)) { frames = 0; fpsSince = t; return; }
  advance(dt);
  renderer.render();
  dirty = false;
  frames++;
  if (t - fpsSince >= 1000) {
    fps = playing ? (frames * 1000) / (t - fpsSince) : 0;
    frames = 0; fpsSince = t;
    hud.fps(fps);
    slowSeconds = renderer.quality() === 'high' && playing && fps > 0 && fps < SLOW_FPS ? slowSeconds + 1 : 0;
    if (slowSeconds >= SLOW_SECONDS) hud.slow(true);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The hook for the screenshot script: everything frame by frame, with the real-time loop switched off.

const hook = {
  ready: (): boolean => game() !== null && !hud.loadingShown() && !life.busy() && !life.preparing(),
  seek: (tick: number): void => seekTo(tick),
  /** A plain seek, as while the time bar is dragged (no play-in). */
  seekPlain: (tick: number): void => seekTo(tick, false),
  newGame: (): Promise<void> => life.newGame(),
  preparing: (): boolean => life.preparing(),
  setCamera: (name: CameraName): void => setCamera(name),
  setFollow: (id: string): void => setFollow(id),
  setSpeed: (v: number): void => setSpeed(v),
  setQuality: (q: ArenaQuality): Promise<void> => life.setQuality(q),
  setMarker: (mode: MarkerMode): void => setMarker(mode),
  /** The puck marker now: how much it shows, the battle highlight, and why. */
  marker: () => game()?.gs.marker() ?? null,
  setManual: (on: boolean): void => { manual = on; lastT = 0; if (on) setPlaying(false); },
  setPlaying: (on: boolean): void => setPlaying(on),
  /** Play `seconds` of display time at the current speed in steps of 1/60 s (as if playing), without drawing. */
  step: (seconds: number): void => {
    if (!game()) return;
    const was = playing;
    playing = true;
    for (let left = seconds; left > 1e-9; left -= 1 / 60) advance(Math.min(1 / 60, left));
    playing = was;
  },
  renderOnce: (): void => { renderer.render(); },
  /** For the screenshot script: hold the camera at `pose` (world) until called with null (the operator's again). */
  aimAt: (pose: CameraPose | null): void => { scriptCamera = pose; aimCamera(0); },
  grab: (): string => renderer.grab(),
  fps: (): number => fps,
  info: () => {
    const g = game(), m = life.made();
    return { tick: g?.playback.frame().tick ?? 0, totalTicks: g?.playback.totalTicks ?? 0, camera: operator.camera, follow: followId, quality: renderer.quality(), simulateMs: m.simulateMs, simulatedIn: m.simulatedIn, workerProblem: m.workerProblem, lastSeekMs, cam: operator.cam };
  },
  /** The ticks the engine cuts at (see cuts.ts). */
  cuts: (): number[] => [...(game()?.playback.cuts ?? [])],
  /** Whether the latest update drew an engine cut (the camera cuts with it unless it was a jump in mid-play). */
  cutNow: (): boolean => game()?.gs.cutNow() ?? false,
  /** A figure's drawn hip height (m). */
  hipY: (id: string): number | null => game()?.gs.figure(id)?.hipY ?? null,
  /** The event log, light: what the script needs to find moments. */
  events: () => (game()?.playback.events ?? []).map((e) => ({ type: e.type, tick: e.tick, period: e.period, clock: e.clock, side: e.side, playerId: e.playerId, otherId: e.otherId, pos: e.pos, detail: e.detail })),
  state: (): GameState | null => { const g = game(); return g ? structuredClone(g.playback.frame().next) : null; },
  result: () => {
    const g = game();
    if (!g) return null;
    const shots = g.timeline.shotsAt(Infinity);
    return { score: g.playback.result.score, team: g.playback.result.team, shots: { home: shots.home, away: shots.away } };
  },
  /** Where the drawn puck is in the picture (fractions, 0,0 top left). */
  puckOnScreen: () => { const g = game(); if (!g) return null; g.gs.puckWorld(puckV); return renderer.project(puckV.x, puckV.y, puckV.z); },
  /** Where a figure is in the picture, and how tall he is drawn in pixels (feet to about head height). */
  figureOnScreen: (id: string) => {
    const f = game()?.gs.figure(id);
    if (!f || !f.onIce) return null;
    const a = renderer.project(f.position.x, 0, f.position.z), b = renderer.project(f.position.x, 1.8, f.position.z);
    return { ...a, px: Math.abs(a.y - b.y) * renderer.canvasHeight() };
  },
  failNext: (what: 'game' | 'quality'): void => life.failNext(what),
  hud: () => hud.read(),
};
(window as unknown as { __watch: typeof hook }).__watch = hook;

const NO_3D = 'This computer\'s browser cannot show 3D graphics, so the game cannot be shown here. Try another browser, or turn on "hardware acceleration" in this browser\'s settings.';

/** No picture can be made: say so where the picture would be, and switch every control off. */
function noGraphics(): void {
  hud.loading(NO_3D);
  controls.disableAll();
}

function start(): void {
  setSpeed(1);
  if (!canShow3d()) { noGraphics(); return; }
  try {
    renderer.make('low');
  } catch (e) {
    // Reported plainly on the page; the error itself is for a developer's console only.
    console.warn(e);
    noGraphics();
    return;
  }
  requestAnimationFrame(loop);
  void life.newGame();
}
start();
