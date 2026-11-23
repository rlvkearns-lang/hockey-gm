import * as THREE from 'three';
import { bodyRadius, DT, RINK, generateTeam, type GameSetup, type GameState, type PlayerDef, type Side, type SkaterState } from '@hockey/engine';
import { bodyDims, type BodyDims } from './body';
import { initialGait, motionOf, poseOf, stepGait, type GaitState, type Motion, type Style } from './gait';
import { createMomentScanner, type Moment, type MomentScanner } from './moments';
import { createPlayback, lerpAngle, type Frame, type Playback } from './playback';
import { createMarker, createShadowBlob, createSkaterRig, handedMotion, type RigColors, type SkaterRig } from './rig';
import { buildRink, iceHalfWidthAt } from './rink';

// ---------------------------------------------------------------------------------------------------------------
// Page elements

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const playBtn = $<HTMLButtonElement>('play');
const picker = $<HTMLSelectElement>('player');
const loading = $('loading');

const TEAM_COLORS: Record<Side, RigColors & { marker: number }> = {
  home: { jersey: 0xb3202e, trim: 0xffffff, pants: 0x1a1a1a, marker: 0xc8283a },
  away: { jersey: 0xf2f3f5, trim: 0x1b4fa0, pants: 0x1c2438, marker: 0x1b4fa0 },
};
const STYLE_NAMES: Record<Style, string> = {
  stand: 'standing', glide: 'glide', stride: 'stride', crossover: 'crossover', backward: 'backward', stop: 'stop', down: 'down',
};
type CameraMode = 'follow' | 'side' | 'above';
/** Screenshot camera (window.__viewer.orbit): fixed in his body frame, `angle` from his facing toward his right. */
let orbit: { angle: number; dist: number; height: number } | null = null;

// ---------------------------------------------------------------------------------------------------------------
// Scene

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2229);
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 300);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7580, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-8, 20, 12);
scene.add(sun);
scene.add(buildRink());

/** A bright ring on the ice under the followed player, so he is easy to pick out among the markers. */
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.64, 0.72, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffc928, transparent: true, opacity: 0.8, depthWrite: false }),
);
ring.renderOrder = 2;
scene.add(ring);
const others = new THREE.Group();
scene.add(others);
const puck = new THREE.Group();
{
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16).translate(0, 0.015, 0), new THREE.MeshLambertMaterial({ color: 0x0b0b0c }));
  const shadow = createShadowBlob();
  shadow.scale.setScalar(0.09);
  puck.add(disc, shadow);
  scene.add(puck);
}

function fit(): void {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round((w * 9) / 16));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', fit);
new ResizeObserver(fit).observe(canvas);

// ---------------------------------------------------------------------------------------------------------------
// Game, followed player, gait

let setup: GameSetup;
let playback: Playback | null = null;
let scanner: MomentScanner;
let defs = new Map<string, PlayerDef>();
let markers = new Map<string, THREE.Object3D>();
let followId = '';
let followDef: PlayerDef;
let dims: BodyDims;
let rig: SkaterRig | null = null;
let gait: GaitState = initialGait();
let gaitFresh = true;
let playing = false;
let speed = 1;
let cameraMode: CameraMode = 'follow';
let snapCamera = true;
let lastStyle: Style = 'stand';
let lastSpeed = 0;
let lastOnIce = false;
/** 0..1, eased: how far he is down in a faceoff crouch (at the dot while the faceoff is being set up). */
let crouch = 0;
const CROUCH_DOT = 1.3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** His motion part-way between two ticks: velocity and facing blended, acceleration and turn rate over the tick. */
function blendedMotion(prev: SkaterState, next: SkaterState, alpha: number): Motion {
  const over = motionOf(prev, next, DT);
  const at: SkaterState = { ...next, vel: { x: lerp(prev.vel.x, next.vel.x, alpha), y: lerp(prev.vel.y, next.vel.y, alpha) }, facing: lerpAngle(prev.facing, next.facing, alpha) };
  const here = motionOf(at, at, 0);
  return { ...here, accelAlong: over.accelAlong, turnRate: over.turnRate, down: next.downT > 0 };
}

