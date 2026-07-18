/**
 * The cut-splitting play state machine, with the collect/dissolve mechanic:
 * a piece that ends up holding exactly one moonlet dissolves — the moonlet is
 * collected and its piece RETIRES. Retired pieces are kept: the proof claims
 * retired pieces + surviving pieces, which together still tile both boards
 * exactly (every claimed piece is a disjoint union of cut-arrangement cells,
 * so the total can never exceed MAX_PIECES = 11).
 *
 * Pieces carry per-edge provenance (concatenated board edge | cut j), which
 * makes the circuit's edge hints free to extract. All functions are pure —
 * the caller (UI) keeps a history stack for undo/redo.
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
import { activeObjectEntries, objectActive, totalObjects, type Level } from './levelgen.js';

export interface EdgeSource {
  readonly isCut: boolean;
  /** concatenated board edge (A: 0..7, B: 8..14) | cut 0..2 */
  readonly idx: number;
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
  /** live (still-on-field) pieces. */
  readonly pieces: readonly EnginePiece[];
  /** dissolved pieces, in retirement order — claimed alongside live pieces. */
  readonly retired: readonly EnginePiece[];
  /** per level-object-slot (0..13): collected? (inactive slots stay false) */
  readonly collected: readonly boolean[];
}

export type CutRejection =
  | { kind: 'missesBoard' }
  | { kind: 'tooShort' }
  | { kind: 'noCutsLeft' }
  | { kind: 'tooCloseToObject'; objectSlot: number }
  | { kind: 'tooManyPieces' }
  | { kind: 'tooManyVerts' }
  | { kind: 'grazesCorner' };

export type CutResult =
  | {
      ok: true;
      state: PlayState;
      cut: Cut;
      /** pieces that dissolved because this cut isolated their moonlet */
      dissolved: EnginePiece[];
      /** level-object slots collected by this cut */
      collectedSlots: number[];
    }
  | { ok: false; reason: CutRejection };

