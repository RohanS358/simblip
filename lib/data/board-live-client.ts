'use client'

// Client transport for the board-live WebSocket (app/api/board-live/[sessionId]).
// Reconnection is routine, not error handling: Vercel Functions force-close
// long-lived connections at their max duration, so every socket WILL drop
// and reconnect multiple times during a normal class period. Degradation is
// always "connected flips to false, the caller's existing poll code keeps
// running" — never a thrown error.

import { useEffect, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/auth/store'
import type { SceneObject } from '@/lib/scene/types'
import type { RemoteCommand } from './types'
import type { PageBundle } from '@/lib/store/page-bundle'
import type { BoardLiveClientMsg, BoardLiveServerMsg } from './board-live-types'

export interface BoardLiveHandle {
  readonly connected: boolean
  sendPatch: (objectId: string, obj: SceneObject | null) => void
  sendRemote: (cmd: Omit<RemoteCommand, 'seq'>) => void
  sendBundle: (bundle: PageBundle) => void
  sendCursor: (x: number, y: number, pageId: string) => void
  close: () => void
}

const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 5000

const noopHandle: BoardLiveHandle = {
  connected: false,
  sendPatch: () => {},
  sendRemote: () => {},
  sendBundle: () => {},
  sendCursor: () => {},
  close: () => {},
}

/** Plain function — usable from imperative modules (lib/data/board-follow.ts)
 *  as well as the React wrapper below. */
export function connectBoardLive(
  sessionId: string,
  onEvent: (evt: BoardLiveServerMsg) => void,
  onResync: () => void,
  onConnectedChange?: (connected: boolean) => void,
  role?: 'desktop'
): BoardLiveHandle {
  if (process.env.NEXT_PUBLIC_BOARD_LIVE !== '1') return noopHandle

  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connected = false

  const setConnected = (c: boolean) => {
    if (connected === c) return
    connected = c
    onConnectedChange?.(c)
  }

  const send = (msg: BoardLiveClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  const scheduleReconnect = () => {
    if (closed) return
    if (reconnectTimer) return
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) * (0.75 + Math.random() * 0.5)
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      open()
    }, delay)
  }

  function open() {
    if (closed) return
    const token = getAccessToken()
    if (!token) {
      scheduleReconnect()
      return
    }
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
    const roleParam = role ? `&role=${role}` : ''
    const url = `${proto}${location.host}/api/board-live/${sessionId}?token=${encodeURIComponent(token)}${roleParam}`
    const socket = new WebSocket(url)
    ws = socket
    socket.onopen = () => {
      attempt = 0
      setConnected(true)
      onResync()
    }
    socket.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data as string) as BoardLiveServerMsg)
      } catch {
        /* malformed frame — ignore */
      }
    }
    socket.onclose = () => {
      setConnected(false)
      if (ws === socket) ws = null
      scheduleReconnect()
    }
    socket.onerror = () => socket.close()
  }

  open()

  return {
    get connected() {
      return connected
    },
    sendPatch: (objectId, obj) => send({ type: 'obj-patch', objectId, obj }),
    sendRemote: (cmd) => send({ type: 'remote', cmd }),
    sendBundle: (bundle) => send({ type: 'bundle', bundle }),
    sendCursor: (x, y, pageId) => send({ type: 'cursor', x, y, pageId }),
    close: () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    },
  }
}

/** Thin React wrapper for app/board/page.tsx and app/present/page.tsx. */
export function useBoardLive(
  sessionId: string | null,
  onEvent: (evt: BoardLiveServerMsg) => void,
  onResync: () => void,
  role?: 'desktop'
): BoardLiveHandle | null {
  const [, bump] = useState(0)
  const handleRef = useRef<BoardLiveHandle | null>(null)
  const onEventRef = useRef(onEvent)
  const onResyncRef = useRef(onResync)
  onEventRef.current = onEvent
  onResyncRef.current = onResync

  useEffect(() => {
    if (!sessionId) {
      handleRef.current = null
      bump((n) => n + 1)
      return
    }
    const handle = connectBoardLive(
      sessionId,
      (evt) => onEventRef.current(evt),
      () => onResyncRef.current(),
      () => bump((n) => n + 1),
      role
    )
    handleRef.current = handle
    bump((n) => n + 1)
    return () => {
      handle.close()
      if (handleRef.current === handle) handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, role])

  return handleRef.current
}
