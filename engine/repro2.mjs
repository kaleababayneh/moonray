import { pureCircuits } from '@moonray/contract';
import {
  applyCut, assignObjects, cutTooCloseToObject, levelFromEntropies, newGame,
  seedIsUsable, activeObjectEntries,
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
for (let round = 0; round < 80; round++) {
  const seed = usableSeed(rnd);
  const level = levelOf(seed);
  let state = newGame(level);
  const cuts = 1 + Math.floor(rnd() * 3);
  for (let c = 0; c < cuts; c++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const a = gridPt(rnd), b = gridPt(rnd);
      const res = applyCut(state, a, b);
      if (res.ok) {
        if (round === 79) {
          const chord = res.cut;
          // measure every active object's distance to the chord
          for (const { slot, pt } of activeObjectEntries(level)) {
            const dx = Number(chord.b.x - chord.a.x), dy = Number(chord.b.y - chord.a.y);
            const c2 = dx * Number(pt.y - chord.a.y) - dy * Number(pt.x - chord.a.x);
            const d = Math.abs(c2) / Math.hypot(dx, dy);
            if (d < 90) console.log('  post-accept: slot', slot, 'dist to chord', d.toFixed(1));
          }
          console.log('  guard says:', cutTooCloseToObject(level, chord, state.collected));
          console.log('  chord', `(${chord.a.x},${chord.a.y})-(${chord.b.x},${chord.b.y})`);
          console.log('  raw drag', `(${a.x},${a.y})-(${b.x},${b.y})`);
        }
        state = res.state;
        break;
      }
    }
  }
}
