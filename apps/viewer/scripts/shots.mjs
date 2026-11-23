// Headless screenshots of the skating test page (the single-file build), driven frame by frame through window.__viewer.
// Usage: node apps/viewer/scripts/shots.mjs [outDir] [filePrefix]   (build first: npm -w apps/viewer run build:single)
// Saves single frames, a contact sheet per sequence (the frames cropped round the figure), page shots at laptop and
// phone widths in both colour schemes, and log.json (style per frame, measured frame rate, console errors).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const page = resolve(here, '../dist-single/index.html');
const out = resolve(process.argv[2] ?? join(process.cwd(), 'viewer-shots'));
const prefix = process.argv[3] ?? '';
if (!existsSync(page)) throw new Error(`build first: ${page} is missing`);
mkdirSync(out, { recursive: true });

const FRAMES = 8;
const log = { errors: [], sequences: [], fps: null, renderMs: null, simulateMs: null, pages: [] };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.errors.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) log.errors.push(`network: ${r.url()}`); });
  await p.goto(pathToFileURL(page).href);
  await p.waitForFunction(() => window.__viewer?.ready(), null, { timeout: 60000 });
  return { ctx, p };
}

const save = (name, dataUrl) => writeFileSync(join(out, prefix + name), Buffer.from(dataUrl.split(',')[1], 'base64'));

// ---- Frame rate in real time (1x, follow camera) at a 1280 x 720 window.
{
  const { ctx, p } = await open({ viewport: { width: 1280, height: 720 }, colorScheme: 'light' });
  log.simulateMs = await p.evaluate(() => window.__viewer.info().simulateMs);
  await p.click('#play');
  await p.waitForTimeout(8000);
  log.fps = await p.evaluate(() => window.__viewer.info().fps);
  log.canvas = await p.evaluate(() => { const c = document.getElementById('view'); return `${c.width}x${c.height}`; });
  log.renderMs = await p.evaluate(() => { window.__viewer.setManual(true); const t = performance.now(); for (let i = 0; i < 20; i++) window.__viewer.renderOnce(); return (performance.now() - t) / 20; });
  await p.click('#play').catch(() => {});
  await ctx.close();
}

// ---- Page shots: laptop and phone, light and dark.
for (const [w, h, scheme] of [[1280, 900, 'light'], [1280, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
  const { ctx, p } = await open({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: w < 500 ? 2 : 1 });
  await p.evaluate(() => { window.__viewer.setManual(true); window.__viewer.setSpeed(0.5); window.__viewer.seek(window.__viewer.moments().find((m) => m.kind === 'sprint')?.tick ?? 4000); window.__viewer.step(1); window.__viewer.renderOnce(); });
  const name = `${prefix}page-${w}-${scheme}.png`;
  await p.screenshot({ path: join(out, name), fullPage: true });
  const scroll = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log.pages.push({ name, horizontalOverflowPx: scroll });
  await ctx.close();
}

// ---- Skating sequences, frame by frame at 0.5x, for a defenceman (the default) and a forward.
const { ctx, p } = await open({ viewport: { width: 1280, height: 720 }, colorScheme: 'light' });
await p.evaluate(() => { window.__viewer.setManual(true); window.__viewer.setSpeed(0.5); });

async function sequence(tag, kind, camera, tick, spacing) {
  const frames = await p.evaluate(({ camera, tick, spacing, n }) => {
    const v = window.__viewer;
    // 'profile' is the screenshot-only camera fixed at his right side (relative to his facing), 4 m out.
    if (camera === 'profile') v.setCamera('side'); else v.setCamera(camera);
    v.seek(tick);
    v.step(1.6); // the lead-in: 0.8 s of game time at 0.5x, so the gait has settled
    const shots = [];
    for (let i = 0; i < n; i++) {
      v.step(spacing);
      if (camera === 'profile') v.orbit(90, 4.2, 1.2);
      shots.push({ url: v.grab(), info: v.info(), at: v.screenPos() });
    }
    return shots;
  }, { camera, tick, spacing, n: FRAMES });
  const names = frames.map((f, i) => { const n = `${tag}-${kind}-${camera}-${i + 1}.png`; save(n, f.url); return prefix + n; });
  log.sequences.push({ tag, kind, camera, tick, frames: frames.map((f, i) => ({ file: names[i], tick: f.info.tick, style: f.info.style, speed: +f.info.speed.toFixed(2), onIce: f.info.onIce })) });
  // Contact sheet: each frame cropped round the figure.
  const sheet = await ctx.newPage();
  const crop = 360, cropH = 440;
  const cells = frames.map((f, i) => {
    const cx = (f.at?.x ?? 0.5) * 1100, cy = (f.at?.y ?? 0.5) * 619;
    return `<div class="c"><img src="${f.url}" style="left:${-(cx - crop / 2)}px;top:${-(cy - cropH / 2)}px"><b>${i + 1} ${f.info.style} ${f.info.speed.toFixed(1)} m/s</b></div>`;
  }).join('');
  await sheet.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,${crop}px);gap:2px;width:${crop * 4 + 6}px}
    .c{position:relative;width:${crop}px;height:${cropH}px;overflow:hidden}.c img{position:absolute;width:1100px;height:619px}
    .c b{position:absolute;left:4px;top:2px;font:13px system-ui;color:#fff;background:rgba(0,0,0,.6);padding:1px 4px}</style>${cells}`);
  await sheet.screenshot({ path: join(out, `${prefix}sheet-${tag}-${kind}-${camera}.png`), fullPage: true });
  await sheet.close();
}

const players = await p.evaluate(() => window.__viewer.players());
const forward = players.find((x) => x.side === 'home' && x.position === 'C');
for (const [tag, who] of [['d', null], ['f', forward]]) {
  if (who) await p.evaluate((id) => window.__viewer.setPlayer(id), who.id);
  const info = await p.evaluate(() => window.__viewer.info());
  const moments = await p.evaluate(() => window.__viewer.moments());
  log.sequences.push({ tag, player: info.player, moments });
  for (const m of moments) {
    const spacing = m.kind === 'faceoff' ? 0.9 : 0.18;
    await sequence(tag, m.kind, 'follow', m.tick, spacing);
    await sequence(tag, m.kind, 'side', m.tick, spacing);
    await sequence(tag, m.kind, 'profile', m.tick, spacing);
  }
}
await ctx.close();
await browser.close();
writeFileSync(join(out, `${prefix}log.json`), JSON.stringify(log, null, 2));
console.log(JSON.stringify({ out, fps: log.fps, renderMs: log.renderMs, canvas: log.canvas, simulateMs: log.simulateMs, errors: log.errors, pages: log.pages }, null, 2));
