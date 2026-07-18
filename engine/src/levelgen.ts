/**
 * seed -> level, in lockstep with the circuit's buildLevelFrom.
 *
 * The engine deliberately has NO midnight dependency: callers obtain the two
 * entropies via pureCircuits.levelEntropy / levelEntropy2 (the exact circuit
 * code) and pass them here. Everything downstream is pure BigInt arithmetic
 * identical to the circuit.
 */

import {
  BOARD_A_TPL,
  BOARD_B_TPL,
  CELL_A_TPL,
  CELL_B_TPL,
  HI_MAX,
  OBJECTS_PER_BOARD,
} from './constants.js';
import type { Pt } from './geometry.js';

export interface Level {
  /** CCW lopsided octagon (top-left). */
  readonly boardA: readonly Pt[];
  /** CCW lopsided heptagon (bottom-right). */
  readonly boardB: readonly Pt[];
  /** All 14 object slots: 0..6 board A, 7..13 board B. */
  readonly objects: readonly Pt[];
  /** Active objects on board A (first countA of slots 0..6). */
  readonly countA: number;
  /** Active objects on board B (first countB of slots 7..13). */
  readonly countB: number;
}

export interface SeedLimbs {
  readonly limbs: readonly bigint[]; // 31 x [0,256)
  readonly hi: bigint; // [0,114]
}

export class SeedUnusableError extends Error {
  constructor() {
    super('seed entropy exceeds the provable limb-decomposition range (~1.6% of seeds); pick the next seed');
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

/** 7-bit jitter from an 8-bit limb (mirrors the circuit's j7). */
const j7 = (limb: bigint): bigint => (limb <= 127n ? limb : limb - 128n);

/** 3..7 from a hi limb (uniform 0..114), mirroring the circuit's bands. */
const countFrom = (hi: bigint): number =>
  hi <= 22n ? 3 : hi <= 45n ? 4 : hi <= 68n ? 5 : hi <= 91n ? 6 : 7;

/** The level recipe — identical to the circuit's buildLevelFrom. */
export const levelFromEntropies = (entropy1: bigint, entropy2: bigint): Level => {
  const { limbs, hi } = splitEntropy(entropy1);
  const { limbs: limbs2, hi: hi2 } = splitEntropy(entropy2);

  // plate centers drift daily: board A by (limbs[30], limbs2[28]), board B
  // by (limbs2[29], limbs2[30]) — all 7-bit, added to every vertex and cell.
  const acx = j7(limbs[30]);
  const acy = j7(limbs2[28]);
  const bcx = j7(limbs2[29]);
  const bcy = j7(limbs2[30]);

  const boardA: Pt[] = BOARD_A_TPL.map(([tx, ty], i) => ({
    x: tx + j7(limbs[2 * i]) + acx,
    y: ty + j7(limbs[2 * i + 1]) + acy,
  }));
  const boardB: Pt[] = BOARD_B_TPL.map(([tx, ty], i) => ({
    x: tx + j7(limbs[16 + 2 * i]) + bcx,
    y: ty + j7(limbs[17 + 2 * i]) + bcy,
  }));
  const objects: Pt[] = [
    ...CELL_A_TPL.map(([cx, cy], j): Pt => ({
      x: cx + j7(limbs2[2 * j]) + acx,
      y: cy + j7(limbs2[2 * j + 1]) + acy,
    })),
    ...CELL_B_TPL.map(([cx, cy], j): Pt => ({
      x: cx + j7(limbs2[14 + 2 * j]) + bcx,
      y: cy + j7(limbs2[15 + 2 * j]) + bcy,
    })),
  ];
  return {
    boardA,
    boardB,
    objects,
    countA: countFrom(hi),
    countB: countFrom(hi2),
  };
};

/** Is object slot `idx` (0..13) active for this level? */
export const objectActive = (level: Level, idx: number): boolean =>
  idx < OBJECTS_PER_BOARD ? idx < level.countA : idx - OBJECTS_PER_BOARD < level.countB;

export interface ActiveObject {
  readonly slot: number; // 0..13, the circuit's objectHints index
  readonly pt: Pt;
}

/** Active objects with their slot indices (hints are slot-indexed). */
export const activeObjectEntries = (level: Level): ActiveObject[] => {
  const out: ActiveObject[] = [];
  for (let i = 0; i < level.objects.length; i++) {
    if (objectActive(level, i)) out.push({ slot: i, pt: level.objects[i] });
  }
  return out;
};

/** Active object positions only. */
export const activeObjects = (level: Level): readonly Pt[] =>
  activeObjectEntries(level).map((e) => e.pt);

export const totalObjects = (level: Level): number => level.countA + level.countB;
