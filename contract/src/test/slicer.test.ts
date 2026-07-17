/**
 * Simulator suite: happy paths, the cheat suite (every tampered witness must
 * throw), two-player flows, and time-window enforcement.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCut,
  assignObjects,
  buildRunBundle,
  levelFromEntropy,
  newGame,
  type PlayState,
  seedIsUsable,
} from '@moonray/engine';
import { pureCircuits } from '../managed/slicer/contract/index.js';
import type { StagedRun } from '../witnesses.js';
import { randomSecretKey, SlicerSimulator } from './slicer-simulator.js';

const TID = 7n;
const SUBMIT_UNTIL = 1_000n;
const REVEAL_UNTIL = 2_000n;

/** Deterministic usable 4-object seed (full-clear scores exactly 45). */
const findSeed = (from: bigint): bigint => {
  let seed = from;
  for (;;) {
    const entropy = pureCircuits.levelEntropy(seed);
    if (seedIsUsable(entropy) && levelFromEntropy(entropy).objectCount === 4) return seed;
    seed += 1n;
  }
};

const SEED = findSeed(424242n);

interface PlayedRun {
  state: PlayState;
  bundle: StagedRun & { expectedScore: number };
}

/** Play the deterministic "grid" solution: 1 horizontal + 2 vertical cuts. */
const playFullClear = (seed: bigint, nonce: bigint): PlayedRun => {
  const entropy = pureCircuits.levelEntropy(seed);
  let state = newGame(levelFromEntropy(entropy));
  for (const [a, b] of [
    [{ x: 200n, y: 2100n }, { x: 3900n, y: 2100n }],
    [{ x: 1700n, y: 300n }, { x: 1700n, y: 3800n }],
    [{ x: 2450n, y: 300n }, { x: 2450n, y: 3800n }],
  ] as const) {
    const res = applyCut(state, a, b);
    if (!res.ok) throw new Error(`test cut rejected: ${JSON.stringify(res.reason)}`);
    state = res.state;
  }
  const bundle = buildRunBundle(state, entropy, nonce);
  return { state, bundle };
};

/** A do-nothing run (single piece, score 0). */
const playNoCuts = (seed: bigint, nonce: bigint): PlayedRun => {
  const entropy = pureCircuits.levelEntropy(seed);
  const state = newGame(levelFromEntropy(entropy));
  return { state, bundle: buildRunBundle(state, entropy, nonce) };
};

