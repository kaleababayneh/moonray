/**
 * Finish demo seeding for an already-sealed tournament: reveal alice + bob
 * (their reveal material persists in cli/.state/) and claim alice's badge.
 * Retries transient node submission errors (stale dust selection after idle)
 * with fresh sync between attempts.
 *
 *   npx tsx src/demo-finish.ts local 2 [tier]
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { MoonraySlicer, randomSecretKey } from '@moonray/api'
import { buildCliContext, providersFor, readDeployment, resolveNetwork, ZK_CONFIG_PATH } from './providers.js'
import { waitForSync } from './wallet.js'

const withRetry = async <T>(label: string, ctxWallet: () => Promise<unknown>, fn: () => Promise<T>): Promise<T> => {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const out = await fn()
      console.log(`  ✓ ${label}`)
      return out
    } catch (err) {
      lastErr = err
      console.log(`  ✗ ${label} attempt ${attempt} failed: ${String(err).slice(0, 120)}`)
      await sleep(15_000)
      await ctxWallet() // fresh sync before retrying
    }
  }
  throw lastErr
}

const main = async () => {
  const network = resolveNetwork(process.argv[2])
  const { address } = readDeployment(network)
  const tid = BigInt(process.argv[3] ?? 2)
  const tier = Number(process.argv[4] ?? 1) as 1 | 2 | 3
  console.log(`finishing demo on ${address} (tournament #${tid})...`)

  const ctx = await buildCliContext(network)
  const resync = () => waitForSync(ctx.walletContext.wallet)

  const alice = await MoonraySlicer.join(providersFor(ctx, 'demo-alice'), ZK_CONFIG_PATH, address, randomSecretKey())
  const bob = await MoonraySlicer.join(providersFor(ctx, 'demo-bob'), ZK_CONFIG_PATH, address, randomSecretKey())

  const aliceRuns = await alice.myRuns()
  const run = aliceRuns[tid.toString()]
  if (!run) throw new Error(`alice has no reveal material for tournament ${tid}`)
  console.log(`  alice sealed score on record: ${run.score}`)

  await withRetry('alice revealScore', resync, () => alice.revealScore(tid))
  await withRetry('bob revealScore', resync, () => bob.revealScore(tid))
  if (run.score >= [0, 40, 70, 85][tier]) {
    await withRetry(`alice claimBadge tier ${tier}`, resync, () => alice.claimBadge(tid, tier))
  } else {
    console.log(`  skipping badge: score ${run.score} below tier ${tier}`)
  }

  console.log('demo data ready ✅')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
