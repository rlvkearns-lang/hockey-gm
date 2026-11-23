import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerDef } from '@hockey/engine';
import { bodyDims, type BodyDims } from './body';
import { hipJoint, shoulderJoint, solveLeg, torsoRotate, type Motion, type Pose, type Vec3 } from './gait';

/**
 * The jointed skater figure (three.js). It takes a Pose in the body frame of gait.ts (x forward, y up, z to his right,
 * origin on the ice under the pelvis) and places it in the world: engine x is world X, engine y is world Z, up is
 * world Y, so with engine facing f his forward is world (cos f, 0, sin f) and his right is world (-sin f, 0, cos f).
 * That is a turn of -f about world Y (three.js turns +x toward -z for a positive angle).
 *
 * Poses are worked out for a left shot. For a right shot the motion going into the gait is mirrored (handedMotion) and
 * the pose coming out is mirrored back (z, yaws and roll negated, left and right swapped), so he moves the same way
 * but holds the stick on his right with his left hand on top.
 */

export type RigColors = { jersey: number; trim: number; pants: number };
export type SkaterRig = { root: THREE.Group; apply(pose: Pose, worldX: number, worldZ: number, facing: number): void; dispose(): void };

const UP = new THREE.Vector3(0, 1, 0);
const SKIN = 0xd9a483;
const DARK = 0x18191c;
const HOLDER = 0x3a3d42;
const STEEL = 0xdfe5ec;
const STICK = 0x222327;
const BLADE = 0x101012;

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
/** Turn a body-frame vector by heading h about the vertical (x toward +z), as gait.ts does. */
const turn = (v: Vec3, h: number): Vec3 => { const c = Math.cos(h), s = Math.sin(h); return v3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); };

/** The motion his gait should be stepped with: mirrored for a right shot (see the file comment). */
export function handedMotion(def: Pick<PlayerDef, 'shoots'>, m: Motion): Motion {
  return def.shoots === 'R' ? { ...m, lateral: -m.lateral, turnRate: -m.turnRate, facing: -m.facing } : m;
}

/** Mirror a pose across his centre plane (z to -z): left and right swap, so the top hand on the stick is arms[0]. */
export function mirrorPose(p: Pose): Pose {
  const mz = (v: Vec3): Vec3 => v3(v.x, v.y, -v.z);
  const leg = (l: Pose['legs'][number]): Pose['legs'][number] => ({ foot: mz(l.foot), footYaw: -l.footYaw, lifted: l.lifted });
  return {
    hipY: p.hipY, pitch: p.pitch, roll: -p.roll, yaw: -p.yaw, twist: -(p.twist ?? 0), look: -(p.look ?? 0),
    legs: [leg(p.legs[1]), leg(p.legs[0])],
    arms: [{ hand: mz(p.arms[1].hand) }, { hand: mz(p.arms[0].hand) }],
    stickAngle: -p.stickAngle,
  };
}

/**
 * Two-bone solve: from `a` toward `b` with bones l1 and l2, the middle joint bent toward `pole`. Returns the middle
 * joint and the end (which is `b` when it is in reach).
 */
