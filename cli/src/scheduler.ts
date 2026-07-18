/**
 * Daily operation scheduler: a fresh field every day, forever.
 *
 * tid is canonical = days since the unix epoch, so every scheduler instance
 * agrees on the id; proofs close on the UTC midnight boundary and reveals
 * stay open for the following 24 hours. Run it alongside the stack:
 *
 *   npm run schedule:local --workspace @moonray/cli
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { fetchLedger, MoonraySlicer, pickUsableSeed, randomSecretKey } from '@moonray/api'
import { buildCliContext, providersFor, readDeployment, resolveNetwork, ZK_CONFIG_PATH } from './providers.js'

const DAY = 86_400

const main = async () => {
  const network = resolveNetwork(process.argv[2])
  const { address } = readDeployment(network)
  console.log(`daily scheduler for ${address} on ${network}`)

  const ctx = await buildCliContext(network)
  const providers = providersFor(ctx, 'admin')
  const admin = await MoonraySlicer.join(providers, ZK_CONFIG_PATH, address, randomSecretKey())

  for (;;) {
    const nowSec = Math.floor(Date.now() / 1000)
    const tid = BigInt(Math.floor(nowSec / DAY))
    const boundary = (Math.floor(nowSec / DAY) + 1) * DAY
    // proofs stay open a full 24h from opening (not until UTC midnight)
    const closeAt = nowSec + DAY

    try {
      const view = await fetchLedger(providers, address)
      const exists = view?.tournaments.some((t) => t.tid === tid) ?? false
      if (!exists) {
        const seed = pickUsableSeed()
        console.log(`  creating OP ${tid} (closes ${new Date(closeAt * 1000).toISOString()})...`)
        const tx = await admin.createTournament(
          tid,
          seed,
          new Date(closeAt * 1000),
          new Date((closeAt + DAY) * 1000),
        )
        console.log(`  ✓ OP ${tid} open — tx ${tx.txHash.slice(0, 16)}… @ block ${tx.blockHeight}`)
      } else {
        console.log(`  OP ${tid} already open`)
      }
    } catch (err) {
      console.error(`  scheduler error (will retry): ${String(err).slice(0, 140)}`)
    }

    // sleep until just past the next UTC midnight (when the tid rolls over)
    const waitMs = (boundary - Math.floor(Date.now() / 1000)) * 1000 + 5_000
    console.log(`  next field in ${Math.max(1, Math.round(waitMs / 60000))} min`)
    await sleep(Math.max(5_000, waitMs))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
