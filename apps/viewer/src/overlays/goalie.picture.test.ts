import { describe, expect, it } from 'vitest';
import type { GoalieFigurePose } from '../goalie-pose';
import { seekScene } from '../scene';
import { d3, game, play, saves } from '../test/goalie-saves';

/** A seek into a save against play (npm run test:picture; moved from goalie.test.ts, unchanged). */
describe('goalie saves', () => {
  it('a seek into a save shows the pose play shows', () => {
    for (const s of [...saves(5).slice(0, 5), ...saves(42).slice(0, 5)]) {
      const g = game(s.seed), id = s.save.playerId!;
      for (const off of [-3, 0, 4]) {
        const t = Math.round(s.arrival) + off;
        let played: GoalieFigurePose | null = null;
        play(g, t - 30, t, 60, () => { played = structuredClone(g.sc.figure(id)!.goaliePose!); });
        seekScene(g.pb, g.sc, t);
        const sought = g.sc.figure(id)!.goaliePose!;
        expect(d3(sought.glove, played!.glove), `${s.seed} ${s.save.tick} ${off}`).toBeLessThan(0.05);
        expect(d3(sought.blocker, played!.blocker)).toBeLessThan(0.05);
      }
    }
  });

});
