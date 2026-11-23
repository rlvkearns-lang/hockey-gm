import * as THREE from 'three';
import { DT, generateTeam, type GameEvent, type GameSetup, type GameState, type PlayerDef, type Side } from '@hockey/engine';
import { ARENA_BACKGROUND, type ArenaQuality } from './arena';
import { CAMERA_NAMES, cameraTarget, easeCamera, easePoint, type CameraInput, type CameraName, type CameraPose } from './cameras';
import type { Vec3 } from './gait';
import { createPlayback, type Playback } from './playback';
import { createGameScene, type GameScene } from './scene';

/**
 * The watch page: a whole game in 3D with a score bug, a time line, camera angles and playback controls. The game is
 * played once up front (createPlayback); the page only shows it. The real-time loop draws only while something moves
 * (playing, a seek, a new camera); `window.__watch` drives it frame by frame for the screenshot script.
 */

/** Set by the Vite configs: the link to the skating test works on the dev server, not inside a single-file build. */
declare const __SKATING_LINK__: boolean;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = $('stage');
const loading = $('loading');
const playBtn = $<HTMLButtonElement>('play');
const scrub = $<HTMLInputElement>('scrub');
const followSel = $<HTMLSelectElement>('follow');
const seedInput = $<HTMLInputElement>('seed');
const fpsEl = $('fps');
const slowEl = $('slow');
const summaryEl = $('summary');
const benchNote = $('benchNote');

if (__SKATING_LINK__) { const a = $<HTMLAnchorElement>('skatingLink'); a.href = 'skating.html'; a.hidden = false; }

const ORDINAL = ['', '1st', '2nd', '3rd'];
const periodName = (p: number): string => ORDINAL[p] ?? (p === 4 ? 'OT' : `P${p}`);
const clockText = (s: number): string => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** Seconds before a goal that its mark on the time line jumps to. */
const GOAL_LEAD = 6;
/** Time constant (s) of the point the cameras watch, chasing the drawn puck: smooths passes and rebounds. */
const FOCUS_TAU = 0.22;
/** Below this many frames a second for SLOW_SECONDS in a row on High, suggest Low. */
const SLOW_FPS = 20, SLOW_SECONDS = 3;
/** A camera target that moves this far (m) in one frame is cut to, not eased to. */
const CUT_JUMP = 6;
let lastTarget: Vec3 | null = null;

// ---------------------------------------------------------------------------------------------------------------
// Renderer, scene and camera. Quality: Low (no antialiasing, the light scene, pixel ratio up to 1.5) or High
// (antialiasing, real shadows, full figures, pixel ratio up to 2). Antialiasing is fixed when a WebGL context is made,
// so changing quality replaces the canvas and the renderer, and rebuilds the game scene.

let quality: ArenaQuality = 'low';
let canvas: HTMLCanvasElement | null = null;
let renderer: THREE.WebGLRenderer;
const scene = new THREE.Scene();
scene.background = new THREE.Color(ARENA_BACKGROUND);
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);

