/** Pastel identicon derived from a nullifier — anonymous but recognizable. */

import { useMemo } from 'react';

export const Identicon = ({ value, size = 26 }: { value: bigint; size?: number }) => {
  const cells = useMemo(() => {
    // 5x5 symmetric grid from the nullifier bits
    const bits: boolean[] = [];
    let v = value;
    for (let i = 0; i < 15; i++) {
      bits.push((v & 1n) === 1n);
      v >>= 1n;
    }
    const hue = Number((value >> 16n) % 360n);
    const grid: boolean[][] = [];
    for (let r = 0; r < 5; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < 5; c++) {
        const idx = r * 3 + Math.min(c, 4 - c);
        row.push(bits[idx]);
      }
      grid.push(row);
    }
    return { grid, hue };
  }, [value]);

  const cell = size / 5;
  return (
    <svg
      className="identicon"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ background: `hsl(${cells.hue} 45% 16%)`, borderRadius: 8 }}
      aria-hidden
    >
      {cells.grid.flatMap((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect
              key={`${r}-${c}`}
              x={c * cell}
              y={r * cell}
              width={cell}
              height={cell}
              fill={`hsl(${cells.hue} 75% 72%)`}
              rx={1.5}
            />
          ) : null,
        ),
      )}
    </svg>
  );
};

export const shortNul = (nul: bigint): string => {
  const hex = nul.toString(16).padStart(64, '0');
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
};
