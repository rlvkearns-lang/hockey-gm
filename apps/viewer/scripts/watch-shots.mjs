// Headless screenshots of the watch page (the single-file build), driven frame by frame through window.__watch.
// Usage: node apps/viewer/scripts/watch-shots.mjs [outDir] [seed]   (build first: npm -w apps/viewer run build:single)
//
// Finds moments in the game from its event log and state (a rush with a carrier, a faceoff, a line change, a shot and
// save, a goal, a board battle), and from each of the six cameras saves a sequence of frames of each moment plus a
// contact sheet per sequence; then the page at laptop and phone widths in light and dark, the frame rate at both
// qualities, and log.json (per frame: is the puck in the picture, how tall the nearest players are drawn; console
// errors; network requests; the score bug against the event log). ONLY=actions saves the stick-action sequences;
// ONLY=saves the saves, blocks and goal reactions; ONLY=contact poke checks, hits and falls; ONLY=battles board battles,
// net-front battles and loose-puck races.
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

// ---- Stick actions (ONLY=actions): 8-frame sequences of a wrist shot, a snap shot, a slapshot, a one-timer, a pass
// and its reception, and a dump, each from the follow camera, ice level and the broadcast camera (side-on to play up
// and down the ice), cropped close round the man with his stick, plus a contact sheet per sequence, on a page drawn at
// twice the pixels. The examples are ones where nobody else is within 2 m of him through the action (so he is not
// hidden), told apart as the viewer's overlays/stick.ts tells them, from the record: a one-timer when he did not have
// the puck 8 ticks before the release; a snap shot when he had it under 15 ticks; a slapshot when he had it longer and
// let it go 10.5 m or further from the net; otherwise a wrist shot. `ACTION_SKIP` (e.g. wrist=2) takes a later one.
if (only && only.includes('actions')) {
  const { ctx: actx, p: ap } = await open({ viewport: { width: 1312, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 2 });
  await ap.evaluate(() => window.__watch.setManual(true));
  const skip = Object.fromEntries((process.env.ACTION_SKIP ?? '').split(',').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
  // ACTION_KINDS (e.g. slap,oneTimer) limits the actions; ACTION_COUNT examples of each (default 1), each taken only
  // where he skates along the rink (within 35 degrees of its length) so the broadcast camera sees him side-on.
  const kinds = process.env.ACTION_KINDS ? process.env.ACTION_KINDS.split(',') : ['wrist', 'snap', 'slap', 'oneTimer', 'pass', 'dump'];
  const count = Number(process.env.ACTION_COUNT ?? 1), alongOnly = Boolean(process.env.ACTION_COUNT);
  const acts = await ap.evaluate(({ skip, kinds, count, alongOnly }) => {
    const w = window.__watch, ev = w.events();
    const rel = ev.filter((e) => e.type === 'release' && e.tick > 300);
    const at = (t) => { w.seekPlain(t - 1); return w.state(); }; // state() is the frame's later tick
    const carried = (e, back) => at(e.tick - back).carrierId === e.playerId;
    const had = (e) => { let n = 0; while (n < 40 && carried(e, n + 1)) n++; return n; };
    // Nobody else within 2 m of him from 12 ticks before to 6 after, and he is on his feet.
    const clear = (e) => {
      for (let t = e.tick - 12; t <= e.tick + 6; t += 3) {
        const s = at(t), me = s.skaters.find((x) => x.id === e.playerId);
        if (!me || me.downT > 0) return false;
        if (s.skaters.some((o) => o.onIce && o.id !== me.id && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) < 2)) return false;
      }
      return true;
    };
    const found = {}, n = {};
    const full = (k) => !kinds.includes(k) || (found[k]?.length ?? 0) >= count;
    const take = (k, e) => { if (full(k)) return; n[k] = (n[k] ?? 0) + 1; if (n[k] > (skip[k] ?? 0)) (found[k] ??= []).push(e); };
    const along = (e) => { const me = at(e.tick - 6).skaters.find((x) => x.id === e.playerId); return !alongOnly || Math.abs(Math.cos(me.facing)) > Math.cos(35 * Math.PI / 180); };
    for (const e of rel) {
      const want = e.detail.kind === 'shot' ? ['wrist', 'snap', 'slap', 'oneTimer'] : e.detail.kind === 'pass' ? ['pass'] : ['dump'];
      if (want.every(full)) continue;
      if (!along(e) || !clear(e)) continue;
      if (e.detail.kind === 'shot') {
        const s = at(e.tick - 1), net = s.attackDir[e.side] * 27.13, dist = Math.hypot(net - e.pos.x, e.pos.y), h = had(e);
        take(h <= 7 ? 'oneTimer' : h < 15 ? 'snap' : dist >= 10.5 ? 'slap' : 'wrist', e);
      } else if (e.detail.kind === 'pass' && e.detail.toId) {
        if (had(e) >= 10 && at(e.tick + 25).carrierId === e.detail.toId) take('pass', e);
      } else if (e.detail.kind === 'dump' && had(e) >= 10) take('dump', e);
      if (['wrist', 'snap', 'slap', 'oneTimer', 'pass', 'dump'].every(full)) break;
    }
    const out = {};
    for (const [k, es] of Object.entries(found)) es.forEach((e, i) => { out[count > 1 ? `${k}${i + 1}` : k] = { kind: k, tick: e.tick, who: e.playerId, to: e.detail.toId }; });
    return out;
  }, { skip, kinds, count, alongOnly });
  console.log('actions', JSON.stringify(acts));
  log.actions = acts;
  // Each: from when (ticks before the release) and how far apart (ticks) the 8 frames are.
  const plan = { wrist: [15, 3], snap: [11, 2], slap: [19, 4], oneTimer: [17, 4], pass: [11, 3], receive: [-6, 3], dump: [12, 3] };
  const seqs = [];
  for (const [k, a] of Object.entries(acts)) {
    seqs.push({ name: k, who: a.who, tick: a.tick, back: plan[a.kind][0], step: plan[a.kind][1] });
    if (a.kind === 'pass' && a.to) seqs.push({ name: k.replace('pass', 'receive'), who: a.to, tick: a.tick, back: plan.receive[0], step: plan.receive[1] });
  }
  for (const sq of seqs) {
    for (const camName of ['follow', 'iceLevel', 'broadcast']) {
      const r = await ap.evaluate(({ sq, camName }) => {
        const w = window.__watch;
        w.setSpeed(1);
        w.setFollow(sq.who);
        w.setCamera(camName);
        const start = sq.tick - sq.back;
        w.seek(start - 18);
        w.step(18 / 30); // the camera settles into its ease before the first frame
        // The sheet shows each frame cropped round the man and his stick (the same crop size all through, from the
        // first frame, kept inside the picture).
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
          if (f && !side) side = Math.min(c0.width, c0.height, Math.max(200, f.px * 3.4));
          const sd = side || Math.min(c0.width, c0.height);
          const cx = Math.min(c0.width - sd / 2, Math.max(sd / 2, f ? f.x * c0.width : c0.width / 2));
          const cy = Math.min(c0.height - sd / 2, Math.max(sd / 2, f ? f.y * c0.height - f.px * 0.4 : c0.height / 2));
          g.drawImage(c0, cx - sd / 2, cy - sd / 2, sd, sd, (i % 4) * fw, Math.floor(i / 4) * fh, fw, fh);
          const rel = w.info().tick - sq.tick;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect((i % 4) * fw, Math.floor(i / 4) * fh, 120, 22);
          g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(`${i + 1}  T${rel >= 0 ? '+' : ''}${rel}`, (i % 4) * fw + 4, Math.floor(i / 4) * fh + 16);
          shots.push({ url, tick: w.info().tick, carrier: w.state().carrierId });
        }
        return { shots, sheet: sheet.toDataURL('image/jpeg', 0.88) };
      }, { sq, camName });
      save(`act-${sq.name}-${camName}-sheet.jpg`, r.sheet);
      r.shots.forEach((s, i) => save(`act-${sq.name}-${camName}-${i + 1}.png`, s.url));
      console.log('action', sq.name, camName, sq.who, 'release', sq.tick, 'frames', r.shots.map((s) => `${s.tick - sq.tick}:${s.carrier ?? '-'}`).join(' '));
    }
  }
  await actx.close();
}

