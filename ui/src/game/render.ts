/**
 * Canvas renderer. Grid space is [0,4096)^2 with y-up (engine/math coords);
 * the canvas is y-down — flipY handles the mirror. Pure draw functions,
 * driven by BoardCanvas's rAF loop.
 */

import type { Assignment, EnginePiece, PlayState, Pt } from '@moonray/engine';
import {
  GRID,
  OBJECT_RADIUS_PX,
  CUT_OBJECT_CLEARANCE_PX,
  activeObjectEntries,
} from '@moonray/engine';
import type { DragPreview } from './useSlicerGame';

export interface Viewport {
  w: number;
  h: number;
  pad: number;
}

const N = (b: bigint) => Number(b);

export const gridToCanvas = (v: Viewport, p: { x: number; y: number }) => {
  const scale = Math.min(v.w, v.h) - 2 * v.pad;
  return {
    x: v.pad + (p.x / N(GRID)) * scale + (v.w - Math.min(v.w, v.h)) / 2,
    y: v.h - (v.pad + (p.y / N(GRID)) * scale) - (v.h - Math.min(v.w, v.h)) / 2,
  };
};

export const canvasToGrid = (v: Viewport, x: number, y: number): Pt => {
  const scale = Math.min(v.w, v.h) - 2 * v.pad;
  const gx = ((x - (v.w - Math.min(v.w, v.h)) / 2 - v.pad) / scale) * N(GRID);
  const gy = ((v.h - y - (v.h - Math.min(v.w, v.h)) / 2 - v.pad) / scale) * N(GRID);
  const clamp = (n: number) => Math.max(0, Math.min(N(GRID) - 1, Math.round(n)));
  return { x: BigInt(clamp(gx)), y: BigInt(clamp(gy)) };
};

const pxPerGrid = (v: Viewport) => (Math.min(v.w, v.h) - 2 * v.pad) / N(GRID);

interface Palette {
  boardFill: string;
  boardEdge: string;
  pieceFill: string[];
  pieceEdge: string;
  cut: string;
  previewOk: string;
  previewBad: string;
  orb: string;
  orbIsolated: string;
  orbShared: string;
  starlight: string;
}

export const darkPalette: Palette = {
  boardFill: 'rgba(96, 128, 220, 0.10)',
  boardEdge: 'rgba(168, 198, 255, 0.85)',
  pieceFill: [
    'rgba(102, 140, 240, 0.16)',
    'rgba(140, 110, 240, 0.16)',
    'rgba(90, 190, 230, 0.15)',
    'rgba(200, 120, 220, 0.14)',
    'rgba(110, 210, 180, 0.15)',
    'rgba(230, 160, 110, 0.14)',
    'rgba(160, 160, 250, 0.15)',
    'rgba(120, 200, 130, 0.14)',
  ],
  pieceEdge: 'rgba(190, 210, 255, 0.55)',
  cut: '#ffd166',
  previewOk: 'rgba(255, 209, 102, 0.9)',
  previewBad: 'rgba(255, 107, 129, 0.9)',
  orb: '#a8c6ff',
  orbIsolated: '#ffd166',
  orbShared: '#93a0c4',
  starlight: 'rgba(220, 230, 255, 0.6)',
};

export const lightPalette: Palette = {
  ...darkPalette,
  boardFill: 'rgba(60, 90, 200, 0.07)',
  boardEdge: 'rgba(40, 70, 180, 0.75)',
  pieceEdge: 'rgba(40, 70, 180, 0.45)',
  orb: '#3557d6',
  orbShared: '#7a86a8',
  starlight: 'rgba(40, 70, 180, 0.25)',
};

/** Deterministic tiny starfield (background flavor). */
const stars: { x: number; y: number; r: number; tw: number }[] = [];
{
  let s = 42;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    stars.push({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.1, tw: rnd() * Math.PI * 2 });
  }
}

const centroid = (verts: readonly Pt[]) => {
  let cx = 0;
  let cy = 0;
  for (const p of verts) {
    cx += N(p.x);
    cy += N(p.y);
  }
  return { x: cx / verts.length, y: cy / verts.length };
};

