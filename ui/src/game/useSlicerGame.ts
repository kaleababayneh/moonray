/**
 * Play-state hook: level + cuts + pieces with undo/redo history, live score,
 * and drag preview. All geometry runs in @moonray/engine; this hook only
 * manages React state.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  applyCut,
  assignObjects,
  type Assignment,
  type CutRejection,
  levelFromEntropy,
  newGame,
  normalizeCut,
  type PlayState,
  type Pt,
} from '@moonray/engine';
import { pureCircuits } from '@moonray/contract';

export interface DragPreview {
  a: Pt;
  b: Pt;
  /** normalized full chord, if the line is valid so far */
  chord: { a: Pt; b: Pt } | null;
  rejection: CutRejection | null;
  /** piece split flashes for tinting */
  wouldSplit: boolean;
}

export interface SlicerGame {
  seed: bigint;
  state: PlayState;
  assignment: Assignment;
  canUndo: boolean;
  canRedo: boolean;
  cutsLeft: number;
  preview: DragPreview | null;
  lastRejection: CutRejection | null;
  splitFlash: number; // increments on every successful cut (for animations)
  beginDrag(p: Pt): void;
  moveDrag(p: Pt): void;
  endDrag(p: Pt): boolean;
  cancelDrag(): void;
  undo(): void;
  redo(): void;
  reset(): void;
}

export const useSlicerGame = (seed: bigint): SlicerGame => {
  const initial = useMemo(() => {
    const entropy = pureCircuits.levelEntropy(seed);
    return newGame(levelFromEntropy(entropy));
  }, [seed]);

  const [history, setHistory] = useState<PlayState[]>([initial]);
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [lastRejection, setLastRejection] = useState<CutRejection | null>(null);
  const [splitFlash, setSplitFlash] = useState(0);
  const dragStart = useRef<Pt | null>(null);

  // seed change -> fresh game
  const seedRef = useRef(seed);
  if (seedRef.current !== seed) {
    seedRef.current = seed;
    setHistory([initial]);
    setCursor(0);
    setPreview(null);
    setLastRejection(null);
  }

  const state = history[Math.min(cursor, history.length - 1)];
  const assignment = useMemo(() => assignObjects(state), [state]);

  const computePreview = useCallback(
    (a: Pt, b: Pt): DragPreview => {
      const dx = Number(b.x - a.x);
      const dy = Number(b.y - a.y);
      if (dx * dx + dy * dy < 40 * 40) {
        return { a, b, chord: null, rejection: null, wouldSplit: false };
      }
      const res = applyCut(state, a, b);
      if (res.ok) {
        return { a, b, chord: res.cut, rejection: null, wouldSplit: true };
      }
      const chord = normalizeCut(a, b);
      return { a, b, chord, rejection: res.reason, wouldSplit: false };
    },
    [state],
  );

  const beginDrag = useCallback((p: Pt) => {
    dragStart.current = p;
    setLastRejection(null);
    setPreview({ a: p, b: p, chord: null, rejection: null, wouldSplit: false });
  }, []);

  const moveDrag = useCallback(
    (p: Pt) => {
      const a = dragStart.current;
      if (!a) return;
      setPreview(computePreview(a, p));
    },
    [computePreview],
  );

  const endDrag = useCallback(
    (p: Pt): boolean => {
      const a = dragStart.current;
      dragStart.current = null;
      setPreview(null);
      if (!a) return false;
      const dx = Number(p.x - a.x);
      const dy = Number(p.y - a.y);
      if (dx * dx + dy * dy < 40 * 40) return false; // click, not a cut
      const res = applyCut(state, a, p);
      if (!res.ok) {
        setLastRejection(res.reason);
        return false;
      }
      const next = history.slice(0, cursor + 1);
      next.push(res.state);
      setHistory(next);
      setCursor(next.length - 1);
      setLastRejection(null);
      setSplitFlash((n) => n + 1);
      return true;
    },
    [state, history, cursor],
  );

  const cancelDrag = useCallback(() => {
    dragStart.current = null;
    setPreview(null);
  }, []);

  const undo = useCallback(() => setCursor((c) => Math.max(0, c - 1)), []);
  const redo = useCallback(
    () => setCursor((c) => Math.min(history.length - 1, c + 1)),
    [history.length],
  );
  const reset = useCallback(() => {
    setHistory([initial]);
    setCursor(0);
    setPreview(null);
    setLastRejection(null);
  }, [initial]);

  return {
    seed,
    state,
    assignment,
    canUndo: cursor > 0,
    canRedo: cursor < history.length - 1,
    cutsLeft: 3 - state.cuts.length,
    preview,
    lastRejection,
    splitFlash,
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    undo,
    redo,
    reset,
  };
};

export const rejectionText = (r: CutRejection): string => {
  switch (r.kind) {
    case 'missesBoard':
      return 'That slice misses the board — drag a line across it.';
    case 'tooShort':
      return 'Slice too short — drag a longer line.';
    case 'noCutsLeft':
      return 'No cuts left. Undo one, or submit your run.';
    case 'tooCloseToObject':
      return 'Too close to a moonlet — leave it some breathing room (that keeps the proof honest).';
    case 'tooManyPieces':
      return 'That would shatter the board into too many pieces (max 8).';
    case 'tooManyVerts':
      return 'That corner is already too intricate for the circuit — try a different angle.';
  }
};
