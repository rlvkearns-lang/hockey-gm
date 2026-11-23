import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerDef } from '@hockey/engine';
import { bodyDims, type BodyDims } from './body';
import { torsoRotate, type Vec3 } from './gait';
import { twoBone, type GoalieFigurePose } from './goalie-pose';
import { createShadowBlob, type RigColors } from './rig';

/**
 * The jointed goalie figure (three.js), driven by a GoalieFigurePose (goalie-pose.ts) in the body frame (x forward,
 * y up, z to his right, origin on the ice under the pelvis), placed in the world as the skater rig is: engine x is
 * world X, engine y is world Z, a turn of -facing about world Y.
 *
 * He wears a mask with a cage, a chest protector under the jersey with big shoulder caps, big leg pads (white with
 * bands in the team colour), a catching glove and a blocker, and holds a goalie stick with a wide paddle. The glove
 * goes on the hand the pose says he catches with. Geometries and materials are made once per figure and shared by
 * his two sides; apply() keeps three.js scratch objects and allocates only the few small joint vectors twoBone and
 * torsoRotate return, as the skater rig does.
 */

export type GoalieRig = { root: THREE.Group; apply(pose: GoalieFigurePose, worldX: number, worldZ: number, facing: number): void; dispose(): void };

const PAD = 0xefefea;
const DARK = 0x18191c;
const STEEL = 0xdfe5ec;
const STICK = 0x222327;
const CAGE = 0xc9ced4;

const hasDom = (): boolean => typeof document !== 'undefined';
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** His number in the trim colour outlined in the pants colour (copied from rig.ts, where it is private). */
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

/** A capsule of radius r from its origin up along +y to `length`, so it can be aimed joint to joint. */
const limbGeometry = (r: number, length: number): THREE.BufferGeometry => new THREE.CapsuleGeometry(r, length, 3, 10).translate(0, length / 2, 0);

// Scratch values for apply() (no allocation per frame).
const UP = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4();

function aim(o: THREE.Object3D, from: Vec3, to: Vec3): void {
  o.position.set(from.x, from.y, from.z);
  _d.set(to.x - from.x, to.y - from.y, to.z - from.z);
  if (_d.lengthSq() > 1e-12) o.quaternion.setFromUnitVectors(UP, _d.normalize());
}

/**
 * Place `o` at p with its local +y along `y` and its local +x as near `xHint` as is square to it (left in _x, _y, _z).
 */
