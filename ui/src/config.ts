/** Moonray UI configuration. */

const env = import.meta.env as Record<string, string | undefined>;

export type UiNetwork = 'local' | 'preprod';

/** Which network preset to use when no wallet dictates one. */
export const DEFAULT_NETWORK: UiNetwork = (env.VITE_MOONRAY_NETWORK as UiNetwork) ?? 'local';

export interface UiNetworkConfig {
  networkId: 'undeployed' | 'preprod';
  indexer: string;
  indexerWS: string;
  proofServer: string;
}

export const UI_NETWORKS: Record<UiNetwork, UiNetworkConfig> = {
  local: {
    networkId: 'undeployed',
    indexer: env.VITE_INDEXER_URI ?? 'http://127.0.0.1:8088/api/v3/graphql',
    indexerWS: env.VITE_INDEXER_WS_URI ?? 'ws://127.0.0.1:8088/api/v3/graphql/ws',
    proofServer: env.VITE_PROOF_SERVER ?? 'http://127.0.0.1:6300',
  },
  preprod: {
    networkId: 'preprod',
    indexer: env.VITE_INDEXER_URI ?? 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: env.VITE_INDEXER_WS_URI ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    proofServer: env.VITE_PROOF_SERVER ?? 'http://127.0.0.1:6300',
  },
};

/** Contract address override (otherwise /deployment.json is fetched). */
export const CONTRACT_ADDRESS_OVERRIDE = env.VITE_CONTRACT_ADDRESS ?? '';

/** Leaderboard name registry (nickname + wallet published on register). */
export const NAMES_URL =
  env.VITE_NAMES_URL ?? `${window.location.protocol}//${window.location.hostname}:8082/`;

/** Run records (score+nonce) are per contract — a redeploy must not offer stale reveals. */
export const runsKeyFor = (contractAddress: string | null | undefined): string =>
  contractAddress ? `${LS_RUNS}:${contractAddress.slice(0, 16)}` : LS_RUNS;

export interface Deployment {
  network: string;
  networkId: string;
  address: string;
}

export const fetchDeployment = async (): Promise<Deployment | null> => {
  if (CONTRACT_ADDRESS_OVERRIDE) {
    const net = UI_NETWORKS[DEFAULT_NETWORK];
    return { network: DEFAULT_NETWORK, networkId: net.networkId, address: CONTRACT_ADDRESS_OVERRIDE };
  }
  // A deployment made from this browser (/deploy) wins over the bundled file.
  try {
    const local = localStorage.getItem(LS_DEPLOYMENT);
    if (local) return JSON.parse(local) as Deployment;
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch('/deployment.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Deployment;
  } catch {
    return null;
  }
};

// localStorage keys
export const LS_DEPLOYMENT = 'moonray_deployment_v1';
export const LS_SECRET_KEY = 'moonray_secret_key_v1';
export const LS_RUNS = 'moonray_runs_v1';
export const LS_PRACTICE_BEST = 'moonray_practice_best_v1';
export const LS_DAILY_BEST = 'moonray_daily_best_v1';
export const LS_THEME = 'moonray_theme_v1';
export const LS_DISPLAY_NAMES = 'moonray_display_names_v1';
export const LS_NICKNAME = 'moonray_callsign_v1';
export const SESSION_WALLET_KEY = 'moonray_wallet_session_v1';
