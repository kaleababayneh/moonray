/**
 * The three ceremonies, all on the prototype's borderless staging:
 *  - WinOverlay: full clear (gold) — with the SEAL action on daily runs
 *  - GameOverOverlay: trajectories spent (violet) — seal what you salvaged
 *  - SealCeremony: the proof in flight, then "score sealed"
 */

import { useEffect, useRef, useState } from 'react'
import { Btn, fmtClock, Icon, pad4 } from './Hud'
import { useAnimatedNumber } from '../hooks/useAnimatedNumber'
import { MAX_CUTS } from '@moonray/engine'
import type { SealProgress, SealStage } from '../midnight/GameContext'

/** Slow gold-and-violet dust orbiting behind the ceremony. */
function CeremonyDust() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      c.width = window.innerWidth * dpr
      c.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const dust = Array.from({ length: 54 }, (_, i) => ({
      a: (i / 54) * Math.PI * 2,
      r: 130 + Math.random() * 330,
      s: 0.00012 + Math.random() * 0.00032,
      z: 0.8 + Math.random() * 1.7,
      gold: Math.random() < 0.45,
    }))
    let raf = 0
    const tick = (t: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const x = window.innerWidth / 2
      const y = window.innerHeight / 2
      for (const q of dust) {
        q.a += q.s * 16
        ctx.globalAlpha = 0.12 + 0.3 * Math.sin(t / 900 + q.a) ** 2
        ctx.fillStyle = q.gold ? '#f4c864' : '#be80ff'
        ctx.beginPath()
        ctx.arc(x + Math.cos(q.a) * q.r, y + Math.sin(q.a) * q.r * 0.42, q.z, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} className="ceremony-dust" aria-hidden="true" />
}

const Backdrop = ({
  label,
  onClose,
  children,
  dust = false,
  over = false,
}: {
  label: string
  onClose?: () => void
  children: React.ReactNode
  dust?: boolean
  over?: boolean
}) => (
  <div
    className="ceremony-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose?.()
    }}
  >
    {dust && <CeremonyDust />}
    <div className={`ceremony ${over ? 'ceremony--over' : ''}`}>
      {onClose && (
        <button className="ceremony-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      )}
      {children}
    </div>
  </div>
)

interface SealActions {
  /** show the gold SEAL action (daily, connected, provable, not yet sealed) */
  canSeal: boolean
  sealedScore: number | null
  onSeal: () => void
}

export function WinOverlay({
  score,
  cuts,
  moonlets,
  daily,
  operationId,
  countdown,
  seal,
  onNext,
  onClose,
}: {
  score: number
  cuts: number
  moonlets: number
  daily: boolean
  operationId: string
  countdown: number
  seal: SealActions
  onNext: () => void
  onClose: () => void
}) {
  const shown = useAnimatedNumber(score, 1000, 0)
  const efficiency = Math.round(((MAX_CUTS + 1 - cuts) / MAX_CUTS) * 100)
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const text = `MOONRAY ${operationId} — ${score} pts · ${cuts}/${MAX_CUTS} cuts · proven in zero knowledge on Midnight`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  return (
    <Backdrop label="Operation complete" onClose={onClose} dust>
      <span className="ceremony-kicker rise" style={{ '--d': '0ms' } as React.CSSProperties}>
        OPERATION COMPLETE
      </span>

      <div className="tier-emblem-wrap rise" style={{ '--d': '90ms' } as React.CSSProperties}>
        <div className="tier-emblem">
          <span className="tier-rays" aria-hidden="true" />
          <b>✦</b>
        </div>
      </div>

      <h2 className="tier-name rise" style={{ '--d': '200ms' } as React.CSSProperties}>
        Field cleared
      </h2>

      <div className="ceremony-score rise" style={{ '--d': '340ms' } as React.CSSProperties}>
        <span>FINAL SCORE</span>
        <strong>{pad4(shown)}</strong>
      </div>

      <div className="ceremony-metrics rise" style={{ '--d': '410ms' } as React.CSSProperties}>
        <div>
          <span>MOONLETS</span>
          <b>
            {moonlets}/{moonlets}
          </b>
        </div>
        <div>
          <span>CUTS USED</span>
          <b>
            {cuts}/{MAX_CUTS}
          </b>
        </div>
        <div>
          <span>EFFICIENCY</span>
          <b>{efficiency}%</b>
        </div>
      </div>

      <div className="ceremony-actions rise" style={{ '--d': '480ms' } as React.CSSProperties}>
        <Btn onClick={share}>
          <Icon name="share" />
          <span>{copied ? 'Copied' : 'Share result'}</span>
        </Btn>
        <Btn onClick={onClose}>
          <span>Review field</span>
        </Btn>
        {seal.canSeal ? (
          <Btn variant="gold" onClick={seal.onSeal} autoFocus>
            <Icon name="seal" />
            <span>Prove this run</span>
          </Btn>
        ) : (
          <Btn variant="gold" onClick={onNext} autoFocus>
            <span>{daily ? 'Start practice' : 'Next game'}</span>
            <Icon name="arrow" />
          </Btn>
        )}
      </div>

      {seal.sealedScore != null && (
        <small className="ceremony-next rise" style={{ '--d': '520ms' } as React.CSSProperties}>
          PROVEN ON-CHAIN · {pad4(seal.sealedScore)} PTS
        </small>
      )}
      {daily && (
        <small className="ceremony-next rise" style={{ '--d': '540ms' } as React.CSSProperties}>
          PROOFS CLOSE IN {fmtClock(countdown)}
        </small>
      )}
    </Backdrop>
  )
}

export function GameOverOverlay({
  score,
  collected,
  total,
  best,
  daily,
  seal,
  onRetry,
  onNext,
  onClose,
}: {
  score: number
  collected: number
  total: number
  best: number
  daily: boolean
  seal: SealActions
  onRetry: () => void
  onNext: () => void
  onClose: () => void
}) {
  const shown = useAnimatedNumber(score, 900, 0)
  return (
    <Backdrop label="Out of cuts" onClose={onClose} over>
      <span className="ceremony-kicker ceremony-kicker--over rise" style={{ '--d': '0ms' } as React.CSSProperties}>
        TRAJECTORIES SPENT
      </span>
      <h2 className="over-title rise" style={{ '--d': '90ms' } as React.CSSProperties}>
        Survey ends
      </h2>
      <p className="over-sub rise" style={{ '--d': '170ms' } as React.CSSProperties}>
        {collected} of {total} moonlets collected before the light ran out.
      </p>

      <div className="over-gems rise" style={{ '--d': '240ms' } as React.CSSProperties} aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <i key={i} className={i < collected ? 'is-got' : ''} />
        ))}
      </div>

      <div className="ceremony-score rise" style={{ '--d': '320ms' } as React.CSSProperties}>
        <span>FINAL SCORE</span>
        <strong>{pad4(shown)}</strong>
      </div>
      <small className="over-best rise" style={{ '--d': '380ms' } as React.CSSProperties}>
        PERSONAL BEST {pad4(best)}
        {seal.sealedScore != null ? ` · PROVEN ${pad4(seal.sealedScore)}` : ''}
      </small>

      <div className="ceremony-actions rise" style={{ '--d': '450ms' } as React.CSSProperties}>
        <Btn onClick={onRetry}>
          <Icon name="reset" />
          <span>Retry field</span>
        </Btn>
        {seal.canSeal && (
          <Btn variant="gold" onClick={seal.onSeal}>
            <Icon name="seal" />
            <span>Prove {score} pts</span>
          </Btn>
        )}
        <Btn variant={seal.canSeal ? 'ghost' : 'gold'} onClick={onNext} autoFocus={!seal.canSeal}>
          <span>{daily ? 'Start practice' : 'New game'}</span>
          <Icon name="arrow" />
        </Btn>
      </div>
    </Backdrop>
  )
}

