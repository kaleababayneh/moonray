/**
 * Create (or show) the persistent deployment wallet for a network and print
 * the address to fund at the faucet. The seed never leaves cli/.state/
 * (git-ignored). No network access needed — pure key derivation.
 *
 *   npx tsx src/wallet-info.ts preprod
 */

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id'
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd'
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet'
import { NETWORKS } from '@moonray/api'
import { loadOrCreateSeed, resolveNetwork, seedFileFor } from './providers.js'

const main = () => {
  const network = resolveNetwork(process.argv[2] ?? 'preprod')
  setNetworkId(NETWORKS[network].networkId)
  const seed = process.env.WALLET_SEED ?? loadOrCreateSeed(network)

  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'))
  if (hd.type !== 'seedOk') throw new Error('bad seed')
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0)
  if (derived.type !== 'keysDerived') throw new Error('derivation failed')
  const keystore = createKeystore(derived.keys[Roles.NightExternal], NETWORKS[network].networkId)
  hd.hdWallet.clear()

  console.log(`network:            ${network} (${NETWORKS[network].networkId})`)
  console.log(`seed file:          ${process.env.WALLET_SEED ? '(from WALLET_SEED env)' : seedFileFor(network)}`)
  console.log(`unshielded address: ${keystore.getBech32Address()}`)
  console.log('')
  console.log('fund this address with tNIGHT at the faucet, then run:')
  console.log(`  npx tsx src/deploy.ts ${network}`)
  console.log('(the deploy waits for funds and registers NIGHT for DUST generation automatically)')
}

main()
