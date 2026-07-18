/**
 * Browser providers.
 *
 * Proving is wallet-delegated by default (1AM -> ProofStation) via
 * getProvingProvider(zkConfigProvider.asKeyMaterialProvider()); an advanced
 * setting can route proofs to a local proof server instead. Balancing +
 * submission go through the wallet, and the wallet's balanced hex is
 * submitted VERBATIM (re-serializing can corrupt the dust-spend proof:
 * node error 1010 InvalidDustSpendProof).
 */

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { createProofProvider, type UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import {
  Transaction,
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
} from '@midnight-ntwrk/ledger-v8';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import {
  createPrivateStateProvider,
  type SlicerCircuitKeys,
  type SlicerProviders,
} from '@moonray/api';
import type { RunRecord, SlicerPrivateState } from '@moonray/contract';
import { LS_RUNS, LS_SECRET_KEY, type UiNetworkConfig } from '../config';

const balancedTxHex = new WeakMap<object, string>();

/**
 * Hosted preview/preprod indexers have a GraphQL bug with `offset: null` in
 * latest-state queries, which the SDK's plain queryContractState() hits.
 * Wrap the provider so config-less latest reads go through a direct query
 * (the documented 1AM workaround). Local indexers don't need it.
 */
const patchPublicDataProvider = <T extends { queryContractState: (a: string, c?: unknown) => Promise<unknown> }>(
  base: T,
  indexerUri: string,
): T => ({
  ...base,
  async queryContractState(contractAddress: string, config?: unknown) {
    if (config) return base.queryContractState(contractAddress, config);
    const res = await fetch(indexerUri, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query LATEST($address: HexEncoded!) { contractAction(address: $address) { state } }`,
        variables: { address: contractAddress },
      }),
    });
    if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
    const payload = await res.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((e: { message: string }) => e.message).join('; '));
    }
    const action = payload.data?.contractAction;
    return action ? ContractState.deserialize(hexToBytes(action.state)) : null;
  },
});

const hexToBytes = (h: string) => new Uint8Array(h.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** localStorage-mirrored private state (secretKey + runs; stagedRun transient). */
export const localStorageHooks = () => ({
  load: (): SlicerPrivateState | null => {
    const skHex = localStorage.getItem(LS_SECRET_KEY);
    if (!skHex) return null;
    const runs = JSON.parse(localStorage.getItem(LS_RUNS) ?? '{}') as Record<string, RunRecord>;
    return { secretKey: hexToBytes(skHex), runs };
  },
  save: (_key: string, state: SlicerPrivateState | null): void => {
    if (!state) return;
    localStorage.setItem(LS_SECRET_KEY, bytesToHex(state.secretKey));
    localStorage.setItem(LS_RUNS, JSON.stringify(state.runs));
  },
});

/** The player's persistent secret key (created lazily, never leaves the device). */
export const loadOrCreateSecretKey = (): Uint8Array => {
  const existing = localStorage.getItem(LS_SECRET_KEY);
  if (existing) return hexToBytes(existing);
  const sk = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(LS_SECRET_KEY, bytesToHex(sk));
  return sk;
};

export interface BuildProvidersOptions {
  api: ConnectedAPI;
  config: UiNetworkConfig;
  /** route proofs to a local proof server instead of the wallet (advanced) */
  useLocalProver: boolean;
}

export async function buildBrowserProviders(opts: BuildProvidersOptions): Promise<SlicerProviders> {
  const { api, config } = opts;
  const walletConfig = await api.getConfiguration();
  const shieldedAddresses = await api.getShieldedAddresses();

  const zkConfigProvider = new FetchZkConfigProvider<SlicerCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );

  const proofProvider = opts.useLocalProver
    ? httpClientProofProvider(config.proofServer, zkConfigProvider)
    : createProofProvider(await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider()));

  const walletProvider: SlicerProviders['walletProvider'] = {
    getCoinPublicKey() {
      return shieldedAddresses.shieldedCoinPublicKey;
    },
    getEncryptionPublicKey() {
      return shieldedAddresses.shieldedEncryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
      const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      const finalized = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature',
        'proof',
        'binding',
        fromHex(balanced),
      );
      balancedTxHex.set(finalized as unknown as object, balanced);
      return finalized;
    },
  };

  const midnightProvider: SlicerProviders['midnightProvider'] = {
    async submitTx(tx: FinalizedTransaction): Promise<string> {
      const exact = balancedTxHex.get(tx as unknown as object);
      await api.submitTransaction(exact ?? toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  };

  const indexerUri = walletConfig.indexerUri ?? config.indexer;
  const indexerWsUri = walletConfig.indexerWsUri ?? config.indexerWS;
  const basePublic = indexerPublicDataProvider(indexerUri, indexerWsUri);

  return {
    privateStateProvider: createPrivateStateProvider<'MoonraySlicerState', SlicerPrivateState>(
      localStorageHooks(),
    ) as never,
    publicDataProvider:
      config.networkId === 'undeployed'
        ? basePublic
        : (patchPublicDataProvider(basePublic as never, indexerUri) as never),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

/** Read-only providers (ranking without a wallet). */
export const readonlyProviders = (config: UiNetworkConfig) => {
  const base = indexerPublicDataProvider(config.indexer, config.indexerWS);
  return {
    publicDataProvider:
      config.networkId === 'undeployed'
        ? base
        : (patchPublicDataProvider(base as never, config.indexer) as never),
  };
};
