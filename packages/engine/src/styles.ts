/**
 * Player styles that combine (Task 12, design A7): every skater has a primary style and may have a secondary one of
 * the same group (forwards or defencemen). His habits are a blend, two thirds primary and one third secondary; he is
 * named secondary-then-primary ("Sniping Power Forward"). The label describes him: styleOf works it out from his
 * attributes and habits, unless his PlayerDef sets it (the override). Styles shade his choices through his habits
 * (tendencies); they decide nothing.
 */
import { SKATER_ATTRS, type SkaterAttrs } from './attributes';
import { PLAYER_TYPES } from './player-types';
import { TUNING } from './tuning';
import type { PlayerDef, Position, Style, Tendencies } from './types';
import { clamp } from './util';

export type StyleDef = { group: 'F' | 'D'; adjective: string; habits: Required<Tendencies>; attrBias: Partial<SkaterAttrs>; typeKey: string };

const S = TUNING.styles;

/** The habits in a fixed order. */
export const HABITS: readonly (keyof Required<Tendencies>)[] = ['shoot', 'pass', 'carry', 'dump', 'hit', 'forecheck', 'netFront', 'joinRush', 'block'];

/** A style built on the PLAYER_TYPES entry `typeKey`: its habits (with `block`) and attribute bias. */
function styleOn(typeKey: string, group: 'F' | 'D', adjective: string, block: number): StyleDef {
  const t = PLAYER_TYPES[typeKey]!;
  return { group, adjective, habits: { ...(t.tendencies as Required<Tendencies>), block }, attrBias: t.attrBias, typeKey };
}

/** Every style, its group, the adjective it lends as a secondary, its habits and attribute bias, and its PLAYER_TYPES key. */
export const STYLES: Record<Style, StyleDef> = {
  Sniper: styleOn('Sniper', 'F', 'Sniping', 0.2),
  Playmaker: styleOn('Playmaker', 'F', 'Playmaking', 0.2),
  'Power Forward': styleOn('Power Forward', 'F', 'Power', 0.5),
  'Two-Way Forward': styleOn('Two-Way Forward', 'F', 'Two-Way', 0.6),
  'Shutdown Forward': styleOn('Shutdown Forward', 'F', 'Shutdown', 0.8),
  Speedster: styleOn('Speedster', 'F', 'Speedy', 0.2),
  Grinder: styleOn('Grinder', 'F', 'Grinding', 0.7),
  Enforcer: styleOn('Enforcer', 'F', 'Physical', 0.5),
  'Offensive Defenceman': styleOn('Offensive Defenceman', 'D', 'Offensive', 0.4),
  'Defensive Defenceman': styleOn('Shutdown Defenceman', 'D', 'Defensive', 0.85),
  'Two-Way Defenceman': styleOn('Two-Way Defenceman', 'D', 'Two-Way', 0.6),
};

/** The style group of a position: 'F' forwards, 'D' defencemen, null a goalie. */
export function groupOf(pos: Position): 'F' | 'D' | null {
  return pos === 'G' ? null : pos === 'LD' || pos === 'RD' ? 'D' : 'F';
}

/** The styles a man in position `pos` can have as his primary (as a type: PLAYER_TYPES positions; an Enforcer is a winger). */
export function stylesFor(pos: Position): Style[] {
  return (Object.keys(STYLES) as Style[]).filter((k) => PLAYER_TYPES[STYLES[k].typeKey]!.positions.includes(pos));
}

/** The styles of `group`, in catalogue order. */
export function stylesOf(group: 'F' | 'D'): Style[] {
  return (Object.keys(STYLES) as Style[]).filter((k) => STYLES[k].group === group);
}

/** Two thirds primary, one third secondary (all primary when secondary is null), habit by habit. */
export function blendHabits(primary: Style, secondary: Style | null): Required<Tendencies> {
  const p = STYLES[primary].habits;
  if (secondary === null) return { ...p };
  const s = STYLES[secondary].habits, w = S.secondaryShare;
  const out = {} as Required<Tendencies>;
  for (const k of HABITS) out[k] = (1 - w) * p[k] + w * s[k];
  return out;
}

/** Secondary's adjective then the primary's name: "Sniping Power Forward"; the primary's name alone when pure. */
export function styleLabel(primary: Style, secondary: Style | null): string {
  return secondary === null ? primary : `${STYLES[secondary].adjective} ${primary}`;
}

/** How well `d` matches style `k` (0 to 1): attributes against its bias and habits against its habits (TUNING.styles). */
function styleScore(d: PlayerDef, k: Style, mean: number): number {
  const st = STYLES[k];
  let num = 0, den = 0;
  for (const a of SKATER_ATTRS) {
    const b = st.attrBias[a];
    if (b === undefined) continue;
    num += b * (d.attrs[a] - mean);
    den += Math.abs(b);
  }
  const attr = clamp(0.5 + (den === 0 ? 0 : num / den) / S.attrSpan, 0, 1);
  let diff = 0;
  for (const h of HABITS) diff += Math.abs((d.tendencies[h] ?? 0.5) - st.habits[h]);
  const habit = 1 - diff / HABITS.length;
  return S.attrWeight * attr + (1 - S.attrWeight) * habit;
}

/** The style his type declares (the one built on his PLAYER_TYPES entry), if it is a style of `group`. */
function declaredStyle(def: PlayerDef, group: 'F' | 'D'): Style | null {
  for (const k of stylesOf(group)) if (STYLES[k].typeKey === def.type) return k;
  return null;
}

/**
 * The secondary his habits were built with (Task 14b, Task 13b review Minor 11): the style k of his group, not his
 * primary, whose blend blendHabits(primary, k) is nearest his habits, if nearer than his primary's habits alone; else
 * null. His habits do not move with his attributes, so this anchors the secondary as his type anchors the primary.
 */
