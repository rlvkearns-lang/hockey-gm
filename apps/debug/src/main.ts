import { createGame, DT, generateTeam, PERIOD_SECONDS, type Game, type GameEvent, type GameSetup, type PlayerDef, type Side } from '@hockey/engine';
import { draw, rinkSize, TEAM_COLOUR } from './draw';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('rink');
const ctx = canvas.getContext('2d')!;
const SCALE = 14;
const MAX_EVENT_ROWS = 400;
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
  $('homeSwatch').style.background = TEAM_COLOUR.home;
  $('awaySwatch').style.background = TEAM_COLOUR.away;
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

const clockText = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const nameOf = (id: string | null): string => (id === null ? '' : defs.get(id)?.name ?? id);

function eventLine(e: GameEvent): string {
  const who = nameOf(e.playerId);
  const other = e.otherId ? ` / ${nameOf(e.otherId)}` : '';
  const team = e.side === 'home' ? setup.home.abbr : setup.away.abbr;
  return `P${e.period} ${clockText(e.clock)}  ${e.type}  ${team}${who ? ' ' + who : ''}${other}${e.detail ? ' (' + e.detail + ')' : ''}`;
}

function appendEvents(): void {
  const list = game.drainEvents();
  if (list.length === 0) return;
  const box = $('events');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  for (const e of list) {
    const row = document.createElement('div');
    row.textContent = eventLine(e);
    box.appendChild(row);
  }
  while (box.childElementCount > MAX_EVENT_ROWS) box.firstElementChild?.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}

function boxScore(): void {
  const r = game.result();
  const t = (side: Side) => r.team[side];
  const rows: [string, number, number][] = [
    ['Shots', t('home').shots, t('away').shots],
    ['Hits', t('home').hits, t('away').hits],
    ['Blocks', t('home').blocks, t('away').blocks],
    ['Faceoffs won', t('home').faceoffsWon, t('away').faceoffsWon],
    ['Giveaways', t('home').giveaways, t('away').giveaways],
    ['Takeaways', t('home').takeaways, t('away').takeaways],
  ];
  const table = document.createElement('table');
  table.innerHTML = `<tr><th></th><th>${setup.home.abbr}</th><th>${setup.away.abbr}</th></tr>`;
  for (const [label, h, a] of rows) {
    const tr = document.createElement('tr');
    for (const text of [label, String(h), String(a)]) { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); }
    table.appendChild(tr);
  }
  $('boxBody').replaceChildren(table);
}

function refresh(forceBox: boolean): void {
  const s = game.state;
  $('homeGoals').textContent = String(s.score.home);
  $('awayGoals').textContent = String(s.score.away);
  $('clock').textContent = clockText(s.phase === 'final' || s.phase === 'intermission' ? 0 : s.clock);
  $('period').textContent = s.phase === 'final' ? 'Final' : s.phase === 'intermission' ? `End of period ${s.period}` : s.phase === 'live' ? `Period ${s.period}` : `Period ${s.period} (stopped)`;
  $('status').textContent = `Tick ${s.tick}, game time ${clockText((s.period - 1) * PERIOD_SECONDS + (PERIOD_SECONDS - s.clock))}, seed ${setup.seed}. Home attacks ${s.attackDir.home === 1 ? 'right' : 'left'}.`;
  draw(ctx, s, defs, SCALE);
  appendEvents();
  const now = performance.now();
  if (forceBox || now - lastBox > BOX_REFRESH_MS) { boxScore(); lastBox = now; }
  if (game.done) setPlaying(false);
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

const size = rinkSize(SCALE);
canvas.width = size.w;
canvas.height = size.h;
$('play').addEventListener('click', () => setPlaying(!playing));
$('step').addEventListener('click', () => { setPlaying(false); game.step(); refresh(true); });
$('speed').addEventListener('change', () => { speed = Number($<HTMLSelectElement>('speed').value); });
$('toEnd').addEventListener('click', () => { setPlaying(false); while (!game.done) game.step(); refresh(true); });
$('restart').addEventListener('click', newGame);
$<HTMLInputElement>('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') newGame(); });

newGame();
requestAnimationFrame(frame);
