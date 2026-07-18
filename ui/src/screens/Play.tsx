/** The Play screen: canvas board + HUD + the daily/practice loop. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pickUsableSeed, preflightRun, type TournamentView } from '@moonray/api';
import { TIERS } from '@moonray/engine';
import { BoardCanvas } from '../game/BoardCanvas';
import { rejectionText, useSlicerGame } from '../game/useSlicerGame';
import { useGame } from '../midnight/GameContext';
import { TournamentBar } from '../components/TournamentBar';
import { SealModal } from '../components/SealModal';
import { PrivacyPopover } from '../components/PrivacyPopover';
import { LS_DAILY_BEST, LS_PRACTICE_BEST } from '../config';

type Mode = 'daily' | 'practice';

const bestKey = (mode: Mode, seedOrTid: string) =>
  `${mode === 'daily' ? LS_DAILY_BEST : LS_PRACTICE_BEST}:${seedOrTid}`;

interface Props {
  theme: 'dark' | 'light';
}

export const Play = ({ theme }: Props) => {
  const g = useGame();
  const [mode, setMode] = useState<Mode>('practice');
  const [practiceSeed, setPracticeSeed] = useState<bigint>(() => pickUsableSeed());

  // active tournament = latest open (or reveal-phase for the bar)
  const nowSec = Math.floor(Date.now() / 1000);
  const tournament: TournamentView | null = useMemo(() => {
    const ts = g.ledger?.tournaments ?? [];
    return ts.find((t) => nowSec < t.submitUntil) ?? ts[0] ?? null;
  }, [g.ledger, nowSec]);

  const dailyAvailable = tournament !== null && nowSec < tournament.submitUntil;
  useEffect(() => {
    if (dailyAvailable && g.connected) setMode('daily');
  }, [dailyAvailable, g.connected]);

  const activeMode: Mode = mode === 'daily' && tournament ? 'daily' : 'practice';
  const seed = activeMode === 'daily' && tournament ? tournament.seed : practiceSeed;
  const game = useSlicerGame(seed);

  const preflight = useMemo(
    () => (game.state.cuts.length > 0 ? preflightRun(game.state, seed) : null),
    [game.state, seed],
  );

  // personal best
  const bKey = bestKey(activeMode, activeMode === 'daily' ? (tournament?.tid.toString() ?? '') : seed.toString());
  const [best, setBest] = useState(0);
  useEffect(() => {
    setBest(Number(localStorage.getItem(bKey) ?? 0));
  }, [bKey]);
  useEffect(() => {
    if (game.assignment.score > best) {
      setBest(game.assignment.score);
      localStorage.setItem(bKey, String(game.assignment.score));
    }
  }, [game.assignment.score, best, bKey]);

  // my daily status
  const myNul = tournament && g.connected ? g.myNullifier(tournament.tid) : null;
  const alreadyPlayed = myNul !== null && (g.ledger?.playedNullifiers.has(myNul) ?? false);
  const myRun = tournament ? g.myRuns()[tournament.tid.toString()] : undefined;
  const revealedByMe =
    myNul !== null && (g.ledger?.tournaments.find((t) => t.tid === tournament?.tid)?.ranking ?? []).some((r) => r.nullifier === myNul);

  const canSubmit =
    activeMode === 'daily' &&
    g.connected &&
    dailyAvailable &&
    !alreadyPlayed &&
    game.state.cuts.length > 0 &&
    preflight?.ok === true &&
    g.seal.stage === 'idle';

  const submit = useCallback(() => {
    if (!tournament) return;
    void g.submitRun(tournament.tid, game.state, tournament.seed);
  }, [g, tournament, game.state]);

  // keyboard shortcuts: Z undo · Y/shift+Z redo · R reset
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) game.redo();
        else game.undo();
      } else if (e.key === 'y' || e.key === 'Y') game.redo();
      else if (e.key === 'r' || e.key === 'R') game.reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  const objectsTotal = game.assignment.totalObjects;
  const isolated = game.assignment.isolatedCount;
  const collectedCount = game.state.collected.filter(Boolean).length;

  const hint = (() => {
    if (game.lastRejection) return { cls: 'danger', text: rejectionText(game.lastRejection) };
    if (game.assignment.fullClear && game.state.cuts.length > 0)
      return {
        cls: 'ok',
        text: `Full clear with ${game.state.cuts.length} cut${game.state.cuts.length > 1 ? 's' : ''}! Fewer cuts = bigger bonus.`,
      };
    if (game.state.cuts.length === 0)
      return {
        cls: '',
        text: 'Two survey plates, one blade. Drag a line across the field — pieces holding a single moonlet dissolve and collect it.',
      };
    return {
      cls: '',
      text: `${collectedCount} collected · ${isolated}/${objectsTotal} isolated. ${game.cutsLeft} cut${game.cutsLeft === 1 ? '' : 's'} left.`,
    };
  })();

  const nextTier = TIERS.filter((t) => game.assignment.score >= t.threshold).pop();

  return (
    <>
      <TournamentBar
        tournament={activeMode === 'daily' ? tournament : null}
        practice={activeMode === 'practice'}
        sealedScore={myRun ? myRun.score : null}
        revealed={revealedByMe}
      />

      <div className="play-grid">
        <div className="board-wrap">
          <BoardCanvas game={game} practice={activeMode === 'practice'} theme={theme} />
        </div>

        <div className="hud">
          <div className="card">
            <div className="stat-row">
              <div>
                <div className="score">
                  {game.assignment.score}
                  <span className="unit"> pts</span>
                </div>
                <div className="small-note">personal best on this board: {Math.max(best, game.assignment.score)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {isolated}
                  <span style={{ color: 'var(--text-faint)' }}>/{objectsTotal}</span>
                </div>
                <div className="small-note">isolated</div>
              </div>
            </div>
            <div style={{ height: 10 }} />
            <div className="row">
              <div className="cut-chips" aria-label={`${game.state.cuts.length} of 3 cuts used`}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={`cut-chip ${i < game.state.cuts.length ? 'used' : ''}`} />
                ))}
              </div>
              <span className="spacer" />
              <button className="btn small ghost" onClick={game.undo} disabled={!game.canUndo} title="Undo (Z)">
                ↺ undo
              </button>
              <button className="btn small ghost" onClick={game.redo} disabled={!game.canRedo} title="Redo (Y)">
                ↻ redo
              </button>
              <button className="btn small ghost" onClick={game.reset} disabled={!game.canUndo} title="Reset (R)">
                reset
              </button>
            </div>
          </div>

          <div className={`hint-line ${hint.cls}`} aria-live="polite">
            {hint.text}
            {nextTier && activeMode === 'daily' && (
              <div className="small-note" style={{ marginTop: 4 }}>
                current score reaches the {nextTier.name} badge tier
              </div>
            )}
          </div>

          {activeMode === 'daily' ? (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!g.connected ? (
                <>
                  <button className="btn primary" onClick={() => void g.connect().catch(() => undefined)} disabled={g.connecting}>
                    {g.connecting ? 'Connecting…' : 'Connect wallet to enter the daily'}
                  </button>
                  {g.connectError && <div className="error-banner">{g.connectError}</div>}
                </>
              ) : alreadyPlayed ? (
                <div className="ok-banner">
                  🔒 You're in — your sealed entry is on-chain. Come back for the reveal window, or
                  claim a badge without ever revealing the number.
                </div>
              ) : (
                <>
                  <button
                    className="btn primary"
                    onClick={submit}
                    disabled={!canSubmit}
                    title={
                      preflight && !preflight.ok
                        ? `This run would not prove: ${preflight.reason}`
                        : game.state.cuts.length === 0
                          ? 'Make at least one cut first'
                          : undefined
                    }
                  >
                    Seal my score ({game.assignment.score} pts)
                  </button>
                  {preflight && !preflight.ok && (
                    <div className="small-note" style={{ color: 'var(--danger)' }}>
                      not provable yet: {preflight.reason}
                    </div>
                  )}
                </>
              )}
              <div className="row">
                <PrivacyPopover />
                <span className="spacer" />
                <button className="btn small ghost" onClick={() => setMode('practice')}>
                  switch to practice
                </button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    setPracticeSeed(pickUsableSeed());
                  }}
                >
                  🎲 new board
                </button>
                <span className="spacer" />
                <PrivacyPopover />
              </div>
              {dailyAvailable && (
                <button className="btn primary" onClick={() => setMode('daily')}>
                  {g.connected ? 'Play the daily tournament →' : 'Daily tournament is live →'}
                </button>
              )}
              {!dailyAvailable && (
                <div className="small-note">
                  {g.contractAddress
                    ? 'No open tournament right now — practice away.'
                    : 'No contract deployment found — practice works fully offline.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <SealModal seal={g.seal} onClose={g.dismissSeal} />
    </>
  );
};
