/**
 * Badges (Task 12, design A7): traits a player has earned by being clearly good at one specific thing. Each has one
 * small effect in play (TUNING.badges, read where it acts through hasBadge); each shades an odd or a choice and decides
 * nothing (every chance it touches is clamped again). Most players have none to three; stars a few more (at most four).
 */
import type { Badge, PlayerDef, Position } from './types';

/** Every badge, in catalogue order (skaters' first, then the goalies' two). */
export const BADGES: readonly Badge[] = [
  'Heavy Slapshot', 'One-Timer', 'Quick Release', 'Net-Front Finisher', 'Burner', 'Elusive', 'Tireless',
  "Playmaker's Vision", 'Stickhandler', 'Breakout Passer', 'Shot Blocker', 'Stick Checker', 'Big Hitter', 'Shutdown',
  'Board Battler', 'Net-Front Presence', 'Faceoff Specialist', 'Rebound Control', 'Glove Hand',
];

/** The goalies' badges (only a goalie may have them). */
export const GOALIE_BADGES: readonly Badge[] = ['Rebound Control', 'Glove Hand'];

export const hasBadge = (d: PlayerDef, b: Badge): boolean => d.badges?.includes(b) ?? false;

/**
 * How a badge is earned: every requirement met (a value at or over its threshold), and the position when one is named.
 * A habit's margin counts 100 to 1 (0.1 over a habit threshold is as clear as 10 rating points).
 */
type Need = { of: (d: PlayerDef) => number; at: number; per?: number };
type Rule = { badge: Badge; needs: Need[]; positions?: Position[]; goalie?: true };

const attr = (k: keyof PlayerDef['attrs'], at: number): Need => ({ of: (d) => d.attrs[k], at });
const habit = (k: keyof PlayerDef['tendencies'], at: number): Need => ({ of: (d) => d.tendencies[k] ?? 0.5, at, per: 100 });
const goalie = (k: keyof NonNullable<PlayerDef['goalie']>, at: number): Need => ({ of: (d) => d.goalie?.[k] ?? 0, at });

const RULES: readonly Rule[] = [
  { badge: 'Heavy Slapshot', needs: [attr('shootingPower', 88)] },
  { badge: 'One-Timer', needs: [attr('shootingAccuracy', 85), habit('shoot', 0.6)] },
  { badge: 'Quick Release', needs: [attr('shootingAccuracy', 88), attr('poise', 75)] },
  { badge: 'Net-Front Finisher', needs: [habit('netFront', 0.7), attr('puckHandling', 75)] },
  { badge: 'Burner', needs: [attr('speed', 90)] },
  { badge: 'Elusive', needs: [attr('agility', 90)] },
  { badge: 'Tireless', needs: [attr('stamina', 90)] },
  { badge: "Playmaker's Vision", needs: [attr('vision', 90)] },
  { badge: 'Stickhandler', needs: [attr('puckHandling', 90)] },
  { badge: 'Breakout Passer', needs: [attr('passing', 85)], positions: ['C', 'LD', 'RD'] },
  { badge: 'Shot Blocker', needs: [attr('shotBlocking', 88)] },
  { badge: 'Stick Checker', needs: [attr('stickChecking', 88)] },
  { badge: 'Big Hitter', needs: [attr('bodyChecking', 88), { of: (d) => d.weightKg, at: 95 }] },
  { badge: 'Shutdown', needs: [attr('defensivePositioning', 90)] },
  { badge: 'Board Battler', needs: [attr('strength', 85), attr('compete', 85)] },
  { badge: 'Net-Front Presence', needs: [attr('strength', 88), attr('balance', 80)] },
  { badge: 'Faceoff Specialist', needs: [attr('faceoffs', 88)] },
  { badge: 'Rebound Control', needs: [goalie('reboundControl', 85)], goalie: true },
  { badge: 'Glove Hand', needs: [goalie('glove', 85)], goalie: true },
];

/** The most badges a player earns. */
const MAX_BADGES = 4;

/** The badges his ratings earn, at most four, strongest first (by the smallest margin over a requirement; ties in catalogue order). */
export function earnedBadges(d: PlayerDef): Badge[] {
  const isGoalie = d.position === 'G';
  const won: { badge: Badge; margin: number; i: number }[] = [];
  RULES.forEach((r, i) => {
    if ((r.goalie === true) !== isGoalie) return;
    if (r.positions && !r.positions.includes(d.position)) return;
    let margin = Infinity;
    for (const n of r.needs) margin = Math.min(margin, (n.of(d) - n.at) * (n.per ?? 1));
    if (margin >= 0) won.push({ badge: r.badge, margin, i });
  });
  won.sort((a, b) => b.margin - a.margin || a.i - b.i);
  return won.slice(0, MAX_BADGES).map((w) => w.badge);
}
