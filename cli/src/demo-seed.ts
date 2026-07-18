/**
 * Seed demo data on the CURRENT deployment (reads deployment.local.json):
 * tournament #2 with a short submit window, two sealed entries (searched
 * best and 0), then — after the window closes — reveal both and claim a
 * Bronze badge, so the UI shows every phase with real data.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { MoonraySlicer, pickUsableSeed, randomSecretKey } from '@moonray/api';
import { pureCircuits } from '@moonray/contract';
import { applyCut, assignObjects, levelFromEntropies, newGame, type PlayState, type Pt } from '@moonray/engine';
import { buildCliContext, providersFor, readDeployment, resolveNetwork, ZK_CONFIG_PATH } from './providers.js';

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const levelOf = (seed: bigint) =>
  levelFromEntropies(pureCircuits.levelEntropy(seed), pureCircuits.levelEntropy2(seed));

/** Deterministic search for the best random 3-cut run on this seed. */
const searchBestRun = (seed: bigint, rounds = 150): PlayState => {
  const rnd = mulberry32(4242);
  const gridPt = (): Pt => ({
    x: BigInt(200 + Math.floor(rnd() * 3700)),
    y: BigInt(200 + Math.floor(rnd() * 3700)),
  });
  let best: PlayState | null = null;
  let bestScore = -1;
  for (let r = 0; r < rounds; r++) {
    let state = newGame(levelOf(seed));
    for (let c = 0; c < 3; c++) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const res = applyCut(state, gridPt(), gridPt());
        if (res.ok) {
          state = res.state;
          break;
        }
      }
    }
    const score = assignObjects(state).score;
    if (score > bestScore) {
      bestScore = score;
      best = state;
    }
  }
  return best!;
};

const main = async () => {
  const network = resolveNetwork(process.argv[2]);
  const { address } = readDeployment(network);
  const tid = BigInt(process.argv[3] ?? 2);
  console.log(`seeding demo data on ${address} (tournament #${tid})...`);

  const ctx = await buildCliContext(network);
  const admin = await MoonraySlicer.join(providersFor(ctx, 'admin'), ZK_CONFIG_PATH, address, randomSecretKey());

  let seed = pickUsableSeed();
  let run = searchBestRun(seed);
  while (assignObjects(run).score < 40) {
    seed = pickUsableSeed();
    run = searchBestRun(seed);
  }
  const submitUntil = new Date(Date.now() + 4 * 60_000);
  const revealUntil = new Date(Date.now() + 24 * 3600 * 1000);
  await admin.createTournament(tid, seed, submitUntil, revealUntil);
  console.log(`  tournament #${tid} open (closes ${submitUntil.toLocaleTimeString()})`);

  const alice = await MoonraySlicer.join(providersFor(ctx, 'demo-alice'), ZK_CONFIG_PATH, address, randomSecretKey());
  const bob = await MoonraySlicer.join(providersFor(ctx, 'demo-bob'), ZK_CONFIG_PATH, address, randomSecretKey());

  const a = await alice.submitRun(tid, run, seed);
  console.log(`  alice sealed ${a.score} pts (tx ${a.txHash.slice(0, 16)}…)`);
  const b = await bob.submitRun(tid, newGame(levelOf(seed)), seed);
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
  await alice.claimBadge(tid, 1);
  console.log('  alice claimed Bronze');

  console.log('demo data ready ✅');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
