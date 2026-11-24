import type { Vec2 } from './vec';
import type { Puck } from './puck';
import type { GoalieAttrs, SkaterAttrs } from './attributes';

export type Position = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G';
export type Side = 'home' | 'away';

/** Each value 0 to 1. */
export type Tendencies = {
  shoot: number;
  pass: number;
  carry: number;
  dump: number;
  hit: number;
  forecheck: number;
  netFront: number;
  joinRush: number;
};

export type PlayerDef = {
  id: string;
  name: string;
  number: number;
  position: Position;
  /** The side his stick blade is on: 'L' his left (facing + PI/2). */
  shoots: 'L' | 'R';
  /** A goalie's catching hand (his glove), 'L' when absent. Ignored for skaters. */
  catches?: 'L' | 'R';
  heightCm: number;
  weightKg: number;
  type: string;
  subType: string | null;
  attrs: SkaterAttrs;
  goalie: GoalieAttrs | null;
  tendencies: Tendencies;
  /**
   * -1..1, default 0. Not yet fully effective: it moves his contest ratings only (up to 4 rating points in hits, poke
   * checks, battles, races and faceoffs), not his shooting, passing, skating, decisions or (for a goalie) saves.
   */
  form: number;
  /** -1..1, default 0. Like `form`, it moves his contest ratings only (up to 4 rating points). */
  morale: number;
  /** 0..1, default 0. Not read yet: every skater starts a game with full energy (validated, kept for stage 2). */
  fatigue: number;
};

export type Lines = {
  /** Lines in LW, C, RW order. */
  forwards: [string, string, string][];
  /** Pairs in LD, RD order. */
  defence: [string, string][];
  goalie: string;
};

export type Tactics = {
  forecheck: 'passive' | 'balanced' | 'aggressive';
  shiftSeconds: { forwards: number; defence: number };
};

export type TeamDef = {
  id: string;
  name: string;
  abbr: string;
  players: PlayerDef[];
  lines: Lines;
  tactics: Tactics;
};

export type GameSetup = {
  home: TeamDef;
  away: TeamDef;
  seed: number;
  chemistry: { a: string; b: string; value: number }[];
};

/** See SkaterState.mode. */
export type SkatingMode = 'forward' | 'backward' | 'crossover';
/** How a skater slows when he is going faster than he wants: glide on (`coast`), light braking (`ease`) or a hard stop (`stop`). */
export type SlowMode = 'coast' | 'ease' | 'stop';

/** Every job a skater can hold. No two skaters of a team hold the same one, except the utility jobs change, lineUp, tagUp, contest, down. */
export type Job =
  | 'carrier'
  | 'lowSupport' | 'netFront' | 'highForward' | 'pointStrong' | 'pointWeak' | 'office'          // with the puck, offensive zone
  | 'driveWide' | 'driveMiddle' | 'trailer' | 'dJoin' | 'dHold' | 'dHoldWeak'                    // with the puck, rush
  | 'outlet' | 'centreLow' | 'stretch' | 'dPartner'                                              // with the puck, breakout
  | 'f1' | 'f2' | 'f3' | 'dLineStrong' | 'dLineWeak'                                             // without it, their zone
  | 'backcheckA' | 'backcheckB' | 'dGapStrong' | 'dGapWeak'                                      // without it, neutral zone
  | 'dCorner' | 'dNet' | 'dzCentre' | 'wingStrong' | 'wingWeak'                                  // without it, own zone
  | 'chase' | 'receive' | 'battleSupport'                                                        // the puck is loose or on its way
  | 'change' | 'lineUp' | 'tagUp' | 'contest' | 'down';                                          // utility
/** How hard he skates: the share of his top speed he wants (TUNING.effort). */
export type Effort = 'glide' | 'skate' | 'sprint';
/**
 * Why a target was last issued. `review` is the routine one (minimum hold passed and the spot moved enough); the rest
 * are triggers. `newJob`: team play gave him another job (a job changes inside the hold only on another trigger, or
 * when the job he holds is gone from his team's list).
 */
