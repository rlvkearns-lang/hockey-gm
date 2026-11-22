import type { SkaterAttrs } from './attributes';
import type { Position, Tendencies } from './types';

export type PlayerTypeDef = {
  positions: Position[];
  subTypes: string[];
  attrBias: Partial<SkaterAttrs>;
  tendencies: Tendencies;
  build: { heightCm: [number, number]; weightKg: [number, number] };
};

const t = (
  shoot: number, pass: number, carry: number, dump: number,
  hit: number, forecheck: number, netFront: number, joinRush: number,
): Tendencies => ({ shoot, pass, carry, dump, hit, forecheck, netFront, joinRush });

export const PLAYER_TYPES: Record<string, PlayerTypeDef> = {
  Sniper: {
    positions: ['LW', 'RW', 'C'],
    subTypes: ['Two-Way', 'One-Timer'],
    attrBias: { shootingAccuracy: 18, shootingPower: 12, iq: 5, poise: 5, strength: -5, bodyChecking: -10, fortitude: -5 },
    tendencies: t(0.8, 0.4, 0.5, 0.2, 0.2, 0.4, 0.4, 0.6),
    build: { heightCm: [178, 190], weightKg: [80, 92] },
  },
  Playmaker: {
    positions: ['C', 'LW', 'RW'],
    subTypes: ['Distributor', 'Setup Man'],
    attrBias: { passing: 18, vision: 18, iq: 10, puckHandling: 8, strength: -5, bodyChecking: -8, shootingPower: -5 },
    tendencies: t(0.35, 0.85, 0.5, 0.15, 0.15, 0.4, 0.2, 0.6),
    build: { heightCm: [175, 187], weightKg: [78, 90] },
  },
  'Power Forward': {
    positions: ['LW', 'RW', 'C'],
    subTypes: ['Aggressor', 'Net-Front'],
    attrBias: { strength: 18, bodyChecking: 14, fortitude: 12, balance: 8, aggression: 8, speed: -8, agility: -8, passing: -4 },
    tendencies: t(0.55, 0.3, 0.55, 0.3, 0.8, 0.75, 0.85, 0.5),
    build: { heightCm: [187, 198], weightKg: [92, 105] },
  },
  'Two-Way Forward': {
    positions: ['C', 'LW', 'RW'],
    subTypes: ['Checking Centre', 'Penalty Killer'],
    attrBias: { defensivePositioning: 14, iq: 10, faceoffs: 10, stickChecking: 8, discipline: 8, compete: 6, shootingPower: -4 },
    tendencies: t(0.4, 0.55, 0.4, 0.4, 0.4, 0.6, 0.3, 0.4),
    build: { heightCm: [180, 192], weightKg: [84, 96] },
  },
  Speedster: {
    positions: ['LW', 'RW', 'C'],
    subTypes: ['Rush Winger', 'Breakaway Threat'],
    attrBias: { speed: 18, acceleration: 18, agility: 12, puckHandling: 6, strength: -10, bodyChecking: -10, fortitude: -8 },
    tendencies: t(0.5, 0.4, 0.8, 0.2, 0.15, 0.6, 0.2, 0.85),
    build: { heightCm: [172, 184], weightKg: [74, 86] },
  },
  Grinder: {
    positions: ['LW', 'RW', 'C'],
    subTypes: ['Energy', 'Shadow'],
    attrBias: { compete: 16, stamina: 12, bodyChecking: 8, stickChecking: 8, shotBlocking: 6, shootingAccuracy: -8, shootingPower: -6, passing: -6, vision: -6 },
    tendencies: t(0.25, 0.35, 0.3, 0.6, 0.65, 0.85, 0.5, 0.3),
    build: { heightCm: [178, 192], weightKg: [84, 98] },
  },
  Enforcer: {
    positions: ['LW', 'RW'],
    subTypes: ['Heavyweight', 'Agitator'],
    attrBias: { fighting: 25, aggression: 18, strength: 14, fortitude: 12, bodyChecking: 10, discipline: -14, speed: -10, iq: -8, shootingAccuracy: -12, passing: -8 },
    tendencies: t(0.2, 0.25, 0.3, 0.5, 0.95, 0.8, 0.5, 0.2),
    build: { heightCm: [188, 200], weightKg: [95, 108] },
  },
  'Offensive Defenceman': {
    positions: ['LD', 'RD'],
    subTypes: ['Shoot-First', 'Puck-Mover'],
    attrBias: { passing: 12, vision: 10, shootingPower: 12, puckHandling: 10, shootingAccuracy: 6, defensivePositioning: -8, bodyChecking: -6, shotBlocking: -6 },
    tendencies: t(0.55, 0.65, 0.55, 0.15, 0.3, 0.4, 0.1, 0.85),
    build: { heightCm: [180, 192], weightKg: [84, 96] },
  },
  'Shutdown Defenceman': {
    positions: ['LD', 'RD'],
    subTypes: ['Stay-at-Home', 'Physical'],
    attrBias: { defensivePositioning: 18, stickChecking: 12, bodyChecking: 12, shotBlocking: 14, strength: 10, fortitude: 8, shootingAccuracy: -10, puckHandling: -8, speed: -4 },
    tendencies: t(0.15, 0.4, 0.2, 0.7, 0.7, 0.3, 0.1, 0.1),
    build: { heightCm: [187, 200], weightKg: [92, 106] },
  },
  'Two-Way Defenceman': {
    positions: ['LD', 'RD'],
    subTypes: ['Balanced', 'Transition'],
    attrBias: { iq: 8, defensivePositioning: 8, passing: 6, stickChecking: 6, poise: 6 },
    tendencies: t(0.3, 0.55, 0.35, 0.4, 0.45, 0.4, 0.1, 0.45),
    build: { heightCm: [183, 195], weightKg: [88, 100] },
  },
  Goalie: {
    positions: ['G'],
    subTypes: ['Butterfly', 'Hybrid'],
    attrBias: {},
    tendencies: t(0, 0.3, 0.1, 0.5, 0, 0, 0, 0),
    build: { heightCm: [182, 198], weightKg: [84, 102] },
  },
};
