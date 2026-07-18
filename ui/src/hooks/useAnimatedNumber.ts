

import { useEffect, useRef, useState } from 'react'

/**
 * Tweens toward `target` with an ease-out so score readouts count instead of
 * jump. Pass `from` to count up from a fixed value on mount (ceremony reveals).
 */
export const useAnimatedNumber = (target: number, duration = 650, from?: number): number => {
  const [display, setDisplay] = useState(from ?? target)
  const displayRef = useRef(display)
  displayRef.current = display

  useEffect(() => {
    const from = displayRef.current
    if (from === target) return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - k, 3)
      setDisplay(Math.round(from + (target - from) * eased))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return display
}
