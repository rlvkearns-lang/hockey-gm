import { describe, expect, it } from 'vitest';
import { fitGoalie, goalieKeyRaw } from '../goalie-pose';
import { seekScene } from '../scene';
import { d3, game, goalieDims, nearestPart, pathAt, play, pocketFace, PUCK_HALF, releaseOf, saves, stanceHands, world, type View } from '../test/goalie-saves';

/**
 * Saves that reach the puck, through the real scene and recorded games (seeds 5 and 42). The puck's path on a shot is
 * the engine's own: from where the `release` event let it go (at display time R - 1, the last moment he had it) along
 * the release velocity, falling under gravity, which matches the engine's puck at every tick of the flight (the shot
 * is in the air the whole way; checked below). Moments are display times (ticks, fractional).
 */

describe('goalie saves', () => {
  it('the shot path used here is the engine\'s puck at every tick of the flight', () => {
    const g = game(5);
    for (const s of saves(5).slice(0, 6)) {
      for (let k = s.rel.tick; k < s.save.tick; k++) {
        g.pb.seek(k); const st = g.pb.frame().prev, p = pathAt(s.rel, k);
        expect(Math.hypot(st.puck.pos.x - p.x, st.puck.pos.y - p.z, st.puck.z - p.y)).toBeLessThan(5e-3);
      }
    }
  });

  it('on a save the saving part is at the puck when it arrives', () => {
    // First 15 saves from shots of each seed: the part the save names (glove hand, blocker hand, nearest pad, body for
    // a butterfly) comes within 0.25 m (0.4 m for a butterfly body save) of the engine's puck on its path, at a moment
    // before the save's tick; and the drawn puck is at the part then, within the same distance.
    for (const seed of [5, 42]) {
      const list = saves(seed);
      expect(list.length).toBe(15);
      for (const s of list) {
        const lim = s.save.detail.pose === 'butterfly' ? 0.4 : 0.25;
        expect(s.dist, `seed ${seed} ${s.save.detail.pose} save at ${s.save.tick}`).toBeLessThan(lim);
        expect(s.arrival).toBeLessThanOrEqual(s.save.tick);
        expect(s.arrival).toBeGreaterThan(s.save.tick - 2.5);
        expect(s.puckGap, `seed ${seed} drawn puck at ${s.save.tick}`).toBeLessThan(lim);
      }
    }
  });

  it('the goalie starts moving toward the shot before it arrives, and is back in his stance 1.5 s after a save with no rebound shot', () => {
    let before = 0, after = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const s of saves(seed)) {
        const id = s.save.playerId!, dims = goalieDims(g.setup, id);
        const hands = (t: number): number => {
          seekScene(g.pb, g.sc, t);
          const v = g.sc.figure(id)!.goaliePose!, st = stanceHands(dims, v.catches);
          return Math.max(d3(v.glove, st.glove), d3(v.blocker, st.blocker));
        };
        expect(hands(s.arrival - 4), `seed ${seed} save at ${s.save.tick}: 4 ticks before`).toBeGreaterThan(0.08);
        before++;
        // Back in the stance: a save with no freeze, and no shot, save or cover after it within those 1.5 s.
        const end = s.arrival + 45;
        const busy = s.freeze || [g.tl.next('release', s.save.tick, end - s.save.tick), g.tl.next('save', s.save.tick, end - s.save.tick, id), g.tl.next('freeze', s.save.tick, end - s.save.tick, id)].some((x) => x && (x.type !== 'release' || x.detail.kind === 'shot'));
        if (busy) continue;
        expect(hands(end), `seed ${seed} save at ${s.save.tick}: 1.5 s after`).toBeLessThan(0.03);
        after++;
      }
    }
    expect(before).toBe(30);
    expect(after).toBeGreaterThan(6);
  });

  it('on a goal the goalie reaches and is beaten: his nearest part to the crossing point is over 0.2 m away', () => {
    // Every goal of both seeds with a release: at the moment the puck on its path crosses his plane (the upright plane
    // through his centre, square to the way he faces), no part of him (hands, pads, thighs, torso, stick paddle) is
    // within 0.2 m of it; and he did move to it (a hand or a pad moved from his stance).
    let n = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const goal of g.tl.goals) {
        const rel = releaseOf(g.tl, goal.detail.releaseTick, goal.playerId!);
        if (!rel) continue;
        const id = goal.otherId!, dims = goalieDims(g.setup, id);
        let near = Infinity, best = Infinity, reach = 0;
        play(g, rel.tick - 1, goal.tick, 240, (t) => {
          const v = g.sc.figure(id) as unknown as View, p = pathAt(rel, t);
          const fwd = Math.abs((p.x - v.position.x) * Math.cos(v.facing) + (p.z - v.position.z) * Math.sin(v.facing));
          if (fwd < best) { best = fwd; near = nearestPart(v, p); }
          const st = fitGoalie(goalieKeyRaw('stance', dims, 1), dims, v.goaliePose.catches), gp = v.goaliePose;
          reach = Math.max(reach, d3(gp.glove, st.glove), d3(gp.blocker, st.blocker), d3(gp.legs[0].ankle, st.legs[0].ankle), d3(gp.legs[1].ankle, st.legs[1].ankle));
        });
        expect(best, `seed ${seed} goal at ${goal.tick}: the path crosses his plane`).toBeLessThan(0.1);
        expect(near, `seed ${seed} goal at ${goal.tick}`).toBeGreaterThan(0.2);
        expect(reach, `seed ${seed} goal at ${goal.tick}: he reached`).toBeGreaterThan(0.1);
        n++;
      }
    }
    expect(n).toBeGreaterThan(6);
  });

  // Beyond the brief's list.
  it('a frozen glove save holds the puck in the glove until the faceoff setup, and a covered puck under him', () => {
    let glove = 0, cover = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      for (const s of saves(seed)) {
        if (!s.freeze) continue;
        const id = s.save.playerId!;
        for (const dt of [10, 30, 43]) {
          seekScene(g.pb, g.sc, s.save.tick + dt);
          const v = g.sc.figure(id) as unknown as View, p = g.sc.puckWorld();
          const gw = world(v, v.goaliePose.glove);
          // In the glove: at the open face of its pocket as the rig draws it (the puck's middle within 6 cm of the middle
          // of the pocket's face, and on its open side).
          if (s.save.detail.pose === 'glove') {
            const pk = pocketFace(g, id), mid = { x: p.x, y: p.y + PUCK_HALF, z: p.z };
            const off = { x: mid.x - pk.at.x, y: mid.y - pk.at.y, z: mid.z - pk.at.z };
            expect(d3(mid, pk.at), `seed ${seed} glove hold ${s.save.tick}+${dt}`).toBeLessThan(0.06);
            expect(off.x * pk.out.x + off.y * pk.out.y + off.z * pk.out.z).toBeGreaterThan(-0.005);
            glove++;
          }
          else if (dt === 30) { expect(Math.hypot(p.x - gw.x, p.z - gw.z), `seed ${seed} cover ${s.save.tick}`).toBeLessThan(0.15); expect(p.y).toBeLessThan(0.05); cover++; }
        }
      }
    }
    expect(glove).toBeGreaterThan(5); expect(cover).toBeGreaterThan(1);
  });

  it('in play he is drawn at the engine facing exactly; in the dead play after a held save or a goal he keeps facing the shot', () => {
    // Live play (both ticks drawn live): no turn on either goalie, so the drawn facing is the engine's.
    const g5 = game(5);
    let live = 0;
    play(g5, 3000, 3600, 30, () => {
      const f = g5.pb.frame();
      if (f.prev.phase !== 'live' || f.next.phase !== 'live') return;
      for (const side of ['home', 'away'] as const) expect(g5.sc.figure(f.next.goalies[side].id)!.goaliePose!.turn).toBeUndefined();
      live++;
    });
    expect(live).toBeGreaterThan(400);
    // Dead play: a second after a held save or a goal, he faces where the shot came from (the engine turns him to the
    // puck resting on the goal line behind him).
    let held = 0, turned = 0;
    for (const seed of [5, 42]) {
      const g = game(seed);
      const ends = [...saves(seed).filter((s) => s.freeze).map((s) => ({ tick: s.save.tick, id: s.save.playerId!, rel: s.rel })),
        ...g.tl.goals.flatMap((e) => { const rel = releaseOf(g.tl, e.detail.releaseTick, e.playerId!); return rel ? [{ tick: e.tick, id: e.otherId!, rel }] : []; })];
      for (const e of ends) {
        seekScene(g.pb, g.sc, e.tick + 30);
        if (g.pb.frame().next.phase !== 'stopped') continue;
        const v = g.sc.figure(e.id)!, drawn = v.facing + (v.goaliePose!.turn ?? 0);
        const want = Math.atan2(e.rel.pos.y - v.position.z, e.rel.pos.x - v.position.x);
        const off = (a: number) => Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)));
        expect(off(drawn), `seed ${seed} ${e.tick}`).toBeLessThan(0.05);
        if (off(v.facing) > 1) turned++;
        held++;
      }
    }
    expect(held).toBeGreaterThan(8);
    expect(turned).toBeGreaterThan(2);
  });

});

