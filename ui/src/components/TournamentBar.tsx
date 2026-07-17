/** Countdown + phase + personal status for the active tournament. */

import { useEffect, useState } from 'react';
import type { TournamentView } from '@moonray/api';

const fmt = (secs: number): string => {
  if (secs <= 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`;
};

interface Props {
  tournament: TournamentView | null;
  practice: boolean;
  sealedScore: number | null; // my sealed score for this tournament, if any
  revealed: boolean;
}

export const TournamentBar = ({ tournament, practice, sealedScore, revealed }: Props) => {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (practice || !tournament) {
    return (
      <div className="card tournament-bar">
        <span className="phase-pill practice">Practice</span>
        <span className="muted">
          Free play, any board, nothing leaves this device. Connect a wallet to enter the daily.
        </span>
      </div>
    );
  }

  const phase = now < tournament.submitUntil ? 'open' : now < tournament.revealUntil ? 'reveal' : 'closed';

  return (
    <div className="card tournament-bar">
      <span className={`phase-pill ${phase}`}>
        {phase === 'open' ? 'Daily · open' : phase === 'reveal' ? 'Reveal window' : 'Closed'}
      </span>
      <span>
        Tournament <strong>#{tournament.tid.toString()}</strong>
      </span>
      {phase === 'open' && (
        <span>
          submissions close in <span className="countdown">{fmt(tournament.submitUntil - now)}</span>
        </span>
      )}
      {phase === 'reveal' && (
        <span>
          reveals close in <span className="countdown">{fmt(tournament.revealUntil - now)}</span>
        </span>
      )}
      <span className="spacer" />
      {sealedScore !== null && !revealed && (
        <span style={{ color: 'var(--seal)', fontWeight: 700 }}>
          🔒 your score is sealed{phase === 'open' ? ` · reveals in ${fmt(tournament.submitUntil - now)}` : ''}
        </span>
      )}
      {revealed && sealedScore !== null && (
        <span style={{ color: 'var(--mint)', fontWeight: 700 }}>✓ revealed: {sealedScore}</span>
      )}
    </div>
  );
};
