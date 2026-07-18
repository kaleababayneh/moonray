import { pureCircuits } from '@moonray/contract';
import {
  applyCut, assignObjects, buildRunBundle, claimedPieces, cross, len2,
  levelFromEntropies, newGame, seedIsUsable,
} from './dist/index.js';

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const FIELD_PRIME = 52435875175126190479447740508185965837690552500527637822603658699938581184513n;
const randomSeed = (rnd) => { let v = 0n; for (let i = 0; i < 8; i++) v = (v << 32n) | BigInt(Math.floor(rnd() * 0x100000000)); return v % FIELD_PRIME; };
const usableSeed = (rnd) => { for (;;) { const s = randomSeed(rnd); if (seedIsUsable(pureCircuits.levelEntropy(s)) && seedIsUsable(pureCircuits.levelEntropy2(s))) return s; } };
const gridPt = (rnd) => ({ x: BigInt(200 + Math.floor(rnd() * 3700)), y: BigInt(200 + Math.floor(rnd() * 3700)) });
const levelOf = (seed) => levelFromEntropies(pureCircuits.levelEntropy(seed), pureCircuits.levelEntropy2(seed));
const tryRandomCut = (state, rnd) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = applyCut(state, gridPt(rnd), gridPt(rnd));
    if (res.ok) return res.state;
  }
  return null;
};
const verify = (state, seed) => {
  const e1 = pureCircuits.levelEntropy(seed), e2 = pureCircuits.levelEntropy2(seed);
  const b = buildRunBundle(state, e1, e2, 12345n);
  const level = pureCircuits.buildLevelFrom(seed, b.seedLimbs, b.seedHi, b.seedLimbs2, b.seedHi2);
  return pureCircuits.verifyRunPure(level, b.cuts, b.cutsUsed, b.pieces, b.pieceCount, b.edgeHints, b.objectHints);
};

const rnd = mulberry32(7);
for (let round = 0; round < 100; round++) {
  const seed = usableSeed(rnd);
  let state = newGame(levelOf(seed));
  const cuts = 1 + Math.floor(rnd() * 3);
  for (let c = 0; c < cuts; c++) {
    const next = tryRandomCut(state, rnd);
    if (next) state = next;
  }
  try {
    verify(state, seed);
  } catch (err) {
    console.log('FAIL round', round, err.message);
    const a = assignObjects(state);
    const claimed = claimedPieces(state);
    a.slots.forEach((slot, i) => {
      const obj = state.level.objects[slot];
      const pi = a.objectPiece[i];
      const piece = claimed[pi];
      if (!piece) { console.log('slot', slot, 'NO PIECE', pi); return; }
      let worst = null;
      const v = piece.verts;
      for (let e = 0; e < v.length; e++) {
        const A = v[e], B = v[(e + 1) % v.length];
        const c2 = cross(A, B, obj);
        const l2 = len2(A, B);
        const d = (Number(c2) >= 0 ? 1 : -1) * Math.sqrt(Number(c2) * Number(c2) / Number(l2));
        if (worst === null || d < worst.d) worst = { d, e, src: piece.sources[e] };
      }
      if (worst.d < 46) {
        console.log('slot', slot, 'collected', state.collected[slot], 'pieceIdx', pi,
          'retired?', pi < state.retired.length, 'worstDist', worst.d.toFixed(1),
          'edgeSrc', JSON.stringify(worst.src));
      }
    });
    console.log('cutsUsed', state.cuts.length, 'retired', state.retired.length, 'live', state.pieces.length);
    process.exit(0);
  }
}
console.log('no failure?!');