function makeRenderer(): void {
  const c = document.createElement('canvas');
  c.setAttribute('aria-label', '3D picture of the game');
  if (canvas) {
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.replaceWith(c);
  } else stage.prepend(c);
  canvas = c;
  renderer = new THREE.WebGLRenderer({ canvas: c, antialias: quality === 'high', powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  fit();
}

function fit(): void {
  const w = Math.max(1, Math.round(stage.clientWidth)), h = Math.max(1, Math.round((w * 9) / 16));
  renderer.setPixelRatio(Math.min(quality === 'high' ? 2 : 1.5, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(() => fit()).observe(stage);

// ---------------------------------------------------------------------------------------------------------------
// The game

type Mark = { tick: number; side: Side; text: string };
type Game = {
  setup: GameSetup; playback: Playback; gs: GameScene; defs: Map<string, PlayerDef>;
  /** Ticks of the shots on goal of each side, in order (a goal is a shot too). */
  shots: Record<Side, number[]>;
  goals: Mark[];
  /** The last tick of each period (from the event log). */
  periodEnds: number[];
  scoreboard: THREE.Object3D | undefined;
};
let game: Game | null = null;
let playing = false;
let speed = 1;
let cameraName: CameraName = 'broadcast';
let followId = '';
let cam: CameraPose = { pos: { x: 0, y: 15, z: 29 }, look: { x: 0, y: 0, z: 0 }, fov: 30 };
let focus: Vec3 = { x: 0, y: 0, z: 0 };
let snap = true;
/** Something changed that the picture must show (a seek, a resize, a camera): draw on the next frame even if paused. */
let dirty = true;
let lastAttack = 0, lastPhase = '', lastFollowOn = false;

const puckV = new THREE.Vector3();

function buildScene(setup: GameSetup): GameScene {
  const gs = createGameScene(setup, { quality });
  scene.add(gs.root);
  return gs;
}
function dropScene(gs: GameScene): void {
  scene.remove(gs.root);
  gs.dispose();
}

/** Count of sorted `ticks` at or before `t`. */
function countUpTo(ticks: readonly number[], t: number): number {
  let lo = 0, hi = ticks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ticks[m]! <= t) lo = m + 1; else hi = m; }
  return lo;
}

function indexEvents(events: readonly GameEvent[], defs: Map<string, PlayerDef>, setup: GameSetup): Pick<Game, 'shots' | 'goals' | 'periodEnds'> {
  const shots: Record<Side, number[]> = { home: [], away: [] };
  const goals: Mark[] = [];
  const periodEnds: number[] = [];
  for (const e of events) {
    if (e.type === 'shot' && e.side) shots[e.side].push(e.tick);
    else if (e.type === 'goal' && e.side) {
      const who = e.playerId ? defs.get(e.playerId)?.name ?? '' : '';
      const assists = e.assistIds.length === 0 ? 'unassisted' : `assisted by ${e.assistIds.map((id) => defs.get(id)?.name ?? id).join(' and ')}`;
      goals.push({ tick: e.tick, side: e.side, text: `Goal, ${setup[e.side].abbr}: ${who}, ${assists}. ${clockText(e.clock)} ${periodName(e.period)}` });
    } else if (e.type === 'periodEnd') periodEnds.push(e.tick);
  }
  return { shots, goals, periodEnds };
}

// ---------------------------------------------------------------------------------------------------------------
// Each frame: the camera, the score bug, the time line

function posNow(): number {
  if (!game) return 0;
  const f = game.playback.frame();
  return f.tick + f.alpha;
}

/** Point the camera for the current frame; `dt` is the game time just played (0 when paused). */
function aimCamera(dt: number): void {
  if (!game) return;
  const { gs, playback } = game;
  const f = playback.frame();
  gs.puckWorld(puckV);
  const puck = { x: puckV.x, y: puckV.y, z: puckV.z };
  // Cut (do not pan) when play restarts at a faceoff, the teams change ends, or the followed player steps on or off.
  const attack = f.next.attackDir.home;
  if (attack !== lastAttack || (f.next.phase === 'faceoffSetup' && lastPhase !== 'faceoffSetup')) snap = true;
  lastAttack = attack; lastPhase = f.next.phase;
  focus = snap ? puck : easePoint(focus, puck, dt, FOCUS_TAU);
  const a = f.alpha, pp = f.prev.puck.vel, pn = f.next.puck.vel;
  const input: CameraInput = { puck: focus, puckVel: { x: pp.x + (pn.x - pp.x) * a, y: 0, z: pp.y + (pn.y - pp.y) * a }, attackingRight: attack === 1 };
  const fv = followId ? gs.figure(followId) : undefined;
  const followOn = !!fv && fv.onIce;
  if (followOn && fv) {
    const vel = velocityOf(f.prev, f.next, a, followId);
    input.followed = { pos: { x: fv.position.x, y: 0, z: fv.position.z }, facing: fv.facing, vel };
  }
  if (cameraName === 'follow' && followOn !== lastFollowOn) snap = true;
  lastFollowOn = followOn;
  const target = cameraTarget(cameraName, input);
  // An angle that jumps to the other side of the play (ice level as the puck crosses centre along its boards) cuts
  // there, as a director would, rather than swinging the camera through the players.
  if (lastTarget && Math.hypot(target.pos.x - lastTarget.x, target.pos.z - lastTarget.z) > CUT_JUMP) snap = true;
  lastTarget = target.pos;
  const anchor = cameraName === 'follow' ? input.followed?.pos : undefined;
  if (anchor && !snap) {
    // Behind a skater at full speed: ease the camera's place relative to him, so it keeps up instead of trailing.
    const rel = (p: CameraPose, s: number): CameraPose => ({
      pos: { x: p.pos.x + s * anchor.x, y: p.pos.y, z: p.pos.z + s * anchor.z },
      look: { x: p.look.x + s * anchor.x, y: p.look.y, z: p.look.z + s * anchor.z }, fov: p.fov,
    });
    cam = rel(easeCamera(rel(cam, -1), rel(target, -1), dt, false), 1);
  } else cam = easeCamera(cam, target, dt, snap);
  snap = false;
  camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
  camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
  if (camera.fov !== cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  // The overhead camera hangs above the scoreboard; it would hide centre ice.
  if (game.scoreboard) game.scoreboard.visible = cameraName !== 'overhead';
  const off = cameraName === 'follow' && !followOn;
  benchNote.hidden = !off;
  if (off) {
    const d = game.defs.get(followId);
    benchNote.textContent = d ? `#${d.number} ${d.name} is on the bench` : 'No player chosen';
  }
}

/** A skater's or goalie's velocity (world) blended between the frame's ticks. */
function velocityOf(prev: GameState, next: GameState, a: number, id: string): Vec3 {
  const find = (s: GameState) => s.skaters.find((x) => x.id === id) ?? (s.goalies.home.id === id ? s.goalies.home : s.goalies.away.id === id ? s.goalies.away : undefined);
  const p = find(prev), n = find(next);
  if (!p || !n) return { x: 0, y: 0, z: 0 };
  return { x: p.vel.x + (n.vel.x - p.vel.x) * a, y: 0, z: p.vel.y + (n.vel.y - p.vel.y) * a };
}

const text = (el: HTMLElement, s: string): void => { if (el.textContent !== s) el.textContent = s; };

function phaseLabel(st: GameState): { period: string; clock: string } {
  if (st.phase === 'final') return { period: 'Final', clock: '' };
  if (st.phase === 'intermission') return { period: `End of ${periodName(st.period)}`, clock: '' };
  return { period: periodName(st.period), clock: clockText(st.clock) };
}

function updateHud(): void {
  if (!game) return;
  const { playback, setup, shots } = game;
  const f = playback.frame();
  const st = f.prev;
  const atEnd = f.tick >= playback.totalTicks;
  const ph = phaseLabel(atEnd ? f.next : st);
  text($('bugHomeScore'), String(st.score.home));
  text($('bugAwayScore'), String(st.score.away));
  text($('bugPeriod'), ph.period);
  text($('bugClock'), ph.clock);
  $('bugClock').hidden = ph.clock === '';
  const sh = countUpTo(shots.home, st.tick), sa = countUpTo(shots.away, st.tick);
  text($('bugShots'), `Shots ${sh} – ${sa}`);
  text($('when'), ph.clock ? `${ph.period} · ${ph.clock}` : ph.period);
  if (!scrubbing) {
    const v = String(Math.round(posNow()));
    if (scrub.value !== v) scrub.value = v;
  }
  scrub.style.setProperty('--pct', `${(100 * posNow()) / Math.max(1, playback.totalTicks)}%`);
  scrub.setAttribute('aria-valuetext', ph.clock ? `${ph.period} period, ${ph.clock} left` : ph.period);
  summaryEl.hidden = !atEnd;
  if (atEnd) {
    const r = playback.result, ts = { home: shots.home.length, away: shots.away.length };
    text(summaryEl, `Final: ${setup.home.name} ${r.score.home}, ${setup.away.name} ${r.score.away}${r.tied ? ' (a tie)' : ''} · Shots ${ts.home} – ${ts.away}`);
  }
  if (atEnd && playing) setPlaying(false);
}

function drawTimeline(): void {
  if (!game) return;
  const { playback, goals, periodEnds } = game;
  const total = Math.max(1, playback.totalTicks);
  scrub.max = String(playback.totalTicks);
  const pct = (t: number): string => `${(100 * t) / total}%`;
  const periods = $('periods');
  const parts: HTMLElement[] = [];
  let start = 0;
  const ends = periodEnds.length > 0 ? periodEnds : [total];
  ends.forEach((end, i) => {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = periodName(i + 1);
    label.style.left = pct((start + Math.min(end, total)) / 2);
    parts.push(label);
    if (end < total - 1) {
      const split = document.createElement('span');
      split.className = 'split';
      split.style.left = pct(end);
      parts.push(split);
    }
    start = end;
  });
  periods.replaceChildren(...parts);
  $('goals').replaceChildren(...goals.map((g) => {
    const b = document.createElement('button');
    b.className = g.side;
    b.style.left = pct(g.tick);
    b.title = g.text;
    b.setAttribute('aria-label', `${g.text}. Watch it from just before.`);
    b.addEventListener('click', () => { seekTo(g.tick - GOAL_LEAD / DT); setPlaying(true); });
    return b;
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

function seekTo(tick: number): void {
  if (!game) return;
  game.playback.seek(tick);
  game.gs.reset();
  game.gs.update(game.playback.frame(), 0);
  snap = true;
  aimCamera(0);
  updateHud();
  dirty = true;
}

function setPlaying(on: boolean): void {
  if (on && game && game.playback.frame().tick >= game.playback.totalTicks) seekTo(0); // Play at the end starts again
  playing = on && game !== null;
  text(playBtn, playing ? 'Pause' : 'Play');
  slowSeconds = 0;
  dirty = true;
}

function setSpeed(v: number): void {
  speed = v;
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v)));
}

function setCamera(name: CameraName): void {
  cameraName = name;
  document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.camera === name)));
  snap = true;
  aimCamera(0);
  dirty = true;
}

function setFollow(id: string): void {
  if (!game || !game.defs.has(id)) return;
  followId = id;
  followSel.value = id;
  setCamera('follow');
}

const nextPaint = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let busy = false;
const setControls = (on: boolean): void => {
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('main button, main input, main select').forEach((b) => { b.disabled = !on; });
};

async function setQuality(q: ArenaQuality): Promise<void> {
  if (busy || q === quality) return;
  busy = true;
  quality = q;
  document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quality === q)));
  slowEl.hidden = true;
  slowSeconds = 0;
  const wasPlaying = playing;
  setPlaying(false);
  setControls(false);
  try {
    await nextPaint();
    if (game) dropScene(game.gs);
    makeRenderer();
    if (game) {
      game.gs = buildScene(game.setup);
      game.scoreboard = game.gs.root.getObjectByName('scoreboard');
      seekTo(posNow());
    }
  } finally {
    setControls(true);
    busy = false;
    setPlaying(wasPlaying);
  }
}