function orient(o: THREE.Object3D, p: Vec3, y: Vec3, xHint: Vec3): void {
  _y.set(y.x, y.y, y.z);
  if (_y.lengthSq() < 1e-12) _y.set(0, 1, 0);
  _y.normalize();
  _x.set(xHint.x, xHint.y, xHint.z).addScaledVector(_y, -_x.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  o.quaternion.setFromRotationMatrix(_m);
  o.position.set(p.x, p.y, p.z);
}

/** After orient(): lift `o` so a box (local centre c, half sizes h) in it stays above the ice. */
function keepAboveIce(o: THREE.Object3D, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
  const centreY = o.position.y + _x.y * cx + _y.y * cy + _z.y * cz;
  const low = centreY - (Math.abs(_x.y) * hx + Math.abs(_y.y) * hy + Math.abs(_z.y) * hz);
  if (low < 0.003) o.position.y += 0.003 - low;
}

export function createGoalieRig(def: PlayerDef, colors: RigColors): GoalieRig {
  const d: BodyDims = bodyDims(def.heightCm, def.weightKg);
  const k = def.heightCm / 188;

  const mats: THREE.Material[] = [];
  const lambert = (color: number): THREE.MeshLambertMaterial => { const m = new THREE.MeshLambertMaterial({ color }); mats.push(m); return m; };
  const jersey = lambert(colors.jersey), trim = lambert(colors.trim), pants = lambert(colors.pants);
  const pad = lambert(PAD), dark = lambert(DARK), stickMat = lambert(STICK), cage = lambert(CAGE);
  const steel = new THREE.MeshLambertMaterial({ color: STEEL, emissive: 0x2a2f36 }); mats.push(steel);
  const geos: THREE.BufferGeometry[] = [];
  const geo = <G extends THREE.BufferGeometry>(g: G): G => { geos.push(g); return g; };

  const root = new THREE.Group();
  root.name = `goalie-${def.number}`;
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, name = ''): THREE.Mesh => { const m = new THREE.Mesh(g, mat); m.name = name; return m; };

  // Pelvis: big goalie pants.
  const thighR = 0.095 * k;
  const pantsW = 2 * (d.hipWidth / 2) * 1.1 + 2 * thighR * 1.3, pantsD = 2 * d.bulk * 1.15, pantsH = 0.3 * k;
  const pelvis = new THREE.Group();
  const pantsBox = mesh(geo(new RoundedBoxGeometry(pantsD, pantsH, pantsW, 2, 0.07 * k)), pants, 'pants');
  pantsBox.position.y = -0.05 * k;
  pelvis.add(pantsBox);
  root.add(pelvis);

  // Torso: a chest protector under the jersey (deep and wide), big shoulder caps, a trim band and his number on the back.
  const torso = new THREE.Group();
  const torsoW = Math.max(d.shoulderWidth * 1.08, pantsW * 1.05), torsoD = 2 * d.bulk * 1.3;
  const torsoBottom = -0.04 * k, torsoTop = d.torso + 0.04 * k, torsoH = torsoTop - torsoBottom;
  const chest = mesh(geo(new RoundedBoxGeometry(torsoD, torsoH, torsoW, 2, 0.08 * k)), jersey, 'jersey');
  chest.position.y = (torsoTop + torsoBottom) / 2;
  torso.add(chest);
  const band = mesh(geo(new RoundedBoxGeometry(torsoD * 1.03, 0.05 * k, torsoW * 1.03, 1, 0.03 * k)), trim);
  band.position.y = torsoBottom + 0.07 * k;
  torso.add(band);
  const capGeo = geo(new THREE.SphereGeometry(0.12 * k, 12, 8));
  for (const s of [-1, 1]) {
    const cap = mesh(capGeo, jersey);
    cap.position.set(0, d.torso - 0.02 * k, s * (d.shoulderWidth / 2 + 0.01 * k));
    cap.scale.set(1.1, 0.75, 1);
    torso.add(cap);
  }
  const numMap = numberTexture(def.number, colors);
  const numMat = numMap
    ? new THREE.MeshBasicMaterial({ map: numMap, transparent: true, depthWrite: false, toneMapped: false })
    : new THREE.MeshBasicMaterial({ color: colors.trim, transparent: true, opacity: 0 });
  mats.push(numMat);
  const numSize = torsoW * 0.55;
  const number = mesh(geo(new THREE.PlaneGeometry(numSize, numSize)), numMat, 'number');
  number.position.set(-torsoD / 2 - 0.006, d.torso * 0.5, 0);
  number.rotation.y = -Math.PI / 2;
  torso.add(number);
  root.add(torso);

  // Head: a mask (shell in the team colour, a pale cage over the face, a jutting chin) and a throat guard.
  const head = new THREE.Group();
  const hr = d.headRadius;
  const shell = mesh(geo(new THREE.SphereGeometry(hr * 1.08, 16, 12)), jersey, 'mask');
  shell.scale.set(1.08, 1.14, 0.96);
  head.add(shell);
  const cageMesh = mesh(geo(new THREE.SphereGeometry(hr * 1.1, 14, 8, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.32, Math.PI * 0.4)), cage, 'face');
  cageMesh.rotation.y = Math.PI; // phi = 0 is -x: turn the cage's middle round to face +x
  cageMesh.scale.set(1.12, 1.1, 0.98);
  head.add(cageMesh);
  const chin = mesh(geo(new THREE.SphereGeometry(hr * 0.55, 10, 8)), jersey);
  chin.position.set(hr * 0.55, -hr * 0.7, 0);
  chin.scale.set(1, 0.8, 1.1);
  head.add(chin);
  const throat = mesh(geo(new THREE.CylinderGeometry(hr * 0.5, hr * 0.35, hr * 0.6, 10)), trim);
  throat.position.set(hr * 0.45, -hr * 1.2, 0);
  throat.rotation.z = 0.4;
  head.add(throat);
  root.add(head);

  // Arms: bulky sleeves over arm pads.
  const upperGeo = geo(limbGeometry(0.075 * k, d.upperArm)), foreGeo = geo(limbGeometry(0.068 * k, d.forearm - 0.08 * k));
  const upper: THREE.Mesh[] = [], fore: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    upper.push(mesh(upperGeo, jersey, `upperArm${i}`));
    fore.push(mesh(foreGeo, jersey, `forearm${i}`));
    root.add(upper[i]!, fore[i]!);
  }

  // Catching glove: local +y along the forearm (fingers up), +x the way the pocket faces.
  const glove = new THREE.Group();
  glove.name = 'catchGlove';
  const gBody = mesh(geo(new RoundedBoxGeometry(0.11 * k, 0.3 * k, 0.25 * k, 2, 0.05 * k)), pad);
  gBody.position.y = 0.1 * k;
  const gPocket = mesh(geo(new RoundedBoxGeometry(0.03 * k, 0.17 * k, 0.15 * k, 1, 0.012 * k)), dark);
  gPocket.position.set(0.05 * k, 0.14 * k, 0.01 * k);
  const gThumb = mesh(geo(new RoundedBoxGeometry(0.09 * k, 0.2 * k, 0.07 * k, 1, 0.03 * k)), jersey);
  gThumb.position.set(0, 0.06 * k, 0.13 * k);
  const cuffGeo = geo(new THREE.CylinderGeometry(0.08 * k, 0.08 * k, 0.1 * k, 12));
  const gCuff = mesh(cuffGeo, jersey);
  gCuff.position.y = -0.06 * k;
  glove.add(gBody, gPocket, gThumb, gCuff);
  root.add(glove);

  // Blocker: a board on the back of the stick hand, facing out (+x), with a coloured border.
  const blocker = new THREE.Group();
  blocker.name = 'blocker';
  const bBoard = mesh(geo(new RoundedBoxGeometry(0.04 * k, 0.37 * k, 0.22 * k, 1, 0.015 * k)), pad);
  bBoard.position.set(0.07 * k, 0.06 * k, 0);
  const bStripe = mesh(geo(new RoundedBoxGeometry(0.042 * k, 0.06 * k, 0.225 * k, 1, 0.012 * k)), jersey);
  bStripe.position.set(0.072 * k, 0.17 * k, 0);
  const bHand = mesh(geo(new RoundedBoxGeometry(0.1 * k, 0.13 * k, 0.1 * k, 1, 0.03 * k)), jersey);
  const bCuff = mesh(cuffGeo, jersey);
  bCuff.position.y = -0.08 * k;
  blocker.add(bBoard, bStripe, bHand, bCuff);
  root.add(blocker);

  // Legs: thighs in the pants; the shin is inside the leg pad (local +y up the shin from the ankle, +x its face).
  const thighGeo = geo(limbGeometry(thighR, d.thigh));
  const padT = 0.12 * k, padW = 0.28 * k, padBottom = -0.1 * k, padTop = d.shin + 0.2 * k, padL = padTop - padBottom;
  const padX = 0.03 * k;
  const padGeo = geo(new RoundedBoxGeometry(padT, padL, padW, 2, 0.04 * k));
  const padBandGeo = geo(new RoundedBoxGeometry(padT * 1.06, 0.06 * k, padW * 1.04, 1, 0.02 * k));
  const kneeRollGeo = geo(new RoundedBoxGeometry(padT * 1.12, 0.1 * k, padW * 0.7, 1, 0.035 * k));
  const bootL = 0.27 * k, bootH = 0.13 * k, holderH = 0.045, runnerH = 0.014;
  const bootGeo = geo(new RoundedBoxGeometry(bootL, bootH, 0.11 * k, 1, 0.03 * k));
  const holderGeo = geo(new THREE.BoxGeometry(bootL * 0.95, holderH - runnerH, 0.03));
  const runnerGeo = geo(new THREE.BoxGeometry(bootL * 1.05, runnerH, 0.012));
  const thighs: THREE.Mesh[] = [], pads: THREE.Group[] = [], skates: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    thighs.push(mesh(thighGeo, pants, `thigh${i}`));
    const pg = new THREE.Group();
    pg.name = `pad${i}`;
    const body = mesh(padGeo, pad);
    body.position.set(padX, padBottom + padL / 2, 0);
    pg.add(body);
    for (const y of [0.12, 0.32]) {
      const b = mesh(padBandGeo, jersey);
      b.position.set(padX, padBottom + y * padL, 0);
      pg.add(b);
    }
    const roll = mesh(kneeRollGeo, jersey);
    roll.position.set(padX + 0.01 * k, d.shin + 0.02 * k, 0);
    pg.add(roll);
    pads.push(pg);
    const sk = new THREE.Group();
    sk.name = `skate${i}`;
    const boot = mesh(bootGeo, dark, `boot${i}`);
    boot.position.set(bootL * 0.2, holderH + bootH / 2, 0);
    const hold = mesh(holderGeo, dark);
    hold.position.set(bootL * 0.2, runnerH + (holderH - runnerH) / 2, 0);
    const runner = mesh(runnerGeo, steel);
    runner.position.set(bootL * 0.2, runnerH / 2, 0);
    sk.add(boot, hold, runner);
    skates.push(sk);
    root.add(thighs[i]!, pg, sk);
  }

  // Stick: a wide paddle up from the heel (local +y up the stick, +z across the paddle toward the blade's toe), the
  // shaft above it, and the blade along the ice from the heel.
  const paddleL = 0.68 * k, paddleW = 0.1, shaftL = 0.5 * k, bladeL = 0.4, bladeH = 0.09;
  const stick = new THREE.Group();
  stick.name = 'stick';
  const paddle = mesh(geo(new THREE.BoxGeometry(0.026, paddleL, paddleW)), stickMat, 'paddle');
  paddle.position.set(0, paddleL / 2 + 0.015, paddleW / 2 - 0.02);
  const shaft = mesh(geo(new THREE.BoxGeometry(0.032, shaftL, 0.026)), stickMat, 'shaft');
  shaft.position.set(0, paddleL + shaftL / 2, 0);
  stick.add(paddle, shaft);
  const blade = mesh(geo(new THREE.BoxGeometry(bladeL, bladeH, 0.02).translate(bladeL / 2 - 0.02, bladeH / 2, 0)), stickMat, 'stickBlade');
  root.add(stick, blade);

  const shadow = createShadowBlob();
  shadow.name = 'shadow';
  root.add(shadow);

  const scratch = new THREE.Euler();
  const hipC = { x: 0, y: 0, z: 0 }, headLocal = { x: 0.03 * k, y: d.torso + hr * 1.25 + 0.05 * k, z: 0 };
  const poleLocal = [{ x: -0.25, y: -0.6, z: -0.8 }, { x: -0.25, y: -0.6, z: 0.8 }];
  const gloveUp = { x: 0, y: 0, z: 0 }, normal = { x: 0, y: 0, z: 0 }, upV = { x: 0, y: 1, z: 0 };

  function apply(p: GoalieFigurePose, worldX: number, worldZ: number, facing: number): void {
    root.position.set(worldX, 0, worldZ);
    root.rotation.set(0, -facing, 0);

    pelvis.position.set(0, p.hipY, 0);
    pelvis.rotation.set(0, 0, -p.pitch * 0.3);
    torso.position.set(0, p.hipY, 0);
    torso.rotation.copy(scratch.set(p.roll, 0, -p.pitch, 'XZY')); // Rx(roll) * Rz(-pitch), as torsoRotate

    hipC.y = p.hipY;
    const neck = torsoRotate(headLocal, p.pitch, p.roll);
    head.position.set(neck.x, p.hipY + neck.y, neck.z);
    head.rotation.set(p.roll * 0.5, 0, -p.look, 'YXZ');

    let sx = 0, sz = 0;
    for (const i of [0, 1] as const) {
      const l = p.legs[i];
      aim(thighs[i]!, l.hip, l.knee);
      const pg = pads[i]!;
      normal.x = l.knee.x - l.ankle.x; normal.y = l.knee.y - l.ankle.y; normal.z = l.knee.z - l.ankle.z;
      orient(pg, l.ankle, normal, l.padFace);
      keepAboveIce(pg, padX, padBottom + padL / 2, 0, padT / 2 * 1.12, padL / 2, padW / 2 * 1.04);
      const sk = skates[i]!;
      orient(sk, l.foot, l.up, l.toe);
      keepAboveIce(sk, bootL * 0.2, (holderH + bootH) / 2, 0, bootL * 0.55, (holderH + bootH) / 2, 0.055 * k);
      sx += l.foot.x; sz += l.foot.z;
    }
    shadow.position.set(sx * 0.3, 0.003, sz * 0.3);
    shadow.scale.set(0.75 * k + Math.abs(p.legs[1].foot.z - p.legs[0].foot.z) * 0.3, 1, 0.75 * k + Math.abs(p.legs[1].foot.z - p.legs[0].foot.z) * 0.45);

    // Arms: the glove on the catching side, the blocker (and stick) on the other.
    const gi = p.catches === 'L' ? 0 : 1;
    for (const i of [0, 1] as const) {
      const sh = p.shoulders[i];
      const hand = i === gi ? p.glove : p.blocker;
      const pole = torsoRotate(poleLocal[i]!, p.pitch, p.roll);
      const { mid, end } = twoBone(sh, hand, d.upperArm, d.forearm, pole);
      aim(upper[i]!, sh, mid);
      aim(fore[i]!, mid, end);
      gloveUp.x = end.x - mid.x; gloveUp.y = end.y - mid.y; gloveUp.z = end.z - mid.z;
      if (i === gi) {
        // Fingers up (the forearm's way, tipped toward the sky), square to the pocket, which faces the pose's way.
        const f = p.gloveFace;
        gloveUp.y += 1.5 * Math.hypot(gloveUp.x, gloveUp.y, gloveUp.z);
        const along = gloveUp.x * f.x + gloveUp.y * f.y + gloveUp.z * f.z;
        gloveUp.x -= along * f.x; gloveUp.y -= along * f.y; gloveUp.z -= along * f.z;
        orient(glove, end, gloveUp, f); keepAboveIce(glove, 0, 0.1 * k, 0, 0.055 * k, 0.15 * k, 0.2 * k); }
      else { orient(blocker, end, gloveUp, p.blockerFace); keepAboveIce(blocker, 0.07 * k, 0.06 * k, 0, 0.02 * k, 0.185 * k, 0.11 * k); }
    }

    // Stick: from the heel up through the blocker hand; the paddle and blade lie in one plane.
    const h = p.blade.heel, b = p.blade.dir;
    gloveUp.x = p.blocker.x - h.x; gloveUp.y = p.blocker.y - h.y; gloveUp.z = p.blocker.z - h.z;
    // Normal to the stick's face: up the stick crossed with the blade.
    normal.x = gloveUp.y * b.z - gloveUp.z * b.y; normal.y = gloveUp.z * b.x - gloveUp.x * b.z; normal.z = gloveUp.x * b.y - gloveUp.y * b.x;
    orient(stick, h, gloveUp, normal);
    keepAboveIce(stick, 0, paddleL / 2 + 0.015, paddleW / 2 - 0.02, 0.013, paddleL / 2, paddleW / 2);
    upV.y = 1;
    orient(blade, h, upV, b);
  }

  function dispose(): void {
    for (const g of geos) g.dispose();
    shadow.geometry.dispose();
    for (const m of mats) { const map = (m as THREE.MeshBasicMaterial).map; if (map) map.dispose(); m.dispose(); }
    (shadow.material as THREE.Material).dispose();
  }

  return { root, apply, dispose };
}
