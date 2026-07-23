'use client'

// True briefly after `value` changes (never on mount) — for HUD chrome that
// should exist only while its value is actively moving, like the zoom pill
// the board canvas shows on phones. Extracted so the doc and PDF readers
// speak the same language.

import { useEffect, useRef, useState } from 'react'

export function useTransientHud(value: unknown, ms = 1200): boolean {
  const [on, setOn] = useState(false)
  const armed = useRef(false)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!armed.current) {
      armed.current = true // mount isn't a gesture
      return
    }
    setOn(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOn(false), ms)
  }, [value, ms])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  return on
}
