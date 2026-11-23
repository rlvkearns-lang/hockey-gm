/**
 * Segment lengths and girths (metres) of a skater in full gear, from his height and weight. Proportions follow standard
 * anthropometric tables (segment lengths as fractions of standing height), plus skates and pads.
 */
export type BodyDims = {
  /** Pelvis (hip joint) height above the ice in his relaxed ready stance, knees bent. */
  hipHeight: number;
  /** Hip joint to knee. */
  thigh: number;
  /** Knee to ankle. */
  shin: number;
  /** Ankle to the ice (boot and blade). */
  skate: number;
  /** Hip joint line to shoulder joint line. */
  torso: number;
  /** Shoulder to elbow. */
  upperArm: number;
  /** Elbow to the middle of the gripping hand. */
  forearm: number;
  /** Between the shoulder joints, pads included. */
  shoulderWidth: number;
  /** Between the hip joints. */
  hipWidth: number;
  /** Head with helmet. */
  headRadius: number;
  /** Torso half-depth (girth), grows with weight for his height. */
  bulk: number;
  /** Stick length, butt to heel. */
  stick: number;
};

/** Hip joint height in the ready stance as a share of the straight leg (thigh + shin + skate). */
export const STANCE_HIP = 0.9;

export function bodyDims(heightCm: number, weightKg: number): BodyDims {
  const h = Math.max(1.2, heightCm / 100);
  const w = Math.max(40, weightKg);
  // Girth for a given height grows with the square root of weight per unit height; 1 for 90 kg at 185 cm.
  const girth = Math.sqrt(w / h / (90 / 1.85));
  const thigh = 0.245 * h;
  const shin = 0.246 * h;
  const skate = 0.039 * h + 0.075;
  return {
    hipHeight: STANCE_HIP * (thigh + shin + skate),
    thigh,
    shin,
    skate,
    torso: 0.288 * h,
    upperArm: 0.186 * h,
    forearm: 0.146 * h + 0.04,
    shoulderWidth: 0.235 * h * (0.85 + 0.15 * girth),
    hipWidth: 0.1 * h * (0.9 + 0.1 * girth),
    headRadius: 0.062 * h,
    bulk: 0.15 * girth * (h / 1.85),
    stick: 0.77 * h,
  };
}
