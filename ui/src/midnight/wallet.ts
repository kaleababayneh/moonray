/**
 * Midnight wallet connector (dApp connector API v4) — lumera pattern.
 * Scans window.midnight for any 4.x connector, preferring 1AM.
 */

import '@midnight-ntwrk/dapp-connector-api';
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { SESSION_WALLET_KEY } from '../config';

const COMPATIBLE_API_MAJOR = '4.';

function isCompatible(w: unknown): w is InitialAPI {
  return (
    !!w &&
    typeof w === 'object' &&
    'apiVersion' in w &&
    String((w as InitialAPI).apiVersion).startsWith(COMPATIBLE_API_MAJOR)
  );
}

function findCompatibleWallet(): InitialAPI | null {
  const injected = window.midnight;
  if (!injected) return null;
  const oneAm = injected['1am'];
  if (isCompatible(oneAm)) return oneAm;
  return Object.values(injected).find(isCompatible) ?? null;
}

/** Poll for an injected compatible wallet (extensions can inject late). */
export function detectWallet(timeoutMs = 4_000): Promise<InitialAPI | null> {
  return new Promise((resolve) => {
    const found = findCompatibleWallet();
    if (found) {
      resolve(found);
      return;
    }
    const started = Date.now();
    const interval = setInterval(() => {
      const w = findCompatibleWallet();
      if (w) {
        clearInterval(interval);
        resolve(w);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

export interface WalletSession {
  api: ConnectedAPI;
  walletName: string;
  networkId: string;
}

export async function connectWallet(expectedNetworkId: string): Promise<WalletSession> {
  const wallet = await detectWallet();
  if (!wallet) {
    const seen = window.midnight ? Object.keys(window.midnight).join(', ') : 'none';
    throw new Error(
      `No compatible Midnight wallet found (injected: ${seen}). ` +
        'Install 1AM (https://1am.xyz/install-beta), unlock it, and reload.',
    );
  }

  let api: ConnectedAPI;
  try {
    api = await wallet.connect(expectedNetworkId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${wallet.name} refused the connection: ${msg}. Make sure it is unlocked, ` +
        `set to "${expectedNetworkId}", and that this site is authorized.`,
    );
  }

  const config = await api.getConfiguration();
  if (config.networkId !== expectedNetworkId) {
    throw new Error(
      `Wallet is on "${config.networkId}" but this game is deployed on "${expectedNetworkId}". ` +
        'Switch the network in the wallet and reconnect.',
    );
  }

  sessionStorage.setItem(SESSION_WALLET_KEY, '1');
  return { api, walletName: wallet.name, networkId: config.networkId };
}

export async function restoreWalletSession(expectedNetworkId: string): Promise<WalletSession | null> {
  if (!sessionStorage.getItem(SESSION_WALLET_KEY)) return null;
  try {
    return await connectWallet(expectedNetworkId);
  } catch {
    sessionStorage.removeItem(SESSION_WALLET_KEY);
    return null;
  }
}

export function forgetWalletSession(): void {
  sessionStorage.removeItem(SESSION_WALLET_KEY);
}
