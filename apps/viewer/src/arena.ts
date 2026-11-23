import * as THREE from 'three';
import { BENCH_DOORS, RINK } from '@hockey/engine';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RigColors } from './rig';

/**
 * The arena round the rink (three.js, nothing imported): stands rising behind the boards with a still crowd of
 * coloured blocks (one merged mesh; a share dressed in each team's colours), glass above the boards, a scoreboard
 * hanging over centre ice, a crest at centre ice, the benches and penalty boxes, lights under the roof and the
 * lighting, all closed in by an upper bowl, back walls and a dark roof (no camera sees out of the building).
 *
 * The benches are on the side of the bench doors (engine y < 0, world z < 0). The far side and the ends have a tall
 * bowl; the side opposite the benches, where a broadcast camera sits high up, has only a few low rows so nothing
 * stands between that camera and the ice, and its upper bowl rises gently to a wall behind that camera.
 *
 * `low` has no glass, no real-time shadows (blob shadows only) and about a quarter of the crowd blocks; `high` adds the
 * glass and a shadow-casting key light (the page must turn on renderer.shadowMap; userData.shadows says so).
 */

export type ArenaQuality = 'low' | 'high';
export type ArenaTeams = { home: { abbr: string; colors: RigColors }; away: { abbr: string; colors: RigColors } };

/**
 * The two teams' colours until the league stage brings real ones (scene.ts re-exports them): home in a dark red
 * jersey with white trim, away in white with blue trim. Kept here, the one place, so the arena's defaults match.
 */
export const TEAM_COLORS: Record<'home' | 'away', RigColors> = {
  home: { jersey: 0x9e1b2a, trim: 0xf2f3f5, pants: 0x17181b },
  away: { jersey: 0xf2f3f5, trim: 0x1d4fa8, pants: 0x1b2a4a },
};
const DEFAULT_TEAMS: ArenaTeams = { home: { abbr: 'HOME', colors: TEAM_COLORS.home }, away: { abbr: 'AWAY', colors: TEAM_COLORS.away } };

/** Relative luminance (0 black .. 1 white) of an sRGB hex colour. */
function brightness(hex: number): number {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((hex >> 16) & 255) + 0.7152 * lin((hex >> 8) & 255) + 0.0722 * lin(hex & 255);
}
/** A colour scaled toward black by `k` (0..1). */
const shade = (hex: number, k: number): number =>
  (Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);

const BOARD_H = 1.07;
/** The rink's centre red line width and centre dot radius (rink.ts), left showing through the crest. */
const RED_LINE_W = 0.305, CENTRE_DOT_R = 0.15;
/** From the boards out to where the stands begin (room for the benches), and the height of the first row. */
const STANDS_FROM = 3.6, FIRST_ROW_Y = 1.4;
/** Depth and top height of the stands on the far side and the ends, and on the near (broadcast) side. */
const FAR_DEPTH = 19, FAR_TOP = 12.5, NEAR_DEPTH = 4.5, NEAR_TOP = 2.6;
const ROW_DEPTH = 0.85, SEAT_W = 0.56;
const STANDS = 0x3a2f35, FRONT = 0x22262d, FLOOR = 0x23272e;
/** The colour to clear the page to behind the arena (its roof and far walls). */
export const ARENA_BACKGROUND = 0x15181d;
const CLOTHES = [0x2b3346, 0x1d1f24, 0x5d6470, 0x2f4a36, 0x5a4636, 0xb7aa92, 0x6b2b33, 0x3d5a80, 0x8a8f99, 0xd9d4c7, 0x7a5a2e, 0x24394f];

const hasDom = (): boolean => typeof document !== 'undefined';
const smooth = (t: number): number => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * A point round the rink outline pushed `off` metres out from the boards, at arc length `u` along that outline (counter-
 * clockwise from the +x end), with its outward normal. Engine (x, y).
 */
