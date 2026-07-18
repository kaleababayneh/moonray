/**
 * Title: a large cratered moon, sliced once — the mark of the game — over a
 * serif wordmark and a chromeless menu. The daily operation line reads live
 * chain state; the wallet chip links a Midnight connector.
 */

import { useEffect, useRef } from 'react'
import { fmtClock, Glyph, Icon, pad2, pad4, WalletChip } from './Hud'
import { makeMoonSprite } from '../game/render'
import { useGame } from '../midnight/GameContext'
import type { TournamentView } from '@moonray/api'

/** Hourly tids are hours-since-epoch — display the last 4 digits. */
export const opId = (tid: bigint) => `OP-${(tid % 10000n).toString().padStart(4, '0')}`

function HeroMoon({ size = 300 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const s = size / 300
    const r = 96 * s
    const cx = 150 * s
    const cy = 158 * s
    const nx = 0.53
    const ny = -0.848
    const A = { x: 85.4 * s, y: 87.0 * s }
    const B = { x: 242.1 * s, y: 184.9 * s }
    const lift = 15 * s

    const sprite = makeMoonSprite(r, 777, false)
    const drawSprite = () => ctx.drawImage(sprite, cx - r - 2, cy - r - 2, (r + 2) * 2, (r + 2) * 2)

    const bodyPath = () => {
      ctx.beginPath()
      ctx.moveTo(A.x, A.y)
      ctx.arc(cx, cy, r, Math.atan2(A.y - cy, A.x - cx), Math.atan2(B.y - cy, B.x - cx), true)
      ctx.closePath()
    }
    const capPath = () => {
      ctx.beginPath()
      ctx.moveTo(A.x, A.y)
      ctx.arc(cx, cy, r, Math.atan2(A.y - cy, A.x - cx), Math.atan2(B.y - cy, B.x - cx), false)
      ctx.closePath()
    }

    ctx.save()
    bodyPath()
    ctx.clip()
    drawSprite()
    ctx.restore()

    ctx.strokeStyle = 'rgba(255, 230, 168, 0.95)'
    ctx.lineWidth = 1.6 * s
    ctx.shadowColor = 'rgba(244, 200, 100, 0.9)'
    ctx.shadowBlur = 14 * s
    ctx.beginPath()
    ctx.moveTo(A.x, A.y)
    ctx.lineTo(B.x, B.y)
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.save()
    ctx.translate(nx * lift, ny * lift)
    capPath()
    ctx.clip()
    drawSprite()
    ctx.fillStyle = 'rgba(244, 200, 100, 0.3)'
    ctx.fillRect(0, 0, size, size)
    ctx.restore()
    ctx.save()
    ctx.translate(nx * lift, ny * lift)
    capPath()
    ctx.strokeStyle = 'rgba(255, 230, 168, 0.85)'
    ctx.lineWidth = 1.4 * s
    ctx.shadowColor = 'rgba(244, 200, 100, 0.8)'
    ctx.shadowBlur = 10 * s
    ctx.stroke()
    ctx.restore()
    ctx.shadowBlur = 0

    const mx = 118 * s
    const my = 196 * s
    ctx.fillStyle = '#f4c864'
    ctx.shadowColor = 'rgba(244, 200, 100, 0.9)'
    ctx.shadowBlur = 12 * s
    ctx.beginPath()
    ctx.arc(mx, my, 5 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(244, 200, 100, 0.5)'
    ctx.lineWidth = 1 * s
    ctx.beginPath()
    ctx.arc(mx, my, 11 * s, 0, Math.PI * 2)
    ctx.stroke()
  }, [size])

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />
}

