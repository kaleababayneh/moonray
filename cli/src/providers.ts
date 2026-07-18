/**
 * Node provider assembly for the CLI (local stack or preprod with a local
 * proof server). One wallet funds everything; each identity (admin, alice,
 * bob...) gets its own private-state file under cli/.state/ so secret keys
 * and reveal nonces survive process restarts.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createPrivateStateProvider,
  NETWORKS,
  type NetworkConfig,
  type NetworkName,
  type SlicerCircuitKeys,
  type SlicerProviders,
} from '@moonray/api';
import type { SlicerPrivateState } from '@moonray/contract';
import {
  buildWalletAndWaitForFunds,
  createWalletAndMidnightProvider,
  GENESIS_MINT_WALLET_SEED,
  type WalletContext,
} from './wallet.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Path to the compiled contract assets (keys/, zkir/, contract/). */
export const ZK_CONFIG_PATH = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'slicer');

const STATE_DIR = path.resolve(currentDir, '..', '.state');

/** Persistent deployment-wallet seed per network (git-ignored, 0600). */
export const seedFileFor = (network: NetworkName): string =>
  path.join(STATE_DIR, `${network}-wallet-seed`);

export const loadOrCreateSeed = (network: NetworkName): string => {
  const file = seedFileFor(network);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const seed = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(file, seed, { mode: 0o600 });
  return seed;
};

interface StoredState {
  secretKeyHex: string;
  runs: SlicerPrivateState['runs'];
}

const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

/** File-backed persistence hooks (stagedRun is transient and never persisted). */
const fileHooks = (name: string) => {
  const file = path.join(STATE_DIR, `${name}.json`);
  return {
    load: (): SlicerPrivateState | null => {
      if (!fs.existsSync(file)) return null;
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredState;
      return { secretKey: fromHex(stored.secretKeyHex), runs: stored.runs };
    },
    save: (_key: string, state: SlicerPrivateState | null): void => {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      if (state === null) {
        fs.rmSync(file, { force: true });
        return;
      }
      const stored: StoredState = { secretKeyHex: toHex(state.secretKey), runs: state.runs };
      fs.writeFileSync(file, JSON.stringify(stored, null, 2));
    },
  };
};

export interface CliContext {
  network: NetworkName;
  config: NetworkConfig;
  walletContext: WalletContext;
  walletAndMidnightProvider: Awaited<ReturnType<typeof createWalletAndMidnightProvider>>;
  zkConfigProvider: NodeZkConfigProvider<SlicerCircuitKeys>;
}

export const resolveNetwork = (arg: string | undefined): NetworkName => {
  const name = (arg ?? 'local') as NetworkName;
  if (!(name in NETWORKS)) throw new Error(`unknown network ${name}`);
  return name;
};

/** Build the shared wallet + network context once per process. */
export const buildCliContext = async (network: NetworkName, seed?: string): Promise<CliContext> => {
  const config = NETWORKS[network];
  setNetworkId(config.networkId);

  const walletSeed =
    seed ??
    (network === 'local'
      ? GENESIS_MINT_WALLET_SEED
      : process.env.WALLET_SEED ?? loadOrCreateSeed(network));

  const walletContext = await buildWalletAndWaitForFunds(config, walletSeed);
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(walletContext);
  const zkConfigProvider = new NodeZkConfigProvider<SlicerCircuitKeys>(ZK_CONFIG_PATH);
  return { network, config, walletContext, walletAndMidnightProvider, zkConfigProvider };
};

/** Providers for one identity (own private-state file, shared wallet). */
export const providersFor = (ctx: CliContext, stateName: string): SlicerProviders => ({
  privateStateProvider: createPrivateStateProvider<'MoonraySlicerState', SlicerPrivateState>(
    fileHooks(`${ctx.network}-${stateName}`),
  ) as never,
  publicDataProvider: indexerPublicDataProvider(ctx.config.indexer, ctx.config.indexerWS),
  zkConfigProvider: ctx.zkConfigProvider,
  proofProvider: httpClientProofProvider(ctx.config.proofServer, ctx.zkConfigProvider),
  walletProvider: ctx.walletAndMidnightProvider,
  midnightProvider: ctx.walletAndMidnightProvider,
});

export const writeDeployment = (network: NetworkName, address: string): void => {
  const payload = {
    network,
    networkId: NETWORKS[network].networkId,
    address,
    deployedAt: new Date().toISOString(),
  };
  const cliFile = path.resolve(currentDir, '..', `deployment.${network}.json`);
  fs.writeFileSync(cliFile, JSON.stringify(payload, null, 2));
  // The UI fetches /deployment.json at runtime.
  const uiFile = path.resolve(currentDir, '..', '..', 'ui', 'public', 'deployment.json');
  fs.mkdirSync(path.dirname(uiFile), { recursive: true });
  fs.writeFileSync(uiFile, JSON.stringify(payload, null, 2));
  // keep an already-built dist current too (build+start architecture)
  const distFile = path.resolve(currentDir, '..', '..', 'ui', 'dist', 'deployment.json');
  if (fs.existsSync(path.dirname(distFile))) {
    fs.writeFileSync(distFile, JSON.stringify(payload, null, 2));
  }
  console.log(`  deployment written: ${cliFile} (+ ui/public + ui/dist)`);
};

export const readDeployment = (network: NetworkName): { address: string } => {
  const file = path.resolve(currentDir, '..', `deployment.${network}.json`);
  if (!fs.existsSync(file)) throw new Error(`no deployment file for ${network}; run deploy first`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
