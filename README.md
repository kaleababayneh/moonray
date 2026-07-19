# Moonray: Slice

Use 1AM wallet on preprod to test!

**A proof score arcade game on [Midnight](https://midnight.network).** Everyone plays the same
seed-derived field each day: TWO irregular survey plates holding 6–14 glowing *moonlets*,
sliced by up to 3 shared straight cuts. A piece left holding exactly one moonlet dissolves and
*collects* it. Your cuts and your score stay private — a zero-knowledge proof, verified by
network consensus, shows they're valid.

## Why this needs Midnight, in one line

Everyone plays the same board, so public solutions would be copy-pasted instantly and public
scores would be sniped — the game is only fair because cuts and scores stay private *while
their validity is proven*.

## The loop

1. **Play locally** — the board derives from the tournament seed on your device. Cut, undo,
   retry; it's instant and free (practice mode needs no wallet at all).
2. **Seal** — *Submit run* generates a ZK proof that your hidden partition is geometrically
   valid for today's seed and scores what you claim, then writes a **sealed score commitment**
   under an anonymous **nullifier**. `score = 10·isolated + (fullClear ? 5·(4−cutsUsed) : 0)`.
3. **Reveal — or don't** — after submissions close, reveal your score for the leaderboard, or
   `claimBadge` a tier (Bronze 40 / Silver 70 / Gold 85) and never reveal the number. Same
   entry, your choice of disclosure. That asymmetry is the whole point.

## Architecture

```
moonray/
├── contract/   Compact circuit + witnesses + simulator cheat tests
│   └── src/slicer.compact       — the whole game as 5 circuits
├── engine/     deterministic BigInt game core (zero midnight deps)
├── api/        midnight-js 4.1.1 wiring shared by cli/ and ui/
├── cli/        headless wallet: docker stack, deploy, e2e with real proofs
└── ui/         React + Vite + canvas (dark midnight theme)
```

**Zero-drift trick:** the heavy verification (`verifyRunPure`) and level generation
(`buildLevelFrom`) are *exported pure circuits* — the compiler emits them as plain TypeScript in
`pureCircuits`, so the UI preflight, the engine's golden tests, and the proof all execute the
**exact same code**. A run that passes preflight cannot burn a proof on an unprovable witness.

### The circuit (contract/src/slicer.compact)

| Circuit | Purpose | Prover key |
|---|---|---|
| `submitRun` | in-circuit level gen (two plates, dual entropy streams) + full geometric verification of the claimed partition incl. dissolved pieces + nullifier + sealed commit | 68 MB |
| `revealScore` | open the commitment during the reveal window | 148 KB |
| `claimBadge` | prove `score ≥ tier` — score stays private (args are private by default) | 288 KB |
| `createTournament` / `addAdmin` | admin ops (domain-separated key hash) | 2.8 MB |

`submitRun` verifies, in order: bounds; cut min-length; per-piece canonical padding + edge-source
colinearity (every piece edge must lie on a *hinted* board edge or cut line — the xray hint trick
as witnesses); CCW orientation; **area tiling** (Σ piece shoelace sums ≈ board's — closes xray's
piece-inflation hole); object containment with normalized 45px margins; pairwise isolation;
score. All arithmetic is `+ − ·` on `Uint` — the P/N cross-product decomposition needs no
subtraction and no division anywhere.

### Threat model (honest notes)

- **Proven:** partition validity, level integrity (seed → board is recomputed in-circuit from
  witnessed limbs with a uniqueness-constrained decomposition, `hi ≤ 114`), one entry per player
  per tournament (nullifier), score correctness, commitment binding, time windows.
- **Accepted looseness:** vertices may sit up to 2px off their source lines (lattice rounding);
  tiling tolerates `AREA_TOL = 32768` (2·area units, ~0.2% of the board). Tolerances are
  **length-normalized** (squared comparisons), so the cheapest known overlap exploit costs ~73k
  area units — more than double the allowance. Piece edges are checked against *full-chord* cut
  lines (the engine always extends cuts across the board), which removes xray's infinite-line
  looseness in practice.
- **Trusted:** the tournament seed publisher (seeds are public; a malicious admin could play a
  seed before publishing — commit-reveal seeds are the natural next step). ~0.8% of candidate
  seeds are deterministically unusable (entropy decomposition bound) and are skipped at creation.
- **Metadata:** tx timing/fees/circuit-id are visible to node & indexer operators, as on any chain.

### Ledger disclosure map

| Ledger item | Contains | Reveals |
|---|---|---|
| `played` | nullifier | that *someone* entered; unlinkable without the secret key |
| `sealedScores[nul]` | `transientCommit(score, nonce)` | nothing about the score |
| `revealedScores[nul]` | score | the score, by the player's explicit choice |
| `badges[nul]` | tier | a threshold fact only — the exact score is never derivable |
| never on-chain | cuts, pieces, hints, secretKey, nonce, unrevealed scores | — |

## Running it

Prereqs: Node 22+, Docker, Compact toolchain 0.31.x
(`curl -fsSL https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | bash && compact update`).

```bash
npm install
npm run compact          # compile the circuit (once; ~40s incl. ZK keys)
npm run build:contract && npm run build:engine && npm run build --workspace @moonray/api

npm test                 # engine lockstep tests + contract simulator cheat suite

# local chain (node + indexer + proof server)
npm run stack:up --workspace @moonray/cli     # or use an already-running stack on 8088/9944/6300
npm run deploy:local     # deploy + open a 6h tournament; writes ui/public/deployment.json
npm run e2e:local        # full on-chain e2e with real proofs (~6 min incl. reveal window)

npm run dev              # UI at http://localhost:5173
```

**Practice mode** works with no wallet and no chain. The **daily tournament** flow in the browser
needs a dApp-connector-v4 wallet (1AM preferred, Lace works) on the network the contract is
deployed to; proving is wallet-delegated (ProofStation) with an optional local-prover setting.

### Preprod

```bash
# fund a wallet with tNIGHT (faucet), register NIGHT for DUST generation (the CLI does this),
WALLET_SEED=<hex-seed> npx tsx cli/src/deploy.ts preprod
VITE_MOONRAY_NETWORK=preprod npm run build   # then host ui/dist statically (keys/zkir included)
```

## Measured numbers (Apple Silicon laptop, local stack)

| Step | Time |
|---|---|
| full compile incl. ZK keygen (5 circuits) | 67 s |
| `submitRun` — proof + balance + submit | see docs/log.md (roughly 2x the single-plate 25–31 s) |
| `revealScore` / `claimBadge` / `createTournament` | 17–21 s |
| engine + contract test suites (32 tests incl. cheat suite) | < 2 s |
