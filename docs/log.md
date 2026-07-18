# Build log

## Phase 0 — Environment (2026-07-17)

| Component | Version |
|---|---|
| Node.js | v22.18.0 |
| compact toolchain | 0.31.1 (`pragma language_version 0.23`) |
| @midnight-ntwrk/midnight-js-* | 4.1.1 (root overrides) |
| @midnight-ntwrk/ledger-v8 | 8.1.0 |
| @midnight-ntwrk/compact-runtime | 0.16.x |
| docker images | midnight-node:0.22.3 · indexer-standalone:4.0.0 · proof-server:8.0.3 |

Compact language findings that reshaped the STEPS.md blueprint (compiler is referee):

- **No mutable locals** (`var`/`let` are reserved, no reassignment). All accumulation
  is `fold`/`map` with tuple accumulators; `for (const i of a..b)` (end-exclusive)
  works for assert-only passes with compile-time indices.
- Range `0..n` is end-exclusive. `v[i]` needs a compile-time `i` — the wrap edge
  (verts[9] -> verts[0]) is handled outside the loop, plus canonical padding
  (verts[k >= vertCount] == verts[0], asserted) makes all piece-edge logic uniform.
- Field supports `+`/`*` (mod p) and `==`; struct equality works; struct-typed
  `transientHash<T>` works; tuple returns work.
- Circuit args are private by default: every ledger write of an arg needs `disclose()`.

## Phase 1–2 — Circuit + full-compile spike (2026-07-17)

`compact compile --skip-zk` clean on first full draft. Full keygen: **38 s** for all
5 circuits (Apple Silicon).

| Circuit | prover key | verifier key | zkir |
|---|---|---|---|
| submitRun | 33.9 MB | 1.3 KB | 832 KB |
| createTournament | 2.8 MB | 2.1 KB | 4.7 KB |
| addAdmin | 2.8 MB | 2.1 KB | 3.1 KB |
| revealScore | 148 KB | 1.3 KB | 7.9 KB |
| claimBadge | 288 KB | 1.3 KB | 4.9 KB |

(compact 0.31.1 no longer prints per-circuit k/rows; sizes above are the proxy.
Wall-clock proving time to be measured in the Phase 7 e2e against the local
proof server.)

Bounds frozen as designed: 8-vert octagon board, ≤3 cuts, ≤8 pieces × 10 verts,
4–6 objects, GRID 4096.

### Soundness deltas vs the STEPS.md blueprint

1. **Normalized tolerances.** Fixed cross-product tolerances (TOL/TOL_IN) leak
   px-slack inversely proportional to edge length. Replaced with squared,
   length-normalized checks: colinearity `(P-N)^2 <= 4 * |ST|^2` (2 px), containment
   `P > N && (P-N)^2 > 2025 * |AB|^2` (45 px), computed subtraction-free as
   `P^2 + N^2 <=> 2PN + tol*L2`. This closes a strip-double-claim exploit that the
   blueprint's fixed AREA_TOL=262144 would have admitted (details in README threat
   model): with normalized 45 px containment margins the cheapest fake overlap costs
   ~73k area units while AREA_TOL is now 32768 and honest rounding error is ~15k.
2. **Cut minimum length** (512 on some axis) — degenerate/short cuts would make
   colinearity vacuous. The engine draws full-crossing chords anyway.
3. **Unique seed-limb decomposition** via `hi: Uint<7>, hi <= 114` (so
   hi*2^248 + limbs < p strictly; no second decomposition mod p exists). ~0.8% of
   seeds (entropy floor 115) are deterministically unusable; seed pickers skip them.
4. **Canonical vertex padding** asserted in-circuit (repeat verts[0]) — makes
   shoelace, edge iteration and containment uniform over the fixed 10-slot vector.

Generated artifact facts: only impure circuits get keys/zkir; exported pure
circuits (`verifyRunPure`, `buildLevelFrom`, hashes) compile to plain TS in
`pureCircuits` — the UI preflight and engine goldens call the exact circuit code.