const piecePath = (
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  piece: EnginePiece,
  insetPx: number,
) => {
  const c = centroid(piece.verts);
  ctx.beginPath();
  piece.verts.forEach((p, i) => {
    const q = gridToCanvas(v, { x: N(p.x), y: N(p.y) });
    const cc = gridToCanvas(v, c);
    const dx = cc.x - q.x;
    const dy = cc.y - q.y;
    const d = Math.hypot(dx, dy) || 1;
    const x = q.x + (dx / d) * insetPx;
    const y = q.y + (dy / d) * insetPx;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
};

export interface RenderState {
  play: PlayState;
  assignment: Assignment;
  preview: DragPreview | null;
  /** ms timestamp of the last successful split (for the pop animation) */
  lastSplitAt: number;
  practice: boolean;
}

export const render = (
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  rs: RenderState,
  pal: Palette,
  now: number,
) => {
  const { play, assignment, preview } = rs;
  ctx.clearRect(0, 0, v.w, v.h);

  // starfield
  for (const st of stars) {
    const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now / 1600 + st.tw));
    ctx.globalAlpha = a;
    ctx.fillStyle = pal.starlight;
    ctx.beginPath();
    ctx.arc(st.x * v.w, st.y * v.h, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const uncut = play.cuts.length === 0;
  const splitAge = now - rs.lastSplitAt;
  const pop = splitAge < 320 ? (1 - splitAge / 320) * 7 : 0;
  const inset = uncut ? 0 : 4.5 + pop;

  // retired (dissolved) pieces: fading ghost outlines
  play.retired.forEach((piece) => {
    piecePath(ctx, v, piece, 2);
    ctx.strokeStyle = pal.orbIsolated;
    ctx.globalAlpha = 0.16;
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });

  // live pieces
  play.pieces.forEach((piece, i) => {
    piecePath(ctx, v, piece, inset);
    ctx.fillStyle = pal.pieceFill[i % pal.pieceFill.length];
    ctx.fill();
    ctx.strokeStyle = uncut ? pal.boardEdge : pal.pieceEdge;
    ctx.lineWidth = uncut ? 2.4 : 1.4;
    if (uncut) {
      ctx.shadowColor = pal.boardEdge;
      ctx.shadowBlur = 18;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  // committed cuts (behind orbs, above pieces)
  play.cuts.forEach((cut) => {
    const a = gridToCanvas(v, { x: N(cut.a.x), y: N(cut.a.y) });
    const b = gridToCanvas(v, { x: N(cut.b.x), y: N(cut.b.y) });
    ctx.strokeStyle = pal.cut;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // objects (moonlets)
  const scale = pxPerGrid(v);
  const entries = activeObjectEntries(play.level);
  entries.forEach(({ slot, pt: o }, i) => {
    const q = gridToCanvas(v, { x: N(o.x), y: N(o.y) });
    const r = OBJECT_RADIUS_PX * scale;
    const collected = play.collected[slot];
    const isolated = assignment.isolated[i];
    const breathing = 1 + 0.05 * Math.sin(now / 700 + i * 1.7);

    if (collected) {
      // collected moonlet: a quiet golden spark, space is free again
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = pal.orbIsolated;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pal.orbIsolated;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    // clearance ring while dragging (uncollected only)
    if (preview) {
      ctx.strokeStyle = 'rgba(255,107,129,0.25)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(q.x, q.y, CUT_OBJECT_CLEARANCE_PX * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const color = isolated ? pal.orbIsolated : assignment.objectPiece[i] >= 0 ? pal.orb : pal.orbShared;
    const grad = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.35, r * 0.1, q.x, q.y, r * breathing);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.shadowColor = color;
    ctx.shadowBlur = isolated ? 26 : 10;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r * breathing, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isolated) {
      ctx.strokeStyle = pal.orbIsolated;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r * breathing + 5 + Math.sin(now / 350) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  // drag preview
  if (preview && preview.chord) {
    const a = gridToCanvas(v, { x: N(preview.chord.a.x), y: N(preview.chord.a.y) });
    const b = gridToCanvas(v, { x: N(preview.chord.b.x), y: N(preview.chord.b.y) });
    ctx.strokeStyle = preview.wouldSplit ? pal.previewOk : pal.previewBad;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -(now / 30) % 16;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  } else if (preview) {
    const a = gridToCanvas(v, { x: N(preview.a.x), y: N(preview.a.y) });
    const b = gridToCanvas(v, { x: N(preview.b.x), y: N(preview.b.y) });
    ctx.strokeStyle = pal.previewBad;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
};
