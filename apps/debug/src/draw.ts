import { bodyRadius, FACEOFF_DOTS, RINK, type ContestKind, type ContestState, type GameState, type PlayerDef, type Side, type Vec2 } from '@hockey/engine';

const MARGIN = 2;
const TIRED_BELOW = 0.45;
/** Skaters are drawn this many times their true radius (at least `minRadiusPx`, scaled by body size) so numbers can be read. */
const EXAGGERATE = 2.2;

export type Palette = {
  home: string; away: string; ice: string; boards: string; centreLine: string; blueLine: string; goalLine: string;
  crease: string; net: string; contestLine: string; labelBg: string; labelText: string; outline: string; puck: string; puckRing: string;
};

export const LIGHT: Palette = {
  home: '#d62839', away: '#1b64d6', ice: '#eef6fb', boards: '#7b8794', centreLine: '#d6404e', blueLine: '#3a74c9', goalLine: '#d6404e',
  crease: 'rgba(80,150,230,0.35)', net: '#555', contestLine: '#1b2330', labelBg: 'rgba(255,255,255,0.92)', labelText: '#111',
  outline: 'rgba(0,0,0,0.55)', puck: '#000', puckRing: '#fff',
};

export const DARK: Palette = {
  home: '#ff5a5f', away: '#4d9bff', ice: '#1d2a38', boards: '#8fa0b5', centreLine: '#ff6b6b', blueLine: '#5aa0ff', goalLine: '#ff6b6b',
  crease: 'rgba(90,160,255,0.30)', net: '#b8c4d4', contestLine: '#e8ecf2', labelBg: 'rgba(18,22,29,0.92)', labelText: '#e8ecf2',
  outline: 'rgba(255,255,255,0.85)', puck: '#000', puckRing: '#fff',
};

export type DrawOptions = {
  dark?: boolean;
  /** Smallest skater radius in canvas pixels (for a 0.4 m skater); keeps numbers legible on a small canvas. */
  minRadiusPx?: number;
};

const KIND_NAMES: Record<ContestKind, string> = {
  boardBattle: 'Board battle',
  looseRace: 'Loose-puck race',
  hit: 'Hit',
  pokeCheck: 'Poke check',
  netFront: 'Net-front battle',
};

/** Pixel size of a canvas that shows the whole rink at `scale` pixels per metre, with a small margin. */
export function rinkSize(scale: number): { w: number; h: number } {
  return { w: scale * (2 * RINK.halfLength + 2 * MARGIN), h: scale * (2 * RINK.halfWidth + 2 * MARGIN) };
}

const surname = (name: string): string => name.trim().split(/\s+/).slice(-1)[0] ?? name;

/** For example `Board battle · pin · Osgood leading` (no leader yet: `Loose-puck race · race`). */
export function labelFor(c: ContestState, defs: Map<string, PlayerDef>): string {
  const kind = KIND_NAMES[c.kind];
  const parts = [kind, c.stage];
  if (c.leader !== null) parts.push(`${surname(defs.get(c.leader)?.name ?? c.leader)} leading`);
  return parts.join(' · ');
}

function rinkPath(ctx: CanvasRenderingContext2D, px: (x: number) => number, py: (y: number) => number, scale: number): void {
  const hl = RINK.halfLength, hw = RINK.halfWidth, r = RINK.cornerRadius;
  ctx.beginPath();
  ctx.moveTo(px(-hl + r), py(-hw));
  ctx.arcTo(px(hl), py(-hw), px(hl), py(-hw + r), r * scale);
  ctx.arcTo(px(hl), py(hw), px(hl - r), py(hw), r * scale);
  ctx.arcTo(px(-hl), py(hw), px(-hl), py(hw - r), r * scale);
  ctx.arcTo(px(-hl), py(-hw), px(-hl + r), py(-hw), r * scale);
  ctx.closePath();
}