export function TitleScreen({
  tournament,
  nowSec,
  muted,
  onToggleMute,
  onDaily,
  onExpedition,
  onRanking,
  onManual,
}: {
  tournament: TournamentView | null
  nowSec: number
  muted: boolean
  onToggleMute: () => void
  onDaily: () => void
  onExpedition: () => void
  onRanking: () => void
  onManual: () => void
}) {
  const g = useGame()
  const open = tournament != null && nowSec < tournament.submitUntil
  const myRun = tournament ? g.myRuns()[tournament.tid.toString()] : undefined
  const revealedCount = tournament?.ranking.length ?? 0
  const badgeCount = g.ledger?.badges.length ?? 0
  const sealedCount = g.ledger?.sealedCommits.size ?? 0

  const dailySub = !g.contractAddress
    ? 'NO DEPLOYMENT FOUND · PRACTICE ONLY'
    : !tournament
      ? 'NO ACTIVE OPERATION ON-CHAIN'
      : !open
        ? `${opId(tournament.tid)} · SEALS CLOSED`
        : myRun
          ? `${opId(tournament.tid)} · SEALED ${myRun.score} PTS`
          : `${opId(tournament.tid)} · A FRESH FIELD EVERY HOUR`

  // the countdown under the wordmark: current field's close, else next hour
  const timerSecs = open
    ? Math.max(0, tournament.submitUntil - nowSec)
    : 3600 - (nowSec % 3600)

  return (
    <section className="title-screen">
      <div className="title-controls">
        <WalletChip
          connected={g.connected}
          connecting={g.connecting}
          walletName={g.walletName}
          disabled={!g.contractAddress}
          onClick={() => {
            if (g.connected) g.disconnect()
            else void g.connect().catch(() => undefined)
          }}
        />
        <Glyph label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={onToggleMute} aria-pressed={!muted}>
          <Icon name={muted ? 'soundOff' : 'sound'} />
        </Glyph>
      </div>

      <div className="hero rise" style={{ '--d': '0ms' } as React.CSSProperties}>
        <span className="hero-halo" aria-hidden="true" />
        <HeroMoon />
      </div>

      <h1 className="title-word rise" style={{ '--d': '120ms' } as React.CSSProperties}>
        MOONRAY
      </h1>
      <div className="title-timer rise" style={{ '--d': '160ms' } as React.CSSProperties}>
        <span>{open ? 'FIELD CLOSES IN' : 'NEXT FIELD IN'}</span>
        <b>{fmtClock(timerSecs)}</b>
      </div>
      <p className="title-tag rise" style={{ '--d': '200ms' } as React.CSSProperties}>
        Slice the plates of moonlight. Set every moonlet free — and seal your score with a
        zero-knowledge proof on Midnight.
      </p>

      <nav className="menu" aria-label="Main menu">
        <button
          className="menu-item rise"
          style={{ '--d': '300ms' } as React.CSSProperties}
          onClick={onDaily}
          disabled={!tournament || !open}
        >
          <span className="menu-label">Hourly operation</span>
          <span className="menu-sub">{dailySub}</span>
        </button>
        <button className="menu-item rise" style={{ '--d': '370ms' } as React.CSSProperties} onClick={onExpedition}>
          <span className="menu-label">Expedition</span>
          <span className="menu-sub">ENDLESS PROCEDURAL FIELDS · OFF-CHAIN</span>
        </button>
        <button className="menu-item rise" style={{ '--d': '440ms' } as React.CSSProperties} onClick={onRanking}>
          <span className="menu-label">Ranking</span>
          <span className="menu-sub">
            {sealedCount} SEALED · {revealedCount} REVEALED · {badgeCount} HONOURS
          </span>
        </button>
        <button className="menu-item rise" style={{ '--d': '510ms' } as React.CSSProperties} onClick={onManual}>
          <span className="menu-label">Field manual</span>
          <span className="menu-sub">RULES · SCORING · PROOFS</span>
        </button>
      </nav>

      <footer className="title-foot rise" style={{ '--d': '580ms' } as React.CSSProperties}>
        <span>NETWORK {g.networkId.toUpperCase()}</span>
        <i aria-hidden="true" />
        <span>
          {g.contractAddress
            ? `CONTRACT ${g.contractAddress.slice(0, 8).toUpperCase()}…`
            : 'OFF-CHAIN PRACTICE'}
        </span>
        {myRun && (
          <>
            <i aria-hidden="true" />
            <span>SEALED {pad4(myRun.score)}</span>
          </>
        )}
      </footer>
    </section>
  )
}
