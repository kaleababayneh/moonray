/**
 * Single source of numeric truth for the game. Mirrored as a header comment
 * in contract/src/slicer.compact — keep them in lockstep.
 */

/** Board space is [0, GRID)^2; circuit coords are Uint<12>. */
export const GRID = 4096n;

export const BOARD_A_VERTS = 8;
export const BOARD_B_VERTS = 7;
/** Concatenated board edge count (A: 0..7, B: 8..14) for edge-source hints. */
export const BOARD_EDGES = 15;
export const MAX_CUTS = 3;
export const MAX_PIECES = 11;
export const MAX_PIECE_VERTS = 11;
export const MAX_OBJECTS = 14;
export const OBJECTS_PER_BOARD = 7;

/** Colinearity: piece vertices must sit within 2px of their source line. */
export const TOLC_PX2 = 4n;
/** Containment: objects must sit >= 45px inside every edge line of their piece. */
export const TOLIN_PX2 = 2025n;
/** Tiling slack on the 2*area shoelace sums. */
export const AREA_TOL = 32768n;
/** Cuts must span at least this much on some axis. */
export const MIN_CUT_AXIS = 512n;
/** Unique limb decomposition bound: hi <= 114 (see circuit header). */
export const HI_MAX = 114n;

/** BLS12-381 scalar field modulus (Compact's Field prime). */
export const FIELD_PRIME =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** Board A: lopsided convex octagon anchors. Final coord = anchor +
 * j7(vertex limb) + j7(board-A center limb) — plates drift daily. */
export const BOARD_A_TPL: ReadonlyArray<readonly [bigint, bigint]> = [
  [241n, 2475n],
  [609n, 2086n],
  [1239n, 2044n],
  [1683n, 2382n],
  [1956n, 3231n],
  [1430n, 3751n],
  [584n, 3788n],
  [94n, 3433n],
];

/** Board B: lopsided convex heptagon anchors (same jitter scheme as A). */
export const BOARD_B_TPL: ReadonlyArray<readonly [bigint, bigint]> = [
  [2728n, 120n],
  [3458n, 829n],
  [3561n, 1412n],
  [3227n, 1859n],
  [2686n, 1948n],
  [1788n, 1534n],
  [1916n, 602n],
];

/** Object cell anchors for board A (center + spread 6-ring at 505). */
export const CELL_A_TPL: ReadonlyArray<readonly [bigint, bigint]> = [
  [962n, 2752n],
  [1467n, 2752n],
  [710n, 3189n],
  [709n, 2315n],
  [1214n, 3189n],
  [457n, 2752n],
  [1214n, 2315n],
];

/** Object cell anchors for board B (center + spread 6-ring at 490). */
export const CELL_B_TPL: ReadonlyArray<readonly [bigint, bigint]> = [
  [2822n, 1202n],
  [3246n, 1447n],
  [2398n, 1447n],
  [2822n, 712n],
  [2822n, 1692n],
  [2398n, 957n],
  [3246n, 957n],
];

/** Gameplay guardrail: cuts may not pass within this distance of an object
 * center (keeps every honest run comfortably inside TOLIN_PX2 = 45px). */
export const CUT_OBJECT_CLEARANCE_PX = 82;

/** Visual radius of an object disc, in grid units (UI + guardrail display). */
export const OBJECT_RADIUS_PX = 57;

/** Pieces with exact double-area below this are not split off (rounding slivers). */
export const MIN_SPLIT_DOUBLE_AREA = 1024n;

/** Badge tiers. */
export const TIERS = [
  { tier: 1, name: 'Bronze', threshold: 40 },
  { tier: 2, name: 'Silver', threshold: 70 },
  { tier: 3, name: 'Gold', threshold: 85 },
] as const;
