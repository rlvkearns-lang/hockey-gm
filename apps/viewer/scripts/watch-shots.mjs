// Headless screenshots of the watch page (the single-file build), driven frame by frame through window.__watch.
// Usage: node apps/viewer/scripts/watch-shots.mjs [outDir] [seed]   (build first: npm -w apps/viewer run build:single)
//
// Finds moments in the game from its event log and state (a rush with a carrier, a faceoff, a line change, a shot and
// save, a goal, a board battle), and from each of the six cameras saves a sequence of frames of each moment plus a
// contact sheet per sequence; then the page at laptop and phone widths in light and dark, the frame rate at both
// qualities, and log.json (per frame: is the puck in the picture, how tall the nearest players are drawn; console
// errors; network requests; the score bug against the event log). ONLY=actions saves the stick-action sequences.
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
const prefix = process.env.PREFIX ?? ''; // e.g. PREFIX=fix1-
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
const save = (name, dataUrl) => writeFileSync(join(out, prefix + name), Buffer.from(dataUrl.split(',')[1], 'base64'));

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

// ---- Stick actions (ONLY=actions): 8-frame sequences of a wrist shot, a slapshot, a one-timer, a pass and its
// reception, and a dump, each from the follow camera (on the man doing it) and from ice level, with a contact sheet.
// The shot types are told apart here as the viewer's overlays/stick.ts tells them (from the record): a one-timer
// when he did not have the puck 8 ticks before the release; a slapshot when the release is in the top quarter of the
// game's shot speeds, he had the puck for 32 ticks and no opponent came within 3 m in that time, and it goes off
// within 0.6 rad of his facing; otherwise a wrist shot. `ACTION_SKIP` (e.g. wrist=2) takes a later example.
if (only && only.includes('actions')) {
  const skip = Object.fromEntries((process.env.ACTION_SKIP ?? '').split(',').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
  const acts = await p.evaluate((skip) => {
    const w = window.__watch, ev = w.events();
    const rel = ev.filter((e) => e.type === 'release' && e.tick > 300);
    const speeds = rel.filter((e) => e.detail.kind === 'shot').map((e) => Math.hypot(e.detail.vel.x, e.detail.vel.y)).sort((a, b) => a - b);
    const p75 = speeds[Math.floor(speeds.length * 0.75)];
    const at = (t) => { w.seekPlain(t - 1); return w.state(); }; // state() is the frame's later tick
    const offFacing = (e) => { const k = at(e.tick - 1).skaters.find((x) => x.id === e.playerId); const a = Math.atan2(e.detail.vel.y, e.detail.vel.x) - k.facing; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); };
    const had = (e, back) => { for (let t = e.tick - back; t < e.tick; t++) if (at(t).carrierId !== e.playerId) return false; return true; };
    const quiet = (e, back) => {
      for (let t = e.tick - back; t < e.tick; t++) {
        const s = at(t), me = s.skaters.find((x) => x.id === e.playerId);
        if (s.skaters.some((o) => o.onIce && o.side !== me.side && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) < 3)) return false;
      }
      return true;
    };
    const found = {}, n = { wrist: 0, slap: 0, oneTimer: 0, pass: 0, dump: 0 };
    const take = (k, e) => { if (found[k]) return; if ((n[k]++) >= (skip[k] ?? 0)) found[k] = e; };
    for (const e of rel) {
      if (e.detail.kind === 'shot') {
        const off = offFacing(e);
        if (at(e.tick - 8).carrierId !== e.playerId && off < 1) take('oneTimer', e);
        else if (Math.hypot(e.detail.vel.x, e.detail.vel.y) >= p75 && off < 0.6 && had(e, 32) && quiet(e, 32)) take('slap', e);
        else if (off < 0.8 && had(e, 20)) take('wrist', e);
      } else if (e.detail.kind === 'pass' && e.detail.toId) {
        // A pass he made with time (not a one-touch) that its receiver took.
        const later = ev.find((x) => x.tick > e.tick && (x.type === 'release' || x.type === 'turnover'));
        if (had(e, 12) && offFacing(e) < 1.2 && at(e.tick + 20).carrierId === e.detail.toId) take('pass', e);
        void later;
      } else if (e.detail.kind === 'dump' && had(e, 12)) take('dump', e);
      if (found.wrist && found.slap && found.oneTimer && found.pass && found.dump) break;
    }
    const out = {};
    for (const [k, e] of Object.entries(found)) out[k] = { tick: e.tick, who: e.playerId, to: e.detail.toId, vel: e.detail.vel };
    return out;
  }, skip);
  console.log('actions', JSON.stringify(acts));
  log.actions = acts;
  // Each: from when (ticks before the release) and how far apart (ticks) the 8 frames are.
  const plan = { wrist: [15, 3], slap: [19, 4], oneTimer: [15, 3], pass: [11, 3], receive: [-6, 3], dump: [12, 3] };
  const seqs = [];
  for (const [k, a] of Object.entries(acts)) {
    seqs.push({ name: k, who: a.who, tick: a.tick, ...{ back: plan[k][0], step: plan[k][1] } });
    if (k === 'pass' && a.to) seqs.push({ name: 'receive', who: a.to, tick: a.tick, back: plan.receive[0], step: plan.receive[1] });
  }
  for (const sq of seqs) {
    for (const camName of ['follow', 'iceLevel']) {
      const r = await p.evaluate(({ sq, camName }) => {
        const w = window.__watch;
        w.setSpeed(1);
        w.setFollow(sq.who);
        w.setCamera(camName);
        const start = sq.tick - sq.back;
        w.seek(start - 18);
        w.step(18 / 30); // the camera settles into its ease before the first frame
        // The sheet shows each frame cropped close round the man (the same crop size all through, from the first frame).
        const sheet = document.createElement('canvas');
        const c0 = document.querySelector('.stage canvas');
        const fw = 480, fh = 480;
        sheet.width = fw * 4; sheet.height = fh * 2;
        const g = sheet.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height);
        const shots = [];
        let side = 0;
        for (let i = 0; i < 8; i++) {
          if (i > 0) w.step(sq.step / 30);
          const url = w.grab();
          const f = w.figureOnScreen(sq.who);
          if (f && !side) side = Math.min(c0.height, Math.max(160, f.px * 2.6));
          const cx = f ? f.x * c0.width : c0.width / 2, cy = f ? f.y * c0.height - (f.px * 0.45) : c0.height / 2, sd = side || c0.height;
          g.drawImage(c0, cx - sd / 2, cy - sd / 2, sd, sd, (i % 4) * fw, Math.floor(i / 4) * fh, fw, fh);
          const rel = w.info().tick - sq.tick;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect((i % 4) * fw, Math.floor(i / 4) * fh, 120, 22);
          g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(`${i + 1}  T${rel >= 0 ? '+' : ''}${rel}`, (i % 4) * fw + 4, Math.floor(i / 4) * fh + 16);
          shots.push({ url, tick: w.info().tick, carrier: w.state().carrierId });
        }
        return { shots, sheet: sheet.toDataURL('image/jpeg', 0.85) };
      }, { sq, camName });
      save(`act-${sq.name}-${camName}-sheet.jpg`, r.sheet);
      r.shots.forEach((s, i) => save(`act-${sq.name}-${camName}-${i + 1}.png`, s.url));
      console.log('action', sq.name, camName, sq.who, 'release', sq.tick, 'frames', r.shots.map((s) => `${s.tick - sq.tick}:${s.carrier ?? '-'}`).join(' '));
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
    await p.screenshot({ path: join(out, prefix + name), fullPage: true });
    const scroll = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log.pages.push({ name, horizontalOverflowPx: scroll });
    if (w === 1280 && scheme === 'light') {
      await p.click('#toEnd');
      await p.waitForTimeout(400);
      await p.screenshot({ path: join(out, prefix + 'page-end.png'), fullPage: true });
    }
    await ctx.close();
  }
}

