import { bodyRadius, FACEOFF_DOTS, RINK, type ContestState, type GameState, type PlayerDef, type Side, type Vec2 } from '@hockey/engine';

const MARGIN = 2;
export const TEAM_COLOUR: Record<Side, string> = { home: '#d62839', away: '#1b64d6' };
const ICE = '#eef6fb';
const TIRED_BELOW = 0.45;

const KIND_NAMES: Record<string, string> = {
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
  const kind = KIND_NAMES[c.kind] ?? c.kind.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());
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

function drawRink(ctx: CanvasRenderingContext2D, px: (x: number) => number, py: (y: number) => number, scale: number): void {
  rinkPath(ctx, px, py, scale);
  ctx.fillStyle = ICE;
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
  vline(0, '#d6404e', 0.3);
  vline(-RINK.blueLineX, '#3a74c9', 0.3);
  vline(RINK.blueLineX, '#3a74c9', 0.3);
  vline(-RINK.goalLineX, '#d6404e', 0.1);
  vline(RINK.goalLineX, '#d6404e', 0.1);
  ctx.strokeStyle = '#3a74c9';
  ctx.lineWidth = 0.1 * scale;
  ctx.beginPath();
  ctx.arc(px(0), py(0), 4.5 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#d6404e';
  for (const d of [FACEOFF_DOTS.centre, ...FACEOFF_DOTS.neutral, ...FACEOFF_DOTS.end]) {
    ctx.beginPath();
    ctx.arc(px(d.x), py(d.y), (d === FACEOFF_DOTS.centre ? 0.3 : 0.25) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  for (const end of [1, -1]) {
    // Crease: half circle in front of the goal line.
    ctx.fillStyle = 'rgba(80,150,230,0.35)';
    ctx.beginPath();
    ctx.arc(px(end * RINK.goalLineX), py(0), RINK.creaseRadius * scale, end === 1 ? Math.PI / 2 : -Math.PI / 2, end === 1 ? (3 * Math.PI) / 2 : Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    // Net frame behind the goal line.
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.08 * scale;
    ctx.strokeRect(px(end === 1 ? RINK.goalLineX : -RINK.goalLineX - RINK.netDepth), py(-RINK.netHalfWidth), RINK.netDepth * scale, 2 * RINK.netHalfWidth * scale);
  }
  rinkPath(ctx, px, py, scale);
  ctx.strokeStyle = '#7b8794';
  ctx.lineWidth = 0.2 * scale;
  ctx.stroke();
}

/** Draw the rink and everything on it. `scale` is pixels per metre; the canvas should be `rinkSize(scale)`. */
export function draw(ctx: CanvasRenderingContext2D, state: GameState, defs: Map<string, PlayerDef>, scale: number): void {
  const { w, h } = rinkSize(scale);
  const px = (x: number): number => w / 2 + x * scale;
  const py = (y: number): number => h / 2 + y * scale;
  ctx.clearRect(0, 0, w, h);
  drawRink(ctx, px, py, scale);

  const pos = new Map<string, Vec2>();
  for (const s of state.skaters) if (s.onIce) pos.set(s.id, s.pos);
  pos.set(state.goalies.home.id, state.goalies.home.pos);
  pos.set(state.goalies.away.id, state.goalies.away.pos);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  for (const c of state.contests) {
    const ps = c.participants.map((id) => pos.get(id)).filter((p): p is Vec2 => p !== undefined);
    ctx.strokeStyle = '#1b2330';
    ctx.lineWidth = 0.12 * scale;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        ctx.beginPath();
        ctx.moveTo(px(ps[i]!.x), py(ps[i]!.y));
        ctx.lineTo(px(ps[j]!.x), py(ps[j]!.y));
        ctx.stroke();
      }
    }
  }

  for (const g of [state.goalies.home, state.goalies.away]) {
    const side: Side = g === state.goalies.home ? 'home' : 'away';
    const r = 0.55;
    ctx.fillStyle = TEAM_COLOUR[side];
    ctx.fillRect(px(g.pos.x - r), py(g.pos.y - r), 2 * r * scale, 2 * r * scale);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(9, 0.7 * scale)}px system-ui, sans-serif`;
    ctx.fillText(String(defs.get(g.id)?.number ?? ''), px(g.pos.x), py(g.pos.y));
  }

  for (const s of state.skaters) {
    if (!s.onIce) continue;
    const def = defs.get(s.id);
    const r = bodyRadius(def?.weightKg ?? 85);
    const x = px(s.pos.x), y = py(s.pos.y);
    ctx.globalAlpha = s.energy < TIRED_BELOW ? 0.45 : 1;
    ctx.fillStyle = TEAM_COLOUR[s.side];
    ctx.beginPath();
    ctx.arc(x, y, r * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.08 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(s.facing) * r * 1.5 * scale, y + Math.sin(s.facing) * r * 1.5 * scale);
    ctx.stroke();
    if (s.id === state.carrierId) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 0.18 * scale;
      ctx.beginPath();
      ctx.arc(x, y, (r + 0.25) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(9, 0.8 * scale)}px system-ui, sans-serif`;
    ctx.fillText(String(def?.number ?? ''), x, y);
    if (s.downT > 0) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 0.2 * scale;
      const d = r * 0.9 * scale;
      ctx.beginPath();
      ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const puck = state.puck;
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(px(puck.pos.x), py(puck.pos.y) - puck.z * scale * 0.5, 0.22 * scale, 0, Math.PI * 2);
  ctx.fill();

  for (const c of state.contests) {
    const text = labelFor(c, defs);
    ctx.font = `${Math.max(10, 0.9 * scale)}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const lx = Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, px(c.spot.x)));
    const ly = py(c.spot.y) - 1.8 * scale;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(lx - tw / 2 - 3, ly - 0.7 * scale, tw + 6, 1.4 * scale);
    ctx.fillStyle = '#111';
    ctx.fillText(text, lx, ly);
  }
}