export type ReplanReason = 'start' | 'possession' | 'passToMe' | 'loosePuckMine' | 'phase' | 'whistle' | 'contestEnd' | 'gotUp' | 'steppedOn' | 'offside' | 'newJob' | 'review';
/** What a skater has committed to (commit.ts). `state.plans[i]` belongs to `state.skaters[i]`. */
export type SkaterPlan = {
  job: Job; jobTick: number;
  /** When his target was last issued and why; the side that had possession then. */
  targetTick: number; reason: ReplanReason; possession: Side | null;
  /** `spot`: a held place on the ice; `puck` / `man`: he tracks it every tick (`markId` for a man). */
  follow: 'spot' | 'puck' | 'man'; markId: string | null;
  /** How hard he skates, how he slows when going faster than that, and whether he skates through his target. */
  effort: Effort; slow: SlowMode; through: boolean;
};
/** Where a carrier carries the puck (options.ts): at the net, wide down the boards, through the middle, to the office behind the net, round the net on a wraparound, or holding behind it. */
export type CarryLane = 'net' | 'wide' | 'middle' | 'office' | 'wrap' | 'hold';
/** What the carrier has committed to (the brain re-values every BRAIN_INTERVAL_TICKS; the committed option gets TUNING.value.stick). */
export type CarrierPlan = {
  id: string; kind: 'carry' | 'pass' | 'shoot' | 'dump' | 'protect' | 'rim' | 'clear'; lane: CarryLane | null; toId: string | null; to: Vec2 | null; tick: number;
  /** Drawn when he gets the puck: keys the part of his error in judging each option that stays with him while he has it (builder's addition). */
  seed?: number;
};
/** A team's committed phase (commit.ts): it follows the raw phase only once that has differed for TUNING.commit.phaseDelay (`pending` since `pendingTick`). */
export type TeamPhaseState = { phase: TeamPhase; sinceTick: number; pending: TeamPhase | null; pendingTick: number };

export type SkaterState = {
  id: string;
  side: Side;
  slot: Position | null;
  pos: Vec2;
  vel: Vec2;
  /** Radians; direction the body points. */
  facing: number;
  /** Where he is trying to go. */
  target: Vec2;
  /** When set, he keeps his body pointed at this spot (skating backward if need be). */
  faceTarget: Vec2 | null;
  /**
   * How he is skating: `forward` (facing his travel), `backward` (squared up to faceTarget, travelling more than 120
   * degrees off his facing) or `crossover` (squared up, travelling sideways or at an angle). Squared up means he keeps
   * his body to faceTarget; he squares up once his travel is more than 65 degrees off it and stops below 45.
   */
  mode: SkatingMode;
  /** 0..1 share of his top speed he wants now (his effort; see commit.ts speedFor), not a cap by job. */
  speedCap: number;
  energy: number;
  onIce: boolean;
  leaving: boolean;
  /** Seconds left knocked down; above 0 means no control. Decremented by the caller. */
  downT: number;
  contestId: number | null;
  /** Game clock seconds (counted from the opening faceoff) when he last stepped on the ice. */
  shiftStart: number;
  /** Live ticks he has spent on the ice (time on ice is toiTicks * DT seconds). */
  toiTicks: number;
};

export type Phase = 'faceoffSetup' | 'live' | 'stopped' | 'intermission' | 'final';

export type GoaliePose = 'stance' | 'butterfly' | 'glove' | 'blocker' | 'pad' | 'cover';

/** `vel` is his movement this tick (m/s); `pose` shows a save (or a cover) for `poseT` more seconds, then `stance`. */
export type GoalieState = { id: string; pos: Vec2; vel: Vec2; facing: number; pose: GoaliePose; poseT: number };