function builtSecondary(def: PlayerDef, primary: Style, group: 'F' | 'D'): Style | null {
  const dist = (h: Required<Tendencies>): number => { let d = 0; for (const k of HABITS) d += Math.abs((def.tendencies[k] ?? 0.5) - h[k]); return d; };
  let best: Style | null = null, bd = dist(STYLES[primary].habits);
  for (const k of stylesOf(group)) {
    if (k === primary) continue;
    const d = dist(blendHabits(primary, k));
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** styleOf's reading of `def` (no override): primary and secondary, their scores, and the declared style's score. */
function readStyles(def: PlayerDef, group: 'F' | 'D'): { primary: Style; ps: number; next: Style | null; ns: number; declared: Style | null; ds: number; best: Style; bs: number; secondary: Style | null; ss: number; built: Style | null } {
  let mean = 0;
  for (const a of SKATER_ATTRS) mean += def.attrs[a];
  mean /= SKATER_ATTRS.length;
  const declared = declaredStyle(def, group);
  let best: Style | null = null, bs = -Infinity, ds = -Infinity;
  const scores: [Style, number][] = [];
  for (const k of stylesOf(group)) {
    const v = styleScore(def, k, mean);
    scores.push([k, v]);
    if (v > bs) { best = k; bs = v; }
    if (k === declared) ds = v;
  }
  // Task 13b: his declared style stays primary unless another beats it by keepMargin (hysteresis: a label changes only
  // when the evidence clearly crosses).
  const primary = declared !== null && bs <= ds + S.keepMargin ? declared : best!;
  const ps = primary === declared ? ds : bs;
  let next: Style | null = null, ns = -Infinity;
  for (const [k, v] of scores) if (k !== primary && v > ns) { next = k; ns = v; }
  // The secondary (Task 14b): the one his habits were built with stays his secondary unless another scores keepMargin
  // more, and it stays while it scores secondaryWithin - secondaryMargin of the primary; with none built in, the next best
  // becomes his secondary only from secondaryWithin + secondaryMargin.
  const built = builtSecondary(def, primary, group);
  let sec: Style | null = next, ss = ns;
  if (built !== null) {
    const bv = scores.find(([k]) => k === built)![1];
    if (ns <= bv + S.keepMargin) { sec = built; ss = bv; }
  }
  const from = built !== null && sec === built ? S.secondaryWithin - S.secondaryMargin : S.secondaryWithin + S.secondaryMargin;
  const secondary = sec !== null && ss >= from * ps ? sec : null;
  return { primary, ps, next, ns, declared, ds, best: best!, bs, secondary, ss, built };
}

/**
 * His style: `def.style` when set; otherwise each style of his group is scored by how well his attributes match its attrBias
 * (mean of bias-weighted attribute differences from his own mean) and his habits match its habits (1 - mean absolute difference).
 * The primary is the style his type declares unless another scores TUNING.styles.keepMargin more (Task 13b; then the
 * best). The secondary (Task 14b) is the one his habits were built with (builtSecondary) unless another scores keepMargin
 * more, kept while it scores at least secondaryWithin - secondaryMargin of the primary's; with none built in, the next
 * best from secondaryWithin + secondaryMargin. Goalies: null.
 */
export function styleOf(def: PlayerDef): { primary: Style; secondary: Style | null; label: string } | null {
  const group = groupOf(def.position);
  if (group === null) return null;
  if (def.style) return { primary: def.style.primary, secondary: def.style.secondary, label: styleLabel(def.style.primary, def.style.secondary) };
  const r = readStyles(def, group);
  return { primary: r.primary, secondary: r.secondary, label: styleLabel(r.primary, r.secondary) };
}

/**
 * How near `def`'s label is to changing (Task 13b, for tests): `challenger`, the best other style's score less his
 * declared style's (the primary changes when it is over TUNING.styles.keepMargin; NaN with no declared style), and
 * `secondaryRatio`, the next style's score over the primary's (a secondary from TUNING.styles.secondaryWithin), and
 * `secondaryTie`, how much the next style outscores the one after it (which of the two is his secondary).
 */
export function styleGaps(def: PlayerDef): { challenger: number; secondaryRatio: number; secondaryTie: number; secondaryFrom: number; builtChallenger: number } {
  const group = groupOf(def.position);
  if (group === null) return { challenger: NaN, secondaryRatio: NaN, secondaryTie: NaN, secondaryFrom: NaN, builtChallenger: NaN };
  const r = readStyles(def, group);
  let other = -Infinity, third = -Infinity;
  const mean = SKATER_ATTRS.reduce((t, a) => t + def.attrs[a], 0) / SKATER_ATTRS.length;
  for (const k of stylesOf(group)) {
    const v = styleScore(def, k, mean);
    if (k !== r.declared) other = Math.max(other, v);
    if (k !== r.primary && k !== r.next) third = Math.max(third, v);
  }
  // Task 14b: `secondaryRatio` is now the secondary candidate's (the built one, or the next best) score over the primary's,
  // `secondaryFrom` the ratio it must reach, `builtChallenger` the next best's score less the built secondary's (NaN with none).
  const builtScore = r.built === null ? NaN : styleScore(def, r.built, mean);
  const cand = r.built !== null && r.ns <= builtScore + S.keepMargin;
  const from = cand ? S.secondaryWithin - S.secondaryMargin : S.secondaryWithin + S.secondaryMargin;
  return { challenger: r.declared === null ? NaN : other - r.ds, secondaryRatio: (cand ? builtScore : r.ns) / r.ps, secondaryTie: r.ns - third, secondaryFrom: from, builtChallenger: r.built === null || r.next === r.built ? NaN : r.ns - builtScore };
}
