'use client'

// Live cursor + camera mirroring for board-live: desktop and board only
// (never students — see board-live-types.ts).
//   useSendCursor    — sends pointer moves at CURSOR_SEND_INTERVAL_MS —
//                      unthrottled sends flood the shared Redis pub/sub
//                      connection (one round-trip per raw mousemove), which
//                      queues behind other instances' traffic and reads as
//                      cursor lag; ~30/sec is still smooth and cuts that
//                      load by an order of magnitude
//   usePeerCursor    — tracks the last cursor event from the OTHER role,
//                      fading it out if nothing arrives for 2s (peer idle
//                      or disconnected)
//   useSendViewport  — outgoing pan/zoom, sent as a screen-size-independent
//                      world-space point (not raw pixel x/y — desktop and
//                      board can have very different screen sizes, see
//                      board-live-types.ts's `viewport` message). No extra
//                      throttle needed: the sender's own committed viewport
//                      already only changes on gesture settle, not per-frame.
//   useFollowViewport — receiver: re-derives ITS OWN viewport.x/y from the
//                      incoming world-space point using its own screen size,
//                      so the same world content is centered regardless of
//                      how big each screen actually is

import { useEffect, useRef, useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import type { BoardLiveHandle } from './board-live-client'
import type { BoardLiveServerMsg } from './board-live-types'

const FADE_AFTER_MS = 2000
const CURSOR_SEND_INTERVAL_MS = 33 // ~30/sec

/** Call the returned function on every pointer move — throttled to
 *  CURSOR_SEND_INTERVAL_MS, trailing edge always fires so the cursor
 *  settles at its true final position. */
export function useSendCursor(handle: BoardLiveHandle | null, pageId: string | null) {
  const lastSent = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  return (x: number, y: number) => {
    if (!handle?.connected || !pageId) return
    const now = Date.now()
    const elapsed = now - lastSent.current

    if (pending.current) clearTimeout(pending.current)

    if (elapsed >= CURSOR_SEND_INTERVAL_MS) {
      lastSent.current = now
      handle.sendCursor(x, y, pageId)
    } else {
      pending.current = setTimeout(() => {
        lastSent.current = Date.now()
        handle.sendCursor(x, y, pageId)
      }, CURSOR_SEND_INTERVAL_MS - elapsed)
    }
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
 *  WORLD-SPACE point at screen center (+ zoom) whenever it changes — sent
 *  immediately, no extra throttle (the sender's own committed viewport
 *  already only changes on gesture settle, not per-frame — see canvas.tsx's
 *  paintViewport comment). Screen-size-independent, unlike viewport.x/y
 *  themselves (raw pixel offsets meaningful only against this device's own
 *  canvas size). */
export function useSendViewport(handle: BoardLiveHandle | null, pageId: string | null) {
  useEffect(() => {
    if (!handle?.connected || !pageId) return
    let prev = useDocStore.getState().viewports[pageId]
    return useDocStore.subscribe((s) => {
      const vp = s.viewports[pageId]
      if (!vp || vp === prev || typeof window === 'undefined') return
      prev = vp
      const worldCenterX = (window.innerWidth / 2 - vp.x) / vp.zoom
      const worldCenterY = (window.innerHeight / 2 - vp.y) / vp.zoom
      handle.sendViewport(worldCenterX, worldCenterY, vp.zoom)
    })
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
