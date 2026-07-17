/**
 * The cut-splitting play state machine.
 *
 * Pieces carry per-edge provenance (board edge i | cut j), which makes the
 * circuit's edge hints free to extract. All functions are pure — the caller
 * (UI) keeps a history stack for undo/redo.
 */

import {
  CUT_OBJECT_CLEARANCE_PX,
  GRID,
  MAX_CUTS,
  MAX_PIECES,
  MAX_PIECE_VERTS,
  MIN_CUT_AXIS,
  MIN_SPLIT_DOUBLE_AREA,
  TOLC_PX2,
} from './constants.js';
import {
  clipLineToRect,
  cross,
  distToSegmentSq,
  divRound,
  doubleArea,
  len2,
  type Pt,
  ptEq,
  strictlyInsideConvex,
} from './geometry.js';
import { activeObjects, type Level } from './levelgen.js';

export interface EdgeSource {
  readonly isCut: boolean;
  readonly idx: number; // board edge 0..7 | cut 0..2
}

export interface EnginePiece {
  /** CCW vertices (3..MAX_PIECE_VERTS). */
  readonly verts: readonly Pt[];
  /** sources[i] = source line of the edge verts[i] -> verts[(i+1) % n]. */
  readonly sources: readonly EdgeSource[];
}

export interface Cut {
  readonly a: Pt;
  readonly b: Pt;
}

export interface PlayState {
  readonly level: Level;
  readonly cuts: readonly Cut[];
  readonly pieces: readonly EnginePiece[];
}

export type CutRejection =
  | { kind: 'missesBoard' }
  | { kind: 'tooShort' }
  | { kind: 'noCutsLeft' }
  | { kind: 'tooCloseToObject'; objectIndex: number }
  | { kind: 'tooManyPieces' }
  | { kind: 'tooManyVerts' };

export type CutResult =
  | { ok: true; state: PlayState; cut: Cut }
  | { ok: false; reason: CutRejection };

export const newGame = (level: Level): PlayState => ({
  level,
  cuts: [],
  pieces: [
    {
      verts: level.board,
      sources: level.board.map((_, i) => ({ isCut: false, idx: i })),
    },
  ],
});

/**
 * Normalize a drawn line (two grid points) into a full-crossing lattice chord
 * across the grid square. Returns null if degenerate.
 */
export const normalizeCut = (rawA: Pt, rawB: Pt): Cut | null => {
  const clipped = clipLineToRect(rawA, rawB, GRID - 1n);
  if (!clipped) return null;
  return { a: clipped[0], b: clipped[1] };
};

const axisSpanOk = (c: Cut): boolean => {
  const dx = c.b.x > c.a.x ? c.b.x - c.a.x : c.a.x - c.b.x;
  const dy = c.b.y > c.a.y ? c.b.y - c.a.y : c.a.y - c.b.y;
  return dx >= MIN_CUT_AXIS || dy >= MIN_CUT_AXIS;
};

/** Distance guardrail index: first object center within clearance of the cut, or -1. */
export const cutTooCloseToObject = (level: Level, c: Cut): number => {
  const clearance = BigInt(CUT_OBJECT_CLEARANCE_PX);
  const objs = activeObjects(level);
  for (let i = 0; i < objs.length; i++) {
    const d = distToSegmentSq(c.a, c.b, objs[i]);
    if (d.num < clearance * clearance * d.den) return i;
  }
  return -1;
};

const sideOf = (c: Cut, v: Pt): number => {
  const s = cross(c.a, c.b, v);
  return s > 0n ? 1 : s < 0n ? -1 : 0;
};

const straddles = (piece: EnginePiece, c: Cut): boolean => {
  let hasPos = false;
  let hasNeg = false;
  for (const v of piece.verts) {
    const s = sideOf(c, v);
    if (s > 0) hasPos = true;
    else if (s < 0) hasNeg = true;
  }
  return hasPos && hasNeg;
};

/** Exact rational intersection of segment (p,q) with the line (c.a, c.b), rounded. */
const intersect = (p: Pt, q: Pt, c: Cut): Pt => {
  const d1 = cross(c.a, c.b, p);
  const d2 = cross(c.a, c.b, q);
  // d1, d2 have strictly opposite signs; t = d1 / (d1 - d2) is in (0,1).
  const den = d1 - d2;
  return {
    x: p.x + divRound((q.x - p.x) * d1, den),
    y: p.y + divRound((q.y - p.y) * d1, den),
  };
};

const dedupeRing = (ring: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const v of ring) {
    if (out.length > 0 && ptEq(out[out.length - 1], v)) continue;
    out.push(v);
  }
  while (out.length > 1 && ptEq(out[0], out[out.length - 1])) out.pop();
  return out;
};

/** Both endpoints within the circuit's colinearity tolerance of line (s,t)? */
const edgeOnLine = (s: Pt, t: Pt, a: Pt, b: Pt): boolean => {
  const l2 = len2(s, t);
  const ca = cross(s, t, a);
  const cb = cross(s, t, b);
  return ca * ca <= TOLC_PX2 * l2 && cb * cb <= TOLC_PX2 * l2;
};

export class SourceTrackingError extends Error {}

/**
 * Assign a source to every edge of a freshly built ring: the cut line first
 * (new edges), then the parent piece's original edge lines. Uses exactly the
 * circuit's 2px tolerance, so a successful assignment is provable colinearity.
 */
