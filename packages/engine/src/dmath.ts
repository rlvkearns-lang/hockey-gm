/**
 * Deterministic math: the transcendental functions the engine needs, built only from + - * /, exact scaling by powers
 * of two and the IEEE-754 bit layout, so every JavaScript engine returns the same bits for the same input. (Math.sin,
 * Math.exp and the rest, and the ** operator, are not specified to the last bit and do differ between V8 builds and
 * browsers; Math.sqrt is correctly rounded everywhere and may be used freely.)
 *
 * Accuracy is a few units in the last place over the ranges the engine uses (angles within a few turns, exponents of
 * ordinary size); test/dmath.test.ts checks it against Math.*. Engine code must use these instead of Math.* (see
 * test/purity.test.ts).
 */

const LN2_HI = 6.93147180369123816490e-1; // ln 2, high part: trailing zero bits, so k * LN2_HI is exact for |k| < 2^11
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;
const PIO2_HI = 1.57079632673412561417; // pi / 2, high part (33 bits): k * PIO2_HI is exact for |k| < 2^20
const PIO2_LO = 6.07710050650619224932e-11;
const TWO_OVER_PI = 6.36619772367581382433e-1;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const SIXTH_PI = 0.5235987755982988;
const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;
const SQRT2 = 1.4142135623730951;

/** Smallest and largest k for which POW2[k - POW2_MIN] = 2^k is a normal double. */
const POW2_MIN = -1022;
const POW2_MAX = 1023;
const POW2: number[] = (() => {
  const t = new Array<number>(POW2_MAX - POW2_MIN + 1);
  let v = 1;
  for (let k = 0; k <= POW2_MAX; k++) { t[k - POW2_MIN] = v; v *= 2; }
  v = 1;
  for (let k = 0; k >= POW2_MIN; k--) { t[k - POW2_MIN] = v; v *= 0.5; }
  return t;
})();

/** 1/n! for n = 0..13 (exp), and the Taylor coefficients of sin and cos. */
const EXP_C: number[] = [];
const SIN_C: number[] = [];
const COS_C: number[] = [];
{
  let f = 1;
  for (let n = 0; n <= 21; n++) {
    if (n > 0) f *= n;
    if (n <= 13) EXP_C.push(1 / f);
    if (n % 2 === 1) SIN_C.push((((n - 1) / 2) % 2 === 0 ? 1 : -1) / f);
    else if (n <= 20) COS_C.push(((n / 2) % 2 === 0 ? 1 : -1) / f);
  }
}
/** 1/(2j+1) for the log series, j = 0..13; (-1)^j/(2j+1) for the atan series, j = 0..18. */
const LOG_C: number[] = [];
const ATAN_C: number[] = [];
for (let j = 0; j <= 18; j++) {
  if (j <= 13) LOG_C.push(1 / (2 * j + 1));
  ATAN_C.push((j % 2 === 0 ? 1 : -1) / (2 * j + 1));
}

/** Horner evaluation of sum c[i] * x^i. */
function poly(c: readonly number[], x: number): number {
  let p = c[c.length - 1]!;
  for (let i = c.length - 2; i >= 0; i--) p = p * x + c[i]!;
  return p;
}

/** e^x. Below -708 (where the result would be subnormal) it returns 0. */
export function dexp(x: number): number {
  if (x !== x) return x;
  if (x > 709.78) return Infinity;
  if (x < -708) return 0;
  const k = Math.round(x * INV_LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO; // |r| <= ~0.347
  const p = poly(EXP_C, r);
  return k > POW2_MAX ? p * POW2[POW2_MAX - POW2_MIN]! * 2 : p * POW2[k - POW2_MIN]!;
}

const bits = new DataView(new ArrayBuffer(8));
const TWO_54 = 18014398509481984;

/** Natural logarithm. */
export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= TWO_54; k = -54; } // subnormal: make it normal first
  bits.setFloat64(0, x);
  const hi = bits.getUint32(0);
  k += ((hi >>> 20) & 0x7ff) - 1023;
  bits.setUint32(0, (hi & 0x000fffff) | 0x3ff00000); // the mantissa, as a number in [1, 2)
  let m = bits.getFloat64(0);
  if (m > SQRT2) { m *= 0.5; k++; }
  const t = (m - 1) / (m + 1); // |t| <= 0.1716
  const s = poly(LOG_C, t * t);
  return k * LN2_HI + (2 * t * s + k * LN2_LO);
}

/** sin and cos of r in [-pi/4, pi/4]. */
const sinK = (r: number): number => r * poly(SIN_C, r * r);
const cosK = (r: number): number => poly(COS_C, r * r);

/** Quadrant (0..3) and reduced argument of x: x = q * pi/2 + r. Exact reduction for |x| < 2^20 * pi/2. */
let redR = 0;
function reduce(x: number): number {
  const k = Math.round(x * TWO_OVER_PI);
  redR = (x - k * PIO2_HI) - k * PIO2_LO;
  return ((k % 4) + 4) % 4;
}

export function dsin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const q = reduce(x), r = redR;
  return q === 0 ? sinK(r) : q === 1 ? cosK(r) : q === 2 ? -sinK(r) : -cosK(r);
}

export function dcos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const q = reduce(x), r = redR;
  return q === 0 ? cosK(r) : q === 1 ? -sinK(r) : q === 2 ? -cosK(r) : sinK(r);
}

/** Arc tangent, in (-pi/2, pi/2). */
export function datan(x: number): number {
  if (x !== x) return x;
  const neg = x < 0;
  let a = neg ? -x : x;
  const inv = a > 1;
  if (inv) a = 1 / a;
  let add = 0;
  if (a > TAN_PI_12) { a = (a * SQRT3 - 1) / (a + SQRT3); add = SIXTH_PI; } // tan(t - pi/6)
  let r = add + a * poly(ATAN_C, a * a);
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

/**
 * Angle of (x, y), in (-pi, pi]. Unlike Math.atan2 it ignores the sign of zero (atan2(-0, -1) is pi, not -pi), so a
 * state that has been through JSON (which drops the sign of -0) gives the same answer.
 */
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (y === 0) return x < 0 ? PI : 0;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  const a = datan(y / x);
  if (x > 0) return a;
  return y > 0 ? a + PI : a - PI;
}

export function dtanh(x: number): number {
  if (x !== x) return x;
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e = dexp(2 * x);
  return (e - 1) / (e + 1);
}

/** a^b for a >= 0 (NaN for a < 0, except that b = 0 always gives 1). */
export function dpow(a: number, b: number): number {
  if (b === 0) return 1;
  if (a !== a || b !== b || a < 0) return NaN;
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a === 1) return 1;
  return dexp(b * dlog(a));
}

/** sqrt(x*x + y*y + z*z), scaled so it neither overflows nor underflows. */
export function hypot3(x: number, y: number, z: number): number {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax === Infinity || ay === Infinity || az === Infinity) return Infinity;
  const m = Math.max(ax, ay, az);
  if (m === 0) return 0;
  const nx = ax / m, ny = ay / m, nz = az / m;
  return Math.sqrt(nx * nx + ny * ny + nz * nz) * m;
}
