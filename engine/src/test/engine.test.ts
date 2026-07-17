/**
 * Engine <-> circuit lockstep tests.
 *
 * The generated pureCircuits (the EXACT code submitRun runs in-circuit) are
 * the referee: levelgen goldens compare engine output to buildLevelFrom, and
 * the property suite proves every engine-produced RunBundle through
 * verifyRunPure.
 */

import { describe, expect, it } from 'vitest';
import { pureCircuits } from '@moonray/contract';
import {
  AREA_TOL,
  FIELD_PRIME,
  activeObjects,
  applyCut,
  assignObjects,
  buildRunBundle,
  clipLineToRect,
  cutTooCloseToObject,
  divRound,
  doubleArea,
  levelFromEntropy,
  levelValue,
  newGame,
  type PlayState,
  type Pt,
  seedIsUsable,
  splitEntropy,
} from '../index.js';

// deterministic PRNG for reproducible property tests
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomSeed = (rnd: () => number): bigint => {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 32n) | BigInt(Math.floor(rnd() * 0x100000000));
  return v % FIELD_PRIME;
};

const usableSeed = (rnd: () => number): bigint => {
  for (;;) {
    const seed = randomSeed(rnd);
    if (seedIsUsable(pureCircuits.levelEntropy(seed))) return seed;
  }
};

const gridPt = (rnd: () => number): Pt => ({
  x: BigInt(600 + Math.floor(rnd() * 2900)),
  y: BigInt(600 + Math.floor(rnd() * 2900)),
});

/** Try to apply a random cut; returns the new state or null. */
const tryRandomCut = (state: PlayState, rnd: () => number): PlayState | null => {
  for (let attempt = 0; attempt < 25; attempt++) {
    const a = gridPt(rnd);
    const b = gridPt(rnd);
    const res = applyCut(state, a, b);
    if (res.ok) return res.state;
  }
  return null;
};

const verifyBundleThroughCircuit = (state: PlayState, entropy: bigint, seed: bigint): bigint => {
  const bundle = buildRunBundle(state, entropy, 12345n);
  const level = pureCircuits.buildLevelFrom(seed, bundle.seedLimbs, bundle.seedHi);
  return pureCircuits.verifyRunPure(
    level,
    bundle.cuts,
    bundle.cutsUsed,
    bundle.pieces,
    bundle.pieceCount,
    bundle.edgeHints,
    bundle.objectHints,
  );
};

describe('levelgen lockstep', () => {
  it('matches buildLevelFrom for 50 random seeds', () => {
    const rnd = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const seed = usableSeed(rnd);
      const entropy = pureCircuits.levelEntropy(seed);
      const { limbs, hi } = splitEntropy(entropy);
      const engineLevel = levelFromEntropy(entropy);
      const circuitLevel = pureCircuits.buildLevelFrom(seed, [...limbs], hi);
      expect(circuitLevel.objectCount).toBe(BigInt(engineLevel.objectCount));
      for (let k = 0; k < 8; k++) {
        expect(circuitLevel.board[k].x).toBe(engineLevel.board[k].x);
        expect(circuitLevel.board[k].y).toBe(engineLevel.board[k].y);
      }
      for (let k = 0; k < 6; k++) {
        expect(circuitLevel.objects[k].x).toBe(engineLevel.objects[k].x);
        expect(circuitLevel.objects[k].y).toBe(engineLevel.objects[k].y);
      }
    }
  });

  it('boards are always CCW and objects strictly interior', () => {
    const rnd = mulberry32(2);
    for (let i = 0; i < 30; i++) {
      const entropy = pureCircuits.levelEntropy(usableSeed(rnd));
      const level = levelFromEntropy(entropy);
      expect(doubleArea(level.board)).toBeGreaterThan(0n);
      const state = newGame(level);
      const assignment = assignObjects(state);
      for (const p of assignment.objectPiece) expect(p).toBe(0);
    }
  });

  it('rejects unusable entropy deterministically', () => {
    // hi = 115 (the excluded band): 115 * 2^248 + 1
    const bad = 115n * 2n ** 248n + 1n;
    expect(seedIsUsable(bad)).toBe(false);
    expect(() => splitEntropy(bad)).toThrow(/pick the next seed/);
  });
});

describe('geometry primitives', () => {
  it('divRound rounds to nearest with sign handling', () => {
    expect(divRound(7n, 2n)).toBe(4n);
    expect(divRound(-7n, 2n)).toBe(-4n);
    expect(divRound(7n, -2n)).toBe(-4n);
    expect(divRound(6n, 3n)).toBe(2n);
    expect(divRound(1n, 3n)).toBe(0n);
    expect(divRound(2n, 3n)).toBe(1n);
  });

  it('clipLineToRect produces in-rect chords', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const a = gridPt(rnd);
      const b = gridPt(rnd);
      const clipped = clipLineToRect(a, b, 4095n);
      if (!clipped) continue;
      for (const p of clipped) {
        expect(p.x >= 0n && p.x <= 4095n).toBe(true);
        expect(p.y >= 0n && p.y <= 4095n).toBe(true);
      }
    }
  });
});

