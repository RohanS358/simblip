// Cross-instance broadcast bus for board-live WebSocket connections.
//
// Fan-out has two paths:
//   1. Local, synchronous: any socket registered on THIS instance for the
//      event's session gets it directly, no Redis round-trip — this covers
//      same-instance peers (Fluid Compute reuses warm instances, so a
//      single classroom's traffic often lands together).
//   2. Cross-instance, via Redis pub/sub: every event is published to one
//      fixed channel and every other instance's shared subscriber picks it
//      up and re-dispatches locally by sessionId. Unlike the Postgres
//      NOTIFY this replaced, there's no realistic payload-size ceiling, so
//      full obj-patch/bundle payloads always go out as-is — `resync` stays
//      in the protocol only for genuine reconnect/drift cases, not size.
//
// Exactly one publisher and one subscriber connection per warm instance
// (lib/server/redis.ts), shared across every board session on that
// instance — the free-tier Redis plan caps at 30 connections total, so
// per-instance connection count must stay fixed regardless of how many
// sessions or sockets that instance is serving.

import { getRedisPub, getRedisSub } from './redis'
import type { BoardLiveServerMsg } from '@/lib/data/board-live-types'

const CHANNEL = 'simblip:board-live'

export interface LocalSocket {
  sessionId: string
  send: (data: string) => void
}

interface Bridge {
  subscribed: boolean
  connecting: Promise<void> | null
  sockets: Map<string, Set<LocalSocket>>
}

// Stashed on globalThis, not a module-scope `let`: next dev's Fast Refresh
// can re-evaluate this module on each request, and a bare module-scope
// singleton would get silently re-created, leaking a duplicate subscription
// per reload. In production, module scope is already reused per warm
// instance, so this is just a slightly more defensive version of the same
// lazy-singleton pattern.
const g = globalThis as unknown as { __boardLiveBridge?: Bridge }
const bridge: Bridge = (g.__boardLiveBridge ??= { subscribed: false, connecting: null, sockets: new Map() })

function localSocketsFor(sessionId: string): Set<LocalSocket> {
  let set = bridge.sockets.get(sessionId)
  if (!set) {
    set = new Set()
    bridge.sockets.set(sessionId, set)
  }
  return set
}

export function registerSocket(socket: LocalSocket): () => void {
  const set = localSocketsFor(socket.sessionId)
  set.add(socket)
  return () => {
    set.delete(socket)
    if (set.size === 0) bridge.sockets.delete(socket.sessionId)
  }
}

function fanOutLocal(sessionId: string, evt: BoardLiveServerMsg, exclude?: LocalSocket) {
  const set = bridge.sockets.get(sessionId)
  if (!set) return
  const data = JSON.stringify(evt)
  for (const socket of set) {
    if (socket === exclude) continue
    socket.send(data)
  }
}

async function ensureSubscribed(): Promise<void> {
  if (bridge.subscribed) return
  if (bridge.connecting) return bridge.connecting
  bridge.connecting = (async () => {
    const sub = getRedisSub()
    sub.on('message', (channel, message) => {
      if (channel !== CHANNEL) return
      try {
        const { sessionId, evt } = JSON.parse(message) as { sessionId: string; evt: BoardLiveServerMsg }
        fanOutLocal(sessionId, evt)
      } catch {
        /* malformed pub/sub payload — ignore */
      }
    })
    await sub.subscribe(CHANNEL)
    bridge.subscribed = true
  })()
  try {
    await bridge.connecting
  } finally {
    bridge.connecting = null
  }
}

/** Broadcast an event to every socket subscribed to a session — local
 *  instance synchronously, other instances via Redis pub/sub. No payload
 *  size ceiling (unlike the Postgres NOTIFY this replaced), so full
 *  obj-patch/bundle payloads always go out as-is. */
export async function publish(sessionId: string, evt: BoardLiveServerMsg, exclude?: LocalSocket): Promise<void> {
  fanOutLocal(sessionId, evt, exclude)
  await getRedisPub().publish(CHANNEL, JSON.stringify({ sessionId, evt }))
}

/** Call once per WS connection before registering the socket, so the
 *  instance is guaranteed subscribed before it starts relying on pub/sub. */
export const ensureBoardLiveListener = ensureSubscribed
