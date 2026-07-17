/**
 * End-to-end smoke test on the local stack, with REAL proofs via the local
 * proof server:
 *
 *   deploy -> create short tournament -> alice full-clear run (prove+submit)
 *   -> bob 0-score run -> replay + tampered submissions rejected -> wait for
 *   reveal window -> both reveal -> ranking asserted -> alice claims Silver.
 *
 * Run: npm run e2e:local  (docker stack must be up: npm run stack:up)
 */

import { setTimeout as sleep } from 'node:timers/promises';
import {
  fetchLedger,
  MoonraySlicer,
  pickUsableSeed,
  preflightRun,
  randomSecretKey,
} from '@moonray/api';
import { pureCircuits } from '@moonray/contract';
import {
  applyCut,
  assignObjects,
  levelFromEntropy,
  newGame,
  type PlayState,
  type Pt,
} from '@moonray/engine';
import { buildCliContext, providersFor, resolveNetwork, writeDeployment, ZK_CONFIG_PATH } from './providers.js';

const GRID_CUTS: ReadonlyArray<readonly [Pt, Pt]> = [
  [{ x: 200n, y: 2100n }, { x: 3900n, y: 2100n }],
  [{ x: 1700n, y: 300n }, { x: 1700n, y: 3800n }],
  [{ x: 2450n, y: 300n }, { x: 2450n, y: 3800n }],
];

const playFullClear = (seed: bigint): PlayState => {
  const entropy = pureCircuits.levelEntropy(seed);
  let state = newGame(levelFromEntropy(entropy));
  for (const [a, b] of GRID_CUTS) {
    const res = applyCut(state, a, b);
    if (!res.ok) throw new Error(`scripted cut rejected: ${JSON.stringify(res.reason)}`);
    state = res.state;
  }
  return state;
};

const pickFourObjectSeed = (): bigint => {
  for (;;) {
    const seed = pickUsableSeed();
    if (levelFromEntropy(pureCircuits.levelEntropy(seed)).objectCount === 4) return seed;
  }
};

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`E2E ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = Date.now();
  const out = await fn();
  console.log(`  ⏱ ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return out;
};

const main = async () => {
  const network = resolveNetwork(process.argv[2]);
  if (network !== 'local') throw new Error('e2e is for the local stack');

  console.log('== wallet (genesis) ==');
  const ctx = await buildCliContext(network);

  console.log('== deploy ==');
  const adminProviders = providersFor(ctx, 'e2e-admin');
  const game = await timed('deploy (constructor proof + tx)', () =>
    MoonraySlicer.deploy(adminProviders, ZK_CONFIG_PATH, randomSecretKey()),
  );
  console.log(`  address: ${game.address}`);
  writeDeployment(network, game.address);

  console.log('== tournament ==');
  const tid = 100n;
  const seed = pickFourObjectSeed();
  const submitUntil = new Date(Date.now() + 180_000); // 3 min submit window
  const revealUntil = new Date(Date.now() + 30 * 60_000);
  await timed('createTournament', () => game.createTournament(tid, seed, submitUntil, revealUntil));

  console.log('== alice: full-clear run ==');
  const aliceState = playFullClear(seed);
  const aliceScore = assignObjects(aliceState).score;
  assert(aliceScore === 45, `engine scores the scripted full-clear at 45 (got ${aliceScore})`);
  const pre = preflightRun(aliceState, seed);
  assert(pre.ok && pre.score === 45, 'preflight matches engine score');

  const alice = await MoonraySlicer.join(
    providersFor(ctx, 'e2e-alice'),
    ZK_CONFIG_PATH,
    game.address,
    randomSecretKey(),
  );
  const aliceTx = await timed('alice submitRun (proof + balance + submit)', () =>
    alice.submitRun(tid, aliceState, seed),
  );
  console.log(`  tx ${aliceTx.txHash} @ block ${aliceTx.blockHeight}`);

  console.log('== bob: lazy run (0 cuts, score 0) ==');
  const bob = await MoonraySlicer.join(
    providersFor(ctx, 'e2e-bob'),
    ZK_CONFIG_PATH,
    game.address,
    randomSecretKey(),
  );
  const entropy = pureCircuits.levelEntropy(seed);
  const bobState = newGame(levelFromEntropy(entropy));
  await timed('bob submitRun', () => bob.submitRun(tid, bobState, seed));

  console.log('== replay rejection ==');
  await alice
    .submitRun(tid, aliceState, seed)
    .then(() => assert(false, 'replay must be rejected'))
    .catch((err: unknown) =>
      assert(/already played/.test(String(err)), `replay rejected: ${String(err).slice(0, 100)}`),
    );

  console.log('== tampered run rejection ==');
  {
    // A run played against a DIFFERENT board, submitted for this tournament:
    // the seed-limb recomposition assert fires before any proof is made.
    const cheatState = playFullClear(pickFourObjectSeed());
    const cheatPre = preflightRun(cheatState, seed);
    assert(!cheatPre.ok, `preflight blocks a wrong-level run (${cheatPre.ok ? '' : cheatPre.reason})`);
  }

  console.log('== sealed state ==');
  {
    const view = await fetchLedger(adminProviders, game.address);
    assert(view !== null && view.sealedCommits.size === 2, 'two sealed entries on-chain');
    assert((view?.tournaments.find((t) => t.tid === tid)?.ranking.length ?? -1) === 0, 'nothing revealed yet');
  }

  console.log('== waiting for the reveal window ==');
  const waitMs = submitUntil.getTime() - Date.now() + 15_000; // node block-time slack
  if (waitMs > 0) {
    console.log(`  sleeping ${(waitMs / 1000).toFixed(0)}s until submissions close...`);
    await sleep(waitMs);
  }

  console.log('== reveals ==');
  await timed('alice revealScore', () => alice.revealScore(tid));
  await timed('bob revealScore', () => bob.revealScore(tid));
  {
    const view = await fetchLedger(adminProviders, game.address);
    const ranking = view?.tournaments.find((t) => t.tid === tid)?.ranking ?? [];
    assert(ranking.length === 2, 'two revealed entries');
    assert(ranking[0].score === 45 && ranking[1].score === 0, 'ranking is [45, 0]');
    const aliceNul = await alice.myNullifier(tid);
    assert(ranking[0].nullifier === aliceNul, 'alice recognises her own entry by nullifier');
  }

  console.log('== badge ==');
  await timed('alice claimBadge Silver', () => alice.claimBadge(tid, 2));
  {
    const view = await fetchLedger(adminProviders, game.address);
    const aliceNul = await alice.myNullifier(tid);
    assert(
      view?.badges.some((b) => b.nullifier === aliceNul && b.tier === 2) ?? false,
      'Silver badge on-chain',
    );
  }

  console.log('\nE2E PASSED ✅');
  process.exit(0);
};

main().catch((err) => {
  console.error('\nE2E FAILED ❌');
  console.error(err);
  process.exit(1);
});
