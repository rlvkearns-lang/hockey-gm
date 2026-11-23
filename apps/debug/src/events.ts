import type { GameEvent, PlayerDef } from '@hockey/engine';

const ORDINAL = ['', '1st', '2nd', '3rd'];

export const clockText = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** For example `18:27 1st`; `clock` is the seconds left in the period. */
export const whenText = (e: Pick<GameEvent, 'clock' | 'period'>): string => `${clockText(e.clock)} ${ORDINAL[e.period] ?? `P${e.period}`}`;

export type EventKind = 'pass' | 'lineChange' | 'goal' | 'other';
export const kindOf = (e: GameEvent): EventKind => (e.type === 'pass' || e.type === 'lineChange' || e.type === 'goal' ? e.type : 'other');

const TAKEAWAY_HOW: Record<string, string> = { poke: 'with a poke check', battle: 'in a battle' };
const TURNOVER_HOW: Record<string, string> = {
  hit: 'with a hit', poke: 'with a poke check', pokeLoose: 'knocking it loose with a poke check', battle: 'in a battle',
  battleLoose: 'in a battle, the puck squirting loose', intercepted: 'by intercepting a pass', deflected: 'by deflecting a pass',
};
const BATTLE_HOW: Record<string, string> = { protect: 'He kept the puck', pinned: 'He pinned him on the boards', stick: 'He won it with his stick', scramble: 'In the scramble' };
const SAVE_HOW: Record<string, string> = { pad: 'with the pad', glove: 'with the glove', blocker: 'with the blocker', butterfly: 'in the butterfly', stance: '' };

/** One plain-English line for an event, for people who do not read code. */
export function describe(e: GameEvent, defs: Map<string, PlayerDef>, abbr: Record<'home' | 'away', string>): string {
  const name = (id: string | null): string => (id === null ? 'someone' : defs.get(id)?.name ?? id);
  const me = `${name(e.playerId)} (${abbr[e.side]})`;
  const other = name(e.otherId);
  const metres = e.detail.endsWith('m') ? ` from ${e.detail.replace(/m$/, ' m')}` : '';
  const body = ((): string => {
    switch (e.type) {
      case 'faceoff': return `Faceoff: ${me} won the draw against ${other}`;
      case 'pass': return `${me} passed to ${other}`;
      case 'shot': return `Shot: ${me}${metres}`;
      case 'save': return `Save: ${me} stopped ${other}'s shot${SAVE_HOW[e.detail] ? ' ' + SAVE_HOW[e.detail] : ''}`;
      case 'goal': {
        const assists = e.assistIds.length === 0 ? 'unassisted' : `assisted by ${e.assistIds.map(name).join(' and ')}`;
        return `GOAL! ${me} scores${metres}, ${assists}`;
      }
      case 'miss': return `Shot wide: ${me}${metres}`;
      case 'post': return `${me} hit the post`;
      case 'block': return `${me} blocked ${other}'s shot`;
      case 'hit': return e.detail === 'absorbed' ? `Hit: ${other} took a hit from ${me} and stayed on his feet` : `Hit: ${me} hit ${other}`;
      case 'turnover': return `Turnover: ${me} won the puck off ${other}${TURNOVER_HOW[e.detail] ? ' ' + TURNOVER_HOW[e.detail] : ''}`;
      case 'takeaway': return `Takeaway: ${me} took the puck from ${other}${TAKEAWAY_HOW[e.detail] ? ' ' + TAKEAWAY_HOW[e.detail] : ''}`;
      case 'giveaway': return `Giveaway: ${me} lost the puck${e.detail === 'intercepted' ? ` (${other} picked off his pass)` : ''}`;
      case 'battle': {
        const kind = e.detail === 'netFront' ? 'Net-front battle' : 'Board battle';
        const how = BATTLE_HOW[e.detail];
        return `${kind}: ${me} beat ${other}${how ? '. ' + how : ''}`;
      }
      case 'offside': return `Offside: ${me}`;
      case 'icing': return `Icing: ${me}`;
      case 'freeze': return `Whistle: ${me} covered the puck`;
      case 'lineChange': return `${abbr[e.side]} changed ${e.detail.startsWith('defence') ? 'defence pair' : 'forward line'}`;
      case 'periodEnd': return `End of period ${e.period}`;
      default: return `${e.type} ${me}`;
    }
  })();
  return `${whenText(e)} — ${body}`;
}
