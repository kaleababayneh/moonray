/**
 * Procedural sound design — every cue is synthesized with WebAudio, no assets.
 * The palette is quiet and glassy to match the observatory fiction: filtered
 * noise for the slice, pentatonic plucks for locks, a small arpeggio for wins.
 * Everything is guarded so SSR and denied AudioContexts fail silently.
 */

const MUTE_KEY = 'moonray:muted'
const MASTER_LEVEL = 0.55

let ac: AudioContext | null = null
let master: GainNode | null = null
let muted: boolean | null = null

const readMuted = (): boolean => {
  if (muted !== null) return muted
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    muted = false
  }
  return muted
}

const ensure = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  if (!ac) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ac = new Ctor()
      master = ac.createGain()
      master.gain.value = readMuted() ? 0 : MASTER_LEVEL
      const limiter = ac.createDynamicsCompressor()
      limiter.threshold.value = -14
      limiter.ratio.value = 8
      master.connect(limiter)
      limiter.connect(ac.destination)
    } catch {
      return null
    }
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {})
  return ac
}

export const isMuted = (): boolean => readMuted()

export const setMuted = (next: boolean) => {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {}
  if (ac && master) master.gain.setTargetAtTime(next ? 0 : MASTER_LEVEL, ac.currentTime, 0.02)
}

/** Call from the first user gesture so the context is allowed to start. */
export const unlock = () => {
  ensure()
}

interface ToneOpts {
  freq: number
  type?: OscillatorType
  dur?: number
  peak?: number
  glideTo?: number
  delay?: number
  filterFreq?: number
}

const tone = ({ freq, type = 'sine', dur = 0.2, peak = 0.08, glideTo, delay = 0, filterFreq }: ToneOpts) => {
  const c = ensure()
  if (!c || !master || readMuted()) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0004, t0 + dur)
  let head: AudioNode = osc
  if (filterFreq) {
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFreq
    head.connect(filter)
    head = filter
  }
  head.connect(gain)
  gain.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

const noiseBurst = (dur: number, peak: number, from: number, to: number, delay = 0) => {
  const c = ensure()
  if (!c || !master || readMuted()) return
  const t0 = c.currentTime + delay
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buffer = c.createBuffer(1, len, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.1
  filter.frequency.setValueAtTime(from, t0)
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const gain = c.createGain()
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0004, t0 + dur)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
}

/** Soft interface tick for buttons and toggles. */
export const click = () => {
  tone({ freq: 1750, type: 'square', dur: 0.045, peak: 0.028, filterFreq: 2600 })
}

/** A blade of light passing through glass. */
export const slice = () => {
  noiseBurst(0.18, 0.1, 420, 3600)
  tone({ freq: 2100, type: 'sine', dur: 0.12, peak: 0.03, glideTo: 3200 })
}

/** Low, closed refusal — the field rejects the trajectory. */
export const reject = () => {
  tone({ freq: 196, type: 'sine', dur: 0.2, peak: 0.085, glideTo: 98 })
  tone({ freq: 92, type: 'triangle', dur: 0.14, peak: 0.05 })
}

const LOCK_NOTES = [659.25, 739.99, 830.61, 987.77, 1108.73, 1318.5] // E major pentatonic

/** Pluck when a moonlet becomes isolated; pitch rises with each lock. */
export const lock = (step: number, delay = 0) => {
  const f = LOCK_NOTES[Math.min(LOCK_NOTES.length - 1, Math.max(0, step))]
  tone({ freq: f, type: 'triangle', dur: 0.5, peak: 0.085, delay, filterFreq: 5200 })
  tone({ freq: f / 2, type: 'sine', dur: 0.4, peak: 0.03, delay })
}

/** Soft descending sting when the last trajectory is spent. */
export const gameOver = () => {
  tone({ freq: 392, type: 'triangle', dur: 0.42, peak: 0.06, glideTo: 330, filterFreq: 3200 })
  tone({ freq: 262, type: 'triangle', dur: 0.6, peak: 0.06, glideTo: 196, delay: 0.18, filterFreq: 2800 })
  tone({ freq: 98, type: 'sine', dur: 0.9, peak: 0.05, delay: 0.22 })
}

/** Small ceremonial arpeggio for a full clear. */
export const win = () => {
  const notes = [659.25, 830.61, 987.77, 1318.5]
  notes.forEach((f, i) => {
    tone({ freq: f, type: 'triangle', dur: 0.6, peak: 0.075, delay: i * 0.1, filterFreq: 5600 })
  })
  tone({ freq: 164.81, type: 'sine', dur: 1.2, peak: 0.045, delay: 0.05 })
  tone({ freq: 246.94, type: 'sine', dur: 1.1, peak: 0.03, delay: 0.12 })
}
