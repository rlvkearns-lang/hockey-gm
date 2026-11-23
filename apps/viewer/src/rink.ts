import * as THREE from 'three';
import { FACEOFF_DOTS, RINK } from '@hockey/engine';

/**
 * The rink to the engine's RINK dimensions: ice, lines, circles, dots, creases, nets and boards with a kickplate.
 * Engine x is world X, engine y is world Z, up is world Y; everything is drawn from engine (x, y) coordinates.
 */

const ICE = 0xd6e2ea; // not pure white, so white trim and the boards stand out
const RED = 0xc8202f;
const BLUE = 0x1f4fb4;
const CREASE = 0x8fc3ee;
const BOARD = 0xf7f7f5;
const KICK = 0xe9c53a;
const CAP = 0x2b3442;
const FLOOR = 0x2a2f38;
/** Circle radius of the faceoff circles and the centre circle (15 ft). */
const CIRCLE_R = 4.57;
const BOARD_H = 1.07;
const KICK_H = 0.25;

/** Half-width of the ice at engine x (the corner arcs narrow it near the ends). */
export function iceHalfWidthAt(x: number): number {
  const R = RINK.cornerRadius, cx = RINK.halfLength - R, cy = RINK.halfWidth - R;
  const ax = Math.abs(x);
  if (ax <= cx) return RINK.halfWidth;
  return cy + Math.sqrt(Math.max(0, R * R - (ax - cx) ** 2));
}

/** Points round the rink outline (engine x, y), counter-clockwise, `inset` metres inside the boards. */
function outline(inset: number, perCorner = 24): THREE.Vector2[] {
  const R = RINK.cornerRadius - inset, cx = RINK.halfLength - RINK.cornerRadius, cy = RINK.halfWidth - RINK.cornerRadius;
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [[cx, cy, 0], [-cx, cy, Math.PI / 2], [-cx, -cy, Math.PI], [cx, -cy, (3 * Math.PI) / 2]];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2);
      pts.push(new THREE.Vector2(ox + R * Math.cos(a), oy + R * Math.sin(a)));
    }
  }
  return pts;
}

/** A flat shape (given in engine x, y) lying on the ice at height y. */
function flat(shape: THREE.Shape, y: number, color: number, segments = 48, opts: { opacity?: number } = {}): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shape, segments);
  // ShapeGeometry is in the xy plane; map (x, y, 0) to world (x, height, y): rotate +90 degrees about X.
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    transparent: opts.opacity !== undefined, opacity: opts.opacity ?? 1, depthWrite: opts.opacity === undefined,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

const rect = (x0: number, y0: number, x1: number, y1: number): THREE.Shape =>
  new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);

function ring(cx: number, cy: number, r: number, w: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r + w / 2, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(cx, cy, r - w / 2, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

function disc(cx: number, cy: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

/** A vertical wall following a closed outline (engine x, y) from height y0 to y1, facing into the rink. */
function wall(pts: THREE.Vector2[], y0: number, y1: number, color: number): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  for (const p of pts) pos.push(p.x, y0, p.y, p.x, y1, p.y);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

/** A flat band between two outlines (same number of points) at height y. */
function band(inner: THREE.Vector2[], outer: THREE.Vector2[], y: number, color: number): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < inner.length; i++) pos.push(inner[i]!.x, y, inner[i]!.y, outer[i]!.x, y, outer[i]!.y);
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

/** A net at end `end` (+1: the +x end): red frame, white netting, open toward centre ice. */
function net(end: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: RED });
  const mesh = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const x0 = end * RINK.goalLineX, back = end * (RINK.goalLineX + RINK.netDepth), w = RINK.netHalfWidth, h = RINK.netHeight;
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.03): void => {
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), red);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(m);
  };
  // Posts and crossbar.
  tube(new THREE.Vector3(x0, 0, -w), new THREE.Vector3(x0, h, -w));
  tube(new THREE.Vector3(x0, 0, w), new THREE.Vector3(x0, h, w));
  tube(new THREE.Vector3(x0, h, -w), new THREE.Vector3(x0, h, w));
  // Base frame: along the ice from each post back round the rear.
  const bx = end * (RINK.goalLineX + RINK.netDepth * 0.6);
  const curve = [new THREE.Vector3(x0, 0.02, -w), new THREE.Vector3(bx, 0.02, -w - 0.25), new THREE.Vector3(back, 0.02, 0), new THREE.Vector3(bx, 0.02, w + 0.25), new THREE.Vector3(x0, 0.02, w)];
  for (let i = 0; i < curve.length - 1; i++) tube(curve[i]!, curve[i + 1]!, 0.025);
  // Netting: top, two sides and the back, as a simple shell from the crossbar to the base.
  const pts: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => { pts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()); };
  const topBack = new THREE.Vector3(end * (RINK.goalLineX + 0.35), h * 0.9, 0);
  const tl = new THREE.Vector3(x0, h, -w), tr = new THREE.Vector3(x0, h, w);
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!, b = curve[i + 1]!;
    const ta = i < 2 ? tl.clone().lerp(topBack, i / 2) : topBack.clone().lerp(tr, (i - 2) / 2);
    const tb = i + 1 < 2 ? tl.clone().lerp(topBack, (i + 1) / 2) : topBack.clone().lerp(tr, (i - 1) / 2);
    quad(a, b, tb, ta);
  }
  quad(tl, tr, topBack, topBack);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, mesh));
  return g;
}

