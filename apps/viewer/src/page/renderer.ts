import * as THREE from 'three';
import { ARENA_BACKGROUND, type ArenaQuality } from '../arena';
import type { CameraPose } from '../cameras';

/**
 * The watch page's renderer, three.js scene and camera. Quality: Low (no antialiasing, the light scene, pixel ratio
 * up to 1.5) or High (antialiasing, real shadows, full figures, pixel ratio up to 2). Antialiasing is fixed when a
 * WebGL context is made, so changing quality replaces the canvas and the renderer (make), and the page rebuilds the
 * game scene.
 */

/**
 * The puck is drawn at least PUCK_MIN_PX across on screen (CSS px), from true size (1x) up close to at most
 * PUCK_MAX_SCALE times a real puck from the far cameras; 7.62 cm is a real puck's width.
 */
const PUCK_MIN_PX = 9, PUCK_MAX_SCALE = 4, PUCK_WIDTH = 0.0762;

export type Renderer = {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Make (or replace) the canvas and the WebGL renderer for quality `q`. Throws if WebGL cannot be set up. */
  make(q: ArenaQuality): void;
  quality(): ArenaQuality;
  /** Size the picture to the stage (16:9 of its width). */
  fit(): void;
  /** Whether a picture can be drawn now (a renderer, and its context not lost). */
  canDraw(): boolean;
  render(): void;
  /** Render and return the picture as a PNG data URL ('' without a renderer). */
  grab(): string;
  /** Put the camera at `pose`. */
  aim(pose: CameraPose): void;
  /** How large to draw the puck (a multiple of a real one) at `puck` (world), so it can be found from far away. */
  puckScaleAt(puck: THREE.Vector3): number;
  /** Where a world point is in the picture (fractions, 0,0 top left), and whether it is in frame. */
  project(x: number, y: number, z: number): { x: number; y: number; inFrame: boolean };
  /** The canvas's height in device pixels (0 without one). */
  canvasHeight(): number;
};

/** Whether this browser can make a WebGL 2 context (three.js needs one). The test context is let go at once. */
export function canShow3d(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * `stage` holds the canvas. `on.lost` and `on.restored`: the graphics were reset under the page (a driver update, too
 * many pages using the GPU) and came back; `on.resized`: the picture changed size (draw it again).
 */
export function createRenderer(stage: HTMLElement, on: { lost(): void; restored(): void; resized(): void }): Renderer {
  let quality: ArenaQuality = 'low';
  let canvas: HTMLCanvasElement | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  /** Canvases being replaced: their context loss is ours, not the browser's. */
  const retired = new WeakSet<HTMLCanvasElement>();
  let contextLost = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ARENA_BACKGROUND);
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);

  function fit(): void {
    if (!renderer) return;
    const w = Math.max(1, Math.round(stage.clientWidth)), h = Math.max(1, Math.round((w * 9) / 16));
    renderer.setPixelRatio(Math.min(quality === 'high' ? 2 : 1.5, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    on.resized();
  }

  function make(q: ArenaQuality): void {
    quality = q;
    const c = document.createElement('canvas');
    c.setAttribute('aria-label', '3D picture of the game');
    if (canvas) {
      retired.add(canvas);
      renderer?.dispose();
      renderer?.forceContextLoss();
      canvas.replaceWith(c);
    } else stage.prepend(c);
    canvas = c;
    renderer = null;
    // If the graphics are reset under the page, say so and wait for the browser to give them back; three.js rebuilds
    // what it needs when they return.
    c.addEventListener('webglcontextlost', (e) => {
      if (retired.has(c)) return;
      e.preventDefault();
      contextLost = true;
      on.lost();
    });
    c.addEventListener('webglcontextrestored', () => {
      if (retired.has(c)) return;
      contextLost = false;
      on.restored();
    });
    const r = new THREE.WebGLRenderer({ canvas: c, antialias: quality === 'high', powerPreference: 'high-performance' });
    r.shadowMap.enabled = quality === 'high';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer = r;
    fit();
  }

  return {
    scene, camera, make, fit,
    quality: () => quality,
    canDraw: () => renderer !== null && !contextLost,
    render() { renderer?.render(scene, camera); },
    grab() { renderer?.render(scene, camera); return canvas?.toDataURL('image/png') ?? ''; },
    aim(cam) {
      camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
      camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
      if (camera.fov !== cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    },
    puckScaleAt(puck) {
      const d = camera.position.distanceTo(puck);
      const pxPerM = Math.max(1, stage.clientHeight || 1) / (2 * Math.max(d, 0.5) * Math.tan((camera.fov * Math.PI) / 360));
      return Math.min(PUCK_MAX_SCALE, Math.max(1, PUCK_MIN_PX / (pxPerM * PUCK_WIDTH)));
    },
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inFrame: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1 };
    },
    canvasHeight: () => canvas?.height ?? 0,
  };
}
