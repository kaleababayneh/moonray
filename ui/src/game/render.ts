/**
 * Full-bleed canvas renderer for the survey field — the design prototype's
 * visual language (v3 "open field") driven by the provable engine.
 *
 * The prototype's numeric space is a [0,1000] grid; the engine's lattice is
 * [0,4096) bigints. `gp()` converts at the boundary, which maps the engine's
 * soundness constants exactly onto the prototype's visual ones
 * (clearance 82 -> 20, moon radius 57 -> 14).
 *
 * All sprites (moons, nebula) are lazily rendered to offscreen canvases and
 * cached. Animation phases run off `now` and freeze under reduced motion.
 */

import {
  activeObjectEntries,
  GRID as ENGINE_GRID,
  type Assignment,
  type Cut as EngineCut,
  type EnginePiece,
  type PlayState,
  type Pt as EnginePt,
} from '@moonray/engine'
import type { DragPreview } from './useSlicerGame'

export const GRID = 1000
export const OBJECT_RADIUS = 14
export const CUT_CLEARANCE = 20

const K = GRID / Number(ENGINE_GRID)

export interface Pt {
  x: number
  y: number
}

/** engine lattice point -> prototype grid space */
export const gp = (p: EnginePt): Pt => ({ x: Number(p.x) * K, y: Number(p.y) * K })

export interface Viewport {
  w: number
  h: number
  pad: number
}

export const gridToCanvas = (v: Viewport, p: Pt): Pt => {
  const scale = Math.min(v.w, v.h) - 2 * v.pad
  return {
    x: v.pad + (p.x / GRID) * scale + (v.w - Math.min(v.w, v.h)) / 2,
    y: v.h - (v.pad + (p.y / GRID) * scale) - (v.h - Math.min(v.w, v.h)) / 2,
  }
}

/** canvas position -> ENGINE lattice point (for pointer input) */
export const canvasToGrid = (v: Viewport, x: number, y: number): EnginePt => {
  const scale = Math.min(v.w, v.h) - 2 * v.pad
  const gx = ((x - (v.w - Math.min(v.w, v.h)) / 2 - v.pad) / scale) * Number(ENGINE_GRID)
  const gy = ((v.h - y - (v.h - Math.min(v.w, v.h)) / 2 - v.pad) / scale) * Number(ENGINE_GRID)
  const clamp = (n: number) => Math.max(0, Math.min(Number(ENGINE_GRID) - 1, Math.round(n)))
  return { x: BigInt(clamp(gx)), y: BigInt(clamp(gy)) }
}

const pxPerGrid = (v: Viewport) => (Math.min(v.w, v.h) - 2 * v.pad) / GRID

// ── palette (mirrors theme.css tokens) ──────────────────────────────────
const beam = (a: number) => `rgba(190, 128, 255, ${a})`
const beamHot = (a: number) => `rgba(226, 188, 255, ${a})`
const moon = (a: number) => `rgba(178, 194, 255, ${a})`
const moonBright = (a: number) => `rgba(236, 240, 255, ${a})`
const gold = (a: number) => `rgba(244, 200, 100, ${a})`
const goldHot = (a: number) => `rgba(255, 230, 168, ${a})`
const rose = (a: number) => `rgba(255, 96, 133, ${a})`

// ── geometry helpers ────────────────────────────────────────────────────
const centroid = (verts: readonly Pt[]) => {
  let cx = 0
  let cy = 0
  for (const p of verts) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / verts.length, y: cy / verts.length }
}

/** Path a convex polygon with rounded corners — the organic "cut glass" look. */
const roundedPath = (ctx: CanvasRenderingContext2D, pts: Pt[], radius: number) => {
  const n = pts.length
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, d1 * 0.38, d2 * 0.38)
    const a = { x: cur.x + ((prev.x - cur.x) / (d1 || 1)) * r, y: cur.y + ((prev.y - cur.y) / (d1 || 1)) * r }
    const b = { x: cur.x + ((next.x - cur.x) / (d2 || 1)) * r, y: cur.y + ((next.y - cur.y) / (d2 || 1)) * r }
    if (i === 0) ctx.moveTo(a.x, a.y)
    else ctx.lineTo(a.x, a.y)
    ctx.quadraticCurveTo(cur.x, cur.y, b.x, b.y)
  }
  ctx.closePath()
}

