import * as THREE from 'three';
import { DT, RINK, type GameEvent, type GameSetup, type GameState, type GoalieState, type Side, type SkaterState } from '@hockey/engine';
import {
  BODY_PASS, GOALIE_OVERLAYS, initialGoalieAnim, initialSkaterAnim, OVERLAYS, poseGoalie, poseSkater, refreshGoalie, refreshSkater,
  stepGoalieAnim, stepSkater, turnRateOf,
  type AnimContext, type BodyPass, type DrawnBody, type GoalieAnim, type GoalieOverlay, type GoalieSample, type Overlay, type SkaterAnim,
  type SkaterSample,
} from './animator';
import { buildArena, TEAM_COLORS as ARENA_TEAM_COLORS, type ArenaQuality } from './arena';
import { bodyDims, type BodyDims } from './body';
import { carryPoint, initialPuckDraw, stepPuckDraw, type IcePoint, type PuckDraw, type PuckDrawInput } from './carry';
import { cutKind, emptyProbe, goalieJumped, isCut, lastCutAtOrBefore, probeOf, puckJumped, skaterJumped, type CutKind } from './cuts';
import type { SkaterPose } from './gait';
import type { GoalieFigurePose } from './goalie-pose';
import { createGoalieRig, type GoalieRig } from './goalie-rig';
import { lerpAngle, type Frame, type Playback } from './playback';
import { createRigKit, createSkaterRig, isSharedTexture, type RigColors, type SkaterRig } from './rig';
import { buildRink } from './rink';
import { buildTimeline, type Timeline } from './timeline';

/**
 * The whole game on the ice (three.js): every skater and both goalies as jointed figures, the puck, the rink and the
 * arena, moved to a playback frame by update(). The scene never decides anything about the game: positions and
 * facings are the engine's, blended between the frame's two ticks. Each frame it samples every figure, steps every
 * figure's animation through the animator (animator.ts: the skating gait with its overlays), then poses and draws
 * every figure (so a pose may read the others' samples), then steps the puck machine (carry.ts stepPuckDraw: the
 * engine's puck, drawn on the carrier's blade while he has it).
 *
 * Who is drawn: a skater is shown while he is on the ice at the frame's earlier tick (a skater leaving is drawn until
 * the engine takes him off), hidden (not removed) otherwise, and his gait starts afresh each time he steps on. A seek
 * or a new game calls reset(): every gait, goalie gait and the carry start again and the next update snaps everything
 * to the new time.
 *
 * The carried puck (carry.ts stepPuckDraw): while a skater keeps it, it eases from the engine's puck onto his blade
 * (0.15 s) and follows the blade, stickhandled; when he lets it go it slides from his blade back onto the engine's puck
 * within that same tick, so from the first tick nobody has it, it is exactly the engine's puck.
 *
 * Engine cuts (cuts.ts): across a tick in which the engine moves something discontinuously (the puck put on the dot
 * at a whistle, the goalies changing ends at a period start, anything moving further than it can), the earlier tick
 * is drawn for the whole tick, so nothing streaks across the ice; on the frame the picture cuts, whatever jumped
 * starts afresh (its animation, a goalie's, the carry) and cutNow() and cutKind() say so, for the camera to cut on the
 * same frame (a restart or a change of ends) or ease (a jump in the middle of play).
 *
 * A fresh gait starts in the style his motion shows (no blend in from the standing pose); seekScene() also plays the
 * last moments before a seek through, so every figure is shown as it would be had play reached that moment.
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
  /** Whether the latest update cut across an engine teleport (the picture jumped). */
  cutNow(): boolean;
  /** The kind of that cut (cuts.ts CutKind), or null when the latest update drew none. */
  cutKind(): CutKind | null;
  /** How large the puck is drawn, as a multiple of a real puck (default PUCK_SCALE); its shadow scales with it. */
  setPuckScale(k: number): void;
  dispose(): void;
};
/**
 * `hipY` is the drawn pelvis height (m). `pose` is a skater's drawn pose in his body frame before the mirror for a
 * right shot (null for a goalie, or before he is first drawn).
 */