// ── the seal ceremony: proof progress ───────────────────────────────────
const SEAL_STEPS: { key: SealStage; label: string }[] = [
  { key: 'preflight', label: 'CHECKING RUN AGAINST THE CIRCUIT' },
  { key: 'witnesses', label: 'STAGING WITNESSES · CUTS STAY LOCAL' },
  { key: 'proving', label: 'GENERATING ZERO-KNOWLEDGE PROOF' },
  { key: 'submitting', label: 'SUBMITTING HIDDEN COMMITMENT' },
]
const ORDER: SealStage[] = ['preflight', 'witnesses', 'proving', 'submitting', 'sealed']

export function SealCeremony({ seal, onClose }: { seal: SealProgress; onClose: () => void }) {
  if (seal.stage === 'idle') return null
  const idx = ORDER.indexOf(seal.stage)
  const busy = seal.stage !== 'sealed' && seal.stage !== 'error'

  return (
    <Backdrop label="Proving your run" onClose={busy ? undefined : onClose} dust={seal.stage === 'sealed'}>
      {seal.stage === 'error' ? (
        <>
          <span className="ceremony-kicker ceremony-kicker--over rise">PROOF REFUSED</span>
          <div className="seal-error rise" style={{ '--d': '80ms' } as React.CSSProperties}>
            {seal.detail}
          </div>
          <div className="ceremony-actions rise" style={{ '--d': '160ms' } as React.CSSProperties}>
            <Btn onClick={onClose} autoFocus>
              <span>Back to the field</span>
            </Btn>
          </div>
        </>
      ) : seal.stage === 'sealed' ? (
        <>
          <span className="ceremony-kicker rise">SCORE PROVEN</span>
          <div className="tier-emblem-wrap rise" style={{ '--d': '90ms' } as React.CSSProperties}>
            <div className="tier-emblem">
              <span className="tier-rays" aria-hidden="true" />
              <b>✦</b>
            </div>
          </div>
          <div className="ceremony-score rise" style={{ '--d': '180ms' } as React.CSSProperties}>
            <span>PROVEN UNDER AN ANONYMOUS NULLIFIER</span>
            <strong>{pad4(seal.score ?? 0)}</strong>
          </div>
          <div className="chain-facts gold rise" style={{ '--d': '260ms' } as React.CSSProperties}>
            <div>
              <b>ON-CHAIN</b>
              <span>a nullifier and a hidden commitment — nothing else</span>
            </div>
            <div>
              <b>NEVER LEAVES</b>
              <span>your cuts, your score, your key — until you choose to reveal</span>
            </div>
          </div>
          {seal.txHash && <small className="seal-tx rise">TX {seal.txHash}</small>}
          <div className="ceremony-actions rise" style={{ '--d': '340ms' } as React.CSSProperties}>
            <Btn variant="gold" onClick={onClose} autoFocus>
              <span>Done</span>
            </Btn>
          </div>
        </>
      ) : (
        <>
          <span className="ceremony-kicker rise">PROVING RUN</span>
          <div className="seal-steps">
            {SEAL_STEPS.map((s, i) => (
              <div key={s.key} className={`seal-step ${i < idx ? 'is-done' : i === idx ? 'is-active' : ''}`}>
                <i aria-hidden="true" />
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <p className="seal-note">
            Proving runs in your wallet or local prover — the network verifies the proof, never the
            run itself. This takes about a minute.
          </p>
        </>
      )}
    </Backdrop>
  )
}
