/**
 * Field manual: four phases with live CSS diagrams, then scoring, ranks,
 * command keys — plus the chain sheet (what the ledger learns) and the vault
 * (secret-key + nonce backup). Open columns divided by hairlines, no cards.
 */

import { useState } from 'react'
import { Btn, Icon } from '../components/Hud'
import { MoonrayMark } from '../components/MoonrayMark'
import { MAX_CUTS, TIERS } from '@moonray/engine'
import { LS_RUNS, LS_SECRET_KEY } from '../config'
import { useGame } from '../midnight/GameContext'

function Vault() {
  const [blob, setBlob] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const doExport = () => {
    const payload = {
      v: 1,
      secretKey: localStorage.getItem(LS_SECRET_KEY),
      runs: JSON.parse(localStorage.getItem(LS_RUNS) ?? '{}'),
      exportedAt: new Date().toISOString(),
    }
    const text = JSON.stringify(payload)
    setBlob(text)
    navigator.clipboard?.writeText(text).catch(() => undefined)
    setMsg({ ok: true, text: 'VAULT COPIED TO CLIPBOARD — STORE IT SOMEWHERE SAFE.' })
  }

  const doImport = () => {
    try {
      const parsed = JSON.parse(blob)
      if (!parsed.secretKey || typeof parsed.secretKey !== 'string' || parsed.secretKey.length !== 64) {
        throw new Error('vault is missing a valid secret key')
      }
      const existing = localStorage.getItem(LS_SECRET_KEY)
      if (existing && existing !== parsed.secretKey) {
        if (
          !window.confirm(
            'This vault holds a DIFFERENT identity than the one on this device. Importing replaces ' +
              'your current secret key — any un-backed-up proven runs become unrevealable. Continue?',
          )
        ) {
          return
        }
      }
      localStorage.setItem(LS_SECRET_KEY, parsed.secretKey)
      localStorage.setItem(LS_RUNS, JSON.stringify(parsed.runs ?? {}))
      setMsg({ ok: true, text: 'VAULT IMPORTED — RELOAD TO USE THE RESTORED IDENTITY.' })
    } catch (err) {
      setMsg({ ok: false, text: `IMPORT FAILED: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return (
    <>
      <textarea
        className="vault-area"
        placeholder="Exported vault appears here — or paste one to import."
        value={blob}
        onChange={(e) => setBlob(e.target.value)}
        spellCheck={false}
      />
      <div className="manual-actions">
        <Btn onClick={doExport}>
          <Icon name="share" />
          <span>Export vault</span>
        </Btn>
        <Btn onClick={doImport}>
          <span>Import</span>
        </Btn>
      </div>
      {msg && <p className={`vault-msg ${msg.ok ? '' : 'is-error'}`}>{msg.text}</p>}
    </>
  )
}

export function Manual({ onBack }: { onBack: () => void }) {
  const g = useGame()
  return (
    <section className="manual">
      <header className="manual-top rise">
        <span className="manual-brand">
          <MoonrayMark size={24} />
          MOONRAY
        </span>
        <Btn onClick={onBack}>
          <span>Return to the field</span>
          <Icon name="arrow" />
        </Btn>
      </header>

      <div className="manual-head rise" style={{ '--d': '60ms' } as React.CSSProperties}>
        <span className="hud-label">FIELD MANUAL</span>
        <h1>How a survey runs</h1>
        <p>
          Two survey plates share the field. Cuts are straight lines that cross everything in their
          path — one good trajectory can slice both plates at once. Every player in the world gets
          the same field each hour; only zero-knowledge keeps it fair.
        </p>
      </div>

      <div className="manual-phases">
        <article className="phase rise" style={{ '--d': '140ms' } as React.CSSProperties}>
          <div className="phase-diagram" aria-hidden="true">
            <div className="dg-field">
              <i className="dg-dot dg-d1" />
              <i className="dg-dot dg-d2" />
              <i className="dg-dot dg-d3" />
              <span className="dg-blade" />
            </div>
          </div>
          <span className="hud-label">PHASE 01</span>
          <h2>Plot a trajectory</h2>
          <p>
            Press and drag anywhere on the field. The cut extends edge to edge — release to commit
            it. You have {MAX_CUTS} cuts per field.
          </p>
        </article>

        <article className="phase rise" style={{ '--d': '210ms' } as React.CSSProperties}>
          <div className="phase-diagram" aria-hidden="true">
            <div className="dg-field dg-field--split">
              <span className="dg-half dg-half--a">
                <i className="dg-dot dg-d1" />
              </span>
              <span className="dg-half dg-half--b">
                <i className="dg-dot dg-d2" />
                <i className="dg-dot dg-d3" />
              </span>
              <span className="dg-cutline" />
              <span className="dg-ring" />
            </div>
          </div>
          <span className="hud-label">PHASE 02</span>
          <h2>Respect the clearance</h2>
          <p>
            Every moonlet keeps a protective ring. A trajectory that crosses one is rejected — and a
            rejected cut costs nothing.
          </p>
        </article>

        <article className="phase rise" style={{ '--d': '280ms' } as React.CSSProperties}>
          <div className="phase-diagram" aria-hidden="true">
            <div className="dg-field">
              <i className="dg-dot dg-lock dg-d1" />
              <i className="dg-dot dg-lock dg-d2" />
              <i className="dg-dot dg-lock dg-d3" />
              <span className="dg-cutline dg-cut-a" />
              <span className="dg-cutline dg-cut-b" />
            </div>
          </div>
          <span className="hud-label">PHASE 03</span>
          <h2>Collect every moonlet</h2>
          <p>
            When a cut leaves a moonlet alone in its shard, the shard dissolves and the moonlet
            flies to your collector. Fewer cuts means a higher rank.
          </p>
        </article>
      </div>

      <div className="manual-lower">
        <article className="sheet rise" style={{ '--d': '360ms' } as React.CSSProperties}>
          <span className="hud-label">SCORING</span>
          <h2>Precision pays</h2>
          <p>
            Each isolated moonlet is worth 10 points. Clear the whole field and every unused cut
            adds a 5-point efficiency bonus. Heavy fields (12+ moonlets) mathematically cannot be
            cleared with three cuts — chase the maximum instead.
          </p>
          <div className="score-formula">
            <code>10 × moonlets</code>
            <i>+</i>
            <code>5 × ({MAX_CUTS + 1} − cuts)</code>
          </div>
          <small className="formula-note">
            A perfect eleven-moonlet clear scores 115 — if you can find one.
          </small>
        </article>

        <article className="sheet rise" style={{ '--d': '420ms' } as React.CSSProperties}>
          <span className="hud-label">OPERATOR RANKS</span>
          <div className="rank-rows">
            {TIERS.map((t) => (
              <div className="rank-row" key={t.tier}>
                <i className={`rank-medal rank-medal--${t.name.toLowerCase()}`} aria-hidden="true" />
                <strong>{t.name}</strong>
                <b>{t.threshold}+ PTS</b>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 12 }}>
            Ranks can be claimed on-chain as badges — a proof that your hidden score clears the
            threshold, without ever revealing the number.
          </p>
        </article>

        <article className="sheet rise" style={{ '--d': '480ms' } as React.CSSProperties}>
          <span className="hud-label">COMMAND KEYS</span>
          <div className="key-rows">
            <div>
              <kbd>Z</kbd>
              <span>Undo the last cut</span>
            </div>
            <div>
              <kbd>Y</kbd>
              <span>Redo a reverted cut</span>
            </div>
            <div>
              <kbd>R</kbd>
              <span>Reset the field</span>
            </div>
            <div>
              <kbd>M</kbd>
              <span>Open or close this manual</span>
            </div>
            <div>
              <kbd>ESC</kbd>
              <span>Step back a screen</span>
            </div>
          </div>
        </article>
      </div>

      <div className="manual-lower">
        <article className="sheet rise" style={{ '--d': '520ms' } as React.CSSProperties}>
          <span className="hud-label">THE PROOF</span>
          <h2>What the chain learns</h2>
          <p>
            Submitting a run generates a zero-knowledge proof — verified by Midnight consensus, not a
            server — that your hidden cuts are valid for today's field and score what you claim.
          </p>
          <div className="disc-rows">
            <div>
              <b>played</b>
              <span>an anonymous nullifier — someone entered, unlinkable without your key</span>
            </div>
            <div>
              <b>sealedScores</b>
              <span>commit(score, nonce) — nothing about the score</span>
            </div>
            <div>
              <b>revealedScores</b>
              <span>the score — only by your explicit choice</span>
            </div>
            <div>
              <b>badges</b>
              <span>a threshold fact — the exact score is never derivable</span>
            </div>
            <div>
              <b>never on-chain</b>
              <span>your cuts, pieces, secret key, nonce, unrevealed scores</span>
            </div>
          </div>
        </article>

        <article className="sheet rise" style={{ '--d': '560ms' } as React.CSSProperties}>
          <span className="hud-label">THE VAULT</span>
          <h2>Back up your reveals</h2>
          <p>
            Your secret key and per-operation reveal nonces live only in this browser. Lose them
            and proven scores can never be revealed or turned into badges.
          </p>
          <Vault />
        </article>

        <article className="sheet rise" style={{ '--d': '600ms' } as React.CSSProperties}>
          <span className="hud-label">STATION</span>
          <h2>Network</h2>
          <div className="disc-rows">
            <div>
              <b>network</b>
              <span>{g.networkId}</span>
            </div>
            <div>
              <b>contract</b>
              <span style={{ wordBreak: 'break-all' }}>{g.contractAddress ?? 'none found — practice only'}</span>
            </div>
            <div>
              <b>wallet</b>
              <span>{g.connected ? `linked via ${g.walletName}` : 'not linked'}</span>
            </div>
            <div>
              <b>prover</b>
              <span>{g.useLocalProver ? 'local proof server' : 'wallet-delegated (ProofStation)'}</span>
            </div>
          </div>
          <div className="manual-actions">
            <Btn onClick={() => g.setUseLocalProver(!g.useLocalProver)}>
              <span>{g.useLocalProver ? 'Use wallet prover' : 'Use local prover'}</span>
            </Btn>
          </div>
          <p style={{ marginTop: 10 }}>
            The run proof needs a 68 MB proving key — more than the wallet&apos;s messaging channel
            accepts — so proving defaults to the local proof server on :6300. The wallet still
            balances, pays and submits.
          </p>
        </article>
      </div>
    </section>
  )
}
