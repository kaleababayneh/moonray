

import { useEffect, useRef } from 'react'

/**
 * Ambient page backdrop: a slow-drifting two-layer starfield with an
 * occasional meteor. Sits fixed behind every screen; renders once statically
 * when reduced motion is requested.
 */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const stars = Array.from({ length: 150 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.3 + Math.random() * 1.05,
      tw: Math.random() * Math.PI * 2,
      layer: Math.random() < 0.35 ? 2 : 1,
      gold: Math.random() < 0.08,
    }))

    let meteor: { x: number; y: number; vx: number; vy: number; born: number } | null = null
    let nextMeteor = performance.now() + 6000 + Math.random() * 8000

    const paint = (now: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        const drift = reduced ? 0 : (now / 1000) * (s.layer === 2 ? 1.7 : 0.65)
        const x = ((s.x * w + drift) % (w + 8)) - 4
        const a = reduced
          ? 0.5
          : 0.28 + 0.42 * (0.5 + 0.5 * Math.sin(now / (s.layer === 2 ? 1100 : 1900) + s.tw))
        ctx.globalAlpha = a * (s.layer === 2 ? 1 : 0.7)
        ctx.fillStyle = s.gold ? 'rgba(240,199,110,0.9)' : 'rgba(226,233,255,0.85)'
        ctx.beginPath()
        ctx.arc(x, s.y * h, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (!reduced) {
        if (!meteor && now > nextMeteor) {
          meteor = {
            x: Math.random() * w * 0.7 + w * 0.2,
            y: -20,
            vx: -(120 + Math.random() * 160),
            vy: 190 + Math.random() * 140,
            born: now,
          }
        }
        if (meteor) {
          const age = (now - meteor.born) / 1000
          if (age > 1.4) {
            meteor = null
            nextMeteor = now + 9000 + Math.random() * 14000
          } else {
            const mx = meteor.x + meteor.vx * age
            const my = meteor.y + meteor.vy * age
            const k = age < 0.25 ? age / 0.25 : Math.max(0, 1 - (age - 0.25) / 1.15)
            const grad = ctx.createLinearGradient(mx, my, mx - meteor.vx * 0.22, my - meteor.vy * 0.22)
            grad.addColorStop(0, `rgba(232,238,255,${0.75 * k})`)
            grad.addColorStop(1, 'rgba(232,238,255,0)')
            ctx.strokeStyle = grad
            ctx.lineWidth = 1.3
            ctx.beginPath()
            ctx.moveTo(mx, my)
            ctx.lineTo(mx - meteor.vx * 0.22, my - meteor.vy * 0.22)
            ctx.stroke()
          }
        }
      }
    }

    if (reduced) {
      paint(0)
      window.addEventListener('resize', () => {
        resize()
        paint(0)
      })
      return
    }

    let raf = 0
    let last = 0
    const loop = (now: number) => {
      // ~30fps is plenty for ambience
      if (now - last > 32) {
        last = now
        paint(now)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="backdrop-stars" aria-hidden="true" />
}
