/**
 * MoonraySlicer — typed facade over the deployed contract.
 *
 * submitRun stages the engine's RunBundle into private state immediately
 * before the circuit call (the witnesses read it from there), then records
 * the {score, nonce} reveal material under the tournament id. The
 * authoritative preflight is pureCircuits.verifyRunPure — the exact code the
 * circuit runs — so a run that passes preflight cannot burn a proof on an
 * unprovable witness.
 */

import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  createSlicerPrivateState,
  pureCircuits,
  type SlicerPrivateState,
  type StagedRun,
} from '@moonray/contract';
import {
  buildRunBundle,
  levelFromEntropies,
  nonceFromBytes,
  type PlayState,
  seedIsUsable,
  splitEntropy,
} from '@moonray/engine';
import { getCompiledSlicerContract } from './compiled.js';
import {
  type DeployedSlicerContract,
  type SlicerProviders,
  slicerPrivateStateKey,
  type TxInfo,
} from './common-types.js';

const txInfo = (txData: { public: { txHash: string; blockHeight: bigint | number } }): TxInfo => ({
  txHash: txData.public.txHash,
  blockHeight: Number(txData.public.blockHeight),
});

/** Fresh random Field element (browser + node webcrypto). */
export const randomFieldNonce = (): bigint =>
  nonceFromBytes(crypto.getRandomValues(new Uint8Array(31)));

export const randomSecretKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

/** Random usable tournament seed (both entropy streams must decompose). */
export const pickUsableSeed = (): bigint => {
  for (;;) {
    const seed = randomFieldNonce();
    if (
      seedIsUsable(pureCircuits.levelEntropy(seed)) &&
      seedIsUsable(pureCircuits.levelEntropy2(seed))
    ) {
      return seed;
    }
  }
};

export type PreflightResult =
  | { ok: true; score: number }
  | { ok: false; reason: string };

