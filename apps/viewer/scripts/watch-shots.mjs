// Headless screenshots of the watch page (the single-file build), driven frame by frame through window.__watch.
// Usage: node apps/viewer/scripts/watch-shots.mjs [outDir] [seed]   (build first: npm -w apps/viewer run build:single)
//
// Finds moments in the game from its event log and state (a rush with a carrier, a faceoff, a line change, a shot and
// save, a goal, a board battle), and from each of the six cameras saves a sequence of frames of each moment plus a
// contact sheet per sequence; then the page at laptop and phone widths in light and dark, the frame rate at both
// qualities, and log.json (per frame: is the puck in the picture, how tall the nearest players are drawn; console
// errors; network requests; the score bug against the event log).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const pageFile = resolve(here, '../dist-single/index.html');
const out = resolve(process.argv[2] ?? join(process.cwd(), 'watch-shots'));
const seed = Number(process.argv[3] ?? 42);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null; // e.g. ONLY=moments,pages,fps
const cams = process.env.CAMS ? process.env.CAMS.split(',') : ['broadcast', 'overhead', 'netHome', 'netAway', 'iceLevel', 'follow'];
if (!existsSync(pageFile)) throw new Error(`build first: ${pageFile} is missing`);
mkdirSync(out, { recursive: true });

