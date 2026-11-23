import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlayerDef } from '@hockey/engine';
import { bodyDims, type BodyDims } from './body';
import { hipJoint, shoulderJoint, solveLeg, torsoRotate, type Motion, type Pose, type Vec3 } from './gait';
import { twoBone } from './goalie-pose';

/**
 * The jointed skater figure (three.js). It takes a Pose in the body frame of gait.ts (x forward, y up, z to his right,
 * origin on the ice under the pelvis) and places it in the world: engine x is world X, engine y is world Z, up is
 * world Y, so with engine facing f his forward is world (cos f, 0, sin f) and his right is world (-sin f, 0, cos f).
 * That is a turn of -f about world Y (three.js turns +x toward -z for a positive angle).
 *
 * Poses are worked out for a left shot. For a right shot the motion going into the gait is mirrored (handedMotion) and
 * the pose coming out is mirrored back (z, yaws and roll negated, left and right swapped), so he moves the same way
 * but holds the stick on his right with his left hand on top.
 *
 * Geometries and materials come from a RigKit: a scene with many figures passes one kit to all of them, so every
 * figure shares one set of geometries (built for a reference body and scaled to his size) and one set of materials per
 * team; his back (surname over number) is the only texture of his own. Without a kit a figure makes a private one,
 * with a shadow under each skate as well as the body, and frees it with itself.
 */

export type RigColors = { jersey: number; trim: number; pants: number };
export type SkaterRig = { root: THREE.Group; apply(pose: Pose, worldX: number, worldZ: number, facing: number): void; dispose(): void };

const SKIN = 0xd9a483;
const DARK = 0x18191c;
const HOLDER = 0x3a3d42;
const STEEL = 0xdfe5ec;
const STICK = 0x222327;
const BLADE = 0x101012;
const PAD = 0xefefea;
const CAGE = 0xc9ced4;

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
/** Turn a body-frame vector by heading h about the vertical (x toward +z), as gait.ts does. */
const turn = (v: Vec3, h: number): Vec3 => { const c = Math.cos(h), s = Math.sin(h); return v3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); };

/** The motion his gait should be stepped with: mirrored for a right shot (see the file comment). */
export function handedMotion(def: Pick<PlayerDef, 'shoots'>, m: Motion): Motion {
  return def.shoots === 'R' ? { ...m, lateral: -m.lateral, turnRate: -m.turnRate, facing: -m.facing } : m;
}

/**
 * Mirror a pose across his centre plane (z to -z): left and right swap, so the top hand on the stick is arms[0]. Every
 * output of the pose comes across: the blade's heel (z mirrored), the head's tilt down and the grip as they are.
 */
