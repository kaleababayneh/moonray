/**
 * The leaderboard: proven entries and the revealed ranking, read live from
 * the indexer. Anonymous entries wear nullifier identicons; your row shows
 * your nickname and wallet. Nicknames are device-local labels.
 */

import { useEffect, useState } from 'react'
import type { TournamentView } from '@moonray/api'
import { Btn, fmtClock, Icon, WalletChip } from '../components/Hud'
import { MoonrayMark } from '../components/MoonrayMark'
import { opId } from '../components/TitleScreen'
import { Identicon, shortNul } from '../components/Identicon'
import { LS_DISPLAY_NAMES, LS_NICKNAME, NAMES_URL } from '../config'
import { useGame } from '../midnight/GameContext'

const loadNames = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(LS_DISPLAY_NAMES) ?? '{}')
  } catch {
    return {}
  }
}

/** Registry entries published by operators who registered on the leaderboard. */
type RegistryEntry = { name: string; address: string }

const shortAddr = (a: string) => `${a.slice(0, 18)}…${a.slice(-6)}`.toUpperCase()

const publishName = (nullifier: bigint, name: string, address: string) =>
  fetch(NAMES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nullifier: nullifier.toString(), name, address }),
  }).catch(() => undefined)

export function Ranking({ onBack, nowSec }: { onBack: () => void; nowSec: number }) {
  const g = useGame()
  const [names, setNames] = useState(loadNames)
  const [nickname, setNickname] = useState(() => localStorage.getItem(LS_NICKNAME) ?? '')
  const [draft, setDraft] = useState(() => localStorage.getItem(LS_NICKNAME) ?? '')
  const tournaments = g.ledger?.tournaments ?? []
  const [selected, setSelected] = useState<bigint | null>(null)
  const t: TournamentView | null = tournaments.find((x) => x.tid === selected) ?? tournaments[0] ?? null

  const myNul = t && g.connected ? g.myNullifier(t.tid) : null
  const myRun = t ? g.myRuns()[t.tid.toString()] : undefined
  const iRevealed = myNul !== null && (t?.ranking ?? []).some((r) => r.nullifier === myNul)
  const phase = t == null ? null : nowSec < t.submitUntil ? 'open' : nowSec < t.revealUntil ? 'reveal' : 'closed'
  const canReveal = phase === 'open' || phase === 'reveal'

  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [registry, setRegistry] = useState<Record<string, RegistryEntry>>({})

  // shared name registry: everyone sees registered nicknames + wallets
  useEffect(() => {
    let stop = false
    const load = () =>
      fetch(NAMES_URL)
        .then((r) => r.json())
        .then((m: Record<string, RegistryEntry>) => {
          if (!stop) setRegistry(m)
        })
        .catch(() => undefined)
    void load()
    const iv = setInterval(load, 15_000)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [])

  /** Publish a name for one operation's entry — each reveal names itself freely. */
  const publishFor = (tid: bigint, name: string) => {
    if (!g.connected) return
    void publishName(g.myNullifier(tid), name, g.walletAddress ?? '')
  }

  const reveal = async () => {
    if (!t) return
    setBusy('reveal')
    setMsg(null)
    try {
      const { score } = await g.revealScore(t.tid)
      const name = draft.trim() || nickname
      if (name) publishFor(t.tid, name)
      setMsg(`REVEALED ${score} PTS — THE RANKING UPDATES AS THE INDEXER CATCHES UP.`)
    } catch (err) {
      setMsg(`REVEAL FAILED: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const register = () => {
    const v = draft.trim()
    setNickname(v)
    if (v) localStorage.setItem(LS_NICKNAME, v)
    else localStorage.removeItem(LS_NICKNAME)
    if (t) publishFor(t.tid, v)
    setMsg(
      v
        ? `NICKNAME "${v.toUpperCase()}" REGISTERED FOR ${opId(t?.tid ?? 0n)} — EVERYONE SEES IT.`
        : 'NICKNAME CLEARED.',
    )
  }

  const setName = (nul: bigint, name: string) => {
    const next = { ...names, [nul.toString()]: name }
    if (!name) delete next[nul.toString()]
    setNames(next)
    localStorage.setItem(LS_DISPLAY_NAMES, JSON.stringify(next))
  }

  return (
    <section className="manual">
      <header className="manual-top rise">
        <span className="manual-brand">
          <MoonrayMark size={24} />
          MOONRAY
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <WalletChip
            connected={g.connected}
            connecting={g.connecting}
            walletName={g.walletName}
            disabled={!g.contractAddress}
            onClick={() => {
              if (g.connected) g.disconnect()
              else void g.connect().catch(() => undefined)
            }}
          />
          <Btn onClick={onBack}>
            <span>Return to the field</span>
            <Icon name="arrow" />
          </Btn>
        </span>
      </header>

      <div className="manual-head rise" style={{ '--d': '60ms' } as React.CSSProperties}>
        <span className="hud-label">RANKING</span>
        <h1>Ranking</h1>
        <p>
          Scores stay hidden until their operator says otherwise — the chain knows only that
          proofs exist. Reveal your number whenever you choose, or keep it hidden forever.
        </p>
      </div>

      <div className="archive-actions rise" style={{ '--d': '120ms' } as React.CSSProperties}>
        {tournaments.length > 0 && (
          <select
            className="tourney-pick"
            value={t?.tid.toString() ?? ''}
            onChange={(e) => setSelected(BigInt(e.target.value))}
            aria-label="Select operation"
          >
            {tournaments.map((x) => (
              <option key={x.tid.toString()} value={x.tid.toString()}>
                {opId(x.tid)}
              </option>
            ))}
          </select>
        )}
        {phase && (
          <span className={`phase-chip is-${phase}`}>
            {phase === 'open'
              ? `PROOFS CLOSE IN ${fmtClock(Math.max(0, (t?.submitUntil ?? 0) - nowSec))}`
              : phase === 'reveal'
                ? `REVEALS CLOSE IN ${fmtClock(Math.max(0, (t?.revealUntil ?? 0) - nowSec))}`
                : 'CLOSED'}
          </span>
        )}
        <span className="phase-chip">{g.ledger?.sealedCommits.size ?? 0} PROVEN</span>
        {canReveal && myRun && !iRevealed && (
          <Btn variant="gold" onClick={() => void reveal()} disabled={busy !== null}>
            <Icon name="ledger" />
            <span>{busy === 'reveal' ? 'Revealing…' : `Reveal my ${myRun.score} pts`}</span>
          </Btn>
        )}
      </div>

      {g.connected && (
        <div className="archive-actions rise" style={{ '--d': '140ms' } as React.CSSProperties}>
          <input
            className="callsign-input"
            placeholder="WRITE A NICKNAME"
            maxLength={18}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Nickname shown beside your entries"
          />
          <Btn variant={draft.trim() !== nickname ? 'gold' : 'ghost'} onClick={register} disabled={draft.trim() === nickname}>
            <span>Register on the leaderboard</span>
          </Btn>
        </div>
      )}

      {msg && (
        <p className="archive-note rise" style={{ '--d': '150ms' } as React.CSSProperties}>
          {msg}
        </p>
      )}

      <div className="archive-cols">
        <article className="sheet rise" style={{ '--d': '180ms' } as React.CSSProperties}>
          <span className="hud-label">REVEALED RANKING</span>
          <div className="rank-rows">
            {myRun && !iRevealed && myNul !== null && (
              <div className="ledger-row is-me is-pending">
                <span className="ledger-rank">··</span>
                <Identicon value={myNul} size={30} />
                <div className="ledger-id">
                  <em>{nickname || 'you'} — sealed, not yet revealed</em>
                  <small>
                    {g.walletAddress
                      ? `${g.walletAddress.slice(0, 18)}…${g.walletAddress.slice(-6)}`.toUpperCase()
                      : shortNul(myNul).toUpperCase()}
                  </small>
                </div>
                <b className="ledger-score">{myRun.score}</b>
              </div>
            )}
            {t == null || t.ranking.length === 0 ? (
              <div className="ledger-empty">
                {phase === 'open' ? 'NOTHING REVEALED — THE FIELD IS STILL OPEN' : 'NOTHING REVEALED YET'}
              </div>
            ) : (
              t.ranking.map((r, i) => {
                const mine = myNul !== null && r.nullifier === myNul
                const reg = registry[r.nullifier.toString()]
                const name = names[r.nullifier.toString()] ?? reg?.name
                return (
                  <div key={r.nullifier.toString()} className={`ledger-row ${mine ? 'is-me' : ''}`}>
                    <span className="ledger-rank">{String(i + 1).padStart(2, '0')}</span>
                    <Identicon value={r.nullifier} size={30} />
                    <div className="ledger-id">
                      {mine ? (
                        <input
                          placeholder={nickname || 'you — add a name'}
                          value={names[r.nullifier.toString()] ?? ''}
                          onChange={(e) => setName(r.nullifier, e.target.value)}
                          aria-label="Display name for your entry"
                        />
                      ) : (
                        <em>{name ?? 'anonymous operator'}</em>
                      )}
                      <small>
                        {mine && g.walletAddress
                          ? shortAddr(g.walletAddress)
                          : reg?.address
                            ? shortAddr(reg.address)
                            : shortNul(r.nullifier).toUpperCase()}
                      </small>
                    </div>
                    <b className="ledger-score">{r.score}</b>
                  </div>
                )
              })
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
