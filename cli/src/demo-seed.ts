/**
 * Seed demo data on the CURRENT deployment (reads deployment.local.json):
 * tournament #2 with a short submit window, two sealed entries (45 and 0),
 * then — after the window closes — reveal both and claim a Silver badge, so
 * the UI shows every phase with real data.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { MoonraySlicer, pickUsableSeed, randomSecretKey } from '@moonray/api';
import { pureCircuits } from '@moonray/contract';
import { applyCut, levelFromEntropy, newGame, type PlayState, type Pt } from '@moonray/engine';
import { buildCliContext, providersFor, readDeployment, resolveNetwork, ZK_CONFIG_PATH } from './providers.js';

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

const main = async () => {
  const network = resolveNetwork(process.argv[2]);
  const { address } = readDeployment(network);
  const tid = BigInt(process.argv[3] ?? 2);
  console.log(`seeding demo data on ${address} (tournament #${tid})...`);

  const ctx = await buildCliContext(network);
  const admin = await MoonraySlicer.join(providersFor(ctx, 'admin'), ZK_CONFIG_PATH, address, randomSecretKey());

  let seed = pickUsableSeed();
  while (levelFromEntropy(pureCircuits.levelEntropy(seed)).objectCount !== 4) seed = pickUsableSeed();
  const submitUntil = new Date(Date.now() + 4 * 60_000);
  const revealUntil = new Date(Date.now() + 24 * 3600 * 1000);
  await admin.createTournament(tid, seed, submitUntil, revealUntil);
  console.log(`  tournament #${tid} open (closes ${submitUntil.toLocaleTimeString()})`);

  const alice = await MoonraySlicer.join(providersFor(ctx, 'demo-alice'), ZK_CONFIG_PATH, address, randomSecretKey());
  const bob = await MoonraySlicer.join(providersFor(ctx, 'demo-bob'), ZK_CONFIG_PATH, address, randomSecretKey());

  const a = await alice.submitRun(tid, playFullClear(seed), seed);
  console.log(`  alice sealed ${a.score} pts (tx ${a.txHash.slice(0, 16)}…)`);
  const entropy = pureCircuits.levelEntropy(seed);
  const b = await bob.submitRun(tid, newGame(levelFromEntropy(entropy)), seed);
  console.log(`  bob sealed ${b.score} pts`);

  const waitMs = submitUntil.getTime() - Date.now() + 15_000;
  if (waitMs > 0) {
    console.log(`  waiting ${Math.ceil(waitMs / 1000)}s for the reveal window...`);
    await sleep(waitMs);
  }

  await alice.revealScore(tid);
  console.log('  alice revealed');
  await bob.revealScore(tid);
  console.log('  bob revealed');
  await alice.claimBadge(tid, 2);
  console.log('  alice claimed Silver');

  console.log('demo data ready ✅');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
