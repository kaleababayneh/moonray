/** Network presets shared by CLI and UI. */

export type NetworkName = 'local' | 'preprod' | 'preview';

export interface NetworkConfig {
  readonly networkId: 'undeployed' | 'preprod' | 'preview';
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  local: {
    networkId: 'undeployed',
    indexer: 'http://127.0.0.1:8088/api/v3/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
    node: 'http://127.0.0.1:9944',
    proofServer: 'http://127.0.0.1:6300',
  },
  preprod: {
    networkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
  },
  preview: {
    networkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
  },
};
