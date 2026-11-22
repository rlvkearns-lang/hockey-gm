import type { GameEvent, GameResult, GameSetup, PlayerLine, Side, TeamLine } from './types';

const emptyLine = (id: string, toi: number): PlayerLine => ({
  id, goals: 0, assists: 0, shots: 0, hits: 0, blocks: 0, takeaways: 0, giveaways: 0, faceoffsWon: 0,
  faceoffsLost: 0, plusMinus: 0, toiSeconds: toi, battlesWon: 0, battlesLost: 0, saves: 0, shotsAgainst: 0,
});

const emptyTeam = (): TeamLine => ({ shots: 0, hits: 0, blocks: 0, faceoffsWon: 0, giveaways: 0, takeaways: 0 });

/** Box score from the event log. Players are listed home roster order, then away. */
export function buildResult(setup: GameSetup, events: GameEvent[], toi: Map<string, number>): GameResult {
  const players: PlayerLine[] = [];
  const byId = new Map<string, PlayerLine>();
  for (const side of ['home', 'away'] as const) {
    for (const p of setup[side].players) {
      const line = emptyLine(p.id, toi.get(p.id) ?? 0);
      players.push(line);
      byId.set(p.id, line);
    }
  }
  const team: Record<Side, TeamLine> = { home: emptyTeam(), away: emptyTeam() };
  const score = { home: 0, away: 0 };
  const line = (id: string | null): PlayerLine | undefined => (id === null ? undefined : byId.get(id));

  for (const e of events) {
    const me = line(e.playerId), other = line(e.otherId);
    const t = team[e.side];
    switch (e.type) {
      case 'faceoff':
        t.faceoffsWon++;
        if (me) me.faceoffsWon++;
        if (other) other.faceoffsLost++;
        break;
      case 'shot':
        t.shots++;
        if (me) me.shots++;
        break;
      case 'goal':
        score[e.side]++;
        if (me) me.goals++;
        for (const a of e.assistIds) { const al = line(a); if (al) al.assists++; }
        if (other) other.shotsAgainst++;
        if (e.onIce) {
          for (const id of e.onIce[e.side]) { const l = line(id); if (l) l.plusMinus++; }
          for (const id of e.onIce[e.side === 'home' ? 'away' : 'home']) { const l = line(id); if (l) l.plusMinus--; }
        }
        break;
      case 'save':
        if (me) { me.saves++; me.shotsAgainst++; }
        break;
      case 'hit':
        t.hits++;
        if (me) me.hits++;
        break;
      case 'block':
        t.blocks++;
        if (me) me.blocks++;
        break;
      case 'takeaway':
        t.takeaways++;
        if (me) me.takeaways++;
        break;
      case 'giveaway':
        t.giveaways++;
        if (me) me.giveaways++;
        break;
      case 'battle':
        if (me) me.battlesWon++;
        if (other) other.battlesLost++;
        break;
      default:
        break;
    }
  }
  return { score, tied: score.home === score.away, team, players, events: events.slice(), seed: setup.seed };
}
