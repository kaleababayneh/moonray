/**
 * Testbed for exercising the Slicer circuits without a live network.
 * Each method wraps an impure circuit call and keeps the CircuitContext in
 * sync, exactly as the on-chain transcript would evolve. Supports multiple
 * players (each with their own private state / secret key) and block-time
 * control for window tests.
 */

import {
  type CircuitContext,
  type CircuitResults,
  CostModel,
  QueryContext,
  createConstructorContext,
  emptyZswapLocalState,
  sampleContractAddress,
  type ContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import * as crypto from 'node:crypto';
import {
  Contract,
  ledger,
  type Ledger,
  type Witnesses,
} from '../managed/slicer/contract/index.js';
import {
  createSlicerPrivateState,
  type SlicerPrivateState,
  type StagedRun,
  witnesses,
} from '../witnesses.js';

export const randomSecretKey = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(32));

type SlicerContract = Contract<SlicerPrivateState, Witnesses<SlicerPrivateState>>;

export class SlicerSimulator {
  readonly contract: SlicerContract;
  readonly contractAddress: ContractAddress;
  circuitContext: CircuitContext<SlicerPrivateState>;
  private readonly users = new Map<string, SlicerPrivateState>();
  private current = 'deployer';

  constructor(deployerSecretKey: Uint8Array) {
    this.contractAddress = sampleContractAddress();
    this.contract = new Contract<SlicerPrivateState>(witnesses);

    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(createSlicerPrivateState(deployerSecretKey), '0'.repeat(64)),
      );

    this.users.set('deployer', currentPrivateState);
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, this.contractAddress),
    };
  }

  /** Register a player with their own secret key. */
  addUser(name: string, secretKey: Uint8Array = randomSecretKey()): void {
    this.users.set(name, createSlicerPrivateState(secretKey));
  }

  /** Switch whose private state (and zswap identity) circuit calls use. */
  as(name: string): this {
    const ps = this.users.get(name);
    if (!ps) throw new Error(`unknown user ${name}`);
    // persist current user's private state before switching
    this.users.set(this.current, this.circuitContext.currentPrivateState);
    this.current = name;
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: ps,
      currentZswapLocalState: emptyZswapLocalState('0'.repeat(64)),
    };
    return this;
  }

  /** Stage a run bundle into the current user's private state. */
  stageRun(bundle: StagedRun): void {
    const ps = this.circuitContext.currentPrivateState;
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: { ...ps, stagedRun: bundle },
    };
  }

  secretKeyOf(name: string): Uint8Array {
    const ps = name === this.current ? this.circuitContext.currentPrivateState : this.users.get(name);
    if (!ps) throw new Error(`unknown user ${name}`);
    return ps.secretKey;
  }

  /** Set the simulated block time (seconds since epoch). */
  setBlockTime(seconds: bigint): void {
    const qc = this.circuitContext.currentQueryContext;
    qc.block = { ...qc.block, secondsSinceEpoch: seconds };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  private apply<T>(res: CircuitResults<SlicerPrivateState, T>): T {
    const time = this.circuitContext.currentQueryContext.block.secondsSinceEpoch;
    this.circuitContext = res.context;
    // preserve simulated time across calls
    this.setBlockTime(time);
    this.users.set(this.current, this.circuitContext.currentPrivateState);
    return res.result;
  }

  createTournament(tid: bigint, seed: bigint, submitUntil: bigint, revealUntil: bigint): void {
    this.apply(
      this.contract.impureCircuits.createTournament(this.circuitContext, tid, seed, submitUntil, revealUntil),
    );
  }

  addAdmin(newAdminId: Uint8Array): void {
    this.apply(this.contract.impureCircuits.addAdmin(this.circuitContext, newAdminId));
  }

  submitRun(tid: bigint): void {
    this.apply(this.contract.impureCircuits.submitRun(this.circuitContext, tid));
  }

  revealScore(tid: bigint, score: bigint, nonce: bigint): void {
    this.apply(this.contract.impureCircuits.revealScore(this.circuitContext, tid, score, nonce));
  }
}