const insetVerts = (v: Viewport, verts: readonly Pt[], insetPx: number): Pt[] => {
  const cc = gridToCanvas(v, centroid(verts))
  return verts.map((p) => {
    const q = gridToCanvas(v, p)
    const dx = cc.x - q.x
    const dy = cc.y - q.y
    const d = Math.hypot(dx, dy) || 1
    return { x: q.x + (dx / d) * insetPx, y: q.y + (dy / d) * insetPx }
  })
}

/** perpendicular distance from p to the infinite line a-b (display math only) */
const distPtToLine = (a: Pt, b: Pt, p: Pt) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)

// ── seeded rng for sprites ──────────────────────────────────────────────
const srng = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// ── moon sprites: cratered spheres, cached per (radius, seed, mode) ─────
const moonCache = new Map<string, HTMLCanvasElement>()

export const makeMoonSprite = (radius: number, seed: number, golden: boolean): HTMLCanvasElement => {
  const r = Math.max(6, Math.round(radius))
  const key = `${r}:${seed}:${golden ? 'g' : 's'}`
  const hit = moonCache.get(key)
  if (hit) return hit

  const size = r * 2 + 4
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const cx = size / 2
  const cy = size / 2

  const body = ctx.createRadialGradient(cx - r * 0.42, cy - r * 0.42, r * 0.08, cx, cy, r * 1.02)
  if (golden) {
    body.addColorStop(0, '#fffbee')
    body.addColorStop(0.34, '#ffe8b0')
    body.addColorStop(0.7, '#e8b560')
    body.addColorStop(1, '#8a6120')
  } else {
    body.addColorStop(0, '#ffffff')
    body.addColorStop(0.34, '#e8edff')
    body.addColorStop(0.7, '#bcc8ef')
    body.addColorStop(1, '#5d68a0')
  }
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  const rnd = srng(seed * 7349 + 13)
  const count = 4 + Math.floor(rnd() * 3)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2)
  ctx.clip()
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2
    const dist = Math.sqrt(rnd()) * r * 0.72
    const px = cx + Math.cos(ang) * dist
    const py = cy + Math.sin(ang) * dist
    const cr = r * (0.07 + rnd() * 0.1)
    ctx.fillStyle = golden ? 'rgba(130, 88, 24, 0.22)' : 'rgba(70, 80, 130, 0.24)'
    ctx.beginPath()
    ctx.arc(px, py, cr, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = golden ? 'rgba(255, 244, 210, 0.28)' : 'rgba(244, 248, 255, 0.26)'
    ctx.lineWidth = Math.max(0.5, cr * 0.14)
    ctx.beginPath()
    ctx.arc(px, py, cr * 0.9, -0.4, 1.45)
    ctx.stroke()
  }
  const term = ctx.createRadialGradient(cx - r * 0.5, cy - r * 0.5, r * 0.35, cx + r * 0.12, cy + r * 0.12, r * 1.18)
  term.addColorStop(0, 'rgba(0,0,0,0)')
  term.addColorStop(0.78, 'rgba(0,0,0,0)')
  term.addColorStop(1, golden ? 'rgba(40, 24, 4, 0.5)' : 'rgba(12, 15, 36, 0.5)')
  ctx.fillStyle = term
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  moonCache.set(key, c)
  return c
}

// ── nebula backdrop, cached per viewport size ───────────────────────────
let nebula: HTMLCanvasElement | null = null
let nebulaKey = ''

