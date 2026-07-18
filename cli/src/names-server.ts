/**
 * Leaderboard name registry — a deliberately tiny sidecar (no chain, no auth):
 * registering on the leaderboard publishes {nullifier -> nickname, wallet} so
 * every browser can label revealed entries. Anonymity stays the on-chain
 * default; this only stores what an operator explicitly registers.
 *
 *   npx tsx src/names-server.ts        # listens on :8082, state in .state/names.json
 */
import * as http from 'node:http'
import * as fs from 'node:fs'

const PORT = Number(process.env.NAMES_PORT ?? 8082)
const FILE = new URL('../.state/names.json', import.meta.url)

type Entry = { name: string; address: string }
let names: Record<string, Entry> = {}
try {
  names = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  /* fresh file */
}

const save = () => fs.writeFileSync(FILE, JSON.stringify(names, null, 2))
const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, max)
    .trim()

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(names))
    return
  }
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 4096) req.destroy()
    })
    req.on('end', () => {
      try {
        const p = JSON.parse(body) as Record<string, unknown>
        const nul = clean(p.nullifier, 80)
        if (!/^\d+$/.test(nul)) throw new Error('bad nullifier')
        const name = clean(p.name, 18)
        const address = clean(p.address, 120)
        if (name) names[nul] = { name, address }
        else delete names[nul]
        save()
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(names))
      } catch {
        res.writeHead(400).end('bad request')
      }
    })
    return
  }
  res.writeHead(405).end()
})

server.listen(PORT, () => console.log(`names registry on :${PORT} -> ${FILE.pathname}`))