function around(off: number, u: number, out: { x: number; y: number; nx: number; ny: number }): void {
  const R = RINK.cornerRadius, cx = RINK.halfLength - R, cy = RINK.halfWidth - R, r = R + off;
  const sx = 2 * cy, sy = 2 * cx, arc = (r * Math.PI) / 2;
  const legs: [number, (t: number) => void][] = [
    [sx, (t) => { out.nx = 1; out.ny = 0; out.x = cx + r; out.y = -cy + t; }],
    [arc, (t) => { const a = t / r; out.nx = Math.cos(a); out.ny = Math.sin(a); out.x = cx + r * out.nx; out.y = cy + r * out.ny; }],
    [sy, (t) => { out.nx = 0; out.ny = 1; out.x = cx - t; out.y = cy + r; }],
    [arc, (t) => { const a = Math.PI / 2 + t / r; out.nx = Math.cos(a); out.ny = Math.sin(a); out.x = -cx + r * out.nx; out.y = cy + r * out.ny; }],
    [sx, (t) => { out.nx = -1; out.ny = 0; out.x = -cx - r; out.y = cy - t; }],
    [arc, (t) => { const a = Math.PI + t / r; out.nx = Math.cos(a); out.ny = Math.sin(a); out.x = -cx + r * out.nx; out.y = -cy + r * out.ny; }],
    [sy, (t) => { out.nx = 0; out.ny = -1; out.x = -cx + t; out.y = -cy - r; }],
    [arc, (t) => { const a = 1.5 * Math.PI + t / r; out.nx = Math.cos(a); out.ny = Math.sin(a); out.x = cx + r * out.nx; out.y = -cy + r * out.ny; }],
  ];
  const total = 2 * sx + 2 * sy + 4 * arc;
  let t = ((u % total) + total) % total;
  for (const [l, f] of legs) { if (t <= l) { f(t); return; } t -= l; }
  legs[legs.length - 1]![1](arc);
}
const perimeter = (off: number): number => {
  const R = RINK.cornerRadius;
  return 4 * (RINK.halfWidth - R) + 4 * (RINK.halfLength - R) + 2 * Math.PI * (R + off);
};

/** 0 on the far side and the ends, 1 on the near (broadcast) side, blending round the near corners. */
const nearness = (ny: number): number => smooth((ny - 0.35) / 0.5);
const depthAt = (ny: number): number => FAR_DEPTH + (NEAR_DEPTH - FAR_DEPTH) * nearness(ny);
const topAt = (ny: number): number => FAR_TOP + (NEAR_TOP - FAR_TOP) * nearness(ny);

/** The stands' sloped surface and their front wall, following the rink outline. */
function standsMesh(): THREE.Group {
  const g = new THREE.Group();
  const n = 240, p = { x: 0, y: 0, nx: 0, ny: 0 };
  const slope: number[] = [], front: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    around(STANDS_FROM, (i / n) * perimeter(STANDS_FROM), p);
    const depth = depthAt(p.ny), top = topAt(p.ny);
    slope.push(p.x, FIRST_ROW_Y - 0.2, p.y, p.x + p.nx * depth, top, p.y + p.ny * depth);
    front.push(p.x, 0, p.y, p.x, FIRST_ROW_Y - 0.2, p.y);
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const mk = (pos: number[], color: number, name: string): THREE.Mesh => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // World z is engine y: the (x, h, y) triples above are already world (x, y, z).
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Unlit: the stands are a backdrop, and a lit surface this size costs frames in a software renderer.
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.name = name;
    return m;
  };
  g.add(mk(slope, STANDS, 'stands'), mk(front, FRONT, 'standsFront'));
  return g;
}