export function buildRink(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'rink';

  // Arena floor around the rink, then the ice.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 120).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: FLOOR }));
  floor.position.y = -0.02;
  g.add(floor);
  const icePts = outline(0, 32);
  const ice = flat(new THREE.Shape(icePts), 0, ICE);
  ice.material = new THREE.MeshLambertMaterial({ color: ICE, side: THREE.DoubleSide });
  ice.name = 'ice';
  g.add(ice);

  // Lines across the ice (to the boards), circles, dots, creases.
  const across = (x: number, w: number, color: number, y = 0.002): void => {
    const hw = Math.min(iceHalfWidthAt(x - w / 2), iceHalfWidthAt(x + w / 2)) - 0.02;
    g.add(flat(rect(x - w / 2, -hw, x + w / 2, hw), y, color));
  };
  across(0, 0.305, RED);
  across(-RINK.blueLineX, 0.305, BLUE);
  across(RINK.blueLineX, 0.305, BLUE);
  across(-RINK.goalLineX, 0.051, RED);
  across(RINK.goalLineX, 0.051, RED);
  g.add(flat(ring(0, 0, CIRCLE_R, 0.051), 0.003, BLUE, 64));
  g.add(flat(disc(0, 0, 0.15), 0.004, BLUE));
  for (const d of FACEOFF_DOTS.end) {
    g.add(flat(ring(d.x, d.y, CIRCLE_R, 0.051), 0.003, RED, 64));
    // Hash marks on both sides of the circle.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const y0 = d.y + sy * CIRCLE_R * 0.98, y1 = d.y + sy * (CIRCLE_R + 0.6);
      const x = d.x + sx * 0.9;
      g.add(flat(rect(x - 0.025, Math.min(y0, y1), x + 0.025, Math.max(y0, y1)), 0.003, RED));
    }
    g.add(flat(disc(d.x, d.y, 0.305), 0.004, RED));
  }
  for (const d of FACEOFF_DOTS.neutral) g.add(flat(disc(d.x, d.y, 0.305), 0.004, RED));
  for (const end of [1, -1] as const) {
    // Crease: a half circle in front of the goal line, light blue with a red edge.
    const cx = end * RINK.goalLineX, r = RINK.creaseRadius;
    const fill = new THREE.Shape();
    const a0 = end === 1 ? Math.PI / 2 : -Math.PI / 2;
    fill.moveTo(cx, end === 1 ? r : -r);
    fill.absarc(cx, 0, r, a0, a0 + Math.PI, false);
    fill.lineTo(cx, end === 1 ? r : -r);
    g.add(flat(fill, 0.003, CREASE));
    const edge = new THREE.Shape();
    edge.absarc(cx, 0, r + 0.025, a0, a0 + Math.PI, false);
    edge.absarc(cx, 0, r - 0.025, a0 + Math.PI, a0, true);
    g.add(flat(edge, 0.004, RED));
    g.add(net(end));
  }

  // Boards: kickplate, white boards and a dark cap rail, with the cap's top surface.
  const inner = outline(0, 32), outer = outline(-0.18, 32);
  g.add(wall(inner, 0, KICK_H, KICK));
  g.add(wall(inner, KICK_H, BOARD_H, BOARD));
  g.add(wall(outer, 0, BOARD_H + 0.05, BOARD));
  g.add(band(inner, outer, BOARD_H + 0.05, CAP));
  g.add(wall(inner, BOARD_H, BOARD_H + 0.05, CAP));
  return g;
}
