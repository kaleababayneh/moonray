/** Threshold badges: prove score >= tier without revealing the score. */

import { useState } from 'react';
import { TIERS } from '@moonray/engine';
import { useGame } from '../midnight/GameContext';
import { Identicon, shortNul } from '../components/Identicon';

const GLOW = ['rgba(205,127,50,0.8)', 'rgba(192,192,205,0.8)', 'rgba(255,209,102,0.9)'];
const ICON = ['🥉', '🥈', '🥇'];

export const Badges = () => {
  const g = useGame();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const tournaments = g.ledger?.tournaments ?? [];
  const latest = tournaments[0] ?? null;
  const myRun = latest ? g.myRuns()[latest.tid.toString()] : undefined;
  const myNul = latest && g.connected ? g.myNullifier(latest.tid) : null;
  const myBadge = myNul !== null ? g.ledger?.badges.find((b) => b.nullifier === myNul) : undefined;

  const claim = async (tier: 1 | 2 | 3) => {
    if (!latest) return;
    setBusy(tier);
    setMsg(null);
    try {
      await g.claimBadge(latest.tid, tier);
      setMsg({
        ok: true,
        text: `Badge claimed! The chain now shows tier ${tier} for your nullifier — and still knows nothing about your exact score.`,
      });
    } catch (err) {
      setMsg({ ok: false, text: `Claim failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card muted">
        A badge is a public, on-chain achievement backed by a zero-knowledge proof that your{' '}
        <em>sealed</em> score clears the tier threshold. The exact number is never derivable — this
        is the same entry as the leaderboard, but you choose which face of it the world sees.
      </div>

      <div className="tier-cards">
        {TIERS.map((t, i) => {
          const have = myRun !== undefined && myRun.score >= t.threshold;
          return (
            <div className="tier-card" key={t.tier} style={{ ['--tier-glow' as never]: GLOW[i] }}>
              <h4>
                {ICON[i]} {t.name}
              </h4>
              <div className="threshold">≥ {t.threshold} pts</div>
              <p>
                Prove “my sealed score is at least {t.threshold}” — without revealing what it is.
              </p>
              <button
                className={`btn small ${have ? 'gold' : ''}`}
                disabled={!have || busy !== null || !g.connected || myBadge?.tier === t.tier}
                onClick={() => void claim(t.tier as 1 | 2 | 3)}
                title={
                  !g.connected
                    ? 'Connect a wallet first'
                    : !myRun
                      ? 'Seal a run in the daily first'
                      : !have
                        ? `Your sealed score (${myRun.score}) is below this tier`
                        : undefined
                }
              >
                {myBadge?.tier === t.tier
                  ? 'claimed ✓'
                  : busy === t.tier
                    ? 'proving…'
                    : 'prove without revealing'}
              </button>
            </div>
          );
        })}
      </div>

      {msg && <div className={msg.ok ? 'ok-banner' : 'error-banner'}>{msg.text}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table className="board-table">
          <thead>
            <tr>
              <th>holder</th>
              <th style={{ width: 140 }}>badge</th>
            </tr>
          </thead>
          <tbody>
            {(g.ledger?.badges ?? []).length === 0 && (
              <tr>
                <td colSpan={2} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  no badges claimed yet
                </td>
              </tr>
            )}
            {(g.ledger?.badges ?? []).map((b) => {
              const mine = myNul !== null && b.nullifier === myNul;
              const t = TIERS[b.tier - 1];
              return (
                <tr key={b.nullifier.toString()} className={mine ? 'me' : ''}>
                  <td>
                    <div className="player-cell">
                      <Identicon value={b.nullifier} />
                      <div>
                        <div>{mine ? 'you ✳' : 'anonymous'}</div>
                        <div className="nul">{shortNul(b.nullifier)}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {ICON[b.tier - 1]} {t?.name ?? `tier ${b.tier}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
