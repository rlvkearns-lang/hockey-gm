import { describe, it, expect } from 'vitest';
import { createGame } from '../src/game';
import { SetupError, validateSetup, type SetupProblem } from '../src/validate';
import type { GameSetup } from '../src/types';
import { validSetup } from './helpers';

type Breaker = (s: GameSetup) => void;
/** A setup broken in one way, the SetupError code it must give, and what its message must name. */
const cases: [string, Breaker, SetupProblem, RegExp][] = [
  ['duplicate id', (s) => { s.home.players[1]!.id = s.home.players[0]!.id; }, 'duplicate-id', /duplicate/i],
  ['line names a missing player', (s) => { s.home.lines.forwards[0]![0] = 'nobody'; }, 'bad-lines', /nobody/],
  ['attribute out of range', (s) => { s.away.players[3]!.attrs.speed = 140; }, 'bad-attribute', /speed/],
  ['a shooting hand that is not L or R', (s) => { (s.home.players[0]! as { shoots: string }).shoots = 'l'; }, 'bad-player', /shoots/],
  ['a missing shooting hand', (s) => { delete (s.home.players[0]! as { shoots?: string }).shoots; }, 'bad-player', /shoots/],
  ['a catching hand that is not L or R', (s) => { (s.home.players.find((p) => p.position === 'G')! as { catches?: string }).catches = 'X'; }, 'bad-player', /catches/],
  ['goalie on a forward line', (s) => { s.home.lines.forwards[0]![1] = s.home.lines.goalie; }, 'bad-lines', /goalie/i],
  ['too few forward lines', (s) => { s.home.lines.forwards.length = 2; }, 'bad-lines', /forward lines/i],
  ['same player on two lines', (s) => { s.home.lines.forwards[1]![0] = s.home.lines.forwards[0]![0]; }, 'bad-lines', /twice/i],
  // Final review I3: each of these used to pass validation and wreck the game.
  ['forecheck not one of the three', (s) => { (s.home.tactics as { forecheck: string }).forecheck = 'bogus'; }, 'bad-tactics', /forecheck.*bogus/],
  ['weight NaN', (s) => { s.home.players[2]!.weightKg = NaN; }, 'bad-size', /weightKg.*NaN/],
  ['weight out of range', (s) => { s.home.players[2]!.weightKg = 400; }, 'bad-size', /weightKg.*400/],
  ['height NaN', (s) => { s.away.players[2]!.heightCm = NaN; }, 'bad-size', /heightCm/],
  ['tendency NaN', (s) => { s.home.players[0]!.tendencies.shoot = NaN; }, 'bad-tendency', /tendency shoot.*NaN/],
  ['tendency of 5', (s) => { s.home.players[0]!.tendencies.pass = 5; }, 'bad-tendency', /tendency pass.*5/],
  ['tendency of 50', (s) => { s.away.players[4]!.tendencies.hit = 50; }, 'bad-tendency', /tendency hit.*50/],
  ['tendency missing', (s) => { delete (s.away.players[4]!.tendencies as Partial<GameSetup['home']['players'][0]['tendencies']>).dump; }, 'bad-tendency', /tendency dump/],
  ['form NaN', (s) => { s.home.players[5]!.form = NaN; }, 'bad-form', /form.*NaN/],
  ['morale NaN', (s) => { s.home.players[5]!.morale = NaN; }, 'bad-morale', /morale.*NaN/],
  ['fatigue NaN', (s) => { s.home.players[5]!.fatigue = NaN; }, 'bad-fatigue', /fatigue.*NaN/],
  ['zone entry not one of the three (Task 11)', (s) => { (s.home.tactics as { zoneEntry?: string }).zoneEntry = 'chip'; }, 'bad-tactics', /zoneEntry.*chip/],
  ['offence not one of the three (Task 11)', (s) => { (s.away.tactics as { offence?: string }).offence = 'trap'; }, 'bad-tactics', /offence.*trap/],
  ['defence not one of the two (Task 11)', (s) => { (s.home.tactics as { defence?: string }).defence = 'zone'; }, 'bad-tactics', /defence.*zone/],
  ['pinch not one of the three (Task 11)', (s) => { (s.home.tactics as { pinch?: string }).pinch = 'never'; }, 'bad-tactics', /pinch.*never/],
  ['shift length NaN', (s) => { s.home.tactics.shiftSeconds.forwards = NaN; }, 'bad-tactics', /shiftSeconds\.forwards/],
  ['shift length 0', (s) => { s.away.tactics.shiftSeconds.defence = 0; }, 'bad-tactics', /shiftSeconds\.defence.*0/],
  ['shift length negative', (s) => { s.away.tactics.shiftSeconds.forwards = -30; }, 'bad-tactics', /shiftSeconds\.forwards.*-30/],
  ['chemistry value NaN', (s) => { s.chemistry = [{ a: s.home.players[0]!.id, b: s.home.players[1]!.id, value: NaN }]; }, 'bad-chemistry', /value.*NaN/],
  ['chemistry not an array', (s) => { (s as { chemistry: unknown }).chemistry = undefined; }, 'bad-chemistry', /chemistry must be an array/],
  ['chemistry names an unknown player', (s) => { s.chemistry = [{ a: 'ghost', b: s.home.players[1]!.id, value: 0.5 }]; }, 'bad-chemistry', /ghost/],
  ['seed NaN', (s) => { s.seed = NaN; }, 'bad-seed', /seed.*NaN/],
  ['seed a string', (s) => { (s as { seed: unknown }).seed = '42'; }, 'bad-seed', /seed must be a finite number/],
  // Task 12: styles and badges, checked when present.
  ['a style of the other group (Task 12)', (s) => { const p = s.home.players.find((x) => x.position === 'LD')!; p.style = { primary: 'Sniper', secondary: null }; }, 'bad-style', /style.*Sniper/],
  ['a style that is not a style (Task 12)', (s) => { (s.home.players[0] as { style?: unknown }).style = { primary: 'Rover', secondary: null }; }, 'bad-style', /style.*Rover/],
  ['a secondary style of the other group (Task 12)', (s) => { s.home.players[0]!.style = { primary: 'Sniper', secondary: 'Two-Way Defenceman' }; }, 'bad-style', /secondary.*Two-Way Defenceman/],
  ['a secondary style the same as the primary (Task 12)', (s) => { s.home.players[0]!.style = { primary: 'Sniper', secondary: 'Sniper' }; }, 'bad-style', /secondary.*Sniper/],
  ['a style on a goalie (Task 12)', (s) => { s.home.players.find((x) => x.position === 'G')!.style = { primary: 'Sniper', secondary: null }; }, 'bad-style', /goalie/],
  ['an unknown badge (Task 12)', (s) => { s.home.players[0]!.badges = ['Clutch' as never]; }, 'bad-badge', /badge.*Clutch/],
  ['badges not an array (Task 12)', (s) => { (s.home.players[0] as { badges?: unknown }).badges = 'Burner'; }, 'bad-badge', /badges/],
  ['a goalie badge on a skater (Task 12)', (s) => { s.home.players.find((x) => x.position === 'C')!.badges = ['Glove Hand']; }, 'bad-badge', /Glove Hand/],
  ['a block habit of 2 (Task 12)', (s) => { s.home.players[0]!.tendencies.block = 2; }, 'bad-tendency', /tendency block.*2/],
  ['position not a position', (s) => { (s.home.players[0] as { position: string }).position = 'X'; }, 'bad-position', /position/],
];

describe('validateSetup', () => {
  it.each(cases)('rejects %s with a named error', (_n, breakIt, code, msg) => {
    const s = validSetup();
    breakIt(s);
    let err: unknown = null;
    try { validateSetup(s); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SetupError);
    expect((err as SetupError).code).toBe(code);
    expect((err as SetupError).message).toMatch(msg);
    expect(() => createGame(s)).toThrow(SetupError); // and the game refuses it before play
  });
  it('accepts a generated setup', () => {
    expect(() => validateSetup(validSetup())).not.toThrow();
  });
  it('accepts an old setup without styles, badges or a block habit, and one that sets them well (Task 12)', () => {
    const s = validSetup();
    for (const p of s.home.players) { delete p.style; delete p.badges; delete p.tendencies.block; }
    expect(() => validateSetup(s)).not.toThrow();
    const c = s.away.players.find((x) => x.position === 'C')!, g = s.away.players.find((x) => x.position === 'G')!;
    c.style = { primary: 'Power Forward', secondary: 'Sniper' }; c.badges = ['Big Hitter', 'Heavy Slapshot']; c.tendencies.block = 0.4;
    g.badges = ['Glove Hand'];
    expect(() => validateSetup(s)).not.toThrow();
  });
});