function resetGait(): void {
  gait = initialGait();
  gaitFresh = true;
  snapCamera = true;
}

function follow(id: string): void {
  const def = defs.get(id);
  if (!def) return;
  followId = id;
  followDef = def;
  dims = bodyDims(def.heightCm, def.weightKg);
  if (rig) { scene.remove(rig.root); rig.dispose(); }
  const side: Side = setup.home.players.includes(def) ? 'home' : 'away';
  rig = createSkaterRig(def, TEAM_COLORS[side]);
  scene.add(rig.root);
  picker.value = id;
  $('who').textContent = `#${def.number} ${def.name} · ${positionName(def.position)} · ${def.heightCm} cm, ${def.weightKg} kg · shoots ${def.shoots === 'L' ? 'left' : 'right'}`;
  renderJumps();
  resetGait();
}

const positionName = (p: PlayerDef['position']): string =>
  ({ C: 'centre', LW: 'left wing', RW: 'right wing', LD: 'left defence', RD: 'right defence', G: 'goalie' })[p];

function buildMarkers(state: GameState): void {
  others.clear();
  markers = new Map();
  for (const s of state.skaters) {
    const def = defs.get(s.id)!;
    const m = createMarker(TEAM_COLORS[s.side].marker, bodyRadius(def.weightKg), def.number);
    markers.set(s.id, m);
    others.add(m);
  }
  for (const side of ['home', 'away'] as const) {
    const g = state.goalies[side];
    const m = createMarker(TEAM_COLORS[side].marker, 0.55, defs.get(g.id)?.number);
    markers.set(g.id, m);
    others.add(m);
  }
}

function fillPicker(): void {
  picker.replaceChildren();
  for (const team of [setup.home, setup.away]) {
    const group = document.createElement('optgroup');
    group.label = team.name;
    const order = { LD: 0, RD: 1, C: 2, LW: 3, RW: 4, G: 5 } as const;
    for (const p of [...team.players].filter((x) => x.position !== 'G').sort((a, b) => order[a.position] - order[b.position] || a.number - b.number)) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `#${p.number} ${p.name} (${p.position})`;
      group.appendChild(o);
    }
    picker.appendChild(group);
  }
}

const clockText = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function renderJumps(): void {
  const box = $('jumps');
  const label = document.createElement('span');
  label.textContent = 'Jump to';
  const list: Moment[] = scanner ? scanner.momentsFor(followId) : [];
  const buttons = list.map((m) => {
    const b = document.createElement('button');
    b.textContent = m.label;
    const when = document.createElement('small');
    when.textContent = `P${m.period} ${clockText(m.clock)}`;
    b.appendChild(when);
    b.addEventListener('click', () => { seek(m.tick); setPlaying(true); });
    return b;
  });
  if (buttons.length === 0) { const none = document.createElement('span'); none.textContent = 'nothing found for this player'; buttons.push(none as unknown as HTMLButtonElement); }
  box.replaceChildren(label, ...buttons);
}

function seek(tick: number): void {
  if (!playback) return;
  playback.seek(tick);
  resetGait();
  update(0);
}

function setPlaying(on: boolean): void {
  playing = on && playback !== null && playback.frame().tick < playback.totalTicks;
  playBtn.textContent = playing ? 'Pause' : 'Play';
}

function setSpeed(v: number): void {
  speed = v;
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === v)));
}

function setCamera(mode: CameraMode): void {
  cameraMode = mode;
  snapCamera = true;
  document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.camera === mode)));
}

