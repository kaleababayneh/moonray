/**
 * Witness implementations for the Slicer contract.
 *
 * Witnesses are pure reads of staged private state — all real logic lives in
 * @moonray/engine, which stages a RunBundle here immediately before
 * callTx.submitRun (the lumera/wordle staging pattern). Nothing in this file
 * ever leaves the device; only the ZK proof does.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type {
  Cut,
  EdgeHint,
  Ledger,
  Piece,
  Witnesses,
} from './managed/slicer/contract/index.js';

/** The witness payloads for one submitRun call (generated value shapes). */
export interface StagedRun {
  readonly seedLimbs: bigint[];
  readonly seedHi: bigint;
  readonly cuts: Cut[];
  readonly cutsUsed: bigint;
  readonly pieces: Piece[];
  readonly pieceCount: bigint;
  readonly edgeHints: EdgeHint[][];
  readonly objectHints: bigint[];
  readonly scoreNonce: bigint;
}

/** A sealed entry we must be able to reveal / claim a badge for later.
 * Losing the nonce makes a sealed score unrevealable forever — persist this. */
export interface RunRecord {
  readonly score: number;
  /** Field element as decimal string (JSON-safe). */
  readonly nonce: string;
  readonly sealedAt?: number;
}

export interface SlicerPrivateState {
  /** 32 bytes, generated once, never leaves the client. */
  readonly secretKey: Uint8Array;
  /** Set immediately before callTx.submitRun / deploy. */
  readonly stagedRun?: StagedRun;
  /** tournamentId (decimal string) -> reveal material. */
  readonly runs: Record<string, RunRecord>;
}

export const createSlicerPrivateState = (
  secretKey: Uint8Array,
  runs: Record<string, RunRecord> = {},
  stagedRun?: StagedRun,
): SlicerPrivateState => ({ secretKey, runs, stagedRun });

const staged = (ps: SlicerPrivateState): StagedRun => {
  if (!ps.stagedRun) {
    throw new Error('no staged run: stage a RunBundle into private state before calling submitRun');
  }
  return ps.stagedRun;
};

type Ctx = WitnessContext<Ledger, SlicerPrivateState>;

export const witnesses: Witnesses<SlicerPrivateState> = {
  playerSecret: ({ privateState }: Ctx): [SlicerPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
  scoreNonce: ({ privateState }: Ctx): [SlicerPrivateState, bigint] => [
    privateState,
    staged(privateState).scoreNonce,
  ],
  seedLimbs: ({ privateState }: Ctx): [SlicerPrivateState, [bigint[], bigint]] => [
    privateState,
    [staged(privateState).seedLimbs, staged(privateState).seedHi],
  ],
  runCuts: ({ privateState }: Ctx): [SlicerPrivateState, Cut[]] => [
    privateState,
    staged(privateState).cuts,
  ],
  runCutsUsed: ({ privateState }: Ctx): [SlicerPrivateState, bigint] => [
    privateState,
    staged(privateState).cutsUsed,
  ],
  runPieces: ({ privateState }: Ctx): [SlicerPrivateState, Piece[]] => [
    privateState,
    staged(privateState).pieces,
  ],
  runPieceCount: ({ privateState }: Ctx): [SlicerPrivateState, bigint] => [
    privateState,
    staged(privateState).pieceCount,
  ],
  runEdgeHints: ({ privateState }: Ctx): [SlicerPrivateState, EdgeHint[][]] => [
    privateState,
    staged(privateState).edgeHints,
  ],
  runObjectHints: ({ privateState }: Ctx): [SlicerPrivateState, bigint[]] => [
    privateState,
    staged(privateState).objectHints,
  ],
};
