/**
 * Import a wallet mnemonic as the deployment wallet for a network.
 * The phrase is read ONLY from the MNEMONIC env var; the derived BIP-39 seed
 * is written to cli/.state/<network>-wallet-seed (git-ignored, 0600).
 *
 *   MNEMONIC="word1 word2 ..." npx tsx src/import-wallet.ts preprod
 */

import * as fs from 'node:fs'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id'
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd'
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet'
import { NETWORKS } from '@moonray/api'
import { resolveNetwork, seedFileFor } from './providers.js'

const main = () => {
  const network = resolveNetwork(process.argv[2] ?? 'preprod')
  const mnemonic = (process.env.MNEMONIC ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!mnemonic) throw new Error('set MNEMONIC="..."')
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('invalid mnemonic (checksum failed)')

  const seed = mnemonicToSeedSync(mnemonic)
  const hex = Buffer.from(seed).toString('hex')
  const file = seedFileFor(network)
  fs.writeFileSync(file, hex, { mode: 0o600 })

  setNetworkId(NETWORKS[network].networkId)
  const hd = HDWallet.fromSeed(seed)
  if (hd.type !== 'seedOk') throw new Error('HDWallet rejected the derived seed')
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0)
  if (derived.type !== 'keysDerived') throw new Error('key derivation failed')
  const keystore = createKeystore(derived.keys[Roles.NightExternal], NETWORKS[network].networkId)
  hd.hdWallet.clear()

  console.log(`seed imported for ${network} -> ${file}`)
  console.log(`unshielded address: ${keystore.getBech32Address()}`)
}

main()
