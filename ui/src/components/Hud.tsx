/**
 * Interface kit for the floating HUD: icons, the two button styles (chamfered
 * Btn for ceremonies/menus, borderless Glyph for in-game controls), the
 * animated score readout and the cut pips. No panels, no cards — play-screen
 * chrome floats directly over the field. Ported from the design prototype,
 * extended with chain glyphs (wallet, seal, ledger).
 */

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useAnimatedNumber } from '../hooks/useAnimatedNumber'
import * as sfx from '../lib/sfx'

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const pad4 = (n: number) => String(n).padStart(4, '0')
export const fmtClock = (s: number) =>
  `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`

// ── icons ───────────────────────────────────────────────────────────────
export type IconName =
  | 'undo'
  | 'redo'
  | 'reset'
  | 'book'
  | 'spark'
  | 'sound'
  | 'soundOff'
  | 'arrow'
  | 'close'
  | 'share'
  | 'wallet'
  | 'seal'
  | 'ledger'
  | 'shield'

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    undo: <path d="M9 7H4v-5M4 7l4-4M4.5 7.5A7 7 0 1 0 7 4" />,
    redo: <path d="M15 7h5v-5m0 5-4-4m3.5 4.5A7 7 0 1 1 17 4" />,
    reset: (
      <>
        <path d="M20 11a8 8 0 1 1-2.3-5.7L20 7" />
        <path d="M20 2v5h-5" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5Z" />
        <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z" />
        <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
      </>
    ),
    sound: (
      <>
        <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
        <path d="M16.5 8.8a4.6 4.6 0 0 1 0 6.4M19.2 6.2a8.4 8.4 0 0 1 0 11.6" />
      </>
    ),
    soundOff: (
      <>
        <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
        <path d="m17 9.5 5 5m0-5-5 5" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    share: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="1" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.5" />
        <path d="M16 12.5h.01M3 9.5h18" />
      </>
    ),
    seal: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2.5" />
      </>
    ),
    ledger: (
      <>
        <path d="M4 20V9m5.5 11V4m5.5 16v-8M20.5 20V6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2 4.5 5v6c0 5 3.2 8.7 7.5 10.5 4.3-1.8 7.5-5.5 7.5-10.5V5L12 2Z" />
        <path d="m8.8 11.6 2.3 2.3 4.2-4.4" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </g>
    </svg>
  )
}

// ── buttons ─────────────────────────────────────────────────────────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'gold'
}

/** Chamfered button — menus, ceremony, manual. */
export function Btn({ variant = 'ghost', className = '', children, onClick, ...rest }: BtnProps) {
  return (
    <button
      className={`btn btn--${variant} ${className}`}
      onClick={(e) => {
        sfx.click()
        onClick?.(e)
      }}
      {...rest}
    >
      <span className="btn-in">{children}</span>
    </button>
  )
}

/** Borderless in-game control: bare icon with a glow ring on hover. */
export function Glyph({
  className = '',
  children,
  onClick,
  label,
  active = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      className={`glyph ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        sfx.click()
        onClick?.(e)
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

// ── floating score readout ──────────────────────────────────────────────
export function ScoreReadout({
  score,
  best,
  record,
  rank,
}: {
  score: number
  best: number
  record: boolean
  rank: string | null
}) {
  const shown = useAnimatedNumber(score)
  const [deltas, setDeltas] = useState<{ id: number; amount: number }[]>([])
  const idRef = useRef(0)
  const prevScore = useRef(score)
  useEffect(() => {
    const d = score - prevScore.current
    prevScore.current = score
    if (d > 0) {
      const id = ++idRef.current
      setDeltas((ds) => [...ds, { id, amount: d }])
      setTimeout(() => setDeltas((ds) => ds.filter((x) => x.id !== id)), 1150)
    }
  }, [score])

  return (
    <div className="score-float">
      <div className="score-line">
        <strong className="score-value">{pad4(shown)}</strong>
        {deltas.map((d) => (
          <span key={d.id} className="score-delta" aria-hidden="true">
            +{d.amount}
          </span>
        ))}
      </div>
      <small className="score-sub">
        {record && <em className="record-chip">NEW RECORD</em>}
        <span>
          BEST {pad4(best)}
          {rank ? ` · ${rank.toUpperCase()}` : ''}
        </span>
      </small>
    </div>
  )
}

// ── cut pips ────────────────────────────────────────────────────────────
export function CutPips({ cutsLeft, maxCuts }: { cutsLeft: number; maxCuts: number }) {
  return (
    <div className="pips" role="img" aria-label={`${cutsLeft} of ${maxCuts} cuts remaining`}>
      {Array.from({ length: maxCuts }).map((_, i) => (
        <i key={i} className={`pip ${i < cutsLeft ? 'is-live' : ''}`} />
      ))}
    </div>
  )
}

// ── wallet / network chip ───────────────────────────────────────────────
export function WalletChip({
  connected,
  connecting,
  walletName,
  onClick,
  disabled,
}: {
  connected: boolean
  connecting: boolean
  walletName: string | null
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      className={`wallet-chip ${connected ? 'is-connected' : ''}`}
      onClick={() => {
        sfx.click()
        onClick()
      }}
      disabled={disabled || connecting}
      title={connected ? `Connected via ${walletName} — click to disconnect` : 'Connect a Midnight wallet'}
    >
      <i aria-hidden="true" />
      <span>{connecting ? 'Connecting...' : connected ? (walletName ?? 'Connected').toUpperCase() : 'Connect Wallet'}</span>
    </button>
  )
}
