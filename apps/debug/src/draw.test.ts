import { describe, expect, it } from 'vitest';
import { generateTeam, createGame, RINK, type ContestState, type PlayerDef } from '@hockey/engine';
import { draw, labelFor, rinkSize } from './draw';

const defsWith = (names: Record<string, string>): Map<string, PlayerDef> => {
  const base = generateTeam(1, 'T', 'TTT').players[0]!;
  return new Map(Object.entries(names).map(([id, name]) => [id, { ...base, id, name }]));
};

describe('labelFor', () => {
  it('labels a contest with kind, stage and leader', () => {
    expect(labelFor({ id: 1, kind: 'boardBattle', stage: 'pin', stageT: 0.4, participants: ['a', 'b'], leader: 'a', spot: { x: 0, y: 0 }, freeIds: [], data: {} } satisfies ContestState, defsWith({ a: 'Dmitri Osgood', b: 'Finn Aldous' }))).toBe('Board battle · pin · Osgood leading');
    expect(labelFor({ id: 2, kind: 'looseRace', stage: 'race', stageT: 0, participants: ['a', 'b'], leader: null, spot: { x: 0, y: 0 }, freeIds: [], data: {} } satisfies ContestState, defsWith({ a: 'A B', b: 'C D' }))).toBe('Loose-puck race · race');
  });
});

/** A context that records what is drawn, enough to check draw() without a browser. */
function recorder() {
  const calls: string[] = [];
  const texts: string[] = [];
  const target = {
    fillText: (t: string) => { texts.push(t); },
    measureText: (t: string) => ({ width: t.length * 5 }),
    set fillStyle(_v: unknown) {}, set strokeStyle(_v: unknown) {}, set lineWidth(_v: number) {}, set font(_v: string) {},
    set textAlign(_v: string) {}, set textBaseline(_v: string) {}, set globalAlpha(_v: number) {}, set lineCap(_v: string) {},
  } as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => { calls.push(`${k}(${args.length})`); }),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, texts };
}

describe('draw', () => {
  it('sizes the canvas from the rink', () => {
    const s = rinkSize(10);
    expect(s.w).toBeCloseTo(10 * (2 * RINK.halfLength + 4));
    expect(s.h).toBeCloseTo(10 * (2 * RINK.halfWidth + 4));
  });

  it('draws only skaters on the ice, with their numbers, and a contest label', () => {
    const setup = { home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northern Peaks', 'NPK'), seed: 5, chemistry: [] };
    const game = createGame(setup);
    for (let i = 0; i < 600; i++) game.step();
    const defs = new Map<string, PlayerDef>();
    for (const t of [setup.home, setup.away]) for (const p of t.players) defs.set(p.id, p);
    const onIce = game.state.skaters.filter((s) => s.onIce);
    const [a, b] = onIce;
    game.state.contests.push({ id: 99, kind: 'hit', stage: 'close', stageT: 0, participants: [a!.id, b!.id], leader: null, spot: { x: 0, y: 0 }, freeIds: [], data: {} });
    const { ctx, calls, texts } = recorder();
    draw(ctx, game.state, defs, 10);
    expect(calls.filter((c) => c.startsWith('arc')).length).toBeGreaterThanOrEqual(onIce.length);
    for (const s of onIce) expect(texts).toContain(String(defs.get(s.id)!.number));
    expect(texts.some((t) => t.startsWith('Hit'))).toBe(true);
  });

  it('exaggerates skaters, keeps a minimum radius, and draws the puck last and large', () => {
    const setup = { home: generateTeam(1, 'Harbour City', 'HBR'), away: generateTeam(2, 'Northern Peaks', 'NPK'), seed: 5, chemistry: [] };
    const game = createGame(setup);
    const defs = new Map<string, PlayerDef>();
    for (const t of [setup.home, setup.away]) for (const p of t.players) defs.set(p.id, p);
    const arcs: number[] = [];
    const target = { fillText() {}, measureText: () => ({ width: 10 }), arc: (_x: number, _y: number, r: number) => { arcs.push(r); } } as Record<string, unknown>;
    const ctx = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    draw(ctx, game.state, defs, 2, { minRadiusPx: 8 });
    const onIce = game.state.skaters.filter((s) => s.onIce).length;
    const skaterArcs = arcs.filter((_r, i) => i >= arcs.length - 1 - onIce && i < arcs.length - 1);
    expect(skaterArcs.length).toBe(onIce);
    for (const r of skaterArcs) expect(r).toBeGreaterThanOrEqual(8 * 0.34 / 0.4);
    // The last arc is the puck, larger than its true 0.05 m radius and at least half the minimum skater radius.
    expect(arcs[arcs.length - 1]!).toBeGreaterThanOrEqual(4);
  });
});
