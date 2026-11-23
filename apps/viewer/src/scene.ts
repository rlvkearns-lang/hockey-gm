import * as THREE from 'three';
import { DT, type GameSetup, type GameState, type PlayerDef, type Side, type SkaterState } from '@hockey/engine';
import { buildArena, TEAM_COLORS as ARENA_TEAM_COLORS, type ArenaQuality } from './arena';
import { bodyDims, type BodyDims } from './body';
import { carryPoint, stepCarry, stickhandle, type CarryBlend, type IcePoint } from './carry';
import { initialGait, poseOf, stepGait, type GaitState, type Motion, type PoseOptions, type Vec3 } from './gait';
import { goalieMotion, goaliePoseOf, initialGoalieGait, stepGoalie, type GoalieGait } from './goalie-pose';
import { createGoalieRig, type GoalieRig } from './goalie-rig';
import { lerpAngle, type Frame } from './playback';
import { createRigKit, createSkaterRig, isSharedTexture, type RigColors, type SkaterRig } from './rig';
import { buildRink } from './rink';

/**
 * The whole game on the ice (three.js): every skater and both goalies as jointed figures, the puck, the rink and the
 * arena, moved to a playback frame by update(). The scene never decides anything about the game: positions and
 * facings are the engine's, blended between the frame's two ticks; skating poses come from each skater's own blended
 * motion (gait.ts); the puck is the engine's, drawn on the carrier's blade while he has it (carry.ts).
 *
 * Who is drawn: a skater is shown while he is on the ice at the frame's earlier tick (a skater leaving is drawn until
 * the engine takes him off), hidden (not removed) otherwise, and his gait starts afresh each time he steps on. A seek
 * or a new game calls reset(): every gait, goalie gait and the carry start again and the next update snaps everything
 * to the new time.
 *
 * The carried puck: while a skater keeps it, it eases from the engine's puck onto his blade (stepCarry, 0.15 s) and
 * follows the blade, stickhandled; when he lets it go (a pass, a shot, a check, a poke) it slides from his blade back
 * onto the engine's puck within that same tick, so from the first tick nobody has it, it is exactly the engine's puck.
 * A puck in the air is drawn at the engine's height.
 */

export type GameScene = {
  root: THREE.Group;
  /** Move to `frame`; `dt` is the game time since the last update (display time times playback speed; 0 when paused). */
  update(frame: Frame, dt: number): void;
  /** After a seek or a new game: the next update starts every gait and the carry afresh and snaps everything. */
  reset(): void;
  /** Where the puck is drawn (world; y is its height). Copied into `target` when given. */
  puckWorld(target?: THREE.Vector3): THREE.Vector3;
  /** A figure's place (world, on the ice), facing (engine radians) and whether he is on the ice; read-only. */
  figure(id: string): FigureView | undefined;
  dispose(): void;
};
export type FigureView = { readonly position: THREE.Vector3; readonly facing: number; readonly onIce: boolean };

/** Team colours until the league stage brings real ones: home in a dark red jersey, away in white with blue trim. */
export const TEAM_COLORS: Record<Side, RigColors> = ARENA_TEAM_COLORS;

/** The puck is drawn this much larger than a real one (7.62 cm across, 2.54 cm thick) so it reads from up high. */
export const PUCK_SCALE = 1.5;
const PUCK_R = 0.0381 * PUCK_SCALE, PUCK_H = 0.0254 * PUCK_SCALE;
/** A skater at the faceoff dot crouches when he is this close to it (m) while the faceoff is being set up. */
const CROUCH_DOT = 1.3;
/** Seconds to sink into (or come out of) the faceoff crouch. */
const CROUCH_TAU = 0.35;

type MutableView = { position: THREE.Vector3; facing: number; onIce: boolean };

