/**
 * Play state -> RunBundle: exactly the witness payloads the circuit expects,
 * padded to the fixed vector shapes. The authoritative preflight is
 * pureCircuits.verifyRunPure (called by @moonray/api with this bundle) — the
 * checks here are structural only.
 */

import { MAX_CUTS, MAX_OBJECTS, MAX_PIECES, MAX_PIECE_VERTS } from './constants.js';
import type { Pt } from './geometry.js';
import { type SeedLimbs, splitEntropy } from './levelgen.js';
import { assignObjects, type PlayState } from './slicer.js';

export interface BundlePt {
  x: bigint;
  y: bigint;
}
export interface BundleCut {
  a: BundlePt;
  b: BundlePt;
}
export interface BundlePiece {
  verts: BundlePt[]; // exactly MAX_PIECE_VERTS, padded with verts[0]
  vertCount: bigint;
}
export interface BundleEdgeHint {
  isCut: boolean;
  idx: bigint;
}

/** Everything submitRun's witnesses read, in generated-contract value shapes. */
export interface RunBundle {
  seedLimbs: bigint[]; // 31
  seedHi: bigint;
  cuts: BundleCut[]; // exactly 3
  cutsUsed: bigint;
  pieces: BundlePiece[]; // exactly 8
  pieceCount: bigint;
  edgeHints: BundleEdgeHint[][]; // 8 x 11
  objectHints: bigint[]; // 6
  scoreNonce: bigint;
  /** engine-side expected score (the circuit recomputes it independently). */
  expectedScore: number;
}

const zeroPt = (): BundlePt => ({ x: 0n, y: 0n });

export class UnprovableRunError extends Error {}

/**
 * Build the witness bundle for the current partition.
 * @param entropy   level entropy (pureCircuits.levelEntropy(seed))
 * @param scoreNonce fresh random Field element (see randomFieldNonce in api/ui)
 */
export const buildRunBundle = (
  state: PlayState,
  entropy: bigint,
  scoreNonce: bigint,
): RunBundle => {
  const { limbs, hi }: SeedLimbs = splitEntropy(entropy);

  if (state.pieces.length < 1 || state.pieces.length > MAX_PIECES) {
    throw new UnprovableRunError(`piece count ${state.pieces.length} out of range`);
  }
  if (state.cuts.length > MAX_CUTS) {
    throw new UnprovableRunError(`cut count ${state.cuts.length} out of range`);
  }

  const cuts: BundleCut[] = [];
  for (let j = 0; j < MAX_CUTS; j++) {
    const c = state.cuts[j];
    cuts.push(c ? { a: { ...c.a }, b: { ...c.b } } : { a: zeroPt(), b: zeroPt() });
  }

  const pieces: BundlePiece[] = [];
  const edgeHints: BundleEdgeHint[][] = [];
  for (let p = 0; p < MAX_PIECES; p++) {
    const piece = state.pieces[p];
    if (!piece) {
      pieces.push({ verts: Array.from({ length: MAX_PIECE_VERTS }, zeroPt), vertCount: 0n });
      edgeHints.push(
        Array.from({ length: MAX_PIECE_VERTS }, () => ({ isCut: false, idx: 0n })),
      );
      continue;
    }
    const n = piece.verts.length;
    if (n < 3 || n > MAX_PIECE_VERTS) {
      throw new UnprovableRunError(`piece ${p} has ${n} vertices`);
    }
    const verts: BundlePt[] = [];
    for (let k = 0; k < MAX_PIECE_VERTS; k++) {
      const v = k < n ? piece.verts[k] : piece.verts[0]; // canonical padding
      verts.push({ x: v.x, y: v.y });
    }
    pieces.push({ verts, vertCount: BigInt(n) });
    const hints: BundleEdgeHint[] = [];
    for (let e = 0; e < MAX_PIECE_VERTS; e++) {
      const s = e < n ? piece.sources[e] : { isCut: false, idx: 0 };
      hints.push({ isCut: s.isCut, idx: BigInt(s.idx) });
    }
    edgeHints.push(hints);
  }

  const assignment = assignObjects(state);
  const objectHints: bigint[] = [];
  for (let o = 0; o < MAX_OBJECTS; o++) {
    const pieceIdx = assignment.objectPiece[o];
    if (o < state.level.objectCount) {
      if (pieceIdx === undefined || pieceIdx < 0) {
        throw new UnprovableRunError(`object ${o} is not inside any piece`);
      }
      objectHints.push(BigInt(pieceIdx));
    } else {
      objectHints.push(0n);
    }
  }

  return {
    seedLimbs: [...limbs],
    seedHi: hi,
    cuts,
    cutsUsed: BigInt(state.cuts.length),
    pieces,
    pieceCount: BigInt(state.pieces.length),
    edgeHints,
    objectHints,
    scoreNonce,
    expectedScore: assignment.score,
  };
};

/** 31 random bytes -> bigint strictly below the field prime. */
export const nonceFromBytes = (bytes: Uint8Array): bigint => {
  if (bytes.length < 31) throw new Error('need at least 31 random bytes');
  let v = 0n;
  for (let i = 0; i < 31; i++) v = (v << 8n) | BigInt(bytes[i]);
  return v;
};

/** Level for the circuit call, in generated value shape. */
export const levelValue = (level: {
  board: readonly Pt[];
  objects: readonly Pt[];
  objectCount: number;
}) => ({
  board: level.board.map((v) => ({ x: v.x, y: v.y })),
  objects: level.objects.map((v) => ({ x: v.x, y: v.y })),
  objectCount: BigInt(level.objectCount),
});
