import { describe, expect, it } from 'vitest';
import { DT } from '@hockey/engine';
import { cameraTarget } from './cameras';
import { createCursor } from './playback';
import { initialMarker, inOpenIce, MARKER_OUT, puckHidden, stepMarker, type MarkerBody, type MarkerMode, type MarkerState } from './puck-marker';
import { recorded, testSetup } from './test/game';

/** The puck marker over a whole period (npm run test:picture; moved from puck-marker.test.ts, unchanged). */
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

});