function twoBone(a: Vec3, b: Vec3, l1: number, l2: number, pole: Vec3): { mid: Vec3; end: Vec3 } {
  const d = sub(b, a), raw = len(d);
  const u = raw > 1e-9 ? mul(d, 1 / raw) : v3(0, -1, 0);
  const dist = Math.min(Math.max(raw, Math.abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6);
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = sub(pole, mul(u, dot(pole, u)));
  if (len(p) < 1e-6) p = Math.abs(u.y) < 0.9 ? sub(v3(0, 1, 0), mul(u, u.y)) : sub(v3(1, 0, 0), mul(u, u.x));
  p = mul(p, 1 / len(p));
  return { mid: add(add(a, mul(u, x)), mul(p, h)), end: add(a, mul(u, dist)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Textures drawn on a canvas (only where there is a DOM: the unit tests build the figure without one).

const hasDom = (): boolean => typeof document !== 'undefined';
let blobTexture: THREE.Texture | null = null;

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

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** His number in the trim colour with a thin outline in the pants colour, on a transparent background. */
function numberTexture(n: number, colors: RigColors): THREE.Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = `bold ${n >= 10 ? 84 : 100}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 8;
  g.strokeStyle = css(colors.pants);
  g.strokeText(String(n), 64, 70);
  g.fillStyle = css(colors.trim);
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A shadow blob lying on the ice (radius 1; scale it). */
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
// The figure

/** A capsule of radius r from its origin up along +y to `length` (the far joint), so it can be aimed joint to joint. */
function limbGeometry(r: number, length: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, length, 3, 10).translate(0, length / 2, 0);
}

function aim(o: THREE.Object3D, from: Vec3, to: Vec3): void {
  o.position.set(from.x, from.y, from.z);
  const d = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  if (d.lengthSq() > 1e-12) o.quaternion.setFromUnitVectors(UP, d.normalize());
}

export function createSkaterRig(def: PlayerDef, colors: RigColors): SkaterRig {
  const d: BodyDims = bodyDims(def.heightCm, def.weightKg);
  const right = def.shoots === 'R';
  const top = right ? 0 : 1; // the hand on the butt of the stick
  const k = def.heightCm / 185;
  // Girth relative to an average build, exaggerated a little so build reads at a glance.
  const girth = d.bulk / (0.15 * Math.max(0.6, def.heightCm / 100) / 1.85);
  const build = girth * girth;

  const mats: THREE.Material[] = [];
  const lambert = (color: number): THREE.MeshLambertMaterial => { const m = new THREE.MeshLambertMaterial({ color }); mats.push(m); return m; };
  const jersey = lambert(colors.jersey), trim = lambert(colors.trim), pants = lambert(colors.pants);
  const skin = lambert(SKIN), dark = lambert(DARK), holder = lambert(HOLDER), stickMat = lambert(STICK), bladeMat = lambert(BLADE);
  const steel = new THREE.MeshLambertMaterial({ color: STEEL, emissive: 0x2a2f36 }); mats.push(steel);
  const visorMat = new THREE.MeshLambertMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.55 }); mats.push(visorMat);

  const root = new THREE.Group();
  root.name = `skater-${def.number}`;
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name = ''): THREE.Mesh => { const m = new THREE.Mesh(geo, mat); m.name = name; return m; };

  // Pelvis and pants (turn with the pelvis yaw).
  const thighR = 0.075 * k * (0.7 + 0.3 * build);
  const shinR = 0.052 * k * (0.75 + 0.25 * build);
  const pelvis = new THREE.Group();
  const pantsW = d.hipWidth + 2 * thighR * 1.25, pantsD = 2 * d.bulk * 0.92, pantsH = 0.27 * k;
  const pantsBox = mesh(new RoundedBoxGeometry(pantsD, pantsH, pantsW, 2, 0.06 * k), pants, 'pants');
  pantsBox.position.y = -0.05 * k;
  pelvis.add(pantsBox);
  root.add(pelvis);

  // Torso (pitch then roll about the pelvis centre; no yaw), with the trim bands, collar and number.
  const torso = new THREE.Group();
  const torsoW = Math.max(d.shoulderWidth * 0.86, pantsW * 1.02), torsoD = 2 * d.bulk;
  const torsoBottom = -0.04 * k, torsoTop = d.torso + 0.03 * k, torsoH = torsoTop - torsoBottom;
  const chest = mesh(new RoundedBoxGeometry(torsoD, torsoH, torsoW, 2, 0.07 * k), jersey, 'jersey');
  chest.position.y = (torsoTop + torsoBottom) / 2;
  torso.add(chest);
  const band = (y: number, h: number, mat: THREE.Material): void => {
    const b = mesh(new RoundedBoxGeometry(torsoD * 1.03, h, torsoW * 1.03, 1, 0.03 * k), mat);
    b.position.y = y;
    torso.add(b);
  };
  band(torsoBottom + 0.1 * k, 0.05 * k, trim);
  band(torsoBottom + 0.18 * k, 0.025 * k, trim);
  const collar = mesh(new THREE.CylinderGeometry(0.075 * k, 0.09 * k, 0.05 * k, 12), trim, 'collar');
  collar.position.y = torsoTop;
  torso.add(collar);
  for (const s of [-1, 1]) {
    // Shoulder pads under the jersey: a low, flattened cap over each shoulder joint.
    const pad = mesh(new THREE.SphereGeometry(0.085 * k * (0.75 + 0.25 * build), 12, 8), jersey);
    pad.position.set(-0.01 * k, d.torso - 0.01 * k, s * (d.shoulderWidth / 2 - 0.02 * k));
    pad.scale.set(1.15, 0.6, 1);
    torso.add(pad);
  }
  const numMap = numberTexture(def.number, colors);
  const numMat = numMap
    ? new THREE.MeshBasicMaterial({ map: numMap, transparent: true, depthWrite: false, toneMapped: false })
    : new THREE.MeshBasicMaterial({ color: colors.trim, transparent: true, opacity: 0 });
  mats.push(numMat);
  const numSize = torsoW * 0.62;
  const number = mesh(new THREE.PlaneGeometry(numSize, numSize), numMat, 'number');
  number.position.set(-torsoD / 2 - 0.006, d.torso * 0.5, 0);
  number.rotation.y = -Math.PI / 2; // faces -x (his back), reading left to right for someone behind him
  torso.add(number);
  root.add(torso);

  // Head: skin, helmet cap and a visor (the visor marks his front).
  const head = new THREE.Group();
  const hr = d.headRadius;
  const face = mesh(new THREE.SphereGeometry(hr * 0.92, 14, 10), skin, 'head');
  face.scale.set(1, 1.08, 0.92);
  head.add(face);
  const helmet = mesh(new THREE.SphereGeometry(hr * 1.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), jersey, 'helmet');
  helmet.position.set(-0.01 * k, 0.015 * k, 0);
  head.add(helmet);
  const visor = mesh(new THREE.SphereGeometry(hr * 1.07, 12, 6, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.42, Math.PI * 0.16), visorMat, 'face');
  visor.rotation.y = Math.PI; // SphereGeometry's phi = 0 is -x: turn the visor's middle round to face +x

  head.add(visor);
  root.add(head);

  // Arms: upper arm and forearm in the jersey (a trim band at the elbow), gloves.
  const upperR = 0.055 * k * (0.75 + 0.25 * build), foreR = 0.047 * k * (0.75 + 0.25 * build);
  const upper: THREE.Mesh[] = [], fore: THREE.Object3D[] = [], gloves: THREE.Object3D[] = [];
  for (let i = 0; i < 2; i++) {
    upper.push(mesh(limbGeometry(upperR, d.upperArm), jersey, `upperArm${i}`));
    const f = new THREE.Group();
    f.add(mesh(limbGeometry(foreR, d.forearm - 0.05 * k), jersey));
    const cuff = mesh(new THREE.CylinderGeometry(foreR * 1.12, foreR * 1.12, 0.06 * k, 10), trim);
    cuff.position.y = 0.09 * k;
    f.add(cuff);
    fore.push(f);
    const glove = new THREE.Group();
    const gb = mesh(new RoundedBoxGeometry(0.1 * k, 0.15 * k, 0.1 * k, 1, 0.025 * k), dark, `glove${i}`);
    glove.add(gb);
    const gcuff = mesh(new THREE.CylinderGeometry(0.065 * k, 0.065 * k, 0.07 * k, 10), jersey);
    gcuff.position.y = -0.09 * k;
    glove.add(gcuff);
    gloves.push(glove);
    root.add(upper[i]!, f, glove);
  }

  // Legs: thighs in the pants, shins in the socks (trim stripe), skates with boot, holder and steel.
  const thighs: THREE.Mesh[] = [], shins: THREE.Object3D[] = [], skates: THREE.Group[] = [];
  const bootL = 0.28 * k, holderH = 0.045, runnerH = 0.014;
  for (let i = 0; i < 2; i++) {
    thighs.push(mesh(limbGeometry(thighR, d.thigh), pants, `thigh${i}`));
    const sh = new THREE.Group();
    sh.add(mesh(limbGeometry(shinR, d.shin), jersey));
    const stripe = mesh(new THREE.CylinderGeometry(shinR * 1.1, shinR * 1.1, 0.05 * k, 10), trim);
    stripe.position.y = d.shin * 0.45;
    sh.add(stripe);
    shins.push(sh);
    const sk = new THREE.Group();
    sk.name = `skate${i}`;
    // Origin on the ice under the ankle; x along the skate. The ankle sits over the back third of the blade.
    const bootTop = d.skate + 0.05 * k;
    const heel = mesh(new RoundedBoxGeometry(0.13 * k, bootTop - holderH, 0.095 * k, 1, 0.025 * k), dark, `boot${i}`);
    heel.position.set(0, (bootTop + holderH) / 2, 0);
    const toe = mesh(new RoundedBoxGeometry(bootL - 0.1 * k, 0.07 * k, 0.09 * k, 1, 0.03 * k), dark);
    toe.position.set(0.065 * k + (bootL - 0.1 * k) / 2 - 0.02 * k, holderH + 0.035 * k, 0);
    const hold = mesh(new THREE.BoxGeometry(bootL * 0.92, holderH - runnerH, 0.03), holder);
    hold.position.set(bootL * 0.28, runnerH + (holderH - runnerH) / 2, 0);
    const runner = mesh(new THREE.BoxGeometry(bootL * 1.02, runnerH, 0.012), steel, `runner${i}`);
    runner.position.set(bootL * 0.28, runnerH / 2, 0);
    sk.add(heel, toe, hold, runner);
    skates.push(sk);
    root.add(thighs[i]!, sh, sk);
  }

  // Stick: the shaft from the top hand, and the blade at its heel along the ice.
  const shaft = mesh(new THREE.BoxGeometry(0.03, d.stick, 0.022).translate(0, d.stick / 2, 0), stickMat, 'shaft');
  const bladeLen = 0.3, bladeH = 0.075;
  const blade = mesh(new THREE.BoxGeometry(bladeLen, bladeH, 0.014).translate(bladeLen / 2 - 0.03, bladeH / 2, 0), bladeMat, 'stickBlade');
  root.add(shaft, blade);

  // Shadows on the ice: one under the body, one under each skate (fading as the skate lifts).
  const bodyShadow = createShadowBlob();
  bodyShadow.name = 'shadow';
  const footShadows = [createShadowBlob(), createShadowBlob()];
  root.add(bodyShadow, ...footShadows);

  const scratch = new THREE.Euler();
  function apply(input: Pose, worldX: number, worldZ: number, facing: number): void {
    const p = right ? mirrorPose(input) : input;
    root.position.set(worldX, 0, worldZ);
    root.rotation.set(0, -facing, 0);

    pelvis.position.set(0, p.hipY, 0);
    pelvis.rotation.set(0, -p.yaw, 0);
    torso.position.set(0, p.hipY, 0);
    const twist = p.twist ?? 0;
    torso.rotation.copy(scratch.set(p.roll, -twist, -p.pitch, 'XZY')); // Rx(roll) * Rz(-pitch) * Ry(-twist), as torsoRotate

    // Head: above the shoulders along the torso, kept more upright than the torso so he looks ahead.
    const neck = add(v3(0, p.hipY, 0), torsoRotate(v3(0.04 * k, d.torso + hr * 1.25 + 0.04 * k, 0), p.pitch, p.roll, twist));
    head.position.set(neck.x, neck.y, neck.z);
    // Turned toward where he looks, kept more upright than the torso so his eyes are up the ice.
    head.rotation.set(p.roll * 0.5, -(p.look ?? 0), -p.pitch * 0.25, 'YXZ');

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
      const lift = Math.max(0, ankle.y - d.skate);
      const fs = footShadows[i]!;
      fs.position.set(ankle.x + Math.cos(leg.footYaw) * bootL * 0.25, 0.005, ankle.z + Math.sin(leg.footYaw) * bootL * 0.25);
      fs.scale.set(0.24 * k * (1 + lift * 2), 1, 0.13 * k * (1 + lift * 2));
      fs.rotation.set(0, -leg.footYaw, 0);
      (fs.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - lift * 5);
      fx += ankle.x; fz += ankle.z;
    }
    bodyShadow.position.set((fx / 2) * 0.6, 0.003, (fz / 2) * 0.6);
    bodyShadow.scale.setScalar(Math.max(torsoW, d.shoulderWidth) * 1.1);

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

    // Stick: butt in the top hand, running down at stickAngle so its heel reaches the ice.
    const hand = p.arms[top].hand;
    const h = p.stickAngle;
    const sinT = Math.min(1, Math.max(0, hand.y) / d.stick), cosT = Math.sqrt(1 - sinT * sinT);
    const dirS = v3(Math.cos(h) * cosT, -sinT, Math.sin(h) * cosT);
    aim(shaft, hand, add(hand, dirS));
    const heel = add(hand, mul(dirS, d.stick));
    blade.position.set(heel.x, Math.max(0, heel.y), heel.z);
    // The blade runs on from the heel along the stick's heading, its toe turned a little further out to his stick side.
    blade.rotation.set(0, -(h + (right ? 0.35 : -0.35)), 0);
  }

  function dispose(): void {
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const m of mats) { const map = (m as THREE.MeshBasicMaterial).map; if (map && map !== blobTexture) map.dispose(); m.dispose(); }
    for (const s of [bodyShadow, ...footShadows]) (s.material as THREE.Material).dispose();
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