export type FigureView = {
  readonly position: THREE.Vector3; readonly facing: number; readonly onIce: boolean; readonly hipY: number; readonly pose: Readonly<SkaterPose> | null;
  /** A goalie's drawn figure (body frame, as drawn; null for a skater). */
  readonly goaliePose: Readonly<GoalieFigurePose> | null;
};

/** Team colours until the league stage brings real ones: home in a dark red jersey, away in white with blue trim. */
export const TEAM_COLORS: Record<Side, RigColors> = ARENA_TEAM_COLORS;

/** The puck is drawn this much larger than a real one (7.62 cm across, 2.54 cm thick) so it reads from up high. */
export const PUCK_SCALE = 1.5;
const PUCK_R = 0.0381 * PUCK_SCALE, PUCK_H = 0.0254 * PUCK_SCALE;

type MutableView = { position: THREE.Vector3; facing: number; onIce: boolean; hipY: number; pose: SkaterPose | null; goaliePose: GoalieFigurePose | null };

type SkaterFig = {
  id: string; side: Side; right: boolean; dims: BodyDims; rig: SkaterRig;
  anim: SkaterAnim;
  /**
   * This frame's sample (made from his engine state the first time he is sampled, then refilled every frame and
   * shared with the animator's context); null before the first update.
   */
  sample: SkaterSample | null;
  /** His pose this frame (null while off the ice) and his drawn body (overlays' offset, then the body pass). */
  pose: SkaterPose | null;
  body: DrawnBody;
  /** Index into GameState.skaters (checked each frame, searched for if it ever moves). */
  idx: number;
  view: MutableView;
  /** Where the puck sits on his blade this frame (world x, z), and where he is drawn (for the puck machine). */
  hold: { blade: IcePoint; position: IcePoint };
};
type GoalieFig = {
  id: string; dims: BodyDims; rig: GoalieRig; anim: GoalieAnim; side: Side; view: MutableView;
  /** As a skater's: made at the first update, refilled every frame. */
  sample: GoalieSample | null;
  pose: GoalieFigurePose | null;
  body: DrawnBody;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const newBody = (id: string, kind: 'skater' | 'goalie', side: Side): DrawnBody =>
  ({ id, kind, side, onIce: false, pos: { x: 0, y: 0 }, facing: 0, offset: { x: 0, z: 0 }, eased: { x: 0, z: 0 } });

/** The scene's options. */
export type GameSceneOptions = {
  quality?: ArenaQuality;
  /**
   * `timeline` is the game's event timeline (timeline.ts, built once per recording and shared with the page), or
   * `events` the event log to build one from: the animator reads it (a pad save kicks out the pad on the side the
   * engine's own save event puts the puck, rather than the side the drawn puck happens to be on). Without either, the
   * scene animates from engine state alone.
   */
  events?: readonly GameEvent[];
  timeline?: Timeline;
  /** The overlays and body pass to use instead of the registered ones (animator.ts), for tests. */
  animation?: { skaters?: readonly Overlay[]; goalies?: readonly GoalieOverlay[]; bodyPass?: BodyPass };
};

export function createGameScene(setup: GameSetup, opts: GameSceneOptions = {}): GameScene {
  const quality: ArenaQuality = opts.quality ?? 'low';
  const skaterOverlays = opts.animation?.skaters ?? OVERLAYS, goalieOverlays = opts.animation?.goalies ?? GOALIE_OVERLAYS;
  const bodyPass = opts.animation?.bodyPass ?? BODY_PASS;
  const timeline = opts.timeline ?? buildTimeline(opts.events ?? []);
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
  const byId = new Map<string, SkaterFig | GoalieFig>();
  const skaterSamples = new Map<string, SkaterSample>(), goalieSamples = new Map<string, GoalieSample>();
  for (const side of ['home', 'away'] as const) {
    for (const def of setup[side].players) {
      if (def.position === 'G') continue;
      const rig = createSkaterRig(def, TEAM_COLORS[side], kit);
      rig.root.visible = false;
      figures.add(rig.root);
      const dims = bodyDims(def.heightCm, def.weightKg);
      const fig: SkaterFig = {
        id: def.id, side, right: def.shoots === 'R', dims, rig, anim: initialSkaterAnim(), idx: skaters.length,
        sample: null, pose: null, body: newBody(def.id, 'skater', side),
        view: { position: new THREE.Vector3(), facing: 0, onIce: false, hipY: 0, pose: null, goaliePose: null },
        hold: { blade: { x: 0, z: 0 }, position: { x: 0, z: 0 } },
      };
      skaters.push(fig);
      byId.set(def.id, fig);
    }
    const gDef = setup[side].players.find((p) => p.id === setup[side].lines.goalie);
    if (gDef) {
      const rig = createGoalieRig(gDef, TEAM_COLORS[side], kit);
      figures.add(rig.root);
      const dims = bodyDims(gDef.heightCm, gDef.weightKg);
      const fig: GoalieFig = {
        id: gDef.id, dims, rig, anim: initialGoalieAnim(), side, sample: null, pose: null, body: newBody(gDef.id, 'goalie', side),
        view: { position: new THREE.Vector3(), facing: 0, onIce: true, hipY: 0, pose: null, goaliePose: null },
      };
      goalies.push(fig);
      byId.set(gDef.id, fig);
    }
  }
  /** Every figure's drawn body, in the scene's order (skaters, then goalies), for the body pass. */
  const bodies: readonly DrawnBody[] = [...skaters.map((f) => f.body), ...goalies.map((g) => g.body)];

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
  function setPuckScale(k: number): void {
    const f = Number.isFinite(k) && k > 0 ? k / PUCK_SCALE : 1;
    disc.scale.setScalar(f);
    puckShadow.scale.setScalar(PUCK_R * 1.8 * f);
  }

  // ---- Real-time shadows on `high`: figures and the puck cast them, the rink takes them.
  if (quality === 'high') {
    figures.traverse((o) => { if (o instanceof THREE.Mesh && o.name !== 'shadow' && o.name !== 'number' && o.name !== 'face') o.castShadow = true; });
    disc.castShadow = true;
    rink.traverse((o) => { if (o instanceof THREE.Mesh) o.receiveShadow = true; });
  }

  // ---- State and scratch (update allocates little of its own beyond what the animation maths returns).
  let puckDraw: PuckDraw = initialPuckDraw();
  const drawn = new THREE.Vector3();
  /** The earlier tick last drawn (for cuts between frames), a scratch probe, and the kind of cut the latest update drew. */
  const shown = emptyProbe(), scratchProbe = emptyProbe();
  let cut: CutKind | null = null;
  const drawFrame: Frame = { prev: null as unknown as GameState, next: null as unknown as GameState, alpha: 0, tick: 0 };
  /** The animator's view of the frame: one object, refilled every frame. */
  const ctx: AnimContext = {
    tick: 0, alpha: 0, time: 0, state: null as unknown as GameState,
    skaters: skaterSamples, goalies: goalieSamples,
    puck: { engine: { x: 0, y: 0, z: 0 }, drawn: { x: 0, y: 0, z: 0 }, carrierId: null },
    contests: [], timeline, rink: RINK, defends: { home: -1, away: 1 },
  };
  const puckInput: PuckDrawInput = {
    tick: 0, alpha: 0, prevCarrier: null, nextCarrier: null, engine: { x: 0, z: 0 }, height: 0, nextPuck: { x: 0, z: 0 },
    holder: (id) => {
      const f = byId.get(id);
      return f && 'hold' in f && f.view.onIce ? f.hold : null;
    },
  };

  const findSkater = (list: readonly SkaterState[], fig: SkaterFig): SkaterState | undefined => {
    const s = list[fig.idx];
    if (s && s.id === fig.id) return s;
    const i = list.findIndex((x) => x.id === fig.id);
    if (i >= 0) fig.idx = i;
    return i >= 0 ? list[i] : undefined;
  };

  /**
   * Fill his sample for the frame (made from his engine state the first time). On the ice at the earlier tick: his
   * place, velocity and facing blended between the ticks, the change of speed and the turn over the tick. If the
   * engine takes him off at the later one (it puts him on the bench at the door), he carries on along his velocity for
   * that last tick, so he is never drawn skating in place. `p === n` reads one tick only. Off the ice: his engine state
   * at the earlier tick, standing where the engine has him, `onIce` false.
   */
  function sampleSkater(fig: SkaterFig, prev: GameState, next: GameState, a: number): void {
    const p = findSkater(prev.skaters, fig);
    if (!p) { if (fig.sample) fig.sample.onIce = false; return; }
    const nAny = findSkater(next.skaters, fig);
    let s = fig.sample;
    if (!s) {
      s = {
        id: fig.id, side: fig.side, right: fig.right, dims: fig.dims, onIce: false, pos: { x: p.pos.x, y: p.pos.y }, vel: { x: 0, y: 0 },
        facing: p.facing, accelAlong: 0, turnRate: 0, down: false, carrying: false, state: p,
      };
      fig.sample = s;
      skaterSamples.set(fig.id, s);
    }
    if (!p.onIce) {
      s.onIce = false;
      s.pos.x = p.pos.x; s.pos.y = p.pos.y; s.vel.x = p.vel.x; s.vel.y = p.vel.y; s.facing = p.facing;
      s.accelAlong = 0; s.turnRate = 0; s.down = p.downT > 0; s.carrying = false; s.state = p;
      return;
    }
    const n = nAny && nAny.onIce ? nAny : p;
    s.onIce = true;
    s.pos.x = p === n ? p.pos.x + p.vel.x * a * DT : lerp(p.pos.x, n.pos.x, a);
    s.pos.y = p === n ? p.pos.y + p.vel.y * a * DT : lerp(p.pos.y, n.pos.y, a);
    s.facing = p === n ? p.facing : lerpAngle(p.facing, n.facing, a);
    s.vel.x = lerp(p.vel.x, n.vel.x, a); s.vel.y = lerp(p.vel.y, n.vel.y, a);
    s.accelAlong = p === n ? 0 : (Math.hypot(n.vel.x, n.vel.y) - Math.hypot(p.vel.x, p.vel.y)) / DT;
    s.turnRate = p === n ? 0 : turnRateOf(p.facing, n.facing);
    s.down = n.downT > 0;
    s.carrying = (n === p ? prev.carrierId : next.carrierId) === fig.id;
    s.state = n;
  }

  function sampleGoalie(fig: GoalieFig, prev: GameState, next: GameState, a: number): void {
    const p = prev.goalies[fig.side], n = next.goalies[fig.side];
    let s = fig.sample;
    if (!s) {
      s = { id: fig.id, side: fig.side, dims: fig.dims, pos: { x: 0, y: 0 }, facing: 0, state: n };
      fig.sample = s;
      goalieSamples.set(fig.id, s);
    }
    s.pos.x = lerp(p.pos.x, n.pos.x, a); s.pos.y = lerp(p.pos.y, n.pos.y, a);
    s.facing = lerpAngle(p.facing, n.facing, a);
    s.state = n;
  }

  /** His pose for the frame and the offset his overlays ask for (into his drawn body). */
  function poseSkaterFig(fig: SkaterFig): void {
    const s = fig.sample, b = fig.body;
    if (!s || !s.onIce) { fig.pose = null; b.onIce = false; b.offset.x = 0; b.offset.z = 0; return; }
    const { pose, offset } = poseSkater(fig.anim, s, ctx, fig.dims, skaterOverlays);
    fig.pose = pose;
    b.onIce = true; b.pos.x = s.pos.x; b.pos.y = s.pos.y; b.facing = s.facing;
    b.offset.x = offset.x; b.offset.z = offset.z;
  }

  function poseGoalieFig(fig: GoalieFig): void {
    const s = fig.sample!, b = fig.body;
    fig.pose = poseGoalie(fig.anim, s, ctx, fig.dims, goalieOverlays);
    b.onIce = true; b.pos.x = s.pos.x; b.pos.y = s.pos.y; b.facing = s.facing;
    b.offset.x = 0; b.offset.z = 0;
  }

  /** Draw him: his pose on his rig at his place plus his body's offset, and the puck spot on his blade. */
  function drawSkater(fig: SkaterFig): void {
    const view = fig.view, s = fig.sample, pose = fig.pose;
    if (!s || !pose) {
      view.onIce = false;
      fig.rig.root.visible = false;
      return;
    }
    const x = s.pos.x + fig.body.offset.x, z = s.pos.y + fig.body.offset.z, facing = s.facing;
    fig.rig.apply(pose, x, z, facing);
    fig.rig.root.visible = true;
    view.pose = pose;
    view.hipY = pose.hipY;
    // Where the puck sits on his blade, in the world (mirrored for a right shot, as the rig mirrors the pose).
    const cp = carryPoint(pose);
    const bx = cp.x, bz = s.right ? -cp.z : cp.z, c = Math.cos(facing), n = Math.sin(facing);
    fig.hold.blade.x = x + bx * c - bz * n;
    fig.hold.blade.z = z + bx * n + bz * c;
    fig.hold.position.x = x; fig.hold.position.z = z;
    view.position.set(x, 0, z);
    view.facing = facing;
    view.onIce = true;
  }

  function drawGoalie(fig: GoalieFig): void {
    const gp = fig.pose!, s = fig.sample!;
    const x = s.pos.x + fig.body.offset.x, z = s.pos.y + fig.body.offset.z;
    fig.rig.apply(gp, x, z, s.facing);
    fig.view.hipY = gp.hipY;
    fig.view.goaliePose = gp;
    fig.view.position.set(x, 0, z);
    fig.view.facing = s.facing;
  }

  function updatePuck(frame: Frame, dt: number): void {
    const { prev, next, alpha: a } = frame;
    const pi = puckInput;
    pi.tick = frame.tick; pi.alpha = a;
    pi.prevCarrier = prev.carrierId; pi.nextCarrier = next.carrierId;
    pi.engine.x = ctx.puck.engine.x; pi.engine.z = ctx.puck.engine.z;
    pi.height = ctx.puck.engine.y;
    pi.nextPuck.x = next.puck.pos.x; pi.nextPuck.z = next.puck.pos.y;
    puckDraw = stepPuckDraw(puckDraw, pi, dt);
    const d = puckDraw.drawn;
    drawn.set(d.x, d.y, d.z);
    puck.position.set(d.x, 0, d.z);
    disc.position.y = d.y;
  }

  function update(input: Frame, dt: number): void {
    const prev = input.prev;
    // A tick the engine cuts in is drawn as its earlier side for the whole tick.
    const next = input.next !== prev && isCut(probeOf(prev, scratchProbe), input.next) ? prev : input.next;
    const a = input.alpha;
    const frame = drawFrame;
    frame.prev = prev; frame.next = next; frame.alpha = a; frame.tick = input.tick;
    // The picture moved on to a later tick across a cut (possibly skipping ticks): what jumped starts afresh.
    cut = null;
    if (shown.tick >= 0 && prev.tick !== shown.tick) {
      cut = cutKind(shown, prev);
      if (cut) {
        if (puckJumped(shown, prev)) puckDraw = { ...puckDraw, fresh: true };
        for (const g of goalies) if (goalieJumped(shown, prev, g.side)) g.anim = refreshGoalie(g.anim);
        for (const f of skaters) {
          findSkater(prev.skaters, f);
          if (skaterJumped(shown, prev, f.idx)) f.anim = refreshSkater(f.anim);
        }
      }
    }
    if (prev.tick !== shown.tick) probeOf(prev, shown);
    const h = Number.isFinite(dt) && dt > 0 ? dt : 0;
    // The frame's context for the animator.
    ctx.tick = frame.tick; ctx.alpha = a; ctx.time = (frame.tick + a) * DT;
    ctx.state = next;
    ctx.contests = next.contests;
    ctx.defends.home = next.attackDir.home === 1 ? -1 : 1;
    ctx.defends.away = next.attackDir.away === 1 ? -1 : 1;
    ctx.puck.engine.x = lerp(prev.puck.pos.x, next.puck.pos.x, a);
    ctx.puck.engine.z = lerp(prev.puck.pos.y, next.puck.pos.y, a);
    ctx.puck.engine.y = Math.max(0, lerp(prev.puck.z, next.puck.z, a));
    ctx.puck.drawn.x = drawn.x; ctx.puck.drawn.y = drawn.y; ctx.puck.drawn.z = drawn.z;
    ctx.puck.carrierId = next.carrierId;
    // Sample everyone, then step everyone, then pose everyone (a step or a pose reads this frame's samples of all the
    // figures), then the pass over all the drawn bodies, then draw everyone, then the puck from the blades drawn.
    for (const fig of skaters) sampleSkater(fig, prev, next, a);
    for (const fig of goalies) sampleGoalie(fig, prev, next, a);
    for (const fig of skaters) if (fig.sample) fig.anim = stepSkater(fig.anim, fig.sample, ctx, h, skaterOverlays);
    for (const fig of goalies) fig.anim = stepGoalieAnim(fig.anim, fig.sample!, ctx, h, goalieOverlays);
    for (const fig of skaters) poseSkaterFig(fig);
    for (const fig of goalies) poseGoalieFig(fig);
    bodyPass(bodies, ctx, h);
    for (const fig of skaters) drawSkater(fig);
    for (const fig of goalies) drawGoalie(fig);
    updatePuck(frame, h);
  }

  function reset(): void {
    for (const f of skaters) f.anim = initialSkaterAnim();
    for (const g of goalies) g.anim = initialGoalieAnim();
    for (const b of bodies) { b.eased.x = 0; b.eased.z = 0; }
    puckDraw = initialPuckDraw();
    shown.tick = -1;
    cut = null;
  }

  function dispose(): void {
    for (const f of skaters) f.rig.dispose();
    for (const g of goalies) g.rig.dispose();
    kit.dispose();
    puckGeo.dispose(); black.dispose(); rim.dispose();
    for (const part of [rink, arena]) {
      part.traverse((o) => {
        // High quality's key light owns a shadow map (a render target) that the renderer keeps until it is freed.
        if (o instanceof THREE.Light && o.shadow) o.shadow.dispose();
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
    cutNow: () => cut !== null,
    cutKind: () => cut,
    setPuckScale,
    dispose,
  };
}

/** Seconds of play run through before a seek's moment, so every pose, the crouch and the carry have settled. */
export const PREROLL_SECONDS = 1.5;
/** The step (s of game time) of that run-through. */
export const PREROLL_STEP = 1 / 30;

/**
 * Seek `pb` to `tick` and show it in `sc` as if play had reached it: the playback is put PREROLL_SECONDS earlier
 * (never before the game's start or the latest engine cut at or before `tick`, where everything starts afresh
 * anyway), the scene is reset there and stepped through to `tick` at PREROLL_STEP without drawing. A man who is down
 * is then drawn down, a skater mid-stride mid-stride, a goalie in a save in the save, and the carried puck on the
 * blade. `preroll` 0 is a plain seek (reset and one update).
 */
export function seekScene(pb: Playback, sc: GameScene, tick: number, preroll = PREROLL_SECONDS): void {
  const target = Math.min(Math.max(Number.isFinite(tick) ? tick : 0, 0), pb.totalTicks);
  const start = Math.max(0, target - Math.max(0, preroll) / DT, lastCutAtOrBefore(pb.cuts, Math.floor(target)));
  pb.seek(start);
  sc.reset();
  sc.update(pb.frame(), 0);
  const span = (target - start) * DT;
  const n = Math.ceil(span / PREROLL_STEP - 1e-9);
  for (let i = 1; i <= n; i++) {
    pb.seek(i === n ? target : start + ((target - start) * i) / n);
    sc.update(pb.frame(), span / n);
  }
}
