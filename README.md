# Moonray: Slicer

BUILT FOR MLH X MIDNIGHT HACKATHON

Play it live: **https://moonray-slicer.vercel.app** — use the 1AM wallet on preprod to test!

**A proof score arcade game on [Midnight](https://midnight.network).** Everyone plays the same
seed-derived field each day: TWO irregular survey plates holding 8–14 glowing *moonlets*,
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
2. **Prove** — *Prove run* generates a ZK proof that your hidden partition is geometrically
   valid for today's seed and scores what you claim, then writes a **hidden score commitment**
   under an anonymous **nullifier**. `score = 10·isolated + (fullClear ? 5·(4−cutsUsed) : 0)`.
3. **Reveal — or don't** — put your number on the leaderboard whenever you choose (even while
   the field is still open), or keep it hidden forever. Same entry, your choice of disclosure.
   That asymmetry is the whole point.

## Architecture

```
moonray/
├── contract/   Compact circuit + witnesses + simulator cheat tests
│   └── src/slicer.compact       — the whole game as 4 circuits
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
| `submitRun` | in-circuit level gen (two plates, dual entropy streams) + full geometric verification of the claimed partition incl. dissolved pieces + nullifier + hidden commit | 68 MB |
| `revealScore` | open the commitment, any time before the reveal deadline | 148 KB |
| `createTournament` / `addAdmin` | admin ops (domain-separated key hash) | 2.8 MB |

`submitRun` verifies, in order: bounds; cut min-length; per-piece canonical padding + edge-source
colinearity (every piece edge must lie on a *hinted* board edge or cut line — the xray hint trick
as witnesses); CCW orientation; **area tiling** (Σ piece shoelace sums ≈ board's — closes xray's
piece-inflation hole); object containment with normalized 45px margins; pairwise isolation;
score. All arithmetic is `+ − ·` on `Uint` — the P/N cross-product decomposition needs no
subtraction and no division anywhere.

### Ledger disclosure map

| Ledger item | Contains | Reveals |
|---|---|---|
| `played` | nullifier | that *someone* entered; unlinkable without the secret key |
| `sealedScores[nul]` | `transientCommit(score, nonce)` | nothing about the score |
| `revealedScores[nul]` | score | the score, by the player's explicit choice |
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
npm run deploy:local     # deploy + open a tournament; writes ui/public/deployment.json
npm run e2e:local        # full on-chain e2e with real proofs (~6 min incl. reveal window)

npm run build:start      # UI at http://localhost:8081 (static build, lumera pattern)
```

**Practice mode** works with no wallet and no chain. The **daily tournament** flow in the browser
needs a dApp-connector-v4 wallet (1AM preferred, Lace works) on the network the contract is
deployed to. The run proof needs a 68 MB proving key — more than the wallet's messaging channel
accepts — so proving runs on a local proof server
(`docker run -d -p 6300:6300 midnightnetwork/proof-server:8.0.3`); the wallet still balances,
pays and submits.

### Preprod

Deployment happens **from the browser**, using the already-synced 1AM wallet (a headless CLI
wallet OOMs syncing preprod): open the unlinked, passphrase-gated `/deploy` route, connect,
and click **DEPLOY CONTRACT** — the constructor is proven and paid by the wallet, today's
operation opens automatically, and the deployment is saved for that browser. Put the shown
JSON into `deployment.json` next to the app bundle to point every visitor at it, then:

```bash
npm run deploy:vercel    # build + push ui/dist (keys, zkir, deployment.json) to Vercel
```

## Measured numbers (Apple Silicon laptop, local stack)

| Step | Time |
|---|---|
| full compile incl. ZK keygen (4 circuits) | 67 s |
| `submitRun` — proof + balance + submit | ~50–70 s via the local proof server |
| `revealScore` / `createTournament` | 17–21 s |
| engine + contract test suites (32 tests incl. cheat suite) | < 2 s |
