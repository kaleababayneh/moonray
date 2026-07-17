/**
 * Deploy the Slicer contract and open the first daily tournament.
 *
 *   npm run deploy:local             # genesis wallet on the local stack
 *   WALLET_SEED=... tsx src/deploy.ts preprod
 */

import { MoonraySlicer, pickUsableSeed, randomSecretKey } from '@moonray/api';
import { buildCliContext, providersFor, resolveNetwork, writeDeployment, ZK_CONFIG_PATH } from './providers.js';

const main = async () => {
  const network = resolveNetwork(process.argv[2]);
  console.log(`deploying moonray-slicer to ${network}...`);

  const ctx = await buildCliContext(network);
  const providers = providersFor(ctx, 'admin');

  // Reuse the persisted admin key if present (constructor registers it as admin).
  const existing = await providers.privateStateProvider.get('MoonraySlicerState');
  const adminKey = existing?.secretKey ?? randomSecretKey();

  console.log('  deploying contract (proving the constructor tx)...');
  const t0 = Date.now();
  const game = await MoonraySlicer.deploy(providers, ZK_CONFIG_PATH, adminKey);
  console.log(`  ✓ deployed at ${game.address} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  writeDeployment(network, game.address);

  // Open tournament #1: submissions for 6h, reveals for the following 6h.
  const tid = 1n;
  const seed = pickUsableSeed();
  const now = Date.now();
  const submitUntil = new Date(now + 6 * 3600 * 1000);
  const revealUntil = new Date(now + 12 * 3600 * 1000);
  console.log(`  creating tournament #${tid} (submit until ${submitUntil.toISOString()})...`);
  const t1 = Date.now();
  const tx = await game.createTournament(tid, seed, submitUntil, revealUntil);
  console.log(
    `  ✓ tournament open — tx ${tx.txHash} @ block ${tx.blockHeight} (${((Date.now() - t1) / 1000).toFixed(1)}s)`,
  );

  console.log('\ndone. start the UI with: npm run dev --workspace @moonray/ui');
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
