/**
 * MOONRAY — the prototype's "open field" structure wired to Midnight.
 * Screens: title / play (full-bleed field + floating HUD) / archive / manual.
 * Daily operations come from the chain; expeditions are offline. Sealing,
 * revealing and honours run through GameContext (wallet + providers).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pickUsableSeed, preflightRun, type TournamentView } from '@moonray/api'
import { MAX_CUTS, TIERS, totalObjects } from '@moonray/engine'
import { Backdrop } from './components/Backdrop'
import { GameOverOverlay, SealCeremony, WinOverlay } from './components/Ceremonies'
import { CutPips, fmtClock, Glyph, Icon, ScoreReadout, WalletChip } from './components/Hud'
import { MoonrayMark } from './components/MoonrayMark'
import { opId, TitleScreen } from './components/TitleScreen'
import { BoardCanvas } from './game/BoardCanvas'
import { rejectionText, useSlicerGame } from './game/useSlicerGame'
import { GameProvider, useGame } from './midnight/GameContext'
import { Ranking } from './screens/Ranking'
import { Manual } from './screens/Manual'
import * as sfx from './lib/sfx'

type Mode = 'daily' | 'practice'
type Screen = 'title' | 'play' | 'manual' | 'archive'

const bestKey = (mode: Mode, seed: bigint) => `moonray:best:${mode}:${seed.toString().slice(0, 24)}`

function Shell() {
  const g = useGame()
  const [screen, setScreen] = useState<Screen>('title')
  const backFrom = useRef<Screen>('title')
  const [mode, setMode] = useState<Mode>('practice')
  const [practiceSeed, setPracticeSeed] = useState<bigint>(() => pickUsableSeed())
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [muted, setMutedState] = useState(false)
  const [best, setBest] = useState(0)
  const [win, setWin] = useState<{ score: number; cuts: number; moonlets: number } | null>(null)
  const [over, setOver] = useState<{ score: number; collected: number; total: number } | null>(null)
  const winShownFor = useRef('')
  const overShownFor = useRef('')
  const winTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  // the active on-chain operation
  const tournament: TournamentView | null = useMemo(() => {
    const ts = g.ledger?.tournaments ?? []
    return ts.find((t) => nowSec < t.submitUntil) ?? ts[0] ?? null
  }, [g.ledger, nowSec])
  const open = tournament != null && nowSec < tournament.submitUntil

  const daily = mode === 'daily' && tournament != null
  const seed = daily ? tournament.seed : practiceSeed
  const game = useSlicerGame(seed)
  const gameRef = useRef(game)
  gameRef.current = game

  const operationId = daily
    ? opId(tournament.tid)
    : `EXP-${(practiceSeed % 1048576n).toString(16).toUpperCase().padStart(5, '0')}`
  const countdown = daily ? Math.max(0, tournament.submitUntil - nowSec) : 0

  // audio
  useEffect(() => {
    setMutedState(sfx.isMuted())
    const unlock = () => sfx.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])
  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      sfx.setMuted(!m)
      return !m
    })
  }, [])

  // personal best per board
  const bKey = bestKey(mode, seed)
  const initialBest = useRef(0)
  useEffect(() => {
    const v = Number(localStorage.getItem(bKey) ?? 0)
    setBest(v)
    initialBest.current = v
  }, [bKey])
  useEffect(() => {
    if (game.assignment.score > best) {
      setBest(game.assignment.score)
      localStorage.setItem(bKey, String(game.assignment.score))
    }
  }, [game.assignment.score, best, bKey])

  // sound cues from state transitions
  const prevSplit = useRef(game.splitFlash)
  useEffect(() => {
    if (game.splitFlash !== prevSplit.current) {
      prevSplit.current = game.splitFlash
      sfx.slice()
    }
  }, [game.splitFlash])
  const prevRej = useRef(game.lastRejection)
  useEffect(() => {
    if (game.lastRejection !== prevRej.current) {
      prevRej.current = game.lastRejection
      if (game.lastRejection) sfx.reject()
    }
  }, [game.lastRejection])
  const prevIso = useRef(game.assignment.isolatedCount)
  useEffect(() => {
    const n = game.assignment.isolatedCount
    const was = prevIso.current
    prevIso.current = n
    if (n > was && game.state.cuts.length > 0) {
      for (let k = 0; k < n - was; k++) sfx.lock(was + k, k * 0.11)
    }
  }, [game.assignment.isolatedCount, game.state.cuts.length])

  // chain status for this operation
  const myNul = daily && g.connected ? g.myNullifier(tournament.tid) : null
  const alreadyPlayed = myNul !== null && (g.ledger?.playedNullifiers.has(myNul) ?? false)
  const myRun = daily ? g.myRuns()[tournament.tid.toString()] : undefined

  // preflight: is the current partition provable?
  const preflight = useMemo(
    () => (daily && game.state.cuts.length > 0 ? preflightRun(game.state, seed) : null),
    [daily, game.state, seed],
  )
  const canSeal =
    daily &&
    g.connected &&
    open &&
    !alreadyPlayed &&
    game.state.cuts.length > 0 &&
    preflight?.ok === true &&
    g.seal.stage === 'idle'

  const doSeal = useCallback(() => {
    if (!tournament) return
    setWin(null)
    setOver(null)
    void g.submitRun(tournament.tid, gameRef.current.state, tournament.seed)
  }, [g, tournament])

  // win ceremony (after a beat, so the board flourish lands first)
  useEffect(() => {
    const a = game.assignment
    if (!a.fullClear || game.state.cuts.length === 0) return
    const key = `${mode}:${seed}:${game.state.cuts.length}`
    if (winShownFor.current === key) return
    winShownFor.current = key
    sfx.win()
    const payload = {
      score: a.score,
      cuts: game.state.cuts.length,
      moonlets: a.totalObjects,
    }
    winTimer.current = setTimeout(() => setWin(payload), 1050)
  }, [game.assignment, game.state, mode, seed])

  // game over: all cuts spent, moonlets still shared
  useEffect(() => {
    const gg = game
    const spent = gg.cutsLeft === 0 && gg.state.cuts.length > 0 && !gg.assignment.fullClear
    if (!spent) return
    const key = `${mode}:${seed}:${gg.splitFlash}`
    if (overShownFor.current === key) return
    overShownFor.current = key
    overTimer.current = setTimeout(() => {
      const now = gameRef.current
      if (now.cutsLeft === 0 && now.state.cuts.length > 0 && !now.assignment.fullClear) {
        sfx.gameOver()
        setOver({
          score: now.assignment.score,
          collected: now.assignment.isolatedCount,
          total: totalObjects(now.state.level),
        })
      }
    }, 1600)
  }, [game, mode, seed])
  useEffect(
    () => () => {
      if (winTimer.current) clearTimeout(winTimer.current)
      if (overTimer.current) clearTimeout(overTimer.current)
    },
    [],
  )

  const newPractice = useCallback(() => {
    setPracticeSeed(pickUsableSeed())
    setMode('practice')
    setWin(null)
    setOver(null)
  }, [])
  const goDaily = useCallback(() => {
    setMode('daily')
    setWin(null)
    setOver(null)
  }, [])
  const toggleManual = useCallback(() => {
    setScreen((s) => {
      if (s === 'manual') return backFrom.current
      backFrom.current = s
      return 'manual'
    })
  }, [])

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey ||
        e.ctrlKey
      )
        return
      const k = e.key.toLowerCase()
      if (k === 'escape') {
        if (g.seal.stage === 'sealed' || g.seal.stage === 'error') g.dismissSeal()
        else if (win) setWin(null)
        else if (over) setOver(null)
        else if (screen === 'manual' || screen === 'archive') setScreen(backFrom.current)
        else if (screen === 'play') setScreen('title')
        return
      }
      if (k === 'm') {
        toggleManual()
        return
      }
      if (screen !== 'play' || win || over || g.seal.stage !== 'idle') return
      if (k === 'z') (e.shiftKey ? game.redo : game.undo)()
      else if (k === 'y') game.redo()
      else if (k === 'r') game.reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game, screen, win, over, toggleManual, g])

  const isolated = game.assignment.isolatedCount
  const total = game.assignment.totalObjects
  const cuts = game.state.cuts.length
  const status = game.lastRejection
    ? { kind: 'danger', lead: 'Trajectory rejected', text: rejectionText(game.lastRejection) }
    : game.assignment.fullClear && cuts > 0
      ? {
          kind: 'success',
          lead: 'Field stable',
          text: `Every moonlet isolated in ${cuts} cut${cuts === 1 ? '' : 's'}.`,
        }
      : game.cutsLeft === 0 && cuts > 0
        ? {
            kind: 'danger',
            lead: 'Out of trajectories',
            text: `${isolated} of ${total} collected — undo a cut${canSeal ? ', or prove what you have' : ''}.`,
          }
        : cuts > 0
          ? {
              kind: 'idle',
              lead: 'Survey in progress',
              text: `${game.cutsLeft} cut${game.cutsLeft === 1 ? '' : 's'} remaining.`,
            }
          : { kind: 'idle', lead: 'Awaiting trajectory', text: `${total} moonlets share two plates.` }
  const tier = [...TIERS].reverse().find((t) => game.assignment.score >= t.threshold) ?? null
  const record = best > 0 && best > initialBest.current && game.assignment.score === best

  const sealActions = {
    canSeal,
    sealedScore: myRun ? myRun.score : null,
    onSeal: doSeal,
  }

  return (
    <>
      <div className="scene" aria-hidden="true">
        <Backdrop />
        <div className="scene-vignette" />
      </div>
      <div className="grain" aria-hidden="true" />

      {screen === 'title' && (
        <main className="screen-root">
          <TitleScreen
            tournament={tournament}
            nowSec={nowSec}
            muted={muted}
            onToggleMute={toggleMute}
            onDaily={() => {
              if (!g.connected) void g.connect().catch(() => undefined)
              goDaily()
              setScreen('play')
            }}
            onExpedition={() => {
              newPractice()
              setScreen('play')
            }}
            onRanking={() => {
              backFrom.current = 'title'
              setScreen('archive')
            }}
            onManual={() => {
              backFrom.current = 'title'
              setScreen('manual')
            }}
          />
        </main>
      )}

      {screen === 'manual' && (
        <main className="screen-root">
          <Manual onBack={() => setScreen(backFrom.current)} />
        </main>
      )}

      {screen === 'archive' && (
        <main className="screen-root">
          <Ranking nowSec={nowSec} onBack={() => setScreen(backFrom.current)} />
        </main>
      )}

      {screen === 'play' && (
        <main className="play-stage" key={seed.toString().slice(0, 24)}>
          <BoardCanvas game={game} />

          <header className="hud-top">
            <button className="hud-wordmark" onClick={() => setScreen('title')} aria-label="Back to title">
              <MoonrayMark size={26} />
              <span>MOONRAY</span>
            </button>
            <div className="hud-op">
              <strong>{operationId}</strong>
              <small className={alreadyPlayed ? 'is-sealed' : ''}>
                {daily
                  ? alreadyPlayed
                    ? `PROVEN${myRun ? ` · ${myRun.score} PTS` : ''} · REVEALS AFTER ${fmtClock(countdown)}`
                    : `PROOFS CLOSE IN ${fmtClock(countdown)}`
                  : 'PRACTICE · OFF-CHAIN'}
              </small>
            </div>
            <div className="hud-corner">
              <div className="hud-glyphs">
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
                <Glyph label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={toggleMute} aria-pressed={!muted}>
                  <Icon name={muted ? 'soundOff' : 'sound'} />
                </Glyph>
                <Glyph label="Ranking" onClick={() => {
                  backFrom.current = 'play'
                  setScreen('archive')
                }}>
                  <Icon name="ledger" />
                </Glyph>
                <Glyph label="Field manual (M)" onClick={toggleManual}>
                  <Icon name="book" />
                </Glyph>
              </div>
              <ScoreReadout
                score={game.assignment.score}
                best={Math.max(best, game.assignment.score)}
                record={record}
                rank={tier?.name ?? null}
              />
            </div>
          </header>

          <footer className="hud-bottom">
            <div className="hud-actions">
              <Glyph label="Undo (Z)" onClick={game.undo} disabled={!game.canUndo}>
                <Icon name="undo" />
              </Glyph>
              <Glyph label="Redo (Y)" onClick={game.redo} disabled={!game.canRedo}>
                <Icon name="redo" />
              </Glyph>
              <Glyph label="Reset field (R)" onClick={game.reset} disabled={!game.canUndo}>
                <Icon name="reset" />
              </Glyph>
            </div>

            <div className="hud-center">
              <div className="collector" key={`c${isolated}`}>
                <i className="collector-gem" aria-hidden="true" />
                <b>
                  {isolated}
                  <span>/{total}</span>
                </b>
              </div>
              <CutPips cutsLeft={game.cutsLeft} maxCuts={MAX_CUTS} />
              <p
                className={`hud-status hud-status--${status.kind}`}
                aria-live="polite"
                key={`${status.lead}·${status.text}`}
              >
                <strong>{status.lead}</strong>
                <span>{status.text}</span>
              </p>
            </div>

            {daily ? (
              <button
                className="hud-seal"
                onClick={() => {
                  sfx.click()
                  doSeal()
                }}
                disabled={!canSeal}
                title={
                  alreadyPlayed
                    ? 'Already proven for this operation'
                    : !g.connected
                      ? 'Link a wallet to prove'
                      : preflight && !preflight.ok
                        ? `Not provable yet: ${preflight.reason}`
                        : cuts === 0
                          ? 'Make at least one cut'
                          : undefined
                }
              >
                <Icon name="seal" />
                <span>{alreadyPlayed ? 'PROVEN' : `PROVE RUN · ${game.assignment.score} PTS`}</span>
              </button>
            ) : (
              <button
                className="hud-new"
                onClick={() => {
                  sfx.click()
                  newPractice()
                }}
              >
                <Icon name="spark" />
                <span>NEW GAME</span>
              </button>
            )}
          </footer>

          {win && (
            <WinOverlay
              score={win.score}
              cuts={win.cuts}
              moonlets={win.moonlets}
              daily={daily}
              operationId={operationId}
              countdown={countdown}
              seal={sealActions}
              onNext={newPractice}
              onClose={() => setWin(null)}
            />
          )}

          {over && !win && (
            <GameOverOverlay
              score={over.score}
              collected={over.collected}
              total={over.total}
              best={Math.max(best, over.score)}
              daily={daily}
              seal={sealActions}
              onRetry={() => {
                game.reset()
                setOver(null)
              }}
              onNext={newPractice}
              onClose={() => setOver(null)}
            />
          )}
        </main>
      )}

      <SealCeremony seal={g.seal} onClose={g.dismissSeal} />
    </>
  )
}

export const App = () => (
  <GameProvider>
    <Shell />
  </GameProvider>
)
