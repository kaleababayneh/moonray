/**
 * Exact BigInt lattice geometry, mirroring the circuit's P/N decomposition.
 * Everything here is deterministic and side-effect free.
 */

export interface Pt {
  readonly x: bigint;
  readonly y: bigint;
}

export const pt = (x: bigint | number, y: bigint | number): Pt => ({
  x: BigInt(Math.round(Number(x))),
  y: BigInt(Math.round(Number(y))),
});

export const ptEq = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/** Signed cross product (B-A) x (C-A); positive = C strictly left of A->B. */
export const cross = (a: Pt, b: Pt, c: Pt): bigint =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** The circuit's P/N split of the same cross product (both non-negative). */
export const crossPN = (a: Pt, b: Pt, c: Pt): { p: bigint; n: bigint } => ({
  p: b.x * c.y + b.y * a.x + a.y * c.x,
  n: b.x * a.y + a.x * c.y + b.y * c.x,
});

export const len2 = (a: Pt, b: Pt): bigint => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
};

/** Circuit predicate: dist(v, line st)^2 <= tolPx2 (normalized). */
export const nearLine = (s: Pt, t: Pt, v: Pt, tolPx2: bigint): boolean => {
  const c = cross(s, t, v);
  return c * c <= tolPx2 * len2(s, t);
};

/** Circuit predicate: v strictly left of s->t by more than sqrt(tolPx2) px. */
export const farInside = (s: Pt, t: Pt, v: Pt, tolPx2: bigint): boolean => {
  const c = cross(s, t, v);
  return c > 0n && c * c > tolPx2 * len2(s, t);
};

/** Twice the signed area of a polygon (positive = CCW). */
export const doubleArea = (verts: readonly Pt[]): bigint => {
  let acc = 0n;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    acc += a.x * b.y - a.y * b.x;
  }
  return acc;
};

/** Exact strict containment in a CCW convex polygon. */
export const strictlyInsideConvex = (verts: readonly Pt[], v: Pt): boolean => {
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (cross(a, b, v) <= 0n) return false;
  }
  return true;
};

/** Containment with the circuit's provability margin (TOLIN). */
export const provablyInsideConvex = (verts: readonly Pt[], v: Pt, tolPx2: bigint): boolean => {
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (!farInside(a, b, v, tolPx2)) return false;
  }
  return true;
};

/** Round num/den to the nearest integer (den may be negative; halves away from 0). */
export const divRound = (num: bigint, den: bigint): bigint => {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (num >= 0n) return (2n * num + den) / (2n * den);
  return -((2n * -num + den) / (2n * den));
};

/** Squared distance from point v to the infinite line through (a, b), times |ab|^2.
 * Returned as { num, den } so callers can compare without floats. */
export const distToLineSq = (a: Pt, b: Pt, v: Pt): { num: bigint; den: bigint } => {
  const c = cross(a, b, v);
  return { num: c * c, den: len2(a, b) };
};

/** Squared distance from v to the SEGMENT (a, b), exact rational {num, den}. */
export const distToSegmentSq = (a: Pt, b: Pt, v: Pt): { num: bigint; den: bigint } => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const dot = (v.x - a.x) * abx + (v.y - a.y) * aby;
  const l2 = abx * abx + aby * aby;
  if (l2 === 0n) {
    const dx = v.x - a.x;
    const dy = v.y - a.y;
    return { num: dx * dx + dy * dy, den: 1n };
  }
  if (dot <= 0n) {
    const dx = v.x - a.x;
    const dy = v.y - a.y;
    return { num: dx * dx + dy * dy, den: 1n };
  }
  if (dot >= l2) {
    const dx = v.x - b.x;
    const dy = v.y - b.y;
    return { num: dx * dx + dy * dy, den: 1n };
  }
  const c = cross(a, b, v);
  return { num: c * c, den: l2 };
};

/**
 * Clip the infinite line through (a, b) to the axis-aligned rect
 * [0, max] x [0, max], returning the two boundary intersection points
 * rounded to the lattice, or null if the line misses the rect.
 * The result is ordered in the direction a -> b.
 */
export const clipLineToRect = (a: Pt, b: Pt, max: bigint): [Pt, Pt] | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0n && dy === 0n) return null;

  // Collect parameter values t (rational num/den, along a + t*(b-a)) where the
  // line crosses each rect boundary, then keep the [enter, exit] span.
  // Use rational comparisons throughout.
  type Rat = { num: bigint; den: bigint }; // den > 0
  const rats: Rat[] = [];
  const push = (num: bigint, den: bigint) => {
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    rats.push({ num, den });
  };
  if (dx !== 0n) {
    push(0n - a.x, dx); // x = 0
    push(max - a.x, dx); // x = max
  }
  if (dy !== 0n) {
    push(0n - a.y, dy); // y = 0
    push(max - a.y, dy); // y = max
  }
  const lt = (r: Rat, s: Rat) => r.num * s.den < s.num * r.den;
  rats.sort((r, s) => (lt(r, s) ? -1 : lt(s, r) ? 1 : 0));

  // Evaluate candidate span: for a line (not segment) the rect intersection is
  // between the 2nd and 3rd sorted crossing when 4 crossings exist, else the
  // middle span. Compute points for all middle candidates and validate.
  const evalAt = (r: Rat): Pt => ({
    x: a.x + divRound(dx * r.num, r.den),
    y: a.y + divRound(dy * r.num, r.den),
  });
  const inRect = (p: Pt) => p.x >= 0n && p.x <= max && p.y >= 0n && p.y <= max;
  const clamp = (p: Pt): Pt => ({
    x: p.x < 0n ? 0n : p.x > max ? max : p.x,
    y: p.y < 0n ? 0n : p.y > max ? max : p.y,
  });

  let lo: Rat;
  let hi: Rat;
  if (rats.length === 2) {
    [lo, hi] = rats as [Rat, Rat];
  } else {
    [, lo, hi] = rats as [Rat, Rat, Rat, Rat];
  }
  if (!lt(lo, hi)) return null;
  const p1 = clamp(evalAt(lo));
  const p2 = clamp(evalAt(hi));
  if (!inRect(p1) || !inRect(p2) || ptEq(p1, p2)) return null;
  // Midpoint must be inside the rect too (guards corner-miss cases).
  const mid: Pt = {
    x: divRound(p1.x + p2.x, 2n),
    y: divRound(p1.y + p2.y, 2n),
  };
  if (!inRect(mid)) return null;
  return [p1, p2];
};
