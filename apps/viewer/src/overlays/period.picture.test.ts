import { beforeAll, describe, expect, it } from 'vitest';
import { battleCollector, contactCollector, goalieCollector, stickCollector, type BattleStats, type ContactStats, type GoalieStats, type StickStats } from '../test/collect-period';
import { CONTACT_FRAME_BODY_BOUND, CONTACT_FRAME_BOUND } from '../test/contact-frames';
import { recorded } from '../test/game';
import { drivePeriod } from '../test/period';
import { buildTimeline } from '../timeline';
import { GOALIE_OVERLAYS } from '../animator';
import { MAX_OFFSET } from './contact';

/**
 * The whole-period measurements (npm run test:picture): ONE pass over the first period of seed 5 at 60 Hz through the
 * animator (skaters and goalies) and the body pass (test/period.ts), collecting the stick actions', contact's, the
 * battles' and the goalies' bounds together (test/collect-period.ts). Each block below was the whole-period test of
 * overlays/stick, contact, battles and goalie .test.ts; the assertions are theirs, unchanged.
 */

let stick: StickStats, contact: ContactStats, battles: BattleStats, goalie: GoalieStats;

beforeAll(() => {
  const tl = buildTimeline(recorded(5).events);
  const cs = [stickCollector(), contactCollector(), battleCollector(tl), goalieCollector()] as const;
  drivePeriod(5, (f) => { for (const c of cs) c.onFrame(f); }, { goalies: true });
  [stick, contact, battles, goalie] = [cs[0].stats, cs[1].stats, cs[2].stats, cs[3].stats];
}, 600_000);

describe('stick actions', () => {
  it('through a whole period the per-frame move of hands and blade stays under 0.35 m at 60 Hz and nothing is NaN', () => {
    const r = stick;
    expect(r.posed).toBeGreaterThan(300000);
    expect(r.active).toBeGreaterThan(20000); // frames of a skater with a stick action showing
    expect(r.bad).toBe(0);
    expect(r.worst).toBeLessThan(0.35);
    // Beyond the brief: the actions leave the hips and the skates to the gait (the scene's real-game bound is 10 cm).
    expect(r.worstBody).toBeLessThan(0.1);
    // Milestone 3 Task 4: the frames of a hit's impact and of a fall and getting up (test/contact-frames.ts, from engine
    // facts) are measured apart, against the larger bound stated for them.
    expect(r.contactFrames).toBeGreaterThan(500);
    expect(r.worstContact).toBeLessThan(CONTACT_FRAME_BOUND);
    expect(r.worstContactBody).toBeLessThan(CONTACT_FRAME_BODY_BOUND);
  });
});

describe('the whole period (seed 5, 60 Hz, the animator and the body pass)', () => {
  it('no two drawn figures overlap by more than 0.15 m at any frame of a period, and none is drawn outside the boards', () => {
    expect(contact.frames).toBeGreaterThan(80000);
    expect(contact.worstOverlap, contact.worstOverlapAt).toBeLessThan(0.15);
    expect(contact.worstThrough).toBeLessThan(0.45);
    expect(contact.worstBoards).toBeLessThan(1e-6);
  });
  it('the drawn offset never exceeds 0.35 m and returns to under 0.02 m within a second of contact ending', () => {
    expect(contact.worstOffset).toBeLessThan(MAX_OFFSET + 1e-9);
    expect(contact.lateOffset, contact.lateAt).toBeLessThan(0.02);
  });
  it('no figure\'s drawn offset changes by more than 0.08 m in one 60 Hz frame', () => {
    expect(contact.worstStep, contact.worstStepAt).toBeLessThan(0.08);
  });
  it('outside the impact and fall frames the real-game continuity bound still holds; within them no part moves more than 0.6 m in one 60 Hz frame', () => {
    const stats = contact;
    expect(stats.bad).toBe(0);
    expect(stats.contactFrames).toBeGreaterThan(1000);
    expect(stats.worstPlain, stats.worstPlainAt).toBeLessThan(0.35);
    expect(stats.worstContact).toBeLessThan(0.6);
    expect(stats.worstContact).toBeLessThan(CONTACT_FRAME_BOUND);
    expect(stats.worstBodyContact, stats.worstBodyContactAt).toBeLessThan(CONTACT_FRAME_BODY_BOUND);
    // Beyond the brief: outside them, hips and skates stay under 0.1 m a frame (overlays/stick's bound).
    expect(stats.worstBody, stats.worstBodyAt).toBeLessThan(0.1);
  });
});

