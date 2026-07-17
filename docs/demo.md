# Demo script (≤ 3 minutes)

Setup beforehand: local stack running, `npm run deploy:local` done (tournament #1 open),
`npx tsx cli/src/demo-seed.ts local 2` done (tournament #2 already revealed: ranking 45/0 +
a Silver badge), UI at http://localhost:5173.

1. **Practice cut (30s).** Open the app — it's already playable, no wallet. Drag two cuts,
   watch pieces separate and moonlets light up gold as they're isolated; the score updates
   live. Press `Z` to undo, cut again. *"Play is instant and local — nothing has touched a
   chain yet."*

2. **The daily (30s).** Click *Daily tournament is live →*. Same game, but the board came from
   the on-chain seed and the countdown is real. Point at the tournament bar. *"Everyone in the
   world gets this exact board today."*

3. **The seal moment (45s).** (With a connector-v4 wallet: connect, play, hit **Seal my
   score**.) Walk the staged modal: witnesses → proof → submitted → *sealed 🔒*. Open **🛡
   what's on-chain?** — *"a nullifier and a commitment. Not my cuts, not my score, not who I
   am."* (Without a wallet, show the same flow in the terminal: `npm run e2e:local` output —
   real proofs, ~25s each.)

4. **Cheating doesn't compile into a proof (15s).** In the e2e output, point at the tampered
   submission: witnesses from a different board fail `seed limbs mismatch` / the node rejects a
   replayed nullifier with `already played`. *"The verifier is consensus, not a server."*

5. **Reveal & leaderboard (30s).** Switch to tournament #2 on the Leaderboard screen: two
   anonymous identicons, ranking [45, 0]. *"Scores appeared only after the window closed —
   nothing to snipe during play."* Name your row locally.

6. **The money shot: badges (30s).** Badges screen: an anonymous entry holds **🥈 Silver —
   "score ≥ 40"** — and its exact score is *never* on-chain. Same sealed entry as the
   leaderboard; the player chose which face to show. *"Reveal is optional. Proof isn't."*

Close on the How-it-works disclosure map.