/** The enclosure: the upper bowl, the back walls and the roof (one mesh, unlit, vertex colours). */
const FASCIA_H = 1.3, ROOF_Y = 34;
/** The upper bowl climbs this far back (m) behind the stands at the ends and the far side, to this height above them. */
const UPPER_BACK = 7, UPPER_RISE = 5.5;
/** On the near side it climbs from the low stands to a back wall `NEAR_WALL` m behind the boards, this high, behind the broadcast camera. */
const NEAR_WALL = 31.6, NEAR_UPPER_Y = 14;
const FASCIA = 0x3a414c, UPPER_LOW = 0x34292f, UPPER_HIGH = 0x221d22, WALL = 0x1b1e24, ROOF = 0x16191e;

/**
 * Closes the arena so that no camera sees past it: a fascia along the top of the stands, an upper bowl rising behind
 * them to a back wall all the way round (on the side opposite the benches it starts from the low stands and rises
 * gently far behind the broadcast camera, which still sees over it), and a dark roof over everything. A few thousand
 * triangles in one draw; unlit, since it is backdrop.
 */
function enclosure(): THREE.Mesh {
  const n = 240, p = { x: 0, y: 0, nx: 0, ny: 0 };
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const push = (x: number, y: number, z: number, hex: number): void => { pos.push(x, y, z); c.setHex(hex); col.push(c.r, c.g, c.b); };
  const RINGS = 5; // fascia bottom, fascia top, upper bowl foot, upper bowl top, wall top
  for (let i = 0; i < n; i++) {
    around(STANDS_FROM, (i / n) * perimeter(STANDS_FROM), p);
    const k = nearness(p.ny), d = depthAt(p.ny), top = topAt(p.ny);
    const offU = (d + UPPER_BACK) + (NEAR_WALL - STANDS_FROM - d - UPPER_BACK) * k;
    const yU = (top + FASCIA_H + UPPER_RISE) + (NEAR_UPPER_Y - top - FASCIA_H - UPPER_RISE) * k;
    const at = (off: number, y: number, hex: number): void => push(p.x + p.nx * off, y, p.y + p.ny * off, hex);
    at(d, top - 0.05, FASCIA);
    at(d, top + FASCIA_H, FASCIA);
    at(d, top + FASCIA_H, UPPER_LOW);
    at(offU, yU, UPPER_HIGH);
    at(offU, ROOF_Y + 0.5, WALL);
    const a = RINGS * i, b = RINGS * ((i + 1) % n);
    for (const r of [0, 2, 3]) idx.push(a + r, b + r, a + r + 1, b + r, b + r + 1, a + r + 1);
  }
  // The roof: one quad over the whole arena.
  const v = pos.length / 3, X = RINK.halfLength + 60, Z = RINK.halfWidth + 60;
  for (const [x, z] of [[-X, -Z], [X, -Z], [X, Z], [-X, Z]] as const) push(x, ROOF_Y, z, ROOF);
  idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.name = 'enclosure';
  return m;
}

/** Deterministic pseudo-random numbers (the crowd looks the same every time). */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The crowd: one block per seated fan, all in one mesh (one draw). Each block shows the rink only its front and its
 * top (four triangles), the top lighter than the front for shape without lighting. `every` thins the rows and seats
 * (low quality), with bigger blocks. A quarter or so wear the home colours and a sixth the away colours.
 *
 * Not an InstancedMesh: in headless Chromium's software renderer an instanced draw costs about 20 microseconds per
 * instance (1,460 blocks took 29 ms a frame), while the same blocks merged cost a few milliseconds.
 */