const DEG = Math.PI / 180;
describe('battles through a whole period (seed 5, 60 Hz, the animator and the body pass)', () => {
  it('in the pin stage the pinner is between the pinned man and open ice, facing the boards, and lower', () => {
    expect(battles.pins.length).toBe(15);
    // Where the engine itself has the pinned man further from the boards than his pinner by more than the drawn offsets
    // can make up (two men cannot be drawn through each other), counted apart: an engine fact (see the report).
    const inverted = battles.pins.filter((p) => p.engineOrdered < -2 * 0.35 + 0.05);
    expect(inverted.length, inverted.map((p) => `${p.cid}: ${p.engineOrdered.toFixed(2)} m`).join(', ')).toBeLessThan(3);
    for (const p of battles.pins) {
      if (!inverted.includes(p)) expect.soft(p.ordered, `${p.cid} pinned nearer the boards than the pinner (m)`).toBeGreaterThan(0);
      expect.soft(p.hipGap, `${p.cid} pinner hip lower (m)`).toBeGreaterThan(0.05);
      expect.soft(p.pinnedFace, `${p.cid} pinned torso to the boards (rad)`).toBeLessThan(50 * DEG);
      expect.soft(p.pinnerFace, `${p.cid} pinner torso to the boards (rad)`).toBeLessThan(50 * DEG);
    }
  });

  it('in the dig stage both blades are within 0.5 m of the puck, and the last round winner is nearer', () => {
    expect(battles.digs.length).toBeGreaterThan(9);
    // A puck under the last round winner's skates (nearer than a blade on the ice comes) is counted apart.
    expect(battles.digs.filter((d) => d.underfoot).length).toBeLessThan(3);
    for (const d of battles.digs) {
      if (d.underfoot) continue;
      expect.soft(d.win, `${d.cid} last round winner's blade`).toBeLessThan(0.5);
      expect.soft(d.lose, `${d.cid} the other blade`).toBeLessThan(0.5);
      expect.soft(d.win, `${d.cid} winner nearer`).toBeLessThan(d.lose);
    }
  });

  it('each role is visibly different: poses of pinner and pinned differ by more than 0.3 in pose distance at mid-pin, and a supporter differs from both', () => {
    let supporters = 0;
    for (const p of battles.pins) {
      expect.soft(p.roles, `${p.cid} pinner against pinned`).toBeGreaterThan(0.3);
      for (const d of p.support) { expect.soft(d, `${p.cid} supporter against both`).toBeGreaterThan(0.3); supporters++; }
    }
    expect(supporters).toBeGreaterThan(9);
  });

  it('at resolve the winner has the puck on his blade and the overlay is gone within 1.2 s of contestEnd for every participant', () => {
    expect(battles.resolves.length).toBeGreaterThan(15);
    expect(battles.resolves.filter((r) => r.underfoot).length).toBeLessThan(3);
    for (const r of battles.resolves) if (!r.underfoot) expect.soft(r.blade, `${r.cid} (${r.how}) winner's blade from the puck (m)`).toBeLessThan(0.3);
    expect(battles.boardEnds).toBeGreaterThan(40);
    expect(battles.stuck).toEqual([]);
  });

  it('a net-front attacker faces the puck with his blade on the ice; the defender is behind him and leaning', () => {
    expect(battles.nets.length).toBe(15);
    expect(battles.nets.filter((n) => n.goalSide).length).toBeGreaterThan(7);
    for (const n of battles.nets) {
      expect.soft(n.face, `${n.cid} attacker torso to the puck (rad)`).toBeLessThan(45 * DEG);
      expect.soft(n.bladeY, `${n.cid} attacker blade height`).toBeLessThan(0.02);
      // Behind him wherever the engine has the defender on the far side of him from the puck (else beside or in front).
      if (n.goalSide) expect.soft(n.behind, `${n.cid} defender behind him (cos)`).toBeLessThan(0);
      expect.soft(n.lean, `${n.cid} defender's shoulders over toward him (m)`).toBeGreaterThan(0.25);
    }
  });

  it('a battle cut off by a whistle or a period break leaves no overlay on anyone', () => {
    expect(battles.whistles).toBeGreaterThan(4);
    expect(battles.whistleStuck).toEqual([]);
  });

  it('battle frames keep the overlap, offset and continuity bounds of Task 4', () => {
    expect(battles.battleFrames).toBeGreaterThan(20000);
    expect(battles.bad).toBe(0);
    expect(battles.worstOverlap, battles.worstOverlapAt).toBeLessThan(0.15);
    expect(battles.worstOffset).toBeLessThan(MAX_OFFSET + 1e-9);
    expect(battles.worstHands, battles.worstHandsAt).toBeLessThan(0.35);
    expect(battles.worstBody, battles.worstBodyAt).toBeLessThan(0.1);
  });
});

describe('goalie saves', () => {
  it('goalie reach never moves a hand more than 0.4 m in one 60 Hz frame and produces no NaN over a period', () => {
    expect(GOALIE_OVERLAYS.length).toBeGreaterThan(0);
    expect(goalie.frames).toBeGreaterThan(60000);
    expect(goalie.bad).toBe(0);
    expect(goalie.worst).toBeLessThan(0.4);
  });
});
