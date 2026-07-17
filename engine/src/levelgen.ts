/**
 * seed -> level, in lockstep with the circuit's buildLevelFrom.
 *
 * The engine deliberately has NO midnight dependency: callers obtain
 * entropy = pureCircuits.levelEntropy(seed) from @moonray/contract (the exact
 * circuit code) and pass it here. Everything downstream of entropy is pure
 * BigInt arithmetic identical to the circuit.
 */

import { BOARD_TPL, CELL_TPL, HI_MAX } from './constants.js';
import type { Pt } from './geometry.js';

export interface Level {
  /** CCW octagon. */
  readonly board: readonly Pt[];
  /** All 6 object slots (first objectCount are active). */
  readonly objects: readonly Pt[];
  readonly objectCount: number;
}

export interface SeedLimbs {
  readonly limbs: readonly bigint[]; // 31 x [0,256)
  readonly hi: bigint; // [0,114]
}

export class SeedUnusableError extends Error {
  constructor() {
    super('seed entropy exceeds the provable limb-decomposition range (~0.8% of seeds); pick the next seed');
  }
}

/** Split entropy into 31 base-256 limbs + hi. Throws SeedUnusableError if hi > 114. */
export const splitEntropy = (entropy: bigint): SeedLimbs => {
  if (entropy < 0n) throw new Error('entropy must be non-negative');
  const limbs: bigint[] = [];
  let rest = entropy;
  for (let i = 0; i < 31; i++) {
    limbs.push(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest > HI_MAX) throw new SeedUnusableError();
  return { limbs, hi: rest };
};

export const seedIsUsable = (entropy: bigint): boolean => {
  try {
    splitEntropy(entropy);
    return true;
  } catch {
    return false;
  }
};

/** The level recipe — identical to the circuit's buildLevelFrom. */
export const levelFromEntropy = (entropy: bigint): Level => {
  const { limbs } = splitEntropy(entropy);
  const board: Pt[] = BOARD_TPL.map(([tx, ty], i) => ({
    x: tx + limbs[2 * i],
    y: ty + limbs[2 * i + 1],
  }));
  const objects: Pt[] = CELL_TPL.map(([cx, cy], j) => ({
    x: cx + limbs[16 + 2 * j],
    y: cy + limbs[17 + 2 * j],
  }));
  const c28 = limbs[28];
  const objectCount = c28 <= 85n ? 4 : c28 <= 170n ? 5 : 6;
  return { board, objects, objectCount };
};

/** Active objects only. */
export const activeObjects = (level: Level): readonly Pt[] =>
  level.objects.slice(0, level.objectCount);
