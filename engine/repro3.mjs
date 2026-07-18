import { pureCircuits } from '@moonray/contract';
import {
  applyCut, assignObjects, claimedPieces, cross, len2, levelFromEntropies,
  newGame, seedIsUsable, activeObjectEntries,
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

const rnd = mulberry32(7);
let state, level;
for (let round = 0; round <= 79; round++) {
  const seed = usableSeed(rnd);
  level = levelOf(seed);
  state = newGame(level);
  const cuts = 1 + Math.floor(rnd() * 3);
  for (let c = 0; c < cuts; c++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const res = applyCut(state, gridPt(rnd), gridPt(rnd));
      if (res.ok) { state = res.state; break; }
    }
  }
}

console.log('cuts:', state.cuts.map(c => `(${c.a.x},${c.a.y})-(${c.b.x},${c.b.y})`));
console.log('countA', level.countA, 'countB', level.countB);
console.log('slot3 obj:', level.objects[3]);
const claimed = claimedPieces(state);
claimed.forEach((p, i) => {
  console.log(`piece ${i}: verts=${p.verts.map(v => `(${v.x},${v.y})`).join(' ')}`);
  console.log(`         sources=${p.sources.map(s => (s.isCut ? 'C' : 'E') + s.idx).join(',')}`);
});
const a = assignObjects(state);
console.log('slots', a.slots, 'objectPiece', a.objectPiece);

// distance of slot3 to each edge of its assigned piece
const obj = level.objects[3];
const pi = a.objectPiece[a.slots.indexOf(3)];
const piece = claimed[pi];
piece.verts.forEach((A, e) => {
  const B = piece.verts[(e + 1) % piece.verts.length];
  const c2 = cross(A, B, obj);
  const d = (Number(c2) >= 0 ? 1 : -1) * Math.sqrt(Number(c2) ** 2 / Number(len2(A, B)));
  console.log(`edge ${e} src=${(piece.sources[e].isCut ? 'C' : 'E') + piece.sources[e].idx} (${A.x},${A.y})->(${B.x},${B.y}) dist=${d.toFixed(1)}`);
});
