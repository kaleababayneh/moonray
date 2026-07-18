/**
 * App-level game context: deployment discovery, wallet session, contract
 * handle, live ledger view, and the submit/reveal/claim flows with staged
 * progress reporting (the "seal moment").
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Subscription } from 'rxjs';
import {
  fetchLedger,
  type LedgerView,
  MoonraySlicer,
  preflightRun,
  type SlicerProviders,
  watchLedger,
} from '@moonray/api';
import { pureCircuits } from '@moonray/contract';
import type { PlayState } from '@moonray/engine';
import {
  DEFAULT_NETWORK,
  fetchDeployment,
  UI_NETWORKS,
  type UiNetworkConfig,
} from '../config';
import { connectWallet, forgetWalletSession, restoreWalletSession, type WalletSession } from './wallet';
import { buildBrowserProviders, loadOrCreateSecretKey, readonlyProviders } from './providers';

export type SealStage =
  | 'idle'
  | 'preflight'
  | 'witnesses'
  | 'proving'
  | 'submitting'
  | 'sealed'
  | 'error';

export interface SealProgress {
  stage: SealStage;
  detail?: string;
  txHash?: string;
  score?: number;
}

export interface GameContextValue {
  networkConfig: UiNetworkConfig;
  networkId: string;
  contractAddress: string | null;
  walletName: string | null;
  walletAddress: string | null;
  connected: boolean;
  connecting: boolean;
  connectError: string | null;
  ledger: LedgerView | null;
  ledgerError: string | null;
  useLocalProver: boolean;
  setUseLocalProver(v: boolean): void;
  connect(): Promise<void>;
  disconnect(): void;
  /** Sealed-run progress for the modal. */
  seal: SealProgress;
  submitRun(tid: bigint, state: PlayState, seed: bigint): Promise<void>;
  revealScore(tid: bigint): Promise<{ score: number }>;
  claimBadge(tid: bigint, tier: 1 | 2 | 3): Promise<void>;
  dismissSeal(): void;
  myNullifier(tid: bigint): bigint;
  myRuns(): Record<string, { score: number; nonce: string; sealedAt?: number }>;
}

const GameContext = createContext<GameContextValue | null>(null);

export const useGame = (): GameContextValue => {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame outside provider');
  return ctx;
};