/** A shot on its way, from its release until the puck reaches the net, misses, hits a post or is blocked. */
export type ShotInFlight = {
  shooterId: string;
  side: Side;
  /** Where it was released, and how far that was from the net centre (m). */
  from: Vec2;
  fromDist: number;
  tick: number;
  /** Defenders who have already had their one chance to block it. */
  blockTried: string[];
};

/** The kinds of staged contest (contests/*.ts). */
export type ContestKind = 'hit' | 'pokeCheck' | 'boardBattle' | 'netFront' | 'looseRace';

/** The stages of each kind, in the order they can come (see each contest's module for what happens in each). */
export type ContestStages = {
  hit: 'close' | 'impact' | 'recover';
  pokeCheck: 'reach' | 'resolve' | 'beaten';
  boardBattle: 'protect' | 'arrive' | 'pin' | 'dig' | 'resolve';
  netFront: 'jostle' | 'free' | 'tied';
  looseRace: 'race' | 'resolve';
};

/** Who plays which part in each kind of contest (skater ids; null while nobody has that part). */
export type ContestRoles = {
  hit: { hitter: string; target: string };
  pokeCheck: { checker: string; carrier: string };
  boardBattle: {
    /** The two men in it (participants 0 and 1). */
    a: string;
    b: string;
    /** The carrier while he shields a carried puck (`protect`). */
    carrier: string | null;
    /** A carrier who lost the puck into their feet (a win by the other man is a turnover). */
    stripped: string | null;
    /** The first man in (+6 for the rest of it). */
    first: string | null;
    /** The man held on the boards, and whoever won the last dig round. */
    pinned: string | null;
    digLast: string | null;
    /** Each side's supporting player (a's side, b's side). */
    supportA: string | null;
    supportB: string | null;
    /** The dig winner, once decided. */
    winner: string | null;
  };
  netFront: { attacker: string; defender: string };
  looseRace: { a: string; b: string };
};

/** Each kind's own working values. */
export type ContestData = {
  /** `p`: the hitter's chance once contact is made; `recover`: how long he regathers; `result` once decided. */
  hit: { p: number; recover: number; result: 'pending' | 'landed' | 'absorbed' | 'bounced' | 'missed' };
  pokeCheck: { outcome: 'undecided' | 'take' | 'loose' | 'kept' | 'beaten' };
  boardBattle: {
    /** The puck is in their feet at `spot` (sliding there for `slide` more ticks): nobody may pick it up. */
    holdsPuck: boolean;
    slide: number;
    /** How long (s) the stripped carrier had had the puck when it went into their feet. */
    held: number;
    /** Whether the first man in is settled. */
    firstSet: boolean;
    /** Pin draws won by `a` less those won by `b`. */
    balance: number;
    /** stageT of the next pin or dig draw, and dig rounds so far. */
    nextAt: number;
    digRounds: number;
    /** The winner comes away with it clean (else it squirts loose). */
    clean: boolean;
  };
  netFront: { rounds: number; outX: number; outY: number };
  looseRace: { outcome: 'undecided' | 'a' | 'b' | 'bounce'; gap: number };
};

/** How a contest ended (the `contestEnd` event); `abandoned`: a player in it left the ice; `whistle`: play stopped. */
export type ContestOutcome =
  | 'landed' | 'absorbed' | 'bounced' | 'missed' // hit
  | 'take' | 'loose' | 'kept' | 'beaten' | 'released' | 'outOfReach' // poke check (released: he let the puck go)
  | 'protected' | 'pinned' | 'stick' | 'support' | 'scramble' | 'trapped' | 'lostTouch' // board battle
  | 'attacker' | 'defender' | 'noRound' // net-front battle
  | 'won' | 'bounce' | 'off' // loose-puck race
  | 'abandoned' | 'whistle';