// ---- The broadcast view on a phone (390 px): how tall the players and the puck are drawn, in CSS pixels.
if (want('phone')) {
  const { ctx, p } = await open({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 2 });
  log.phone = [];
  for (const m of ['rush', 'battle', 'faceoff']) {
    const mo = moments[m]; if (!mo) continue;
    const r = await p.evaluate((mo) => {
      const w = window.__watch; w.setManual(true); w.setCamera('broadcast'); w.seek(mo.tick); w.step(1.2);
      const c = document.querySelector('.stage canvas'), k = c.clientHeight / c.height;
      const s = w.state();
      const near = s.skaters.filter((x) => x.onIce).map((x) => ({ id: x.id, d: Math.hypot(x.pos.x - s.puck.pos.x, x.pos.y - s.puck.pos.y) })).sort((a, b) => a.d - b.d)[0];
      const f = near ? w.figureOnScreen(near.id) : null;
      return { url: w.grab(), playerCssPx: f ? Math.round(f.px * k) : null, puck: w.puckOnScreen() };
    }, mo);
    save(`phone-${m}-broadcast.png`, r.url);
    await p.evaluate(() => { window.__watch.setManual(false); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(out, prefix + `page-390-${m}.png`) });
    log.phone.push({ moment: m, playerCssPx: r.playerCssPx, puck: r.puck });
  }
  console.log('phone', JSON.stringify(log.phone));
  await ctx.close();
}

