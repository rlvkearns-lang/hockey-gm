import type { GoalieAttrs, SkaterAttrs } from './attributes';

type SkaterWeights = Partial<Record<keyof SkaterAttrs, number>>;
type SavePose = 'glove' | 'blocker' | 'pad' | 'butterfly';

/**
 * Every tunable number of the hockey logic (player brain, passes and shots, goalies, contests, fatigue), in one place
 * so calibration (scripts/calibrate.ts) can work through them group by group. Modules read these values; geometry
 * (rink lines, spots, line-ups) and the parity curve (winProb) are not tunables and live with their modules.
 */
export const TUNING = {
  /** The carrier's decision (brain.ts). */
  brain: {
    /** Shot quality falls as exp(-distance / shotDistanceScale); nothing beyond maxShotDistance (m). */
    shotDistanceScale: 9,
    maxShotDistance: 25,
    /** Base weight of each kind of option, before situation, skill and tendency. */
    weight: { shoot: 2.2, pass: 1, carry: 3, dump: 0.15, protect: 0.25 },
    /** Shoot weight is scaled by openNetWeight[0] with the goalie square, up to the sum of both with him shaded openNetShade m off. */
    openNetWeight: [0.85, 0.5] as [number, number],
    openNetShade: 0.6,
    /** Largest share any one kind of option (all passing lanes together count as one kind) may have of the draw. */
    maxShare: 0.97,
    /** Passes shorter or longer than this (m) are not considered. */
    passRange: [2.5, 35] as [number, number],
    /** A dump from his own half (behind the centre line) would be icing: its weight is scaled by this. */
    icingDump: 0.25,
    /** Carry weight is scaled by carrySpace[0] + carrySpace[1] * space ahead (0..1). */
    carrySpace: [0.25, 0.75] as [number, number],
    /** Protect weight is scaled by protectBase + pressure. */
    protectBase: 0.1,
    /** How far ahead (m) a carrier aims each carry decision outside the offensive zone, and how far he swerves. */
    carryAhead: 8,
    carrySwerve: 3,
    /** Outside the offensive zone with a teammate wholly in it, he carries no closer than this (m) to the blue line. */
    holdUpGap: 1,
    /** Shielding: he backs this far (m) away from the nearest opponent, at this fraction of top speed. */
    protectStep: 2,
    protectSpeedCap: 0.4,
  },

  /** Passes and interceptions (actions.ts). */
  pass: {
    /** Speed (m/s): base plus per point of passing. */
    speed: { base: 13, perPoint: 0.09 },
    /** Direction error (rad, one standard deviation): a floor, per point of passing below 100, and at full pressure. */
    error: { base: 0.008, perPoint: 0.0011, pressure: 0.03 },
    /** A pass stays "pending" (its receiver chases it) for its travel time plus this long (s). */
    graceSeconds: 1,
    /** An opponent this close (m) to a pass's path gets his one chance to intercept it. */
    interceptRange: 0.9,
    /** Interception chance: base + perStick * stickChecking + perPositioning * defensivePositioning, clamped to [0.03, 0.97]... */
    intercept: { base: 0.08, perStick: 0.003, perPositioning: 0.002 },
    /** ...falling linearly from full at interceptSpeed[0] m/s to half at interceptSpeed[1] and above. */
    interceptSpeed: [12, 22] as [number, number],
    /** Share of interceptions that are clean takes; the rest are deflections that leave the puck loose. */
    interceptTake: 0.6,
    /** A deflected pass keeps this share of its speed and turns by a random angle in this range (rad), either way. */
    deflectKeep: 0.35,
    deflectTurn: [0.5, 1.5] as [number, number],
  },

  /** Shots (actions.ts). */
  shot: {
    /** Speed (m/s): base plus per point of shootingPower. */
    speed: { base: 22, perPoint: 0.2 },
    /** Spread at the net (m, one standard deviation): a floor, per point of accuracy below 100, per metre out, at full pressure. */
    spread: { base: 0.1, perPoint: 0.006, perMetre: 0.008, pressure: 0.25 },
    /** Shooters aim this far (m) from the centre of the net, either side, and this high. */
    aimY: [0.35, 0.75] as [number, number],
    aimZ: [0.1, 0.8] as [number, number],
    /** Chance of aiming at the open side: 0.5, plus this per metre the goalie is shaded off centre, at most openSideMax. */
    openSidePull: 0.6,
    openSideMax: 0.8,
  },

  /** Dumps (actions.ts): to a spot this deep and wide (attack-relative m), chipped up at vz m/s; speed base + perPoint * passing. */
  dump: { spot: { x: 25.5, y: 8 }, vz: 2, speed: { base: 16, perPoint: 0.05 }, errorFactor: 1.5 },

  /** Goalies (goalie.ts). */
  goalie: {
    /** Top speed along his arc (m/s): base plus per point of lateral. */
    speed: { base: 1.5, perPoint: 0.035 },
    /** How fast he turns square to the puck (rad/s): base plus per point of positioning. */
    squareRate: { base: 2, perPoint: 0.06 },
    /** Depth out from the goal line (m): min with the puck `near` m away or closer, growing perMetre per metre, at most max. */
    depth: { min: 0.4, max: 1.3, near: 2, perMetre: 0.06 },
    /** He covers a loose puck slower than speed (m/s), within reach (m) of him and in his crease, when an opponent is within threat (m) of it. */
    cover: { speed: 3, reach: 1.0, threat: 2.5, maxZ: 0.3 },
    /**
     * Save chance, as a logistic: base, plus perReactionSecond per second the puck takes to arrive (at most 1 s
     * counted), plus perPoint per point of goalie skill over 70, less the penalties. Clamped to [0.03, 0.97].
     */
    save: {
      base: 0.4,
      perReactionSecond: 5,
      perPoint: 0.04,
      screened: 0.6,
      /** Per m/s he is still moving when the puck arrives. */
      perMovingSpeed: 0.25,
      /** Per metre the shot passes wide of his centre beyond his body's reach, and again (steeper) beyond his stretch. */
      body: 0.45, perBodyMetre: 2,
      stretch: 1, perStretchMetre: 4,
      /** Per metre the shot arrives above `highFrom` (just under the bar is hardest). */
      highFrom: 0.9, perHighMetre: 1.5,
    },
    /** Goalie skill for the save: weights of his attributes. */
    saveSkill: { reflexes: 0.35, positioning: 0.25, glove: 0.1, blocker: 0.1, lateral: 0.1, poise: 0.1 } as Partial<Record<keyof GoalieAttrs, number>>,
    /** How much of his facing error (rad) counts as extra lateral miss (m). */
    squareMissPerRad: 0.4,
    /** A save is held (frozen) with chance base + perPoint * reboundControl, by pose, clamped to [0.03, 0.97]. */
    freeze: {
      glove: { base: 0.45, perPoint: 0.004 },
      blocker: { base: 0.05, perPoint: 0.002 },
      pad: { base: 0.15, perPoint: 0.003 },
      butterfly: { base: 0.25, perPoint: 0.004 },
    } as Record<SavePose, { base: number; perPoint: number }>,
    /** Rebound speed as a share of the shot's: base less perPoint * reboundControl, within [min, max], times the pose's factor. */
    reboundSpeed: { base: 0.3, perPoint: 0.0018, min: 0.08, max: 0.4 },
    reboundPoseSpeed: { glove: 0.4, blocker: 1, pad: 1, butterfly: 0.7 } as Record<SavePose, number>,
    /** Rebound direction: angular spread (rad, one sd) of base + perPoint * (100 - reboundControl); blocker saves turn blockerTurn rad to his right, pad saves padTurn rad wide. */
    reboundSpread: { base: 0.2, perPoint: 0.008 },
    blockerTurn: 0.7,
    padTurn: 0.4,
    /** Rebounds go out at most this far (rad) off straight out from the net. */
    reboundMaxAngle: 1.35,
  },

  /** Shot blocks (goalie.ts): below maxZ (m), by a defender within path (m) of its path, more than clearOfShooter (m) from the shooter; chance base + perPoint * shotBlocking. */
  block: {
    maxZ: 1.1, path: 0.5, clearOfShooter: 1.5, base: 0.12, perPoint: 0.004,
    /** A blocked puck keeps this share of its speed, turned back by up to this spread (rad, one sd). */
    keep: [0.1, 0.3] as [number, number],
    spread: 1.2,
  },

  /** Poke checks (contests/poke-check.ts). */
  poke: {
    /** A defender this close (m) to the carrier, in front of him or beside him, pokes at the puck... */
    triggerRange: 1.6,
    /** ...where "beside" reaches this far behind square: the cosine of the angle off the carrier's facing is at least this... */
    frontCos: -0.2,
    /** ...at most once per this many seconds. */
    cooldownSeconds: 1.5,
    /** Beyond this distance (m) at the end of the reach the stick cannot get there: the contest ends with no result. */
    stickReach: 2.2,
    /** The carrier is favoured by this many rating points. */
    carrierEdge: 12,
    /** A won poke check gives the checker the puck this often; otherwise it is knocked loose. */
    takeShare: 0.5,
    /** A failed poke leaves the checker beaten (a step behind) when its roll is in this bottom share. */
    beatenChance: 0.15,
    /** A knocked-loose puck leaves at this speed range (m/s), away from the checker, plus half the carrier's velocity. */
    looseSpeed: [3, 6] as [number, number],
    looseSpread: 0.8,
    stick: { stickChecking: 0.6, defensivePositioning: 0.25, iq: 0.15 } as SkaterWeights,
    hands: { puckHandling: 0.6, poise: 0.25, balance: 0.15 } as SkaterWeights,
  },

  /** Body checks (contests/hit.ts). */
  hit: {
    /** A skater thinks about a hit on an opponent this close (m)... */
    triggerRange: 3,
    /** ...whom he is closing on faster than this (m/s)... */
    minClosing: 2,
    /** ...who has the puck or let it go less than this long ago (s)... */
    releaseWindowSeconds: 0.6,
    /** ...and makes up his mind (one draw against hitAttemptChance) at most once per this many seconds. */
    decideSeconds: 2,
    /** Target speed (m/s) assumed for his side of the momentum term, and the term's scale in rating points. */
    braceSpeed: 2,
    momentumScale: 12,
    /** A failed hit bounces the hitter off (down for a moment) when its roll is in this bottom share. */
    bounceChance: 0.1,
    hitter: { bodyChecking: 0.5, strength: 0.3, balance: 0.2 } as SkaterWeights,
    brace: { balance: 0.45, strength: 0.35, poise: 0.2 } as SkaterWeights,
  },

  /** Board battles (contests/board-battle.ts). */
  boardBattle: {
    /** Trigger: the puck this close (m) to the boards, slower than this (m/s), with a skater of each team this close (m) to it. */
    triggerBoards: 1.2,
    triggerSpeed: 6,
    triggerRange: 2,
    /** With nobody pinned, this many dig rounds without a side winning two in a row traps the puck. */
    digMaxRounds: 4,
    /** Rating points: first man in, a pinned man digging (against him), a supporting teammate; mass difference (kg) per point. */
    firstEdge: 6,
    pinnedEdge: 10,
    supportEdge: 8,
    massPerPoint: 4,
    /** A free teammate this close (m) to the spot joins as his side's support. */
    supportRange: 2.5,
    /** The winner comes away with it clean this often; otherwise it squirts along the boards at squirtSpeed m/s. */
    cleanShare: 0.6,
    squirtSpeed: [2, 4] as [number, number],
    /** Afterwards nobody in it starts another board battle for this long (s), and the loser does not poke at once. */
    cooldownSeconds: 1.5,
    loserPokeCooldown: 1,
    pin: { strength: 0.45, balance: 0.3, compete: 0.25 } as SkaterWeights,
    dig: { stickChecking: 0.35, puckHandling: 0.3, compete: 0.2, agility: 0.15 } as SkaterWeights,
  },

  /** Net-front battles (contests/net-front.ts). */
  netFront: {
    /** Trigger: an attacking forward this close (m) to his net-front spot, with a defender this close (m) to him. */
    spotRange: 1.5,
    triggerRange: 1.5,
    /** Neither may start another for this long (s) after one ends. */
    cooldownSeconds: 1,
    massPerPoint: 4,
    body: { strength: 0.4, balance: 0.3, compete: 0.3 } as SkaterWeights,
  },

  /** Loose-puck races (contests/loose-race.ts). */
  looseRace: {
    /** Trigger: a loose puck slower than this (m/s), more than this far (m) from the boards, ... */
    maxPuckSpeed: 12,
    boardsClear: 1.2,
    /** ...that each side's first man would reach within raceWindow s of the other's, both within raceHorizon s. */
    raceWindow: 0.4,
    raceHorizon: 1.5,
    /** Rating points per second of arrival-time difference. */
    edgePerSecond: 130,
    /** A roll this close to the threshold is a 50/50 bounce: nobody gets it. */
    bounceBand: 0.08,
    /** The man who won the last net-front round has this edge for the rebound. */
    reboundEdge: 10,
    /** Neither racer may start another race for this long (s). */
    cooldownSeconds: 0.8,
    race: { compete: 0.4, agility: 0.3, balance: 0.3 } as SkaterWeights,
  },

  /** Fatigue and line changes (bench.ts). */
  fatigue: {
    /**
     * Energy drain per second on the ice: fullDrain at full effort (top speed) for stamina 50, of which idleShare is
     * spent even standing still; times 1 + (50 - stamina) * staminaPerPoint.
     */
    fullDrain: 0.01,
    idleShare: 0.3,
    staminaPerPoint: 0.009,
    /** On the bench the gap to full energy keeps benchKeep of itself every benchSeconds s. */
    benchKeep: 0.2,
    benchSeconds: 90,
    /** On the ice while play is stopped, a skater recovers at this fraction of the bench rate. */
    stoppageRecovery: 0.5,
    /** A unit is due a change when its mean energy is below this. */
    tired: 0.45,
  },
};
