/**
 * Leaderboard name registry as a Vercel function backed by Vercel Blob.
 * One blob per entry (names/<nullifier>.json) so concurrent registrations
 * never overwrite each other; only a rename touches an existing blob.
 * Zero npm dependencies — talks to the Blob REST API directly so the static
 * deploy needs no install step. Same contract as cli/src/names-server.ts.
 */
const API = 'https://blob.vercel-storage.com'
const PREFIX = 'names/'

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (c) => {
      b += c
      if (b.length > 4096) reject(new Error('too large'))
    })
    req.on('end', () => resolve(b))
    req.on('error', reject)
  })

const load = async (token) => {
  const list = await fetch(`${API}?prefix=${encodeURIComponent(PREFIX)}&limit=1000`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!list.ok) return {}
  const { blobs } = await list.json()
  const entries = await Promise.all(
    (blobs ?? []).map(async (b) => {
      const nul = b.pathname.slice(PREFIX.length).replace(/\.json$/, '')
      if (!/^\d+$/.test(nul)) return null
      try {
        const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' })
        return r.ok ? [nul, await r.json()] : null
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(entries.filter(Boolean))
}

const saveOne = (token, nul, entry) =>
  fetch(`${API}/${PREFIX}${nul}.json`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-api-version': '7',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
    },
    body: JSON.stringify(entry),
  })

const deleteOne = async (token, nul) => {
  const list = await fetch(`${API}?prefix=${encodeURIComponent(`${PREFIX}${nul}.json`)}&limit=1`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!list.ok) return
  const { blobs } = await list.json()
  if (!blobs?.length) return
  await fetch(`${API}/delete`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-api-version': '7',
    },
    body: JSON.stringify({ urls: blobs.map((b) => b.url) }),
  })
}

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, max)
    .trim()

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('cache-control', 'no-store')
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    res.statusCode = 500
    res.end('registry not configured')
    return
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method === 'GET') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(await load(token)))
    return
  }
  if (req.method === 'POST') {
    try {
      const p = JSON.parse(await readBody(req))
      const nul = clean(p.nullifier, 80)
      if (!/^\d+$/.test(nul)) throw new Error('bad nullifier')
      const name = clean(p.name, 18)
      const address = clean(p.address, 120)
      if (name) await saveOne(token, nul, { name, address })
      else await deleteOne(token, nul)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch {
      res.statusCode = 400
      res.end('bad request')
    }
    return
  }
  res.statusCode = 405
  res.end()
}
