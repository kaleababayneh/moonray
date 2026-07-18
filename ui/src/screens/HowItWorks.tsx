/** Static explainer + disclosure map + backup tools. */

import { BackupPanel } from '../components/BackupPanel';
import { useGame } from '../midnight/GameContext';

export const HowItWorks = () => {
  const g = useGame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Why this game needs Midnight</h3>
        <p className="muted">
          Everyone plays the <strong>same board</strong> each day. If solutions were public, the
          first good one would be copy-pasted instantly; if scores were public before close, the
          last player would snipe the leader by exactly one point. Slicer stays fair because your
          cuts and your score remain private while a <strong>zero-knowledge proof</strong> —
          verified by network consensus, not a server — shows they're valid for today's seed.
        </p>
        <ol className="muted" style={{ lineHeight: 1.7 }}>
          <li>
            <strong>Play locally.</strong> The board is derived from the tournament seed on your
            device. Cut, undo, retry — it's instant and free.
          </li>
          <li>
            <strong>Seal.</strong> “Submit run” proves in zero knowledge that your hidden partition
            is geometrically valid and scores what you claim, then writes only a sealed commitment
            under an anonymous nullifier.
          </li>
          <li>
            <strong>Reveal — or don't.</strong> After submissions close you can reveal your score
            for the leaderboard, or claim a threshold badge (“score ≥ 40”) and never reveal the
            number at all.
          </li>
        </ol>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>What the chain learns (disclosure map)</h3>
        <table className="board-table">
          <thead>
            <tr>
              <th>ledger item</th>
              <th>contains</th>
              <th>reveals</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>played</td>
              <td>nullifier</td>
              <td>that someone entered — unlinkable without your secret key</td>
            </tr>
            <tr>
              <td>sealedScores</td>
              <td>commit(score, nonce)</td>
              <td>nothing about the score</td>
            </tr>
            <tr>
              <td>revealedScores</td>
              <td>score</td>
              <td>the score — by your explicit choice</td>
            </tr>
            <tr>
              <td>badges</td>
              <td>tier</td>
              <td>a threshold fact only; the exact score is never derivable</td>
            </tr>
            <tr>
              <td>never on-chain</td>
              <td colSpan={2}>your cuts, pieces, hints, secret key, nonce, unrevealed scores</td>
            </tr>
          </tbody>
        </table>
        <p className="small-note" style={{ marginBottom: 0 }}>
          Honest caveat: transaction metadata (fees, timing, which circuit was called) is visible to
          node and indexer operators, like on any chain.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Scoring</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          Two survey plates share your three cuts — a slice can work in both plates at once.
          A piece left holding exactly one moonlet dissolves and <em>collects</em> it.{' '}
          <code>score = 10 × isolated + full-clear bonus of 5 × (4 − cuts)</code>. Each plate
          spawns 3–7 moonlets (6–14 total); three cuts can make at most 11 pieces, so heavy
          days mathematically cannot be full-cleared — chase the maximum instead. Tiers:
          Bronze 40 · Silver 70 · Gold 85.
        </p>
      </div>

      <BackupPanel />

      <div className="footer">
        <span>network: {g.networkId}</span>
        {g.contractAddress && (
          <span style={{ fontFamily: 'var(--mono)' }}>contract: {g.contractAddress.slice(0, 18)}…</span>
        )}
        <span className="spacer" />
        <span>Moonray — a port of xray.games' Chain Slicer to Midnight, rebuilt ZK-native.</span>
      </div>
    </div>
  );
};
