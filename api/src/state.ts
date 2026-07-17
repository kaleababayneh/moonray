/**
 * Indexer observable -> typed view models.
 *
 * Nullifiers keep entries anonymous on-chain; the client recognises only its
 * own (via pureCircuits.nullifierFor on its local secret key).
 */

import { map, type Observable, retry } from 'rxjs';
import { ledger, type Ledger } from '@moonray/contract';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import type { SlicerProviders } from './common-types.js';

export type TournamentPhase = 'upcoming' | 'open' | 'reveal' | 'closed';

export interface RevealedEntry {
  nullifier: bigint;
  score: number;
}

export interface BadgeEntry {
  nullifier: bigint;
  tier: number;
}

export interface TournamentView {
  tid: bigint;
  seed: bigint;
  submitUntil: number; // unix seconds
  revealUntil: number;
  phase: TournamentPhase;
  entries: number; // sealed submissions
  ranking: RevealedEntry[]; // revealed, sorted desc
}

export interface LedgerView {
  tournaments: TournamentView[];
  badges: BadgeEntry[];
  sealedCommits: Map<bigint, bigint>; // nullifier -> commitment
  playedNullifiers: Set<bigint>;
  raw: Ledger;
}

export const phaseAt = (nowSec: number, submitUntil: number, revealUntil: number): TournamentPhase =>
  nowSec < submitUntil ? 'open' : nowSec < revealUntil ? 'reveal' : 'closed';

export const decodeLedger = (l: Ledger, nowSec = Math.floor(Date.now() / 1000)): LedgerView => {
  const sealedCommits = new Map<bigint, bigint>();
  for (const [nul, commit] of l.sealedScores) sealedCommits.set(nul, commit);

  const playedNullifiers = new Set<bigint>();
  for (const nul of l.played) playedNullifiers.add(nul);

  const revealed: RevealedEntry[] = [];
  for (const [nul, score] of l.revealedScores) revealed.push({ nullifier: nul, score: Number(score) });
  revealed.sort((a, b) => b.score - a.score);

  const badges: BadgeEntry[] = [];
  for (const [nul, tier] of l.badges) badges.push({ nullifier: nul, tier: Number(tier) });

  const tournaments: TournamentView[] = [];
  for (const [tid, t] of l.tournaments) {
    tournaments.push({
      tid,
      seed: t.seed,
      submitUntil: Number(t.submitUntil),
      revealUntil: Number(t.revealUntil),
      phase: phaseAt(nowSec, Number(t.submitUntil), Number(t.revealUntil)),
      // sealed entries are global; per-tournament attribution is impossible by
      // design (nullifiers are unlinkable) — entries counts ALL sealed commits.
      entries: sealedCommits.size,
      ranking: revealed,
    });
  }
  tournaments.sort((a, b) => Number(b.tid - a.tid));

  return { tournaments, badges, sealedCommits, playedNullifiers, raw: l };
};

/** Live ledger view from the indexer (auto-retrying websocket observable). */
export const watchLedger = (
  providers: Pick<SlicerProviders, 'publicDataProvider'>,
  address: ContractAddress,
): Observable<LedgerView> =>
  providers.publicDataProvider
    .contractStateObservable(address, { type: 'latest' })
    .pipe(
      map((cs) => decodeLedger(ledger(cs.data))),
      retry({ delay: 2_000 }),
    );

/** One-shot ledger view (also works without a websocket). */
export const fetchLedger = async (
  providers: Pick<SlicerProviders, 'publicDataProvider'>,
  address: ContractAddress,
): Promise<LedgerView | null> => {
  const cs = await providers.publicDataProvider.queryContractState(address);
  return cs ? decodeLedger(ledger(cs.data)) : null;
};
