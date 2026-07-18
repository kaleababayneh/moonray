/**
 * /deploy — standalone station console for deploying the contract from the
 * browser wallet (1AM proves, balances and pays; no headless CLI wallet).
 * Reached only by typing the URL: nothing on the game screens links here.
 *
 * The deployer's local secret key becomes the contract admin, so this same
 * page can also open the current hour's operation on an existing deployment.
 */

import { useCallback, useRef, useState } from 'react'
import { fetchLedger, MoonraySlicer, pickUsableSeed, type SlicerProviders } from '@moonray/api'
import { LS_DEPLOYMENT, UI_NETWORKS, type Deployment } from '../config'
import { connectWallet } from '../midnight/wallet'
import { buildBrowserProviders, loadOrCreateSecretKey } from '../midnight/providers'

const HOUR = 3600

type StepState = 'run' | 'ok' | 'err'
interface Step {
  text: string
  state: StepState
  detail?: string
}

const loadDeployment = (): Deployment | null => {
  try {
    const raw = localStorage.getItem(LS_DEPLOYMENT)
    return raw ? (JSON.parse(raw) as Deployment) : null
  } catch {
    return null
  }
}

export function DeployPage() {
  const config = UI_NETWORKS.preprod
  const [deployment, setDeployment] = useState<Deployment | null>(loadDeployment)
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const gameRef = useRef<MoonraySlicer | null>(null)
  const providersRef = useRef<SlicerProviders | null>(null)

  const push = (text: string) => setSteps((s) => [...s, { text, state: 'run' }])
  const mark = (state: StepState, detail?: string) =>
    setSteps((s) => s.map((st, i) => (i === s.length - 1 ? { ...st, state, detail } : st)))

  const session = useCallback(async (): Promise<SlicerProviders> => {
    if (providersRef.current) return providersRef.current
    push(`connecting wallet on ${config.networkId}…`)
    const s = await connectWallet(config.networkId)
    const providers = await buildBrowserProviders({ api: s.api, config, useLocalProver: false })
    providersRef.current = providers
    mark('ok', s.walletName)
    return providers
  }, [config])

  const openCurrentOp = useCallback(
    async (game: MoonraySlicer, providers: SlicerProviders, address: string) => {
      const nowSec = Math.floor(Date.now() / 1000)
      const tid = BigInt(Math.floor(nowSec / HOUR))
      const closeAt = (Math.floor(nowSec / HOUR) + 1) * HOUR

      push(`checking OP-${tid % 10000n}…`)
      const view = await fetchLedger(providers, address).catch(() => null)
      if (view?.tournaments.some((t) => t.tid === tid)) {
        mark('ok', 'already open')
        return
      }
      mark('ok', 'not found — opening')

      push(`opening OP-${tid % 10000n} (proof + wallet approval)…`)
      const tx = await game.createTournament(
        tid,
        pickUsableSeed(),
        new Date(closeAt * 1000),
        new Date((closeAt + 25 * HOUR) * 1000),
      )
      mark('ok', `tx ${tx.txHash.slice(0, 14)}…`)
    },
    [],
  )

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return
      setBusy(true)
      setSteps([])
      try {
        await fn()
      } catch (err) {
        mark('err', err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  const deploy = () =>
    run(async () => {
      const providers = await session()
      push('deploying contract — proving the constructor, then waiting for the indexer (1–3 min)…')
      const game = await MoonraySlicer.deploy(providers, window.location.origin, loadOrCreateSecretKey())
      gameRef.current = game
      mark('ok', game.address)

      const dep: Deployment = { network: 'preprod', networkId: 'preprod', address: game.address }
      localStorage.setItem(LS_DEPLOYMENT, JSON.stringify(dep))
      setDeployment(dep)

      await openCurrentOp(game, providers, game.address)
    })

  const openOp = () =>
    run(async () => {
      if (!deployment) throw new Error('no deployment yet')
      const providers = await session()
      if (!gameRef.current) {
        push('joining contract as admin…')
        gameRef.current = await MoonraySlicer.join(
          providers,
          window.location.origin,
          deployment.address,
          loadOrCreateSecretKey(),
        )
        mark('ok')
      }
      await openCurrentOp(gameRef.current, providers, deployment.address)
    })

  const forget = () => {
    localStorage.removeItem(LS_DEPLOYMENT)
    setDeployment(null)
    setSteps([])
    gameRef.current = null
  }

  const json = deployment ? JSON.stringify(deployment, null, 2) : ''
  const copy = () => {
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <main className="deploy-root">
      <h1 className="deploy-word">MOONRAY</h1>
      <p className="deploy-sub">STATION CONSOLE · {config.networkId.toUpperCase()} DEPLOY</p>

      <section className="deploy-panel">
        {deployment ? (
          <>
            <div className="deploy-row">
              <span>CONTRACT</span>
              <code>{deployment.address}</code>
            </div>
            <pre className="deploy-json">{json}</pre>
            <div className="deploy-actions">
              <button className="deploy-btn" onClick={copy}>
                {copied ? 'COPIED' : 'COPY DEPLOYMENT JSON'}
              </button>
              <button className="deploy-btn" onClick={openOp} disabled={busy}>
                OPEN CURRENT HOUR OP
              </button>
              <button className="deploy-btn deploy-btn-ghost" onClick={forget} disabled={busy}>
                FORGET (THIS BROWSER)
              </button>
            </div>
            <p className="deploy-note">
              This browser already plays against the contract above. To point every visitor at it,
              put the JSON into <code>deployment.json</code> next to the app bundle.
            </p>
          </>
        ) : (
          <>
            <p className="deploy-note">
              Deploys a fresh Moonray Slicer contract to <b>{config.networkId}</b> through your
              connected wallet — it proves the constructor, pays the fees, and this browser&apos;s
              key becomes the admin. Afterwards the current hour&apos;s operation is opened
              automatically.
            </p>
            <div className="deploy-actions">
              <button className="deploy-btn" onClick={deploy} disabled={busy}>
                {busy ? 'WORKING…' : 'DEPLOY CONTRACT'}
              </button>
            </div>
          </>
        )}

        {steps.length > 0 && (
          <ol className="deploy-log">
            {steps.map((s, i) => (
              <li key={i} data-state={s.state}>
                <i aria-hidden="true">{s.state === 'ok' ? '✓' : s.state === 'err' ? '✕' : '…'}</i>
                <span>
                  {s.text}
                  {s.detail && <em> {s.detail}</em>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <a className="deploy-back" href="/">
        ← BACK TO THE FIELD
      </a>
    </main>
  )
}