function fillFollow(setup: GameSetup): void {
  const order = { G: 0, C: 1, LW: 2, RW: 3, LD: 4, RD: 5 } as const;
  const posName = { G: 'Goalie', C: 'Centre', LW: 'Left wing', RW: 'Right wing', LD: 'Defence', RD: 'Defence' } as const;
  followSel.replaceChildren();
  for (const side of ['home', 'away'] as const) {
    const team = setup[side];
    const group = document.createElement('optgroup');
    group.label = team.name;
    // Skaters and the starting goalie (the only goalie on the ice).
    const players = team.players.filter((p) => p.position !== 'G' || p.id === team.lines.goalie);
    for (const p of players.sort((a, b) => order[a.position] - order[b.position] || a.number - b.number)) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `#${p.number} ${p.name} · ${posName[p.position]}`;
      group.appendChild(o);
    }
    followSel.appendChild(group);
  }
}

/** Play a new game up front. One at a time; a failure is shown in plain words and the controls come back. */
async function newGame(): Promise<void> {
  if (busy) return;
  busy = true;
  const seed = Math.trunc(Number(seedInput.value)) || 0;
  setPlaying(false);
  setControls(false);
  loading.hidden = false;
  loading.textContent = 'Simulating…';
  try {
    await nextPaint();
    const setup: GameSetup = { home: generateTeam(seed * 2 + 1, 'Harbour City', 'HBR'), away: generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK'), seed, chemistry: [] };
    const t0 = performance.now();
    const playback = createPlayback(setup);
    simulateMs = performance.now() - t0;
    const defs = new Map<string, PlayerDef>();
    for (const t of [setup.home, setup.away]) for (const p of t.players) defs.set(p.id, p);
    if (game) dropScene(game.gs);
    game = null;
    const gs = buildScene(setup);
    game = { setup, playback, gs, defs, ...indexEvents(playback.events, defs, setup), scoreboard: gs.root.getObjectByName('scoreboard') };
    text($('bugHome'), setup.home.abbr);
    text($('bugAway'), setup.away.abbr);
    const title = $('title');
    const h = document.createElement('span'); h.className = 'home'; h.textContent = setup.home.name;
    const v = document.createElement('span'); v.className = 'vs'; v.textContent = ' vs ';
    const a = document.createElement('span'); a.className = 'away'; a.textContent = setup.away.name;
    title.replaceChildren(h, v, a);
    fillFollow(setup);
    followId = setup.home.lines.forwards[0]?.[1] ?? '';
    followSel.value = followId;
    drawTimeline();
    seekTo(0);
    loading.hidden = true;
  } catch (e) {
    console.error(e);
    if (game) { dropScene(game.gs); game = null; }
    loading.hidden = false;
    loading.textContent = `Sorry, this game could not be set up (seed ${seed}). Try another seed and press New game.`;
  } finally {
    setControls(true);
    busy = false;
  }
}
let simulateMs = 0;

// ---------------------------------------------------------------------------------------------------------------
// The real-time loop

let lastT = 0;
let manual = false;
let frames = 0, fpsSince = 0, fps = 0, slowSeconds = 0;

/** Play `displayDt` seconds of wall time: advance the game (if playing), move the figures and the camera. */
function advance(displayDt: number): void {
  if (!game) return;
  const gameDt = playing ? displayDt * speed : 0;
  if (gameDt > 0) game.playback.advance(gameDt);
  if (gameDt > 0 || dirty) {
    game.gs.update(game.playback.frame(), gameDt);
    aimCamera(gameDt);
    updateHud();
  }
}

function loop(t: number): void {
  requestAnimationFrame(loop);
  if (manual) return;
  const dt = lastT === 0 ? 0 : Math.min(0.1, (t - lastT) / 1000); // a background tab must not make the game jump
  lastT = t;
  if (!game || (!playing && !dirty)) { frames = 0; fpsSince = t; return; }
  advance(dt);
  renderer.render(scene, camera);
  dirty = false;
  frames++;
  if (t - fpsSince >= 1000) {
    fps = playing ? (frames * 1000) / (t - fpsSince) : 0;
    frames = 0; fpsSince = t;
    text(fpsEl, fps > 0 ? `${Math.round(fps)} fps` : '– fps');
    slowSeconds = quality === 'high' && playing && fps > 0 && fps < SLOW_FPS ? slowSeconds + 1 : 0;
    if (slowSeconds >= SLOW_SECONDS) slowEl.hidden = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Controls and keys

let scrubbing = false;
playBtn.addEventListener('click', () => setPlaying(!playing));
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.camera as CameraName)));
document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => b.addEventListener('click', () => { void setQuality(b.dataset.quality as ArenaQuality); }));
$('toEnd').addEventListener('click', () => { if (game) { setPlaying(false); seekTo(game.playback.totalTicks); } });
$('toLow').addEventListener('click', () => { void setQuality('low'); });
$('newGame').addEventListener('click', () => { void newGame(); });
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void newGame(); });
followSel.addEventListener('change', () => setFollow(followSel.value));
$<HTMLInputElement>('showFps').addEventListener('change', (e) => { fpsEl.hidden = !(e.target as HTMLInputElement).checked; });
scrub.addEventListener('pointerdown', () => { scrubbing = true; });
window.addEventListener('pointerup', () => { scrubbing = false; });
scrub.addEventListener('input', () => seekTo(Number(scrub.value)));

