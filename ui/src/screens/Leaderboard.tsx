/** Post-reveal leaderboard: anonymous identicons, my row highlighted locally. */

import { useMemo, useState } from 'react';
import type { TournamentView } from '@moonray/api';
import { useGame } from '../midnight/GameContext';
import { Identicon, shortNul } from '../components/Identicon';
import { LS_DISPLAY_NAMES } from '../config';

const loadNames = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(LS_DISPLAY_NAMES) ?? '{}');
  } catch {
    return {};
  }
};

export const Leaderboard = () => {
  const g = useGame();
  const [names, setNames] = useState(loadNames);
  const nowSec = Math.floor(Date.now() / 1000);

  const tournaments = g.ledger?.tournaments ?? [];
  const [selected, setSelected] = useState<bigint | null>(null);
  const tournament: TournamentView | null =
    tournaments.find((t) => t.tid === selected) ?? tournaments[0] ?? null;

  const myNul = tournament && g.connected ? g.myNullifier(tournament.tid) : null;
  const myRun = tournament ? g.myRuns()[tournament.tid.toString()] : undefined;
  const iRevealed = myNul !== null && (tournament?.ranking ?? []).some((r) => r.nullifier === myNul);
  const inRevealWindow =
    tournament !== null && nowSec >= tournament.submitUntil && nowSec < tournament.revealUntil;

  const [revealBusy, setRevealBusy] = useState(false);
  const [revealMsg, setRevealMsg] = useState<string | null>(null);

  const reveal = async () => {
    if (!tournament) return;
    setRevealBusy(true);
    setRevealMsg(null);
    try {
      const { score } = await g.revealScore(tournament.tid);
      setRevealMsg(`Revealed ${score} pts — it will appear in the ranking as the indexer catches up.`);
    } catch (err) {
      setRevealMsg(`Reveal failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRevealBusy(false);
    }
  };

  const setName = (nul: bigint, name: string) => {
    const next = { ...names, [nul.toString()]: name };
    if (!name) delete next[nul.toString()];
    setNames(next);
    localStorage.setItem(LS_DISPLAY_NAMES, JSON.stringify(next));
  };

  const sealedCount = useMemo(() => g.ledger?.sealedCommits.size ?? 0, [g.ledger]);

  if (!tournament) {
    return (
      <div className="card muted">
        No tournaments on-chain yet{g.contractAddress ? '' : ' (no deployment found)'} — the
        leaderboard fills as players reveal after each daily closes.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card tournament-bar">
        <span>Tournament</span>
        <select
          className="btn small"
          value={tournament.tid.toString()}
          onChange={(e) => setSelected(BigInt(e.target.value))}
          aria-label="Select tournament"
        >
          {tournaments.map((t) => (
            <option key={t.tid.toString()} value={t.tid.toString()}>
              #{t.tid.toString()} · {t.phase}
            </option>
          ))}
        </select>
        <span className="muted">
          {sealedCount} sealed entr{sealedCount === 1 ? 'y' : 'ies'} · {tournament.ranking.length} revealed
        </span>
        <span className="spacer" />
        {inRevealWindow && myRun && !iRevealed && (
          <button className="btn gold" onClick={() => void reveal()} disabled={revealBusy}>
            {revealBusy ? 'Revealing…' : `Reveal my score (${myRun.score} pts)`}
          </button>
        )}
      </div>

      {revealMsg && <div className="ok-banner">{revealMsg}</div>}

      {tournament.phase === 'open' && (
        <div className="card muted">
          Scores are still sealed — the ranking appears when the reveal window opens. Until then the
          chain knows only <em>that</em> entries exist, not what anyone scored.
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table className="board-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>player</th>
              <th style={{ width: 110, textAlign: 'right' }}>score</th>
            </tr>
          </thead>
          <tbody>
            {tournament.ranking.length === 0 && (
              <tr>
                <td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  nothing revealed yet
                </td>
              </tr>
            )}
            {tournament.ranking.map((r, i) => {
              const mine = myNul !== null && r.nullifier === myNul;
              const name = names[r.nullifier.toString()];
              return (
                <tr key={r.nullifier.toString()} className={mine ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>
                    <div className="player-cell">
                      <Identicon value={r.nullifier} />
                      <div>
                        <div>
                          {mine ? (
                            <input
                              style={{
                                background: 'transparent',
                                border: 'none',
                                borderBottom: '1px dashed var(--border-strong)',
                                color: 'var(--text)',
                                font: 'inherit',
                                width: 140,
                              }}
                              placeholder="you (add name)"
                              value={name ?? ''}
                              onChange={(e) => setName(r.nullifier, e.target.value)}
                              aria-label="Local display name for your entry"
                            />
                          ) : (
                            (name ?? 'anonymous')
                          )}
                          {mine && ' ✳'}
                        </div>
                        <div className="nul">{shortNul(r.nullifier)}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 17 }}>{r.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="small-note">
        Names are local-only labels on this device. On-chain, every entry is just a nullifier — you
        can recognise yours because only your secret key derives it.
      </p>
    </div>
  );
};
