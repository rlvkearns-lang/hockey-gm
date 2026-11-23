import { describe, expect, it } from 'vitest';
import { DT } from '@hockey/engine';
import { cameraTarget } from './cameras';
import { createCursor } from './playback';
import { battleHighlight, HIGHLIGHT_SECONDS, initialMarker, inOpenIce, MARKER_OUT, puckHidden, SCRUM_REACH, stepMarker, type MarkerBody, type MarkerMode, type MarkerState } from './puck-marker';
import { buildTimeline } from './timeline';
import { recorded, testSetup } from './test/game';

/**
 * The puck marker over a whole period (npm run test:picture; moved from puck-marker.test.ts, unchanged), and the
 * came-away-with-it highlight over a whole game.
 */
describe('the puck marker and the held puck', () => {
  it('over a period from the broadcast camera: not shown where the puck is plainly visible in open ice (but for its 0.25 s fade as it comes clear), shown on 80% of board-battle dig frames, never with Off', () => {
    const rec = recorded(5), pb = createCursor(testSetup(5), rec);
    const end = rec.events.find((e) => e.type === 'periodEnd')!.tick;
    const runs: Record<MarkerMode, MarkerState> = { on: initialMarker(), auto: initialMarker(), off: initialMarker() };
    let open = 0, openShown = 0, dig = 0, digShown = 0, offShown = 0, shown = 0, clearSince = -1, fading = 0;
    const skaters: MarkerBody[] = [], bodies: MarkerBody[] = [];
    for (let t = 1; t <= end; t++) {
      pb.seek(t);
      const st = pb.frame().prev;
      const puck = { x: st.puck.pos.x, y: st.puck.z, z: st.puck.pos.y };
      const cam = cameraTarget('broadcast', { puck, attackingRight: st.attackDir.home === 1 }).pos;
      skaters.length = 0; bodies.length = 0;
      for (const s of st.skaters) skaters.push({ x: s.pos.x, z: s.pos.y, r: 0.28, h: 1.75, on: s.onIce });
      bodies.push(...skaters);
      for (const g of [st.goalies.home, st.goalies.away]) bodies.push({ x: g.pos.x, z: g.pos.y, r: 0.45, h: 1.5, on: true });
      for (const mode of ['auto', 'off'] as const) runs[mode] = stepMarker(runs[mode], { mode, cam, puck, skaters, bodies, contests: st.contests }, DT);
      const k = runs.auto.k;
      if (k > 0) shown++;
      if (runs.off.k > 0) offShown++;
      if (inOpenIce(puck, skaters) && !puckHidden(cam, puck, bodies)) {
        if (clearSince < 0) clearSince = t;
        open++;
        // Shown only while it fades out, within MARKER_OUT of the puck coming clear.
        if (k > 0) { if ((t - clearSince) * DT <= MARKER_OUT + 1e-9) fading++; else openShown++; }
      } else clearSince = -1;
      if (st.contests.some((c) => c.kind === 'boardBattle' && c.stage === 'dig')) { dig++; if (k > 0) digShown++; }
    }
    expect(open).toBeGreaterThan(3000);
    expect(openShown).toBe(0);
    expect(fading).toBeLessThan(open * 0.1);
    expect(dig).toBeGreaterThan(300);
    expect(digShown / dig).toBeGreaterThanOrEqual(0.8);
    expect(offShown).toBe(0);
    // It is not on all the time either.
    expect(shown / end).toBeLessThan(0.5);
  });

  it('over a whole game it lights only under a man who was in the battle (its participants and supporters as the engine has them, or the man it gave the puck to), a net-front one only by its spot', () => {
    const rec = recorded(5), pb = createCursor(testSetup(5), rec), tl = buildTimeline(rec.events);
    const end = rec.totalTicks;
    // Everyone the engine ever has in each board or net-front battle (its participants, supporters joining later).
    const inIt = new Map<number, Set<string>>();
    const counts = { lit: 0, ends: 0, litEnds: new Set<number>(), byWinner: 0, byOther: 0, boardEnds: 0, netEnds: 0, litBoard: new Set<number>(), litNet: new Set<number>() };
    for (let t = 1; t <= end; t++) {
      pb.seek(t);
      const st = pb.frame().prev;
      for (const c of st.contests) {
        if (c.kind !== 'boardBattle' && c.kind !== 'netFront') continue;
        const set = inIt.get(c.id) ?? new Set<string>();
        for (const id of c.participants) set.add(id);
        inIt.set(c.id, set);
      }
      if (st.carrierId === null) continue;
      const h = battleHighlight(tl, t, st.carrierId, st, { x: st.puck.pos.x, z: st.puck.pos.y });
      if (h === 0) continue;
      counts.lit++;
      // Which battle: the latest board or net-front battle he was in that ended within the highlight's second.
      let e = tl.last('contestEnd', t, Math.ceil(HIGHLIGHT_SECONDS / DT) + 1);
      while (e && !((e.detail.kind === 'boardBattle' || e.detail.kind === 'netFront') && (inIt.get(e.detail.contestId)?.has(st.carrierId) || (e.detail.puck === 'toWinner' && e.detail.winnerId === st.carrierId)))) {
        e = tl.last('contestEnd', e.tick - 1, e.tick - 1 - (t - Math.ceil(HIGHLIGHT_SECONDS / DT) - 1));
      }
      expect(e, `${t}: lit under ${st.carrierId}, who was in no battle that ended in the last second`).toBeDefined();
      if (e!.detail.kind === 'netFront') { expect(Math.hypot(st.puck.pos.x - e!.pos.x, st.puck.pos.y - e!.pos.y)).toBeLessThanOrEqual(SCRUM_REACH); counts.litNet.add(e!.detail.contestId); }
      else counts.litBoard.add(e!.detail.contestId);
      if (e!.detail.winnerId === st.carrierId) counts.byWinner++; else counts.byOther++;
    }
    for (const e of rec.events) if (e.type === 'contestEnd' && e.tick <= end) { if (e.detail.kind === 'boardBattle') counts.boardEnds++; if (e.detail.kind === 'netFront') counts.netEnds++; }
    console.log(JSON.stringify({ litFrames: counts.lit, boardEnds: counts.boardEnds, litBoard: counts.litBoard.size, netEnds: counts.netEnds, litNet: counts.litNet.size, underWinner: counts.byWinner, underOther: counts.byOther }));
    expect(counts.litBoard.size).toBeGreaterThan(5);
  });
});
