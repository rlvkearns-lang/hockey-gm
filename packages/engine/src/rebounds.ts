/**
 * What a save does with the puck (Task 8): the goalie holds it (a whistle), steers it toward a corner, or leaves a
 * rebound in front of him. The puck leaves from the save point, where it met him at his plane, never from behind him.
 */
import { gameEvent as gameEvent_ } from './events';
import { stopPlay as stopPlay_ } from './faceoff';
import { FACEOFF_DOTS as FACEOFF_DOTS_, resolveBoards as resolveBoards_ } from './rink';
import type { Rng } from './rng';
import { TUNING as TUNING_ } from './tuning';
import type { Crossing, GameEvent, GameState, SaveKind, SavePose, Side } from './types';
import type { Vec2 } from './vec';
import { datan2 as datan2_, dcos as dcos_, dsin as dsin_ } from './dmath';
import { clamp as clamp_, PUCK_RADIUS as PUCK_RADIUS_ } from './util';
const gameEvent = gameEvent_;
const stopPlay = stopPlay_;
const FACEOFF_DOTS = FACEOFF_DOTS_;
const resolveBoards = resolveBoards_;
const TUNING = TUNING_;
const datan2 = datan2_;
const dcos = dcos_;
const dsin = dsin_;
const clamp = clamp_;
const PUCK_RADIUS = PUCK_RADIUS_;

const G = TUNING.goalie;
const R = TUNING.goalie.rebound;
/** How long (s) he shows holding the puck (TUNING.goalie.rebound.coverSeconds). */
const COVER_SECONDS = R.coverSeconds;

/**
 * What decides a save's outcome: his pose, the shot's speed (m/s), a screen, a tip, his reboundControl, and his badges
 * (Task 12): Rebound Control, Glove Hand.
 */
export type SaveFacts = { pose: SavePose; speed: number; screened: boolean; tipped: boolean; reboundControl: number; reboundControlBadge?: boolean; gloveHandBadge?: boolean };

/**
 * Chances of each outcome; each within [0.03, 0.97] and summing to 1. held: G.freeze[pose] (base + perPoint *
 * reboundControl) less 0.004 per m/s over 25, less 0.08 screened, less 0.12 tipped; of the rest, steered: R.steered.base (0.3; 0.35 until the Task 8b close-out, for more rebounds) + 0.005 *
 * (reboundControl - 50), less 0.1 tipped; the rest leave a rebound. Badges (Task 12, TUNING.badges): Rebound Control adds
 * reboundControlShare to held and to steered; Glove Hand adds gloveHeld to held on a glove save.
 */
export function saveOutcomeChances(f: SaveFacts): Record<SaveKind, number> {
  const fz = G.freeze[f.pose];
  const B = TUNING.badges, rc = f.reboundControlBadge === true ? B.reboundControlShare : 0;
  const held = clamp(fz.base + fz.perPoint * f.reboundControl - R.heldPerSpeed * Math.max(0, f.speed - R.heldFrom)
    - (f.screened ? R.heldScreened : 0) - (f.tipped ? R.heldTipped : 0) + rc + (f.gloveHandBadge === true && f.pose === 'glove' ? B.gloveHeld : 0), 0.03, 0.94);
  const rest = 1 - held;
  const share = R.steered.base + R.steered.perPoint * (f.reboundControl - 50) - (f.tipped ? R.steered.tipped : 0);
  // Each of the two at least 0.03 (rest is at least 0.06).
  const steered = clamp(rest * share + rc, 0.03, rest - 0.03);
  return { held, steered, rebound: rest - steered };
}