export const GameProvider = ({ children }: { children: ReactNode }) => {
  const [deploymentAddress, setDeploymentAddress] = useState<string | null>(null);
  const [networkKey, setNetworkKey] = useState(DEFAULT_NETWORK);
  const networkConfig = UI_NETWORKS[networkKey];

  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  // The wallet prover cannot take submitRun's 68 MB proving key through the
  // extension messaging channel ("Payload too large"), so local is the default.
  const [useLocalProver, setUseLocalProver] = useState(true);
  const [seal, setSeal] = useState<SealProgress>({ stage: 'idle' });

  const gameRef = useRef<MoonraySlicer | null>(null);
  const providersRef = useRef<SlicerProviders | null>(null);
  const sessionRef = useRef<WalletSession | null>(null);
  const secretKey = useMemo(loadOrCreateSecretKey, []);

  // deployment discovery
  useEffect(() => {
    fetchDeployment().then((d) => {
      if (!d) return;
      setDeploymentAddress(d.address);
      if (d.network === 'preprod' || d.networkId === 'preprod') setNetworkKey('preprod');
      else setNetworkKey('local');
    });
  }, []);

  // Ops created before the daily-tid convention carry hour-scale ids that
  // would render as far-future dates — hide them (daily ids stay < 100000
  // until the year 2243).
  const saneLedger = (v: LedgerView): LedgerView => ({
    ...v,
    tournaments: v.tournaments.filter((t) => t.tid < 100_000n),
  });

  // live ledger (read-only path works without a wallet)
  useEffect(() => {
    if (!deploymentAddress) return;
    let sub: Subscription | undefined;
    let cancelled = false;
    const ro = readonlyProviders(networkConfig);
    // initial one-shot fetch for fast paint, then subscribe
    fetchLedger(ro as never, deploymentAddress)
      .then((v) => {
        if (v && !cancelled) setLedger(saneLedger(v));
      })
      .catch((e) => setLedgerError(String(e)));
    try {
      sub = watchLedger(ro as never, deploymentAddress).subscribe({
        next: (v) => {
          setLedger(saneLedger(v));
          setLedgerError(null);
        },
        error: (e) => setLedgerError(String(e)),
      });
    } catch (e) {
      setLedgerError(String(e));
    }
    const poll = setInterval(() => {
      fetchLedger(ro as never, deploymentAddress)
        .then((v) => v && setLedger(saneLedger(v)))
        .catch(() => undefined);
    }, 15_000);
    return () => {
      cancelled = true;
      sub?.unsubscribe();
      clearInterval(poll);
    };
  }, [deploymentAddress, networkConfig]);

  const join = useCallback(
    async (providers: SlicerProviders) => {
      if (!deploymentAddress) throw new Error('no deployment configured');
      gameRef.current = await MoonraySlicer.join(
        providers,
        window.location.origin,
        deploymentAddress,
        secretKey,
      );
    },
    [deploymentAddress, secretKey],
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const session = await connectWallet(networkConfig.networkId);
      sessionRef.current = session;
      const providers = await buildBrowserProviders({
        api: session.api,
        config: networkConfig,
        useLocalProver,
      });
      providersRef.current = providers;
      await join(providers);
      setWalletName(session.walletName);
      session.api
        .getUnshieldedAddress()
        .then((a) => setWalletAddress(a.unshieldedAddress))
        .catch(() => undefined);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [networkConfig, useLocalProver, join]);

  // silent session restore
  useEffect(() => {
    if (!deploymentAddress) return;
    restoreWalletSession(networkConfig.networkId)
      .then(async (session) => {
        if (!session) return;
        sessionRef.current = session;
        const providers = await buildBrowserProviders({
          api: session.api,
          config: networkConfig,
          useLocalProver,
        });
        providersRef.current = providers;
        await join(providers);
        setWalletName(session.walletName);
        session.api
          .getUnshieldedAddress()
          .then((a) => setWalletAddress(a.unshieldedAddress))
          .catch(() => undefined);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentAddress]);

  // flipping the prover applies immediately to a live session
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;
    (async () => {
      const providers = await buildBrowserProviders({
        api: session.api,
        config: networkConfig,
        useLocalProver,
      });
      if (cancelled) return;
      providersRef.current = providers;
      await join(providers);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useLocalProver]);

  const disconnect = useCallback(() => {
    forgetWalletSession();
    gameRef.current = null;
    providersRef.current = null;
    sessionRef.current = null;
    setWalletName(null);
    setWalletAddress(null);
  }, []);

  const submitRun = useCallback(
    async (tid: bigint, state: PlayState, seed: bigint) => {
      const game = gameRef.current;
      if (!game) throw new Error('connect a wallet first');
      try {
        setSeal({ stage: 'preflight' });
        const pre = preflightRun(state, seed);
        if (!pre.ok) {
          setSeal({ stage: 'error', detail: `This run would not prove: ${pre.reason}` });
          return;
        }
        setSeal({ stage: 'witnesses', score: pre.score });
        await new Promise((r) => setTimeout(r, 350)); // let the stage render
        setSeal({ stage: 'proving', score: pre.score });
        const tx = await game.submitRun(tid, state, seed);
        setSeal({ stage: 'sealed', txHash: tx.txHash, score: tx.score });
      } catch (err) {
        setSeal({
          stage: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const revealScore = useCallback(async (tid: bigint) => {
    const game = gameRef.current;
    if (!game) throw new Error('connect a wallet first');
    const res = await game.revealScore(tid);
    return { score: res.score };
  }, []);

  const claimBadge = useCallback(async (tid: bigint, tier: 1 | 2 | 3) => {
    const game = gameRef.current;
    if (!game) throw new Error('connect a wallet first');
    await game.claimBadge(tid, tier);
  }, []);

  const myNullifier = useCallback(
    (tid: bigint) => pureCircuits.nullifierFor(secretKey, tid),
    [secretKey],
  );

  const myRuns = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('moonray_runs_v1') ?? '{}');
    } catch {
      return {};
    }
  }, []);

  const value: GameContextValue = {
    networkConfig,
    networkId: networkConfig.networkId,
    contractAddress: deploymentAddress,
    walletName,
    walletAddress,
    connected: walletName !== null,
    connecting,
    connectError,
    ledger,
    ledgerError,
    useLocalProver,
    setUseLocalProver,
    connect,
    disconnect,
    seal,
    submitRun,
    revealScore,
    claimBadge,
    dismissSeal: () => setSeal({ stage: 'idle' }),
    myNullifier,
    myRuns,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};