const FRAMES = 7;
const SPACING = 0.2; // seconds of game time between frames
const log = { seed, errors: [], network: [], moments: {}, sequences: [], fps: {}, pages: [], checks: {} };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const want = (k) => !only || only.includes(k);

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.errors.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  p.on('request', (r) => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) log.network.push(u); });
  await p.goto(pathToFileURL(pageFile).href);
  await p.waitForFunction(() => window.__watch?.ready(), null, { timeout: 90000 });
  if (seed !== 42) {
    await p.fill('#seed', String(seed));
    await p.click('#newGame');
    await p.waitForTimeout(200);
    await p.waitForFunction(() => window.__watch?.ready(), null, { timeout: 90000 });
  }
  return { ctx, p };
}
const save = (name, dataUrl) => writeFileSync(join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

// ---- Moments, from the event log and the state.
const { ctx, p } = await open({ viewport: { width: 1312, height: 1000 }, colorScheme: 'light' });
await p.evaluate(() => window.__watch.setManual(true));
const moments = await p.evaluate(() => {
  const w = window.__watch;
  const ev = w.events();
  const total = w.info().totalTicks;
  const found = {};
  const at = (t) => { w.seek(t); return w.state(); };
  // A rush: a pass or carry where, a moment later, the carrier is skating fast through the neutral zone.
  for (const e of ev.filter((e) => e.type === 'pass' && e.tick > 600)) {
    const s = at(e.tick + 30);
    const c = s.carrierId && s.skaters.find((k) => k.id === s.carrierId);
    if (!c || Math.abs(c.vel.x) < 5.5 || Math.abs(c.pos.x) > 12 || s.phase !== 'live' || Math.sign(c.vel.x) !== s.attackDir[c.side]) continue;
    const s2 = at(e.tick + 66); // still carrying it up the ice 1.2 s later
    if (s2.carrierId === c.id) { found.rush = { tick: e.tick + 12, who: c.id }; break; }
  }
  // A faceoff in an end zone (the dot is away from centre), from the set-up through the drop.
  const fo = ev.filter((e) => e.type === 'faceoff' && Math.abs(e.detail.spot.x) > 15)[1] ?? ev.find((e) => e.type === 'faceoff' && e.tick > 100);
  if (fo) found.faceoff = { tick: Math.max(0, fo.tick - 45), who: fo.playerId };
  // A line change on the fly: the first tick after the event at which a skater steps off or on.
  for (const e of ev.filter((e) => e.type === 'lineChange' && e.detail.onTheFly && e.tick > 600).slice(0, 6)) {
    let before = at(e.tick).skaters.filter((k) => k.onIce).map((k) => k.id).join();
    for (let t = e.tick + 3; t < e.tick + 600; t += 3) {
      const s = at(t), now = s.skaters.filter((k) => k.onIce).map((k) => k.id).join();
      if (now !== before) { const off = s.skaters.find((k) => !k.onIce && before.includes(k.id)); found.linechange = { tick: t - 24, who: off?.id ?? null }; break; }
      before = now;
    }
    if (found.linechange) break;
  }
  // A shot and save (with a release, so the shot is in the picture), and a goal.
  const save = ev.find((e) => e.type === 'save' && e.tick > 900 && ev.some((s) => s.type === 'shot' && s.tick === e.tick && s.detail.releaseTick !== null));
  if (save) { const shot = ev.find((s) => s.type === 'shot' && s.tick === save.tick); found.save = { tick: Math.max(0, Math.min(shot.detail.releaseTick - 12, save.tick - 45)), who: shot.playerId, goalie: save.playerId }; }
  const goal = ev.find((e) => e.type === 'goal' && e.detail.releaseTick !== null) ?? ev.find((e) => e.type === 'goal');
  if (goal) found.goal = { tick: Math.max(0, Math.min((goal.detail.releaseTick ?? goal.tick) - 15, goal.tick - 48)), who: goal.playerId, goalTick: goal.tick };
  const battle = ev.find((e) => e.type === 'contestStart' && e.detail.kind === 'boardBattle' && e.tick > 900);
  if (battle) found.battle = { tick: battle.tick + 3, who: battle.detail.participants[0] };
  found.total = total;
  return found;
});
log.moments = moments;
console.log('moments', JSON.stringify(moments));

// ---- The score bug against the event log: at each goal, and at the end.
log.checks = await p.evaluate(() => {
  const w = window.__watch, ev = w.events();
  const goals = ev.filter((e) => e.type === 'goal');
  const rows = [];
  for (const g of goals) {
    w.seek(g.tick - 30); const before = w.hud().bug;
    w.seek(g.tick + 30); const after = w.hud().bug;
    rows.push({ tick: g.tick, side: g.side, before, after });
  }
  w.seek(w.info().totalTicks);
  return { goals: rows, end: w.hud(), result: w.result() };
});

// ---- Sequences: each moment from each camera.
const names = ['rush', 'faceoff', 'linechange', 'save', 'goal', 'battle'];
if (want('moments')) {
  for (const m of names) {
    const mo = moments[m];
    if (!mo) { log.errors.push(`moment not found: ${m}`); continue; }
    for (const camName of cams) {
      const r = await p.evaluate(({ mo, camName, n, spacing }) => {
        const w = window.__watch;
        w.setSpeed(1);
        if (mo.who) w.setFollow(mo.who);
        w.setCamera(camName);
        w.seek(mo.tick);
        w.step(0.6); // the camera settles into its ease before the first frame
        const shots = [];
        // A contact sheet: the frames in a 4 x 2 grid at half size.
        const sheet = document.createElement('canvas');
        const c0 = document.querySelector('.stage canvas');
        const fw = Math.round(c0.width / 2), fh = Math.round(c0.height / 2);
        sheet.width = fw * 4; sheet.height = fh * 2;
        const g = sheet.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height);
        for (let i = 0; i < n; i++) {
          w.step(spacing);
          const url = w.grab();
          g.drawImage(c0, (i % 4) * fw, Math.floor(i / 4) * fh, fw, fh);
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect((i % 4) * fw, Math.floor(i / 4) * fh, 60, 22);
          g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(`${i + 1} t${w.info().tick}`, (i % 4) * fw + 4, Math.floor(i / 4) * fh + 16);
          const s = w.state();
          const near = s.skaters.filter((k) => k.onIce).map((k) => ({ id: k.id, d: Math.hypot(k.pos.x - s.puck.pos.x, k.pos.y - s.puck.pos.y) })).sort((a, b) => a.d - b.d)[0];
          shots.push({ url, tick: w.info().tick, puck: w.puckOnScreen(), nearest: near ? w.figureOnScreen(near.id) : null, followed: mo.who ? w.figureOnScreen(mo.who) : null, phase: s.phase, carrier: s.carrierId });
        }
        return { shots, sheet: sheet.toDataURL('image/jpeg', 0.85) };
      }, { mo, camName, n: FRAMES, spacing: SPACING });
      save(`seq-${m}-${camName}-sheet.jpg`, r.sheet);
      r.shots.forEach((s, i) => save(`seq-${m}-${camName}-${i + 1}.png`, s.url));
      const meta = r.shots.map(({ url, ...rest }) => rest);
      const puckOut = meta.filter((s) => !s.puck?.inFrame).length;
      log.sequences.push({ moment: m, camera: camName, puckOutOfFrame: puckOut, nearestPx: meta.map((s) => s.nearest ? Math.round(s.nearest.px) : null), frames: meta });
      console.log(m, camName, 'puck out', puckOut, 'nearest px', meta.map((s) => (s.nearest ? Math.round(s.nearest.px) : '-')).join(' '));
    }
  }
}