/** Run the exact circuit assertions client-side (no proof, no network). */
export const preflightRun = (state: PlayState, seed: bigint): PreflightResult => {
  try {
    const entropy1 = pureCircuits.levelEntropy(seed);
    const entropy2 = pureCircuits.levelEntropy2(seed);
    const bundle = buildRunBundle(state, entropy1, entropy2, 1n);
    const level = pureCircuits.buildLevelFrom(seed, bundle.seedLimbs, bundle.seedHi, bundle.seedLimbs2, bundle.seedHi2);
    const score = pureCircuits.verifyRunPure(
      level,
      bundle.cuts,
      bundle.cutsUsed,
      bundle.pieces,
      bundle.pieceCount,
      bundle.edgeHints,
      bundle.objectHints,
    );
    return { ok: true, score: Number(score) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};

export class MoonraySlicer {
  readonly address: ContractAddress;
  private readonly deployed: DeployedSlicerContract;
  private readonly providers: SlicerProviders;

  private constructor(deployed: DeployedSlicerContract, providers: SlicerProviders) {
    this.deployed = deployed;
    this.providers = providers;
    this.address = deployed.deployTxData.public.contractAddress;
  }

  /** Deploy a fresh contract; the deployer's secretKey becomes the admin. */
  static async deploy(
    providers: SlicerProviders,
    assetSource: string,
    secretKey: Uint8Array,
  ): Promise<MoonraySlicer> {
    const deployed = await deployContract(providers, {
      compiledContract: getCompiledSlicerContract(assetSource),
      privateStateId: slicerPrivateStateKey,
      initialPrivateState: createSlicerPrivateState(secretKey),
    });
    return new MoonraySlicer(deployed as DeployedSlicerContract, providers);
  }

  /** Join an existing contract by address. */
  static async join(
    providers: SlicerProviders,
    assetSource: string,
    contractAddress: ContractAddress,
    secretKey: Uint8Array,
  ): Promise<MoonraySlicer> {
    providers.privateStateProvider.setContractAddress?.(contractAddress);
    const existing = await providers.privateStateProvider.get(slicerPrivateStateKey);
    const deployed = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: getCompiledSlicerContract(assetSource),
      privateStateId: slicerPrivateStateKey,
      initialPrivateState: existing ?? createSlicerPrivateState(secretKey),
    });
    return new MoonraySlicer(deployed as DeployedSlicerContract, providers);
  }

  private async privateState(): Promise<SlicerPrivateState> {
    const ps = await this.providers.privateStateProvider.get(slicerPrivateStateKey);
    if (!ps) throw new Error('private state missing — join/deploy first');
    return ps;
  }

  private async setPrivateState(ps: SlicerPrivateState): Promise<void> {
    await this.providers.privateStateProvider.set(slicerPrivateStateKey, ps);
  }

  async secretKey(): Promise<Uint8Array> {
    return (await this.privateState()).secretKey;
  }

  /** The client can recognise its own (otherwise anonymous) entries. */
  async myNullifier(tid: bigint): Promise<bigint> {
    return pureCircuits.nullifierFor(await this.secretKey(), tid);
  }

  // ── admin ────────────────────────────────────────────────────────────────

  async createTournament(
    tid: bigint,
    seed: bigint,
    submitUntil: Date,
    revealUntil: Date,
  ): Promise<TxInfo> {
    if (
      !seedIsUsable(pureCircuits.levelEntropy(seed)) ||
      !seedIsUsable(pureCircuits.levelEntropy2(seed))
    ) {
      throw new Error('seed is in the unusable entropy band — use pickUsableSeed()');
    }
    const txData = await this.deployed.callTx.createTournament(
      tid,
      seed,
      BigInt(Math.floor(submitUntil.getTime() / 1000)),
      BigInt(Math.floor(revealUntil.getTime() / 1000)),
    );
    return txInfo(txData);
  }

  // ── player ───────────────────────────────────────────────────────────────

  /**
   * Prove + submit the current partition for a tournament. Stages witnesses,
   * runs preflight, then callTx (proof + balancing + submission).
   */
  async submitRun(tid: bigint, playState: PlayState, seed: bigint): Promise<TxInfo & { score: number }> {
    const pre = preflightRun(playState, seed);
    if (!pre.ok) throw new Error(`run would not prove: ${pre.reason}`);

    const entropy1 = pureCircuits.levelEntropy(seed);
    const entropy2 = pureCircuits.levelEntropy2(seed);
    const nonce = randomFieldNonce();
    const bundle = buildRunBundle(playState, entropy1, entropy2, nonce);

    const ps = await this.privateState();
    const staged: StagedRun = bundle;
    await this.setPrivateState({ ...ps, stagedRun: staged });

    const txData = await this.deployed.callTx.submitRun(tid);

    // Persist the reveal material — losing the nonce seals the score forever.
    const after = await this.privateState();
    await this.setPrivateState({
      ...after,
      stagedRun: undefined,
      runs: {
        ...after.runs,
        [tid.toString()]: { score: pre.score, nonce: nonce.toString(), sealedAt: Date.now() },
      },
    });

    return { ...txInfo(txData), score: pre.score };
  }

  /** Reveal the sealed score during the reveal window. */
  async revealScore(tid: bigint): Promise<TxInfo & { score: number }> {
    const ps = await this.privateState();
    const run = ps.runs[tid.toString()];
    if (!run) throw new Error(`no local reveal material for tournament ${tid}`);
    const txData = await this.deployed.callTx.revealScore(tid, BigInt(run.score), BigInt(run.nonce));
    return { ...txInfo(txData), score: run.score };
  }

  /** Claim a badge tier without revealing the score. */
  async claimBadge(tid: bigint, tier: 1 | 2 | 3): Promise<TxInfo> {
    const ps = await this.privateState();
    const run = ps.runs[tid.toString()];
    if (!run) throw new Error(`no local reveal material for tournament ${tid}`);
    const txData = await this.deployed.callTx.claimBadge(
      tid,
      BigInt(tier),
      BigInt(run.score),
      BigInt(run.nonce),
    );
    return txInfo(txData);
  }

  /** Local reveal material (exportable backup). */
  async myRuns(): Promise<SlicerPrivateState['runs']> {
    return (await this.privateState()).runs;
  }
}

/** Level helpers re-exported where the UI needs them with the seed. */
export const levelForSeed = (seed: bigint) => {
  const entropy1 = pureCircuits.levelEntropy(seed);
  const entropy2 = pureCircuits.levelEntropy2(seed);
  return {
    entropy1,
    entropy2,
    level: levelFromEntropies(entropy1, entropy2),
    limbs: splitEntropy(entropy1),
    limbs2: splitEntropy(entropy2),
  };
};
