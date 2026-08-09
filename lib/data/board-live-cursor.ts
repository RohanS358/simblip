'use client'

// Live cursor mirroring for board-live: desktop and board only (never
// students — see board-live-types.ts). Two halves:
//   useSendCursor   — throttles outgoing pointer moves to 10/sec, always the
//                      latest position (never queues intermediate ones)
//   usePeerCursor    — tracks the last cursor event from the OTHER role,
//                      fading it out if nothing arrives for 2s (peer idle
//                      or disconnected)

import { useEffect, useRef, useState } from 'react'
import type { BoardLiveHandle } from './board-live-client'
import type { BoardLiveServerMsg } from './board-live-types'

const SEND_INTERVAL_MS = 100
const FADE_AFTER_MS = 2000

/** Call the returned function on every pointer move; it coalesces to at
 *  most one send per SEND_INTERVAL_MS, always carrying the latest position. */
export function useSendCursor(handle: BoardLiveHandle | null, pageId: string | null) {
  const pending = useRef<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (x: number, y: number) => {
    if (!handle?.connected || !pageId) return
    pending.current = { x, y }
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      if (pending.current) handle.sendCursor(pending.current.x, pending.current.y, pageId)
    }, SEND_INTERVAL_MS)
  }
}

export interface PeerCursor {
  x: number
  y: number
  pageId: string
  origin: string
}

/** Feed every incoming BoardLiveServerMsg here; returns the peer's last
 *  cursor position, or null once it's gone stale. */
export function usePeerCursor(evt: BoardLiveServerMsg | null): PeerCursor | null {
  const [cursor, setCursor] = useState<PeerCursor | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!evt || evt.type !== 'cursor') return
    setCursor({ x: evt.x, y: evt.y, pageId: evt.pageId, origin: evt.origin })
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    fadeTimer.current = setTimeout(() => setCursor(null), FADE_AFTER_MS)
  }, [evt])

  useEffect(() => {
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    }
  }, [])

  return cursor
}
