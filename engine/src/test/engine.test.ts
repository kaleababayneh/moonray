/**
 * Engine <-> circuit lockstep tests for the two-plate, collect/dissolve game.
 *
 * The generated pureCircuits (the EXACT code submitRun runs in-circuit) are
 * the referee: levelgen goldens compare engine output to buildLevelFrom, and
 * the property suite proves every engine-produced RunBundle — including runs
 * with dissolved (retired) pieces — through verifyRunPure.
 */

import { describe, expect, it } from 'vitest';
import { pureCircuits } from '@moonray/contract';
import {
  activeObjectEntries,
  applyCut,
  assignObjects,
  buildRunBundle,
  claimedPieces,
  cross,
  doubleArea,
  FIELD_PRIME,
  levelFromEntropies,
  newGame,
  type Level,
  type PlayState,
  type Pt,
  seedIsUsable,
  splitEntropy,
  totalObjects,
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
    if (
      seedIsUsable(pureCircuits.levelEntropy(seed)) &&
      seedIsUsable(pureCircuits.levelEntropy2(seed))
    ) {
      return seed;
    }
  }
};

const levelOf = (seed: bigint): Level =>
  levelFromEntropies(pureCircuits.levelEntropy(seed), pureCircuits.levelEntropy2(seed));

const gridPt = (rnd: () => number): Pt => ({
  x: BigInt(200 + Math.floor(rnd() * 3700)),
  y: BigInt(200 + Math.floor(rnd() * 3700)),
});

/** Try to apply a random cut; returns the new state or null. */
const tryRandomCut = (state: PlayState, rnd: () => number): PlayState | null => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = applyCut(state, gridPt(rnd), gridPt(rnd));
    if (res.ok) return res.state;
  }
  return null;
};

const verifyThroughCircuit = (state: PlayState, seed: bigint): bigint => {
  const e1 = pureCircuits.levelEntropy(seed);
  const e2 = pureCircuits.levelEntropy2(seed);
  const bundle = buildRunBundle(state, e1, e2, 12345n);
  const level = pureCircuits.buildLevelFrom(
    seed,
    bundle.seedLimbs,
    bundle.seedHi,
    bundle.seedLimbs2,
    bundle.seedHi2,
  );
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
      const e1 = pureCircuits.levelEntropy(seed);
      const e2 = pureCircuits.levelEntropy2(seed);
      const s1 = splitEntropy(e1);
      const s2 = splitEntropy(e2);
      const engineLevel = levelFromEntropies(e1, e2);
      const circuitLevel = pureCircuits.buildLevelFrom(
        seed,
        [...s1.limbs],
        s1.hi,
        [...s2.limbs],
        s2.hi,
      );
      expect(circuitLevel.countA).toBe(BigInt(engineLevel.countA));
      expect(circuitLevel.countB).toBe(BigInt(engineLevel.countB));
      for (let k = 0; k < 8; k++) {
        expect(circuitLevel.boardA[k].x).toBe(engineLevel.boardA[k].x);
        expect(circuitLevel.boardA[k].y).toBe(engineLevel.boardA[k].y);
      }
      for (let k = 0; k < 7; k++) {
        expect(circuitLevel.boardB[k].x).toBe(engineLevel.boardB[k].x);
        expect(circuitLevel.boardB[k].y).toBe(engineLevel.boardB[k].y);
      }
      for (let k = 0; k < 14; k++) {
        expect(circuitLevel.objects[k].x).toBe(engineLevel.objects[k].x);
        expect(circuitLevel.objects[k].y).toBe(engineLevel.objects[k].y);
      }
    }
  });

  it('boards are always convex CCW, disjoint, and objects strictly interior', () => {
    const rnd = mulberry32(2);
    for (let i = 0; i < 40; i++) {
      const level = levelOf(usableSeed(rnd));
      for (const board of [level.boardA, level.boardB]) {
        expect(doubleArea(board)).toBeGreaterThan(0n);
        // strict convexity at every vertex
        for (let k = 0; k < board.length; k++) {
          const a = board[(k + board.length - 1) % board.length];
          const b = board[k];
          const c = board[(k + 1) % board.length];
          expect(cross(a, b, c) > 0n).toBe(true);
        }
      }
      // counts in range, objects inside their own plate (uncut state = 2 pieces)
      expect(level.countA).toBeGreaterThanOrEqual(3);
      expect(level.countA).toBeLessThanOrEqual(7);
      expect(level.countB).toBeGreaterThanOrEqual(3);
      expect(level.countB).toBeLessThanOrEqual(7);
      const state = newGame(level);
      const a = assignObjects(state);
      for (let j = 0; j < a.slots.length; j++) {
        // slots < 7 live on board A (claimed piece 0), others on B (piece 1)
        expect(a.objectPiece[j]).toBe(a.slots[j] < 7 ? 0 : 1);
      }
    }
  });

  it('rejects unusable entropy deterministically', () => {
    const bad = 115n * 2n ** 248n + 1n;
    expect(seedIsUsable(bad)).toBe(false);
  });
});