function drawRink(ctx: CanvasRenderingContext2D, px: (x: number) => number, py: (y: number) => number, scale: number, pal: Palette): void {
  rinkPath(ctx, px, py, scale);
  ctx.fillStyle = pal.ice;
  ctx.fill();
  ctx.save();
  rinkPath(ctx, px, py, scale);
  ctx.clip();
  const vline = (x: number, colour: string, w: number): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w * scale;
    ctx.beginPath();
    ctx.moveTo(px(x), py(-RINK.halfWidth));
    ctx.lineTo(px(x), py(RINK.halfWidth));
    ctx.stroke();
  };
  vline(0, pal.centreLine, 0.3);
  vline(-RINK.blueLineX, pal.blueLine, 0.3);
  vline(RINK.blueLineX, pal.blueLine, 0.3);
  vline(-RINK.goalLineX, pal.goalLine, 0.1);
  vline(RINK.goalLineX, pal.goalLine, 0.1);
  ctx.strokeStyle = pal.blueLine;
  ctx.lineWidth = 0.1 * scale;
  ctx.beginPath();
  ctx.arc(px(0), py(0), 4.5 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = pal.centreLine;
  for (const d of [FACEOFF_DOTS.centre, ...FACEOFF_DOTS.neutral, ...FACEOFF_DOTS.end]) {
    ctx.beginPath();
    ctx.arc(px(d.x), py(d.y), (d === FACEOFF_DOTS.centre ? 0.3 : 0.25) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  for (const end of [1, -1]) {
    // Crease: half circle in front of the goal line.
    ctx.fillStyle = pal.crease;
    ctx.beginPath();
    ctx.arc(px(end * RINK.goalLineX), py(0), RINK.creaseRadius * scale, end === 1 ? Math.PI / 2 : -Math.PI / 2, end === 1 ? (3 * Math.PI) / 2 : Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    // Net frame behind the goal line.
    ctx.strokeStyle = pal.net;
    ctx.lineWidth = 0.08 * scale;
    ctx.strokeRect(px(end === 1 ? RINK.goalLineX : -RINK.goalLineX - RINK.netDepth), py(-RINK.netHalfWidth), RINK.netDepth * scale, 2 * RINK.netHalfWidth * scale);
  }
  rinkPath(ctx, px, py, scale);
  ctx.strokeStyle = pal.boards;
  ctx.lineWidth = 0.2 * scale;
  ctx.stroke();
}

/** Draw the rink and everything on it. `scale` is pixels per metre; the canvas should be `rinkSize(scale)`. */
export function draw(ctx: CanvasRenderingContext2D, state: GameState, defs: Map<string, PlayerDef>, scale: number, opts: DrawOptions = {}): void {
  const pal = opts.dark ? DARK : LIGHT;
  const minR = opts.minRadiusPx ?? 0;
  const { w, h } = rinkSize(scale);
  const px = (x: number): number => w / 2 + x * scale;
  const py = (y: number): number => h / 2 + y * scale;
  const teamColour = (side: Side): string => pal[side];
  /** On-screen radius: exaggerated, never below minR (scaled by body size so light and heavy skaters still differ). */
  const radiusPx = (trueR: number): number => Math.max(EXAGGERATE * trueR * scale, (minR * trueR) / 0.4);
  ctx.clearRect(0, 0, w, h);
  drawRink(ctx, px, py, scale, pal);

  const pos = new Map<string, Vec2>();
  for (const s of state.skaters) if (s.onIce) pos.set(s.id, s.pos);
  pos.set(state.goalies.home.id, state.goalies.home.pos);
  pos.set(state.goalies.away.id, state.goalies.away.pos);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  for (const c of state.contests) {
    const ps = c.participants.map((id) => pos.get(id)).filter((p): p is Vec2 => p !== undefined);
    ctx.strokeStyle = pal.contestLine;
    ctx.lineWidth = Math.max(2, 0.12 * scale);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        ctx.beginPath();
        ctx.moveTo(px(ps[i]!.x), py(ps[i]!.y));
        ctx.lineTo(px(ps[j]!.x), py(ps[j]!.y));
        ctx.stroke();
      }
    }
  }

  for (const side of ['home', 'away'] as const) {
    const g = state.goalies[side];
    const half = Math.max(1.6 * 0.55 * scale, minR * 1.25);
    ctx.fillStyle = teamColour(side);
    ctx.fillRect(px(g.pos.x) - half, py(g.pos.y) - half, 2 * half, 2 * half);
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = Math.max(2, half * 0.22);
    ctx.strokeRect(px(g.pos.x) - half, py(g.pos.y) - half, 2 * half, 2 * half);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(half * 1.15)}px system-ui, sans-serif`;
    ctx.fillText(String(defs.get(g.id)?.number ?? ''), px(g.pos.x), py(g.pos.y));
  }

  for (const s of state.skaters) {
    if (!s.onIce) continue;
    const def = defs.get(s.id);
    const r = radiusPx(bodyRadius(def?.weightKg ?? 85));
    const x = px(s.pos.x), y = py(s.pos.y);
    ctx.globalAlpha = s.energy < TIRED_BELOW ? 0.45 : 1;
    ctx.fillStyle = teamColour(s.side);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
    // Facing tick pokes out past the disc.
    ctx.strokeStyle = pal.contestLine;
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(s.facing) * r, y + Math.sin(s.facing) * r);
    ctx.lineTo(x + Math.cos(s.facing) * r * 1.6, y + Math.sin(s.facing) * r * 1.6);
    ctx.stroke();
    if (s.id === state.carrierId) {
      ctx.strokeStyle = pal.contestLine;
      ctx.lineWidth = Math.max(2, r * 0.25);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.25, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`;
    ctx.fillText(String(def?.number ?? ''), x, y);
    if (s.downT > 0) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(2, r * 0.3);
      const d = r * 0.9;
      ctx.beginPath();
      ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The puck goes on top of the players: bigger than life, black with a contrasting ring.
  const puck = state.puck;
  const pr = Math.max(0.4 * scale, minR * 0.5);
  ctx.beginPath();
  ctx.arc(px(puck.pos.x), py(puck.pos.y) - puck.z * scale * 0.5, pr, 0, Math.PI * 2);
  ctx.fillStyle = pal.puck;
  ctx.fill();
  ctx.strokeStyle = pal.puckRing;
  ctx.lineWidth = Math.max(2, pr * 0.4);
  ctx.stroke();

  for (const c of state.contests) {
    const text = labelFor(c, defs);
    const fs = Math.max(10, Math.round(Math.max(0.9 * scale, minR * 1.3)));
    ctx.font = `${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const lx = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, px(c.spot.x)));
    const ly = Math.max(fs, py(c.spot.y) - Math.max(1.8 * scale, minR * 2.2));
    ctx.fillStyle = pal.labelBg;
    ctx.fillRect(lx - tw / 2 - 3, ly - fs * 0.8, tw + 6, fs * 1.6);
    ctx.fillStyle = pal.labelText;
    ctx.fillText(text, lx, ly);
  }
}