const nextPaint = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function newGame(): Promise<void> {
  const seed = Math.trunc(Number($<HTMLInputElement>('seed').value)) || 0;
  loading.hidden = false;
  loading.textContent = 'Simulating…';
  setPlaying(false);
  document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = true; });
  await nextPaint();
  setup = { home: generateTeam(seed * 2 + 1, 'Harbour City', 'HBR'), away: generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK'), seed, chemistry: [] };
  defs = new Map();
  for (const t of [setup.home, setup.away]) for (const p of t.players) defs.set(p.id, p);
  scanner = createMomentScanner();
  const t0 = performance.now();
  playback = createPlayback(setup, { onStep: scanner.onStep });
  simulateMs = performance.now() - t0;
  buildMarkers(playback.frame().next);
  fillPicker();
  follow(setup.home.lines.defence[0]![0]);
  seek(0);
  document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = false; });
  loading.hidden = true;
}
let simulateMs = 0;

// ---------------------------------------------------------------------------------------------------------------
// Each frame

const camOff = new THREE.Vector3(), camLook = new THREE.Vector3();
let camHeading = 0;
let sideSign = 1;

/**
 * Ease the camera's offset from him (not its position in the rink), so it keeps up with a skater at full speed: the
 * offset turns with his smoothed travel direction, behind him (follow), to his right-hand side (side) or overhead.
 */
function placeCamera(dt: number, x: number, z: number, vel: { x: number; y: number }, facing: number): void {
  const sp = Math.hypot(vel.x, vel.y);
  const want = sp > 1.2 ? Math.atan2(vel.y, vel.x) : (snapCamera ? facing : camHeading);
  const k = (tau: number): number => (snapCamera || orbit ? 1 : 1 - Math.exp(-dt / tau));
  camHeading = lerpAngle(camHeading, want, k(cameraMode === 'side' ? 1.2 : 0.8));
  const c = Math.cos(camHeading), s = Math.sin(camHeading);
  const off = new THREE.Vector3(), look = new THREE.Vector3();
  if (cameraMode === 'follow') {
    off.set(-c * 5.2, 2.7, -s * 5.2);
    look.set(c * 2, 0.8, s * 2);
  } else if (cameraMode === 'side') {
    // His right-hand side of travel, or his left when that keeps the camera inside the boards (switching only then).
    const inside = (side: number): boolean => {
      const px = x - side * s * 6, pz = z + side * c * 6;
      return Math.abs(px) < RINK.halfLength - 0.5 && Math.abs(pz) < iceHalfWidthAt(px) - 0.5;
    };
    if (!inside(sideSign) && inside(-sideSign)) { sideSign = -sideSign; snapCamera = true; }
    off.set(-sideSign * s * 6 + c * 0.6, 1.2, sideSign * c * 6 + s * 0.6);
    look.set(c * 0.6, 0.8, s * 0.6);
  } else {
    off.set(0, 12, 0.001);
    look.set(0, 0, 0);
  }
  if (orbit) {
    const a = facing + orbit.angle;
    off.set(Math.cos(a) * orbit.dist, orbit.height, Math.sin(a) * orbit.dist);
    look.set(0, 0.8, 0);
  }
  camOff.lerp(off, k(0.3));
  camLook.lerp(look, k(0.2));
  camera.up.set(0, 1, 0);
  if (cameraMode === 'above' && !orbit) camera.up.set(0, 0, -1); // engine x to the right, engine y down: as the debug view
  camera.position.set(x + camOff.x, camOff.y, z + camOff.z);
  camera.lookAt(x + camLook.x, camLook.y, z + camLook.z);
  snapCamera = false;
}

function scoreLine(st: GameState): void {
  const el = $('scoreline');
  const phase = st.phase === 'final' ? 'Final' : st.phase === 'intermission' ? `End of period ${st.period}` : `Period ${st.period}`;
  const stopped = st.phase === 'stopped' || st.phase === 'faceoffSetup' ? ' (stopped)' : '';
  const home = document.createElement('span'); home.className = 'home'; home.textContent = `${setup.home.name} ${st.score.home}`;
  const away = document.createElement('span'); away.className = 'away'; away.textContent = `${st.score.away} ${setup.away.name}`;
  const rest = document.createElement('span'); rest.className = 'muted'; rest.textContent = ` · ${phase} · ${clockText(st.phase === 'final' || st.phase === 'intermission' ? 0 : st.clock)}${stopped}`;
  el.replaceChildren(home, ' – ', away, rest);
}

