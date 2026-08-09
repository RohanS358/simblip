'use client'

// Live cursor + camera mirroring for board-live: desktop and board only
// (never students — see board-live-types.ts).
//   useSendCursor    — throttles outgoing pointer moves to 10/sec, always the
//                      latest position (never queues intermediate ones)
//   usePeerCursor    — tracks the last cursor event from the OTHER role,
//                      fading it out if nothing arrives for 2s (peer idle
//                      or disconnected)
//   useSendViewport  — throttled outgoing pan/zoom, sent as a screen-size-
//                      independent world-space point (not raw pixel x/y —
//                      desktop and board can have very different screen
//                      sizes, see board-live-types.ts's `viewport` message)
//   useFollowViewport — receiver: re-derives ITS OWN viewport.x/y from the
//                      incoming world-space point using its own screen size,
//                      so the same world content is centered regardless of
//                      how big each screen actually is

import { useEffect, useRef, useState } from 'react'
import { useDocStore, type Viewport } from '@/lib/store/document'
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

/** Watches this device's own committed viewport for `pageId` and sends the
 *  WORLD-SPACE point at screen center (+ zoom) whenever it settles —
 *  screen-size-independent, unlike viewport.x/y themselves (which are raw
 *  pixel offsets meaningful only against this device's own canvas size). */
export function useSendViewport(handle: BoardLiveHandle | null, pageId: string | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Viewport | null>(null)

  useEffect(() => {
    if (!handle?.connected || !pageId) return
    const send = (vp: Viewport) => {
      if (typeof window === 'undefined') return
      const worldCenterX = (window.innerWidth / 2 - vp.x) / vp.zoom
      const worldCenterY = (window.innerHeight / 2 - vp.y) / vp.zoom
      handle.sendViewport(worldCenterX, worldCenterY, vp.zoom)
    }
    let prev = useDocStore.getState().viewports[pageId]
    const unsub = useDocStore.subscribe((s) => {
      const vp = s.viewports[pageId]
      if (!vp || vp === prev) return
      prev = vp
      pendingRef.current = vp
      if (timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        if (pendingRef.current) send(pendingRef.current)
      }, SEND_INTERVAL_MS)
    })
    return () => {
      unsub()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [handle, handle?.connected, pageId])
}

/** Feed every incoming BoardLiveServerMsg here; applies a `viewport` event
 *  to this device's OWN viewport for `pageId`, converting the sender's
 *  world-space center back into this screen's own pixel offset. Skips
 *  events this device itself originated (echo guard, same pattern as
 *  cursor/bundle). */
export function useFollowViewport(evt: BoardLiveServerMsg | null, pageId: string | null, selfOrigin: string) {
  useEffect(() => {
    if (!evt || evt.type !== 'viewport' || evt.origin === selfOrigin || !pageId) return
    if (typeof window === 'undefined') return
    const x = window.innerWidth / 2 - evt.x * evt.zoom
    const y = window.innerHeight / 2 - evt.y * evt.zoom
    useDocStore.getState().setViewport(pageId, { x, y, zoom: evt.zoom })
  }, [evt, pageId, selfOrigin])
}
