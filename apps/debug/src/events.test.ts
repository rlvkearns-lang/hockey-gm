import { describe as suite, expect, it } from 'vitest';
import { generateTeam, type GameEvent, type PlayerDef } from '@hockey/engine';
import { describe, kindOf, listed, whenText } from './events';

const base = generateTeam(1, 'T', 'TTT').players[0]!;
const defs = new Map<string, PlayerDef>(['a', 'b', 'c'].map((id, i) => [id, { ...base, id, name: ['Ray Carver', 'Theo Ingram', 'Sam Keane'][i]! }]));
const abbr = { home: 'HBR', away: 'NPK' } as const;
const common = { tick: 0, period: 1, clock: 1093, side: 'home' as const, playerId: 'a', otherId: 'b', assistIds: [] as string[], pos: { x: 0, y: 0 } };

suite('describe', () => {
  it('reads a battle in plain words', () => {
    expect(describe({ ...common, clock: 1107, type: 'battle', detail: { how: 'netFront', contestId: 1, winnerSupportId: null, loserSupportId: null } }, defs, abbr)).toBe('18:27 1st — Net-front battle: Ray Carver (HBR) beat Theo Ingram');
  });
  it('reads a goal with assists and one without', () => {
    expect(describe({ ...common, type: 'goal', clock: 300, period: 2, assistIds: ['b', 'c'], detail: { distance: 5.7, releaseTick: 0, cross: { side: 0.3, height: 0.5 }, shotType: 'wrist', tippedFrom: null, screened: false, rebound: false } }, defs, abbr))
      .toBe('5:00 2nd — GOAL! Ray Carver (HBR) scores from 5.7 m, assisted by Theo Ingram and Sam Keane');
    expect(describe({ ...common, type: 'goal', detail: { distance: 3, releaseTick: null, cross: { side: 0.3, height: 0.5 }, shotType: 'wrist', tippedFrom: null, screened: false, rebound: false } }, defs, abbr)).toContain('unassisted');
  });
  it('reads a save, a hit and a takeaway', () => {
    expect(describe({ ...common, type: 'save', detail: { pose: 'glove', kind: 'held', cross: { side: 0.6, height: 1 } } }, defs, abbr)).toContain('Ray Carver (HBR) stopped Theo Ingram\'s shot with the glove');
    expect(describe({ ...common, type: 'hit', detail: { result: 'landed', contestId: 1, degree: 'knockdown' } }, defs, abbr)).toContain('Hit: Ray Carver (HBR) hit Theo Ingram');
    expect(describe({ ...common, type: 'takeaway', detail: { how: 'poke', atTick: 0 } }, defs, abbr)).toContain('took the puck from Theo Ingram with a poke check');
  });
  it('a trapped puck is a whistle between the two men, not a goalie covering it', () => {
    const line = describe({ ...common, type: 'freeze', detail: { cause: 'trapped' } }, defs, abbr)!;
    expect(line).toContain('trapped along the boards between Ray Carver and Theo Ingram');
    expect(line).not.toContain('covered');
    expect(describe({ ...common, type: 'freeze', detail: { cause: 'cover' } }, defs, abbr)).toContain('Ray Carver (HBR) covered the puck');
  });
  it('the puck out of play is a whistle naming where it went (Task 13)', () => {
    expect(describe({ ...common, type: 'outOfPlay', detail: { spot: { x: 6.1, y: 6.7 }, where: 'netting' } }, defs, abbr)).toContain('the puck went into the netting (last played by Ray Carver (HBR))');
  });
  it('bookkeeping events are not listed', () => {
    const rel: GameEvent = { ...common, type: 'release', detail: { kind: 'shot', toId: null, vel: { x: 30, y: 0, z: 2 }, shotType: 'slap' } };
    expect(listed(rel)).toBe(false); expect(describe(rel, defs, abbr)).toBeNull();
    expect(listed({ ...common, type: 'periodEnd', side: null, detail: { period: 1 } })).toBe(true);
  });
  it('classifies events and formats the time', () => {
    expect(kindOf({ ...common, type: 'pass', detail: { kind: 'pass', distance: 9, hand: 'forehand' } })).toBe('pass');
    expect(kindOf({ ...common, type: 'lineChange', detail: { unit: 'forwards', from: 0, to: 1, onTheFly: true, phase: 'rush' } })).toBe('lineChange');
    expect(kindOf({ ...common, type: 'goal', detail: { distance: 3, releaseTick: 0, cross: { side: 0.3, height: 0.5 }, shotType: 'wrist', tippedFrom: null, screened: false, rebound: false } })).toBe('goal');
    expect(kindOf({ ...common, type: 'hit', detail: { result: 'landed', contestId: 1, degree: 'knockdown' } })).toBe('other');
    expect(whenText({ clock: 65, period: 3 })).toBe('1:05 3rd');
  });
});