/** Move the scene to the playback's display time; `gameDt` is the game time just played (0 when paused). */
function update(gameDt: number, displayDt = gameDt): void {
  if (!playback) return;
  const f: Frame = playback.frame();
  const a = f.alpha;
  const prevById = new Map(f.prev.skaters.map((s) => [s.id, s]));
  for (const s of f.next.skaters) {
    const p = prevById.get(s.id) ?? s;
    const x = lerp(p.pos.x, s.pos.x, a), z = lerp(p.pos.y, s.pos.y, a), facing = lerpAngle(p.facing, s.facing, a);
    const mk = markers.get(s.id);
    if (s.id !== followId) {
      if (mk) { mk.visible = s.onIce; mk.position.set(x, 0, z); mk.rotation.y = -facing; }
      continue;
    }
    if (mk) mk.visible = false;
    if (!rig) continue;
    if (!s.onIce) {
      rig.root.visible = false;
      ring.visible = false;
      if (lastOnIce) resetGait();
      lastOnIce = false;
      continue;
    }
    lastOnIce = true;
    const m = handedMotion(followDef, blendedMotion(p, s, a));
    const fresh = gaitFresh;
    if (gaitFresh) {
      // Settle a fresh gait on the motion he has now without a turn-rate or acceleration spike from the jump.
      gait = stepGait(initialGait(), { ...m, accelAlong: 0, turnRate: 0 }, 0);
      gaitFresh = false;
    } else if (gameDt > 0) gait = stepGait(gait, m, gameDt);
    const atDot = f.next.phase === 'faceoffSetup' && Math.hypot(s.pos.x - f.next.faceoffSpot.x, s.pos.y - f.next.faceoffSpot.y) < CROUCH_DOT && m.speed < 0.5;
    crouch = fresh ? (atDot ? 1 : 0) : crouch + ((atDot ? 1 : 0) - crouch) * (1 - Math.exp(-Math.max(gameDt, 0) / 0.35));
    rig.apply(poseOf(gait, m, dims, { crouch }), x, z, facing);
    ring.position.set(x, 0.006, z);
    ring.visible = true;
    rig.root.visible = true;
    lastStyle = gait.style;
    lastSpeed = m.speed;
    placeCamera(displayDt, x, z, { x: lerp(p.vel.x, s.vel.x, a), y: lerp(p.vel.y, s.vel.y, a) }, facing);
  }
  for (const side of ['home', 'away'] as const) {
    const gp = f.prev.goalies[side], gn = f.next.goalies[side];
    const mk = markers.get(gn.id);
    if (mk) { mk.position.set(lerp(gp.pos.x, gn.pos.x, a), 0, lerp(gp.pos.y, gn.pos.y, a)); mk.rotation.y = -lerpAngle(gp.facing, gn.facing, a); }
  }
  const pp = f.prev.puck, pn = f.next.puck;
  puck.position.set(lerp(pp.pos.x, pn.pos.x, a), 0, lerp(pp.pos.y, pn.pos.y, a));
  (puck.children[0] as THREE.Object3D).position.y = Math.max(0, lerp(pp.z, pn.z, a));
  $('skating').textContent = lastOnIce ? `Skating: ${STYLE_NAMES[lastStyle]} · ${lastSpeed.toFixed(1)} m/s` : 'Skating: on the bench';
  scoreLine(f.next);
  if (playing && f.tick >= playback.totalTicks) setPlaying(false);
}

let lastT = 0;
let frames = 0, fpsSince = 0, fps = 0;
let manual = false;

