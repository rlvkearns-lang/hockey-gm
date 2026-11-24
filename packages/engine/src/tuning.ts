import type { GoalieAttrs, SkaterAttrs } from './attributes';
import type { SavePose } from './types';

type SkaterWeights = Partial<Record<keyof SkaterAttrs, number>>;
/** Read-only all the way down (tuples stay tuples). */
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** Freezes `o` and everything in it. */
function deepFreeze<T>(o: T): DeepReadonly<T> {
  if (typeof o === 'object' && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o as DeepReadonly<T>;
}

/**
 * Every tunable number of the hockey logic (player brain, passes and shots, goalies, contests, fatigue), in one place
 * so calibration (scripts/calibrate.ts) can work through them group by group. Modules read these values; geometry
 * (rink lines, spots, line-ups) and the parity curve (winProb) are not tunables and live with their modules.
 *
 * Internal and frozen: it is not part of the public surface (index.ts), and nothing can change it at run time (some
 * values are baked into module constants at import, so a change would only half take effect).
 */
export const TUNING = deepFreeze({
  /** The carrier's decision (brain.ts). */
  brain: {
    /** Shot quality falls as exp(-distance / shotDistanceScale); nothing beyond maxShotDistance (m). */
    shotDistanceScale: 9,
    maxShotDistance: 25,
    /** The shoot option's own skill factor (shooting accuracy .6, power .4): base + perPoint * rating. */
    shootSkill: { base: 0.6, perPoint: 0.008 },
    /** Calm (scales the shot's chance): 1 - pressure * (base - perPoise * poise). */
    calm: { base: 0.555, perPoise: 0.0015 },
    /** Speed cap while carrying: base + perPoint * puckHandling; in the zone he attacks (no breakaway) times inZone. */
    carrySpeed: { base: 0.86, perPoint: 0.001, inZone: 0.75 },
    /** A shot's chance is scaled by openNetWeight[0] with the goalie square, up to the sum of both with him shaded openNetShade m off. */
    openNetWeight: [0.85, 0.5] as [number, number],
    openNetShade: 0.6,
    /** A shot's chance is scaled by calm (1 at no pressure) to this power: a covered shooter looks for something else. */
    shootPressure: 3.6,
    /**
     * Largest share any one kind of option (all passing lanes together count as one kind, all carry lanes another) may
     * have of the carrier's draw in an ordinary state when another kind is on his list (options.ts chooseOption).
     */
    maxShare: 0.97,
    /** Passes shorter or longer than this (m) are not considered. */
    passRange: [2.5, 35] as [number, number],
    /** How far ahead (m) a carrier aims each carry decision outside the offensive zone. */
    carryAhead: 8,
    /** Outside the offensive zone with a teammate wholly in it, he carries no closer than this (m) to the blue line. */
    holdUpGap: 1,
    /** A teammate counts as in the zone if he will be wholly in it this many seconds from now at his speed. */
    offsideLookahead: 0.5,
    /**
     * The longer he has had the puck the more he wants to move it on: each second (TUNING.value.hold, at most holdCap)
     * adds hold * holdBoost.shoot to a shot's value and hold * holdBoost.pass to a pass's (options.ts).
     */
    holdBoost: { shoot: 0.3, pass: 2 },
    /** Shielding: he backs this far (m) away from the nearest opponent, at this fraction of top speed. */
    protectStep: 2,
    protectSpeedCap: 0.4,
  },

  /** The night (game.ts): drawn once per game. */
  night: {
    /**
     * Each team's jump: a normal shift with this standard deviation (rating points) of its contest ratings
     * only (not faceoffs, skating, passing, shooting or decisions), a small part of a 10-point talent gap.
     */
    teamJumpSd: 3,
    /** Each goalie's night (a hot or cold game): a normal shift of his save log-odds with this standard deviation. */
    goalieSd: 0.2,
  },

  /**
   * Skating (skating.ts): top speed (m/s) and acceleration (m/s^2), base plus per point of speed / acceleration.
   * Slowing down (m/s^2): glideDecel coasting, easeDecel light braking (and the deceleration he plans an arrival or a
   * turn with), brake a hard stop (base plus per point of agility). carve is the largest sideways acceleration his
   * edges hold in a turn (m/s^2, per point of agility); carveLoss the share of speed along his blades lost per radian
   * turned (as dexp(-carveLoss * turn)). backward is his backward top speed as a share of forward (per point of agility).
   */
  skating: {
    topSpeed: { base: 7.62, perPoint: 0.016 },
    accel: { base: 7.8, perPoint: 0.02 },
    glideDecel: 0.6,
    easeDecel: 2.5,
    brake: { base: 6, perPoint: 0.03 },
    carve: { base: 4.5, perPoint: 0.05 },
    carveLoss: 0.1,
    backward: { base: 0.6, perPoint: 0.0012 },
  },

  /**
   * Commitment (commit.ts). A held spot is re-issued without a trigger only after holdSeconds and once the wanted spot
   * is more than moveEnough (m) from it; a team's committed phase follows the raw one after it has differed for
   * phaseDelay (s); a loose-puck chaser hands over only to a teammate closer to the puck by more than chaserMargin (m).
   */
  commit: { holdSeconds: 0.4, moveEnough: 1.5, phaseDelay: 0.5, chaserMargin: 1 },
  /**
   * Effort (commit.ts): the share of top speed each effort wants. A positional job sprints to a spot more than
   * sprintFrom (m) away and glides within glideWithin, else skates. Below sprintMinEnergy only the puck jobs sprint.
   */
  effort: { glide: 0.55, skate: 0.8, sprint: 1, sprintFrom: 8, glideWithin: 3, sprintMinEnergy: 0.2 },
  /**
   * Jobs (jobs.ts): a man holding a job is keep (m) nearer its anchor than anyone else when the jobs are handed out
   * (keepNet for the net-front defender: the man at the net stays there rather than swapping with his partner).
   * openRadius (m): a skater getting open looks at 8 spots this far round his job's anchor (officeRadius behind the net).
   */
  jobs: { keep: 3, keepNet: 6, openRadius: 3, officeRadius: 1.2 },
  /**
   * Passing lanes (lanes.ts): a lane is open with `open` (m) of clear ice round it and no opponent within `space` (m) of
   * its end; a skater has a clear path to the net with no opponent ahead within clearPath (m) of his line to it.
   */
  lanes: { open: 1.0, space: 1.5, clearPath: 2.5 },
  /**
   * Covering a man (job-targets.ts coverSpot, "man, you, puck"): off him toward the carrier, shaded goal-side by
   * goalShade, gapNear (m) off a man near the net, looser by gapPerMetre for each metre he is beyond gapFrom (m) from it,
   * at most gapFar. A defender keeps the man he covers unless the rule's man is keepMan (m) nearer him. A lane is
   * shadowed from a cover spot within shadowReach (m) of it. `gap` (m): the net-front defender's goal-side gap.
   */
  cover: { gap: 1.2, goalShade: 0.35, gapNear: 1.5, gapFar: 5, gapFrom: 10, gapPerMetre: 0.25, keepMan: 4, shadowReach: 3 },
  /** A goalie's body (bodies.ts resolveGoalies): skaters are kept this far (m) plus their own radius from his centre. */
  goalieBody: { radius: 0.55 },
  /**
   * The carrier's option values (options.ts). An option's value is chance it works * (threat it leads to - threat here)
   * - (1 - chance) * what losing the puck here costs (the threat here plus turnoverCost * the other side's threat from
   * here). He picks by a draw weighted by exp(value / T), with temperature T = pick.base + pick.perPoint * (100 - iq) +
   * pick.pressure * pressure - pick.perPoise * poise (at least pick.min): a smart, poised player usually takes the best
   * option. A judging error of noise.persist * T stays with him for noise.readSeconds at a time while he has the puck
   * (keyed by his plan's seed; builder's addition); the option he is committed to gets `stick` more, fading to nothing
   * over holdCap seconds with the puck (Task 6: a carrier held behind the net for minutes). On a breakaway a carry that ends in a deke
   * near the net is worth `deke` of a shot from there. A pass lane under TUNING.lanes.open is
   * worth `shadowed` of an open one. `hold`: each second he has had the puck adds this much to shooting and passing and
   * takes it off carrying and protecting (at most holdCap seconds).
   * Builder's additions: `goal` scales a shot's chance to score (shotQuality * skill * goal); a habit also leans a value by
   * habitShift * (tendency - 0.5); a pass or carry that puts
   * his team offside costs `offside`; a dump from his own half (icing) costs `icing`; a rim or dump goes to his team
   * with a chance of raceBase + racePerMetre * (how much nearer his nearest teammate is than their nearest man), at
   * most raceMax.
   */
  value: {
    noise: { persist: 0.95, readSeconds: 4 },
    /** brain.ts: he carries out a pick this long (s) before he chooses again, unless his situation changes (Task 6 review). */
    lookSeconds: 0.3,
    deke: 0.6,
    /** A pass's chance falls by skill.pass per point of passing under 100, a carry's by skill.carry per point of puckHandling under 100, pressured or not. */
    skill: { pass: 0.001, carry: 0.001 },
    pick: { base: 0.017, perPoint: 0.0001, pressure: 0.003, perPoise: 0.000067, min: 0.003 },
    /**
     * The shot's value (Task 7; Task 7 review, Important 2): P(goal) * (1 - here) plus, for each thing that can follow a
     * shot that does not score (blocked, wide, held, steered to a corner, a rebound: Task 8's outcome model), its chance
     * times (its spot value - here), the same `here` as every other option (options.ts shotAfter). A shot from 11 m or
     * more gains `traffic` in its chance to score with a teammate in front of the net (job netFront within 3 m of the net
     * centre). A pass across the slot to a man whose threat is over oneTimerThreat is a one-timer pass; his first decision
     * values the shot oneTimerBonus higher.
     */
    traffic: 0.02, oneTimerThreat: 0.06, oneTimerBonus: 0.1,
    stick: 0.03, shadowed: 0.5, turnoverCost: 0.6, hold: 0.002, holdCap: 10,
    goal: 0.13, habitShift: 0.03, offside: 0.03, icing: 0.05, raceBase: 0.35, racePerMetre: 0.06, raceMax: 0.85,
  },

  /**
   * The weights inside the carrier's option values (options.ts), each a chance or a worth (Task 5; moved here in the
   * Task 5 review fixes). threat(rx, ly) = threat.base + threat.ice * r^2 + threat.shot * shot quality, with r = (rx + 30)
   * / 60 in [0, 1]. A spot within openAt.from (m) of an opponent is worth openAt.min of itself, rising to 1 over openAt.over
   * (m) more. A pass works with chance pass.base - pass.perMetre per metre over pass.from - pressure * (pass.pressure -
   * pass.pressurePerPoint * passing), times pass.settleMin rising to 1 over his first pass.settle (s) with the puck,
   * times pass.narrowFactor under pass.narrow (m) of lane, times pass.crowded + space / pass.crowdedPer with an opponent
   * within TUNING.lanes.space of the receiver, times pass.hand for how he must play it (Task 6: a backhand or a pass
   * behind him goes wider); a pass across the front adds V.goal * pass.across * his shot quality *
   * (sideways metres / pass.acrossFull, at most 1). A carry works with carry.base - pressure * (carry.pressure -
   * carry.pressurePerPoint * puckHandling), less laneCost * (laneFrom - lane) / laneFrom under laneFrom (m) of lane. Behind
   * the net the hold works with hold.base - pressure * hold.pressure and keeps hold.keep of his best pass out front; a
   * wrap works with wrap.base - pressure * wrap.pressure - wrap.laneCost per metre of lane under wrap.laneFrom, and
   * scores with V.goal * wrap.goal * (the goalie's distance from the post / wrap.open, 0.1 to 1) * skill. Protect keeps it
   * with protect.base - pressure * (protect.loss - protect.lossPerPoint * (puckHandling, strength)) and costs protect.idle
   * unpressured; a clear costs clearIdle unpressured. A rim to nobody gets blindRim of its race chance. A shot through a
   * lane under shotLane (m) has shotBlocked of its chance; score effects act on a shot at scoreSoft of their size.
   */
  options: {
    threat: { base: 0.005, ice: 0.035, shot: 0.15 },
    openAt: { min: 0.6, from: 1, over: 4 },
    pass: {
      base: 0.97, perMetre: 0.006, from: 12, pressure: 0.3, pressurePerPoint: 0.002, settle: 1, settleMin: 0.9,
      narrow: 0.5, narrowFactor: 0.2, crowded: 0.5, crowdedPer: 3, across: 0.6, acrossFull: 6,
      hand: { forehand: 1, backhand: 0.85, behind: 0.65 },
      /** A covered lane (passing.ts PassPlan.cover, 0 to 1) takes sqrt(cover) * (cover - coverPerPoint * passing) off the chance. */
      cover: 1.0, coverPerPoint: 0.005,
      /**
       * A contested catch (PassPlan.contest, 0 to 1) takes contest * `contest` off the chance (beyond its receive chance).
       * Task 7 review: set from play (seeds 1-4 after the slow-pass fix: a fully contested pass completes 0.56 against 0.79
       * open, a cost of 0.3); it was 0.9.
       */
      contest: 0.3,
    },
    carry: { base: 0.95, pressure: 0.35, pressurePerPoint: 0.002, laneFrom: 2.5, laneCost: 0.5 },
    hold: { base: 0.97, pressure: 0.1, keep: 0.9 },
    wrap: { base: 0.9, pressure: 0.2, laneFrom: 1.5, laneCost: 0.3, goal: 0.55, open: 1.2 },
    protect: { base: 0.97, loss: 0.4, lossPerPoint: 0.0025, idle: 0.01 },
    clearIdle: 0.04,
    blindRim: 0.6,
    shotLane: [0.5, 1.0] as [number, number],
    shotBlocked: [0.3, 0.6] as [number, number],
    scoreSoft: 0.5,
  },

  /**
   * Score effects (team-play.ts scoreMargin, brain, poke checks), kept to real-hockey size. A margin is comfortable from
   * `lead` goals, or `lateLead` in the third period. The team comfortably ahead shoots at leaderShoot of normal and
   * presses and pokes at sitBack of normal; the team comfortably behind shoots at trailerShoot; a team down by one in
   * the third shoots up to 1 + latePush as the period runs out. The shoot factor never passes maxShoot.
   */
  scoreEffects: { lead: 3, lateLead: 2, leaderShoot: 0.85, sitBack: 0.85, trailerShoot: 1.2, latePush: 0.25, maxShoot: 1.3 },

  /** Passes and interceptions (actions.ts). */
  pass: {
    /** Speed (m/s): base plus per point of passing. */
    speed: { base: 13, perPoint: 0.09 },
    /** Direction error (rad, one standard deviation): a floor, per point of passing below 100, and at full pressure. */
    error: { base: 0.032, perPoint: 0.0003, pressure: 0.03 },
    /** A pass stays "pending" (its receiver chases it) for its travel time plus this long (s). */
    graceSeconds: 1,
    /** An opponent this close (m) to a pass's path gets his one chance to intercept it. */
    interceptRange: 0.9,
    /** Interception chance: base + perStick * stickChecking + perPositioning * defensivePositioning... */
    intercept: { base: 0.206, perStick: 0.002, perPositioning: 0.0012 },
    /** ...falling linearly from full at interceptSpeed[0] m/s to half at interceptSpeed[1] and above, then clamped to [0.03, 0.97]. */
    interceptSpeed: [12, 22] as [number, number],
    /** Below interceptSpeed[0] the chance rises linearly to slowFactor times as much for a dead puck (Task 7 review). */
    slowFactor: 1.5,
    /** Opponents this close (m) to the passer as he lets it go get no interception try at it (their pressure is in its error). */
    clearOfPasser: 1.5,
    /** Share of interceptions that are clean takes; the rest are deflections that leave the puck loose. */
    interceptTake: 0.6,
    /** A deflected pass keeps this share of its speed and turns by a random angle in this range (rad), either way. */
    deflectKeep: 0.35,
    deflectTurn: [0.5, 1.5] as [number, number],
    /**
     * passing.ts (Task 6). An opponent closes a lane when his distance to the pass's path less stickReach (m), skated at
     * 4 m/s, gets him there before the puck. His blade within stickLane (m) of the path tries with interceptChance times
     * stickFactor. No pass arrives faster than maxReceiveSpeed (m/s). A point man is aimed no nearer the blue line than
     * pointInside (m). A backhand goes at `speed` of a forehand's weight with `error` times its direction error, no
     * further than `range` (m); so does a pass behind him.
     */
    stickReach: 1.2,
    stickLane: 0.75,
    stickFactor: 1.5,
    /** A man reaching into a covered lane (passing.ts laneReach) tries with interceptChance times reach times his reach (0 to 1). */
    reach: 0.5,
    /**
     * A catch contested by an opponent on the receiver (passing.ts receiverContest: within stickReach plus what he can
     * close as it travels, fading over contestRange m beyond) loses up to `contested` of the receive chance.
     */
    contested: 0.1,
    contestRange: 1.5,
    maxReceiveSpeed: 16,
    pointInside: 1.5,
    backhand: { speed: 0.75, error: 1.6, range: 15 },
    behind: { speed: 0.6, error: 2.2, range: 8 },
  },

  /**
   * The stick blade (blade.ts, Task 6): forward (m) ahead of his centre along his facing and side (m) to his shooting
   * side. A loose puck is picked up with the blade within pickupReach (m) of it.
   */
  blade: { forward: 0.9, side: 0.4, pickupReach: 0.75 },

  /** Shots (actions.ts). */
  shot: {
    /** Speed (m/s): base plus per point of shootingPower. */
    speed: { base: 29, perPoint: 0.1 },
    /** Spread at the net (m, one standard deviation): a floor, per point of accuracy below 100, per metre out, at full pressure. */
    spread: { base: 0.15, perPoint: 0.0025, perMetre: 0.006, pressure: 0.2 },
    /**
     * A wild shot (mishit or rushed) misses the net outright: chance base + perPoint per point of accuracy below 100 +
     * pressure at full pressure + perMetre per metre out, clamped to [0.03, 0.97]. It goes `clear` m plus a half-normal
     * `spread` m wide of the post on his aiming side, or (highShare of them) that far over the bar.
     */
    wild: { base: 0.06, perPoint: 0.002, pressure: 0.15, perMetre: 0.004, clear: 0.12, spread: 0.6, highShare: 0.3 },
    /** Shooters aim this far (m) from the centre of the net, either side, and this high. */
    aimY: [0.3, 0.65] as [number, number],
    aimZ: [0.1, 0.8] as [number, number],
    /** The aim's distance from the middle is scaled by base + perPoint * shootingAccuracy. */
    aimReach: { base: 0.4, perPoint: 0.006 },
    /** Chance of aiming at the open side: 0.5, plus this per metre the goalie is shaded off centre, at most openSideMax. */
    openSidePull: 0.6,
    openSideMax: 0.8,
    /**
     * Shot types (Task 7, actions.ts executeShot): speed and spread (sigma) multipliers. A wraparound goes `speed` m/s
     * along the ice at the near post. A slapshot is taken from slapFrom m or more under slapPressure; a one-timer within
     * oneTimerTicks of taking a one-timer pass; a wraparound within wrapPost m of a post off a wrap.
     */
    types: {
      slap: { speed: 1.12, spread: 1.15 },
      oneTimer: { speed: 1.05, spread: 1.25 },
      backhand: { speed: 0.75, spread: 1.4 },
      wraparound: { speed: 9 },
      slapFrom: 11, slapPressure: 0.3, oneTimerTicks: 2, wrapPost: 1.2,
      /**
       * A shooter turns his body up to setTurn rad per metre out toward his forehand as he winds up (Task 8: a
       * backhand is a shot in tight with the net off his forehand, or with it well behind him).
       */
      setTurn: (10 * Math.PI) / 180,
    },
  },

  /**
   * Rims and clears (actions.ts executeRim, executeClear). A rim goes at speed.base + perPoint * passing (16 to 20 m/s),
   * aimed at the boards `ahead` m along his line to its target (a man, or with nobody named the far low corner, `back`
   * m out from the goal line and `y` m across); a rim to a man is his pass for `path` times the straight-line time. A
   * clear goes at clearSpeed toward the boards at rx `clear.x` (out past his own blue line) on his side.
   */
  rim: { speed: { base: 16, perPoint: 0.04 }, ahead: 4, corner: { back: 1, y: 8 }, path: 1.8, clearSpeed: { base: 14, perPoint: 0.04 }, clear: { x: -3 } },
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
     * counted), plus the goalie-skill term, less the penalties. Clamped to [0.03, 0.97].
     */
    save: {
      base: 2.0,
      perReactionSecond: 2.5,
      /**
       * Goalie skill: per point below 70 (perPoint) or above it (perPointAbove) near 70, flattening as
       * per * skillSpan * tanh((skill - 70) / skillSpan): a weak goalie leaks more than a strong one gains.
       */
      perPoint: 0.025,
      perPointAbove: 0.015,
      skillSpan: 25,
      screened: 0.6,
      /** Per m/s he is still moving when the puck arrives. */
      perMovingSpeed: 0.25,
      /** Per metre the shot passes wide of his centre beyond his body's reach, and again (steeper) beyond his stretch. */
      body: 0.45, perBodyMetre: 2,
      stretch: 1, perStretchMetre: 5,
      /** Per metre the shot arrives above `highFrom` (just under the bar is hardest). */
      highFrom: 0.9, perHighMetre: 1.5,
      /** A tipped shot (Task 8); a goalie still in his last save's pose, at the start of it (scaled by how much of it is left). */
      tipped: 0.9, recovering: 0.8,
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
    /**
     * What a save does with the puck (rebounds.ts, Task 8). Held: freeze[pose] less heldPerSpeed per m/s over heldFrom,
     * less heldScreened, less heldTipped. Of the rest, steered: steered.base + steered.perPoint * (reboundControl - 50),
     * less steered.tipped; the rest leave a rebound. A steered puck goes 6 to 9 m/s toward the corner on the side it came
     * to, 55 to 80 degrees off straight out; a rebound 2.5 to 6 m/s within maxAngle.base + maxAngle.perPoint *
     * (100 - reboundControl) rad of straight out.
     */
    rebound: {
      heldFrom: 25, heldPerSpeed: 0.004, heldScreened: 0.08, heldTipped: 0.12,
      steered: { base: 0.35, perPoint: 0.005, tipped: 0.1 },
      steeredSpeed: [6, 9] as [number, number],
      steeredAngle: [(55 * Math.PI) / 180, (80 * Math.PI) / 180] as [number, number],
      speed: [2.5, 6] as [number, number],
      maxAngle: { base: (35 * Math.PI) / 180, perPoint: (0.3 * Math.PI) / 180 },
    },
  },

  /** A shot released within windowSeconds of a save on that net is a rebound shot (Task 8, rebounds.ts). */
  rebound: { windowSeconds: 3 },
  /**
   * Tips in front (tips.ts, Task 8): chance base + perPoint * (hand-eye - 50); a shot below maxZ (m) from minDistance (m)
   * out, an attacker's blade within reach (m) of its path; turned by gauss * turn (rad), vz changed by gauss * lift (m/s),
   * keeping `keep` of its speed.
   */
  tip: { base: 0.10, perPoint: 0.004, reach: 0.9, maxZ: 1.2, minDistance: 9, turn: 0.12, lift: 2.5, keep: 0.85, netRange: 4.5 },

  /** Shot blocks (goalie.ts): below maxZ (m), by a defender within path (m) of its path, more than clearOfShooter (m) from the shooter; chance base + perPoint * shotBlocking. */
  block: {
    maxZ: 1.1, path: 0.55, clearOfShooter: 1.5, base: 0.40, perPoint: 0.004,
    /** A blocked puck stops at the blocker and keeps this share of its speed, turned by up to `spread` (rad) either side of straight back. */
    keep: [0.1, 0.3] as [number, number],
    spread: 1.2,
  },

  /** Poke checks (contests/poke-check.ts). */
  poke: {
    /** A defender this close (m) to the puck (on the carrier's blade), in front of the carrier or beside him, pokes at it... */
    triggerRange: 1.6,
    /** ...where "beside" reaches this far behind square: the cosine of the angle off the carrier's facing is at least this... */
    frontCos: -0.2,
    /** ...when he makes up his mind to (a draw against pokeAttemptChance), which he does at most once per this many seconds. */
    cooldownSeconds: 1.5,
    /** Attempt chance: attemptBase + attemptPerPoint * (stickChecking - 50), within [0.03, 0.97]. */
    attemptBase: 0.12,
    attemptPerPoint: 0.004,
    /** Beyond this distance (m) from the puck at the end of the reach the stick cannot get there: the contest ends with no result. */
    stickReach: 2.2,
    /** The carrier is favoured by this many rating points. */
    carrierEdge: 12,
    /** A won poke check gives the checker the puck this often; otherwise it is knocked loose. */
    takeShare: 0.5,
    /** A failed poke leaves the checker beaten (a step behind) with this chance at an even contest, scaled by 2 * (1 - his win chance). */
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
    triggerRange: 1.8,
    /** ...whom he is closing on faster than this (m/s)... */
    minClosing: 7.5,
    /** ...who has the puck or let it go less than this long ago (s)... */
    releaseWindowSeconds: 0.3,
    /** ...and makes up his mind (one draw against hitAttemptChance) at most once per this many seconds. */
    decideSeconds: 10,
    /** Target speed (m/s) assumed for his side of the momentum term, and the term's scale in rating points. */
    braceSpeed: 2,
    momentumScale: 30,
    /** A failed hit bounces the hitter off (down for a moment) with this chance at an even contest, scaled by 2 * (1 - his chance of landing it). */
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
    digMaxRounds: 2,
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
    cooldownSeconds: 2.5,
    loserPokeCooldown: 1,
    /** A carrier pulled into a battle shields the puck: his rating (protect) against the other man's (strip), plus this edge. */
    protectEdge: -3,
    protect: { strength: 0.35, puckHandling: 0.35, balance: 0.3 } as SkaterWeights,
    strip: { stickChecking: 0.4, strength: 0.35, compete: 0.25 } as SkaterWeights,
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
    /** Each man gives up this much of his winning chance to a bounce off both sticks, which nobody gets (see raceChances). */
    bounceBand: 0.08,
    /** The man who won the last net-front round has this edge for the rebound. */
    reboundEdge: 10,
    /** Neither racer may start another race for this long (s). */
    cooldownSeconds: 0.8,
    race: { compete: 0.4, agility: 0.3, balance: 0.3 } as SkaterWeights,
  },

  /**
   * Box-score takeaways and giveaways (turnovers.ts): a clean turnover counts once the winning side has kept the puck
   * keepSeconds; a pass picked off from a passer under less than unforcedPressure (0..1, see pressureOn) is a giveaway.
   */
  boxScore: { keepSeconds: 2, unforcedPressure: 0.5, controlSeconds: 1.5 },

  /** Faceoffs (faceoff.ts): the centres' rating difference is scaled by edgeScale before winProb. */
  faceoff: { edgeScale: 0.5 },

  /** Scoring (goalie.ts): a teammate's touch earns an assist only if he had the puck within this long (s) of the goal. */
  scoring: { assistWindowSeconds: 10 },

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
});
