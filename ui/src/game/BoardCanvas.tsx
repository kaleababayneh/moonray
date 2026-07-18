/**
 * The survey field, full-bleed behind the floating HUD. Owns the rAF loop and
 * a visual-only FX pool; game-state transitions (cut, rejection, isolation,
 * collection, full clear) are detected here by diffing refs and become
 * flashes, sparks, ghosts, flights and shakes.
 */

import { useEffect, useRef } from 'react'
import type { Pt } from '@moonray/engine'
import type { SlicerGame } from './useSlicerGame'
import {
  beginWin,
  canvasToGrid,
  clearWin,
  createFx,
  nudge,
  render,
  spawnCollect,
  spawnLock,
  spawnSlice,
  type Fx,
  type Viewport,
} from './render'

/** Field padding: nearly edge-to-edge on phones, roomy on desktop. */
const padFor = (w: number, h: number) => {
  const min = Math.min(w, h)
  return min < 560 ? 14 : Math.max(26, Math.min(48, min * 0.04))
}

export function BoardCanvas({ game }: { game: SlicerGame }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef(game)
  gameRef.current = game
  const fxRef = useRef<Fx | null>(null)
  if (!fxRef.current) fxRef.current = createFx()
  const fx = fxRef.current
  const hoverRef = useRef<Pt | null>(null)
  const reducedRef = useRef(false)

  // fresh board → fresh FX pool
  const prevSeed = useRef(game.seed)
  if (prevSeed.current !== game.seed) {
    prevSeed.current = game.seed
    fxRef.current = createFx()
  }

  // committed cut → slice flash + sparks
  const prevSplit = useRef(game.splitFlash)
  if (game.splitFlash !== prevSplit.current) {
    prevSplit.current = game.splitFlash
    const cuts = game.state.cuts
    if (cuts.length) spawnSlice(fx, cuts[cuts.length - 1], performance.now())
  }

  // rejection → small shake
  const prevReject = useRef(game.lastRejection)
  if (game.lastRejection !== prevReject.current) {
    prevReject.current = game.lastRejection
    if (game.lastRejection) nudge(fx, performance.now())
  }

  // newly isolated moonlets → staggered lock bursts
  const isoKey = game.assignment.isolated.map((b) => (b ? '1' : '0')).join('')
  const prevIso = useRef(isoKey)
  if (isoKey !== prevIso.current) {
    const before = prevIso.current
    prevIso.current = isoKey
    if (game.state.cuts.length > 0) {
      let stagger = 0
      game.assignment.isolated.forEach((iso, i) => {
        if (iso && before[i] !== '1') {
          const slot = game.assignment.slots[i]
          spawnLock(fx, game.state.level.objects[slot], performance.now(), stagger * 110)
          stagger++
        }
      })
    }
  }

  // isolating cut → pieces dissolve, moons fly to the collector
  const prevCollect = useRef(game.collectEvent?.nonce ?? 0)
  if ((game.collectEvent?.nonce ?? 0) !== prevCollect.current) {
    prevCollect.current = game.collectEvent?.nonce ?? 0
    const ev = game.collectEvent
    if (ev) spawnCollect(fx, ev.pieces, ev.centers, ev.slots, performance.now())
  }

  // full clear → constellation flourish
  const clearNow = game.assignment.fullClear && game.state.cuts.length > 0
  const prevClear = useRef(clearNow)
  if (clearNow !== prevClear.current) {
    prevClear.current = clearNow
    if (clearNow) beginWin(fx, performance.now())
    else clearWin(fx)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedRef.current = mq.matches
    const onMq = () => {
      reducedRef.current = mq.matches
    }
    mq.addEventListener?.('change', onMq)

    let raf = 0
    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.round(rect.width * dpr)
      const h = Math.round(rect.height * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const viewport: Viewport = { w: rect.width, h: rect.height, pad: padFor(rect.width, rect.height) }
      const current = gameRef.current
      render(
        ctx,
        viewport,
        {
          play: current.state,
          assignment: current.assignment,
          preview: current.preview,
          fx: fxRef.current!,
          hover: hoverRef.current,
          reduced: reducedRef.current,
          levelSeed: Number(current.seed % 2147483647n),
        },
        now,
      )
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      mq.removeEventListener?.('change', onMq)
    }
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return canvasToGrid(
      { w: rect.width, h: rect.height, pad: padFor(rect.width, rect.height) },
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
  }

  const hintHidden = game.state.cuts.length > 0 || game.preview != null

  return (
    <>
      <canvas
        ref={canvasRef}
        className="field-canvas"
        aria-label="Lunar survey field. Drag anywhere to slice the field and isolate every moonlet."
        role="img"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          hoverRef.current = null
          gameRef.current.beginDrag(point(e))
        }}
        onPointerMove={(e) => {
          const p = point(e)
          if (e.buttons & 1) {
            gameRef.current.moveDrag(p)
          } else {
            hoverRef.current = p
          }
        }}
        onPointerUp={(e) => {
          gameRef.current.endDrag(point(e))
          hoverRef.current = point(e)
        }}
        onPointerCancel={() => {
          gameRef.current.cancelDrag()
          hoverRef.current = null
        }}
        onPointerLeave={() => {
          hoverRef.current = null
        }}
      />
      <div className={`field-hint ${hintHidden ? 'is-hidden' : ''}`} aria-hidden="true">
        DRAG ANYWHERE TO SLICE THE FIELD
      </div>
    </>
  )
}