// ---- Saves, blocks and goal reactions (ONLY=saves): 8-frame sequences of a glove save (held), a blocker save, a pad
// save, a butterfly save, a covered puck, a goal, a blocked shot and a goal celebration, each from a fixed camera on the
// goalie (the blocker for a block, the scorer for a celebration; window.__watch.aimAt): from behind him, from in front of
// him (the shooter's side) and from his side at ice level, plus a contact sheet per sequence, on a page drawn at twice
// the pixels. The frames are at the given offsets (ticks) from the moment the puck reaches him
// (the save's or goal's tick T; the block's T). `SAVE_SKIP` (e.g. glove=2) takes a later example, `SAVE_KINDS` limits,
// `SAVE_COUNT` takes that many of each, `SAVE_ALL` also takes saves and goals with other players near the goalie.
if (only && only.includes('saves')) {
  const { ctx: sctx, p: sp } = await open({ viewport: { width: 1312, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 2 });
  await sp.evaluate(() => window.__watch.setManual(true));
  const skip = Object.fromEntries((process.env.SAVE_SKIP ?? '').split(',').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
  const kinds = process.env.SAVE_KINDS ? process.env.SAVE_KINDS.split(',') : ['glove', 'blocker', 'pad', 'butterfly', 'cover', 'goal', 'block', 'celebrate'];
  const count = Number(process.env.SAVE_COUNT ?? 1);
  const all = Boolean(process.env.SAVE_ALL);
  const found = await sp.evaluate(({ skip, kinds, count, all }) => {
    const w = window.__watch, ev = w.events();
    const out = {}, n = {};
    // SAVE_COUNT examples of each (named glove1, glove2, ... when more than one).
    const got = {};
    const take = (k, v) => {
      if (!kinds.includes(k) || (got[k] ?? 0) >= count) return;
      n[k] = (n[k] ?? 0) + 1;
      if (n[k] > (skip[k] ?? 0)) { got[k] = (got[k] ?? 0) + 1; out[count > 1 ? `${k}${got[k]}` : k] = v; }
    };
    const shotAt = (t, g) => ev.find((e) => e.type === 'shot' && e.tick === t && e.otherId === g);
    // Nobody but the shooter within 3 m of the goalie (or of the blocker) over the last ticks before T (so he is not hidden).
    const clear = (t, id, except) => {
      for (const d of [6, 3, 1]) {
        w.seekPlain(t - d - 1); const s = w.state();
        const me = s.goalies.home.id === id ? s.goalies.home : s.goalies.away.id === id ? s.goalies.away : s.skaters.find((x) => x.id === id);
        if (!me) return false;
        if (s.skaters.some((o) => o.onIce && o.id !== id && o.id !== except && Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y) < 3)) return false;
      }
      return true;
    };
    for (const e of ev) {
      if (e.tick < 300) continue;
      if (!all && (e.type === 'save' || e.type === 'goal') && !clear(e.tick, e.type === 'save' ? e.playerId : e.otherId, e.type === 'save' ? e.otherId : e.playerId)) continue;
      if (e.type === 'block' && !clear(e.tick, e.playerId, null)) continue;
      if (e.type === 'save') {
        const shot = shotAt(e.tick, e.playerId);
        if (!shot || shot.detail.releaseTick === null) continue;
        const held = ev.some((f) => f.type === 'freeze' && f.tick === e.tick && f.detail.cause === 'save');
        const v = { tick: e.tick, goalie: e.playerId, shooter: shot.playerId, release: shot.detail.releaseTick, side: e.side, held };
        if (e.detail.pose === 'glove' && held) take('glove', v);
        else if (e.detail.pose === 'blocker' && !held) take('blocker', v);
        else if (e.detail.pose === 'pad' && !held) take('pad', v);
        else if (e.detail.pose === 'butterfly' && !held) take('butterfly', v);
        if (held && e.detail.pose !== 'glove') take('cover', v);
      } else if (e.type === 'goal' && e.detail.releaseTick !== null) {
        const v = { tick: e.tick, goalie: e.otherId, shooter: e.playerId, release: e.detail.releaseTick, side: e.side === 'home' ? 'away' : 'home' };
        take('goal', v); take('celebrate', v);
      } else if (e.type === 'block') {
        take('block', { tick: e.tick, goalie: null, blocker: e.playerId, shooter: e.otherId, release: e.detail.releaseTick });
      }
    }
    return out;
  }, { skip, kinds, count, all });
  console.log('saves', JSON.stringify(found));
  log.saves = found;
  // Offsets (ticks from T) of the 8 frames.
  const offs = {
    save: [-6, -4, -3, -2, -1.5, -1, 0, 6], held: [-8, -5, -3, -1.5, 0, 6, 20, 40], goal: [-6, -4, -2.5, -1.5, 0, 4, 12, 30],
    block: [-10, -6, -3, -2, -1, 0, 3, 12], celebrate: [0, 10, 20, 30, 45, 60, 80, 100],
  };
  for (const [name, v] of Object.entries(found)) {
    const k = name.replace(/[0-9]+$/, '');
    const o = k === 'glove' || k === 'cover' ? offs.held : k === 'goal' ? offs.goal : k === 'block' ? offs.block : k === 'celebrate' ? offs.celebrate : offs.save;
    const focus = k === 'block' ? v.blocker : k === 'celebrate' ? v.shooter : v.goalie;
    // A celebration moves about: the page's own cameras (following the scorer; broadcast; ice level) show it.
    const views = k === 'celebrate' ? ['follow', 'broadcast', 'iceLevel'] : ['behind', 'front', 'ice'];
    for (const view of views) {
      const r = await sp.evaluate(({ v, o, focus, view, k }) => {
        const w = window.__watch;
        w.setSpeed(1);
        // A fixed camera on the man (the goalie; the blocker; the scorer), set from where he is at T and the way he
        // faces then: from behind him (for a goalie, from behind his net), from in front of him (the shooter's side,
        // a little off the line so the shooter does not hide him), and from his side at ice level.
        w.seekPlain(v.tick - 1);
        const s = w.state();
        const me = s.goalies.home.id === focus ? s.goalies.home : s.goalies.away.id === focus ? s.goalies.away : s.skaters.find((x) => x.id === focus);
        // For a shot on the goalie, "in front" is back along the shot's line (toward where it was let go).
        const rel = v.goalie && v.release !== undefined ? w.events().find((e) => e.type === 'release' && e.tick === v.release && e.playerId === v.shooter) : null;
        const head = rel && k !== 'celebrate' ? Math.atan2(rel.pos.y - me.pos.y, rel.pos.x - me.pos.x) : me.facing;
        const c = Math.cos(head), n = Math.sin(head), gx = me.pos.x, gz = me.pos.y;
        const far = k === 'celebrate' ? 1.6 : 1;
        const pose = view === 'behind' ? { pos: { x: gx - c * 3.6 * far, y: 2.3 * far, z: gz - n * 3.6 * far }, look: { x: gx + c * 1.2, y: 0.7, z: gz + n * 1.2 }, fov: 46 }
          : view === 'front' ? { pos: { x: gx + c * 4.4 * far - n * 0.9, y: 2.5 * far, z: gz + n * 4.4 * far + c * 0.9 }, look: { x: gx, y: 0.7, z: gz }, fov: 38 }
          : { pos: { x: gx - n * 5 * far + c * 0.8, y: 0.45, z: gz + c * 5 * far + n * 0.8 }, look: { x: gx + c * 0.3, y: 0.65, z: gz + n * 0.3 }, fov: 34 };
        if (k === 'celebrate') { w.aimAt(null); w.setFollow(focus); w.setCamera(view); } else w.aimAt(pose);
        const start = v.tick + o[0];
        w.seek(start - 18);
        w.step(18 / 30);
        const sheet = document.createElement('canvas');
        const c0 = document.querySelector('.stage canvas');
        const fw = 480, fh = 360;
        sheet.width = fw * 4; sheet.height = fh * 2;
        const g = sheet.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height);
        const shots = [];
        let at = start;
        for (let i = 0; i < o.length; i++) {
          const t = v.tick + o[i];
          if (t > at) { w.step((t - at) / 30); at = t; }
          const url = w.grab();
          // The middle of the picture, where the camera looks.
          const sw = c0.width * 0.62, sh = sw * 0.75;
          g.drawImage(c0, (c0.width - sw) / 2, (c0.height - sh) / 2, sw, sh, (i % 4) * fw, Math.floor(i / 4) * fh, fw, fh);
          const rel = Math.round((t - v.tick) * 10) / 10;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect((i % 4) * fw, Math.floor(i / 4) * fh, 120, 22);
          g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(`${i + 1}  T${rel >= 0 ? '+' : ''}${rel}`, (i % 4) * fw + 4, Math.floor(i / 4) * fh + 16);
          shots.push({ url, tick: w.info().tick, puck: w.puckOnScreen() });
        }
        w.aimAt(null);
        return { shots, sheet: sheet.toDataURL('image/jpeg', 0.9) };
      }, { v, o, focus, view, k });
      save(`sv-${name}-${view}-sheet.jpg`, r.sheet);
      r.shots.forEach((s, i) => save(`sv-${name}-${view}-${i + 1}.png`, s.url));
      console.log('save seq', name, view, 'T', v.tick, 'frames', r.shots.map((s) => s.tick).join(' '));
    }
  }
  await sctx.close();
}