export function mirrorPose(p: Pose): Pose {
  const mz = (v: Vec3): Vec3 => v3(v.x, v.y, -v.z);
  const leg = (l: Pose['legs'][number]): Pose['legs'][number] => ({ foot: mz(l.foot), footYaw: -l.footYaw, lifted: l.lifted });
  const out: Pose = {
    hipY: p.hipY, pitch: p.pitch, roll: -p.roll, yaw: -p.yaw, twist: -(p.twist ?? 0), look: -(p.look ?? 0),
    legs: [leg(p.legs[1]), leg(p.legs[0])],
    arms: [{ hand: mz(p.arms[1].hand) }, { hand: mz(p.arms[0].hand) }],
    stickAngle: -p.stickAngle, grip: p.grip,
  };
  if (p.lookDown !== undefined) out.lookDown = p.lookDown;
  if (p.blade !== undefined) out.blade = mz(p.blade);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Textures drawn on a canvas (only where there is a DOM: the unit tests build the figure without one).

const hasDom = (): boolean => typeof document !== 'undefined';
let blobTexture: THREE.Texture | null = null;
let minBlobTexture: THREE.Texture | null = null;

/** A soft round shadow (dark in the middle, fading to nothing at the rim). */
function shadowTexture(): THREE.Texture | null {
  if (!hasDom()) return null;
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

/** The same shadow as a grey level on white, for a blob drawn with "darkest wins" blending (see sharedShadowMaterial). */
function minShadowTexture(): THREE.Texture | null {
  if (!hasDom()) return null;
  if (minBlobTexture) return minBlobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  grad.addColorStop(0, 'rgb(118,122,128)');
  grad.addColorStop(0.5, 'rgb(170,174,180)');
  grad.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  minBlobTexture = new THREE.CanvasTexture(c);
  minBlobTexture.colorSpace = THREE.SRGBColorSpace;
  return minBlobTexture;
}

/** True for the textures every figure shares (never freed by one figure). */
export const isSharedTexture = (t: THREE.Texture | null | undefined): boolean => t != null && (t === blobTexture || t === minBlobTexture);

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** His surname: the last word of his name. */
export const surname = (name: string): string => { const parts = name.trim().split(/\s+/); return parts[parts.length - 1] ?? ''; };

/**
 * The back of his jersey: his surname in capitals across the top and his number below, in the trim colour outlined in
 * the pants colour, on a transparent background (square; the number fills the lower two thirds). With no name it is
 * the number alone, centred, as before.
 */
export function numberTexture(n: number, colors: RigColors, name?: string): THREE.Texture | null {
  if (!hasDom()) return null;
  const size = name ? 256 : 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = css(colors.pants);
  g.fillStyle = css(colors.trim);
  const write = (text: string, px: number, y: number, stroke: number): void => {
    g.font = `bold ${px}px ${FONT}`;
    // Squeeze a long name to the width rather than shrink it.
    const w = g.measureText(text).width, max = size * 0.92;
    g.save();
    g.translate(size / 2, y);
    if (w > max) g.scale(max / w, 1);
    g.lineWidth = stroke;
    g.strokeText(text, 0, 0);
    g.fillText(text, 0, 0);
    g.restore();
  };
  if (name) {
    write(name.toUpperCase(), 44, 34, 6);
    write(String(n), n >= 10 ? 150 : 170, 158, 12);
  } else write(String(n), n >= 10 ? 84 : 100, 70, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A shadow blob lying on the ice (radius 1; scale it), with a material of its own. */
export function createShadowBlob(): THREE.Mesh {
  const map = shadowTexture();
  const mat = map
    ? new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 1 })
    : new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: 0.25 });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.004;
  m.renderOrder = 1;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// The kit: geometries and materials shared by every figure built with it

export type TeamMaterials = { jersey: THREE.MeshLambertMaterial; trim: THREE.MeshLambertMaterial; pants: THREE.MeshLambertMaterial };
/** `paint` colours by vertex: every skater part is drawn with it, coloured for his team in its geometry. */
export type CommonMaterials = Record<'paint' | 'visor' | 'dark' | 'steel' | 'stick' | 'pad' | 'cage', THREE.MeshLambertMaterial>;

export type RigKit = {
  /** The jersey, trim and pants materials for a team's colours (one set per set of colours). */
  team(colors: RigColors): TeamMaterials;
  readonly common: CommonMaterials;
  /** A geometry kept under `key`, made by `make` the first time. */
  geo<G extends THREE.BufferGeometry>(key: string, make: () => G): G;
  /** His back (surname and number); shared while in use, freed when the last figure with it lets go. */
  backTexture(name: string, n: number, colors: RigColors): THREE.Texture | null;
  releaseTexture(t: THREE.Texture | null): void;
  /** A shadow blob (radius 1). In a shared kit all blobs share one material that never darkens a spot twice. */
  shadow(): THREE.Mesh;
  /** Draw a shadow under each skate too (the single-figure page); a scene of many figures keeps one blob each. */
  readonly footShadows: boolean;
  /**
   * How finely the figures are tessellated: `full` (smooth; the single-figure page and a GPU) or `lite` (about a
   * quarter of the triangles, for a dozen figures in a software renderer, where triangles cost more than anything).
   */
  readonly detail: 'full' | 'lite';
  dispose(): void;
};

/**
 * Shadow blobs with "darkest wins" blending: each blob writes a grey level and the pixel keeps the minimum of it and
 * what is there, so blobs that overlap in a battle never stack into a black patch.
 */
function sharedShadowMaterial(): THREE.MeshBasicMaterial {
  const map = minShadowTexture();
  const m = map
    ? new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })
    : new THREE.MeshBasicMaterial({ color: 0x808080, transparent: true, depthWrite: false, toneMapped: false });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.MinEquation;
  m.blendEquationAlpha = THREE.MaxEquation;
  return m;
}

