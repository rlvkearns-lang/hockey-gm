import { describe, it, expect } from 'vitest';
import { BADGES, earnedBadges, hasBadge } from '../src/badges';
import { def, g } from './helpers';

describe('badges are earned (Task 12)', () => {
  it('by being clearly good at one thing: each at its threshold, not a point under', () => {
    expect(earnedBadges(def({ shootingPower: 88 }))).toEqual(['Heavy Slapshot']); expect(earnedBadges(def({ shootingPower: 87 }))).toEqual([]);
    expect(earnedBadges(def({ shootingAccuracy: 85, tendencies: { ...def().tendencies, shoot: 0.6 } }))).toEqual(['One-Timer']);
    expect(earnedBadges(def({ shootingAccuracy: 85, tendencies: { ...def().tendencies, shoot: 0.59 } }))).toEqual([]);
    expect(earnedBadges(def({ shootingAccuracy: 88, poise: 75 }))).toEqual(['Quick Release']);
    expect(earnedBadges(def({ puckHandling: 75, tendencies: { ...def().tendencies, netFront: 0.7 } }))).toEqual(['Net-Front Finisher']);
    expect(earnedBadges(def({ speed: 90 }))).toEqual(['Burner']); expect(earnedBadges(def({ agility: 90 }))).toEqual(['Elusive']);
    expect(earnedBadges(def({ stamina: 90 }))).toEqual(['Tireless']); expect(earnedBadges(def({ vision: 90 }))).toEqual(["Playmaker's Vision"]);
    expect(earnedBadges(def({ puckHandling: 90 }))).toEqual(['Stickhandler']);
    expect(earnedBadges(def({ passing: 85, position: 'LD' }))).toEqual(['Breakout Passer']); expect(earnedBadges(def({ passing: 85, position: 'LW' }))).toEqual([]);
    expect(earnedBadges(def({ shotBlocking: 88 }))).toEqual(['Shot Blocker']); expect(earnedBadges(def({ stickChecking: 88 }))).toEqual(['Stick Checker']);
    expect(earnedBadges(def({ bodyChecking: 88, weightKg: 95 }))).toEqual(['Big Hitter']); expect(earnedBadges(def({ bodyChecking: 88, weightKg: 94 }))).toEqual([]);
    expect(earnedBadges(def({ defensivePositioning: 90 }))).toEqual(['Shutdown']);
    expect(earnedBadges(def({ strength: 85, compete: 85 }))).toEqual(['Board Battler']);
    expect(earnedBadges(def({ strength: 88, balance: 80 }))).toEqual(['Net-Front Presence']);
    expect(earnedBadges(def({ faceoffs: 88 }))).toEqual(['Faceoff Specialist']);
    expect(earnedBadges(def({ position: 'G', goalie: { ...g(70), reboundControl: 85 } }))).toEqual(['Rebound Control']);
    expect(earnedBadges(def({ position: 'G', goalie: { ...g(70), glove: 85 } }))).toEqual(['Glove Hand']);
  });
  it('a goalie earns only goalie badges, a skater only skater badges', () => {
    expect(earnedBadges(def({ position: 'G', speed: 99, goalie: { ...g(99) } }))).toEqual(['Rebound Control', 'Glove Hand']);
    expect(earnedBadges(def({ position: 'C', goalie: g(99) }))).toEqual([]);
  });
  it('at most four, strongest first', () => {
    const star = def({ position: 'C', shootingPower: 89, speed: 99, agility: 95, vision: 91, puckHandling: 97, faceoffs: 93 });
    expect(earnedBadges(star)).toEqual(['Burner', 'Stickhandler', 'Elusive', 'Faceoff Specialist']);
  });
  it('hasBadge reads the list (none when absent)', () => {
    expect(hasBadge(def({ badges: ['Burner'] }), 'Burner')).toBe(true); expect(hasBadge(def({}), 'Burner')).toBe(false);
    expect(BADGES.length).toBe(19);
  });
});
