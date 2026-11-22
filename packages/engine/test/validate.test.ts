import { describe, it, expect } from 'vitest';
import { validateSetup } from '../src/validate';
import type { GameSetup } from '../src/types';
import { validSetup } from './helpers';

type Breaker = (s: GameSetup) => void;
const cases: [string, Breaker, RegExp][] = [
  ['duplicate id', (s) => { s.home.players[1]!.id = s.home.players[0]!.id; }, /duplicate/i],
  ['line names a missing player', (s) => { s.home.lines.forwards[0]![0] = 'nobody'; }, /nobody/],
  ['attribute out of range', (s) => { s.away.players[3]!.attrs.speed = 140; }, /speed/],
  ['goalie on a forward line', (s) => { s.home.lines.forwards[0]![1] = s.home.lines.goalie; }, /goalie/i],
  ['too few forward lines', (s) => { s.home.lines.forwards.length = 2; }, /forward lines/i],
  ['same player on two lines', (s) => { s.home.lines.forwards[1]![0] = s.home.lines.forwards[0]![0]; }, /twice/i],
];

describe('validateSetup', () => {
  it.each(cases)('rejects %s', (_n, breakIt, msg) => {
    const s = validSetup();
    breakIt(s);
    expect(() => validateSetup(s)).toThrow(msg);
  });
  it('accepts a generated setup', () => {
    expect(() => validateSetup(validSetup())).not.toThrow();
  });
});