type SkaterFig = {
  id: string; def: PlayerDef; right: boolean; dims: BodyDims; rig: SkaterRig;
  gait: GaitState; crouch: number;
  /** His gait starts afresh at the next update (a reset, or he has just stepped on). */
  fresh: boolean;
  /** Index into GameState.skaters (checked each frame, searched for if it ever moves). */
  idx: number;
  view: MutableView;
  /** Where the puck sits on his blade this frame (world x, z). */
  blade: IcePoint;
};
type GoalieFig = { id: string; dims: BodyDims; rig: GoalieRig; gait: GoalieGait; fresh: boolean; side: Side; view: MutableView };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return u * u * (3 - 2 * u); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function createGameScene(setup: GameSetup, opts: { quality?: ArenaQuality } = {}): GameScene {
  const quality: ArenaQuality = opts.quality ?? 'low';
  const root = new THREE.Group();
  root.name = 'game';
  const rink = buildRink();
  // The arena lays its own floor round the rink; the rink's big floor plane under everything would only cost frames.
  const rinkFloor = rink.getObjectByName('floor');
  if (rinkFloor) rinkFloor.visible = false;
  const arena = buildArena(quality, {
    home: { abbr: setup.home.abbr, colors: TEAM_COLORS.home },
    away: { abbr: setup.away.abbr, colors: TEAM_COLORS.away },
  });
  const figures = new THREE.Group();
  figures.name = 'figures';
  root.add(rink, arena, figures);

  // ---- Figures: one per skater of both teams, and the two starting goalies, all from one kit.
  const kit = createRigKit({ detail: quality === 'high' ? 'full' : 'lite' });
  const skaters: SkaterFig[] = [];
  const goalies: GoalieFig[] = [];
  const byId = new Map<string, { view: MutableView }>();
  for (const side of ['home', 'away'] as const) {
    for (const def of setup[side].players) {
      if (def.position === 'G') continue;
      const rig = createSkaterRig(def, TEAM_COLORS[side], kit);
      rig.root.visible = false;
      figures.add(rig.root);
      const fig: SkaterFig = {
        id: def.id, def, right: def.shoots === 'R', dims: bodyDims(def.heightCm, def.weightKg), rig,
        gait: initialGait(), crouch: 0, fresh: true, idx: skaters.length,
        view: { position: new THREE.Vector3(), facing: 0, onIce: false }, blade: { x: 0, z: 0 },
      };
      skaters.push(fig);
      byId.set(def.id, fig);
    }
    const gDef = setup[side].players.find((p) => p.id === setup[side].lines.goalie);
    if (gDef) {
      const rig = createGoalieRig(gDef, TEAM_COLORS[side], kit);
      figures.add(rig.root);
      const fig: GoalieFig = {
        id: gDef.id, dims: bodyDims(gDef.heightCm, gDef.weightKg), rig, gait: initialGoalieGait(), fresh: true, side,
        view: { position: new THREE.Vector3(), facing: 0, onIce: true },
      };
      goalies.push(fig);
      byId.set(gDef.id, fig);
    }
  }

  // ---- The puck: a short black disc with a light rim, and a small shadow.
  const puck = new THREE.Group();
  puck.name = 'puck';
  const puckGeo = new THREE.CylinderGeometry(PUCK_R, PUCK_R, PUCK_H, 20).translate(0, PUCK_H / 2, 0);
  const black = new THREE.MeshLambertMaterial({ color: 0x0b0b0c });
  const rim = new THREE.MeshLambertMaterial({ color: 0xb9c0c8, emissive: 0x30343a });
  const disc = new THREE.Mesh(puckGeo, [rim, black, black]); // CylinderGeometry groups: side, top, bottom
  disc.name = 'puckDisc';
  const puckShadow = kit.shadow();
  puckShadow.scale.setScalar(PUCK_R * 1.8);
  puck.add(disc, puckShadow);
  root.add(puck);

  // ---- Real-time shadows on `high`: figures and the puck cast them, the rink takes them.
  if (quality === 'high') {
    figures.traverse((o) => { if (o instanceof THREE.Mesh && o.name !== 'shadow' && o.name !== 'number' && o.name !== 'face') o.castShadow = true; });
    disc.castShadow = true;
    rink.traverse((o) => { if (o instanceof THREE.Mesh) o.receiveShadow = true; });
  }

  // ---- State and scratch (update allocates nothing of its own beyond what the pose maths returns).
  let blend: CarryBlend = { w: 0, from: { x: 0, z: 0 } };
  let puckFresh = true;
  /** A carry ending during the tick that starts at `tick`: who had it and how far onto his blade it was drawn. */
  const release = { active: false, tick: -1, id: '', ox: 0, oz: 0, a0: 0 };
  const motion: Motion = { speed: 0, forward: 0, lateral: 0, accelAlong: 0, turnRate: 0, facing: 0, down: false };
  const dot: Vec3 = { x: 0, y: 0, z: 0 };
  const poseOpts: PoseOptions = { crouch: 0, dot, hasPuck: false };
  const engine: IcePoint = { x: 0, z: 0 };
  /** A pick-up under way: where the puck was, relative to the skater picking it up, when he got it. */
  const pickup = { id: '', ox: 0, oz: 0 };
  const anchor: IcePoint = { x: 0, z: 0 };
  const drawn = new THREE.Vector3();

  const findSkater = (list: readonly SkaterState[], fig: SkaterFig): SkaterState | undefined => {
    const s = list[fig.idx];
    if (s && s.id === fig.id) return s;
    const i = list.findIndex((x) => x.id === fig.id);
    if (i >= 0) fig.idx = i;
    return i >= 0 ? list[i] : undefined;
  };

  /**
   * His motion part-way between the two ticks: velocity and facing blended, acceleration and turn rate over the tick
   * (as the skating test does), mirrored for a right shot (motion in, pose out). `p === n` reads one tick only.
   */
  function motionOf(fig: SkaterFig, p: SkaterState, n: SkaterState, a: number, facing: number): Motion {
    const vx = lerp(p.vel.x, n.vel.x, a), vy = lerp(p.vel.y, n.vel.y, a);
    const c = Math.cos(facing), s = Math.sin(facing), m = fig.right ? -1 : 1;
    const speed = Math.hypot(vx, vy);
    motion.speed = speed;
    motion.forward = vx * c + vy * s;
    motion.lateral = m * (-vx * s + vy * c);
    motion.accelAlong = p === n ? 0 : (Math.hypot(n.vel.x, n.vel.y) - Math.hypot(p.vel.x, p.vel.y)) / DT;
    motion.turnRate = p === n ? 0 : (m * wrap(n.facing - p.facing)) / DT;
    motion.facing = m * facing;
    motion.down = n.downT > 0;
    return motion;
  }

  function updateSkater(fig: SkaterFig, prev: GameState, next: GameState, a: number, dt: number, t: number): void {
    const p = findSkater(prev.skaters, fig);
    const nAny = findSkater(next.skaters, fig);
    const view = fig.view;
    if (!p || !p.onIce) {
      if (view.onIce) fig.fresh = true; // he will start afresh when he next steps on
      view.onIce = false;
      fig.rig.root.visible = false;
      return;
    }
    // On the ice at the earlier tick. If the engine takes him off at the later one (it puts him on the bench at the
    // door), he carries on along his velocity for that last tick, so he is never drawn skating in place.
    const n = nAny && nAny.onIce ? nAny : p;
    const x = p === n ? p.pos.x + p.vel.x * a * DT : lerp(p.pos.x, n.pos.x, a);
    const z = p === n ? p.pos.y + p.vel.y * a * DT : lerp(p.pos.y, n.pos.y, a);
    const facing = p === n ? p.facing : lerpAngle(p.facing, n.facing, a);
    if (!view.onIce) fig.fresh = true;
    const m = motionOf(fig, p, n, a, facing);
    const carrying = (n === p ? prev.carrierId : next.carrierId) === fig.id;
    const fresh = fig.fresh;
    if (fresh) {
      // Settle a fresh gait on the motion he has now, without a turn-rate or acceleration spike from the cut.
      m.accelAlong = 0; m.turnRate = 0;
      fig.gait = stepGait(initialGait(), m, 0, carrying);
      fig.fresh = false;
    } else if (dt > 0) fig.gait = stepGait(fig.gait, m, dt, carrying);

    // The faceoff crouch at the dot (as the skating test), the dot in his left-shot body frame.
    const spot = next.faceoffSpot;
    const atDot = next.phase === 'faceoffSetup' && Math.hypot(n.pos.x - spot.x, n.pos.y - spot.y) < CROUCH_DOT && m.speed < 0.5;
    fig.crouch = fresh ? (atDot ? 1 : 0) : fig.crouch + ((atDot ? 1 : 0) - fig.crouch) * (1 - Math.exp(-Math.max(dt, 0) / CROUCH_TAU));
    const ddx = spot.x - n.pos.x, ddy = spot.y - n.pos.y, cf = Math.cos(n.facing), sf = Math.sin(n.facing);
    dot.x = ddx * cf + ddy * sf; dot.y = 0; dot.z = (fig.right ? -1 : 1) * (-ddx * sf + ddy * cf);
    poseOpts.crouch = fig.crouch;
    poseOpts.hasPuck = carrying;
    poseOpts.handle = carrying || (fig.gait.puck ?? 0) > 0 ? stickhandle(t, m.speed) : undefined;
    const pose = poseOf(fig.gait, m, fig.dims, poseOpts);
    fig.rig.apply(pose, x, z, facing);
    fig.rig.root.visible = true;

    // Where the puck sits on his blade, in the world (mirrored for a right shot, as the rig mirrors the pose).
    const cp = carryPoint(pose);
    const bx = cp.x, bz = fig.right ? -cp.z : cp.z, c = Math.cos(facing), s = Math.sin(facing);
    fig.blade.x = x + bx * c - bz * s;
    fig.blade.z = z + bx * s + bz * c;
    view.position.set(x, 0, z);
    view.facing = facing;
    view.onIce = true;
  }

  function updateGoalie(fig: GoalieFig, prev: GameState, next: GameState, a: number, dt: number): void {
    const p = prev.goalies[fig.side], n = next.goalies[fig.side];
    const x = lerp(p.pos.x, n.pos.x, a), z = lerp(p.pos.y, n.pos.y, a), facing = lerpAngle(p.facing, n.facing, a);
    const input = goalieMotion(n);
    // Which side of him the puck is (+1 his right): a pad save kicks out the pad on that side.
    const toRight = (engine.x - x) * -Math.sin(facing) + (engine.z - z) * Math.cos(facing);
    input.side = toRight >= 0 ? 1 : -1;
    if (fig.fresh) {
      const pose = n.poseT > 0 ? n.pose : 'stance';
      fig.gait = { ...initialGoalieGait(), pose, from: pose, t: 1, side: input.side >= 0 ? 1 : -1 };
      fig.fresh = false;
    } else if (dt > 0) fig.gait = stepGoalie(fig.gait, input, dt);
    // The engine's goalies all catch with the left hand.
    fig.rig.apply(goaliePoseOf(fig.gait, fig.dims, 'L'), x, z, facing);
    fig.view.position.set(x, 0, z);
    fig.view.facing = facing;
  }

  function updatePuck(frame: Frame, dt: number): void {
    const { prev, next, alpha: a } = frame;
    const A = prev.carrierId, B = next.carrierId;
    const height = Math.max(0, lerp(prev.puck.z, next.puck.z, a));
    const bladeOf = (id: string | null): IcePoint | null => {
      if (id === null) return null;
      const f = byId.get(id) as SkaterFig | undefined;
      return f && 'blade' in f && f.view.onIce ? f.blade : null;
    };
    if (puckFresh) {
      blend = { w: B !== null && A === B && bladeOf(B) ? 1 : 0, from: { x: engine.x, z: engine.z } };
      drawn.set(engine.x, height, engine.z);
      release.active = false;
      pickup.id = blend.w === 1 ? B! : '';
      puckFresh = false;
    }
    let k = 0; // the blade's share of the drawn puck
    let bx = engine.x, bz = engine.z, ex = engine.x, ez = engine.z;
    const bladeB = bladeOf(B);
    const bladeA = B === null ? bladeOf(A) : null;
    if (bladeB) {
      // He has it (or gets it during this tick, picked up or won off another skater): ease onto his blade and follow
      // it. The engine snaps a puck it hands him to a spot at his reach, so the ease starts from where the puck was
      // last drawn instead, carried along with him, not from the engine's spot.
      const f = byId.get(B!)!.view;
      if (pickup.id !== B) { pickup.id = B!; blend.w = 0; pickup.ox = drawn.x - f.position.x; pickup.oz = drawn.z - f.position.z; }
      anchor.x = f.position.x + pickup.ox; anchor.z = f.position.z + pickup.oz;
      const r = stepCarry(blend, true, anchor, bladeB, dt);
      blend = r.blend;
      k = smooth(blend.w);
      bx = bladeB.x; bz = bladeB.z;
      ex = anchor.x; ez = anchor.z;
      release.active = false;
    } else if (bladeA) {
      // He let it go during this tick: slide from his blade to the engine's puck by the tick's end.
      // Where it was drawn when he let it go is kept relative to his blade, so it leaves from there.
      if (!release.active || release.tick !== frame.tick || release.id !== A) {
        // The slide starts at the previous frame's moment (`dt` of game time ago, where the puck was last drawn), so
        // the first frame that sees the release already moves it, at any frame rate. With dt = 0 (paused) it starts
        // now and moves once play resumes.
        release.active = true; release.tick = frame.tick; release.id = A!; release.a0 = Math.min(a, 0.999) - dt / DT;
        release.ox = drawn.x - bladeA.x; release.oz = drawn.z - bladeA.z;
      }
      // It heads straight for where the engine's puck is at the tick's end, at an even speed: the shortest slide.
      k = 1 - Math.min(1, Math.max(0, (a - release.a0) / (1 - release.a0)));
      bx = bladeA.x + release.ox; bz = bladeA.z + release.oz;
      ex = next.puck.pos.x; ez = next.puck.pos.y;
      blend.w = 0;
      pickup.id = '';
    } else {
      blend.w = 0;
      release.active = false;
      pickup.id = '';
    }
    const px = ex + (bx - ex) * k, pz = ez + (bz - ez) * k;
    blend.from.x = px; blend.from.z = pz;
    drawn.set(px, height * (1 - k), pz);
    puck.position.set(px, 0, pz);
    disc.position.y = drawn.y;
  }

  function update(frame: Frame, dt: number): void {
    const { prev, next, alpha: a } = frame;
    const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const t = (frame.tick + a) * DT;
    engine.x = lerp(prev.puck.pos.x, next.puck.pos.x, a);
    engine.z = lerp(prev.puck.pos.y, next.puck.pos.y, a);
    for (const fig of skaters) updateSkater(fig, prev, next, a, h, t);
    for (const fig of goalies) updateGoalie(fig, prev, next, a, h);
    updatePuck(frame, h);
  }

  function reset(): void {
    for (const f of skaters) { f.fresh = true; f.gait = initialGait(); f.crouch = 0; }
    for (const g of goalies) { g.fresh = true; g.gait = initialGoalieGait(); }
    puckFresh = true;
    release.active = false;
  }

  function dispose(): void {
    for (const f of skaters) f.rig.dispose();
    for (const g of goalies) g.rig.dispose();
    kit.dispose();
    puckGeo.dispose(); black.dispose(); rim.dispose();
    for (const part of [rink, arena]) {
      part.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map && !isSharedTexture(map)) map.dispose();
          m.dispose();
        }
      });
    }
  }

  return {
    root,
    update,
    reset,
    puckWorld: (target = new THREE.Vector3()) => target.copy(drawn),
    figure: (id) => byId.get(id)?.view,
    dispose,
  };
}