// ---- Puck in frame through two minutes of play, per camera (every 0.25 s).
if (want('coverage')) {
  log.coverage = await p.evaluate((camsIn) => {
    const w = window.__watch, out = {};
    for (const c of camsIn) {
      w.setCamera(c); w.seek(3000); w.step(0.5);
      let n = 0, outN = 0, edge = 0;
      for (let i = 0; i < 480; i++) { w.step(0.25); const pk = w.puckOnScreen(); n++; if (!pk.inFrame) outN++; else if (pk.x < 0.04 || pk.x > 0.96 || pk.y < 0.04 || pk.y > 0.96) edge++; }
      out[c] = { samples: n, outOfFrame: outN, atEdge: edge };
    }
    return out;
  }, cams);
  console.log('coverage', JSON.stringify(log.coverage));
}
await ctx.close();

// ---- Page shots: laptop and phone, light and dark.
if (want('pages')) {
  for (const [w, h, scheme] of [[1280, 900, 'light'], [1280, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
    const { ctx, p } = await open({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: w < 500 ? 2 : 1 });
    await p.evaluate((goalTick) => { const v = window.__watch; v.setManual(true); v.seek(goalTick ? goalTick + 120 : 20000); v.step(0.5); v.renderOnce(); }, moments.goal?.goalTick);
    await p.check('#showFps');
    await p.evaluate(() => window.__watch.setManual(false)); // the page's own loop draws the picture (paused)
    await p.waitForTimeout(400);
    const name = `page-${w}-${scheme}.png`;
    await p.screenshot({ path: join(out, name), fullPage: true });
    const scroll = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log.pages.push({ name, horizontalOverflowPx: scroll });
    if (w === 1280 && scheme === 'light') {
      await p.click('#toEnd');
      await p.waitForTimeout(400);
      await p.screenshot({ path: join(out, 'page-end.png'), fullPage: true });
    }
    await ctx.close();
  }
}

// ---- Frame rate: real time at 1x with all figures, each quality, at a 1280 x 720 picture; and per-frame cost.
if (want('fps')) {
  for (const q of ['low', 'high']) {
    const { ctx, p } = await open({ viewport: { width: 1312, height: 1000 }, colorScheme: 'light' });
    const size = await p.evaluate(async (q) => { await window.__watch.setQuality(q); const c = document.querySelector('.stage canvas'); return `${c.width}x${c.height}`; }, q);
    await p.evaluate((t) => { window.__watch.seek(t); }, moments.rush?.tick ?? 3000);
    await p.click('#play');
    await p.waitForTimeout(9000);
    const fps = await p.evaluate(() => window.__watch.fps());
    const slowShown = await p.evaluate(() => !document.getElementById('slow').hidden);
    await p.click('#play');
    const ms = await p.evaluate(() => {
      const w = window.__watch; w.setManual(true); w.setCamera('broadcast');
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) { w.step(1 / 60); w.renderOnce(); }
      return (performance.now() - t0) / 60;
    });
    log.fps[q] = { canvas: size, realTimeFps: Math.round(fps * 10) / 10, steppedMsPerFrame: Math.round(ms * 10) / 10, slowLineShown: slowShown };
    if (q === 'high') await p.screenshot({ path: join(out, 'page-high-slow.png'), fullPage: false });
    console.log('fps', q, JSON.stringify(log.fps[q]));
    await ctx.close();
  }
}

await browser.close();
writeFileSync(join(out, 'log.json'), JSON.stringify(log, null, 1));
console.log('errors', log.errors.length, log.errors.slice(0, 10));
console.log('network', log.network.length);
console.log('pages', JSON.stringify(log.pages));
console.log('checks', JSON.stringify(log.checks.end), JSON.stringify(log.checks.result));
