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
/**
 * Task 13b (real-world scale): an average skater's top speed now over before (9.94 / 8.74 m/s at every rating 70). The
 * constants that assumed the old speeds are scaled by it where they are speeds (m/s), accelerations or times-for-a-
 * distance (listed where each is set).
 */
export const SPEED_SCALE = 9.94 / 8.74;

export const TUNING = deepFreeze({
  /** The carrier's decision (brain.ts). */
  brain: {
    /**
     * Decision points (brain.ts, Task 8 fix round 2; Task 8b). After a pick he holds his plan holdZone s in the zone he
     * attacks (hold s elsewhere), times 1 - holdPressure * pressure; a carry's target is reached within `arrive` m; an
     * option seen as worth `margin` more than his plan makes him choose again (marginHeld once the hold has run out:
     * while his plan is still the best he sees he keeps at it); the slot is rx slotRx or more within
     * slotLy m of the middle. Pressure (Task 8b): a checker is on him once within pressIn m and until beyond pressOut m
     * (hysteresis); his arrival is a decision point once, and no other arrival is one for pressCooldown s after it; a
     * change of his situation is not a decision point within readGap s of his last decision. Outside the zone he attacks,
     * arriveLead s (plus one look) before he would reach a carry's target, he carries on up the same lane unless he sees
     * better. Inside a hold he weighs his plan against the rest once per betterEvery s.
     */
    decide: { holdZone: 1.5, hold: 1.0, holdPressure: 0.3, arrive: 1.5, margin: 0.08, marginHeld: 0.035, slotRx: 17, slotLy: 6, pressIn: 3, pressOut: 4.5, pressCooldown: 3, readGap: 0.8, arriveLead: 0.3, betterEvery: 0.4 },
    /** Shot quality falls as exp(-distance / shotDistanceScale); nothing beyond maxShotDistance (m). */
    shotDistanceScale: 9,
    maxShotDistance: 25,
    /** The shoot option's own skill factor (shooting accuracy .6, power .4): base + perPoint * rating. */
    shootSkill: { base: 0.6, perPoint: 0.008 },
    /** Calm (scales the shot's chance): 1 - pressure * (base - perPoise * poise). */
    calm: { base: 0.555, perPoise: 0.0015 },
    /** Speed cap while carrying: base + perPoint * puckHandling; in the zone he attacks (no breakaway) times inZone. */
    /** Task 14: a share of his effort: TUNING.effort.sprint (hard skating), or allOut on a breakaway or an odd-man rush. */
    carrySpeed: { base: 0.86, perPoint: 0.001, inZone: 0.75 },
    /** A shot's chance is scaled by openNetWeight[0] with the goalie square, up to the sum of both with him shaded openNetShade m off. */
    openNetWeight: [0.85, 0.5] as [number, number],
    openNetShade: 0.6,
    /**
     * A shot's chance is scaled by calm (1 at no pressure) to this power. Task 8b, set from play (seeds 1-16, task-8b-report.md):
     * a shooter with a man 1.8 to 3 m off scores as often as a free one in this engine (his shot is only a little wilder);
     * what makes a shot poor is a checker in stick reach (TUNING.shot.rushed). It was 3.6, which valued those shots 3 to 4
     * times too low.
     */
    shootPressure: 0.6,
    /**
     * Largest share any one kind of option (all passing lanes together count as one kind, all carry lanes another) may
     * have of the carrier's draw in an ordinary state when another kind is on his list (options.ts chooseOption).
     */
    maxShare: 0.97,
    /** Passes shorter or longer than this (m) are not considered. */
    passRange: [2.5, 35] as [number, number],
    /** How far ahead (m) a carrier aims each carry decision outside the offensive zone. */
    carryAhead: 8,
    /**
     * Outside the offensive zone with a teammate wholly in it, he carries (or backs away shielding it) no closer than this
     * (m) to the blue line. Task 8b: 2 (was 1: the puck, 0.9 m ahead of him on his blade, slid over the line as he stopped).
     * Task 13b: times SPEED_SCALE, as his stopping distance.
     */
    holdUpGap: 2 * SPEED_SCALE,
    /** A teammate counts as in the zone if he will be wholly in it this many seconds from now at his speed. */
    offsideLookahead: 0.5,
    /**
     * The longer he has had the puck the more he wants to move it on: each second (TUNING.value.hold, at most holdCap)
     * adds hold * holdBoost.shoot to a shot's value and hold * holdBoost.pass to a pass's (options.ts). Task 8b: time with
     * the puck no longer pushes him to shoot (shoot 0, was 0.3: with patience he waits for a look), and moves him to pass
     * more (pass 6, was 2); in his first second with it (not settled) a pass is held back by `unsettled` instead.
     * Task 13b (Task 8b review, Minor 6): declared, like patience: pass 6 and unsettled 1.33 are a calibration set by hand
     * in Task 8b to hold the 600-900 passes bar, not a measurement (0.036 after 3 s with the puck, up to 0.18 at holdCap,
     * against a pick temperature of about 0.018: time with the puck favours passing). Task 14 tunes it.
     */
    holdBoost: { shoot: 0, pass: 6, unsettled: 1.33 },
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
    goalieSd: 0.35, // Task 14 (parity): 0.2 -> 0.35; the 76 beat the 66 in 0.83 of 300 games (band 0.70 to 0.80)
  },

  /**
   * Skating (skating.ts): top speed (m/s) and acceleration (m/s^2), base plus per point of speed / acceleration.
   * Slowing down (m/s^2): glideDecel coasting, easeDecel light braking (and the deceleration he plans an arrival or a
   * turn with), brake a hard stop (base plus per point of agility). carve is the largest sideways acceleration his
   * edges hold in a turn (m/s^2, per point of agility); carveLoss the share of speed along his blades lost per radian
   * turned (as dexp(-carveLoss * turn)). backward is his backward top speed as a share of forward (per point of agility).
   */
  skating: {
    /**
     * Task 13b (real-world scale, the owner's request): top speed 8.90 m/s (19.9 mph) at speed 40, 9.60 (21.5 mph) at
     * 60, 9.94 (22.2 mph) at 70 (the mean of generated skaters), 10.29 (23.0 mph) at 80, 10.95 (24.5 mph) at 99. It was
     * 7.62 + 0.016 per point (8.26 to 9.20 m/s, 18.5 to 20.6 mph). SPEED_SCALE (below: 9.94 / 8.74 at 70) scales what
     * goes with it so the feel holds: accel, easeDecel and brake times SPEED_SCALE (the same time to top speed and to
     * stop; stopping distances times SPEED_SCALE), carve times SPEED_SCALE^2 (the same turn radius at top speed).
     * glideDecel (the ice's drag on a glide) is physical and unchanged.
     */
    topSpeed: { base: 7.51, perPoint: 0.03475 },
    accel: { base: 7.8 * SPEED_SCALE, perPoint: 0.02 * SPEED_SCALE },
    /**
     * Task 14 (real effort; the addendum's headline 3): the share of his acceleration gone at his top speed. His push is
     * accel * (1 - accelFade * speed / top speed): an all-70 skater is at half his top speed in 0.7 s, at 90% after about
     * 2.3 s and 15 m of straight ice, at 99% after 4.5 s. Before, acceleration was constant (top speed in 0.95 s), which
     * is why skaters spent a quarter of their time at 90% of top speed or more (6,850 bursts over 20 mph a game against
     * an NHL game's few dozen).
     */
    accelFade: 0.98,
    glideDecel: 0.6,
    easeDecel: 2.5 * SPEED_SCALE,
    brake: { base: 6 * SPEED_SCALE, perPoint: 0.03 * SPEED_SCALE },
    carve: { base: 4.5 * SPEED_SCALE * SPEED_SCALE, perPoint: 0.05 * SPEED_SCALE * SPEED_SCALE },
    carveLoss: 0.1,
    backward: { base: 0.6, perPoint: 0.0012 },
  },

  /**
   * Commitment (commit.ts). A held spot is re-issued without a trigger only after holdSeconds and once the wanted spot
   * is more than moveEnough (m) from it (moveEnoughNet for the attackers' net-front man, Task 13b: he works to stay
   * in the goalie's sight line, on the line from the puck to the net); a team's committed phase follows the raw one after it has differed for
   * phaseDelay (s); a loose-puck chaser hands over only to a teammate closer to the puck by more than chaserMargin (m).
   */
  commit: { holdSeconds: 0.4, moveEnough: 1.5, phaseDelay: 0.5, chaserMargin: 1, moveEnoughNet: 0.4 },
  /**
   * Effort (commit.ts): the share of top speed each effort wants. A positional job sprints to a spot more than
   * sprintFrom (m) away and glides within glideWithin, else skates. Below sprintMinEnergy only the puck jobs sprint.
   */
  /**
   * Task 14 (real effort; NHL EDGE: a team's skaters pass 20 mph about 20 times a game and 22 mph about once, so a
   * game is played well under top speed): glide 0.5, skate 0.68 (cruising), sprint 0.8 (skating hard: 17.8 mph for
   * the mean skater), allOut 1 where a stride decides it: inside a race for a loose puck or a hit (the contests set
   * it), getting back onside (commit.ts ALL_OUT) and a carrier on a breakaway or an odd-man rush (brain.ts). They were
   * 0.55 / 0.8 / 1, with every cover and puck job at 1: skaters spent a quarter of their time at 90% of top speed or more.
   */
  effort: { glide: 0.5, skate: 0.68, sprint: 0.8, allOut: 1, sprintFrom: 8, glideWithin: 3, sprintMinEnergy: 0.2 },
  /**
   * Jobs (jobs.ts): a man holding a job is keep (m) nearer its anchor than anyone else when the jobs are handed out
   * (keepNet for the net-front defender: the man at the net stays there rather than swapping with his partner).
   * (keepNet was 6; Task 8b: 10, and the attackers' net-front man keeps his own job by keepNet too.)
   * openRadius (m): a skater getting open looks at 8 spots this far round his job's anchor (officeRadius behind the net).
   * reboundRange (m): a rebound loose within this far of the net is the net-front men's to go for (job-targets.ts).
   */
  jobs: { keep: 3, keepNet: 10, openRadius: 3, officeRadius: 1.2, reboundRange: 6 },
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
   * Task 8b (calibrated to play, task-8b-report.md): `goal` 0.13 -> 0.2 (free shooters scored 1.5 times what was valued;
   * the rest of the 3.5 the Task 8 fit found was pressured shots, now valued through shootPressure and TUNING.shot.rushed),
   * and TUNING.options.threat.shot with it (0.15 -> 0.23: a spot is worth the shot from it); `traffic` 0.02 -> 0.1 (a screen,
   * a tip and a rebound with a man in front: point shots wait for traffic); pick.base 0.017 -> 0.0147 and pick.perPoint
   * 0.0001 -> 0.00012 (Task 13b, Task 8b review Minor 3, what it does: values grew about 1.5 times, V.goal 0.13 -> 0.2,
   * while the temperature fell about 8%, 0.020 -> 0.018 at IQ 70, so relative to the values the pick is about 40% colder,
   * which suppresses poor (rushed) picks; a limited player errs more);
   * `stick` 0.03 -> 0.034 and `hold` 0.002 -> 0.003 (kept in proportion to the larger values).
   */
  value: {
    noise: { persist: 0.95, readSeconds: 4 },
    deke: 0.6,
    /** A pass's chance falls by skill.pass per point of passing under 100, a carry's by skill.carry per point of puckHandling under 100, pressured or not. */
    skill: { pass: 0.001, carry: 0.001 },
    pick: { base: 0.0147, perPoint: 0.00012, pressure: 0.0045, perPoise: 0.000067, min: 0.003 },
    /**
     * The shot's value (Task 7; Task 7 review, Important 2): P(goal) * (1 - here) plus, for each thing that can follow a
     * shot that does not score (blocked, wide, held, steered to a corner, a rebound: Task 8's outcome model), its chance
     * times (its spot value - here), the same `here` as every other option (options.ts shotAfter). A shot from 11 m or
     * more gains `traffic` in its chance to score with a teammate in front of the net (job netFront within 3 m of the net
     * centre). A pass across the slot to a man whose threat is over oneTimerThreat is a one-timer pass; his first decision
     * values the shot oneTimerBonus higher.
     */
    /**
     * traffic, Task 13b: NOT refitted (task-13b-report.md, item 3, a concern for the controller). With the screen played
     * as the share of the goalie's sight blocked, play gives a lift of 0.02 to 0.065 between runs (se 0.013 to 0.028 on 32
     * games; scripts/fit-valuation.ts); a screen squarely in his eyes from 12 m scores 4.3 times a clean shot
     * (test/badge-lab.ts labScreen). Set to the lift (0.04 or 0.06), point shots fall by a fifth and tips under 2 a game
     * and net presence at point-shot saves under 40% (item 3's guards). test/valuation-calibration.test.ts reads the gap.
     */
    traffic: 0.045, oneTimerThreat: 0.06, oneTimerBonus: 0.1,
    /**
     * What follows in the zone he attacks (Task 8 fix round), measured in play at 43d6dcf, seeds 1-16
     * (task-8-report.md, "Fix round 1"): `keep`, the share of cases in which his team (or nobody) has the puck in the zone
     * 6 s later; `rush`, the share in which the other team carries it out past centre within 6 s. A carry in the zone (and
     * a completed pass: 0.53 / 0.09) is the baseline. These describe the engine, not a target.
     */
    after: {
      // Measured again in the Task 8b close-out (seeds 1-12, task-8-follow-measure.ts; the engine shoots half as often and
      // from set-up possessions now). At 43d6dcf: carry 0.51 / 0.07, passFailed 0.29 / 0.32, held 0.41 / 0.19, steered
      // 0.42 / 0.15, rebound 0.32 / 0.13, blocked 0.24 / 0.34, wide 0.28 / 0.15.
      // Task 13b: re-measured by test/valuation-calibration.test.ts (test/valuation-fit.ts afterShares, the definitions of
      // task-8-follow-measure.ts). Not refitted here: refitting them at 7f1a4b9's play took a fifth of the attempts away
      // (task-13b-report.md, item 4); Task 14 refits them after it tunes.
      carry: { keep: 0.51, rush: 0.06 },
      passFailed: { keep: 0.32, rush: 0.26 },
      held: { keep: 0.43, rush: 0.11 },
      steered: { keep: 0.36, rush: 0.12 },
      rebound: { keep: 0.19, rush: 0.08 },
      blocked: { keep: 0.30, rush: 0.23 },
      wide: { keep: 0.31, rush: 0.14 },
    },
    stick: 0.034, shadowed: 0.5, turnoverCost: 0.6, hold: 0.003, holdCap: 10,
    goal: 0.158, habitShift: 0.03, offside: 0.03, icing: 0.05, raceBase: 0.35, racePerMetre: 0.06, raceMax: 0.85,
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
    /** A shot from farShot (m) or more is a point shot; traffic is a netFront teammate within trafficNear (m) of the net centre (Task 7; moved here, review Minor 5). */
    farShot: 11, trafficNear: 3,
    /** A rebound lands about rebound.out m out; each metre nearer it than the other side's nearest man is worth rebound.edge of the chance of getting it (options.ts shotAfter). */
    rebound: { out: 2.5, edge: 0.15 },
    threat: { base: 0.005, ice: 0.035, shot: 0.181 },
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
      /**
       * Task 8b, set from play (seeds 1-6, passes thrown, by the chance the terms above gave them): valued 0.14 completed
       * 0.40 to 0.55, 0.39 completed 0.59, 0.63 completed 0.73 to 0.81, 0.78 completed 0.85, 0.89 completed 0.87. The
       * chance used is fit.base + fit.slope * that product.
       */
      fit: { base: 0.2, slope: 0.78 },
    },
    /**
     * Task 8b, set from play (seeds 1-6, decisions in the zone he attacks; the other side has the puck within 2 s): after
     * a carry 0.11 with nobody within 5 m and 0.18 with a checker in stick reach (it was valued 0.08 and 0.29); after a
     * protect 0.04 and 0.13 (valued 0.03 and 0.255). carry.pressure was 0.35, protect.loss 0.4; outside that zone, where
     * it was not measured, they still are (pressureOut, lossOut).
     */
    carry: { base: 0.95, pressure: 0.24, pressureOut: 0.35, pressurePerPoint: 0.002, laneFrom: 2.5, laneCost: 0.5 },
    hold: { base: 0.97, pressure: 0.1, keep: 0.8 },
    wrap: { base: 0.9, pressure: 0.2, laneFrom: 1.5, laneCost: 0.3, goal: 0.55, open: 1.2 },
    protect: { base: 0.97, loss: 0.275, lossOut: 0.4, lossPerPoint: 0.0025, idle: 0.01 },
    clearIdle: 0.04,
    blindRim: 0.6,
    /** A rim's chance is rimFit.base + rimFit.slope * its race chance (Task 8b close-out, set from play: see options.ts). */
    rimFit: { base: 0.3, slope: 0.65 },
    /** A shot at a goalie still in his last save's pose is worth 1 + recovering times as much at its start (Task 8b). */
    recovering: 2,
    shotLane: [0.5, 1.0] as [number, number],
    shotBlocked: [0.3, 0.6] as [number, number],
    scoreSoft: 0.5,
  },

  /**
   * Patience (Task 8b, a controller ruling; options.ts patienceOf). Real players do not compute exact expected value:
   * they wait for a good enough look. In the zone he attacks, the puck is worth to the carrier at least patience * the
   * best look the possession can realistically still produce: the worth of the puck in the low slot, `look` m out from
   * the net (threat there). It holds for where he is and for every spot in the zone an option leads to, so it is in
   * every option comparison alike and not in the shot's own value: a shot that does not score gives up part of a
   * possession worth that much, a risky pass or carry risks it.
   * patience = (base - perShoot * (his shoot tendency - 0.5)) * situation * tacticFactor, within [0, max]:
   * - a shooter is less patient (perShoot);
   * - situation: what the possession can still produce. On an odd-man rush, `rush`. Otherwise from `alone` (none of his
   *   team in the zone with him: a lone rush builds nothing better) up to `setUp` once `setUp` teammates are in the zone
   *   (men in their jobs can produce a slot chance). On a breakaway there is no floor (his carry is worth its own end);
   * - tacticFactor: the team's offensive-zone tactic (Task 11, TUNING.tactics.patience: cycle low the most patient,
   *   shoot from the point less, rush least).
   * Set once so Task 8b's guards pass; Task 14 tunes it to NHL attempt numbers (see task-8b-report.md).
   */
  /**
   * Task 14: situation.pointTraffic (declared with the dial, like the tactic factor): a man at the point (options.farShot
   * m or more out) with his net-front man in front of the net is that much as patient. The valuation's traffic
   * (V.traffic) is now the measured lift of a man in front (0.06: 7.8% against 1.5% of unblocked far attempts), which
   * by itself no longer clears a possession valued at patience times the slot look; the screen being set is what he
   * was waiting for.
   */
  patience: { base: 1.1, perShoot: 0.8, look: 4, setUp: 3, situation: { setUp: 1, rush: 1, alone: 0.5, pointTraffic: 0.35 }, max: 2 },

  /**
   * Team tactics (tactics.ts, Task 11). Every factor a tactic applies is here; tactics shade option values and jobs and
   * never decide (no option is removed, every chance stays inside its clamp). The defaults (zoneEntry mixed, offence
   * cycle, defence collapse, pinch sometimes; forecheck as set) keep the carrier's valuation exactly as before, but they
   * do not play exactly as the engine did before tactics: three job rules are new for every team (pinching, collapse
   * holding the front of the net, the post held for the whole wait).
   *
   * A factor k is applied to an option's value as + T * ln k, T the carrier's own pick temperature at that decision
   * (TUNING.value.pick; tactics.ts shade, Task 11 review fix): it multiplies the option's weight in his draw by k,
   * whoever he is. (The brief's plain multiple of the value did next to nothing: values are small differences, often below 0.)
   * - entry: factors on the carrier's neutral-zone options (options.ts): `carryIn` on a carry toward the zone, `dump` on
   *   the dump. Set from play, far above the brief's 1.25 / 0.6 and 0.8 / 1.6: before tactics a team dumped about 4% of
   *   its entries (a dump sits 0.02 to 0.07 below his best option at the line, three to five temperatures); a weight
   *   factor of 30 on the dump gave 28%, 240 gave 32 to 40%, 3,000 gave 45%. Close-out ruling: the binding bar is the
   *   dump team at least 1.6 times the carry team's share and 0.25 or more, so 60 / 0.25. Numbers in task-11-report.md.
   *   The bend below raises a factor to a power over 1 for a line keener than 0.5 on what is asked, so 60 is not the
   *   ceiling: a grinder line (dump habit 0.6) plays the dump at 60 ** 1.2, about 136, and carryIn at 0.19.
   * - bend: the men on the ice bend an entry tactic: its factor f becomes f ** e, e = max(min, perHabit * h), h the
   *   mean habit of the on-ice forwards for what the tactic asks for (tend.carry under 'carry', tend.dump under 'dump').
   *   An average line (0.5) plays it as written; a line that does not like it (grinders asked to carry) plays it less.
   *   (The brief's 0.5 + h bends too little for its own test: grinders asked to carry would dump 1.16 times as often
   *   as a skilled line, against 1.3.)
   * - offence: factors (lowCycle on a rim, a pass to a man below the dots and the office carry; pointPass on a pass to
   *   a point man; pointShot on a shot from options.farShot m or more; rushShot on a shot on an odd-man rush; hold on
   *   protecting it in the zone and holding it behind the net). options.ts uses them divided by the default's (cycle),
   *   so the default plays as before. The brief's, except pointShots' pointPass 2 and pointShot 4 (brief 1.4 / 1.4:
   *   defencemen's attempts rose 1.26 times, against the brief's 1.4).
   * - patience: TUNING.patience's tactic factor by offence (rush 0.5: at 0.8 a cycle team's possessions in the zone were
   *   1.14 times a rush team's, at 0.6 1.19, against the brief's 1.2).
   * - pointIn (m): with pointShots the point men hold this much further in.
   * - joinRush: the joinRush tendency a defenceman needs for the dJoin job (rush tactic: `rush`; otherwise `other`).
   * - passiveF1 (rx, m): with a passive forecheck the first forechecker holds at the top of the circles (`hold`, on the
   *   carrier's line, within `holdLy` m of the middle) while the carrier is below it; the gap defencemen then meet the
   *   carrier in the neutral zone at `trapGap` of their usual gap (close-out: unpressured, the other side's carry in
   *   the neutral zone was certain in 39% of its decisions there, and certainty over all decisions read 0.153).
   * - pressure: defence 'pressure' (job-targets.ts): the wingers cover their point men at `gap` m; the corner man and the
   *   centre both go at a carrier below the dots (the second `second` m off him toward the slot); the man who has a
   *   carrier behind the net goes round after him at once. 'collapse': one man has the carrier (pressing below the dots,
   *   containing above), the wingers cover at TUNING.cover's gap; with the carrier behind the net the man who has him
   *   waits at the post (job-targets.ts BEHIND_CHASE_SECONDS) and the others hold in front of the goal line.
   * - pinch (m): a point man goes down the wall for a loose or contested puck on his side within this far of him (and
   *   more than pinchDepth m deeper than him: one nearer the line is his to keep in, as before tactics), and
   *   only while a teammate with job highForward is above the puck (nearer the blue line than it; the brief said above
   *   the point man: jobs.ts heldAtPoint says why not). pinchEager (m): one
   *   who may goes as if that much nearer the puck than he is (negative: further), against the other men for it.
   * - natural: generateTeam's rules (naturalTactics), from the roster alone (the brief's numbers).
   */
  tactics: {
    entry: { carry: { carryIn: 1.25, dump: 0.6 }, mixed: { carryIn: 1, dump: 1 }, dump: { carryIn: 0.25, dump: 60 } },
    bend: { perHabit: 2, min: 0.2 },
    offence: {
      cycle: { lowCycle: 1.3, pointPass: 1, pointShot: 0.8, rushShot: 1, hold: 1.2 },
      pointShots: { lowCycle: 1, pointPass: 2, pointShot: 4, rushShot: 1, hold: 1 },
      rush: { lowCycle: 0.8, pointPass: 0.9, pointShot: 1, rushShot: 1.3, hold: 0.8 },
    },
    patience: { cycle: 1, pointShots: 1, rush: 0.5 },
    pointIn: 1,
    joinRush: { rush: 0.45, other: 0.6 },
    passiveF1: { hold: 15.5, holdLy: 6, trapGap: 0.6 },
    pressure: { gap: 1.2, second: 2.2 },
    pinch: { often: 9, sometimes: 6, rarely: 3 },
    pinchEager: { often: 5, sometimes: 0, rarely: -4 },
    pinchDepth: 3,
    natural: {
      entry: { carry: 0.15, dump: -0.05 },
      pointShots: { shootingPower: 74, shoot: 0.35 },
      rush: { speed: 73, joinRush: 0.55 },
      forecheck: { aggressive: 0.62, passive: 0.48 },
      pressure: { bodyChecking: 72 },
      pinch: { often: 0.5, rarely: 0.3 },
    },
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
    /**
     * Builder's constants (Task 7; moved here, review Minor 5): an opponent reaches for a lane at closeSpeed (m/s); his body
     * within bodyInLane (m) of a lane ahead of the puck stands in it; he closes on a receiver at contestClose (m/s).
     * (Task 13b: the two speeds times SPEED_SCALE.)
     */
    closeSpeed: 4 * SPEED_SCALE, bodyInLane: 0.3, contestClose: 1 * SPEED_SCALE,
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
    /**
     * Opponents this close (m) to the passer as he lets it go get no interception try at it on the tick of its release
     * and the clearTicks ticks after it (their pressure is in its error); after that they try like anyone (Task 8 review).
     */
    clearOfPasser: 1.5, clearTicks: 2,
    /** After those ticks the passer's checker tries for the pass at this share of the chance (he was tied up with the passer; Task 8b close-out). */
    checkerTry: 0.4,
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
    /**
     * Task 8b close-out (passing.ts planPass): no pass whose line, carried on up to netBeyond m past its aim, reaches his
     * own goal line inside the posts, with netCone m of margin per metre travelled (Task 8b review, Important 2: not the net
     * he attacks); no backhand or blind pass within ownNetClear m of the centre of his own net.
     */
    netBeyond: 4.5, netCone: 0.06, ownNetClear: 3.5,
    /**
     * The cover (0 to 1) a pass has when the stick blade of a man level with or behind the puck is within stickLane of its
     * lane (Task 8b close-out). Task 13b (Task 8b review, Minor 8): set from the mechanism, not by hand (was 0.8). In play
     * the passer's checker reaches with stickInterceptChance times checkerTry: a 70 checker on a 15 m/s pass, 0.548 *
     * 0.4 = 0.22, so 0.78 of those passes get by him. The valuation keeps 1 - sqrt(cover) * (options.pass.cover -
     * coverPerPoint * passing) of a pass's chance: 0.78 at passing 70 needs sqrt(cover) = 0.22 / 0.65, cover 0.11.
     */
    checkerCover: 0.11,
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
    /**
     * Speed (m/s) of a wrist or snap shot: base plus per point of shootingPower. Task 13b (real-world scale): 31.3 m/s
     * (70 mph) at power 40, 35.8 (80 mph) at 70, 40.2 (90 mph) at 99; it was 29 + 0.1 per point (65 to 87 mph) for every
     * type. Slapshots and one-timers have their own (types).
     */
    speed: { base: 25.3, perPoint: 0.15 },
    /** Spread at the net (m, one standard deviation): a floor, per point of accuracy below 100, per metre out, at full pressure. */
    spread: { base: 0.15, perPoint: 0.0025, perMetre: 0.006, pressure: 0.2 },
    /**
     * A wild shot (mishit or rushed) misses the net outright: chance base + perPoint per point of accuracy below 100 +
     * pressure at full pressure + perMetre per metre out, clamped to [0.03, 0.97]. It goes `clear` m plus a half-normal
     * `spread` m wide of the post on his aiming side, or (highShare of them) that far over the bar.
     */
    wild: { base: 0.06, perPoint: 0.002, pressure: 0.15, perMetre: 0.004, clear: 0.12, spread: 0.6, highShare: 0.3 },
    /**
     * A rushed shot (Task 8b; actions.ts shotRush): with a checker within `reach` m of him the shooter has no time. How
     * rushed, 0 to 1: (reach - the checker's distance) / (reach - full), so fully at `full` m or closer. Fully rushed, it
     * leaves at 1 - speed of its speed, with 1 + spread times its spread and `wild` more chance of missing the net outright,
     * aimed 1 - aim as far from the middle of the net (he just gets it on net);
     * and the checker gets his stick on it with chance (stick.base + stick.perPoint * (stickChecking - 50)) * how rushed
     * (within [0.03, 0.97]): stick.block of those are blocked at his stick (a `block`), the rest go on deflected wide at
     * stick.keep of their speed. The valuation (options.ts) takes the same stick chance off the shot's chance to score,
     * and `value` * how rushed more for the lost speed and accuracy (set from play, close-out: a fully rushed shot scores
     * 0.13 to 0.19 of a free one from the same spot per attempt, 0.36 to 0.52 per shot on goal; see task-8b-report.md).
     */
    rushed: { reach: 1.8, full: 1.0, speed: 0.3, spread: 0.2, wild: 0.15, aim: 0.8, stick: { base: 0.3, perPoint: 0.004, block: 0.5, keep: 0.6 }, value: 0.77 },
    /** Task 14: the hardest shot there is (m/s; 48.2 is 107.8 mph: the hardest shots tracked are about 100 to 105 mph, skills-competition records near 108). */
    maxSpeed: 48.2,
    /** Shooters aim this far (m) from the centre of the net, either side, and this high. */
    aimY: [0.3, 0.65] as [number, number],
    aimZ: [0.1, 0.8] as [number, number],
    /** The aim's distance from the middle is scaled by base + perPoint * shootingAccuracy. */
    aimReach: { base: 0.4, perPoint: 0.006 },
    /** Chance of aiming at the open side: 0.5, plus this per metre the goalie is shaded off centre, at most openSideMax. */
    openSidePull: 0.6,
    openSideMax: 0.8,
    /**
     * Shot types (Task 7, actions.ts executeShot): speed (a slapshot's and a one-timer's their own, base plus per point of
     * shootingPower; a backhand's times a wrist shot's) and spread (sigma) multipliers. A wraparound goes `speed` m/s
     * along the ice at the near post. A slapshot is taken from slapFrom m or more under slapPressure; a one-timer within
     * oneTimerTicks of taking a one-timer pass; a wraparound within wrapPost m of a post off a wrap.
     */
    types: {
      /** Task 13b: a slapshot 37.5 m/s (84 mph) at power 40, 42 (94 mph) at 70, 46.4 (104 mph) at 99; a one-timer about 1.5 m/s under it. */
      slap: { speed: { base: 31.5, perPoint: 0.15 }, spread: 1.15 },
      oneTimer: { speed: { base: 30, perPoint: 0.15 }, spread: 1.25 },
      /** A backhand: `speed` times a wrist shot's. */
      backhand: { speed: 0.75, spread: 1.4 },
      wraparound: { speed: 9 },
      slapFrom: 11, slapPressure: 0.3, oneTimerTicks: 2, wrapPost: 1.2,
      /** A one-timer pass crosses y = 0 beyond rx oneTimerRx; a wraparound is aimed wrapInside (m) inside the near post, wrapSpread (m, one sd) off it. */
      oneTimerRx: 18, wrapInside: 0.15, wrapSpread: 0.1,
      /**
       * A shooter turns his body up to setTurn rad per metre out toward his forehand as he winds up (Task 8: a
       * backhand is a shot in tight with the net off his forehand, or with it well behind him). Task 8b: 8 degrees a
       * metre (was 10): with fewer rushed shots in tight, backhands had fallen to 3 to 6% of attempts.
       */
      setTurn: (8 * Math.PI) / 180,
    },
  },

  /**
   * Rims and clears (actions.ts executeRim, executeClear). A rim goes at speed.base + perPoint * passing (16 to 20 m/s),
   * aimed at the boards `ahead` m along his line to its target (a man, or with nobody named the far low corner, `back`
   * m out from the goal line and `y` m across); a rim to a man is his pass for `path` times the straight-line time. A
   * clear goes at clearSpeed toward the boards at rx `clear.x` (out past his own blue line) on his side.
   */
  rim: { speed: { base: 16, perPoint: 0.04 }, ahead: 4, corner: { back: 1, y: 8 }, path: 1.8, clearSpeed: { base: 14, perPoint: 0.04 }, clear: { x: -3 } },
  /**
   * The hard clear (Task 13b; actions.ts executeHardClear, options.ts). From his own zone he fires or flips it down the
   * ice: within glassWall (m) of the boards he fires it off the glass on his side at speed.base + perPoint *
   * shootingPower (m/s), aimed at the boards glassAhead m up ice of him (at most to glassMaxRx) and meeting them glassZ m
   * up; otherwise he flips it high up the middle toward the far corner on his side (the far goal line, aimY m off
   * centre: not at the net) at flip.speed, to flip.peak m. A lifted clear lands on its edge and keeps landKeep of its
   * speed (game.ts). An opponent whose stick (or, below
   * knock.maxZ m, his body) it passes within reach knocks it down with interceptChance (TUNING.pass) times knock.factor
   * (times TUNING.pass.stickFactor off the stick); it drops dead at his feet (knock.keep m/s). Slower than knock.minSpeed
   * (m/s; game.ts's loose-puck pickup speed) it is a loose puck anyone may pick up, not a clear to knock down.
   * Valued (options.ts) on where it can first be played: what it leads to there (his team first, by the race; else the
   * other team's possession there), knocked down near the knocker, icing (a faceoff at his own end's dot, from the threat
   * there, and no change) when it would reach the far goal line untouched and the other team would win the race; a
   * clean clear is worth change * how tired his line is (1 - mean energy, over tiredSpan) and lateLead * how late it is
   * with a lead in the last period. In his own zone every loss of the puck (and an icing's faceoff) costs 1 + tiredLoss *
   * tired times as much: a tired line defends worse.
   */
  hardClear: {
    speed: { base: 22, perPoint: 0.08 }, glassWall: 3.5, glassAhead: 14, glassMaxRx: -4, glassZ: 1.6, aimY: 9,
    flip: { speed: { base: 12, perPoint: 0.05 }, peak: 3 }, landKeep: 0.5,
    knock: { maxZ: 1.8, factor: 1, keep: 2, minSpeed: 12 },
    change: 0.03, tiredSpan: 0.4, tiredLoss: 1, lateLead: 0.03,
    /** It is an option only under pressure (pressureFrom or more) with no safe outlet: no pass that works safePass of the time to a man with openSpace m of ice. */
    // Task 14 (headline 2: 54 hard clears a game; a last resort): pressureFrom 0.75 -> 0.9, a checker on him (within
    // 1.4 m, stick reach), not closing from 2 m.
    // settle (s) and turn (rad): he must have had the puck that long (a beat to get it on his blade), and its aim must be within that angle of his facing.
    pressureFrom: 0.9, safePass: 0.6, openSpace: 2, settle: 0.25, turn: 2.0,
    /**
     * Set from play (seeds 1-6, 494 hard clears, task-13b-report.md item 1): the icing race read from where the men stand
     * (0.5 + V.racePerMetre per metre) called 0.1 / 0.3 / 0.5 / 0.7 / 0.9 was iced 0.47 / 0.36 / 0.51 / 0.75 / 0.84 of the
     * time (the forwards do not always race for it; the other team's men skate back): the chance used is ice.base +
     * ice.slope * that read. A clear that reaches the far end and is not iced (or is played before it) was his team's 0.55
     * of the time, not V.raceMax: `played`. After the flip (a lifted clear lands and dies) most stop short of the line;
     * those were his team's 0.14 of the time against the race's 0.26 (seeds 5-8, 192 clears): `race` times the race chance.
     */
    fit: { ice: { base: 0.32, slope: 0.51 }, played: 0.55, race: 0.5 },
  },
  /** Dumps (actions.ts): to a spot this deep and wide (attack-relative m), chipped up at vz m/s; speed base + perPoint * passing. */
  dump: { spot: { x: 25.5, y: 8 }, vz: 2, speed: { base: 16, perPoint: 0.05 }, errorFactor: 1.5 },

  /**
   * The boards (puck.ts, Task 7; moved here, review Minor 5): they give back `restitution` of the speed into them at `soft`
   * (m/s) or less, falling linearly to hardRestitution at `hard` or more; a real hit (`skim` m/s or more into them) keeps
   * `along` of the speed along them.
   */
  boards: { restitution: 0.55, hardRestitution: 0.2, soft: 8, hard: 25, along: 0.9, skim: 2 },

  /** Goalies (goalie.ts). */
  goalie: {
    /**
     * Facing a shot (Task 8; moved here in the Task 8 review fixes). He faces a shot at his plane only when it is on its
     * way in clear of the posts by the puck's and the post's radius plus postClear (m) and under the bar by barClear (m);
     * a save needs the puck's line within `reach` (m) of his centre (a sharp-angle shot passing wider is a goal, a post
     * or a miss).
     */
    face: { postClear: 0.01, barClear: 0.05, reach: 1.6 },
    /** How long (s) he shows a save pose; while in it his next save is harder (save.recovering, scaled by how much is left). */
    poseSeconds: 0.6,
    /** An attacker screens him within `off` (m) of a shot's line, `near` to `far` (m) in front of him. */
    /**
     * Task 13b: every tick of a shot's flight his sight line to the puck is blocked when an attacker's body (his radius
     * plus `pad` m) is across it, more than `near` m in front of him and short of the puck (shots.ts watchSight, attackers
     * only, the shooter and the tipper not). The share of the flight blocked makes him react later (times 1 - react *
     * share) and read it worse (save.screened * share off the log-odds).
     */
    // Task 14: `flag`: a shot is `screened` (the events, the held-rebound chance) with that share of its flight hidden or more. off and far are no longer read.
    screen: { off: 0.6, near: 0.8, far: 4, pad: 0.1, react: 1, flag: 0.5 },
    /** Top speed along his arc (m/s): base plus per point of lateral. */
    speed: { base: 1.5, perPoint: 0.035 },
    /** How fast he turns square to the puck (rad/s): base plus per point of positioning. */
    squareRate: { base: 2, perPoint: 0.06 },
    /** Depth out from the goal line (m): min with the puck `near` m away or closer, growing perMetre per metre, at most max. */
    depth: { min: 0.4, max: 1.3, near: 2, perMetre: 0.06 },
    /**
     * He covers a loose puck slower than speed (m/s), within reach (m) of him, when an opponent is within threat (m) of
     * it: in his crease, or (Task 13) just outside it with his body in it (never behind his goal line); no higher than
     * maxZ (m). Under that pressure he also skates to a slow loose puck in his crease to cover it.
     */
    cover: { speed: 3, reach: 1.0, threat: 2.5, maxZ: 0.3 },
    /**
     * A puck that was not shot (a pass, a centring feed, a loose puck) sliding over his goal line between the posts (Task 8b
     * review, Important 2): he stops it with stick or pad with chance logistic(base - perSpeed * its speed - perMetre * (how
     * far its line passes from his centre, plus his squareness error, beyond `body` m)), within [0.03, 0.97]. A pass that
     * slides within `reach` (m) of him on its way (through his crease) gets the same one try, its line's distance from him
     * the miss.
     */
    slide: { base: 4.5, perSpeed: 0.2, body: 0.3, perMetre: 2, reach: 1.1 },
    /**
     * Save chance, as a logistic: base, plus perReactionSecond per second the puck takes to arrive (at most 1 s
     * counted), plus the goalie-skill term, less the penalties. Clamped to [0.03, 0.97].
     */
    save: {
      base: 2.32,
      perReactionSecond: 1.75,
      /**
       * Goalie skill: per point below 70 (perPoint) or above it (perPointAbove) near 70, flattening as
       * per * skillSpan * tanh((skill - 70) / skillSpan): a weak goalie leaks more than a strong one gains.
       */
      perPoint: 0.025,
      perPointAbove: 0.015,
      skillSpan: 25,
      screened: 1.0,
      /** Per m/s he is still moving when the puck arrives. */
      perMovingSpeed: 0.25,
      /** Per metre the shot passes wide of his centre beyond his body's reach, and again (steeper) beyond his stretch. */
      body: 0.45, perBodyMetre: 2,
      stretch: 1, perStretchMetre: 5,
      /** Per metre the shot arrives above `highFrom` (just under the bar is hardest). */
      highFrom: 0.9, perHighMetre: 1.5,
      /** A tipped shot (Task 8); a goalie still in his last save's pose, at the start of it (scaled by how much of it is left). */
      tipped: 0.9, recovering: 1.1,
      /**
       * A slow shot is easier to read (Task 8b close-out, controller ruling 7): perSlowSpeed per m/s under slowFrom, at
       * most slowMax, in full from slowFull m out and in proportion closer in (in tight he has no time to read anything).
       * A rushed shot (TUNING.shot.rushed) is slow, so the ones that get on net score clearly less often.
       */
      slowFrom: 31, perSlowSpeed: 0.22, slowMax: 1.8, slowFull: 6,
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
     * to, 55 to 80 degrees off straight out. A rebound (Task 8 review, Important 2: it depends on the save, the shot and
     * the goalie) leaves at the shot's speed times speedShare (base less perPoint * reboundControl, within [min, max])
     * times poseSpeed[pose] (a pad or a blocker gives it back livelier than the chest or the glove), kept within `speed`
     * (2.5 to 6 m/s); its direction is `reflect` of the shot's reflected line off straight out, turned blockerTurn (a
     * blocker save) or padTurn (a pad save) further toward the side it met him on, a chest or glove save dropping it in
     * front, plus a normal error of spread.base + spread.perPoint * (100 - reboundControl) rad, all within maxAngle.base +
     * maxAngle.perPoint * (100 - reboundControl) rad of straight out. He shows holding the puck for coverSeconds.
     */
    rebound: {
      heldFrom: 25, heldPerSpeed: 0.004, heldScreened: 0.08, heldTipped: 0.12,
      steered: { base: 0.3, perPoint: 0.005, tipped: 0.1 },
      steeredSpeed: [6, 9] as [number, number],
      steeredAngle: [(55 * Math.PI) / 180, (80 * Math.PI) / 180] as [number, number],
      speed: [2.5, 6] as [number, number],
      speedShare: { base: 0.18, perPoint: 0.0012, min: 0.06, max: 0.3 },
      poseSpeed: { glove: 0.5, blocker: 1, pad: 1, butterfly: 0.7 } as Record<SavePose, number>,
      reflect: 0.5, blockerTurn: 0.5, padTurn: 0.3,
      spread: { base: 0.15, perPoint: 0.006 },
      maxAngle: { base: (35 * Math.PI) / 180, perPoint: (0.3 * Math.PI) / 180 },
      coverSeconds: 1.2,
    },
  },

  /** A shot released within windowSeconds of a save on that net is a rebound shot (Task 8, rebounds.ts). */
  rebound: { windowSeconds: 3 },
  /**
   * Tips in front (tips.ts, Task 8): chance base + perPoint * (hand-eye - 50); a shot below maxZ (m) from minDistance (m)
   * out, an attacker's blade within reach (m) of its path; turned by gauss * turn (rad), vz changed by gauss * lift (m/s),
   * keeping `keep` of its speed.
   */
  tip: { base: 0.22, perPoint: 0.004, reach: 0.9, maxZ: 1.2, minDistance: 9, turn: 0.12, lift: 2.5, keep: 0.85, netRange: 4.5 },

  /**
   * Shot blocks (goalie.ts): below maxZ (m), by a defender within path (m) of its path, more than clearOfShooter (m) from
   * the shooter; chance base + perPoint * shotBlocking + perHabit * (his block habit - 0.5) (Task 12 close-out: how
   * willing he is to get in front of it; 0.5, the default, changes nothing).
   */
  block: {
    maxZ: 1.1, path: 0.55, clearOfShooter: 1.5, base: 0.40, perPoint: 0.004, perHabit: 0.2,
    /** A blocked puck stops at the blocker and keeps this share of its speed, turned by up to `spread` (rad) either side of straight back. */
    keep: [0.1, 0.3] as [number, number],
    spread: 1.2,
  },

  /** Poke checks (contests/poke-check.ts). */
  poke: {
    /** A defender this close (m) to the puck (on the carrier's blade) and at least minReach from it, in front of the carrier or beside him, pokes at it... */
    triggerRange: 1.6,
    /** ...where "beside" reaches this far behind square: the cosine of the angle off the carrier's facing is at least this... */
    frontCos: -0.2,
    /** ...when he makes up his mind to (a draw against pokeAttemptChance), which he does at most once per this many seconds. */
    cooldownSeconds: 1.5,
    /** Attempt chance: attemptBase + attemptPerPoint * (stickChecking - 50), within [0.03, 0.97]. */
    attemptBase: 0.12,
    attemptPerPoint: 0.004,
    /**
     * Task 9: the checker reaches from a stick length: while the stick goes out he makes for the point standOff (m) from the
     * puck on his side of it, facing it; at the end of the reach he pokes only from minReach to stickReach (m) from the puck
     * (closer, he is on top of it; further, the stick cannot get there): else the contest ends with no result.
     */
    standOff: 1.5,
    minReach: 0.9,
    stickReach: 1.9,
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
    /** ...whom he is closing on faster than this (m/s; Task 13b: times SPEED_SCALE)... */
    minClosing: 7.2 * SPEED_SCALE,
    /** ...who has the puck or let it go less than this long ago (s)... */
    releaseWindowSeconds: 0.3,
    /** ...and makes up his mind (one draw against hitAttemptChance) at most once per this many seconds. */
    decideSeconds: 10,
    /**
     * Target speed (m/s) assumed for his side of the momentum term, and the term's scale in rating points (Task 12
     * close-out: 30 -> 50, with attrScale below; a hitter closing at minClosing or more had about 20 points on an even man
     * from momentum alone, so any style difference put the pair over 0.75). Task 13b: braceSpeed and momentumScale times
     * SPEED_SCALE (the same rating points for the same closing as a share of top speed).
     */
    braceSpeed: 2 * SPEED_SCALE,
    momentumScale: 50 * SPEED_SCALE,
    /** A failed hit bounces the hitter off (down for a moment) with this chance at an even contest, scaled by 2 * (1 - his chance of landing it). */
    bounceChance: 0.1,
    hitter: { bodyChecking: 0.5, strength: 0.3, balance: 0.2 } as SkaterWeights,
    /**
     * How much the two men's rating difference (hitter against brace) feeds the edge (Task 12 close-out). A hit is the one
     * contest where the two sides are rated on different attributes and the momentum term already favours the hitter
     * (closing at minClosing or more), so the styles' attribute differences went in whole on top: a Power Forward landed
     * 0.79 of his hits on a Speedster and an Enforcer 0.76 on an Offensive Defenceman (120 games, 150+ each). With 0.5
     * and momentumScale 50: largest pair 0.70 (Enforcer v Speedster, 160 games).
     */
    attrScale: 0.5,
    brace: { balance: 0.45, strength: 0.35, poise: 0.2 } as SkaterWeights,
    /**
     * How hard a landed hit is (Task 9, contests/hit.ts hitDegreeChances): x = (closing - closingFrom) * perClosing +
     * (hitter mass - target mass) / kgPerPoint - (target balance - balanceFrom) / balancePer - (he saw it ? sawIt : 0) +
     * margin; knockdown with chance logistic(x + knockdown), else stagger with chance logistic(x + stagger), else a bump.
     * He saw it when the hitter is within sawAngle (rad) of his facing. A stagger cuts his speed to staggerKeep, caps it
     * at staggerCap of top speed for staggerSeconds, and a carrier loses the puck with chance staggerLoose; a bump
     * nudges him with bumpPush of the push, and a carrier loses it with chance bumpLoose.
     */
    degree: {
      // Task 14 (Task 13b review, Minor 1): closingFrom and perClosing scaled with real speeds as minClosing was (the same degree for the same closing as a share of top speed).
      closingFrom: 6 * SPEED_SCALE, perClosing: 0.25 / SPEED_SCALE, kgPerPoint: 8, balanceFrom: 70, balancePer: 20, sawIt: 0.8, sawAngle: (100 * Math.PI) / 180,
      knockdown: -0.2, stagger: 1.2,
      staggerKeep: 0.6, staggerCap: 0.4, staggerSeconds: 0.5, staggerLoose: 0.5, bumpPush: 0.3, bumpLoose: 0.15,
    },
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
    /**
     * Task 9: a supporting player stands supportOff (m) from the spot toward his own net, at least supportBoards (m) off the
     * boards (rink.ts supportSpot); the winner of a clean win is steered comeAway (m) further off the boards with it while
     * the battle resolves; a win by support is passed to the supporter at passSpeed (m/s).
     */
    supportOff: 2,
    supportBoards: 1.2,
    comeAway: 1.2,
    passSpeed: [6, 8] as [number, number],
    /** The winner comes away with it clean this often; otherwise it squirts along the boards at squirtSpeed m/s. */
    cleanShare: 0.75,
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
    raceWindow: 0.4 / SPEED_SCALE,
    raceHorizon: 1.5 / SPEED_SCALE,
    /** Rating points per second of arrival-time difference (Task 13b: the three times scaled by SPEED_SCALE, the same distances). */
    edgePerSecond: 130 * SPEED_SCALE,
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
  boxScore: { keepSeconds: 2, unforcedPressure: 0.5, controlSeconds: 2.5 },

  /** Faceoffs (faceoff.ts): the centres' rating difference is scaled by edgeScale before winProb. */
  faceoff: {
    edgeScale: 0.5,
    /**
     * Lining up (faceoff.ts): within faceWithin (m) of his spot he turns to his line-up facing (toward a point faceAhead m
     * along it; squared up, skating.ts Drive.squareWithin); he sprints to it from further than sprintFrom (m).
     */
    lineup: { faceWithin: 1.5, faceAhead: 10, sprintFrom: 20 },
  },

  /** Scoring (goalie.ts): a teammate's touch earns an assist only if he had the puck within this long (s) of the goal. */
  scoring: { assistWindowSeconds: 10 },

  /**
   * Engagements (engagements.ts, Task 10): two opponents whose bodies come within `contact` (m, beyond their radii) battle
   * for position, when they meet at under maxRelSpeed (m/s; Task 13b: times SPEED_SCALE) one against the other (faster, they glance off or it is a hit);
   * coming together ties each up by startTie (so getting loose takes two draws won in a row). One draw every
   * drawSeconds: the loser's tie rises by tieUp, the winner's falls by tieDown; two wins in a
   * row take inside position. A draw is winProb of the `weights` composite difference, plus mass difference / massPerPoint,
   * plus insideEdge for the man inside. A man's speed cap is times 1 - slow * his tie. It ends `released` beyond contact +
   * releaseGap (m); a man with tie freeAt or less whose target is over breakAway (m) from the other who wins a draw gets
   * loose. Near a net (the pair within netRange m of its centre) it is a box-out. Its event is emitted from eventSeconds.
   * A tied-up man's limits: pass reception x (1 - receive * tie), shot spread x (1 + spread * tie), shot value x (1 -
   * shootValue * tie), tip chance x (1 - tip * tie), loose-puck reach x (1 - reach * tie).
   */
  engage: {
    contact: 0.15, drawSeconds: 0.4, slow: 0.5, massPerPoint: 4, insideEdge: 5, tieUp: 0.3, tieDown: 0.2,
    weights: { strength: 0.35, balance: 0.3, compete: 0.35 },
    startTie: 0.3, maxRelSpeed: 2.4 * SPEED_SCALE, releaseGap: 1.0, freeAt: 0.15, breakAway: 3, netRange: 6, eventSeconds: 0.3,
    limits: { receive: 0.6, spread: 1, shootValue: 0.5, tip: 0.6, reach: 0.5 },
  },

  /**
   * Builder's constants moved here (Task 8b review, Minor 4; Task 13b): `pressure` is the pressure ramp (actions.ts
   * pressureOn, options.ts lookLeft): 0 with nobody within `from` m, 1 with an opponent `from - over` m off or closer;
   * clearedSpeed (m/s, bench.ts): the puck moving out of a team's zone this fast with nobody carrying lets it change;
   * stoppedPush (m, game.ts): how far a goalie's body may push a skater in one tick while play is stopped; protectOffLine
   * (m, brain.ts): a protecting carrier's target stays this far on the puck's side of a goal line; carryMin (m,
   * options.ts): a carry lane in the zone is offered only when its end is this far from him; checkerNear (m, passing.ts):
   * a passer's checker is an opponent this near the puck as he lets it go; faceNear (m, team-play.ts): the attacking
   * jobs that face the play do so only within this far of their spot.
   */
  builder: { pressure: { from: 5, over: 4 }, clearedSpeed: 3, stoppedPush: 0.4, protectOffLine: 0.6, carryMin: 2.5, checkerNear: 2.5, faceNear: 2 },

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

  /**
   * Styles (styles.ts, Task 12). A generated skater has a secondary style with chance secondaryChance; his habits are
   * secondaryShare of the secondary's and the rest the primary's; his attributes take the primary's bias plus
   * secondaryBias of the secondary's. styleOf scores each style of his group by attrWeight of how well his attributes
   * match its bias (0.5 + the mean bias-weighted difference from his own mean / attrSpan, within 0 to 1) and the rest by
   * how well his habits match its habits (1 - the mean absolute difference); the next best is his secondary when its
   * score is at least secondaryWithin of the best. Task 13b: his declared style (his type's) is kept as primary unless
   * another scores keepMargin more (it flipped on a one-point change near a tie; 6.5% of generated skaters read as
   * another primary than their type).
   */
  styles: { secondaryChance: 0.6, secondaryShare: 1 / 3, secondaryBias: 0.5, attrWeight: 0.5, attrSpan: 40, secondaryWithin: 0.85, keepMargin: 0.05 },

  /**
   * Badges (badges.ts, Task 12): each badge's one effect, small, read where the badge acts (one guarded line there).
   * Every chance it shades is clamped again ([0.1, 0.9] through winProb for contests, [0.03, 0.97] otherwise).
   */
  badges: {
    /** Heavy Slapshot: a slapshot's speed times this. */
    heavySlapSpeed: 1.08,
    /** One-Timer: a one-timer's spread times this instead of TUNING.shot.types.oneTimer.spread. */
    oneTimerSpread: 0.8,
    /** Quick Release: pressure counts this share in his shot spread; the goalie's reaction time to his shot times reaction. */
    quickReleasePressure: 0.6, quickReleaseReaction: 0.9,
    /** Net-Front Finisher: tip chance plus tip; spread on a rebound shot times reboundSpread. */
    finisherTip: 0.08, finisherReboundSpread: 0.85,
    /** Burner: top speed times this. */
    burnerSpeed: 1.03,
    /** Elusive: carve times carve; the poke checker's carrier edge (TUNING.poke.carrierEdge) plus pokeEdge against him. */
    elusiveCarve: 1.1, elusivePokeEdge: 4,
    /** Tireless: energy drain times this. */
    tirelessDrain: 0.85,
    /** Playmaker's Vision: sees this many more pass options; the error of his read of an option times readError. */
    visionExtraPasses: 1, visionReadError: 0.7,
    /** Stickhandler: rating points in a poke check's hands rating. */
    stickhandlerHands: 5,
    /** Breakout Passer: passes from his own zone: direction error times error, forehand range plus range (m). */
    breakoutError: 0.75, breakoutRange: 5,
    /** Shot Blocker: block chance plus this. */
    shotBlockerChance: 0.08,
    /** Stick Checker: rating points in a poke check's stick rating; stick-in-lane interception factor (TUNING.pass.stickFactor 1.5). */
    stickCheckerStick: 5, stickCheckerLaneFactor: 1.7,
    /** Big Hitter: hitter rating points; added to the hit-degree score. */
    bigHitterRating: 5, bigHitterDegree: 0.4,
    /** Shutdown: poke (stick) and strip rating points against the man he marks; his cover gap is this much tighter (m). */
    shutdownRating: 4, shutdownGap: 0.3,
    /** Board Battler: rating points in a board battle's pin and dig draws. */
    boardBattlerRating: 5,
    /** Net-Front Presence: net-front body rating points; engagement rating points within netRange (m) of a net. */
    netFrontBody: 6, netFrontEngage: 4, netFrontRange: 5,
    /** Faceoff Specialist: faceoffs rating points. */
    faceoffRating: 5,
    /** Rebound Control (goalie): held and steered chances plus this each. */
    reboundControlShare: 0.06,
    /** Glove Hand (goalie): save log-odds on his catching side above gloveHeight (m); held chance on a glove save. */
    gloveSave: 0.25, gloveHeight: 0.5, gloveHeld: 0.08,
    /**
     * What the carrier's valuation sees of the shot badges (options.ts shotBadgeFactor; Task 12 close-out): each is the
     * lift in the chance a shot scores measured from executed shots against a 70 goalie (20,000 paired shots each, 70
     * shooters): a one-timer from the slot 1.053; a slapshot from the point 1.081; a wrist shot with a checker 1.2 m off
     * (pressure about 1) 1.136, so quickRelease is per unit of pressure; a rebound shot from 5 m 1.003 (from that close the
     * spread barely matters); a wrist shot from the point with a Net-Front Finisher screening 1.087 (his tips 6.7% -> 9.7%).
     * Task 13b, re-measured with real shot speeds and the screen as a share of sight (test/badge-lab.ts, 40,000 paired
     * shots each): one-timer 1.048, slapshot 1.074, Quick Release with nobody near 1.076 (the goalie's 0.9 reaction: it
     * was valued 1) and with a checker 1.2 m off (pressure 0.95) 1.098, so quickReleaseCalm * (1 + quickRelease *
     * pressure) with 1.08 and 0.02; rebound 1.006; Net-Front Finisher screening 1.185 (a screen now hides more of the
     * shot, so his tips count for more). Re-measured by test/valuation-calibration.test.ts.
     */
    value: { oneTimer: 1.05, heavySlap: 1.08, quickReleaseCalm: 1.08, quickRelease: 0.02, finisherRebound: 1.0, finisherScreen: 1.15 },
  },
});
