/**
 * Read-only ledger peek over the hosted indexer (no wallet, no sync).
 *
 *   npx tsx src/peek-ledger.ts [network] [address]
 */
import * as fs from 'node:fs'
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id'
import { ContractState } from '@midnight-ntwrk/compact-runtime'
import { ledger } from '@moonray/contract'
import { NETWORKS } from '@moonray/api'
import { resolveNetwork } from './providers.js'

const main = async () => {
  const network = resolveNetwork(process.argv[2] ?? 'preprod')
  const address =
    process.argv[3] ??
    (JSON.parse(fs.readFileSync(new URL(`../deployment.${network}.json`, import.meta.url), 'utf8')) as { address: string })
      .address
  setNetworkId(NETWORKS[network].networkId)

  const res = await fetch(NETWORKS[network].indexer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query L($a: HexEncoded!) { contractAction(address: $a) { state } }',
      variables: { a: address },
    }),
  })
  const payload = (await res.json()) as { errors?: { message: string }[]; data?: { contractAction?: { state: string } } }
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join('; '))
  if (!payload.data?.contractAction) throw new Error('contract not found on indexer')
  const hex = payload.data.contractAction.state
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const l = ledger(ContractState.deserialize(bytes).data)

  console.log(`contract ${address.slice(0, 12)}… on ${network}`)
  console.log('  played entries :', l.played.size().toString())
  console.log('  sealedScores   :', l.sealedScores.size().toString())
  console.log('  revealedScores :', l.revealedScores.size().toString())
  for (const [tid, t] of l.tournaments) {
    console.log(
      `  op ${tid} (${new Date(Number(tid) * 86_400_000).toISOString().slice(0, 10)}): closes ${new Date(Number(t.submitUntil) * 1000).toISOString()}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
