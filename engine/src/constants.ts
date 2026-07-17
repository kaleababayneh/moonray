/**
 * Single source of numeric truth for the game. Mirrored as a header comment
 * in contract/src/slicer.compact — keep them in lockstep.
 */

/** Board space is [0, GRID)^2; circuit coords are Uint<12>. */
export const GRID = 4096n;

export const BOARD_VERTS = 8;
export const MAX_CUTS = 3;
export const MAX_PIECES = 8;
export const MAX_PIECE_VERTS = 11;
export const MAX_OBJECTS = 6;

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

/** Octagon template anchors (jitter [0,256) is added to each coordinate). */
export const BOARD_TPL: ReadonlyArray<readonly [bigint, bigint]> = [
  [3444n, 2551n],
  [2551n, 3444n],
  [1289n, 3444n],
  [396n, 2551n],
  [396n, 1289n],
  [1289n, 396n],
  [2551n, 396n],
  [3444n, 1289n],
];

/** Object cell anchors, 3x2 grid spaced 768 (jitter [0,256) added). */
export const CELL_TPL: ReadonlyArray<readonly [bigint, bigint]> = [
  [1152n, 1536n],
  [1920n, 1536n],
  [2688n, 1536n],
  [1152n, 2304n],
  [1920n, 2304n],
  [2688n, 2304n],
];

/** Gameplay guardrail: cuts may not pass within this distance of an object
 * center (keeps every honest run comfortably inside TOLIN_PX2 = 45px). */
export const CUT_OBJECT_CLEARANCE_PX = 64;

/** Visual radius of an object disc, in grid units (UI + guardrail display). */
export const OBJECT_RADIUS_PX = 40;

/** Pieces with exact double-area below this are not split off (rounding slivers). */
export const MIN_SPLIT_DOUBLE_AREA = 1024n;

/** Badge tiers. */
export const TIERS = [
  { tier: 1, name: 'Bronze', threshold: 20 },
  { tier: 2, name: 'Silver', threshold: 40 },
  { tier: 3, name: 'Gold', threshold: 50 },
] as const;