const rebuildSources = (
  ring: readonly Pt[],
  parent: EnginePiece,
  c: Cut,
  cutIdx: number,
): EdgeSource[] => {
  const n = ring.length;
  const out: EdgeSource[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (edgeOnLine(c.a, c.b, a, b)) {
      out.push({ isCut: true, idx: cutIdx });
      continue;
    }
    let found: EdgeSource | null = null;
    for (let e = 0; e < parent.verts.length && !found; e++) {
      const p = parent.verts[e];
      const q = parent.verts[(e + 1) % parent.verts.length];
      if (edgeOnLine(p, q, a, b)) found = parent.sources[e];
    }
    if (!found) throw new SourceTrackingError(`no source line for edge ${i}`);
    out.push(found);
  }
  return out;
};

/**
 * Split one convex piece by the cut line. Returns 1 or 2 pieces.
 * cutIdx is the index this cut will occupy in state.cuts.
 */
const splitPiece = (
  piece: EnginePiece,
  c: Cut,
  cutIdx: number,
): { pieces: EnginePiece[]; split: boolean } => {
  if (!straddles(piece, c)) return { pieces: [piece], split: false };

  const n = piece.verts.length;
  const leftV: Pt[] = [];
  const rightV: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const v = piece.verts[i];
    const w = piece.verts[(i + 1) % n];
    const s = sideOf(c, v);
    const t = sideOf(c, w);
    if (s >= 0) leftV.push(v);
    if (s <= 0) rightV.push(v);
    if ((s > 0 && t < 0) || (s < 0 && t > 0)) {
      const x = intersect(v, w, c);
      leftV.push(x);
      rightV.push(x);
    }
  }

  const build = (ring: Pt[]): EnginePiece | null => {
    const cleaned = dedupeRing(ring);
    if (cleaned.length < 3) return null;
    if (doubleArea(cleaned) < MIN_SPLIT_DOUBLE_AREA) return null;
    return { verts: cleaned, sources: rebuildSources(cleaned, piece, c, cutIdx) };
  };

  const left = build(leftV);
  const right = build(rightV);
  if (!left || !right) return { pieces: [piece], split: false }; // sliver guard
  return { pieces: [left, right], split: true };
};

/** Apply a drawn cut. Pure — returns a new state or a rejection. */
export const applyCut = (state: PlayState, rawA: Pt, rawB: Pt): CutResult => {
  if (state.cuts.length >= MAX_CUTS) return { ok: false, reason: { kind: 'noCutsLeft' } };
  const cut = normalizeCut(rawA, rawB);
  if (!cut) return { ok: false, reason: { kind: 'missesBoard' } };
  if (!axisSpanOk(cut)) return { ok: false, reason: { kind: 'tooShort' } };
  const closeObj = cutTooCloseToObject(state.level, cut);
  if (closeObj >= 0) {
    return { ok: false, reason: { kind: 'tooCloseToObject', objectIndex: closeObj } };
  }

  const cutIdx = state.cuts.length;
  const nextPieces: EnginePiece[] = [];
  let anySplit = false;
  for (const piece of state.pieces) {
    const { pieces, split } = splitPiece(piece, cut, cutIdx);
    nextPieces.push(...pieces);
    anySplit = anySplit || split;
  }
  if (!anySplit) return { ok: false, reason: { kind: 'missesBoard' } };
  if (nextPieces.length > MAX_PIECES) return { ok: false, reason: { kind: 'tooManyPieces' } };
  if (nextPieces.some((p) => p.verts.length > MAX_PIECE_VERTS)) {
    return { ok: false, reason: { kind: 'tooManyVerts' } };
  }

  return {
    ok: true,
    cut,
    state: { level: state.level, cuts: [...state.cuts, cut], pieces: nextPieces },
  };
};

/** Preview of a cut without committing it (for the drag ghost). */
export const previewCut = (state: PlayState, rawA: Pt, rawB: Pt): CutResult =>
  applyCut(state, rawA, rawB);

export interface Assignment {
  /** piece index per active object, or -1 if not strictly inside any piece. */
  readonly objectPiece: readonly number[];
  /** true per active object iff alone in its piece. */
  readonly isolated: readonly boolean[];
  readonly isolatedCount: number;
  readonly fullClear: boolean;
  readonly score: number;
}

/** Assign objects to pieces and compute the live score (mirrors scoreFor). */
export const assignObjects = (state: PlayState): Assignment => {
  const objs = activeObjects(state.level);
  const objectPiece = objs.map((o) => {
    for (let p = 0; p < state.pieces.length; p++) {
      if (strictlyInsideConvex(state.pieces[p].verts, o)) return p;
    }
    return -1;
  });
  const isolated = objectPiece.map(
    (p, i) => p >= 0 && objectPiece.every((q, j) => j === i || q !== p),
  );
  const isolatedCount = isolated.filter(Boolean).length;
  const fullClear = isolatedCount === objs.length;
  const cutsUsed = state.cuts.length;
  const bonus = fullClear ? 5 * (4 - cutsUsed) : 0;
  return {
    objectPiece,
    isolated,
    isolatedCount,
    fullClear,
    score: 10 * isolatedCount + bonus,
  };
};