const nebulaFor = (w: number, h: number): HTMLCanvasElement => {
  const key = `${Math.round(w)}x${Math.round(h)}`
  if (nebula && nebulaKey === key) return nebula
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.round(w + 60))
  c.height = Math.max(2, Math.round(h + 60))
  const ctx = c.getContext('2d')!
  const rnd = srng(97)
  const tints = [
    [126, 78, 210],
    [88, 60, 190],
    [170, 70, 190],
    [60, 90, 200],
  ]
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 10; i++) {
    const [tr, tg, tb] = tints[Math.floor(rnd() * tints.length)]
    const x = rnd() * c.width
    const y = rnd() * c.height
    const rad = (0.16 + rnd() * 0.24) * Math.max(c.width, c.height)
    const a = 0.035 + rnd() * 0.045
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, `rgba(${tr}, ${tg}, ${tb}, ${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  nebula = c
  nebulaKey = key
  return c
}

// ── drifting dust motes ─────────────────────────────────────────────────
const motes: { x: number; y: number; s: number; tw: number; gold: boolean }[] = []
{
  const rnd = srng(41)
  for (let i = 0; i < 46; i++) {
    motes.push({ x: rnd(), y: rnd(), s: 6 + rnd() * 16, tw: rnd() * Math.PI * 2, gold: rnd() < 0.1 })
  }
}

// ── visual FX pool ──────────────────────────────────────────────────────
interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  life: number
  size: number
  tint: 'gold' | 'beam'
}

interface Burst {
  x: number
  y: number
  born: number
}

interface Ghost {
  verts: Pt[]
  born: number
}

interface Flight {
  x: number
  y: number
  idx: number
  born: number
}

export interface Fx {
  sparks: Spark[]
  bursts: Burst[]
  ghosts: Ghost[]
  flights: Flight[]
  flash: { a: Pt; b: Pt; at: number } | null
  shakeAt: number
  shakeAmp: number
  wonAt: number | null
}

export const createFx = (): Fx => ({
  sparks: [],
  bursts: [],
  ghosts: [],
  flights: [],
  flash: null,
  shakeAt: -1e9,
  shakeAmp: 0,
  wonAt: null,
})

/** an isolating cut: pieces dissolve in place, moonlets fly to the collector */
export const spawnCollect = (
  fx: Fx,
  pieces: readonly EnginePiece[],
  centers: readonly EnginePt[],
  slots: readonly number[],
  now: number,
) => {
  for (const p of pieces) fx.ghosts.push({ verts: p.verts.map(gp), born: now })
  centers.forEach((c, k) => {
    const q = gp(c)
    fx.flights.push({ x: q.x, y: q.y, idx: slots[k] ?? k, born: now + 160 + k * 140 })
  })
}

export const spawnSlice = (fx: Fx, cut: EngineCut, now: number) => {
  const a = gp(cut.a)
  const b = gp(cut.b)
  fx.flash = { a, b, at: now }
  fx.shakeAt = now
  fx.shakeAmp = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  for (let i = 0; i < 30; i++) {
    const t = Math.random()
    const side = Math.random() < 0.5 ? -1 : 1
    const speed = 150 + Math.random() * 480
    fx.sparks.push({
      x: a.x + dx * t,
      y: a.y + dy * t,
      vx: -uy * side * speed + ux * (Math.random() - 0.5) * 180,
      vy: ux * side * speed + uy * (Math.random() - 0.5) * 180,
      born: now,
      life: 0.32 + Math.random() * 0.45,
      size: 1 + Math.random() * 1.8,
      tint: Math.random() < 0.55 ? 'gold' : 'beam',
    })
  }
}

export const spawnLock = (fx: Fx, p: EnginePt, now: number, delay = 0) => {
  const q = gp(p)
  fx.bursts.push({ x: q.x, y: q.y, born: now + delay })
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5
    const speed = 90 + Math.random() * 260
    fx.sparks.push({
      x: q.x,
      y: q.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      born: now + delay,
      life: 0.35 + Math.random() * 0.4,
      size: 0.9 + Math.random() * 1.4,
      tint: 'gold',
    })
  }
}

export const nudge = (fx: Fx, now: number) => {
  fx.shakeAt = now
  fx.shakeAmp = 0.5
}

export const beginWin = (fx: Fx, now: number) => {
  fx.wonAt = now
}

export const clearWin = (fx: Fx) => {
  fx.wonAt = null
}

// ── render state ────────────────────────────────────────────────────────
export interface RenderState {
  play: PlayState
  assignment: Assignment
  preview: DragPreview | null
  fx: Fx
  hover: EnginePt | null
  reduced: boolean
  /** stable per-level seed so crater patterns don't reshuffle */
  levelSeed: number
}

// smoothed pointer parallax (module-level so it survives re-renders)
let parX = 0
let parY = 0

export const render = (
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  rs: RenderState,
  now: number,
) => {
  const { play, assignment, preview, fx, reduced } = rs
  const anim = reduced ? 0 : now
  ctx.clearRect(0, 0, v.w, v.h)

  // nebula wash across the whole viewport, drifting very slowly
  const neb = nebulaFor(v.w, v.h)
  const nx = reduced ? -30 : -30 + Math.sin(anim / 53000) * 16
  const ny = reduced ? -30 : -30 + Math.cos(anim / 61000) * 12
  ctx.drawImage(neb, nx, ny)

  // full-viewport plot grid — slightly brighter inside the field
  const size = Math.min(v.w, v.h) - 2 * v.pad
  const bx = (v.w - size) / 2
  const by = (v.h - size) / 2
  const step = size / 10
  ctx.lineWidth = 1
  ctx.strokeStyle = beam(0.05)
  ctx.beginPath()
  for (let x = bx % step; x < v.w; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, v.h)
  }
  for (let y = by % step; y < v.h; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(v.w, y)
  }
  ctx.stroke()

  ctx.save()

  // pointer parallax + shake
  const hoverG = rs.hover ? gp(rs.hover) : null
  const previewB = preview ? gp(preview.b) : null
  const target = hoverG ?? previewB
  let tx = 0
  let ty = 0
  if (target && !reduced) {
    tx = ((target.x - GRID / 2) / GRID) * -10
    ty = ((target.y - GRID / 2) / GRID) * 10
  }
  parX += (tx - parX) * 0.06
  parY += (ty - parY) * 0.06
  let sx = 0
  let sy = 0
  const shakeAge = now - fx.shakeAt
  if (!reduced && shakeAge < 230) {
    const k = (1 - shakeAge / 230) * fx.shakeAmp
    sx = Math.sin(now * 0.11) * 3.6 * k
    sy = Math.cos(now * 0.13) * 2.8 * k
  }
  ctx.translate(parX + sx, parY + sy)

  // ambient glow pooled at the field center
  const cx = v.w / 2
  const cy = v.h / 2
  const glow = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.85)
  glow.addColorStop(0, beam(0.05))
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(-40, -40, v.w + 80, v.h + 80)

  // dust motes drifting through the scene
  if (!reduced) {
    for (const m of motes) {
      const yy = ((m.y + now / (m.s * 9000)) % 1.04) - 0.02
      const xx = m.x + Math.sin(now / 5000 + m.tw) * 0.006
      const a = 0.1 + 0.22 * (0.5 + 0.5 * Math.sin(now / 1400 + m.tw))
      ctx.fillStyle = m.gold ? gold(a) : moonBright(a * 0.9)
      ctx.beginPath()
      ctx.arc(xx * v.w, (1 - yy) * v.h, m.s > 16 ? 1.3 : 0.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const scale = pxPerGrid(v)
  const cornerR = Math.max(18, size * 0.045)

  // ── pieces — organic rounded shards of light ──────────────────────────
  // solo = the live piece holds exactly one active moonlet (gold tint).
  const retiredCount = play.retired.length
  const perClaimed = new Map<number, number>()
  for (const pi of assignment.objectPiece) perClaimed.set(pi, (perClaimed.get(pi) ?? 0) + 1)

  const flashAge = fx.flash ? now - fx.flash.at : 1e9
  const pop = !reduced && flashAge < 340 ? (1 - flashAge / 340) * 9 : 0
  const inset = play.cuts.length === 0 ? 0 : 6.5 + pop

  play.pieces.forEach((piece, i) => {
    const solo = perClaimed.get(retiredCount + i) === 1
    const pts = insetVerts(v, piece.verts.map(gp), inset)
    let ccx = 0
    let ccy = 0
    for (const p of pts) {
      ccx += p.x
      ccy += p.y
    }
    ccx /= pts.length
    ccy /= pts.length
    let reach = 0
    for (const p of pts) reach = Math.max(reach, Math.hypot(p.x - ccx, p.y - ccy))
    const fill = ctx.createRadialGradient(ccx, ccy, reach * 0.08, ccx, ccy, reach)
    if (solo) {
      fill.addColorStop(0, gold(0.2))
      fill.addColorStop(1, gold(0.05))
    } else {
      fill.addColorStop(0, beam(0.19))
      fill.addColorStop(1, beam(0.055))
    }

    roundedPath(ctx, pts, cornerR)
    ctx.fillStyle = fill
    ctx.fill()

    // a slow drifting pool of light inside the glass
    if (pts.length >= 3) {
      const la = anim / 9000 + i * 1.3
      const lx = ccx + Math.cos(la) * reach * 0.34
      const ly = ccy + Math.sin(la * 0.8) * reach * 0.28
      const caustic = ctx.createRadialGradient(lx, ly, 0, lx, ly, reach * 0.75)
      caustic.addColorStop(0, solo ? gold(0.07) : beam(0.07))
      caustic.addColorStop(1, 'rgba(0,0,0,0)')
      roundedPath(ctx, pts, cornerR)
      ctx.fillStyle = caustic
      ctx.fill()
    }

    // inner soft glow hugging the edge (layered strokes, no filters)
    ctx.save()
    ctx.clip()
    roundedPath(ctx, pts, cornerR)
    ctx.strokeStyle = solo ? gold(0.09) : beam(0.08)
    ctx.lineWidth = 16
    ctx.stroke()
    roundedPath(ctx, pts, cornerR)
    ctx.strokeStyle = solo ? gold(0.12) : beam(0.11)
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.restore()

    // luminous edge
    roundedPath(ctx, pts, cornerR)
    ctx.strokeStyle = solo ? gold(0.85) : beam(0.75)
    ctx.lineWidth = 1.8
    ctx.shadowColor = solo ? gold(0.9) : beam(0.9)
    ctx.shadowBlur = 16
    ctx.stroke()
    ctx.shadowBlur = 0

    // a comet of light running the rim
    if (!reduced) {
      let per = 0
      for (let k = 0; k < pts.length; k++) {
        const nx2 = pts[(k + 1) % pts.length]
        per += Math.hypot(nx2.x - pts[k].x, nx2.y - pts[k].y)
      }
      if (per > 60) {
        const cometLen = Math.max(44, per * 0.11)
        roundedPath(ctx, pts, cornerR)
        ctx.strokeStyle = solo ? goldHot(0.8) : beamHot(0.7)
        ctx.lineWidth = 2
        ctx.shadowColor = solo ? gold(0.95) : beam(0.95)
        ctx.shadowBlur = 11
        ctx.setLineDash([cometLen, Math.max(1, per - cometLen)])
        ctx.lineDashOffset = -((anim * 0.055 + i * per * 0.37) % per)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.shadowBlur = 0
      }
    }
  })

  // committed cuts — molten seams with a glint travelling along them
  play.cuts.forEach((cut, ci) => {
    const a = gridToCanvas(v, gp(cut.a))
    const b = gridToCanvas(v, gp(cut.b))
    ctx.strokeStyle = gold(0.28)
    ctx.lineWidth = 1.1
    ctx.shadowColor = gold(0.5)
    ctx.shadowBlur = 7
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.shadowBlur = 0
    if (!reduced) {
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len > 40) {
        ctx.strokeStyle = goldHot(0.55)
        ctx.lineWidth = 1.4
        ctx.shadowColor = gold(0.8)
        ctx.shadowBlur = 8
        ctx.setLineDash([30, Math.max(1, len - 30)])
        ctx.lineDashOffset = -((anim * 0.13 + ci * 260) % len)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.shadowBlur = 0
      }
    }
  })

  // ── moonlets ──────────────────────────────────────────────────────────
  const entries = activeObjectEntries(play.level)
  const chordG = preview?.chord ? { a: gp(preview.chord.a), b: gp(preview.chord.b) } : null

  if (preview) {
    entries.forEach(({ slot, pt }) => {
      if (play.collected[slot]) return
      const o = gp(pt)
      const q = gridToCanvas(v, o)
      const cr = CUT_CLEARANCE * scale
      const violated = chordG != null && distPtToLine(chordG.a, chordG.b, o) < CUT_CLEARANCE
      if (violated) {
        const pulse = 1 + 0.045 * Math.sin(anim / 90)
        ctx.strokeStyle = rose(0.8)
        ctx.lineWidth = 1.6
        ctx.shadowColor = rose(0.7)
        ctx.shadowBlur = 12
        ctx.beginPath()
        ctx.arc(q.x, q.y, cr * pulse, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      } else {
        ctx.strokeStyle = rose(0.2)
        ctx.setLineDash([3, 7])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(q.x, q.y, cr, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
    })
  }

  entries.forEach(({ slot, pt }, i) => {
    if (play.collected[slot]) return // flown home — drawn only as flight FX
    const q = gridToCanvas(v, gp(pt))
    const isolated = assignment.isolated[i]
    const breathing = 1 + 0.04 * Math.sin(anim / 760 + i * 1.7)
    const r = OBJECT_RADIUS * scale * breathing
    const tint = isolated ? gold : moon

    const bloom = ctx.createRadialGradient(q.x, q.y, r * 0.4, q.x, q.y, r * 1.35)
    bloom.addColorStop(0, tint(isolated ? 0.22 : 0.14))
    bloom.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = bloom
    ctx.beginPath()
    ctx.arc(q.x, q.y, r * 1.35, 0, Math.PI * 2)
    ctx.fill()

    const sprite = makeMoonSprite(OBJECT_RADIUS * scale, rs.levelSeed * 31 + slot * 101, isolated)
    ctx.shadowColor = tint(0.85)
    ctx.shadowBlur = isolated ? 10 : 4
    ctx.drawImage(sprite, q.x - r - 2, q.y - r - 2, (r + 2) * 2, (r + 2) * 2)
    ctx.shadowBlur = 0

    const gpulse = Math.sin(anim / 1100 + i * 2.63)
    if (!reduced && gpulse > 0.9) {
      const ga = (gpulse - 0.9) / 0.1
      const gx = q.x - r * 0.34
      const gy = q.y - r * 0.34
      const glen = r * 0.5 + 2.5
      ctx.strokeStyle = isolated ? goldHot(0.95 * ga) : moonBright(0.9 * ga)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(gx - glen, gy)
      ctx.lineTo(gx + glen, gy)
      ctx.moveTo(gx, gy - glen)
      ctx.lineTo(gx, gy + glen)
      ctx.stroke()
    }

    if (isolated) {
      ctx.strokeStyle = gold(0.8)
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(q.x, q.y, r + 5 + Math.sin(anim / 350 + i) * 1.3, 0, Math.PI * 2)
      ctx.stroke()
      const oa = anim / 900 + i * 2.1
      ctx.fillStyle = goldHot(0.95)
      ctx.beginPath()
      ctx.arc(q.x + Math.cos(oa) * (r + 10), q.y + Math.sin(oa) * (r + 10) * 0.92, 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  // ── drag preview blade ────────────────────────────────────────────────
  if (preview?.chord && chordG) {
    const a = gridToCanvas(v, chordG.a)
    const b = gridToCanvas(v, chordG.b)
    const ok = preview.wouldSplit
    ctx.shadowColor = ok ? goldHot(0.8) : rose(0.7)
    ctx.shadowBlur = 16
    ctx.strokeStyle = ok ? gold(0.55) : rose(0.45)
    ctx.lineWidth = 3.4
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.shadowBlur = 0

    ctx.strokeStyle = ok ? goldHot(1) : rose(0.95)
    ctx.lineWidth = 1.4
    ctx.setLineDash([12, 9])
    ctx.lineDashOffset = -(anim / 22) % 21
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])

    for (const e of [a, b]) {
      ctx.fillStyle = ok ? goldHot(1) : rose(0.95)
      ctx.beginPath()
      ctx.moveTo(e.x, e.y - 5)
      ctx.lineTo(e.x + 5, e.y)
      ctx.lineTo(e.x, e.y + 5)
      ctx.lineTo(e.x - 5, e.y)
      ctx.closePath()
      ctx.fill()
    }
  } else if (preview) {
    const a = gridToCanvas(v, gp(preview.a))
    const b = gridToCanvas(v, gp(preview.b))
    ctx.strokeStyle = moonBright(0.4)
    ctx.setLineDash([3, 7])
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── FX ────────────────────────────────────────────────────────────────
  if (!reduced) {
    ctx.globalCompositeOperation = 'lighter'

    if (fx.flash && flashAge < 300) {
      const k = 1 - flashAge / 300
      const a = gridToCanvas(v, fx.flash.a)
      const b = gridToCanvas(v, fx.flash.b)
      ctx.strokeStyle = gold(0.4 * k)
      ctx.lineWidth = 8
      ctx.shadowColor = gold(0.85 * k)
      ctx.shadowBlur = 26
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.strokeStyle = moonBright(0.9 * k)
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    fx.sparks = fx.sparks.filter((s) => (now - s.born) / 1000 < s.life && now >= s.born)
    for (const s of fx.sparks) {
      const age = (now - s.born) / 1000
      const t = age / s.life
      const gx = s.x + s.vx * age
      const gy = s.y + s.vy * age
      const q = gridToCanvas(v, { x: gx, y: gy })
      const tail = gridToCanvas(v, { x: gx - s.vx * 0.03, y: gy - s.vy * 0.03 })
      const alpha = Math.pow(1 - t, 1.6)
      ctx.strokeStyle = s.tint === 'gold' ? goldHot(alpha) : beamHot(alpha)
      ctx.lineWidth = s.size * (1 - t * 0.5)
      ctx.beginPath()
      ctx.moveTo(tail.x, tail.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }

    // dissolving pieces — the shard lingers, shrinks and fades
    fx.ghosts = fx.ghosts.filter((g) => now - g.born < 760)
    for (const g of fx.ghosts) {
      const t = (now - g.born) / 760
      const pts = insetVerts(v, g.verts, 6.5 + t * 30)
      roundedPath(ctx, pts, cornerR)
      ctx.fillStyle = gold(0.09 * (1 - t))
      ctx.fill()
      ctx.strokeStyle = gold(0.8 * (1 - t))
      ctx.lineWidth = 1.6
      ctx.shadowColor = gold(0.7 * (1 - t))
      ctx.shadowBlur = 14
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    // collected moonlets flying home to the collector
    fx.flights = fx.flights.filter((f) => now - f.born < 1000)
    for (const f of fx.flights) {
      const age = now - f.born
      if (age < 0) continue
      const t = easeOut(age / 1000)
      const start = gridToCanvas(v, { x: f.x, y: f.y })
      const target2 = { x: v.w / 2, y: v.h - (v.w < 760 ? 152 : 78) }
      const mx = (start.x + target2.x) / 2
      const my = Math.min(start.y, target2.y) - 110
      const ix = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * mx + t * t * target2.x
      const iy = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * my + t * t * target2.y
      const r = OBJECT_RADIUS * scale * (1 - t * 0.72)
      const sprite = makeMoonSprite(OBJECT_RADIUS * scale, rs.levelSeed * 31 + f.idx * 101, true)
      ctx.shadowColor = gold(0.9 * (1 - t * 0.4))
      ctx.shadowBlur = 20
      ctx.drawImage(sprite, ix - r, iy - r, r * 2, r * 2)
      ctx.shadowBlur = 0
      for (let k = 1; k <= 3; k++) {
        const tt = Math.max(0, t - k * 0.05)
        const tx2 = (1 - tt) * (1 - tt) * start.x + 2 * (1 - tt) * tt * mx + tt * tt * target2.x
        const ty2 = (1 - tt) * (1 - tt) * start.y + 2 * (1 - tt) * tt * my + tt * tt * target2.y
        ctx.fillStyle = goldHot(0.3 * (1 - t) * (1 - k * 0.28))
        ctx.beginPath()
        ctx.arc(tx2, ty2, 2.4 - k * 0.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    fx.bursts = fx.bursts.filter((bst) => now - bst.born < 620)
    for (const bst of fx.bursts) {
      const age = now - bst.born
      if (age < 0) continue
      const t = age / 620
      const q = gridToCanvas(v, { x: bst.x, y: bst.y })
      const r0 = OBJECT_RADIUS * scale + 4 + easeOut(t) * 40
      ctx.strokeStyle = gold(0.8 * (1 - t))
      ctx.lineWidth = 2 * (1 - t) + 0.4
      ctx.beginPath()
      ctx.arc(q.x, q.y, r0, 0, Math.PI * 2)
      ctx.stroke()
      if (t < 0.6) {
        ctx.strokeStyle = moonBright(0.5 * (1 - t / 0.6))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(q.x, q.y, r0 * 0.7, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    if (fx.wonAt != null && assignment.fullClear) {
      const age = now - fx.wonAt
      if (age < 3400) {
        const fade = age > 2600 ? Math.max(0, 1 - (age - 2600) / 800) : 1
        const pts = entries.map((e) => gridToCanvas(v, gp(e.pt)))
        for (let i = 0; i < pts.length - 1; i++) {
          const start = 260 + i * 150
          if (age <= start) continue
          const t = easeOut(Math.min(1, (age - start) / 150))
          const a = pts[i]
          const b = pts[i + 1]
          ctx.strokeStyle = moonBright(0.6 * fade)
          ctx.lineWidth = 1
          ctx.shadowColor = gold(0.55 * fade)
          ctx.shadowBlur = 9
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
          ctx.stroke()
          ctx.shadowBlur = 0
        }
        for (let i = 0; i < pts.length; i++) {
          const reached = age > 260 + (i - 1) * 150 + 150 || i === 0
          if (!reached) continue
          const q = pts[i]
          const tw = 0.6 + 0.4 * Math.sin(anim / 160 + i * 2)
          ctx.fillStyle = goldHot(0.9 * fade * tw)
          ctx.beginPath()
          ctx.moveTo(q.x, q.y - 5.5)
          ctx.lineTo(q.x + 5.5, q.y)
          ctx.lineTo(q.x, q.y + 5.5)
          ctx.lineTo(q.x - 5.5, q.y)
          ctx.closePath()
          ctx.fill()
        }
      }
    }

    ctx.globalCompositeOperation = 'source-over'
  }

  // pointer reticle — replaces the OS cursor over the field
  const pointerG = preview ? gp(preview.b) : hoverG
  if (pointerG) {
    const q = gridToCanvas(v, pointerG)
    ctx.strokeStyle = moonBright(0.6)
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      ctx.moveTo(q.x + dx * 6, q.y + dy * 6)
      ctx.lineTo(q.x + dx * 13, q.y + dy * 13)
    }
    ctx.stroke()
    ctx.fillStyle = moonBright(0.9)
    ctx.beginPath()
    ctx.arc(q.x, q.y, 1.5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}
