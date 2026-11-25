import type { GameEvent, PlayerDef } from '@hockey/engine';

const ORDINAL = ['', '1st', '2nd', '3rd'];

export const clockText = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** For example `18:27 1st`; `clock` is the seconds left in the period. */
export const whenText = (e: Pick<GameEvent, 'clock' | 'period'>): string => `${clockText(e.clock)} ${ORDINAL[e.period] ?? `P${e.period}`}`;

export type EventKind = 'pass' | 'lineChange' | 'goal' | 'other';
export const kindOf = (e: GameEvent): EventKind => (e.type === 'pass' || e.type === 'lineChange' || e.type === 'goal' ? e.type : 'other');

/** Bookkeeping events for a viewer's animation and director, not lines for people to read. */
const NOT_LISTED: readonly GameEvent['type'][] = ['release', 'contestStart', 'contestEnd', 'engagement'];
export const listed = (e: GameEvent): boolean => !NOT_LISTED.includes(e.type);

const TAKEAWAY_HOW = { poke: 'with a poke check', battle: 'in a battle' } as const;
const TURNOVER_HOW = {
  hit: 'with a hit', poke: 'with a poke check', pokeLoose: 'knocking it loose with a poke check', battle: 'in a battle',
  battleLoose: 'in a battle, the puck squirting loose', intercepted: 'by intercepting a pass', deflected: 'by deflecting a pass',
} as const;
const BATTLE_HOW = { protect: 'He kept the puck', pinned: 'He pinned him on the boards', stick: 'He won it with his stick', scramble: 'In the scramble', support: 'His teammate came to help', netFront: '' } as const;
const HIT_DEGREE = { knockdown: ' and put him down', stagger: ' and staggered him', bump: ' (a bump)' } as const;
const ENGAGE_HOW = { heldPosition: 'held his spot', foughtThrough: 'fought through', spunOff: 'spun off', released: 'they came apart', contest: 'it became a battle', whistle: 'the whistle went' } as const;
const OUT_WHERE = { glass: 'over the glass', netting: 'into the netting', bench: 'into a bench' } as const;
const SAVE_HOW = { pad: 'with the pad', glove: 'with the glove', blocker: 'with the blocker', butterfly: 'in the butterfly' } as const;

const metres = (d: number): string => ` from ${d.toFixed(1)} m`;

/** One plain-English line for an event, for people who do not read code (null for bookkeeping events; see `listed`). */
export function describe(e: GameEvent, defs: Map<string, PlayerDef>, abbr: Record<'home' | 'away', string>): string | null {
  const name = (id: string | null): string => (id === null ? 'someone' : defs.get(id)?.name ?? id);
  const me = `${name(e.playerId)}${e.side === null ? '' : ` (${abbr[e.side]})`}`;
  const other = name(e.otherId);
  const body = ((): string | null => {
    switch (e.type) {
      case 'faceoff': return `Faceoff: ${me} won the draw against ${other}`;
      case 'pass': return e.detail.kind === 'dump' ? `${me} dumped the puck in` : `${me} passed to ${other}`;
      case 'shot': return `Shot: ${me}${metres(e.detail.distance)}`;
      case 'save': return `Save: ${me} stopped ${other}'s shot ${SAVE_HOW[e.detail.pose]}`;
      case 'stop': return `${me} stopped the puck ${SAVE_HOW[e.detail.pose]} (${other} had let it go; no shot)`;
      case 'goal': {
        const assists = e.assistIds.length === 0 ? 'unassisted' : `assisted by ${e.assistIds.map(name).join(' and ')}`;
        return `GOAL! ${me} scores${metres(e.detail.distance)}, ${assists}`;
      }
      case 'miss': return `Shot wide: ${me}${metres(e.detail.distance)}`;
      case 'post': return `${me} hit the post`;
      case 'block': return `${me} blocked ${other}'s shot`;
      case 'tip': return `Tip: ${me} deflected ${other}'s shot`;
      case 'hit': return e.detail.result === 'absorbed' ? `Hit: ${other} took a hit from ${me} and stayed on his feet`
        : e.detail.result === 'bounced' ? `Hit: ${me} bounced off ${other}` : `Hit: ${me} hit ${other}${HIT_DEGREE[e.detail.degree ?? 'knockdown']}`;
      case 'turnover': return `Turnover: ${me} won the puck off ${other} ${TURNOVER_HOW[e.detail.how]}`;
      case 'takeaway': return `Takeaway: ${me} took the puck from ${other} ${TAKEAWAY_HOW[e.detail.how]}`;
      case 'giveaway': return `Giveaway: ${me} lost the puck (${other} picked off his pass)`;
      case 'engagement': {
        const pair = `${name(e.detail.a)} and ${name(e.detail.b)}`;
        const how = ENGAGE_HOW[e.detail.result];
        return e.playerId === null ? `${pair} battled for position (${e.detail.kind}): ${how}` : `${me} had inside position on ${other} (${e.detail.kind}): ${how}`;
      }
      case 'battle': {
        const kind = e.detail.how === 'netFront' ? 'Net-front battle' : 'Board battle';
        const how = BATTLE_HOW[e.detail.how];
        return `${kind}: ${me} beat ${other}${how ? '. ' + how : ''}`;
      }
      case 'offside': return `Offside: ${me}`;
      case 'icing': return `Icing: ${me}`;
      case 'outOfPlay': return `Whistle: the puck went ${OUT_WHERE[e.detail.where]} (last played by ${me})`;
      case 'freeze': return e.detail.cause === 'trapped'
        ? `Whistle: the puck was trapped along the boards between ${name(e.playerId)} and ${other}`
        : `Whistle: ${me} covered the puck`;
      case 'lineChange': return `${e.side === null ? '' : abbr[e.side]} changed ${e.detail.unit === 'defence' ? 'defence pair' : 'forward line'}`;
      case 'periodEnd': return `End of period ${e.detail.period}`;
      case 'release': case 'contestStart': case 'contestEnd': return null;
    }
  })();
  return body === null ? null : `${whenText(e)} — ${body}`;
}