export function createRigKit(opts: { footShadows?: boolean; detail?: 'full' | 'lite' } = {}): RigKit {
  const lambert = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });
  const teams = new Map<string, TeamMaterials>();
  const geos = new Map<string, THREE.BufferGeometry>();
  const textures = new Map<string, { t: THREE.Texture | null; refs: number }>();
  const common: CommonMaterials = {
    paint: new THREE.MeshLambertMaterial({ vertexColors: true }),
    visor: new THREE.MeshLambertMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.55 }),
    // The goalie's (his parts are plain meshes, one material each).
    dark: lambert(DARK), stick: lambert(STICK),
    steel: new THREE.MeshLambertMaterial({ color: STEEL, emissive: 0x2a2f36 }),
    pad: lambert(PAD), cage: lambert(CAGE),
  };
  const footShadows = opts.footShadows ?? false;
  const blobGeo = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  const blobMat = footShadows ? null : sharedShadowMaterial();
  return {
    common,
    footShadows,
    detail: opts.detail ?? 'full',
    team(colors) {
      const key = `${colors.jersey}|${colors.trim}|${colors.pants}`;
      let t = teams.get(key);
      if (!t) { t = { jersey: lambert(colors.jersey), trim: lambert(colors.trim), pants: lambert(colors.pants) }; teams.set(key, t); }
      return t;
    },
    geo(key, make) {
      let g = geos.get(key);
      if (!g) { g = make(); geos.set(key, g); }
      return g as ReturnType<typeof make>;
    },
    backTexture(name, n, colors) {
      const key = `${name}|${n}|${colors.trim}|${colors.pants}`;
      let e = textures.get(key);
      if (!e) { e = { t: numberTexture(n, colors, name), refs: 0 }; textures.set(key, e); }
      e.refs++;
      return e.t;
    },
    releaseTexture(t) {
      if (!t) return;
      for (const [key, e] of textures) if (e.t === t && --e.refs <= 0) { t.dispose(); textures.delete(key); }
    },
    shadow() {
      if (!blobMat) return createShadowBlob();
      const m = new THREE.Mesh(blobGeo, blobMat);
      m.position.y = 0.004;
      m.renderOrder = 1;
      m.name = 'shadow';
      return m;
    },
    dispose() {
      for (const t of teams.values()) for (const m of Object.values(t)) m.dispose();
      for (const m of Object.values(common)) m.dispose();
      for (const g of geos.values()) g.dispose();
      for (const e of textures.values()) e.t?.dispose();
      blobGeo.dispose();
      blobMat?.dispose();
      teams.clear(); geos.clear(); textures.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The figure

/** The shapes a figure is built from, finely (`full`) or coarsely (`lite`) tessellated. */
function shapes(full: boolean) {
  return {
    /** A capsule of radius r from its origin up along +y to `length` (the far joint), to be aimed joint to joint. */
    limb: (r: number, length: number): THREE.BufferGeometry =>
      new THREE.CapsuleGeometry(r, length, full ? 3 : 1, full ? 10 : 6).translate(0, length / 2, 0),
    /**
     * A block d deep (x), h tall, w wide (z) with rounded edges: a rounded box when full, else a low eight-sided
     * prism with flat faces front, back and to the sides.
     */
    block: (d: number, h: number, w: number, round: number): THREE.BufferGeometry => {
      if (full) return new RoundedBoxGeometry(d, h, w, 2, round);
      const r = 0.5 / Math.cos(Math.PI / 8);
      return new THREE.CylinderGeometry(r, r, 1, 8).rotateY(Math.PI / 8).scale(d, h, w);
    },
    /** A small box (gloves, boots): rounded when full. */
    box: (x: number, y: number, z: number, round: number): THREE.BufferGeometry =>
      full ? new RoundedBoxGeometry(x, y, z, 1, round) : new THREE.BoxGeometry(x, y, z),
    sphere: (r: number, ws: number, hs: number, ...rest: number[]): THREE.BufferGeometry =>
      new THREE.SphereGeometry(r, full ? ws : Math.max(4, Math.round(ws * 0.6)), full ? hs : Math.max(2, Math.round(hs * 0.5)), ...rest),
    ring: (r0: number, r1: number, h: number, closed = false): THREE.BufferGeometry => new THREE.CylinderGeometry(r0, r1, h, full ? 12 : 6, 1, !closed),
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

function aim(o: THREE.Object3D, from: Vec3, to: Vec3): void {
  o.position.set(from.x, from.y, from.z);
  _dir.set(to.x - from.x, to.y - from.y, to.z - from.z);
  if (_dir.lengthSq() > 1e-12) o.quaternion.setFromUnitVectors(UP, _dir.normalize());
}

/** The sizes of his parts (m); a figure's geometries are built for the reference body and scaled to these. */
function partSizes(def: Pick<PlayerDef, 'heightCm' | 'weightKg'>) {
  const d = bodyDims(def.heightCm, def.weightKg);
  const k = def.heightCm / 185;
  // Girth relative to an average build, exaggerated a little so build reads at a glance.
  const girth = d.bulk / (0.15 * Math.max(0.6, def.heightCm / 100) / 1.85);
  const build = girth * girth;
  const thighR = 0.075 * k * (0.7 + 0.3 * build);
  const shinR = 0.052 * k * (0.75 + 0.25 * build);
  const pantsW = d.hipWidth + 2 * thighR * 1.25, pantsD = 2 * d.bulk * 0.92, pantsH = 0.27 * k;
  const torsoW = Math.max(d.shoulderWidth * 0.86, pantsW * 1.02), torsoD = 2 * d.bulk;
  const torsoBottom = -0.04 * k, torsoTop = d.torso + 0.03 * k;
  return {
    d, k, build, thighR, shinR, pantsW, pantsD, pantsH, torsoW, torsoD, torsoBottom, torsoTop, torsoH: torsoTop - torsoBottom,
    upperR: 0.055 * k * (0.75 + 0.25 * build), foreR: 0.047 * k * (0.75 + 0.25 * build),
    padR: 0.085 * k * (0.75 + 0.25 * build),
  };
}
type Parts = ReturnType<typeof partSizes>;
const REF: Parts = partSizes({ heightCm: 185, weightKg: 90 });

/** One piece of a painted part: its own geometry (used up by the merge), its colour and where it sits in the part. */
type Piece = { geo: THREE.BufferGeometry; color: number; at?: [number, number, number]; scale?: [number, number, number]; rotY?: number };
const _c = new THREE.Color(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/**
 * Merge pieces into one geometry coloured per vertex, so a part of several colours (a jersey with its trim bands, a
 * skate) is one mesh: one draw for the part instead of one per piece.
 */
function painted(pieces: Piece[]): THREE.BufferGeometry {
  const parts = pieces.map((pc) => {
    const g = pc.geo.index ? pc.geo.toNonIndexed() : pc.geo; // rounded boxes come unindexed: merge all alike
    _q.setFromAxisAngle(UP, pc.rotY ?? 0);
    _p.set(...(pc.at ?? [0, 0, 0]));
    _s.set(...(pc.scale ?? [1, 1, 1]));
    g.applyMatrix4(_m4.compose(_p, _q, _s));
    _c.setHex(pc.color);
    const n = g.attributes.position!.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[3 * i] = _c.r; col[3 * i + 1] = _c.g; col[3 * i + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  for (const pc of pieces) pc.geo.dispose();
  if (!out) throw new Error('painted: pieces do not merge');
  return out;
}

export function createSkaterRig(def: PlayerDef, colors: RigColors, sharedKit?: RigKit): SkaterRig {
  const kit = sharedKit ?? createRigKit({ footShadows: true });
  const P = partSizes(def), R = REF;
  const d: BodyDims = P.d, k = P.k;
  const right = def.shoots === 'R';
  const top = right ? 0 : 1; // the hand on the butt of the stick
  const paint = kit.common.paint;
  const S = shapes(kit.detail === 'full');
  // Geometries for the reference body, coloured for his team (one set per team, shared by its figures).
  const team = `${colors.jersey}|${colors.trim}|${colors.pants}`;
  const g = (key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry => kit.geo(`sk.${key}|${team}`, make);
  const { jersey: J, trim: T, pants: PA } = colors;
  const rk = R.k; // 1: the reference body's height scale

  const root = new THREE.Group();
  root.name = `skater-${def.number}`;
  const mesh = (geo: THREE.BufferGeometry, name = '', mat: THREE.Material = paint): THREE.Mesh => { const m = new THREE.Mesh(geo, mat); m.name = name; return m; };

  // Pelvis and pants (turn with the pelvis yaw).
  const pelvis = new THREE.Group();
  const pantsBox = mesh(g('pants', () => painted([{ geo: S.block(R.pantsD, R.pantsH, R.pantsW, 0.06 * R.k), color: PA }])), 'pants');
  pantsBox.position.y = -0.05 * k;
  pantsBox.scale.set(P.pantsD / R.pantsD, P.pantsH / R.pantsH, P.pantsW / R.pantsW);
  pelvis.add(pantsBox);
  root.add(pelvis);

  // Torso (pitch then roll about the pelvis centre; no yaw): the jersey with its trim bands, collar and shoulder pads
  // in one piece, and his back (surname and number). Built for the reference body in `chestFrame`, scaled to his size.
  const torso = new THREE.Group();
  const chestFrame = new THREE.Group();
  chestFrame.scale.set(P.torsoD / R.torsoD, P.torsoH / R.torsoH, P.torsoW / R.torsoW);
  chestFrame.position.y = P.torsoBottom - R.torsoBottom * (P.torsoH / R.torsoH);
  torso.add(chestFrame);
  const chest = mesh(g('torso', () => {
    const pad = (s: number): Piece => ({ geo: S.sphere(R.padR, 12, 8), color: J, at: [-0.01 * rk, R.d.torso - 0.01 * rk, s * (R.d.shoulderWidth / 2 - 0.02 * rk)], scale: [1.15, 0.6, 1] });
    return painted([
      { geo: S.block(R.torsoD, R.torsoH, R.torsoW, 0.07 * rk), color: J, at: [0, (R.torsoTop + R.torsoBottom) / 2, 0] },
      { geo: S.block(R.torsoD * 1.03, 0.045 * rk, R.torsoW * 1.03, 0.02 * rk), color: T, at: [0, R.torsoBottom + 0.06 * rk, 0] },
      { geo: S.block(R.torsoD * 1.03, 0.022 * rk, R.torsoW * 1.03, 0.01 * rk), color: T, at: [0, R.torsoBottom + 0.12 * rk, 0] },
      { geo: S.ring(0.075 * rk, 0.09 * rk, 0.05 * rk), color: T, at: [0, R.torsoTop, 0] },
      pad(-1), pad(1),
    ]);
  }), 'jersey');
  chestFrame.add(chest);
  const backMap = kit.backTexture(surname(def.name), def.number, colors);
  const backMat = backMap
    ? new THREE.MeshBasicMaterial({ map: backMap, transparent: true, depthWrite: false, toneMapped: false })
    : new THREE.MeshBasicMaterial({ color: colors.trim, transparent: true, opacity: 0 });
  const backSize = R.torsoW * 0.78;
  const number = mesh(kit.geo('sk.back', () => new THREE.PlaneGeometry(backSize, backSize)), 'number', backMat);
  number.position.set(-R.torsoD / 2 - 0.006, R.d.torso * 0.5, 0);
  number.rotation.y = -Math.PI / 2; // faces -x (his back), reading left to right for someone behind him
  chestFrame.add(number);
  root.add(torso);

  // Head: face and neck, the helmet in the jersey colour, and a visor (it marks his front); scaled to his head.
  const head = new THREE.Group();
  const hr0 = R.d.headRadius;
  head.scale.setScalar(d.headRadius / hr0);
  const headMesh = mesh(g('head', () => painted([
    { geo: S.sphere(hr0 * 0.92, 14, 10), color: SKIN, scale: [1, 1.08, 0.92] },
    { geo: S.ring(0.05 * rk, 0.055 * rk, 0.12 * rk), color: SKIN, at: [0, -hr0 * 0.95, 0] },
    { geo: S.sphere(hr0 * 1.06, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), color: J, at: [-0.01 * rk, 0.015 * rk, 0] },
  ])), 'head');
  const visor = mesh(kit.geo('sk.visor', () => S.sphere(hr0 * 1.07, 12, 4, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.42, Math.PI * 0.16)), 'face', kit.common.visor);
  visor.rotation.y = Math.PI; // SphereGeometry's phi = 0 is -x: turn the visor's middle round to face +x
  head.add(headMesh, visor);
  root.add(head);

  // Arms: upper arm and forearm in the jersey (a trim band at the elbow), gloves with a jersey cuff.
  const foreLen0 = R.d.forearm - 0.05 * rk;
  const upperGeo = g('upper', () => painted([{ geo: S.limb(R.upperR, R.d.upperArm), color: J }]));
  const foreGeo = g('fore', () => painted([
    { geo: S.limb(R.foreR, foreLen0), color: J },
    { geo: S.ring(R.foreR * 1.12, R.foreR * 1.12, 0.06 * rk), color: T, at: [0, 0.09 * rk, 0] },
  ]));
  const gloveGeo = g('glove', () => painted([
    { geo: S.box(0.1 * rk, 0.15 * rk, 0.1 * rk, 0.025 * rk), color: DARK },
    { geo: S.ring(0.065 * rk, 0.065 * rk, 0.07 * rk, true), color: J, at: [0, -0.09 * rk, 0] },
  ]));
  const upper: THREE.Mesh[] = [], fore: THREE.Object3D[] = [], gloves: THREE.Object3D[] = [];
  const armR = P.upperR / R.upperR;
  for (let i = 0; i < 2; i++) {
    const u = mesh(upperGeo, `upperArm${i}`);
    u.scale.set(armR, d.upperArm / R.d.upperArm, armR);
    upper.push(u);
    const f = mesh(foreGeo, `forearm${i}`);
    f.scale.set(P.foreR / R.foreR, (d.forearm - 0.05 * k) / foreLen0, P.foreR / R.foreR);
    fore.push(f);
    const glove = mesh(gloveGeo, `glove${i}`);
    glove.scale.setScalar(k / rk);
    gloves.push(glove);
    root.add(u, f, glove);
  }

  // Legs: thighs in the pants, shins in the socks (trim stripe), skates with boot, holder and steel.
  const bootL0 = 0.28 * rk, holderH = 0.045, runnerH = 0.014, bootTop0 = R.d.skate + 0.05 * rk;
  const thighGeo = g('thigh', () => painted([{ geo: S.limb(R.thighR, R.d.thigh), color: PA }]));
  const shinGeo = g('shin', () => painted([
    { geo: S.limb(R.shinR, R.d.shin), color: J },
    { geo: S.ring(R.shinR * 1.1, R.shinR * 1.1, 0.05 * rk), color: T, at: [0, R.d.shin * 0.45, 0] },
  ]));
  // Origin on the ice under the ankle; x along the skate. The ankle sits over the back third of the blade.
  const skateGeo = kit.geo('sk.skate', () => painted([
    { geo: S.box(0.13 * rk, bootTop0 - holderH, 0.095 * rk, 0.025 * rk), color: DARK, at: [0, (bootTop0 + holderH) / 2, 0] },
    { geo: S.box(bootL0 - 0.1 * rk, 0.07 * rk, 0.09 * rk, 0.03 * rk), color: DARK, at: [0.065 * rk + (bootL0 - 0.1 * rk) / 2 - 0.02 * rk, holderH + 0.035 * rk, 0] },
    { geo: new THREE.BoxGeometry(bootL0 * 0.92, holderH - runnerH, 0.03), color: HOLDER, at: [bootL0 * 0.28, runnerH + (holderH - runnerH) / 2, 0] },
    { geo: new THREE.BoxGeometry(bootL0 * 1.02, runnerH, 0.012), color: STEEL, at: [bootL0 * 0.28, runnerH / 2, 0] },
  ]));
  const thighs: THREE.Mesh[] = [], shins: THREE.Object3D[] = [], skates: THREE.Group[] = [];
  const bootL = bootL0 * (k / rk);
  for (let i = 0; i < 2; i++) {
    const th = mesh(thighGeo, `thigh${i}`);
    th.scale.set(P.thighR / R.thighR, d.thigh / R.d.thigh, P.thighR / R.thighR);
    thighs.push(th);
    const sh = mesh(shinGeo, `shin${i}`);
    sh.scale.set(P.shinR / R.shinR, d.shin / R.d.shin, P.shinR / R.shinR);
    shins.push(sh);
    const sk = new THREE.Group();
    sk.name = `skate${i}`;
    const boot = mesh(skateGeo, `boot${i}`);
    boot.scale.setScalar(k / rk);
    sk.add(boot);
    skates.push(sk);
    root.add(th, sh, sk);
  }

  // Stick: the shaft from the top hand (scaled to reach the blade's heel), and the blade at its heel along the ice.
  const stick0 = R.d.stick;
  const shaft = mesh(kit.geo('sk.shaft', () => painted([{ geo: new THREE.BoxGeometry(0.03, stick0, 0.022), color: STICK, at: [0, stick0 / 2, 0] }])), 'shaft');
  const bladeLen = 0.3, bladeH = 0.075;
  const blade = mesh(kit.geo('sk.blade', () => painted([{ geo: new THREE.BoxGeometry(bladeLen, bladeH, 0.014), color: BLADE, at: [bladeLen / 2 - 0.03, bladeH / 2, 0] }])), 'stickBlade');
  root.add(shaft, blade);

  // Shadows on the ice: one under the body (and, on the single-figure page, one under each skate fading as it lifts).
  const bodyShadow = kit.shadow();
  bodyShadow.name = 'shadow';
  const footShadows = kit.footShadows ? [kit.shadow(), kit.shadow()] : [];
  for (const s of footShadows) s.name = 'footShadow';
  root.add(bodyShadow, ...footShadows);

  const scratch = new THREE.Euler();
  const neckLocal = v3(0.04 * k, d.torso + d.headRadius * 1.25 + 0.07 * k, 0);
  function apply(input: Pose, worldX: number, worldZ: number, facing: number): void {
    const p = right ? mirrorPose(input) : input;
    root.position.set(worldX, 0, worldZ);
    root.rotation.set(0, -facing, 0);

    pelvis.position.set(0, p.hipY, 0);
    pelvis.rotation.set(0, -p.yaw, 0);
    torso.position.set(0, p.hipY, 0);
    const twist = p.twist ?? 0;
    torso.rotation.copy(scratch.set(p.roll, -twist, -p.pitch, 'XZY')); // Rx(roll) * Rz(-pitch) * Ry(-twist), as torsoRotate

    // Head: above the shoulders along the torso, kept more upright than the torso so his eyes are up the ice, turned
    // toward where he looks and tipped down by lookDown (a sprint puts his head down).
    const neck = torsoRotate(neckLocal, p.pitch, p.roll, twist);
    head.position.set(neck.x, p.hipY + neck.y, neck.z);
    head.rotation.set(p.roll * 0.5, -(p.look ?? 0), -(p.pitch * 0.25 + (p.lookDown ?? 0)), 'YXZ');

    // Legs: solve each knee in a frame turned to the skate's heading so the knee bends over the toe.
    let fx = 0, fz = 0;
    for (const i of [0, 1] as const) {
      const leg = p.legs[i];
      const hip = hipJoint(p, i, d);
      const ankleWant = add(leg.foot, v3(0, d.skate, 0));
      const rel = turn(sub(ankleWant, hip), -leg.footYaw);
      const s = solveLeg(v3(0, 0, 0), rel, d.thigh, d.shin);
      const dir = (a: number): Vec3 => v3(Math.sin(a), -Math.cos(a) * Math.cos(s.hipRoll), Math.cos(a) * Math.sin(s.hipRoll));
      const kneeRel = mul(dir(s.hipPitch), d.thigh);
      const ankleRel = add(kneeRel, mul(dir(s.hipPitch - s.kneeAngle), d.shin));
      const knee = add(hip, turn(kneeRel, leg.footYaw)), ankle = add(hip, turn(ankleRel, leg.footYaw));
      aim(thighs[i]!, hip, knee);
      aim(shins[i]!, knee, ankle);
      const sk = skates[i]!;
      sk.position.set(ankle.x, Math.max(0, ankle.y - d.skate), ankle.z);
      sk.rotation.set(0, -leg.footYaw, 0);
      const fs = footShadows[i];
      if (fs) {
        const lift = Math.max(0, ankle.y - d.skate);
        fs.position.set(ankle.x + Math.cos(leg.footYaw) * bootL * 0.25, 0.005, ankle.z + Math.sin(leg.footYaw) * bootL * 0.25);
        fs.scale.set(0.24 * k * (1 + lift * 2), 1, 0.13 * k * (1 + lift * 2));
        fs.rotation.set(0, -leg.footYaw, 0);
        (fs.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - lift * 5);
      }
      fx += ankle.x; fz += ankle.z;
    }
    bodyShadow.position.set((fx / 2) * 0.6, 0.003, (fz / 2) * 0.6);
    bodyShadow.scale.setScalar(Math.max(P.torsoW, d.shoulderWidth) * (footShadows.length ? 1.1 : 1.35));

    // Arms: elbows out to the side and back.
    for (const i of [0, 1] as const) {
      const sh = shoulderJoint(p, i, d);
      const side = i === 0 ? -1 : 1;
      const pole = torsoRotate(v3(-0.45, -0.35, side * 0.8), p.pitch, p.roll);
      const { mid, end } = twoBone(sh, p.arms[i].hand, d.upperArm, d.forearm, pole);
      aim(upper[i]!, sh, mid);
      aim(fore[i]!, mid, end);
      // Glove: along the forearm, centred on the hand.
      aim(gloves[i]!, end, add(end, sub(end, mid)));
    }

    // Stick: through the top hand to the blade's heel. A pose from poseOf says where the heel is (lifted off the ice
    // when he carries the stick one-handed in a sprint); otherwise the shaft runs down at stickAngle to the ice.
    const hand = p.arms[top].hand;
    const grip = Math.min(Math.max(0, p.grip ?? 0), d.stick * 0.5);
    let hx: number, hy: number, hz: number;
    if (p.blade) {
      hx = p.blade.x; hy = Math.max(0, p.blade.y); hz = p.blade.z;
    } else {
      const h = p.stickAngle;
      const sinT = Math.min(1, Math.max(0, hand.y) / (d.stick - grip)), cosT = Math.sqrt(1 - sinT * sinT);
      const below = d.stick - grip;
      hx = hand.x + Math.cos(h) * cosT * below; hy = Math.max(0, hand.y - sinT * below); hz = hand.z + Math.sin(h) * cosT * below;
    }
    _dir.set(hx - hand.x, hy - hand.y, hz - hand.z);
    const reach = _dir.length();
    if (reach > 1e-9) _dir.multiplyScalar(1 / reach); else _dir.set(0, -1, 0);
    shaft.position.set(hand.x - _dir.x * grip, hand.y - _dir.y * grip, hand.z - _dir.z * grip);
    shaft.quaternion.setFromUnitVectors(UP, _dir);
    shaft.scale.set(1, (reach + grip) / stick0, 1);
    blade.position.set(hx, hy, hz);
    // The blade runs on from the heel along the stick's heading, its toe turned a little further out to his stick side.
    blade.rotation.set(0, -(p.stickAngle + (right ? 0.35 : -0.35)), 0);
  }

  function dispose(): void {
    kit.releaseTexture(backMap);
    backMat.dispose();
    if (!sharedKit) {
      for (const s of [bodyShadow, ...footShadows]) { s.geometry.dispose(); (s.material as THREE.Material).dispose(); }
      kit.dispose();
    }
  }

  return { root, apply, dispose };
}

/**
 * A marker for every other skater: a low, puck-like disc in his team colour with a pointed notch along +x (his facing)
 * and his number on top (read from behind him). Flat, so it reads as a token on the ice, not an obstacle.
 */
export function createMarker(color: number, radius: number, number?: number, numberColor = 0xffffff): THREE.Object3D {
  const g = new THREE.Group();
  const h = 0.07;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 28).translate(0, h / 2 + 0.005, 0), new THREE.MeshLambertMaterial({ color }));
  body.name = 'marker';
  // Notch: a flat wedge pointing out of the disc along +x.
  const wedge = new THREE.Shape([new THREE.Vector2(radius * 0.85, -radius * 0.32), new THREE.Vector2(radius * 1.45, 0), new THREE.Vector2(radius * 0.85, radius * 0.32)]);
  const notchGeo = new THREE.ExtrudeGeometry(wedge, { depth: h * 0.8, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0.005, 0);
  const notch = new THREE.Mesh(notchGeo, new THREE.MeshLambertMaterial({ color }));
  notch.name = 'notch';
  g.add(body, notch);
  if (number !== undefined && hasDom()) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.font = `bold ${number >= 10 ? 76 : 92}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = css(numberColor);
    x.fillText(String(number), 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(radius * 1.5, radius * 1.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    // Lying on top of the disc, upright when seen from behind him (text up = his forward, +x).
    label.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    label.position.y = h + 0.008;
    label.name = 'markerNumber';
    g.add(label);
  }
  const shadow = createShadowBlob();
  shadow.scale.setScalar(radius * 1.25);
  g.add(shadow);
  return g;
}