## Phase 6–7 — API + CLI + local e2e (2026-07-17)

E2E on the local stack (node 0.22.5 / indexer-standalone 4.0.2 / proof-server
8.0.3), REAL proofs via the local proof server — passed first run:

| Step | wall clock |
|---|---|
| deploy (constructor proof + tx) | 18.5 s |
| createTournament | 17.4 s |
| **submitRun** (the big circuit: proof + balance + submit) | **30.7 s / 24.1 s** |
| revealScore | 20.5 / 18.7 s |
| claimBadge | 17.4 s |

Flow verified on-chain: two players seal under distinct nullifiers; replay
rejected by the node ("already played"); wrong-level witnesses blocked by
preflight ("edge start off source line"); ranking [45, 0] after reveals;
Silver badge claimed with the score still sealed on the badge path.

## Redesign — two irregular plates, collect/dissolve (2026-07-18)

Rebuilt to match the user's frontend prototype (game-visual-update): TWO
lopsided convex plates (octagon + heptagon, hill-climb-searched irregular
templates with verified margins), per-board daily center drift, 3-7 moonlets
per plate (6-14 total), and the collect/dissolve mechanic — a piece holding
exactly one moonlet retires and collects it.

Key findings:

- **Collect/dissolve is provable with ZERO extra circuit machinery.** Claimed
  pieces = retired pieces + survivors; every claimed piece is a disjoint union
  of cut-arrangement cells, so the set still tiles both plates exactly and
  never exceeds 8 + 3 crossings = 11 pieces. A collected moonlet's containment
  proof runs against its retired piece, which legalises the frontend's rule
  that later cuts ignore collected moonlets.
- **Entropy budget:** two streams (transientHash([seed,1]) / ([seed,2])), 62
  limbs exactly: 30 board-vertex jitters + 28 object jitters + 4 center-drift
  limbs; moonlet counts ride the hi limbs (5 uniform bands over 0..114).
- **Degenerate-edge bug** found by the 100-seed property suite: a cut through
  a plate vertex produced two rounded intersection points 1px apart — a
  degenerate edge whose line is numerically meaningless, failing containment.
  Fix: merge ring vertices within 6px; if source-tracking still fails, the
  cut is rejected as "grazes a corner" (honest UX, rare).
- Scoring per the prototype: 10 x isolated + full-clear bonus 5 x (4 - cuts);
  tiers Bronze 40 / Silver 70 / Gold 85. Heavy days (>11 moonlets) provably
  cannot full-clear (pigeonhole); max 11 isolated.
- Circuit cost roughly doubled: submitRun prover key 34 MB -> 68 MB, full
  keygen 38 s -> 67 s. Prove time re-measured in the e2e below.
- What Compact cannot reproduce from the prototype: convex-hull-of-random-
  points level generation with variable vertex counts (loops/sorting/retries).
  Replaced with jittered irregular fixed-topology templates + center drift —
  visually equivalent variety, deterministic, in-circuit. Non-convex plates
  (prototype example 3) are out: they'd break the all-edges-inside containment
  and the anti-overlap tiling proof.

## Two-plate circuit on-chain + prototype UI port (2026-07-18)

- Fresh deploy of the two-plate collect/dissolve circuit: constructor proof
  22.6 s, createTournament 18.8 s. Both demo submitRun proofs (the doubled
  circuit, 68 MB prover key) proved + balanced + landed within a 4-minute
  window — roughly <= ~2 min each, wallet included.
- Gotcha: after a multi-minute idle the headless wallet's dust-coin selection
  can go stale -> node rejects with `1010: Custom error 104`. Remedy:
  `cli/src/demo-finish.ts` (re-sync + retry); demo-seed now points at it.
- UI completely re-skinned as the user's `game-visual-update` prototype
  ("open field" design v3) — see the UI commit for the inventory. All chain
  features preserved: wallet chip, seal ceremony, archive ledger/honours,
  vault backup, live tournament state in the title menu.
