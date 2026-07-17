import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract, SlicerPrivateState, Witnesses } from '@moonray/contract';

export const slicerPrivateStateKey = 'MoonraySlicerState';
export type SlicerPrivateStateId = typeof slicerPrivateStateKey;

export type SlicerContract = Contract<SlicerPrivateState, Witnesses<SlicerPrivateState>>;

/** The circuit names that require ZK proving keys. */
export type SlicerCircuitKeys = Exclude<keyof SlicerContract['impureCircuits'], number | symbol>;

export type SlicerProviders = MidnightProviders<
  SlicerCircuitKeys,
  SlicerPrivateStateId,
  SlicerPrivateState
>;

export type DeployedSlicerContract = FoundContract<SlicerContract>;

export interface TxInfo {
  txHash: string;
  blockHeight: number;
}