const typing = (t: EventTarget | null): boolean => t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox');
document.addEventListener('keydown', (e) => {
  if (!game || busy || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) setPlaying(!playing); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seekTo(posNow() + ((e.key === 'ArrowRight' ? 1 : -1) * 5) / DT); return; }
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= CAMERA_NAMES.length) { e.preventDefault(); setCamera(CAMERA_NAMES[n - 1]!); }
});
// Space on a focused button would also click it when the key comes up; the page has already toggled play.
document.addEventListener('keyup', (e) => { if (e.key === ' ' && !typing(e.target)) e.preventDefault(); });

// ---------------------------------------------------------------------------------------------------------------
// The hook for the screenshot script: everything frame by frame, with the real-time loop switched off.

const project = (x: number, y: number, z: number): { x: number; y: number; inFrame: boolean } => {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inFrame: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1 };
};
const hook = {
  ready: (): boolean => game !== null && loading.hidden && !busy,
  seek: (tick: number): void => seekTo(tick),
  setCamera: (name: CameraName): void => setCamera(name),
  setFollow: (id: string): void => setFollow(id),
  setSpeed: (v: number): void => setSpeed(v),
  setQuality: (q: ArenaQuality): Promise<void> => setQuality(q),
  setManual: (on: boolean): void => { manual = on; lastT = 0; if (on) setPlaying(false); },
  setPlaying: (on: boolean): void => setPlaying(on),
  /** Play `seconds` of display time at the current speed in steps of 1/60 s (as if playing), without drawing. */
  step: (seconds: number): void => {
    if (!game) return;
    const was = playing;
    playing = true;
    for (let left = seconds; left > 1e-9; left -= 1 / 60) advance(Math.min(1 / 60, left));
    playing = was;
  },
  renderOnce: (): void => { renderer.render(scene, camera); },
  grab: (): string => { renderer.render(scene, camera); return canvas!.toDataURL('image/png'); },
  fps: (): number => fps,
  info: () => ({ tick: game?.playback.frame().tick ?? 0, totalTicks: game?.playback.totalTicks ?? 0, camera: cameraName, follow: followId, quality, simulateMs, cam }),
  /** The event log, light: what the script needs to find moments. */
  events: () => (game?.playback.events ?? []).map((e) => ({ type: e.type, tick: e.tick, period: e.period, clock: e.clock, side: e.side, playerId: e.playerId, otherId: e.otherId, pos: e.pos, detail: e.detail })),
  state: (): GameState | null => (game ? structuredClone(game.playback.frame().next) : null),
  result: () => (game ? { score: game.playback.result.score, team: game.playback.result.team, shots: { home: game.shots.home.length, away: game.shots.away.length } } : null),
  /** Where the drawn puck is in the picture (fractions, 0,0 top left). */
  puckOnScreen: () => { if (!game) return null; game.gs.puckWorld(puckV); return project(puckV.x, puckV.y, puckV.z); },
  /** Where a figure is in the picture, and how tall he is drawn in pixels (feet to about head height). */
  figureOnScreen: (id: string) => {
    const f = game?.gs.figure(id);
    if (!f || !f.onIce) return null;
    const a = project(f.position.x, 0, f.position.z), b = project(f.position.x, 1.8, f.position.z);
    return { ...a, px: Math.abs(a.y - b.y) * (canvas?.height ?? 0) };
  },
  hud: () => ({ bug: $('bug').innerText, when: $('when').textContent, summary: summaryEl.hidden ? null : summaryEl.textContent }),
};
(window as unknown as { __watch: typeof hook }).__watch = hook;

makeRenderer();
setSpeed(1);
requestAnimationFrame(loop);
void newGame();