// ---- A New game or a quality change that fails leaves the game on screen usable, with a plain message.
if (want('safety')) {
  const { ctx, p } = await open({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const before = await p.evaluate(() => ({ title: document.getElementById('title').textContent, total: window.__watch.info().totalTicks }));
  await p.evaluate(() => window.__watch.failNext('game'));
  await p.fill('#seed', '7');
  await p.click('#newGame');
  await p.waitForFunction(() => window.__watch.ready(), null, { timeout: 90000 });
  const afterGame = await p.evaluate(() => ({ title: document.getElementById('title').textContent, total: window.__watch.info().totalTicks,
    problem: document.getElementById('problem').hidden ? null : document.getElementById('problem').textContent,
    overlay: !document.getElementById('loading').hidden, playDisabled: document.getElementById('play').disabled }));
  await p.click('#play'); await p.waitForTimeout(1200); await p.click('#play');
  const ticked = await p.evaluate(() => window.__watch.info().tick);
  await p.evaluate(() => window.__watch.failNext('quality'));
  await p.click('[data-quality="high"]');
  await p.waitForFunction(() => window.__watch.ready(), null, { timeout: 90000 });
  const afterQuality = await p.evaluate(() => ({ quality: window.__watch.info().quality, problem: document.getElementById('problem').textContent, pressed: document.querySelector('[data-quality="low"]').getAttribute('aria-pressed') }));
  await p.screenshot({ path: join(out, prefix + 'page-failed.png'), fullPage: true });
  log.safety = { before, afterGame, tickAfterPlay: ticked, afterQuality };
  console.log('safety', JSON.stringify(log.safety));
  await ctx.close();
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
    if (q === 'high') await p.screenshot({ path: join(out, prefix + 'page-high-slow.png'), fullPage: false });
    console.log('fps', q, JSON.stringify(log.fps[q]));
    await ctx.close();
  }
}

await browser.close();
writeFileSync(join(out, prefix + 'log.json'), JSON.stringify(log, null, 1));
console.log('errors', log.errors.length, log.errors.slice(0, 10));
console.log('network', log.network.length);
console.log('pages', JSON.stringify(log.pages));
console.log('checks', JSON.stringify(log.checks.end), JSON.stringify(log.checks.result));
