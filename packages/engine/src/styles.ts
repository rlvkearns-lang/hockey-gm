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

/**
 * His style: `def.style` when set; otherwise each style of his group is scored by how well his attributes match its attrBias
 * (mean of bias-weighted attribute differences from his own mean) and his habits match its habits (1 - mean absolute difference);
 * the best is primary, and the next is secondary when its score is at least 0.85 of the best. Goalies: null.
 */
export function styleOf(def: PlayerDef): { primary: Style; secondary: Style | null; label: string } | null {
  const group = groupOf(def.position);
  if (group === null) return null;
  if (def.style) return { primary: def.style.primary, secondary: def.style.secondary, label: styleLabel(def.style.primary, def.style.secondary) };
  let mean = 0;
  for (const a of SKATER_ATTRS) mean += def.attrs[a];
  mean /= SKATER_ATTRS.length;
  let best: Style | null = null, next: Style | null = null, bs = -Infinity, ns = -Infinity;
  for (const k of stylesOf(group)) {
    const v = styleScore(def, k, mean);
    if (v > bs) { next = best; ns = bs; best = k; bs = v; } else if (v > ns) { next = k; ns = v; }
  }
  const secondary = next !== null && ns >= S.secondaryWithin * bs ? next : null;
  return { primary: best!, secondary, label: styleLabel(best!, secondary) };
}