export const newGame = (level: Level): PlayState => ({
  level,
  cuts: [],
  pieces: [
    {
      verts: level.boardA,
      sources: level.boardA.map((_, i) => ({ isCut: false, idx: i })),
    },
    {
      verts: level.boardB,
      sources: level.boardB.map((_, i) => ({ isCut: false, idx: 8 + i })),
    },
  ],
  retired: [],
  collected: level.objects.map(() => false),
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

/**
 * Guardrail: first UNCOLLECTED active moonlet slot within clearance of the
 * cut, or -1. Collected moonlets have left the field — their space is free.
 */
export const cutTooCloseToObject = (
  level: Level,
  c: Cut,
  collected: readonly boolean[] = [],
): number => {
  const clearance = BigInt(CUT_OBJECT_CLEARANCE_PX);
  for (const { slot, pt } of activeObjectEntries(level)) {
    if (collected[slot]) continue;
    const d = distToSegmentSq(c.a, c.b, pt);
    if (d.num < clearance * clearance * d.den) return slot;
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
  const den = d1 - d2;
  return {
    x: p.x + divRound((q.x - p.x) * d1, den),
    y: p.y + divRound((q.y - p.y) * d1, den),
  };
};

/** Cuts through (or within a few px of) a polygon vertex produce rounded
 * intersection points a pixel or two apart — a degenerate edge whose "line"
 * is numerically meaningless. Merge ring vertices closer than this. */
const MERGE_EPS2 = 36n; // 6px squared

const nearEq = (a: Pt, b: Pt): boolean => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= MERGE_EPS2;
};

const dedupeRing = (ring: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const v of ring) {
    if (out.length > 0 && nearEq(out[out.length - 1], v)) continue;
    out.push(v);
  }
  while (out.length > 1 && nearEq(out[0], out[out.length - 1])) out.pop();
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

/** Split one convex piece by the cut line. Returns 1 or 2 pieces.
 * Throws SourceTrackingError when the rounded geometry cannot be proven
 * (cut grazing a vertex) — the caller rejects the cut. */
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

/** Uncollected active moonlet slots strictly inside a piece. */
const inhabitants = (
  level: Level,
  collected: readonly boolean[],
  piece: EnginePiece,
): number[] => {
  const out: number[] = [];
  for (const { slot, pt } of activeObjectEntries(level)) {
    if (collected[slot]) continue;
    if (strictlyInsideConvex(piece.verts, pt)) out.push(slot);
  }
  return out;
};

/** Apply a drawn cut. Pure — returns a new state or a rejection. */
export const applyCut = (state: PlayState, rawA: Pt, rawB: Pt): CutResult => {
  if (state.cuts.length >= MAX_CUTS) return { ok: false, reason: { kind: 'noCutsLeft' } };
  const cut = normalizeCut(rawA, rawB);
  if (!cut) return { ok: false, reason: { kind: 'missesBoard' } };
  if (!axisSpanOk(cut)) return { ok: false, reason: { kind: 'tooShort' } };
  const closeSlot = cutTooCloseToObject(state.level, cut, state.collected);
  if (closeSlot >= 0) {
    return { ok: false, reason: { kind: 'tooCloseToObject', objectSlot: closeSlot } };
  }

  const cutIdx = state.cuts.length;
  const afterSplit: EnginePiece[] = [];
  let anySplit = false;
  try {
    for (const piece of state.pieces) {
      const { pieces, split } = splitPiece(piece, cut, cutIdx);
      afterSplit.push(...pieces);
      anySplit = anySplit || split;
    }
  } catch (err) {
    if (err instanceof SourceTrackingError) {
      return { ok: false, reason: { kind: 'grazesCorner' } };
    }
    throw err;
  }
  if (!anySplit) return { ok: false, reason: { kind: 'missesBoard' } };

  // collect/dissolve: pieces now holding exactly one moonlet retire
  const collected = [...state.collected];
  const collectedSlots: number[] = [];
  const dissolved: EnginePiece[] = [];
  const keep: EnginePiece[] = [];
  for (const piece of afterSplit) {
    const inside = inhabitants(state.level, state.collected, piece);
    if (inside.length === 1) {
      collected[inside[0]] = true;
      collectedSlots.push(inside[0]);
      dissolved.push(piece);
    } else {
      keep.push(piece);
    }
  }

  const retired = [...state.retired, ...dissolved];
  if (retired.length + keep.length > MAX_PIECES) {
    return { ok: false, reason: { kind: 'tooManyPieces' } };
  }
  if ([...retired, ...keep].some((p) => p.verts.length > MAX_PIECE_VERTS)) {
    return { ok: false, reason: { kind: 'tooManyVerts' } };
  }

  return {
    ok: true,
    cut,
    dissolved,
    collectedSlots,
    state: {
      level: state.level,
      cuts: [...state.cuts, cut],
      pieces: keep,
      retired,
      collected,
    },
  };
};

/** Preview of a cut without committing it (for the drag ghost). */
export const previewCut = (state: PlayState, rawA: Pt, rawB: Pt): CutResult =>
  applyCut(state, rawA, rawB);

/** All claimed pieces, retirement order first — the proof's piece list. */
export const claimedPieces = (state: PlayState): EnginePiece[] => [
  ...state.retired,
  ...state.pieces,
];

export interface Assignment {
  /** slot index (0..13) per active object, aligned with the arrays below. */
  readonly slots: readonly number[];
  /** claimed-piece index per active object (retired first, then live); -1 if none. */
  readonly objectPiece: readonly number[];
  /** true per active object iff collected or alone in its live piece. */
  readonly isolated: readonly boolean[];
  readonly isolatedCount: number;
  readonly totalObjects: number;
  readonly fullClear: boolean;
  readonly score: number;
}

/** Assign objects to claimed pieces and compute the live score (mirrors scoreFor). */
export const assignObjects = (state: PlayState): Assignment => {
  const entries = activeObjectEntries(state.level);
  const claimed = claimedPieces(state);
  const objectPiece = entries.map(({ pt }) => {
    for (let p = 0; p < claimed.length; p++) {
      if (strictlyInsideConvex(claimed[p].verts, pt)) return p;
    }
    return -1;
  });
  // isolation counts occupancy among ACTIVE objects across claimed pieces:
  // a collected moonlet sits alone in its retired piece by construction.
  const isolated = objectPiece.map(
    (p, i) => p >= 0 && objectPiece.every((q, j) => j === i || q !== p),
  );
  const isolatedCount = isolated.filter(Boolean).length;
  const total = totalObjects(state.level);
  const fullClear = isolatedCount === total;
  const bonus = fullClear ? 5 * (MAX_CUTS + 1 - state.cuts.length) : 0;
  return {
    slots: entries.map((e) => e.slot),
    objectPiece,
    isolated,
    isolatedCount,
    totalObjects: total,
    fullClear,
    score: 10 * isolatedCount + bonus,
  };
};

/** Is a given level-object slot active in this level? (re-export convenience) */
export { objectActive };