function crowd(teams: ArenaTeams, every: number): THREE.Mesh {
  const r = rand(17);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const p = { x: 0, y: 0, nx: 0, ny: 0 };
  const scale = every > 1 ? 1.35 : 1;
  const w = 0.46 * scale, dep = 0.36 * scale;
  const c = new THREE.Color();
  let blocks = 0;
  for (let row = 0; ; row += every) {
    const off = STANDS_FROM + (row + 0.5) * ROW_DEPTH;
    if (off > STANDS_FROM + FAR_DEPTH - 0.4) break;
    const per = perimeter(off), count = Math.floor(per / (SEAT_W * every));
    for (let i = 0; i < count; i++) {
      around(off, (i + 0.5 * (row % 2)) * (per / count), p);
      const depth = depthAt(p.ny);
      if (off - STANDS_FROM > depth - 0.4) continue;
      if (r() < 0.07) continue; // an empty seat
      if (i % 14 === 0) continue; // an aisle
      const y0 = FIRST_ROW_Y - 0.2 + ((off - STANDS_FROM) / depth) * (topAt(p.ny) - FIRST_ROW_Y + 0.2);
      const h = 0.78 * (0.85 + r() * 0.3);
      const pick = r();
      const hex = pick < 0.22 ? teams.home.colors.jersey : pick < 0.3 ? teams.home.colors.trim
        : pick < 0.4 ? teams.away.colors.jersey : pick < 0.46 ? teams.away.colors.trim : CLOTHES[Math.floor(r() * CLOTHES.length)]!;
      c.setHex(hex).multiplyScalar(0.8 + r() * 0.3);
      // Front (toward the rink, -normal) and top, in world x, z = engine x, y; tangent t = (-ny, nx).
      const tx = -p.ny * (w / 2), tz = p.nx * (w / 2);
      const fx = p.x - p.nx * (dep / 2), fz = p.y - p.ny * (dep / 2), bx = p.x + p.nx * (dep / 2), bz = p.y + p.ny * (dep / 2);
      const v = pos.length / 3;
      pos.push(fx - tx, y0, fz - tz, fx + tx, y0, fz + tz, fx + tx, y0 + h, fz + tz, fx - tx, y0 + h, fz - tz);
      pos.push(fx - tx, y0 + h, fz - tz, fx + tx, y0 + h, fz + tz, bx + tx, y0 + h, bz + tz, bx - tx, y0 + h, bz - tz);
      for (let k = 0; k < 4; k++) col.push(c.r * 0.78, c.g * 0.78, c.b * 0.78);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3, v + 4, v + 5, v + 6, v + 4, v + 6, v + 7);
      blocks++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'crowd';
  mesh.userData.blocks = blocks;
  return mesh;
}

/** Glass above the boards: a faint wall, taller behind the ends, with a thin rail along its top. */
function glass(): THREE.Group {
  const g = new THREE.Group();
  const n = 200, p = { x: 0, y: 0, nx: 0, ny: 0 }, off = 0.1;
  const pane: number[] = [], rail: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    around(off, (i / n) * perimeter(off), p);
    const top = BOARD_H + 1.6 + 0.8 * smooth((Math.abs(p.nx) - 0.5) / 0.4);
    pane.push(p.x, BOARD_H + 0.05, p.y, p.x, top, p.y);
    // No rail on the near side: from a camera up there it would be a dark line across the ice.
    const railTop = nearness(p.ny) > 0.5 ? top - 0.05 : top;
    rail.push(p.x, top - 0.05, p.y, p.x, railTop, p.y);
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const mk = (pos: number[], mat: THREE.Material, name: string): THREE.Mesh => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    return m;
  };
  const paneMesh = mk(pane, new THREE.MeshBasicMaterial({ color: 0xcfe3ee, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }), 'glass');
  paneMesh.renderOrder = 3;
  g.add(paneMesh, mk(rail, new THREE.MeshLambertMaterial({ color: 0x9aa3ad, side: THREE.DoubleSide }), 'glassRail'));
  return g;
}

