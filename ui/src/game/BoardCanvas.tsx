/**
 * The play canvas: pointer drag-to-cut with live preview, rAF-driven
 * animations (orb glow, split pop, marching-ants preview).
 */

import { useEffect, useRef } from 'react';
import type { SlicerGame } from './useSlicerGame';
import { canvasToGrid, darkPalette, lightPalette, render, type Viewport } from './render';

interface Props {
  game: SlicerGame;
  practice: boolean;
  theme: 'dark' | 'light';
}

export const BoardCanvas = ({ game, practice, theme }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const lastSplitAt = useRef(0);
  const prevFlash = useRef(game.splitFlash);

  if (game.splitFlash !== prevFlash.current) {
    prevFlash.current = game.splitFlash;
    lastSplitAt.current = performance.now();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v: Viewport = { w: rect.width, h: rect.height, pad: 14 };
      const g = gameRef.current;
      render(
        ctx,
        v,
        {
          play: g.state,
          assignment: g.assignment,
          preview: g.preview,
          lastSplitAt: lastSplitAt.current,
          practice,
        },
        theme === 'dark' ? darkPalette : lightPalette,
        now,
      );
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [practice, theme]);

  const toGrid = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const v: Viewport = { w: rect.width, h: rect.height, pad: 14 };
    return canvasToGrid(v, e.clientX - rect.left, e.clientY - rect.top);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ aspectRatio: '1 / 1' }}
      aria-label="Slicer board. Drag across the board to cut it."
      role="img"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        gameRef.current.beginDrag(toGrid(e));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) gameRef.current.moveDrag(toGrid(e));
      }}
      onPointerUp={(e) => {
        gameRef.current.endDrag(toGrid(e));
      }}
      onPointerCancel={() => gameRef.current.cancelDrag()}
    />
  );
};