/** The end-zone faceoff dot on `end` nearest to `p`. */
function endDotNear(end: 1 | -1, p: Vec2): Vec2 {
  let best = FACEOFF_DOTS.end[0]!, bestD = Infinity;
  for (const d of FACEOFF_DOTS.end) {
    if (d.x * end <= 0) continue;
    const dd = Math.abs(d.y - p.y);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/**
 * Draws the outcome of a save by the goalie of `goalieSide` and moves the puck from the save point (the puck is there
 * now, `cross` says where on him). held: `freeze` (cause 'save') and a whistle, as before. steered: toward the corner on
 * the side it came to (the side of his centre it met him on), 55 to 80 degrees off straight out, 6 to 9 m/s. rebound
 * (Task 8 review, Important 2): it comes off him at a share of the shot's speed set by his reboundControl and the pose
 * (a pad or blocker livelier than the chest or glove), within 2.5 to 6 m/s; along R.reflect of the shot's reflected line
 * (the puck's velocity as it met him, mirrored in his plane), turned further to the side it met him on by a blocker
 * (R.blockerTurn) or a pad (R.padTurn), with a normal error that shrinks with reboundControl; never more than 35 degrees
 * plus 0.3 per point of reboundControl under 100 off straight out (50 at 50), so that it is still in front half a second
 * later. Sets state.lastSave (a held save's is cleared by the whistle). Returns the kind.
 */
export function saveOutcome(state: GameState, goalieSide: Side, f: SaveFacts, cross: Crossing, rng: Rng, out: GameEvent[], cause: 'save' | 'cover' = 'save'): SaveKind {
  const c = saveOutcomeChances(f);
  const u = rng.next();
  const kind: SaveKind = u < c.held ? 'held' : u < c.held + c.steered ? 'steered' : 'rebound';
  const g = state.goalies[goalieSide];
  const end = (-state.attackDir[goalieSide]) as 1 | -1;
  const pk = state.puck;
  // The shot's line as it met him (the puck still has the shot's velocity).
  const inX = pk.vel.x, inY = pk.vel.y;
  state.lastSave = { side: goalieSide, tick: state.tick, kind };
  state.carrierId = null;
  state.lastTouch = { id: g.id, side: goalieSide };
  state.icingWatch = null; // the goalie played it
  state.hardClear = null;
  pk.z = 0;
  pk.vz = 0;
  if (kind === 'held') {
    g.pose = 'cover';
    g.poseT = COVER_SECONDS;
    pk.vel.x = 0;
    pk.vel.y = 0;
    out.push(gameEvent(state, { type: 'freeze', side: goalieSide, playerId: g.id, otherId: null, pos: pk.pos, detail: { cause } }));
    stopPlay(state, endDotNear(end, pk.pos));
    return kind;
  }
  // Straight out from his net is -end along x. An angle `rel` off it turns toward +y for the net at -x (end -1) and
  // toward -y for the net at +x: toward world side sy, rel = sy * -end.
  const out0 = end === 1 ? Math.PI : 0;
  let rel: number, speed: number;
  if (kind === 'steered') {
    // To the side it met him on (his left is world y * -end); dead centre, either.
    const sy = cross.side !== 0 ? (cross.side * -end >= 0 ? 1 : -1) : rng.chance(0.5) ? 1 : -1;
    rel = sy * -end * rng.range(R.steeredAngle[0], R.steeredAngle[1]);
    speed = rng.range(R.steeredSpeed[0], R.steeredSpeed[1]);
  } else {
    const max = R.maxAngle.base + R.maxAngle.perPoint * (100 - f.reboundControl);
    // The reflected line off straight out: mirrored in his plane, a shot moving toward +y goes on toward +y.
    const into = inX * end;
    const refl = into > 0 ? datan2(inY, into) * -end : 0;
    const sideTurn = cross.side === 0 ? 0 : (cross.side * -end >= 0 ? 1 : -1) * -end;
    const turn = f.pose === 'blocker' ? R.blockerTurn : f.pose === 'pad' ? R.padTurn : 0;
    rel = clamp(refl * R.reflect + sideTurn * turn + rng.gauss() * (R.spread.base + R.spread.perPoint * (100 - f.reboundControl)), -max, max);
    speed = clamp(f.speed * clamp(R.speedShare.base - R.speedShare.perPoint * f.reboundControl, R.speedShare.min, R.speedShare.max) * R.poseSpeed[f.pose], R.speed[0], R.speed[1]);
  }
  const a = out0 + rel;
  pk.vel.x = dcos(a) * speed;
  pk.vel.y = dsin(a) * speed;
  resolveBoards(pk.pos, pk.vel, PUCK_RADIUS, 0);
  return kind;
}