/**
 * A contest under way (see contests/core.ts), what a viewer animates from. `stage` and `stageT` (seconds into that
 * stage) are kept current every tick; `leader` is whoever is ahead (null while undecided); `participants` are the
 * skaters in it now (each has `contestId` = `id`); `roles` says who plays which part; `spot` is where it happens.
 * `freeIds` are the participants who keep their normal steering (team-play job, carrier decisions, may receive a pass)
 * while in it; the contest steers the rest. `data` is the kind's own working values.
 */
export type ContestStateOf<K extends ContestKind> = {
  id: number;
  kind: K;
  stage: ContestStages[K];
  stageT: number;
  participants: string[];
  leader: string | null;
  spot: Vec2;
  freeIds: string[];
  roles: ContestRoles[K];
  data: ContestData[K];
};

export type ContestState = { [K in ContestKind]: ContestStateOf<K> }[ContestKind];

/**
 * Plain JSON data only: a viewer reads it between steps, and it holds everything that decides the rest of the game, so
 * a snapshot of it resumes exactly (restoreGame).
 */
export type GameState = {
  tick: number;
  period: number;
  /** Seconds left in the period; runs only while live. */
  clock: number;
  phase: Phase;
  /** Seconds spent in the current phase. */
  phaseT: number;
  attackDir: { home: 1 | -1; away: 1 | -1 };
  puck: Puck;
  carrierId: string | null;
  lastTouch: { id: string; side: Side } | null;
  possession: Side | null;
  skaters: SkaterState[];
  goalies: { home: GoalieState; away: GoalieState };
  contests: ContestState[];
  score: { home: number; away: number };
  faceoffSpot: Vec2;
  onIce: { home: string[]; away: string[] };
  /** Players who just released the puck and may not pick it up before tick `untilTick`. */
  pickupBlock: { ids: string[]; untilTick: number } | null;
  /**
   * A pass on its way: its intended receiver skates onto it and may take it at any speed until tick `untilTick`.
   * `tried` lists the opponents who have had their one chance to intercept it. `aim` is where it was aimed (his blade
   * where he would be when it arrived); `bobbled` is set once it has come off his stick (he takes it at the next touch).
   */
  pendingPass: { fromId: string; toId: string; untilTick: number; tried: string[]; pressure: number; aim: Vec2; bobbled: boolean } | null;
  /**
   * A turnover that may still go in the box score (see turnovers.ts): `side`'s `playerId` won the puck off `otherId`
   * (a takeaway) or `otherId` gave it to him (a giveaway, credited to `otherId`) on `tick`; it counts once `side` has
   * kept the puck for TUNING.boxScore.keepSeconds.
   */
  turnoverWatch: {
    kind: 'takeaway' | 'giveaway'; side: Side; playerId: string; otherId: string; how: 'poke' | 'battle' | 'intercepted'; tick: number; pos: Vec2;
  } | null;
  /** The last skater to let the puck go (pass, shot, dump) and the tick he did; a hit on him counts for a moment after. */
  lastRelease: { id: string; tick: number } | null;
  /** Skater `id` may not start a contest of `kind` before tick `untilTick` (expired entries are dropped). */
  contestCooldowns: { id: string; kind: string; untilTick: number }[];
  shotInFlight: ShotInFlight | null;
  /** Each team's jump on the night: rating points added to all its players' contest ratings (not faceoffs; drawn at the start). */
  teamJump: Record<Side, number>;
  /** Each goalie's night: added to his save chance's log-odds for the whole game (drawn at the start; a hot or cold night). */
  goalieNight: Record<Side, number>;
  /** The goalie of each side is screened while tick < this value (set by net-front battles). */
  screenedUntilTick: Record<Side, number>;
  /** Skater `id` has his stick tied up (no pass reception, no loose-puck pickup or race) while tick < `tick` (net-front). */
  tiedUpUntil: { id: string; tick: number }[];
  /** Skater `id` won his last net-front round: +10 in a loose-puck race (a rebound) while tick < `untilTick`. */
  reboundEdge: { id: string; untilTick: number } | null;
  /**
   * Skaters who had the puck since the last change of team or stoppage, oldest first, by `side`: the scorer's
   * assists come from here. Pickups, releases, faceoff wins and blocks count; a goalie's save does not. `ticks[i]` is
   * the last tick `ids[i]` had the puck.
   */
  touches: { side: Side | null; ids: string[]; ticks: number[] };
  /** The last skater of each side to touch the puck since the last stoppage (credited with a goal the defenders put in). */
  lastAttackTouch: Record<Side, string | null>;
  /** The side that iced the puck: it may not change lines before the next faceoff drop (set by an icing, cleared by dropPuck). */
  noChange: Side | null;
  /**
   * Delayed offside against `side`: the puck went into its attacking zone with one of its skaters already wholly in it.
   * Play goes on until that team touches the puck (whistle) or the puck leaves the zone or all of them leave it
   * (waved off). `y` is where the puck went in, for the faceoff dot.
   */
  delayedOffside: { side: Side; y: number } | null;
  /** A puck released by `side` from its own half at y = fromY, untouched since: icing if it crosses the far goal line. */
  icingWatch: { side: Side; fromY: number } | null;
  /** Each team's line rotation (see bench.ts). */
  bench: Record<Side, BenchState>;
  /** What each skater has committed to: `plans[i]` belongs to `skaters[i]` (commit.ts). */
  plans: SkaterPlan[];
  /** What the carrier has committed to and when he last decided (brain.ts); null while nobody carries. */
  carrierPlan: CarrierPlan | null;
  /** Each team's committed phase, which lags the raw one by TUNING.commit.phaseDelay (commit.ts). */
  teamPhase: Record<Side, TeamPhaseState>;
  /** The game's seed (GameSetup.seed). */
  seed: number;
  /** The random-number generator's state after the last step: with it a snapshot resumes exactly (restoreGame). */
  rng: [number, number, number, number];
};

