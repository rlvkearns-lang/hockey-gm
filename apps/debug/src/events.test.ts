import { describe as suite, expect, it } from 'vitest';
import { generateTeam, type GameEvent, type PlayerDef } from '@hockey/engine';
import { describe, kindOf, whenText } from './events';

const base = generateTeam(1, 'T', 'TTT').players[0]!;
const defs = new Map<string, PlayerDef>(['a', 'b', 'c'].map((id, i) => [id, { ...base, id, name: ['Ray Carver', 'Theo Ingram', 'Sam Keane'][i]! }]));
const abbr = { home: 'HBR', away: 'NPK' } as const;
const ev = (o: Partial<GameEvent>): GameEvent => ({ tick: 0, period: 1, clock: 1093, type: 'pass', side: 'home', playerId: 'a', otherId: 'b', assistIds: [], detail: '', ...o });

suite('describe', () => {
  it('reads a battle in plain words', () => {
    expect(describe(ev({ type: 'battle', detail: 'netFront', clock: 1107 }), defs, abbr)).toBe('18:27 1st — Net-front battle: Ray Carver (HBR) beat Theo Ingram');
  });
  it('reads a goal with assists and one without', () => {
    expect(describe(ev({ type: 'goal', clock: 300, period: 2, detail: '5.7m', assistIds: ['b', 'c'] }), defs, abbr)).toBe('5:00 2nd — GOAL! Ray Carver (HBR) scores from 5.7 m, assisted by Theo Ingram and Sam Keane');
    expect(describe(ev({ type: 'goal', detail: '3.0m' }), defs, abbr)).toContain('unassisted');
  });
  it('reads a save, a hit and a takeaway', () => {
    expect(describe(ev({ type: 'save', detail: 'glove' }), defs, abbr)).toContain('Ray Carver (HBR) stopped Theo Ingram\'s shot with the glove');
    expect(describe(ev({ type: 'hit', detail: 'landed' }), defs, abbr)).toContain('Hit: Ray Carver (HBR) hit Theo Ingram');
    expect(describe(ev({ type: 'takeaway', detail: 'poke' }), defs, abbr)).toContain('took the puck from Theo Ingram with a poke check');
  });
  it('classifies events and formats the time', () => {
    expect(kindOf(ev({ type: 'pass' }))).toBe('pass');
    expect(kindOf(ev({ type: 'lineChange' }))).toBe('lineChange');
    expect(kindOf(ev({ type: 'goal' }))).toBe('goal');
    expect(kindOf(ev({ type: 'hit' }))).toBe('other');
    expect(whenText({ clock: 65, period: 3 })).toBe('1:05 3rd');
  });
});
