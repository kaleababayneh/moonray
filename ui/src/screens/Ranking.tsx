/**
 * The archive: sealed entries, the revealed ranking, honours (badges) — all
 * read live from the indexer. Anonymous entries wear nullifier identicons;
 * your row is recognisable only to you.
 */

import { useState } from 'react'
import type { TournamentView } from '@moonray/api'
import { TIERS } from '@moonray/engine'
import { Btn, fmtClock, Icon } from '../components/Hud'
import { MoonrayMark } from '../components/MoonrayMark'
import { opId } from '../components/TitleScreen'
import { Identicon, shortNul } from '../components/Identicon'
import { LS_CALLSIGN, LS_DISPLAY_NAMES } from '../config'
import { useGame } from '../midnight/GameContext'

const loadNames = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(LS_DISPLAY_NAMES) ?? '{}')
  } catch {
    return {}
  }
}

export function Ranking({ onBack, nowSec }: { onBack: () => void; nowSec: number }) {
  const g = useGame()
  const [names, setNames] = useState(loadNames)
  const [callsign, setCallsignState] = useState(() => localStorage.getItem(LS_CALLSIGN) ?? '')
  const setCallsign = (v: string) => {
    setCallsignState(v)
    if (v) localStorage.setItem(LS_CALLSIGN, v)
    else localStorage.removeItem(LS_CALLSIGN)
  }
  const tournaments = g.ledger?.tournaments ?? []
  const [selected, setSelected] = useState<bigint | null>(null)
  const t: TournamentView | null = tournaments.find((x) => x.tid === selected) ?? tournaments[0] ?? null

  const myNul = t && g.connected ? g.myNullifier(t.tid) : null
  const myRun = t ? g.myRuns()[t.tid.toString()] : undefined
  const iRevealed = myNul !== null && (t?.ranking ?? []).some((r) => r.nullifier === myNul)
  const phase = t == null ? null : nowSec < t.submitUntil ? 'open' : nowSec < t.revealUntil ? 'reveal' : 'closed'
  const inReveal = phase === 'reveal'
  const myBadge = myNul !== null ? g.ledger?.badges.find((b) => b.nullifier === myNul) : undefined

  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const reveal = async () => {
    if (!t) return
    setBusy('reveal')
    setMsg(null)
    try {
      const { score } = await g.revealScore(t.tid)
      setMsg(`REVEALED ${score} PTS — THE RANKING UPDATES AS THE INDEXER CATCHES UP.`)
    } catch (err) {
      setMsg(`REVEAL FAILED: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const claim = async (tier: 1 | 2 | 3) => {
    if (!t) return
    setBusy(`tier${tier}`)
    setMsg(null)
    try {
      await g.claimBadge(t.tid, tier)
      setMsg('HONOUR CLAIMED — YOUR EXACT SCORE REMAINS HIDDEN FOREVER.')
    } catch (err) {
      setMsg(`CLAIM FAILED: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
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
        <Btn onClick={onBack}>
          <span>Return to the field</span>
          <Icon name="arrow" />
        </Btn>
      </header>

      <div className="manual-head rise" style={{ '--d': '60ms' } as React.CSSProperties}>
        <span className="hud-label">RANKING</span>
        <h1>Ranking</h1>
        <p>
          Scores stay hidden while an operation runs — the chain knows only that proofs exist.
          When the reveal window opens, operators choose: reveal the number, or claim an honour
          and keep it hidden forever.
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
        {g.connected && (
          <input
            className="callsign-input"
            placeholder="CALLSIGN"
            maxLength={18}
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            aria-label="Callsign shown beside your entries"
          />
        )}
        {inReveal && myRun && !iRevealed && (
          <Btn variant="gold" onClick={() => void reveal()} disabled={busy !== null}>
            <Icon name="ledger" />
            <span>{busy === 'reveal' ? 'Revealing…' : `Reveal my ${myRun.score} pts`}</span>
          </Btn>
        )}
      </div>

      {g.connected && !callsign && (
        <p className="archive-note rise" style={{ '--d': '130ms' } as React.CSSProperties}>
          PICK A CALLSIGN ABOVE — IT IS SHOWN WITH YOUR WALLET BESIDE YOUR ENTRIES.
        </p>
      )}
      {msg && (
        <p className="archive-note rise" style={{ '--d': '140ms' } as React.CSSProperties}>
          {msg}
        </p>
      )}

      <div className="archive-cols">
        <article className="sheet rise" style={{ '--d': '180ms' } as React.CSSProperties}>
          <span className="hud-label">REVEALED RANKING</span>
          <div className="rank-rows">
            {t == null || t.ranking.length === 0 ? (
              <div className="ledger-empty">
                {phase === 'open' ? 'NOTHING REVEALED — THE FIELD IS STILL OPEN' : 'NOTHING REVEALED YET'}
              </div>
            ) : (
              t.ranking.map((r, i) => {
                const mine = myNul !== null && r.nullifier === myNul
                const name = names[r.nullifier.toString()]
                return (
                  <div key={r.nullifier.toString()} className={`ledger-row ${mine ? 'is-me' : ''}`}>
                    <span className="ledger-rank">{String(i + 1).padStart(2, '0')}</span>
                    <Identicon value={r.nullifier} size={30} />
                    <div className="ledger-id">
                      {mine ? (
                        <input
                          placeholder={callsign || 'you — add a name'}
                          value={name ?? ''}
                          onChange={(e) => setName(r.nullifier, e.target.value)}
                          aria-label="Display name for your entry"
                        />
                      ) : (
                        <em>{name ?? 'anonymous operator'}</em>
                      )}
                      <small>
                        {mine && g.walletAddress
                          ? `${g.walletAddress.slice(0, 18)}…${g.walletAddress.slice(-6)}`.toUpperCase()
                          : shortNul(r.nullifier).toUpperCase()}
                      </small>
                    </div>
                    <b className="ledger-score">{r.score}</b>
                  </div>
                )
              })
            )}
          </div>
          <p className="archive-note">
            YOUR CALLSIGN AND NAMES ARE LABELS ON THIS DEVICE. ON-CHAIN, EVERY ENTRY IS A
            NULLIFIER — YOU RECOGNISE YOURS BECAUSE ONLY YOUR KEY DERIVES IT.
          </p>
        </article>

        <article className="sheet rise" style={{ '--d': '240ms' } as React.CSSProperties}>
          <span className="hud-label">HONOURS · SCORE NEVER REVEALED</span>
          <div className="rank-rows">
            {TIERS.map((tier) => {
              const have = myRun !== undefined && myRun.score >= tier.threshold
              const held = myBadge?.tier === tier.tier
              return (
                <div className="rank-row" key={tier.tier}>
                  <i className={`rank-medal rank-medal--${tier.name.toLowerCase()}`} aria-hidden="true" />
                  <strong>{tier.name}</strong>
                  <b>{tier.threshold}+ PTS</b>
                  <span style={{ marginLeft: 12 }}>
                    <Btn
                      onClick={() => void claim(tier.tier as 1 | 2 | 3)}
                      disabled={!have || held || busy !== null || !g.connected}
                      variant={have && !held ? 'gold' : 'ghost'}
                      title={
                        !g.connected
                          ? 'Link a wallet first'
                          : !myRun
                            ? 'Prove a run in the daily first'
                            : !have
                              ? `Your proven score (${myRun.score}) is below this honour`
                              : undefined
                      }
                    >
                      <span>{held ? 'Held' : busy === `tier${tier.tier}` ? 'Proving…' : 'Claim'}</span>
                    </Btn>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="rank-rows" style={{ marginTop: 18 }}>
            {(g.ledger?.badges ?? []).length === 0 ? (
              <div className="ledger-empty">NO HONOURS CLAIMED YET</div>
            ) : (
              (g.ledger?.badges ?? []).map((b) => {
                const mine = myNul !== null && b.nullifier === myNul
                const tier = TIERS[b.tier - 1]
                return (
                  <div key={b.nullifier.toString()} className={`ledger-row ${mine ? 'is-me' : ''}`}>
                    <i className={`rank-medal rank-medal--${(tier?.name ?? 'bronze').toLowerCase()}`} aria-hidden="true" />
                    <Identicon value={b.nullifier} size={30} />
                    <div className="ledger-id">
                      <em>{mine ? callsign || 'you' : 'anonymous operator'}</em>
                      <small>
                        {mine && g.walletAddress
                          ? `${g.walletAddress.slice(0, 18)}…${g.walletAddress.slice(-6)}`.toUpperCase()
                          : shortNul(b.nullifier).toUpperCase()}
                      </small>
                    </div>
                    <b className="ledger-score">{tier?.name.toUpperCase()}</b>
                  </div>
                )
              })
            )}
          </div>
          <p className="archive-note">
            AN HONOUR IS A ZERO-KNOWLEDGE PROOF THAT A HIDDEN SCORE CLEARS THE THRESHOLD. THE
            NUMBER ITSELF IS NEVER DERIVABLE.
          </p>
        </article>
      </div>
    </section>
  )
}