/** One kind of unit of a team: its forward lines or its defence pairs. */
export type BenchUnit = {
  /** Index (into Lines.forwards or Lines.defence) of the unit on the ice, or coming on while `changing`. */
  cur: number;
  /** True from the start of a change until the outgoing unit is all off and the incoming one all on. */
  changing: boolean;
  /** Game clock seconds (counted from the opening faceoff) when the unit's current shift began. */
  shiftStart: number;
  /** Live seconds each unit has been credited with, by index. */
  toi: number[];
};

export type BenchState = { forwards: BenchUnit; defence: BenchUnit };

/** A team's situation, as team play sees it (team-play.ts). */
export type TeamPhase = 'breakout' | 'rush' | 'ozone' | 'forecheck' | 'neutralDefence' | 'dzone' | 'looseChase';

/** A goalie's save poses. */
export type SavePose = 'glove' | 'blocker' | 'pad' | 'butterfly';

/** How a turnover happened (`turnover`); a box-score takeaway or giveaway keeps the turnover's `how`. */
/** How a pass is played: off the forehand, the backhand, or behind him (blade.ts handFor). */
export type PassHand = 'forehand' | 'backhand' | 'behind';

export type TurnoverHow = 'poke' | 'pokeLoose' | 'hit' | 'battle' | 'battleLoose' | 'intercepted' | 'deflected';

/**
 * The structured detail of each event type. Distances are metres from the net centre to where a shot was let go;
 * `releaseTick` is the tick of the matching `release` event (the shooting animation starts there).
 */