/** A canvas texture (null without a DOM: the unit tests). */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The centre-ice crest: a ring in the home colours round the home team's abbreviation. */
function crest(teams: ArenaTeams): THREE.Object3D {
  const { jersey, trim } = teams.home.colors;
  const size = 4.2;
  const map = canvasTexture(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512);
    g.beginPath(); g.arc(256, 256, 244, 0, Math.PI * 2); g.fillStyle = css(jersey); g.fill();
    g.beginPath(); g.arc(256, 256, 214, 0, Math.PI * 2); g.fillStyle = css(trim); g.fill();
    g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.fillStyle = css(jersey); g.fill();
    const text = teams.home.abbr.toUpperCase();
    g.font = `bold ${text.length > 3 ? 120 : 150}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = css(trim);
    g.fillText(text, 256, 266, 360);
    // Leave the centre red line and the centre dot showing through: cut them out of the crest (canvas x is world x,
    // so the red line along world z is a vertical stripe through the middle).
    const px = 512 / size;
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(256 - (RED_LINE_W / 2) * px - 1, 0, RED_LINE_W * px + 2, 512);
    g.beginPath(); g.arc(256, 256, CENTRE_DOT_R * px + 2, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
  });
  const mat = map
    ? new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    : new THREE.MeshLambertMaterial({ color: jersey, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  // Lying on the ice, readable from the near (broadcast) side: text up toward the far side.
  const geo = map ? new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2) : new THREE.RingGeometry(size * 0.41, size * 0.48, 48).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.001;
  m.name = 'crest';
  return m;
}

/** The scoreboard hanging over centre ice: a dark cube with a screen on each face and lit bands top and bottom. */
function scoreboard(teams: ArenaTeams): THREE.Group {
  const g = new THREE.Group();
  g.name = 'scoreboard';
  const w = 5.2, h = 3.2, bottom = 15;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshLambertMaterial({ color: 0x1b1e24 }));
  body.position.y = bottom + h / 2;
  const bandMat = new THREE.MeshBasicMaterial({ color: 0xd8e4f0 });
  const bandTop = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.18, w + 0.1), bandMat);
  bandTop.position.y = bottom + h + 0.09;
  const bandBottom = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.18, w + 0.1), bandMat);
  bandBottom.position.y = bottom - 0.09;
  g.add(body, bandTop, bandBottom);
  const map = canvasTexture(512, 320, (c) => {
    c.fillStyle = '#05070a'; c.fillRect(0, 0, 512, 320);
    const half = (x: number, abbr: string, col: RigColors): void => {
      c.fillStyle = css(col.jersey); c.fillRect(x + 14, 26, 228, 64);
      c.font = 'bold 52px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = css(col.trim);
      c.fillText(abbr.toUpperCase(), x + 128, 60, 210);
    };
    half(0, teams.home.abbr, teams.home.colors);
    half(256, teams.away.abbr, teams.away.colors);
    c.fillStyle = '#f5c542';
    c.font = 'bold 120px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('HOCKEY', 256, 210, 470);
  });
  const screenMat = map ? new THREE.MeshBasicMaterial({ map, toneMapped: false }) : new THREE.MeshBasicMaterial({ color: 0x0c1016 });
  const screenGeo = new THREE.PlaneGeometry(w * 0.9, h * 0.82);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(screenGeo, screenMat);
    const a = (i * Math.PI) / 2;
    s.position.set(Math.sin(a) * (w / 2 + 0.01), bottom + h / 2, Math.cos(a) * (w / 2 + 0.01));
    s.rotation.y = a;
    g.add(s);
  }
  const cableGeo = new THREE.CylinderGeometry(0.02, 0.02, 6, 4);
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x2a2e35 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cable = new THREE.Mesh(cableGeo, cableMat);
    cable.position.set(sx * w * 0.4, bottom + h + 3, sz * w * 0.4);
    g.add(cable);
  }
  return g;
}

/** Benches (one per team, at its door) and the two penalty boxes beyond them, on the bench side. */
function benches(teams: ArenaTeams): THREE.Group {
  const g = new THREE.Group();
  g.name = 'benches';
  const z0 = Math.sign(BENCH_DOORS.home.y) || -1; // the bench side (world z = engine y)
  const front = RINK.halfWidth + 0.18, depth = 2.3;
  const box = (x0: number, x1: number, from: number, to: number, y0: number, y1: number, color: number, name = ''): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, to - from), new THREE.MeshLambertMaterial({ color }));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z0 * (front + (from + to) / 2));
    m.name = name;
    return m;
  };
  const area = (x0: number, x1: number, seat: number, back: number, name: string): void => {
    g.add(box(x0, x1, 0, depth, 0, 0.18, 0x2c2f35, name));
    g.add(box(x0, x1, depth - 0.55, depth - 0.1, 0.18, 0.62, seat));
    g.add(box(x0, x1, depth - 0.1, depth + 0.1, 0, 1.35, back));
    for (const x of [x0, x1]) g.add(box(x - 0.08, x + 0.08, 0, depth + 0.1, 0, 1.35, 0x30343b));
  };
  for (const side of ['home', 'away'] as const) {
    // The bench in the team's stronger colour (the darker of jersey and trim: red for a red team with white trim,
    // blue for a white team with blue trim), its seat a shade darker.
    const door = BENCH_DOORS[side].x, c = teams[side].colors;
    const strong = brightness(c.jersey) <= brightness(c.trim) ? c.jersey : c.trim;
    area(door - 4.6, door + 4.6, shade(strong, 0.7), strong, `bench-${side}`);
  }
  const outer = Math.max(Math.abs(BENCH_DOORS.home.x), Math.abs(BENCH_DOORS.away.x)) + 4.6 + 1.2;
  for (const sx of [-1, 1]) {
    const a = sx * outer, b = sx * (outer + 3.4);
    area(Math.min(a, b), Math.max(a, b), 0x55595f, 0x2a2d33, 'penaltyBox');
  }
  return g;
}

/** Lights that read like an arena: a bright even wash from the roof and a key light from high over the far side. */
function lights(quality: ArenaQuality): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lights';
  g.add(new THREE.HemisphereLight(0xffffff, 0x5d6672, 1.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-8, 30, -10);
  key.target.position.set(0, 0, 0);
  g.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(10, 20, 18);
  fill.target.position.set(0, 0, 0);
  g.add(fill, fill.target);
  if (quality === 'high') {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -36; cam.right = 36; cam.top = 24; cam.bottom = -24; cam.near = 5; cam.far = 70;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  return g;
}

/** Rows of lights under the roof (one mesh); the roof itself is part of the enclosure. */
function roofLights(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-30, -15, 0, 15, 30]) for (const z of [-22, -8, 8, 22]) parts.push(new THREE.BoxGeometry(6, 0.2, 0.6).translate(x, 30, z));
  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf4f7fb }));
  m.name = 'ceiling';
  return m;
}

/** The floor between the boards and the stands (the benches stand on it); unlit. */
function floorRing(): THREE.Mesh {
  const n = 160, p = { x: 0, y: 0, nx: 0, ny: 0 };
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    around(0, (i / n) * perimeter(0), p);
    pos.push(p.x + p.nx * 0.1, -0.01, p.y + p.ny * 0.1, p.x + p.nx * (STANDS_FROM + 0.1), -0.01, p.y + p.ny * (STANDS_FROM + 0.1));
    const a = 2 * i, b = 2 * ((i + 1) % n);
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: FLOOR, side: THREE.DoubleSide }));
  m.name = 'arenaFloor';
  return m;
}

export function buildArena(quality: ArenaQuality = 'high', teams: ArenaTeams = DEFAULT_TEAMS): THREE.Group {
  const g = new THREE.Group();
  g.name = 'arena';
  g.userData.shadows = quality === 'high';
  g.add(lights(quality), roofLights(), floorRing(), standsMesh(), enclosure(), crowd(teams, quality === 'high' ? 1 : 2), crest(teams), scoreboard(teams), benches(teams));
  if (quality === 'high') g.add(glass());
  return g;
}