describe('cut splitting invariants', () => {
  it('pieces tile the board within AREA_TOL across random cut sequences', () => {
    const rnd = mulberry32(4);
    for (let round = 0; round < 20; round++) {
      const entropy = pureCircuits.levelEntropy(usableSeed(rnd));
      const level = levelFromEntropy(entropy);
      let state = newGame(level);
      const boardArea = doubleArea(level.board);
      for (let c = 0; c < 3; c++) {
        const next = tryRandomCut(state, rnd);
        if (!next) break;
        state = next;
        const total = state.pieces.reduce((acc, p) => acc + doubleArea(p.verts), 0n);
        const diff = total > boardArea ? total - boardArea : boardArea - total;
        expect(diff <= AREA_TOL).toBe(true);
        for (const p of state.pieces) expect(doubleArea(p.verts)).toBeGreaterThan(0n);
      }
    }
  });

  it('rejects cuts passing through an object clearance zone', () => {
    const rnd = mulberry32(5);
    const entropy = pureCircuits.levelEntropy(usableSeed(rnd));
    const level = levelFromEntropy(entropy);
    const state = newGame(level);
    const obj = activeObjects(level)[0];
    // A horizontal line straight through the first object's center.
    const res = applyCut(state, { x: 100n, y: obj.y }, { x: 3900n, y: obj.y });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.kind).toBe('tooCloseToObject');
    expect(cutTooCloseToObject(level, { a: { x: 0n, y: obj.y }, b: { x: 4095n, y: obj.y } })).toBe(0);
  });
});

describe('engine runs prove through verifyRunPure', () => {
  it('0-cut baseline run proves with score 0', () => {
    const rnd = mulberry32(6);
    const seed = usableSeed(rnd);
    const entropy = pureCircuits.levelEntropy(seed);
    const state = newGame(levelFromEntropy(entropy));
    const score = verifyBundleThroughCircuit(state, entropy, seed);
    expect(score).toBe(0n);
  });

  it('100 random seeds x random cut sequences: circuit score == engine score', () => {
    const rnd = mulberry32(7);
    let proved = 0;
    let positive = 0;
    for (let round = 0; round < 100; round++) {
      const seed = usableSeed(rnd);
      const entropy = pureCircuits.levelEntropy(seed);
      let state = newGame(levelFromEntropy(entropy));
      const cuts = 1 + Math.floor(rnd() * 3);
      for (let c = 0; c < cuts; c++) {
        const next = tryRandomCut(state, rnd);
        if (next) state = next;
      }
      const engineScore = assignObjects(state).score;
      const circuitScore = verifyBundleThroughCircuit(state, entropy, seed);
      expect(circuitScore).toBe(BigInt(engineScore));
      proved++;
      if (engineScore > 0) positive++;
    }
    expect(proved).toBe(100);
    // Random 3-cut play should isolate something reasonably often; if this
    // fails the level generator or splitting is degenerate.
    expect(positive).toBeGreaterThan(10);
  });

  it('a crafted full-clear (4 objects, 3 cuts) proves with bonus', () => {
    const rnd = mulberry32(8);
    // Find a 4-object level: grid rows y=1664 and y=2432, columns spaced 768.
    let seed: bigint | undefined;
    let entropy = 0n;
    for (let i = 0; i < 200; i++) {
      const s = usableSeed(rnd);
      const e = pureCircuits.levelEntropy(s);
      if (levelFromEntropy(e).objectCount === 4) {
        seed = s;
        entropy = e;
        break;
      }
    }
    expect(seed).toBeDefined();
    const level = levelFromEntropy(entropy);
    let state = newGame(level);
    // Objects sit in cells around y ~1664+jit and ~2432+jit; columns at
    // x ~1280, 2048, 2816 (+jit). Cut between rows, then between columns.
    const r1 = applyCut(state, { x: 200n, y: 2100n }, { x: 3900n, y: 2100n });
    expect(r1.ok).toBe(true);
    if (r1.ok) state = r1.state;
    const r2 = applyCut(state, { x: 1700n, y: 300n }, { x: 1700n, y: 3800n });
    expect(r2.ok).toBe(true);
    if (r2.ok) state = r2.state;
    const r3 = applyCut(state, { x: 2450n, y: 300n }, { x: 2450n, y: 3800n });
    expect(r3.ok).toBe(true);
    if (r3.ok) state = r3.state;

    const a = assignObjects(state);
    expect(a.fullClear).toBe(true);
    expect(a.score).toBe(10 * level.objectCount + 5 * (4 - 3));
    const circuitScore = verifyBundleThroughCircuit(state, entropy, seed!);
    expect(circuitScore).toBe(BigInt(a.score));
  });
});