// ---- Poke checks, hits and falls (ONLY=contact): 8-frame sequences of a poke check won, a poke check beaten, a landed
// open-ice hit with a fall and get-up, a hit into the boards, an absorbed hit and a bounced hit, each from the side at ice
// level (a fixed camera square to the line between the two men, window.__watch.aimAt), the follow camera (on the
// target or the checker) and the broadcast camera, plus a contact sheet per sequence. Examples come from the event log
// with nobody else within 2.5 m of either man around the moment. `CONTACT_SKIP` (e.g. hitFall=1) takes a later one;
// `CONTACT_TICKS` (name=tick,...) takes the hits at those ticks; `CONTACT_VIEWS` limits the cameras.
if (only && only.includes('contact')) {
  const { ctx: kctx, p: kp } = await open({ viewport: { width: 1312, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 2 });
  await kp.evaluate(() => window.__watch.setManual(true));
  const skip = Object.fromEntries((process.env.CONTACT_SKIP ?? '').split(',').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
  // CONTACT_TICKS=name=tick,... names hits by their tick instead (e.g. heavyOnLight=82804), for examples chosen
  // from the players' weights and closing speeds outside the page.
  const picks = Object.fromEntries((process.env.CONTACT_TICKS ?? '').split(',').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
  const found = await kp.evaluate(({ skip, picks }) => {
    const w = window.__watch, ev = w.events(), out = {}, n = {};
    if (Object.keys(picks).length) {
      for (const [k, tick] of Object.entries(picks)) {
        const e = ev.find((x) => x.type === 'hit' && x.tick === tick);
        if (!e) continue;
        w.seekPlain(e.tick); const s = w.state(), t = s.skaters.find((x) => x.id === e.otherId), h = s.skaters.find((x) => x.id === e.playerId);
        const D = e.detail.result === 'landed' ? t.downT : e.detail.result === 'bounced' ? h.downT : 0;
        out[k] = { tick: e.tick, a: e.playerId, b: e.otherId, focus: e.detail.result === 'bounced' ? e.playerId : e.otherId, end: e.tick + Math.ceil(D * 30 - 1e-6) };
      }
      return out;
    }
    const take = (k, v) => { if (out[k]) return; n[k] = (n[k] ?? 0) + 1; if (n[k] > (skip[k] ?? 0)) out[k] = v; };
    const R = 8.53, HL = 30.48, HW = 12.955;
    const boardsGap = (x, y) => { const ax = Math.abs(x), ay = Math.abs(y), cx = HL - R, cy = HW - R; return ax > cx && ay > cy ? R - Math.hypot(ax - cx, ay - cy) : Math.min(HL - ax, HW - ay); };
    // Both men in the clear: nobody else within 2.5 m of either at these ticks.
    const clear = (ticks, a, b) => {
      for (const t of ticks) {
        w.seekPlain(t); const s = w.state();
        const A = s.skaters.find((x) => x.id === a), B = s.skaters.find((x) => x.id === b);
        if (!A || !B || !A.onIce || !B.onIce || s.phase !== 'live') return false;
        if (s.skaters.some((o) => o.onIce && o.id !== a && o.id !== b && (Math.hypot(o.pos.x - A.pos.x, o.pos.y - A.pos.y) < 2.5 || Math.hypot(o.pos.x - B.pos.x, o.pos.y - B.pos.y) < 2.5))) return false;
      }
      return true;
    };
    for (const e of ev) {
      if (e.tick < 300) continue;
      if (e.type === 'contestEnd' && e.detail.kind === 'pokeCheck') {
        const st = ev.find((f) => f.type === 'contestStart' && f.detail.contestId === e.detail.contestId);
        if (!st) continue;
        const [checker, carrier] = st.detail.participants;
        const k = e.detail.result === 'take' || e.detail.result === 'loose' ? 'pokeWon' : e.detail.result === 'beaten' ? 'pokeBeaten' : null;
        if (!k || out[k] || !clear([st.tick - 6, st.tick + 4, e.tick], checker, carrier)) continue;
        take(k, { tick: st.tick, a: checker, b: carrier, focus: checker, end: e.tick });
      } else if (e.type === 'hit') {
        const T = e.tick, hitter = e.playerId, target = e.otherId;
        w.seekPlain(T); const s = w.state(), t = s.skaters.find((x) => x.id === target), h = s.skaters.find((x) => x.id === hitter);
        if (!t || !h) continue;
        const D = e.detail.result === 'landed' ? t.downT : e.detail.result === 'bounced' ? h.downT : 0;
        const endT = T + Math.ceil(D * 30 - 1e-6);
        const near = boardsGap(t.pos.x, t.pos.y) < 2;
        const k = e.detail.result === 'landed' ? (near ? 'hitBoards' : 'hitFall') : e.detail.result;
        if (out[k] || !clear([T - 10, T, T + 6], hitter, target)) continue;
        take(k, { tick: T, a: hitter, b: target, focus: e.detail.result === 'bounced' ? hitter : target, end: endT });
      }
    }
    return out;
  }, { skip, picks });
  console.log('contact', JSON.stringify(found));
  log.contact = found;
  for (const [k, v] of Object.entries(found)) {
    const o = k.startsWith('poke') ? [-6, -2, 1, 4, 7, 10, 16, 26]
      : v.end > v.tick ? [-12, -5, -2, 1, 6, Math.round((v.end - v.tick) * 0.5), v.end - v.tick - 4, v.end - v.tick + 9]
        : [-12, -6, -3, -1, 1, 4, 10, 20];
    for (const view of (process.env.CONTACT_VIEWS ?? 'side,follow,broadcast').split(',')) {
      const r = await kp.evaluate(({ v, o, view }) => {
        const w = window.__watch;
        w.setSpeed(1);
        w.seekPlain(v.tick - 1);
        const s = w.state(), A = s.skaters.find((x) => x.id === v.a), B = s.skaters.find((x) => x.id === v.b);
        const mx = (A.pos.x + B.pos.x) / 2, mz = (A.pos.y + B.pos.y) / 2;
        const dx = B.pos.x - A.pos.x, dz = B.pos.y - A.pos.y, l = Math.hypot(dx, dz) || 1;
        // Square to the line between them, on the side nearer the middle of the rink (away from the boards).
        let nx = -dz / l, nz = dx / l;
        if ((mx + nx) ** 2 / 900 + (mz + nz) ** 2 / 169 > (mx - nx) ** 2 / 900 + (mz - nz) ** 2 / 169) { nx = -nx; nz = -nz; }
        const pose = { pos: { x: mx + nx * 6.5, y: 0.7, z: mz + nz * 6.5 }, look: { x: mx, y: 0.75, z: mz }, fov: 42 };
        if (view === 'side') w.aimAt(pose); else { w.aimAt(null); w.setFollow(v.focus); w.setCamera(view); }
        const start = v.tick + o[0];
        w.seek(start - 18);
        w.step(18 / 30);
        const sheet = document.createElement('canvas'), c0 = document.querySelector('.stage canvas');
        const fw = 480, fh = 360;
        sheet.width = fw * 4; sheet.height = fh * 2;
        const g = sheet.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height);
        const shots = [];
        let at = start;
        for (let i = 0; i < o.length; i++) {
          const t = v.tick + o[i];
          if (t > at) { w.step((t - at) / 30); at = t; }
          const url = w.grab();
          const sw = c0.width * (view === 'side' ? 0.62 : 0.8), sh = sw * 0.75;
          g.drawImage(c0, (c0.width - sw) / 2, (c0.height - sh) / 2, sw, sh, (i % 4) * fw, Math.floor(i / 4) * fh, fw, fh);
          const rel = Math.round((t - v.tick) * 10) / 10;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect((i % 4) * fw, Math.floor(i / 4) * fh, 120, 22);
          g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(`${i + 1}  T${rel >= 0 ? '+' : ''}${rel}`, (i % 4) * fw + 4, Math.floor(i / 4) * fh + 16);
          shots.push({ url, tick: w.info().tick });
        }
        w.aimAt(null);
        return { shots, sheet: sheet.toDataURL('image/jpeg', 0.9) };
      }, { v, o, view });
      save(`ct-${k}-${view}-sheet.jpg`, r.sheet);
      r.shots.forEach((s, i) => save(`ct-${k}-${view}-${i + 1}.png`, s.url));
      console.log('contact seq', k, view, 'T', v.tick, 'frames', r.shots.map((s) => s.tick).join(' '));
    }
  }
  await kctx.close();
}

// ---- Battles (ONLY=battles): 10-frame sequences of whole board battles (one of each result the log has: pinned,
// stick, support, scramble, protect), a net-front battle ending in a shot and a loose-puck race, each from ice level on
// the open-ice side (window.__watch.aimAt: for a board battle 7.5 m out from the boards square to them and 2.4 m up,
// looking at the spot), the follow camera and the broadcast camera, plus a contact sheet per sequence. Sheets are labelled with the frame
// and its time only (no names), for reading the battle from the picture. `BATTLE_IDS` (name=contestId,...) takes those
// contests; `BATTLE_SKIP` (e.g. pinned=1) a later one of a kind; `BATTLE_VIEWS` limits the cameras.
if (only && only.includes('battles')) {
  const { ctx: bctx, p: bp } = await open({ viewport: { width: 1312, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 2 });
  await bp.evaluate(() => window.__watch.setManual(true));
  const kv = (s) => Object.fromEntries((s ?? '').split(',').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
  const ids = kv(process.env.BATTLE_IDS), skip = kv(process.env.BATTLE_SKIP);
  const found = await bp.evaluate(({ ids, skip }) => {
    const w = window.__watch, ev = w.events(), out = {}, n = {};
    const starts = new Map(ev.filter((e) => e.type === 'contestStart').map((e) => [e.detail.contestId, e]));
    const R = 8.53, HL = 30.48, HW = 12.955;
    // The boards' outward normal at a point (engine x, y), as the viewer's boardsGap.
    const normal = (x, y) => {
      const ax = Math.abs(x), ay = Math.abs(y), sx = Math.sign(x) || 1, sy = Math.sign(y) || 1, cx = HL - R, cy = HW - R;
      if (ax > cx && ay > cy) { const dx = ax - cx, dy = ay - cy, d = Math.hypot(dx, dy) || 1; return { x: sx * dx / d, y: sy * dy / d }; }
      return HL - ax < HW - ay ? { x: sx, y: 0 } : { x: 0, y: sy };
    };
    const entry = (end) => {
      const st = starts.get(end.detail.contestId);
      if (!st) return null;
      return { kind: end.detail.kind, cid: end.detail.contestId, start: st.tick, end: end.tick, spot: st.pos, endSpot: end.pos, ids: st.detail.participants, n: normal(end.pos.x, end.pos.y), result: end.detail.result };
    };
    const take = (k, v) => { if (!v || out[k]) return; n[k] = (n[k] ?? 0) + 1; if (n[k] > (skip[k] ?? 0)) out[k] = v; };
    if (Object.keys(ids).length) {
      for (const [k, cid] of Object.entries(ids)) { const e = ev.find((x) => x.type === 'contestEnd' && x.detail.contestId === cid); if (e) out[k] = entry(e); }
      return out;
    }
    for (const e of ev) {
      if (e.type !== 'contestEnd' || e.tick < 300) continue;
      if (e.detail.kind === 'boardBattle') {
        const r = e.detail.result, k = r === 'protected' ? 'protect' : r;
        if (['pinned', 'stick', 'support', 'scramble', 'protect'].includes(k)) take(k, entry(e));
      } else if (e.detail.kind === 'netFront' && e.detail.result !== 'whistle' && e.detail.result !== 'abandoned') {
        const st = starts.get(e.detail.contestId);
        if (st && e.tick - st.tick > 40 && ev.some((s) => s.type === 'shot' && s.tick > e.tick - 10 && s.tick < e.tick + 30)) take('netFront', entry(e));
      } else if (e.detail.kind === 'looseRace' && e.detail.result === 'won') {
        const st = starts.get(e.detail.contestId);
        if (st && e.tick - st.tick > 20) take('race', entry(e));
      }
    }
    return out;
  }, { ids, skip });
  console.log('battles', JSON.stringify(found));
  log.battles = found;
  for (const [k, v] of Object.entries(found)) {
    const span = v.end - v.start, o = [];
    for (let i = 0; i < 10; i++) o.push(Math.round(-6 + (span + 30) * i / 9));
    for (const view of (process.env.BATTLE_VIEWS ?? 'side,follow,broadcast').split(',')) {
      const r = await bp.evaluate(({ v, o, view }) => {
        const w = window.__watch;
        w.setSpeed(1);
        w.seekPlain(v.start);
        const s = w.state();
        const ps = v.ids.map((id) => s.skaters.find((x) => x.id === id)).filter(Boolean);
        const mx = v.kind === 'boardBattle' ? v.endSpot.x : ps.reduce((a, p) => a + p.pos.x, 0) / ps.length;
        const mz = v.kind === 'boardBattle' ? v.endSpot.y : ps.reduce((a, p) => a + p.pos.y, 0) / ps.length;
        let nx, nz;
        if (v.kind === 'boardBattle') {
          // Out from the boards on the open-ice side, turned 40 degrees along them so a supporting player (2 m straight
          // out from the scrum) stands beside it in the picture rather than in front of it.
          const c = Math.cos(0.7), sn = Math.sin(0.7);
          nx = -v.n.x * c + v.n.y * sn; nz = -v.n.y * c - v.n.x * sn;
        }
        else {
          const dx = ps[1].pos.x - ps[0].pos.x, dz = ps[1].pos.y - ps[0].pos.y, l = Math.hypot(dx, dz) || 1;
          nx = -dz / l; nz = dx / l;
          if ((mx + nx) ** 2 / 900 + (mz + nz) ** 2 / 169 > (mx - nx) ** 2 / 900 + (mz - nz) ** 2 / 169) { nx = -nx; nz = -nz; }
        }
        // A little above the players' heads, so a supporting player between the camera and the scrum does not hide it.
        const pose = { pos: { x: mx + nx * 7.5, y: 2.4, z: mz + nz * 7.5 }, look: { x: mx, y: 0.55, z: mz }, fov: 40 };
        if (view === 'side') w.aimAt(pose); else { w.aimAt(null); w.setFollow(v.ids[0]); w.setCamera(view); }
        const start = v.start + o[0];
        w.seek(start - 18);
        w.step(18 / 30);
        const sheet = document.createElement('canvas'), c0 = document.querySelector('.stage canvas');
        const fw = 480, fh = 360;
        sheet.width = fw * 5; sheet.height = fh * 2;
        const g = sheet.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height);
        const shots = [];
        let at = start;
        for (let i = 0; i < o.length; i++) {
          const t = v.start + o[i];
          if (t > at) { w.step((t - at) / 30); at = t; }
          const url = w.grab();
          const sw = c0.width * (view === 'side' ? 0.62 : 0.8), sh = sw * 0.75;
          g.drawImage(c0, (c0.width - sw) / 2, (c0.height - sh) / 2, sw, sh, (i % 5) * fw, Math.floor(i / 5) * fh, fw, fh);
          const sec = ((t - v.start) / 30).toFixed(1);
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect((i % 5) * fw, Math.floor(i / 5) * fh, 96, 22);
          g.fillStyle = '#fff'; g.font = '16px sans-serif'; g.fillText(`${i + 1}  ${sec} s`, (i % 5) * fw + 4, Math.floor(i / 5) * fh + 16);
          shots.push({ url, tick: w.info().tick });
        }
        w.aimAt(null);
        return { shots, sheet: sheet.toDataURL('image/jpeg', 0.9) };
      }, { v, o, view });
      save(`bt-${k}-${view}-sheet.jpg`, r.sheet);
      r.shots.forEach((s, i) => save(`bt-${k}-${view}-${i + 1}.png`, s.url));
      console.log('battle seq', k, v.kind, v.cid, view, 'frames', r.shots.map((s) => s.tick).join(' '));
    }
  }
  await bctx.close();
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
    // FPS_TICK: start there instead (e.g. just before a board battle, to measure with one on screen).
    await p.evaluate((t) => { window.__watch.seek(t); }, Number(process.env.FPS_TICK) || (moments.rush?.tick ?? 3000));
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
