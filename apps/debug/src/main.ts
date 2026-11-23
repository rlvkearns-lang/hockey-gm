import { createGame, DT, generateTeam, PERIOD_SECONDS, type Game, type GameEvent, type GameSetup, type PlayerDef, type Side } from '@hockey/engine';
import { draw, rinkSize } from './draw';
import { clockText, describe, kindOf } from './events';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('rink');
const ctx = canvas.getContext('2d')!;
const MAX_EVENT_ROWS = 2500;
/** Smallest skater radius on the canvas, in CSS pixels, so a number fits inside the disc. */
const MIN_SKATER_PX = 7.5;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = (): boolean => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches);
let scale = 14;
let dpr = 1;
let simulating = false;
const BOX_REFRESH_MS = 250;

let game: Game;
let setup: GameSetup;
let defs = new Map<string, PlayerDef>();
let playing = false;
let speed = 1;
let lastFrame = 0;
let acc = 0;
let lastBox = 0;

function newGame(): void {
  const seed = Math.trunc(Number($<HTMLInputElement>('seed').value)) || 0;
  setup = { home: generateTeam(seed * 2 + 1, 'Harbour City', 'HBR'), away: generateTeam(seed * 2 + 2, 'Northern Peaks', 'NPK'), seed, chemistry: [] };
  game = createGame(setup);
  defs = new Map();
  for (const t of [setup.home, setup.away]) for (const p of t.players) defs.set(p.id, p);
  $('homeName').textContent = setup.home.name;
  $('awayName').textContent = setup.away.name;
  $('events').replaceChildren();
  setPlaying(false);
  acc = 0;
  refresh(true);
}

function setPlaying(on: boolean): void {
  playing = on && !game.done;
  $('play').textContent = playing ? 'Pause' : 'Play';
  lastFrame = 0;
}

const abbrs = (): Record<Side, string> => ({ home: setup.home.abbr, away: setup.away.abbr });

function appendEvents(): void {
  const list = game.drainEvents();
  if (list.length === 0) return;
  const box = $('events');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  for (const e of list) {
    const row = document.createElement('div');
    row.textContent = describe(e, defs, abbrs());
    const kind = kindOf(e);
    row.className = `ev-${kind === 'other' ? e.type : kind}${kind === 'goal' ? ' ' + e.side : ''}`;
    box.appendChild(row);
  }
  while (box.childElementCount > MAX_EVENT_ROWS) box.firstElementChild?.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}

const pct = (n: number, d: number): string => (d === 0 ? '-' : (n / d).toFixed(3).replace(/^0/, ''));

function cell(tr: HTMLElement, text: string, tag = 'td'): void {
  const c = document.createElement(tag);
  c.textContent = text;
  tr.appendChild(c);
}

function boxScore(): void {
  const r = game.result();
  const goalieLine = (side: Side) => r.players.find((p) => p.id === (side === 'home' ? setup.home : setup.away).lines.goalie)!;
  const sv = (side: Side): string => { const g = goalieLine(side); return `${pct(g.saves, g.shotsAgainst)} (${g.saves}/${g.shotsAgainst})`; };
  const rows: [string, string, string][] = [
    ['Goals', String(r.score.home), String(r.score.away)],
    ['Shots', String(r.team.home.shots), String(r.team.away.shots)],
    ['Save %', sv('home'), sv('away')],
    ['Hits', String(r.team.home.hits), String(r.team.away.hits)],
    ['Blocks', String(r.team.home.blocks), String(r.team.away.blocks)],
    ['Faceoffs won', String(r.team.home.faceoffsWon), String(r.team.away.faceoffsWon)],
    ['Giveaways', String(r.team.home.giveaways), String(r.team.away.giveaways)],
    ['Takeaways', String(r.team.home.takeaways), String(r.team.away.takeaways)],
  ];
  const table = document.createElement('table');
  const head = document.createElement('tr');
  cell(head, '', 'th'); cell(head, setup.home.abbr, 'th'); cell(head, setup.away.abbr, 'th');
  table.appendChild(head);
  for (const row of rows) { const tr = document.createElement('tr'); row.forEach((t) => cell(tr, t)); table.appendChild(tr); }
  $('boxBody').replaceChildren(table);

  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? setup.home : setup.away;
    const byId = new Map(r.players.map((p) => [p.id, p]));
    const skaters = team.players.filter((p) => p.position !== 'G').map((p) => ({ p, l: byId.get(p.id)! }))
      .sort((x, y) => y.l.toiSeconds - x.l.toiSeconds || x.p.number - y.p.number);
    const t = document.createElement('table');
    const hr = document.createElement('tr');
    for (const h of ['#', 'Name', 'Pos', 'G', 'A', 'Shots', 'Hits', 'TOI']) cell(hr, h, 'th');
    t.appendChild(hr);
    for (const { p, l } of skaters) {
      const tr = document.createElement('tr');
      [String(p.number), p.name, p.position, String(l.goals), String(l.assists), String(l.shots), String(l.hits), clockText(l.toiSeconds)].forEach((x) => cell(tr, x));
      t.appendChild(tr);
    }
    const h2 = document.createElement('h2');
    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background = `var(--${side})`;
    h2.append(dot, `${team.name} players`);
    $(`${side}Players`).replaceChildren(h2, t);
  }
}

