'use client'

import { useEffect, useState } from 'react'
import { subscribeKatexReady } from './katex-lazy'

/** Re-renders the calling component once KaTeX finishes loading, so the
 *  literal-source fallback in katex-lazy.ts swaps to typeset maths. The
 *  returned counter is only useful as a `useMemo` dependency — components
 *  that render maths inline during render can ignore it. */
export function useKatexReady(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeKatexReady(() => setTick((n) => n + 1)), [])
  return tick
}