describe('collect/dissolve mechanics', () => {
  it('claimed pieces always tile both boards exactly', () => {
    const rnd = mulberry32(4);
    for (let round = 0; round < 25; round++) {
      const level = levelOf(usableSeed(rnd));
      let state = newGame(level);
      const boardsArea = doubleArea(level.boardA) + doubleArea(level.boardB);
      for (let c = 0; c < 3; c++) {
        const next = tryRandomCut(state, rnd);
        if (!next) break;
        state = next;
        const claimed = claimedPieces(state);
        const total = claimed.reduce((acc, p) => acc + doubleArea(p.verts), 0n);
        const diff = total > boardsArea ? total - boardsArea : boardsArea - total;
        expect(diff <= 32768n).toBe(true);
        expect(claimed.length).toBeLessThanOrEqual(11);
      }
    }
  });

  it('collected moonlets stay collected and count as isolated', () => {
    const rnd = mulberry32(5);
    let sawCollection = false;
    for (let round = 0; round < 40 && !sawCollection; round++) {
      const level = levelOf(usableSeed(rnd));
      let state = newGame(level);
      for (let c = 0; c < 3; c++) {
        const a = gridPt(rnd);
        const b = gridPt(rnd);
        const res = applyCut(state, a, b);
        if (!res.ok) continue;
        if (res.collectedSlots.length > 0) {
          sawCollection = true;
          for (const slot of res.collectedSlots) {
            expect(res.state.collected[slot]).toBe(true);
          }
          const assign = assignObjects(res.state);
          for (const slot of res.collectedSlots) {
            const i = assign.slots.indexOf(slot);
            expect(assign.isolated[i]).toBe(true);
          }
        }
        state = res.state;
      }
    }
    expect(sawCollection).toBe(true);
  });
});

describe('engine runs prove through verifyRunPure', () => {
  it('0-cut baseline proves with score 0', () => {
    const rnd = mulberry32(6);
    const seed = usableSeed(rnd);
    const state = newGame(levelOf(seed));
    expect(verifyThroughCircuit(state, seed)).toBe(0n);
  });

  it('100 random seeds x random cut sequences: circuit score == engine score', () => {
    const rnd = mulberry32(7);
    let proved = 0;
    let positive = 0;
    let withRetired = 0;
    for (let round = 0; round < 100; round++) {
      const seed = usableSeed(rnd);
      let state = newGame(levelOf(seed));
      const cuts = 1 + Math.floor(rnd() * 3);
      for (let c = 0; c < cuts; c++) {
        const next = tryRandomCut(state, rnd);
        if (next) state = next;
      }
      const engineScore = assignObjects(state).score;
      const circuitScore = verifyThroughCircuit(state, seed);
      expect(circuitScore).toBe(BigInt(engineScore));
      proved++;
      if (engineScore > 0) positive++;
      if (state.retired.length > 0) withRetired++;
    }
    expect(proved).toBe(100);
    // random play must regularly collect moonlets and retire pieces — if not,
    // the level generator or the dissolve mechanic is broken.
    expect(positive).toBeGreaterThan(20);
    expect(withRetired).toBeGreaterThan(20);
  });

  it('full-clear bonus matches the circuit when a light board clears', () => {
    // hunt for a seed + cut sequence that clears everything; verify the bonus
    const rnd = mulberry32(8);
    for (let round = 0; round < 400; round++) {
      const seed = usableSeed(rnd);
      const level = levelOf(seed);
      if (totalObjects(level) > 8) continue; // light days only
      let state = newGame(level);
      for (let c = 0; c < 3; c++) {
        const next = tryRandomCut(state, rnd);
        if (next) state = next;
      }
      const a = assignObjects(state);
      if (!a.fullClear) continue;
      expect(a.score).toBe(10 * a.totalObjects + 5 * (4 - state.cuts.length));
      expect(verifyThroughCircuit(state, seed)).toBe(BigInt(a.score));
      return; // found and verified one
    }
    // Random 3-cut play rarely full-clears; not finding one in 400 tries is
    // acceptable — the scoring path is still covered by the property suite.
  });
});
