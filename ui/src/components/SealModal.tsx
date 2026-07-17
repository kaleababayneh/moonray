/** The seal moment: staged progress while the run is proven and submitted. */

import type { SealProgress, SealStage } from '../midnight/GameContext';

const STEPS: { key: SealStage; label: string }[] = [
  { key: 'preflight', label: 'Checking your run against the circuit' },
  { key: 'witnesses', label: 'Building witnesses (cuts stay on this device)' },
  { key: 'proving', label: 'Generating the zero-knowledge proof (~30s)' },
  { key: 'submitting', label: 'Submitting the sealed commitment' },
];

const order: SealStage[] = ['preflight', 'witnesses', 'proving', 'submitting', 'sealed'];

export const SealModal = ({ seal, onClose }: { seal: SealProgress; onClose: () => void }) => {
  if (seal.stage === 'idle') return null;
  const idx = order.indexOf(seal.stage);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Sealing your run">
      <div className="modal">
        {seal.stage === 'error' ? (
          <>
            <h3>Couldn't seal this run</h3>
            <div className="error-banner">{seal.detail}</div>
            <div className="row" style={{ marginTop: 16 }}>
              <span className="spacer" />
              <button className="btn" onClick={onClose} autoFocus>
                Back to the board
              </button>
            </div>
          </>
        ) : seal.stage === 'sealed' ? (
          <>
            <h3>Score sealed 🔒</h3>
            <p className="muted">
              Your score of <strong style={{ color: 'var(--text)' }}>{seal.score}</strong> is now a
              sealed commitment under an anonymous nullifier. Nobody — including the chain — can
              read it until you choose to reveal it (or claim a badge instead and never reveal it).
            </p>
            {seal.txHash && (
              <p className="small-note" style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                tx {seal.txHash}
              </p>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <span className="spacer" />
              <button className="btn primary" onClick={onClose} autoFocus>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Sealing your run…</h3>
            <div className="seal-steps">
              {STEPS.map((s, i) => {
                const cls = i < idx ? 'done' : i === idx ? 'active' : '';
                return (
                  <div key={s.key} className={`seal-step ${cls}`}>
                    <span className="dot">{i < idx ? '✓' : i === idx ? '●' : ''}</span>
                    <span>{s.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="small-note">
              Proving runs in your wallet / prover — the board stays interactive, and your cuts
              never leave this device.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