export type EventDetails = {
  /** The draw (side, playerId: the winning team and centre; otherId: the losing centre). */
  faceoff: { spot: Vec2 };
  /** playerId let the puck go (every pass, shot and dump): velocity (m/s, z up) as it left his stick. */
  release: { kind: 'pass' | 'shot' | 'dump'; toId: string | null; vel: { x: number; y: number; z: number } };
  /**
   * A pass (otherId: its intended receiver), a dump-in (no receiver), a rim (hard round the boards, to a man or an area;
   * otherId the man or null) or a clear (out of his own zone, no receiver), at its release. `hand`: how a pass was
   * played (null for a dump, rim or clear).
   */
  pass: { kind: 'pass' | 'dump' | 'rim' | 'clear'; distance: number | null; hand: PassHand | null };
  /** A shot on goal reached the net (otherId: the goalie); followed by `save` or `goal`. releaseTick null: not shot (a pass or loose puck that slid in). */
  shot: { distance: number; releaseTick: number | null; speed: number };
  save: { pose: SavePose };
  goal: { distance: number; releaseTick: number | null };
  miss: { distance: number; releaseTick: number };
  post: { distance: number; releaseTick: number };
  /** playerId blocked otherId's shot. */
  block: { distance: number; releaseTick: number };
  hit: { result: 'landed' | 'absorbed' | 'bounced'; contestId: number };
  /** playerId won the puck off otherId (shown, not counted in the box score). */
  turnover: { how: TurnoverHow };
  /** Box score: playerId took it off otherId at `atTick` (pos is where), and his team kept it. */
  takeaway: { how: 'poke' | 'battle'; atTick: number };
  /** Box score: playerId's pass was picked off by otherId at `atTick` (pos is where), under little pressure. */
  giveaway: { how: 'intercepted'; atTick: number };
  /** playerId beat otherId in a board battle (how it was won) or a net-front battle (`netFront`). */
  battle: { how: 'protect' | 'pinned' | 'stick' | 'support' | 'scramble' | 'netFront'; contestId: number };
  /** Offside against `side`; faceoff at `spot`. */
  offside: { spot: Vec2 };
  /** Icing by `side`; faceoff at `spot`. */
  icing: { spot: Vec2 };
  /** Play stopped: the goalie (playerId) held a save or covered a loose puck, or the puck was trapped in a board battle. */
  freeze: { cause: 'save' | 'cover' | 'trapped' };
  /** `side` started changing a unit from line/pair `from` to `to` (0-based), on the fly or at a stoppage. */
  lineChange: { unit: 'forwards' | 'defence'; from: number; to: number; onTheFly: boolean; phase: TeamPhase };
  periodEnd: { period: number };
  /** A contest began (pos: its spot). */
  contestStart: { contestId: number; kind: ContestKind; participants: string[] };
  /** A contest ended: how, who won it, and what happened to the puck. */
  contestEnd: { contestId: number; kind: ContestKind; result: ContestOutcome; winnerId: string | null; puck: 'toWinner' | 'loose' | 'unchanged' };
};

export type GameEventType = keyof EventDetails;

/** What every event has. `pos` is where on the ice it happened (m). `side` is null only for periodEnd and contest events. */
export type GameEventBase = {
  tick: number;
  period: number;
  clock: number;
  side: Side | null;
  playerId: string | null;
  otherId: string | null;
  assistIds: string[];
  pos: Vec2;
  /** On a goal: the skaters of each side on the ice when it went in (for plus/minus). */
  onIce?: { home: string[]; away: string[] };
};

export type GameEventOf<T extends GameEventType> = GameEventBase & { type: T; detail: EventDetails[T] };

export type GameEvent = { [T in GameEventType]: GameEventOf<T> }[GameEventType];

export type PlayerLine = {
  id: string;
  goals: number;
  assists: number;
  shots: number;
  hits: number;
  blocks: number;
  takeaways: number;
  giveaways: number;
  faceoffsWon: number;
  faceoffsLost: number;
  plusMinus: number;
  toiSeconds: number;
  battlesWon: number;
  battlesLost: number;
  saves: number;
  shotsAgainst: number;
};

export type TeamLine = { shots: number; hits: number; blocks: number; faceoffsWon: number; giveaways: number; takeaways: number };

export type GameResult = {
  score: { home: number; away: number };
  tied: boolean;
  team: Record<Side, TeamLine>;
  players: PlayerLine[];
  events: GameEvent[];
  seed: number;
};