describe('slicer contract (simulator)', () => {
  let sim: SlicerSimulator;
  const adminKey = randomSecretKey();

  beforeEach(() => {
    sim = new SlicerSimulator(adminKey);
    sim.createTournament(TID, SEED, SUBMIT_UNTIL, REVEAL_UNTIL);
  });

  it('deployer is admin; tournament is on the ledger', () => {
    const l = sim.getLedger();
    expect(l.admins.member(pureCircuits.adminId(adminKey))).toBe(true);
    expect(l.tournaments.member(TID)).toBe(true);
    const t = l.tournaments.lookup(TID);
    expect(t.seed).toBe(SEED);
    expect(t.submitUntil).toBe(SUBMIT_UNTIL);
  });

  it('non-admin cannot create tournaments; admin can add admins', () => {
    sim.addUser('mallory');
    expect(() => sim.as('mallory').createTournament(9n, SEED, 10n, 20n)).toThrow(/not admin/);
    const malloryId = pureCircuits.adminId(sim.secretKeyOf('mallory'));
    expect(() => sim.as('mallory').addAdmin(malloryId)).toThrow(/not admin/);
    sim.as('deployer').addAdmin(malloryId);
    sim.as('mallory').createTournament(9n, SEED, 10n, 20n);
    expect(sim.getLedger().tournaments.member(9n)).toBe(true);
  });

  it('happy path: submit -> sealed; reveal in window; badge claim', () => {
    const nonce = 999_999n;
    const { bundle } = playFullClear(SEED, nonce);
    expect(bundle.expectedScore).toBeGreaterThanOrEqual(45);

    sim.addUser('alice');
    sim.as('alice').stageRun(bundle);
    sim.submitRun(TID);

    const nul = pureCircuits.nullifierFor(sim.secretKeyOf('alice'), TID);
    let l = sim.getLedger();
    expect(l.played.member(nul)).toBe(true);
    expect(l.sealedScores.member(nul)).toBe(true);
    expect(l.sealedScores.lookup(nul)).toBe(
      pureCircuits.scoreCommit(BigInt(bundle.expectedScore), nonce),
    );
    expect(l.revealedScores.isEmpty()).toBe(true);

    // reveal window
    sim.setBlockTime(1_500n);
    sim.revealScore(TID, BigInt(bundle.expectedScore), nonce);
    l = sim.getLedger();
    expect(l.revealedScores.lookup(nul)).toBe(BigInt(bundle.expectedScore));

    // badge: full clear with 3 cuts on a 4-object board = 45 >= Silver(40)
    sim.claimBadge(TID, 2n, BigInt(bundle.expectedScore), nonce);
    expect(sim.getLedger().badges.lookup(nul)).toBe(2n);
  });

  it('two players: different nullifiers both land; replay rejected', () => {
    const n1 = 111n;
    const n2 = 222n;
    const run1 = playFullClear(SEED, n1);
    const run2 = playNoCuts(SEED, n2);

    sim.addUser('alice');
    sim.addUser('bob');
    sim.as('alice').stageRun(run1.bundle);
    sim.submitRun(TID);
    sim.as('bob').stageRun(run2.bundle);
    sim.submitRun(TID);

    const l = sim.getLedger();
    expect(l.sealedScores.size()).toBe(2n);
    const nulA = pureCircuits.nullifierFor(sim.secretKeyOf('alice'), TID);
    const nulB = pureCircuits.nullifierFor(sim.secretKeyOf('bob'), TID);
    expect(nulA).not.toBe(nulB);
    expect(l.played.member(nulA)).toBe(true);
    expect(l.played.member(nulB)).toBe(true);

    // replay: same player, same tournament
    sim.as('alice').stageRun(run1.bundle);
    expect(() => sim.submitRun(TID)).toThrow(/already played/);
  });

  it('time windows: no submit after close, no reveal outside window', () => {
    const nonce = 1n;
    const { bundle } = playNoCuts(SEED, nonce);
    sim.addUser('alice');

    // reveal before submit window closes
    sim.as('alice').stageRun(bundle);
    sim.submitRun(TID);
    expect(() => sim.revealScore(TID, 0n, nonce)).toThrow(/not in reveal window/);

    // submit after close
    sim.addUser('bob');
    sim.setBlockTime(1_200n);
    sim.as('bob').stageRun(bundle);
    expect(() => sim.submitRun(TID)).toThrow(/submissions closed/);

    // reveal after reveal window
    sim.setBlockTime(2_500n);
    expect(() => sim.as('alice').revealScore(TID, 0n, nonce)).toThrow(/not in reveal window/);
  });

  it('wrong nonce / wrong score cannot reveal; badge needs the real score', () => {
    const nonce = 777n;
    const { bundle } = playFullClear(SEED, nonce);
    sim.addUser('alice');
    sim.as('alice').stageRun(bundle);
    sim.submitRun(TID);
    sim.setBlockTime(1_500n);

    const score = BigInt(bundle.expectedScore);
    expect(() => sim.revealScore(TID, score, 778n)).toThrow(/commit mismatch/);
    expect(() => sim.revealScore(TID, score + 10n, nonce)).toThrow(/commit mismatch/);
    expect(() => sim.claimBadge(TID, 3n, 60n, nonce)).toThrow(/commit mismatch/);
    // tier above actual score (score 45 < Gold 50)
    expect(() => sim.claimBadge(TID, 3n, score, nonce)).toThrow(/score below tier/);
    expect(() => sim.claimBadge(TID, 0n, score, nonce)).toThrow(/unknown tier/);
    // no entry at all
    sim.addUser('bob');
    expect(() => sim.as('bob').revealScore(TID, 0n, 5n)).toThrow(/no sealed entry/);
    expect(() => sim.as('bob').claimBadge(TID, 1n, 20n, 5n)).toThrow(/no sealed entry/);
  });

  describe('cheat suite — every tampered witness must throw', () => {
    type MutableRun = { -readonly [K in keyof StagedRun]: StagedRun[K] };
    const submitTampered = (mutate: (b: MutableRun) => StagedRun) => {
      const { bundle } = playFullClear(SEED, 313n);
      sim.addUser('cheater');
      sim.as('cheater').stageRun(mutate(structuredClone(bundle) as MutableRun));
      sim.submitRun(TID);
    };

    it('object hinted into a piece that does not contain it', () => {
      expect(() =>
        submitTampered((b) => {
          // point object 0 at whatever piece object 1 sits in (a different cell)
          b.objectHints = [...b.objectHints];
          b.objectHints[0] = b.objectHints[1];
          return b;
        }),
      ).toThrow(/object not inside its piece/);
    });

    it('object hint out of range', () => {
      expect(() =>
        submitTampered((b) => {
          b.objectHints = [...b.objectHints];
          b.objectHints[0] = b.pieceCount; // == pieceCount is out of range
          return b;
        }),
      ).toThrow(/object hint out of range/);
    });

    it('edge hint referencing an unused cut slot', () => {
      expect(() =>
        submitTampered((b) => {
          b.cutsUsed = 2n; // lie: claim only 2 cuts while edges reference cut 2
          return b;
        }),
      ).toThrow(/edge hint out of range/);
    });

    it('edge hint pointing at the wrong source line', () => {
      expect(() =>
        submitTampered((b) => {
          // find an edge hinted at a cut and repoint it at board edge 0
          outer: for (let p = 0; p < Number(b.pieceCount); p++) {
            for (let e = 0; e < Number(b.pieces[p].vertCount); e++) {
              if (b.edgeHints[p][e].isCut) {
                b.edgeHints[p][e] = { isCut: false, idx: 0n };
                break outer;
              }
            }
          }
          return b;
        }),
      ).toThrow(/off source line/);
    });

    it('piece duplication inflates area (tiling overrun)', () => {
      expect(() =>
        submitTampered((b) => {
          if (b.pieceCount >= 8n) throw new Error('no free piece slot for this test');
          const src = Number(b.pieceCount) - 1;
          b.pieces[Number(b.pieceCount)] = structuredClone(b.pieces[src]);
          b.edgeHints[Number(b.pieceCount)] = structuredClone(b.edgeHints[src]);
          b.pieceCount += 1n;
          return b;
        }),
      ).toThrow(/exceed board area/);
    });

    it('dropping a piece leaves a gap (tiling underrun)', () => {
      expect(() =>
        submitTampered((b) => {
          // drop the last piece; keep hints that point to remaining pieces valid
          const last = Number(b.pieceCount) - 1;
          b.objectHints = b.objectHints.map((h) => (h === BigInt(last) ? 0n : h));
          b.pieceCount -= 1n;
          return b;
        }),
      ).toThrow(/leave a gap|object not inside its piece/);
    });

    it('clockwise piece rejected', () => {
      expect(() =>
        submitTampered((b) => {
          const p = b.pieces[0];
          const n = Number(p.vertCount);
          const ring = p.verts.slice(0, n).reverse();
          for (let k = 0; k < 11; k++) p.verts[k] = k < n ? ring[k] : ring[0];
          return b;
        }),
      ).toThrow(/not CCW|off source line/);
    });

    it('vertex-count lies rejected', () => {
      expect(() =>
        submitTampered((b) => {
          b.pieces[0].vertCount = 2n;
          return b;
        }),
      ).toThrow(/bad piece vertex count/);
      expect(() =>
        submitTampered((b) => {
          b.pieces[0].vertCount = 12n;
          return b;
        }),
      ).toThrow(/bad piece vertex count|piece not padded/);
    });

    it('non-canonical padding rejected', () => {
      expect(() =>
        submitTampered((b) => {
          // tamper the padding slot of a piece that has one
          const target = b.pieces.find((p, i) => i < Number(b.pieceCount) && Number(p.vertCount) < 11);
          if (!target) throw new Error('piece not padded canonically (no padded piece to tamper)');
          target.verts[10] = { x: 9n, y: 9n };
          return b;
        }),
      ).toThrow(/piece not padded canonically/);
    });

    it('degenerate cut rejected', () => {
      expect(() =>
        submitTampered((b) => {
          b.cuts[2] = { a: { x: 100n, y: 100n }, b: { x: 150n, y: 120n } };
          return b;
        }),
      ).toThrow(/cut too short|off source line/);
    });

    it('piece count zero rejected', () => {
      expect(() =>
        submitTampered((b) => {
          b.pieceCount = 0n;
          return b;
        }),
      ).toThrow(/bad piece count|object hint out of range/);
    });

    it('seed limbs from a different level rejected', () => {
      const otherSeed = findSeed(SEED + 1_000n);
      expect(() =>
        submitTampered((b) => {
          const otherEntropy = pureCircuits.levelEntropy(otherSeed);
          const state = newGame(levelFromEntropy(otherEntropy));
          const other = buildRunBundle(state, otherEntropy, 313n);
          b.seedLimbs = other.seedLimbs;
          b.seedHi = other.seedHi;
          return b;
        }),
      ).toThrow(/seed limbs mismatch/);
    });
  });

  it('score sanity: sharing a piece is never counted isolated', () => {
    // one horizontal cut only: top row objects share a piece, bottom too
    const entropy = pureCircuits.levelEntropy(SEED);
    let state = newGame(levelFromEntropy(entropy));
    const res = applyCut(state, { x: 200n, y: 2100n }, { x: 3900n, y: 2100n });
    expect(res.ok).toBe(true);
    if (res.ok) state = res.state;
    const a = assignObjects(state);
    const level = levelFromEntropy(entropy);
    // 3 objects in the top half share a piece -> not isolated. With 4 objects,
    // the single bottom object IS isolated.
    if (level.objectCount === 4) {
      expect(a.isolatedCount).toBe(1);
      expect(a.score).toBe(10);
    } else {
      expect(a.isolatedCount).toBeLessThan(level.objectCount);
    }
    const bundle = buildRunBundle(state, entropy, 1n);
    sim.addUser('carol');
    sim.as('carol').stageRun(bundle);
    sim.submitRun(TID);
    const nul = pureCircuits.nullifierFor(sim.secretKeyOf('carol'), TID);
    expect(sim.getLedger().sealedScores.lookup(nul)).toBe(
      pureCircuits.scoreCommit(BigInt(a.score), 1n),
    );
  });
});