function paint(): void {
  draw(ctx, game.state, defs, scale * dpr, { dark: isDark(), minRadiusPx: MIN_SKATER_PX * dpr });
}

/** Render the canvas at the size it is displayed (times the device pixel ratio) so text stays crisp and readable. */
function fitCanvas(): void {
  dpr = window.devicePixelRatio || 1;
  const cssW = canvas.getBoundingClientRect().width || 800;
  scale = cssW / rinkSize(1).w;
  const size = rinkSize(scale * dpr);
  canvas.width = Math.round(size.w);
  canvas.height = Math.round(size.h);
  if (game) paint();
}

function refresh(forceBox: boolean): void {
  const s = game.state;
  $('homeGoals').textContent = String(s.score.home);
  $('awayGoals').textContent = String(s.score.away);
  $('clock').textContent = clockText(s.phase === 'final' || s.phase === 'intermission' ? 0 : s.clock);
  $('period').textContent = s.phase === 'final' ? 'Final' : s.phase === 'intermission' ? `End of period ${s.period}` : s.phase === 'live' ? `Period ${s.period}` : `Period ${s.period} (stopped)`;
  $('status').textContent = `Tick ${s.tick}, game time ${clockText((s.period - 1) * PERIOD_SECONDS + (PERIOD_SECONDS - s.clock))}, seed ${setup.seed}. Home attacks ${s.attackDir.home === 1 ? 'right' : 'left'}.`;
  paint();
  appendEvents();
  const now = performance.now();
  if (forceBox || now - lastBox > BOX_REFRESH_MS) { boxScore(); lastBox = now; }
  if (game.done) setPlaying(false);
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Run the game to the final whistle in chunks, letting the page repaint between them. */
async function simToEnd(): Promise<void> {
  if (simulating) return;
  simulating = true;
  setPlaying(false);
  const mine = game;
  const buttons = document.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach((b) => { b.disabled = true; });
  while (!mine.done) {
    $('status').textContent = `Simulating… period ${mine.state.period}, ${clockText(mine.state.clock)} left`;
    await nextTurn();
    for (let i = 0; i < 6000 && !mine.done; i++) mine.step();
  }
  buttons.forEach((b) => { b.disabled = false; });
  simulating = false;
  refresh(true);
}

function frame(t: number): void {
  requestAnimationFrame(frame);
  if (!playing) return;
  if (lastFrame === 0) lastFrame = t;
  acc += Math.min(0.1, (t - lastFrame) / 1000) * speed;
  lastFrame = t;
  let n = Math.floor(acc / DT);
  acc -= n * DT;
  while (n-- > 0 && !game.done) game.step();
  refresh(false);
}

canvas.style.aspectRatio = `${rinkSize(1).w} / ${rinkSize(1).h}`;
window.addEventListener('resize', fitCanvas);
darkQuery.addEventListener('change', () => { if (game) paint(); });
$('play').addEventListener('click', () => setPlaying(!playing));
$('step').addEventListener('click', () => { setPlaying(false); game.step(); refresh(true); });
$('speed').addEventListener('change', () => { speed = Number($<HTMLSelectElement>('speed').value); });
$('toEnd').addEventListener('click', () => { void simToEnd(); });
$('showPass').addEventListener('change', (e) => $('events').classList.toggle('hide-pass', !(e.target as HTMLInputElement).checked));
$('showChange').addEventListener('change', (e) => $('events').classList.toggle('hide-change', !(e.target as HTMLInputElement).checked));
$('restart').addEventListener('click', newGame);
$<HTMLInputElement>('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') newGame(); });

fitCanvas();
newGame();
requestAnimationFrame(frame);