function loop(t: number): void {
  requestAnimationFrame(loop);
  if (manual) return;
  const dt = lastT === 0 ? 0 : Math.min(0.1, (t - lastT) / 1000); // a background tab must not make the game jump
  lastT = t;
  if (playback) {
    const gameDt = playing ? dt * speed : 0;
    if (gameDt > 0) playback.advance(gameDt);
    update(gameDt, dt);
  }
  renderer.render(scene, camera);
  frames++;
  if (t - fpsSince >= 1000) { fps = (frames * 1000) / (t - fpsSince); frames = 0; fpsSince = t; }
}

// ---------------------------------------------------------------------------------------------------------------
// Controls

playBtn.addEventListener('click', () => setPlaying(!playing));
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.camera as CameraMode)));
picker.addEventListener('change', () => { follow(picker.value); update(0); });
$('newgame').addEventListener('click', () => { void newGame(); });
$<HTMLInputElement>('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') void newGame(); });

/**
 * A small hook for driving the page from a script (the screenshot run): seek, pick a player and camera, step a fixed
 * amount of display time and render, with the real-time loop switched off while `manual` is on.
 */
const hook = {
  ready: (): boolean => playback !== null && loading.hidden,
  seek: (tick: number): void => seek(tick),
  setPlayer: (idOrNumber: string | { side: Side; number: number }): void => {
    const id = typeof idOrNumber === 'string' ? idOrNumber : (idOrNumber.side === 'home' ? setup.home : setup.away).players.find((p) => p.number === idOrNumber.number)?.id;
    if (id) { follow(id); update(0); }
  },
  setCamera: (mode: CameraMode): void => { orbit = null; setCamera(mode); },
  /** A camera fixed in his body frame: angle (degrees) from his facing toward his right, distance and height (m). */
  orbit: (angleDeg: number, dist = 3.2, height = 1.1): void => { orbit = { angle: (angleDeg * Math.PI) / 180, dist, height }; snapCamera = true; update(0); },
  setSpeed: (v: number): void => setSpeed(v),
  setManual: (on: boolean): void => { manual = on; lastT = 0; if (on) setPlaying(false); },
  /** Play `seconds` of display time at the current speed, in steps of at most 1/60 s, then render. */
  step: (seconds: number): void => {
    if (!playback) return;
    let left = seconds;
    while (left > 1e-9) {
      const dt = Math.min(1 / 60, left);
      playback.advance(dt * speed);
      update(dt * speed, dt);
      left -= dt;
    }
  },
  renderOnce: (): void => { fit(); renderer.render(scene, camera); },
  info: () => ({
    tick: playback?.frame().tick ?? 0, totalTicks: playback?.totalTicks ?? 0, style: lastStyle, speed: lastSpeed, onIce: lastOnIce,
    follow: followId, player: followDef ? `#${followDef.number} ${followDef.name} ${followDef.position} ${followDef.shoots}` : '', fps, simulateMs,
  }),
  moments: (): Moment[] => scanner.momentsFor(followId),
  debug: () => {
    const f = playback!.frame(), sk = f.next.skaters.find((x) => x.id === followId)!;
    return { cam: camera.position.toArray(), look: camLook.toArray(), root: rig?.root.position.toArray(), rotY: rig?.root.rotation.y, camHeading, facing: sk.facing, vel: sk.vel, gait };
  },
  /** Where the followed figure's chest is on the canvas, as fractions of its width and height (0,0 top left). */
  screenPos: (): { x: number; y: number } | null => {
    if (!rig || !rig.root.visible) return null;
    const v = new THREE.Vector3(0, dims.hipHeight + 0.2, 0).applyMatrix4(rig.root.matrixWorld).project(camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  },
  /** The canvas as a PNG data URL, rendered now (so it does not depend on the drawing buffer being kept). */
  grab: (): string => { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
  players: () => [...defs.values()].map((p) => ({ id: p.id, number: p.number, position: p.position, side: setup.home.players.includes(p) ? 'home' : 'away', heightCm: p.heightCm, weightKg: p.weightKg, shoots: p.shoots })),
};
(window as unknown as { __viewer: typeof hook }).__viewer = hook;

fit();
setSpeed(1);
requestAnimationFrame(loop);
void newGame();
